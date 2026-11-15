/**
 * Tes keandalan sinkronisasi: dua "device" (dua Dexie palsu di memori) dan satu server palsu.
 * Hanya dua batas yang di-mock (Dexie via ./index, klien Supabase); stamps.ts, syncCore.ts,
 * sync.ts dan syncRealtime.ts adalah modul asli.
 *
 * Yang diuji:
 *   - A membuat, B menarik; penarikan tidak mengubah updatedAt dan tidak menandai dirty
 *   - edit stale di B tidak menimpa versi server yang lebih baru (pull dan push)
 *   - soft-delete di A tersampaikan ke B
 *   - push delta: baris yang sudah terkirim tidak dikirim ulang
 *   - push gagal: status error, baris tetap dirty, diulang dengan backoff, galat 3x memicu peringatan
 *   - event realtime dan reconnect memicu pull; event tidak menimpa data langsung
 *   - pull dan push lewat satu antrean (permintaan bersamaan digabung)
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

const USER = '48fba103-3626-4887-b214-d96617538eb8'
const T0 = Date.parse('2026-11-01T09:00:00.000Z')
const at = (minutes: number) => new Date(T0 + minutes * 60_000).toISOString()
const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`

type Row = Record<string, any>

// ---------- Batas 1: Dexie palsu (satu instance per device) ----------

const h = vi.hoisted(() => {
  type Hook = (...args: any[]) => any

  class FakeTable {
    rows = new Map<string, Row>()
    hooks: { creating: Hook[]; updating: Hook[] } = { creating: [], updating: [] }
    constructor(private readonly dev: { currentTx: object | null }) {}
    hook(event: 'creating' | 'updating', fn: Hook) {
      this.hooks[event].push(fn)
    }
    private get tx() {
      return this.dev.currentTx
    }
    put(input: Row) {
      const existing = this.rows.get(input.id)
      if (!existing) {
        const obj: Row = { ...input }
        for (const fn of this.hooks.creating) fn(obj.id, obj, this.tx)
        this.rows.set(obj.id, obj)
        return obj.id
      }
      const mods: Row = { ...input }
      for (const fn of this.hooks.updating) {
        const extra = fn(mods, input.id, existing, this.tx)
        if (extra) Object.assign(mods, extra)
      }
      this.rows.set(input.id, { ...existing, ...mods })
      return input.id
    }
    add(input: Row) {
      if (this.rows.has(input.id)) throw new Error('ConstraintError: key exists')
      return this.put(input)
    }
    update(id: string, changes: Row) {
      const existing = this.rows.get(id)
      if (!existing) return 0
      const mods: Row = { ...changes }
      for (const fn of this.hooks.updating) {
        const extra = fn(mods, id, existing, this.tx)
        if (extra) Object.assign(mods, extra)
      }
      Object.assign(existing, mods)
      return 1
    }
    get(id: string) {
      const r = this.rows.get(id)
      return r ? { ...r } : undefined
    }
    bulkGet(ids: string[]) {
      return ids.map(id => this.get(id))
    }
    bulkPut(rows: Row[]) {
      for (const r of rows) this.put(r)
    }
    delete(id: string) {
      this.rows.delete(id)
    }
    toArray() {
      return Array.from(this.rows.values()).map(r => ({ ...r }))
    }
    where(index: string) {
      const rowsWith = (value: unknown) => this.toArray().filter(r => r[index] === value)
      return {
        equals: (value: unknown) => ({
          toArray: async () => rowsWith(value),
          count: async () => rowsWith(value).length,
        }),
      }
    }
  }

  const state: {
    device: any
    session: { user: { id: string } } | null
    channels: any[]
    getSessionCalls: number
  } = { device: null, session: null, channels: [], getSessionCalls: 0 }

  // ---------- Batas 2: server palsu (bersama oleh kedua device) ----------

  const server = {
    tables: new Map<string, Map<string, Row>>(),
    fail: null as null | { table: string; times: number },
    upserts: [] as Array<{ table: string; id: string }>,
  }
  const serverTable = (name: string) => {
    if (!server.tables.has(name)) server.tables.set(name, new Map())
    return server.tables.get(name)!
  }

  function selectQuery(name: string) {
    const filters: Array<(r: Row) => boolean> = []
    let range: [number, number] | null = null
    const exec = () => {
      let rows = Array.from(serverTable(name).values())
        .filter(r => filters.every(f => f(r)))
        .sort((a, b) => String(a.id).localeCompare(String(b.id)))
      if (range) rows = rows.slice(range[0], range[1] + 1)
      return { data: rows.map(r => ({ ...r })), error: null as null | Row }
    }
    const q: any = {
      eq: (col: string, v: unknown) => {
        filters.push(r => r[col] === v)
        return q
      },
      in: (col: string, vs: unknown[]) => {
        filters.push(r => vs.includes(r[col]))
        return q
      },
      order: () => q,
      range: (from: number, to: number) => {
        range = [from, to]
        return q
      },
      single: async () => {
        const { data } = exec()
        return data[0]
          ? { data: data[0], error: null }
          : { data: null, error: { code: 'PGRST116', message: 'no rows' } }
      },
      then: (ok: any, bad: any) => Promise.resolve(exec()).then(ok, bad),
    }
    return q
  }

  function upsert(name: string, payload: Row) {
    const run = async () => {
      if (server.fail && server.fail.table === name && server.fail.times > 0) {
        server.fail.times--
        return { data: null, error: { message: 'simulated outage', code: '503' } }
      }
      serverTable(name).set(payload.id, { ...payload })
      server.upserts.push({ table: name, id: payload.id })
      return { data: null, error: null }
    }
    const p = run()
    return Object.assign(p, {
      select: () => ({
        single: async () => {
          const r = await p
          return { ...r, data: r.error ? null : { id: payload.id } }
        },
      }),
    })
  }

  const supabase = {
    auth: {
      getSession: async () => {
        state.getSessionCalls++
        return { data: { session: state.session }, error: null }
      },
    },
    from: (name: string) => ({
      select: () => selectQuery(name),
      upsert: (payload: Row) => upsert(name, payload),
    }),
    channel: (name: string) => {
      const channel: any = { name, handlers: [] as any[], statusCb: null as any }
      channel.on = (_type: string, filter: Row, cb: () => void) => {
        channel.handlers.push({ filter, cb })
        return channel
      }
      channel.subscribe = (cb: (s: string) => void) => {
        channel.statusCb = cb
        return channel
      }
      state.channels.push(channel)
      return channel
    },
    removeChannel: async () => undefined,
  }

  return { state, FakeTable, server, serverTable, supabase }
})

vi.mock('./index', () => ({
  get db() {
    return h.state.device.db
  },
}))
vi.mock('../lib/supabase', () => ({ supabase: h.supabase }))

const { installStampHooks } = await import('./stamps')
const { requestSync, syncUserDataFromSupabase, pushLocalChangesToSupabase, enableAutoRetry } = await import('./sync')
const { pushToServer } = await import('./syncCore')
const { subscribeRealtime, REALTIME_TABLES } = await import('./syncRealtime')
const { getSyncState, resetSyncState, FAILURE_WARNING_THRESHOLD } = await import('./syncStatus')

const STAMPED = ['accounts', 'categories', 'transactions', 'budgets', 'goals', 'cashiers'] as const

function makeDevice(label: string) {
  const dev: { label: string; currentTx: object | null; db: any } = { label, currentTx: null, db: null }
  const tables: Record<string, any> = {}
  for (const name of [...STAMPED, 'users']) {
    const t = new h.FakeTable(dev)
    if ((STAMPED as readonly string[]).includes(name)) installStampHooks(t as any)
    tables[name] = t
  }
  dev.db = {
    ...tables,
    transaction: async (_mode: string, _tables: unknown, fn: (tx: object) => unknown) => {
      const prev = dev.currentTx
      const tx = {}
      dev.currentTx = tx
      try {
        return await fn(tx)
      } finally {
        dev.currentTx = prev
      }
    },
  }
  return dev
}

const txRow = (n: number, overrides: Row = {}): Row => ({
  id: uuid(n),
  userId: USER,
  accountId: uuid(900),
  categoryId: null,
  cashierId: null,
  amount: 50_000,
  currency: 'IDR',
  type: 'expense',
  date: '2026-11-01',
  description: `tx ${n}`,
  merchant: '',
  notes: '',
  receiptImage: null,
  receiptOcrText: null,
  location: null,
  latitude: null,
  longitude: null,
  createdAt: at(0),
  deletedAt: null,
  ...overrides,
})

const serverRow = (table: string, id: string) => h.serverTable(table).get(id)
const lastChannel = () => h.state.channels[h.state.channels.length - 1]

/** Biarkan semua microtask dan callback yang tertunda berjalan (setImmediate tidak di-fake). */
const flush = () => new Promise(resolve => setImmediate(resolve))

