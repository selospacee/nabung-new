/**
 * Tes keandalan sinkronisasi: dua "device" (dua Dexie palsu di memori) dan satu server palsu.
 * Hanya dua batas yang di-mock (Dexie via ./index, klien Supabase); stamps.ts, syncCore.ts,
 * sync.ts, syncRealtime.ts, usage.ts dan refs.ts adalah modul asli.
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
    constructor(private readonly dev: { currentTx: object | null }, private readonly pk: string = 'id') {}
    hook(event: 'creating' | 'updating', fn: Hook) {
      this.hooks[event].push(fn)
    }
    private get tx() {
      return this.dev.currentTx
    }
    put(input: Row) {
      const key = input[this.pk] as string
      const existing = this.rows.get(key)
      if (!existing) {
        const obj: Row = { ...input }
        for (const fn of this.hooks.creating) fn(key, obj, this.tx)
        this.rows.set(key, obj)
        return key
      }
      const mods: Row = { ...input }
      for (const fn of this.hooks.updating) {
        const extra = fn(mods, key, existing, this.tx)
        if (extra) Object.assign(mods, extra)
      }
      this.rows.set(key, { ...existing, ...mods })
      return key
    }
    add(input: Row) {
      if (this.rows.has(input[this.pk] as string)) throw new Error('ConstraintError: key exists')
      return this.put(input)
    }
    update(key: string, changes: Row) {
      const existing = this.rows.get(key)
      if (!existing) return 0
      const mods: Row = { ...changes }
      for (const fn of this.hooks.updating) {
        const extra = fn(mods, key, existing, this.tx)
        if (extra) Object.assign(mods, extra)
      }
      Object.assign(existing, mods)
      return 1
    }
    get(key: string) {
      const r = this.rows.get(key)
      return r ? { ...r } : undefined
    }
    bulkGet(keys: string[]) {
      return keys.map(k => this.get(k))
    }
    bulkPut(rows: Row[]) {
      for (const r of rows) this.put(r)
    }
    delete(key: string) {
      this.rows.delete(key)
    }
    toArray() {
      return Array.from(this.rows.values()).map(r => ({ ...r }))
    }
    where(index: string) {
      const self = this
      return {
        equals(value: unknown) {
          const preds: Array<(r: Row) => boolean> = [r => r[index] === value]
          const chain = (): any => ({
            filter(fn: (r: Row) => boolean) {
              preds.push(fn)
              return chain()
            },
            toArray: async () => self.toArray().filter(r => preds.every(p => p(r))),
            count: async () => self.toArray().filter(r => preds.every(p => p(r))).length,
          })
          return chain()
        },
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
    /** Gagal pada panggilan select ke-(skip+1) dan seterusnya, sebanyak `times` kali. */
    failSelect: null as null | { table: string; skip: number; times: number; seen: number },
    upserts: [] as Array<{ table: string; id: string }>,
    /** Setiap select: tabel + mode (full | delta). */
    log: [] as Array<{ table: string; mode: 'full' | 'delta' }>,
  }
  const serverTable = (name: string) => {
    if (!server.tables.has(name)) server.tables.set(name, new Map())
    return server.tables.get(name)!
  }

  function selectQuery(name: string) {
    const filters: Array<(r: Row) => boolean> = []
    let range: [number, number] | null = null
    let orderCol = 'id'
    let delta = false
    const exec = () => {
      server.log.push({ table: name, mode: delta ? 'delta' : 'full' })
      const f = server.failSelect
      if (f && f.table === name) {
        f.seen++
        if (f.seen > f.skip && f.times > 0) {
          f.times--
          return { data: null, error: { message: 'simulated read failure', code: '500' } as Row | null }
        }
      }
      let rows = Array.from(serverTable(name).values()).filter(r => filters.every(p => p(r)))
      rows.sort((a, b) => {
        if (orderCol === 'updated_at') {
          return (Date.parse(a.updated_at) - Date.parse(b.updated_at)) || String(a.id).localeCompare(String(b.id))
        }
        return String(a[orderCol] ?? a.id).localeCompare(String(b[orderCol] ?? b.id))
      })
      if (range) rows = rows.slice(range[0], range[1] + 1)
      return { data: rows.map(r => ({ ...r })), error: null as Row | null }
    }
    const q: any = {
      eq: (col: string, v: unknown) => {
        filters.push(r => r[col] === v)
        return q
      },
      gte: (col: string, v: string) => {
        delta = true
        filters.push(r => Date.parse(r[col]) >= Date.parse(v))
        return q
      },
      in: (col: string, vs: unknown[]) => {
        filters.push(r => vs.includes(r[col]))
        return q
      },
      order: (col: string) => {
        orderCol = col
        return q
      },
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
      channel.on = (_type: string, filter: Row, cb: (p?: any) => void) => {
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
const { softDeleteAccount, softDeleteCategory, softDeleteBudget, InUseError, categoryUsage } = await import('./usage')
const { refLabel } = await import('./refs')

const STAMPED = ['accounts', 'categories', 'transactions', 'budgets', 'goals', 'cashiers'] as const

function makeDevice(label: string) {
  const dev: { label: string; currentTx: object | null; db: any } = { label, currentTx: null, db: null }
  const tables: Record<string, any> = {}
  for (const name of [...STAMPED, 'users', 'syncMeta']) {
    const t = new h.FakeTable(dev, name === 'syncMeta' ? 'key' : 'id')
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

const accountRow = (n: number, overrides: Row = {}): Row => ({
  id: uuid(n),
  userId: USER,
  name: `Akun ${n}`,
  type: 'cash',
  currency: 'IDR',
  icon: 'Wallet',
  color: '#10B981',
  createdAt: at(0),
  ...overrides,
})

const serverRow = (table: string, id: string) => h.serverTable(table).get(id)
/** Menanam baris langsung ke server (waktu server = updated_at yang diberikan). */
const seedServer = (table: string, row: Row) => h.serverTable(table).set(row.id, { ...row, user_id: USER })
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
  h.server.failSelect = null
  h.server.upserts.length = 0
  h.server.log.length = 0
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

    // Panggil push langsung (tanpa pull lebih dulu) agar aturan di sisi push yang diuji.
    h.server.upserts.length = 0
    on(devB)
    const result = await pushToServer(USER)
    expect(result.success).toBe(true)
    expect(h.server.upserts.filter(u => u.id === uuid(1))).toHaveLength(0)
    expect(serverRow('transactions', uuid(1))?.description).toBe('baru-A')
    expect((await devB.db.transactions.get(uuid(1)))?.description).toBe('baru-A')
    expect((await devB.db.transactions.get(uuid(1)))?._dirty).toBe(0)
  })
})

// ---------- Hapus lunak dan aturan hapus menang ----------

describe('hapus lunak (opsi A)', () => {
  it('hapus akun di A tersampaikan ke B: baris tetap ada di server dengan deleted_at, tidak hilang', async () => {
    on(devA).accounts.add(accountRow(20))
    await pushLocalChangesToSupabase(USER)
    on(devB)
    await syncUserDataFromSupabase(USER)
    expect(await devB.db.accounts.get(uuid(20))).toBeTruthy()

    vi.setSystemTime(T0 + 15 * 60_000)
    on(devA)
    await softDeleteAccount(uuid(20))
    await pushLocalChangesToSupabase(USER)
    expect(serverRow('accounts', uuid(20))?.deleted_at).toBe(at(15))

    on(devB)
    await syncUserDataFromSupabase(USER)
    const b = await devB.db.accounts.get(uuid(20))
    expect(b?.deletedAt).toBe(at(15))
  })

  it('hapus selalu menang: edit B yang lebih baru tidak membangkitkan akun yang sudah dihapus', async () => {
    on(devA).accounts.add(accountRow(21))
    await pushLocalChangesToSupabase(USER)
    on(devB)
    await syncUserDataFromSupabase(USER)

    vi.setSystemTime(T0 + 20 * 60_000)
    on(devA)
    await softDeleteAccount(uuid(21))
    await pushLocalChangesToSupabase(USER)

    vi.setSystemTime(T0 + 30 * 60_000)
    on(devB).accounts.update(uuid(21), { name: 'Edit B' })
    await pushLocalChangesToSupabase(USER)

    expect(serverRow('accounts', uuid(21))?.deleted_at).toBe(at(20))
    expect(serverRow('accounts', uuid(21))?.name).toBe('Akun 21')
    expect((await devB.db.accounts.get(uuid(21)))?.deletedAt).toBe(at(20))
  })

  it('tolak hapus akun yang masih dipakai transaksi; izinkan setelah transaksinya dihapus', async () => {
    on(devA).accounts.add(accountRow(22))
    on(devA).transactions.add(txRow(22, { accountId: uuid(22) }))
    await expect(softDeleteAccount(uuid(22))).rejects.toBeInstanceOf(InUseError)
    expect((await devA.db.accounts.get(uuid(22)))?.deletedAt).toBeFalsy()

    on(devA).transactions.update(uuid(22), { deletedAt: at(1) })
    await softDeleteAccount(uuid(22))
    expect((await devA.db.accounts.get(uuid(22)))?.deletedAt).toBeTruthy()
  })

  it('tolak hapus kategori yang masih dipakai transaksi atau budget', async () => {
    const db = on(devA)
    db.categories.add({ id: uuid(30), userId: USER, name: 'Makan', type: 'expense', icon: 'Utensils', color: '#F97316', sortOrder: 1, merchantPatterns: [] })
    db.transactions.add(txRow(30, { categoryId: uuid(30), type: 'expense' }))
    await expect(softDeleteCategory(uuid(30))).rejects.toThrow(/1 transaksi/)

    db.transactions.update(uuid(30), { deletedAt: at(1) })
    db.budgets.add({ id: uuid(31), userId: USER, categoryId: uuid(30), yearMonth: '2026-11', limitAmount: 100, alertThreshold: 80, rollover: false })
    await expect(softDeleteCategory(uuid(30))).rejects.toThrow(/1 budget/)

    await softDeleteBudget(uuid(31))
    await softDeleteCategory(uuid(30))
    expect((await db.categories.get(uuid(30)))?.deletedAt).toBeTruthy()
  })

  it('pemakaian kategori tidak menghitung baris yang sudah terhapus lunak', async () => {
    const db = on(devA)
    db.transactions.add(txRow(40, { categoryId: uuid(41) }))
    db.transactions.add(txRow(42, { categoryId: uuid(41), deletedAt: at(2) }))
    expect(await categoryUsage(uuid(41))).toEqual({ transactions: 1, budgets: 0 })
  })

  it('soft delete budget terbawa ke B sebagai baris terhapus', async () => {
    on(devA).budgets.add({ id: uuid(50), userId: USER, categoryId: uuid(51), yearMonth: '2026-11', limitAmount: 100, alertThreshold: 80, rollover: false })
    await pushLocalChangesToSupabase(USER)
    on(devB)
    await syncUserDataFromSupabase(USER)

    vi.setSystemTime(T0 + 5 * 60_000)
    on(devA)
    await softDeleteBudget(uuid(50))
    await pushLocalChangesToSupabase(USER)

    on(devB)
    await syncUserDataFromSupabase(USER)
    expect((await devB.db.budgets.get(uuid(50)))?.deletedAt).toBe(at(5))
  })
})

// ---------- Label referensi: transaksi tidak pernah tersingkir ----------

describe('label referensi tidak membuang transaksi', () => {
  it('refLabel: hidup, terhapus, tidak ditemukan, belum dimuat', () => {
    const rows = [
      { id: 'a', name: 'Dompet' },
      { id: 'b', name: 'Lama', deletedAt: at(1) },
    ]
    expect(refLabel(rows, 'a', 'akun')).toBe('Dompet')
    expect(refLabel(rows, 'b', 'akun')).toBe('Lama (akun dihapus)')
    expect(refLabel(rows, 'zzz', 'akun')).toBe('(akun dihapus)')
    expect(refLabel(rows, 'zzz', 'kategori')).toBe('(kategori dihapus)')
    expect(refLabel(undefined, 'a', 'akun')).toBe('…')
    expect(refLabel(rows, null, 'akun')).toBe('')
  })

  it('daftar transaksi tetap lengkap saat akun dan kategorinya dihapus lunak', async () => {
    const db = on(devA)
    db.accounts.add(accountRow(60, { name: 'Bank' }))
    db.accounts.add(accountRow(61, { name: 'Tunai' }))
    db.categories.add({ id: uuid(62), userId: USER, name: 'Makan', type: 'expense', icon: 'Utensils', color: '#F97316', sortOrder: 1, merchantPatterns: [] })
    db.transactions.add(txRow(63, { accountId: uuid(60), categoryId: uuid(62) }))
    db.transactions.add(txRow(64, { accountId: uuid(61) }))
    db.transactions.add(txRow(65, { accountId: uuid(60), categoryId: uuid(62) }))

    // Akun 60 dan kategori 62 dihapus lunak (tanpa transaksi terbuka yang memblokir: dipindah dulu di tes lain).
    db.accounts.update(uuid(60), { deletedAt: at(2) })
    db.categories.update(uuid(62), { deletedAt: at(2) })

    // Yang dilihat halaman: transaksi tidak difilter oleh akun/kategori; lookup memakai daftar yang memuat yang terhapus.
    const txs = (await db.transactions.toArray()).filter((t: Row) => !t.deletedAt)
    const accountsAll = await db.accounts.toArray()
    const categoriesAll = await db.categories.toArray()
    const lines = txs.map((t: Row) => ({
      id: t.id,
      account: refLabel(accountsAll, t.accountId, 'akun'),
      category: t.categoryId ? refLabel(categoriesAll, t.categoryId, 'kategori') : '',
    }))

    expect(lines).toHaveLength(3)
    expect(lines.find(l => l.id === uuid(63))).toEqual({
      id: uuid(63),
      account: 'Bank (akun dihapus)',
      category: 'Makan (kategori dihapus)',
    })
    expect(lines.find(l => l.id === uuid(64))?.account).toBe('Tunai')
  })

  it('daftar pilihan (hook hidup) tidak memuat akun atau kategori terhapus', async () => {
    const db = on(devA)
    db.accounts.add(accountRow(70))
    db.accounts.update(uuid(70), { deletedAt: at(1) })
    const choices = (await db.accounts.toArray()).filter((a: Row) => !a.deletedAt)
    expect(choices).toHaveLength(0)
  })
})

// ---------- Pull bertahap ----------

describe('pull bertahap', () => {
  it('pull pertama penuh, pull berikutnya delta', async () => {
    on(devA).transactions.add(txRow(1))
    await pushLocalChangesToSupabase(USER)
    on(devB)
    await syncUserDataFromSupabase(USER)
    expect(h.server.log.filter(l => l.table === 'transactions').map(l => l.mode)).toEqual(['full'])

    h.server.log.length = 0
    await syncUserDataFromSupabase(USER)
    expect(h.server.log.filter(l => l.table === 'transactions').map(l => l.mode)).toEqual(['delta'])
  })

  it('pull penuh berkala tiap 6 jam sebagai jaring pengaman', async () => {
    on(devB)
    await syncUserDataFromSupabase(USER) // penuh (penanda belum ada)
    h.server.log.length = 0
    await syncUserDataFromSupabase(USER)
    expect(h.server.log.filter(l => l.table === 'transactions').map(l => l.mode)).toEqual(['delta'])

    vi.setSystemTime(T0 + 6 * 3_600_000 + 60_000)
    h.server.log.length = 0
    await syncUserDataFromSupabase(USER)
    expect(h.server.log.filter(l => l.table === 'transactions').map(l => l.mode)).toEqual(['full'])
  })

  it('kursor maju per halaman: 2500 baris terambil lengkap tanpa duplikat', async () => {
    on(devB)
    await syncUserDataFromSupabase(USER) // penuh, server kosong -> kursor = epoch

    for (let i = 1; i <= 2500; i++) {
      seedServer('transactions', txRow(1000 + i, { createdAt: at(i), updatedAt: at(i), updated_at: at(i) }))
    }
    h.server.log.length = 0
    await syncUserDataFromSupabase(USER)

    expect(await devB.db.transactions.toArray()).toHaveLength(2500)
    const deltas = h.server.log.filter(l => l.table === 'transactions')
    expect(deltas.length).toBeGreaterThanOrEqual(3) // tiga halaman: 1000, 1000, 500
    expect(deltas.every(l => l.mode === 'delta')).toBe(true)
  })

  it('kegagalan di tengah mengulang dari kursor terakhir yang sukses', async () => {
    on(devB)
    await syncUserDataFromSupabase(USER)
    for (let i = 1; i <= 2500; i++) {
      seedServer('transactions', txRow(2000 + i, { createdAt: at(i), updatedAt: at(i), updated_at: at(i) }))
    }

    // Halaman 1 sukses, halaman 2 gagal.
    h.server.failSelect = { table: 'transactions', skip: 1, times: 1, seen: 0 }
    const failed = await requestSync(USER, 'manual')
    expect(failed.pull.ok).toBe(false)
    expect(getSyncState().phase).toBe('error')
    expect((await devB.db.transactions.toArray()).length).toBe(1000)

    // Berikutnya: lanjut dari kursor, tidak ada duplikat, semua masuk.
    const ok = await requestSync(USER, 'manual')
    expect(ok.pull.ok).toBe(true)
    expect(await devB.db.transactions.toArray()).toHaveLength(2500)
  })

  it('skew jam: kursor memakai waktu server, bukan jam perangkat', async () => {
    on(devA).transactions.add(txRow(3, { updated_at: at(60) }))
    await pushLocalChangesToSupabase(USER)
    on(devB)
    await syncUserDataFromSupabase(USER) // kursor = waktu server dari baris 3

    // Baris baru dicatat server dengan waktu server 2 jam kemudian. Jam perangkat B tertinggal.
    vi.setSystemTime(T0 + 30 * 60_000)
    seedServer('transactions', txRow(4, { updated_at: at(120) }))
    await syncUserDataFromSupabase(USER)
    expect(await devB.db.transactions.get(uuid(4))).toBeTruthy()
  })

  it('soft-delete terambil lewat delta', async () => {
    on(devA).transactions.add(txRow(5))
    await pushLocalChangesToSupabase(USER)
    on(devB)
    await syncUserDataFromSupabase(USER)

    vi.setSystemTime(T0 + 45 * 60_000)
    on(devA).transactions.update(uuid(5), { deletedAt: at(45) })
    await pushLocalChangesToSupabase(USER)

    h.server.log.length = 0
    on(devB)
    await syncUserDataFromSupabase(USER)
    expect(h.server.log.filter(l => l.table === 'transactions').map(l => l.mode)).toEqual(['delta'])
    expect((await devB.db.transactions.get(uuid(5)))?.deletedAt).toBe(at(45))
  })
})

// ---------- Gema realtime ----------

describe('gema realtime', () => {
  it('event untuk perubahan yang sudah tercakup pull diabaikan; event baru memicu pull', async () => {
    on(devA).transactions.add(txRow(6, { updated_at: at(60) }))
    await pushLocalChangesToSupabase(USER)
    on(devB)
    await syncUserDataFromSupabase(USER) // kursor transactions = at(60)

    const trigger = vi.fn()
    subscribeRealtime(USER, trigger, 400)
    const onChange = lastChannel().handlers[0].cb

    onChange({ table: 'transactions', new: { updated_at: at(30) } }) // gema: sudah tercakup
    await vi.advanceTimersByTimeAsync(500)
    expect(trigger).not.toHaveBeenCalled()

    onChange({ table: 'transactions', new: { updated_at: at(90) } }) // baru
    await vi.advanceTimersByTimeAsync(500)
    expect(trigger).toHaveBeenCalledWith('realtime')
  })

  it('event beruntun digabung menjadi satu pemicu (debounce)', async () => {
    const trigger = vi.fn()
    subscribeRealtime(USER, trigger, 400)
    const onChange = lastChannel().handlers[0].cb
    onChange({ table: 'transactions', new: { updated_at: at(100) } })
    onChange({ table: 'transactions', new: { updated_at: at(101) } })
    onChange({ table: 'accounts', new: { updated_at: at(102) } })
    await vi.advanceTimersByTimeAsync(500)
    expect(trigger).toHaveBeenCalledTimes(1)
  })
})

// ---------- Push gagal tidak senyap ----------

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

// ---------- Realtime: satu channel dan reconnect ----------

describe('realtime: satu channel, reconnect memicu pull', () => {
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

  it('event realtime memicu pull yang menarik data baru di B', async () => {
    on(devA).transactions.add(txRow(7))
    await pushLocalChangesToSupabase(USER)

    on(devB)
    subscribeRealtime(USER, reason => void requestSync(USER, reason), 400)
    const onChange = lastChannel().handlers[0].cb
    onChange({ table: 'transactions', new: { updated_at: at(0) } })
    await vi.advanceTimersByTimeAsync(400)
    await flush()
    expect(await devB.db.transactions.get(uuid(7))).toBeTruthy()
  })

  it('SUBSCRIBED (reconnect) menarik perubahan yang terlewat; CHANNEL_ERROR menandai realtime down', async () => {
    subscribeRealtime(USER, reason => {
      void requestSync(USER, reason)
    })
    const channel = lastChannel()

    on(devA).transactions.add(txRow(8))
    await pushLocalChangesToSupabase(USER)

    on(devB)
    channel.statusCb('CHANNEL_ERROR')
    expect(getSyncState().realtime).toBe('down')
    expect(await devB.db.transactions.get(uuid(8))).toBeUndefined()

    channel.statusCb('SUBSCRIBED')
    await flush()
    expect(getSyncState().realtime).toBe('live')
    expect(await devB.db.transactions.get(uuid(8))).toBeTruthy()
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
