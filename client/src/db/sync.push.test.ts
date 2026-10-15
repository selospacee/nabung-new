/**
 * Contract tests for `pushLocalChangesToSupabase` (src/db/sync.ts).
 *
 * These exist because a clean-looking local entity can still 400 against PostgREST:
 *   - a key that is not a column        -> 400 / PGRST204
 *   - a NOT NULL column with no default -> 400 / 23502
 *   - a CHECK-constrained value off-list -> 400 / 23514
 *
 * The expected schema is the live snapshot in ./__fixtures__/live-schema.ts (the repo's
 * `supabase-schema.sql` is stale — see schema-drift.test.ts), so these assertions fail the
 * moment the push path and the real database disagree.
 *
 * Only the two boundaries are mocked (the Supabase client and Dexie); sync.ts itself is the
 * real module under test.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { LIVE_SCHEMA } from './__fixtures__/live-schema'

const USER = '48fba103-3626-4887-b214-d96617538eb8'
const NOW = '2026-10-15T09:40:00.000Z'
const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`

interface PushCase {
  /** Dexie table name (what sync.ts reads from). */
  dbKey: string
  /** Postgres table name (what sync.ts upserts into). */
  table: string
  entity: Record<string, unknown>
  /** Fields that live only in Dexie and must never reach the wire. */
  junkKeys: string[]
}

const CASES: PushCase[] = [
  {
    dbKey: 'accounts',
    table: 'accounts',
    entity: {
      id: uuid(1),
      userId: USER,
      name: 'Cash',
      type: 'cash',
      currency: 'IDR',
      icon: 'Wallet',
      color: '#10B981',
      createdAt: NOW,
      // `balance` is a real column but is deliberately stripped by the push path
      // (balance is derived from transactions server-side).
      balance: 125_000,
      _synced: true,
    },
    junkKeys: ['balance', '_synced'],
  },
  {
    dbKey: 'categories',
    table: 'categories',
    entity: {
      id: uuid(2),
      userId: USER,
      name: 'Food & Drinks',
      type: 'expense',
      icon: 'Utensils',
      color: '#F59E0B',
      parentId: null,
      sortOrder: 1,
      merchantPatterns: ['cafe', 'makan'],
      dirty: true,
    },
    junkKeys: ['dirty'],
  },
  {
    dbKey: 'transactions',
    table: 'transactions',
    entity: {
      id: uuid(3),
      userId: USER,
      accountId: uuid(1),
      categoryId: uuid(2),
      cashierId: null,
      amount: 50_000,
      currency: 'IDR',
      type: 'expense',
      date: NOW,
      description: 'Kopi',
      merchant: 'Kopi Kenangan',
      notes: '',
      receiptImage: null,
      receiptOcrText: null,
      location: null,
      latitude: null,
      longitude: null,
      createdAt: NOW,
      updatedAt: NOW,
      deletedAt: null,
      passwordHash: 'not-a-column',
    },
    junkKeys: ['passwordHash'],
  },
  {
    dbKey: 'budgets',
    table: 'budgets',
    entity: {
      id: uuid(4),
      userId: USER,
      categoryId: uuid(2),
      yearMonth: '2026-10',
      limitAmount: 1_000_000,
      alertThreshold: 0.8,
      rollover: false,
      createdAt: NOW,
      pending: true,
    },
    junkKeys: ['pending'],
  },
  {
    dbKey: 'goals',
    table: 'savings_goals',
    entity: {
      id: uuid(5),
      userId: USER,
      name: 'Liburan',
      targetAmount: 5_000_000,
      currentAmount: 0,
      targetDate: '2027-01-01',
      color: '#6366F1',
      icon: 'Plane',
      createdAt: NOW,
      time: NOW,
    },
    junkKeys: ['time'],
  },
  {
    dbKey: 'cashiers',
    table: 'cashiers',
    entity: {
      id: uuid(6),
      userId: USER,
      name: 'Budi',
      email: null,
      phone: null,
      role: 'cashier',
      cupCommission: 0,
      baseSalary: 0,
      isActive: true,
      merchantName: null,
      createdAt: NOW,
      updatedAt: NOW,
      localOnlyFlag: true,
    },
    junkKeys: ['localOnlyFlag'],
  },
]

const h = vi.hoisted(() => {
  const upserts: Array<{ table: string; payload: Record<string, unknown> }> = []
  const local: Record<string, Array<Record<string, unknown>>> = {}
  const behavior: { error: unknown; throwFor: string | null } = { error: null, throwFor: null }

  const table = (name: string) => ({
    where: () => ({
      equals: (value: unknown) => ({
        toArray: async () => (local[name] ?? []).filter(row => row.userId === value),
      }),
    }),
  })

  const db = {
    accounts: table('accounts'),
    categories: table('categories'),
    transactions: table('transactions'),
    budgets: table('budgets'),
    goals: table('goals'),
    cashiers: table('cashiers'),
  }

  const supabase = {
    from: (name: string) => ({
      upsert: async (payload: Record<string, unknown>) => {
        upserts.push({ table: name, payload })
        if (behavior.throwFor === name) throw new TypeError('Failed to fetch')
        return { error: behavior.error }
      },
    }),
  }

  return { upserts, local, behavior, db, supabase }
})