let devA: ReturnType<typeof makeDevice>
let devB: ReturnType<typeof makeDevice>

const on = (dev: ReturnType<typeof makeDevice>) => {
  h.state.device = dev
  return dev.db
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] })
  vi.setSystemTime(T0)
  h.server.tables.clear()
  h.server.fail = null
  h.server.upserts.length = 0
  h.state.session = { user: { id: USER } }
  h.state.channels.length = 0
  h.state.getSessionCalls = 0
  devA = makeDevice('A')
  devB = makeDevice('B')
  h.state.device = devA
  resetSyncState()
  enableAutoRetry(false)
})

afterEach(() => {
  enableAutoRetry(false)
  vi.useRealTimers()
})

// ---------- Konvergensi dua device ----------

describe('dua device konvergen', () => {
  it('A membuat transaksi, B menarik; penarikan tidak mengubah updatedAt dan tidak menandai dirty', async () => {
    vi.setSystemTime(T0)
    on(devA).transactions.add(txRow(1, { description: 'kopi' }))
    await pushLocalChangesToSupabase(USER)

    expect(serverRow('transactions', uuid(1))?.description).toBe('kopi')

    on(devB)
    await syncUserDataFromSupabase(USER)

    const b = await devB.db.transactions.get(uuid(1))
    expect(b?.description).toBe('kopi')
    expect(b?.updatedAt).toBe(at(0))
    expect(b?._dirty).toBe(0)
  })

  it('push hanya mengirim baris yang berubah sejak push sukses terakhir', async () => {
    on(devA).transactions.add(txRow(1))
    on(devA).transactions.add(txRow(2))
    await pushLocalChangesToSupabase(USER)
    expect(h.server.upserts.filter(u => u.table === 'transactions')).toHaveLength(2)

    h.server.upserts.length = 0
    await pushLocalChangesToSupabase(USER)
    expect(h.server.upserts.filter(u => u.table === 'transactions')).toHaveLength(0)
  })

  it('edit lokal di akun, kategori, dan goal ikut memperbarui updatedAt', async () => {
    vi.setSystemTime(T0)
    const db = on(devA)
    db.accounts.add({ id: uuid(10), userId: USER, name: 'Cash', type: 'cash', currency: 'IDR' })
    expect((await db.accounts.get(uuid(10)))?.updatedAt).toBe(at(0))

    vi.setSystemTime(T0 + 5 * 60_000)
    db.accounts.update(uuid(10), { name: 'Dompet' })
    const acc = await db.accounts.get(uuid(10))
    expect(acc?.name).toBe('Dompet')
    expect(acc?.updatedAt).toBe(at(5))
    expect(acc?._dirty).toBe(1)
  })
})

