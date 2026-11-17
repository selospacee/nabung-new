/**
 * Tes pull (`syncUserDataFromSupabase`) untuk transaksi dan budget:
 *   - transaksi dipaginasi (PostgREST membatasi 1000 baris per request),
 *   - baris soft-delete ikut ditarik supaya penghapusan sampai ke perangkat lain,
 *   - last-write-wins per updatedAt: edit lokal yang lebih baru tidak ditimpa server.
 *
 * Hanya dua batas yang di-mock (klien Supabase dan Dexie); sync.ts adalah modul asli.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'

const USER = '48fba103-3626-4887-b214-d96617538eb8'
const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`

const h = vi.hoisted(() => {
  const remote: Record<string, Array<Record<string, any>>> = {}
  const rangeCalls: Array<{ table: string; from: number; to: number }> = []
  const session: { user: { id: string } | null } = { user: null }
  const store: Record<string, Map<string, Record<string, any>>> = {
    transactions: new Map(),
    budgets: new Map(),
  }

  const noop = async () => undefined
  const dexieTable = (name: string) => ({
    bulkGet: async (ids: string[]) => ids.map(id => store[name]?.get(id)),
    bulkPut: async (rows: Array<Record<string, any>>) => {
      for (const r of rows) store[name]?.set(r.id, r)
    },
    put: async (row: Record<string, any>) => {
      store[name]?.set(row.id, row)
    },
    toArray: async () => Array.from(store[name]?.values() ?? []),
    where: (index: string) => ({
      equals: (value: unknown) => ({
        toArray: async () => Array.from(store[name]?.values() ?? []).filter(r => r[index] === value),
      }),
    }),
  })
  const db = {
    transaction: async (_mode: string, _tables: unknown, fn: (tx: object) => unknown) => fn({}),
    // Penanda pull bertahap: kosong = pull penuh.
    syncMeta: { get: async () => undefined, put: async () => {} },
    users: { put: noop },
    accounts: { bulkPut: noop },
    categories: { bulkPut: noop },
    goals: { bulkPut: noop },
    cashiers: { bulkPut: noop },
    transactions: dexieTable('transactions'),
    budgets: dexieTable('budgets'),
  }

  const builder = (table: string) => {
    let from = 0
    let to = Infinity
    let range = false
    const rows = () => {
      const all = remote[table] ?? []
      return range ? all.slice(from, to + 1) : all
    }
    const q: any = {
      select: () => q,
      eq: () => q,
      order: () => q,
      single: async () => ({ data: null, error: null }),
      range: (f: number, t: number) => {
        from = f
        to = t
        range = true
        rangeCalls.push({ table, from: f, to: t })
        return q
      },
      then: (onFulfilled: any, onRejected: any) =>
        Promise.resolve({ data: rows(), error: null }).then(onFulfilled, onRejected),
    }
    return q
  }

  const supabase = {
    auth: { getSession: async () => ({ data: { session: session.user ? { user: session.user } : null }, error: null }) },
    from: (table: string) => builder(table),
  }

  return { remote, rangeCalls, session, store, db, supabase }
})

vi.mock('./index', () => ({ db: h.db }))
vi.mock('../lib/supabase', () => ({ supabase: h.supabase }))

const { syncUserDataFromSupabase } = await import('./sync')

const serverTx = (n: number, overrides: Record<string, unknown> = {}) => ({
  id: uuid(n),
  user_id: USER,
  account_id: uuid(900),
  category_id: null,
  cashier_id: null,
  amount: 50000,
  currency: 'IDR',
  type: 'expense',
  date: '2026-10-15T00:00:00+00:00',
  description: `tx ${n}`,
  merchant: '',
  notes: '',
  receipt_image: null,
  receipt_ocr_text: null,
  location: null,
  latitude: null,
  longitude: null,
  created_at: '2026-10-15T08:00:00.000Z',
  updated_at: '2026-10-15T08:00:00.000Z',
  deleted_at: null,
  ...overrides,
})

const localTx = (n: number, updatedAt: string, overrides: Record<string, unknown> = {}) => ({
  id: uuid(n),
  userId: USER,
  accountId: uuid(900),
  categoryId: null,
  cashierId: null,
  amount: 75000,
  currency: 'IDR',
  type: 'expense',
  date: '2026-10-15',
  description: 'lokal',
  merchant: '',
  notes: '',
  receiptImage: null,
  receiptOcrText: null,
  location: null,
  latitude: null,
  longitude: null,
  createdAt: '2026-10-15T08:00:00.000Z',
  updatedAt,
  deletedAt: null,
  ...overrides,
})

beforeEach(() => {
  for (const k of Object.keys(h.remote)) delete h.remote[k]
  h.rangeCalls.length = 0
  h.session.user = { id: USER }
  h.store.transactions.clear()
  h.store.budgets.clear()
})

describe('pull transaksi', () => {
  it('mengambil semua halaman ketika baris lebih dari satu halaman (1000)', async () => {
    h.remote.transactions = Array.from({ length: 1003 }, (_, i) => serverTx(i + 1))

    await syncUserDataFromSupabase(USER)

    expect(h.rangeCalls.filter(c => c.table === 'transactions')).toEqual([
      { table: 'transactions', from: 0, to: 999 },
      { table: 'transactions', from: 1000, to: 1999 },
    ])
    expect(h.store.transactions.size).toBe(1003)
  })

  it('ikut menarik baris soft-delete dan memetakan deletedAt', async () => {
    h.remote.transactions = [
      serverTx(1),
      serverTx(2, { deleted_at: '2026-10-16T10:00:00.000Z', updated_at: '2026-10-16T10:00:00.000Z' }),
    ]

    await syncUserDataFromSupabase(USER)

    expect(h.store.transactions.get(uuid(2))?.deletedAt).toBe('2026-10-16T10:00:00.000Z')
    expect(h.store.transactions.get(uuid(1))?.deletedAt).toBeNull()
  })

  it('menormalkan date timestamptz menjadi YYYY-MM-DD dan mengubah amount menjadi number', async () => {
    h.remote.transactions = [serverTx(1, { amount: '50000.00' })]

    await syncUserDataFromSupabase(USER)

    const t = h.store.transactions.get(uuid(1))!
    expect(t.date).toBe('2026-10-15')
    expect(t.amount).toBe(50000)
  })

  it('last-write-wins: edit lokal yang lebih baru tidak ditimpa server', async () => {
    h.store.transactions.set(uuid(1), localTx(1, '2026-10-20T12:00:00.000Z'))
    h.remote.transactions = [serverTx(1, { updated_at: '2026-10-18T12:00:00.000Z', description: 'dari server' })]

    await syncUserDataFromSupabase(USER)

    expect(h.store.transactions.get(uuid(1))?.description).toBe('lokal')
  })

  it('last-write-wins: versi server yang lebih baru menimpa salinan lokal yang lama', async () => {
    h.store.transactions.set(uuid(1), localTx(1, '2026-10-18T12:00:00.000Z'))
    h.remote.transactions = [serverTx(1, { updated_at: '2026-10-20T12:00:00.000Z', description: 'dari server' })]

    await syncUserDataFromSupabase(USER)

    expect(h.store.transactions.get(uuid(1))?.description).toBe('dari server')
  })
})

describe('pull budget (last-write-wins)', () => {
  const budget = (id: string, updatedAt: string, limit: number) => ({
    id, user_id: USER, category_id: uuid(50), year_month: '2026-10',
    limit_amount: limit, alert_threshold: 80, rollover: false,
    created_at: '2026-10-01T00:00:00.000Z', updated_at: updatedAt,
  })
  const localBudget = (id: string, updatedAt: string, limit: number) => ({
    id, userId: USER, categoryId: uuid(50), yearMonth: '2026-10',
    limitAmount: limit, alertThreshold: 80, rollover: false,
    createdAt: '2026-10-01T00:00:00.000Z', updatedAt,
  })

  it('edit lokal yang lebih baru dipertahankan', async () => {
    h.store.budgets.set(uuid(70), localBudget(uuid(70), '2026-10-20T00:00:00.000Z', 900000))
    h.remote.budgets = [budget(uuid(70), '2026-10-10T00:00:00.000Z', 500000)]

    await syncUserDataFromSupabase(USER)

    expect(h.store.budgets.get(uuid(70))?.limitAmount).toBe(900000)
  })

  it('versi server yang lebih baru menimpa budget lokal', async () => {
    h.store.budgets.set(uuid(70), localBudget(uuid(70), '2026-10-10T00:00:00.000Z', 900000))
    h.remote.budgets = [budget(uuid(70), '2026-10-20T00:00:00.000Z', 500000)]

    await syncUserDataFromSupabase(USER)

    expect(h.store.budgets.get(uuid(70))?.limitAmount).toBe(500000)
  })
})