vi.mock('./index', () => ({ db: h.db }))
vi.mock('../lib/supabase', () => ({ supabase: h.supabase }))

const { pushLocalChangesToSupabase } = await import('./sync')

const payloadFor = (table: string): Record<string, unknown> => {
  const hit = h.upserts.find(u => u.table === table)
  if (!hit) throw new Error(`no upsert recorded for table "${table}"`)
  return hit.payload
}

beforeEach(() => {
  h.upserts.length = 0
  h.behavior.error = null
  h.behavior.throwFor = null
  for (const key of Object.keys(h.local)) delete h.local[key]
  for (const c of CASES) h.local[c.dbKey] = [{ ...c.entity }]
})

describe.each(CASES)('push payload for $table', (spec) => {
  const live = LIVE_SCHEMA.tables[spec.table]

  beforeEach(async () => {
    await pushLocalChangesToSupabase(USER)
  })

  it('emits only keys that exist as columns in the live schema', () => {
    const payload = payloadFor(spec.table)
    const unknownKeys = Object.keys(payload).filter(key => !(key in live.columns))
    expect(unknownKeys).toEqual([])
  })

  it('sends every NOT NULL column that has no default', () => {
    const payload = payloadFor(spec.table)
    const required = Object.entries(live.columns)
      .filter(([, col]) => col.notNull && !col.hasDefault)
      .map(([name]) => name)
    const missing = required.filter(name => !(name in payload) || payload[name] === undefined)
    expect(missing).toEqual([])
  })

  it('keeps CHECK-constrained values inside the allowed list', () => {
    const payload = payloadFor(spec.table)
    for (const [column, allowed] of Object.entries(live.checks)) {
      expect(payload).toHaveProperty(column)
      expect(allowed).toContain(payload[column])
    }
  })

  it('stamps user_id with the caller-supplied user, not the local row', () => {
    expect(payloadFor(spec.table).user_id).toBe(USER)
  })

  it('strips Dexie-only fields before upserting', () => {
    const payload = payloadFor(spec.table)
    for (const junk of spec.junkKeys) {
      expect(Object.keys(payload)).not.toContain(junk)
    }
  })

  it('maps every camelCase local key to a snake_case column', () => {
    const payload = payloadFor(spec.table)
    const camelLeftovers = Object.keys(payload).filter(key => /[A-Z]/.test(key))
    expect(camelLeftovers).toEqual([])
  })
})

describe('push error handling', () => {
  it('resolves with success:false and a formatted error instead of throwing on a PostgREST 400', async () => {
    // The real production error from the accounts upsert (SQLSTATE 42703).
    h.behavior.error = {
      message: 'column "updated_at" of relation "accounts" does not exist',
      code: '42703',
      details: null,
      hint: null,
    }

    const result = await pushLocalChangesToSupabase(USER)

    expect(result.success).toBe(false)
    expect(result.errors).toHaveLength(6)
    const accountsError = result.errors.find(e => e.table === 'accounts')
    expect(accountsError?.message).toContain('does not exist')
    expect(accountsError?.message).toContain('code:42703')
  })

  it('carries details and hint through when PostgREST supplies them', async () => {
    h.behavior.error = {
      message: 'new row violates check constraint "accounts_type_check"',
      code: '23514',
      details: 'Failing row contains (e-wallet).',
      hint: 'check the type list',
    }

    const result = await pushLocalChangesToSupabase(USER)

    expect(result.errors[0].message).toContain('code:23514')
    expect(result.errors[0].message).toContain('details:Failing row contains')
    expect(result.errors[0].message).toContain('hint:check the type list')
  })

  it('reports success:true when every table accepts its payload', async () => {
    const result = await pushLocalChangesToSupabase(USER)

    expect(result).toEqual({ success: true, errors: [] })
    expect(h.upserts).toHaveLength(6)
  })

  it('does not reject when the transport itself throws', async () => {
    h.behavior.throwFor = 'accounts'

    const result = await pushLocalChangesToSupabase(USER)

    expect(result.success).toBe(false)
    expect(result.errors[0].message).toContain('Failed to fetch')
    // Documented current behaviour: a transport-level throw aborts the remaining tables for
    // this cycle (they are retried on the next push), it is not per-table isolated.
    expect(h.upserts.map(u => u.table)).toEqual(['accounts'])
  })

  it('rejects an empty or missing userId instead of writing unscoped rows', async () => {
    await expect(pushLocalChangesToSupabase('')).rejects.toThrow(/Invalid userId/)
    await expect(pushLocalChangesToSupabase(undefined as unknown as string)).rejects.toThrow(
      /Invalid userId/,
    )
    expect(h.upserts).toHaveLength(0)
  })
})