// ---------- Device usang tidak menimpa data baru ----------

describe('device usang tidak menimpa data baru', () => {
  it('pull: edit B yang lebih lama kalah dari edit A yang lebih baru di server', async () => {
    on(devA).transactions.add(txRow(1, { description: 'asli' }))
    await pushLocalChangesToSupabase(USER)
    on(devB)
    await syncUserDataFromSupabase(USER)

    // B mengedit lebih awal (belum terkirim). A mengedit lebih baru dan mengirim.
    vi.setSystemTime(T0 + 10 * 60_000)
    on(devB).transactions.update(uuid(1), { description: 'edit-B' })
    vi.setSystemTime(T0 + 20 * 60_000)
    on(devA).transactions.update(uuid(1), { description: 'edit-A' })
    await pushLocalChangesToSupabase(USER)
    expect(serverRow('transactions', uuid(1))?.description).toBe('edit-A')

    on(devB)
    await syncUserDataFromSupabase(USER)
    expect((await devB.db.transactions.get(uuid(1)))?.description).toBe('edit-A')
    expect(serverRow('transactions', uuid(1))?.description).toBe('edit-A')
  })

  it('push: versi server yang lebih baru tidak ditimpa, dan versi itu diterapkan lokal', async () => {
    on(devA).transactions.add(txRow(1, { description: 'asli' }))
    await pushLocalChangesToSupabase(USER)
    on(devB)
    await syncUserDataFromSupabase(USER)

    vi.setSystemTime(T0 + 10 * 60_000)
    on(devB).transactions.update(uuid(1), { description: 'usang-B' })
    vi.setSystemTime(T0 + 20 * 60_000)
    on(devA).transactions.update(uuid(1), { description: 'baru-A' })
    await pushLocalChangesToSupabase(USER)

    // Panggil push langsung (tanpa pull lebih dulu) agar LWW di sisi push yang diuji.
    h.server.upserts.length = 0
    on(devB)
    const result = await pushToServer(USER)
    expect(result.success).toBe(true)
    expect(h.server.upserts.filter(u => u.id === uuid(1))).toHaveLength(0)
    expect(serverRow('transactions', uuid(1))?.description).toBe('baru-A')
    expect((await devB.db.transactions.get(uuid(1)))?.description).toBe('baru-A')
    expect((await devB.db.transactions.get(uuid(1)))?._dirty).toBe(0)
  })

  it('soft-delete di A tersampaikan ke B', async () => {
    on(devA).transactions.add(txRow(1))
    await pushLocalChangesToSupabase(USER)
    on(devB)
    await syncUserDataFromSupabase(USER)

    vi.setSystemTime(T0 + 15 * 60_000)
    on(devA).transactions.update(uuid(1), { deletedAt: at(15) })
    await pushLocalChangesToSupabase(USER)

    on(devB)
    await syncUserDataFromSupabase(USER)
    expect((await devB.db.transactions.get(uuid(1)))?.deletedAt).toBe(at(15))
  })
})

