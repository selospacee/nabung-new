/**
 * Snapshot of the LIVE Supabase schema for project `lyhemujxjphuyohyckvw` ("Nabung"),
 * captured 2026-10-15.
 *
 * Why a snapshot instead of parsing `supabase-schema.sql`: the repo's .sql file is stale
 * (it is missing the whole `cashiers` table and `transactions.cashier_id`), so asserting
 * the push payload against it would validate against the wrong contract. See
 * `src/db/schema-drift.test.ts` for the .sql-vs-live drift checks and `docs/testing.md`
 * for the regeneration query.
 *
 * `notNull` + `hasDefault` are the two facts the push path needs:
 *   - a column that is NOT NULL with NO default MUST be present in every upsert payload,
 *     otherwise PostgREST answers 400 / SQLSTATE 23502.
 *   - any key that is NOT a column here makes PostgREST answer 400 / PGRST204.
 */

export interface LiveColumn {
  notNull: boolean
  hasDefault: boolean
}

export interface LiveTable {
  columns: Record<string, LiveColumn>
  /** CHECK constraints that constrain a value the client writes (enum-like columns). */
  checks: Record<string, string[]>
}

export interface LiveSchema {
  projectRef: string
  capturedAt: string
  tables: Record<string, LiveTable>
}

export const LIVE_SCHEMA: LiveSchema = {
  projectRef: 'lyhemujxjphuyohyckvw',
  capturedAt: '2026-10-15T09:45:00Z',
  tables: {
    accounts: {
      columns: {
        id: { notNull: true, hasDefault: true },
        user_id: { notNull: true, hasDefault: false },
        name: { notNull: true, hasDefault: false },
        type: { notNull: true, hasDefault: false },
        balance: { notNull: false, hasDefault: true },
        currency: { notNull: false, hasDefault: true },
        icon: { notNull: false, hasDefault: false },
        color: { notNull: false, hasDefault: false },
        created_at: { notNull: false, hasDefault: true },
      },
      checks: { type: ['cash', 'bank', 'credit', 'investment'] },
    },
    categories: {
      columns: {
        id: { notNull: true, hasDefault: true },
        user_id: { notNull: true, hasDefault: false },
        name: { notNull: true, hasDefault: false },
        type: { notNull: true, hasDefault: false },
        icon: { notNull: false, hasDefault: false },
        color: { notNull: false, hasDefault: false },
        parent_id: { notNull: false, hasDefault: false },
        sort_order: { notNull: false, hasDefault: true },
        merchant_patterns: { notNull: false, hasDefault: true },
        created_at: { notNull: false, hasDefault: true },
      },
      checks: { type: ['income', 'expense', 'transfer'] },
    },
    transactions: {
      columns: {
        id: { notNull: true, hasDefault: true },
        user_id: { notNull: true, hasDefault: false },
        account_id: { notNull: true, hasDefault: false },
        category_id: { notNull: false, hasDefault: false },
        cashier_id: { notNull: false, hasDefault: false },
        amount: { notNull: true, hasDefault: false },
        currency: { notNull: false, hasDefault: true },
        type: { notNull: true, hasDefault: false },
        date: { notNull: true, hasDefault: false },
        description: { notNull: false, hasDefault: false },
        merchant: { notNull: false, hasDefault: false },
        notes: { notNull: false, hasDefault: false },
        receipt_image: { notNull: false, hasDefault: false },
        receipt_ocr_text: { notNull: false, hasDefault: false },
        location: { notNull: false, hasDefault: false },
        latitude: { notNull: false, hasDefault: false },
        longitude: { notNull: false, hasDefault: false },
        created_at: { notNull: false, hasDefault: true },
        updated_at: { notNull: false, hasDefault: true },
        deleted_at: { notNull: false, hasDefault: false },
      },
      checks: { type: ['income', 'expense', 'transfer'] },
    },
    budgets: {
      columns: {
        id: { notNull: true, hasDefault: true },
        user_id: { notNull: true, hasDefault: false },
        category_id: { notNull: true, hasDefault: false },
        year_month: { notNull: true, hasDefault: false },
        limit_amount: { notNull: true, hasDefault: false },
        alert_threshold: { notNull: false, hasDefault: true },
        rollover: { notNull: false, hasDefault: true },
        created_at: { notNull: false, hasDefault: true },
      },
      checks: {},
    },
    savings_goals: {
      columns: {
        id: { notNull: true, hasDefault: true },
        user_id: { notNull: true, hasDefault: false },
        name: { notNull: true, hasDefault: false },
        target_amount: { notNull: true, hasDefault: false },
        current_amount: { notNull: false, hasDefault: true },
        target_date: { notNull: true, hasDefault: false },
        color: { notNull: false, hasDefault: false },
        icon: { notNull: false, hasDefault: false },
        created_at: { notNull: false, hasDefault: true },
      },
      checks: {},
    },
    cashiers: {
      columns: {
        id: { notNull: true, hasDefault: true },
        user_id: { notNull: true, hasDefault: false },
        name: { notNull: true, hasDefault: false },
        email: { notNull: false, hasDefault: false },
        phone: { notNull: false, hasDefault: false },
        role: { notNull: true, hasDefault: true },
        cup_commission: { notNull: false, hasDefault: true },
        base_salary: { notNull: false, hasDefault: true },
        is_active: { notNull: false, hasDefault: true },
        merchant_name: { notNull: false, hasDefault: false },
        created_at: { notNull: false, hasDefault: true },
        updated_at: { notNull: false, hasDefault: true },
      },
      checks: { role: ['cashier', 'admin', 'manager'] },
    },
    profiles: {
      columns: {
        id: { notNull: true, hasDefault: false },
        email: { notNull: true, hasDefault: false },
        name: { notNull: true, hasDefault: false },
        currency: { notNull: false, hasDefault: true },
        timezone: { notNull: false, hasDefault: true },
        theme: { notNull: false, hasDefault: true },
        default_account_id: { notNull: false, hasDefault: false },
        created_at: { notNull: false, hasDefault: true },
        updated_at: { notNull: false, hasDefault: true },
      },
      checks: { theme: ['dark', 'light', 'system'] },
    },
    user_settings: {
      columns: {
        user_id: { notNull: true, hasDefault: false },
        is_onboarded: { notNull: false, hasDefault: true },
        created_at: { notNull: false, hasDefault: true },
        updated_at: { notNull: false, hasDefault: true },
      },
      checks: {},
    },
  },
}

/** Tables `pushLocalChangesToSupabase` writes to, keyed by the Dexie table name. */
export const PUSH_TABLE_BY_DB_KEY: Record<string, string> = {
  accounts: 'accounts',
  categories: 'categories',
  transactions: 'transactions',
  budgets: 'budgets',
  goals: 'savings_goals',
  cashiers: 'cashiers',
}