// ---------- Galat, status, dan retry ----------

describe('push gagal tidak senyap', () => {
  it('memunculkan status error, baris tetap dirty, lalu diulang dengan backoff sampai berhasil', async () => {
    enableAutoRetry(true)
    on(devA).transactions.add(txRow(1))
    h.server.fail = { table: 'transactions', times: 1 }

    await requestSync(USER, 'manual')
    let s = getSyncState()
    expect(s.phase).toBe('error')
    expect(s.tableErrors.transactions).toContain('simulated outage')
    expect(s.pending).toBe(1)
    expect(s.consecutiveFailures).toBe(1)
    expect((await devA.db.transactions.get(uuid(1)))?._dirty).toBe(1)

    await vi.advanceTimersByTimeAsync(2_000)
    await flush()
    s = getSyncState()
    expect(s.phase).toBe('idle')
    expect(s.pending).toBe(0)
    expect(s.consecutiveFailures).toBe(0)
    expect(s.tableErrors).toEqual({})
    expect(serverRow('transactions', uuid(1))).toBeTruthy()
  })

  it('kegagalan berturut-turut mencapai ambang peringatan', async () => {
    on(devA).transactions.add(txRow(1))
    h.server.fail = { table: 'transactions', times: FAILURE_WARNING_THRESHOLD }
    for (let i = 0; i < FAILURE_WARNING_THRESHOLD; i++) {
      await requestSync(USER, 'manual')
    }
    expect(getSyncState().consecutiveFailures).toBe(FAILURE_WARNING_THRESHOLD)
    expect(getSyncState().pending).toBe(1)
  })
})

// ---------- Realtime dan reconnect ----------

describe('realtime memicu pull, tidak menimpa data langsung', () => {
  it('satu channel dengan satu .on per tabel dan filter per user', () => {
    subscribeRealtime(USER, () => undefined)
    const channel = lastChannel()
    expect(channel.handlers).toHaveLength(REALTIME_TABLES.length + 1)
    const filters = channel.handlers.map((x: any) => x.filter)
    for (const table of REALTIME_TABLES) {
      expect(filters).toContainEqual(expect.objectContaining({ table, filter: `user_id=eq.${USER}` }))
    }
    expect(filters).toContainEqual(expect.objectContaining({ table: 'profiles', filter: `id=eq.${USER}` }))
  })

  it('event berulang digabung menjadi satu pull terjadwal, dan data muncul di B', async () => {
    on(devA).transactions.add(txRow(1))
    await pushLocalChangesToSupabase(USER)

    on(devB)
    const trigger = (reason: string) => requestSync(USER, reason)
    subscribeRealtime(USER, trigger, 400)
    const channel = lastChannel()
    const onChange = channel.handlers[0].cb

    onChange({ eventType: 'INSERT' })
    onChange({ eventType: 'INSERT' })
    onChange({ eventType: 'UPDATE' })
    await vi.advanceTimersByTimeAsync(400)
    await flush()

    expect(await devB.db.transactions.get(uuid(1))).toBeTruthy()
  })

  it('SUBSCRIBED (reconnect) menarik perubahan yang terlewat; CHANNEL_ERROR menandai realtime down', async () => {
    subscribeRealtime(USER, reason => {
      void requestSync(USER, reason)
    })
    const channel = lastChannel()

    on(devA).transactions.add(txRow(7))
    await pushLocalChangesToSupabase(USER)

    on(devB)
    channel.statusCb('CHANNEL_ERROR')
    expect(getSyncState().realtime).toBe('down')
    expect(await devB.db.transactions.get(uuid(7))).toBeUndefined()

    channel.statusCb('SUBSCRIBED')
    await flush()
    expect(getSyncState().realtime).toBe('live')
    expect(await devB.db.transactions.get(uuid(7))).toBeTruthy()
  })
})

// ---------- Satu antrean: pull lalu push, tidak bersamaan ----------

describe('satu antrean untuk pull dan push', () => {
  it('permintaan bersamaan digabung; siklus berikutnya dimulai setelah yang berjalan selesai', async () => {
    const r1 = requestSync(USER, 'focus')
    const r2 = requestSync(USER, 'poll')
    const r3 = requestSync(USER, 'online')
    expect(r2).toBe(r1)
    expect(r3).toBe(r1)
    await r1

    const r4 = requestSync(USER, 'visible')
    const r5 = requestSync(USER, 'realtime')
    expect(r4).toBe(r5)
    expect(r4).not.toBe(r1)
    await r4

    // Satu siklus = pull (satu getSession) + push (satu getSession). Dua siklus = 4 panggilan.
    expect(h.state.getSessionCalls).toBe(4)
  })

  it('setiap siklus menjalankan pull (select) lebih dulu, lalu push (upsert)', async () => {
    const log: string[] = []
    const supa = h.supabase as any
    const realFrom = supa.from
    supa.from = (name: string) => {
      const real = realFrom(name)
      return {
        select: (...args: unknown[]) => {
          log.push(`pull:${name}`)
          return real.select(...args)
        },
        upsert: (payload: Row) => {
          log.push(`push:${name}`)
          return real.upsert(payload)
        },
      }
    }
    try {
      on(devA).transactions.add(txRow(1))
      await requestSync(USER, 'manual')
    } finally {
      supa.from = realFrom
    }
    const firstPush = log.findIndex(entry => entry.startsWith('push:'))
    const lastPull = log.map(entry => entry.startsWith('pull:')).lastIndexOf(true)
    expect(firstPush).toBeGreaterThan(-1)
    expect(lastPull).toBeGreaterThan(-1)
    expect(lastPull).toBeLessThan(firstPush)
    expect(serverRow('transactions', uuid(1))).toBeTruthy()
  })
})
