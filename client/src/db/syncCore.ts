/**
 * Operasi mentah pull dan push. Jangan dipanggil langsung dari luar: gunakan `sync.ts`, yang
 * memastikan pull dan push tidak pernah berjalan bersamaan (satu antrean).
 */
import type { Table } from 'dexie'
import { supabase } from '../lib/supabase'
import { db } from './index'
import { markRemoteTx } from './stamps'
import { bumpConflicts } from './syncStatus'
import type { Transaction, User } from '../types'

type Row = Record<string, any>
type LocalTable = Table<Row, string>

export interface SyncTableSpec {
  /** Nama tabel Dexie. */
  dexie: 'accounts' | 'categories' | 'transactions' | 'budgets' | 'goals' | 'cashiers'
  /** Nama tabel di Postgres. */
  remote: string
}

export const SYNC_TABLES: readonly SyncTableSpec[] = [
  { dexie: 'accounts', remote: 'accounts' },
  { dexie: 'categories', remote: 'categories' },
  { dexie: 'transactions', remote: 'transactions' },
  { dexie: 'budgets', remote: 'budgets' },
  { dexie: 'goals', remote: 'savings_goals' },
  { dexie: 'cashiers', remote: 'cashiers' },
]

export interface PushError {
  table: string
  message: string
}

export interface PushResult {
  success: boolean
  errors: PushError[]
}

// Helper to convert snake_case to camelCase
function toCamelCase(obj: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(obj)) {
    const camelKey = key.replace(/_([a-z])/g, (_, letter) => letter.toUpperCase())
    result[camelKey] = value
  }
  return result
}

// Helper to convert camelCase to snake_case
function toSnakeCase(obj: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(obj)) {
    const snakeKey = key.replace(/[A-Z]/g, letter => `_${letter.toLowerCase()}`)
    result[snakeKey] = value
  }
  return result
}

/** true bila `a` (ISO) lebih baru daripada `b`. Nilai kosong atau tidak valid dianggap paling lama. */
export function isNewer(a: string | null | undefined, b: string | null | undefined): boolean {
  const ta = a ? Date.parse(a) : NaN
  const tb = b ? Date.parse(b) : NaN
  if (Number.isNaN(ta)) return false
  if (Number.isNaN(tb)) return true
  return ta > tb
}

// PostgREST returns at most 1000 rows per request, so page through the table.
// Ordering by id keeps the pages stable.
async function fetchAllRows(table: string, userId: string): Promise<Row[]> {
  const PAGE = 1000
  const rows: Row[] = []
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase
      .from(table)
      .select('*')
      .eq('user_id', userId)
      .order('id', { ascending: true })
      .range(from, from + PAGE - 1)
    if (error) throw error
    rows.push(...(data || []))
    if (!data || data.length < PAGE) break
  }
  return rows
}

// Server dates are timestamptz; local code uses 'YYYY-MM-DD'.
function mapTransactionRow(row: Row): Transaction {
  const t = toCamelCase(row) as unknown as Transaction
  return {
    ...t,
    date: typeof row.date === 'string' ? row.date.slice(0, 10) : t.date,
    amount: Number(row.amount),
    latitude: row.latitude == null ? null : Number(row.latitude),
    longitude: row.longitude == null ? null : Number(row.longitude),
    cashierId: row.cashier_id ?? null,
    categoryId: row.category_id ?? null,
    description: row.description ?? '',
    merchant: row.merchant ?? '',
    notes: row.notes ?? '',
    receiptImage: row.receipt_image ?? null,
    receiptOcrText: row.receipt_ocr_text ?? null,
    location: row.location ?? null,
    createdAt: row.created_at ?? new Date().toISOString(),
    updatedAt: row.updated_at ?? row.created_at ?? new Date().toISOString(),
    deletedAt: row.deleted_at ?? null,
  }
}

function serverRowToLocal(spec: SyncTableSpec, row: Row): Row {
  const local: Row = spec.dexie === 'transactions' ? { ...mapTransactionRow(row) } : { ...toCamelCase(row) }
  // Baris dari server adalah sumber kebenaran pada saat diterima: tidak dirty.
  local._dirty = 0
  return local
}

export function validateUserId(userId: unknown): asserts userId is string {
  if (!userId || typeof userId !== 'string' || userId.trim() === '') {
    throw new Error('[Sync] Invalid userId: must be a non-empty string')
  }
}

/**
 * Terapkan baris dari server ke Dexie di dalam transaksi remote (tanpa menyentuh stempel).
 * Last-write-wins: baris lokal yang lebih baru dipertahankan. Mengembalikan jumlah konflik
 * (baris lokal yang belum terkirim dan kalah oleh server atau dipertahankan).
 */
async function applyRemoteRows(spec: SyncTableSpec, rows: Row[]): Promise<number> {
  if (rows.length === 0) return 0
  const table = db[spec.dexie] as unknown as LocalTable
  let conflicts = 0
  await db.transaction('rw', table, async tx => {
    markRemoteTx(tx)
    const localById = new Map(
      (await table.bulkGet(rows.map(r => r.id as string)))
        .filter((l): l is Row => !!l)
        .map(l => [l.id as string, l] as const),
    )
    const toPut: Row[] = []
    for (const row of rows) {
      const remote = serverRowToLocal(spec, row)
      const local = localById.get(remote.id)
      if (local && isNewer(local.updatedAt, remote.updatedAt)) {
        if (local._dirty === 1) conflicts++
        continue
      }
      toPut.push(remote)
    }
    if (toPut.length > 0) await table.bulkPut(toPut)
  })
  return conflicts
}

export interface PullResult {
  conflicts: number
}

export async function pullFromServer(userId: string): Promise<PullResult> {
  validateUserId(userId)

  // Get session - if not ready, don't throw, just return (will retry on auth state change)
  const { data: { session } } = await supabase.auth.getSession()
  if (!session?.user) {
    console.log('[Sync] No session yet, will retry on auth state change')
    return { conflicts: 0 }
  }
  if (session.user.id !== userId) {
    const msg = `Auth mismatch: session user (${session.user.id}) !== sync userId (${userId})`
    console.error('[Sync]', msg)
    throw new Error(msg)
  }

  let conflicts = 0
  // 1. Profile (pull only; profiles are not pushed from this client)
  const { data: profile, error: profileError } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', userId)
    .single()
  if (profileError && profileError.code !== 'PGRST116' && !profileError.message?.includes('406')) throw profileError
  if (profile) {
    const userData = toCamelCase(profile) as unknown as User
    const user = {
      ...userData,
      passwordHash: userData.passwordHash || '',
      time: userData.time || userData.createdAt || new Date().toISOString(),
    }
    // users tidak memiliki hook stempel, jadi penulisan langsung cukup.
    await db.users.put(user)
  }

  // 2. Tabel yang disinkronkan (termasuk baris soft-delete supaya penghapusan sampai ke perangkat lain)
  for (const spec of SYNC_TABLES) {
    const rows = await fetchAllRows(spec.remote, userId)
    conflicts += await applyRemoteRows(spec, rows)
  }

  if (conflicts > 0) bumpConflicts(conflicts)
  return { conflicts }
}

// Allowed keys per table to prevent 400 from unknown fields
const ALLOWED_KEYS: Record<string, string[]> = {
  accounts: ['id', 'user_id', 'name', 'type', 'currency', 'icon', 'color', 'created_at', 'updated_at'],
  categories: ['id', 'user_id', 'name', 'type', 'icon', 'color', 'parent_id', 'sort_order', 'merchant_patterns', 'updated_at'],
  transactions: ['id', 'user_id', 'account_id', 'category_id', 'cashier_id', 'amount', 'currency', 'type', 'date', 'description', 'merchant', 'notes', 'receipt_image', 'receipt_ocr_text', 'location', 'latitude', 'longitude', 'created_at', 'updated_at', 'deleted_at'],
  budgets: ['id', 'user_id', 'category_id', 'year_month', 'limit_amount', 'alert_threshold', 'rollover', 'created_at', 'updated_at'],
  savings_goals: ['id', 'user_id', 'name', 'target_amount', 'current_amount', 'target_date', 'color', 'icon', 'created_at', 'updated_at'],
  cashiers: ['id', 'user_id', 'name', 'email', 'phone', 'role', 'cup_commission', 'base_salary', 'is_active', 'merchant_name', 'created_at', 'updated_at'],
}

function stripToAllowedKeys(obj: Record<string, unknown>, table: string): Record<string, unknown> {
  const allowed = ALLOWED_KEYS[table]
  if (!allowed) return obj
  const result: Record<string, unknown> = {}
  for (const key of allowed) {
    if (key in obj) result[key] = obj[key]
  }
  return result
}

export function formatSupabaseError(error: any): string {
  if (!error) return 'Unknown error'
  const parts: string[] = []
  if (error.message) parts.push(error.message)
  if (error.code) parts.push(`code:${error.code}`)
  if (error.details) parts.push(`details:${error.details}`)
  if (error.hint) parts.push(`hint:${error.hint}`)
  return parts.length > 0 ? parts.join(' | ') : JSON.stringify(error)
}

function toPayload(spec: SyncTableSpec, local: Row, userId: string): Record<string, unknown> {
  const snake = toSnakeCase(local)
  snake.user_id = userId
  // balance is derived from transactions server-side; never send it.
  if (spec.dexie === 'accounts') delete snake.balance
  return stripToAllowedKeys(snake, spec.remote)
}

async function dirtyRows(spec: SyncTableSpec, userId: string): Promise<Row[]> {
  const rows = await (db[spec.dexie] as unknown as LocalTable).where('_dirty').equals(1).toArray()
  return rows.filter(r => r.userId === userId)
}

/** Versi server untuk sekumpulan id, dibaca per 100 id agar URL tidak terlalu panjang. */
async function fetchServerVersions(spec: SyncTableSpec, userId: string, ids: string[]): Promise<Map<string, Row>> {
  const out = new Map<string, Row>()
  for (let i = 0; i < ids.length; i += 100) {
    const chunk = ids.slice(i, i + 100)
    const { data, error } = await supabase.from(spec.remote).select('*').eq('user_id', userId).in('id', chunk)
    if (error) throw error
    for (const row of (data ?? []) as Row[]) out.set(row.id as string, row)
  }
  return out
}

/** Tandai baris bersih, hanya bila tidak diubah lagi selama push berjalan. */
async function markClean(spec: SyncTableSpec, local: Row): Promise<void> {
  const table = db[spec.dexie] as unknown as LocalTable
  const current = await table.get(local.id as string)
  if (current && current.updatedAt === local.updatedAt) {
    await table.update(local.id as string, { _dirty: 0 })
  }
}

export async function pushToServer(userId: string): Promise<PushResult> {
  validateUserId(userId)

  // Get session - if not ready, return error (will retry on auth state change)
  const { data: { session } } = await supabase.auth.getSession()
  if (!session?.user) {
    console.log('[Sync] No session yet, will retry on auth state change')
    return { success: false, errors: [{ table: 'auth', message: 'No session available' }] }
  }
  if (session.user.id !== userId) {
    const msg = `Auth mismatch: session user (${session.user.id}) !== push userId (${userId})`
    console.error('[Sync]', msg)
    return { success: false, errors: [{ table: 'auth', message: msg }] }
  }

  const errors: PushError[] = []
  try {
    for (const spec of SYNC_TABLES) {
      const dirty = await dirtyRows(spec, userId)
      if (dirty.length === 0) continue
      const server = await fetchServerVersions(spec, userId, dirty.map(r => r.id as string))

      for (const local of dirty) {
        // LWW dua arah: jangan pernah menimpa versi server yang lebih baru (misalnya dari perangkat lain).
        // Terapkan versi server dan buang salinan lokal yang usang.
        const remoteRow = server.get(local.id as string)
        if (remoteRow && isNewer(remoteRow.updated_at, local.updatedAt)) {
          await applyRemoteRows(spec, [remoteRow])
          bumpConflicts(1)
          continue
        }

        const payload = toPayload(spec, local, userId)
        if (spec.dexie === 'budgets') {
          // One budget per (user, category, month). If the server already has that row under another id
          // (e.g. created on another device), update it and adopt its id locally instead of failing with 409.
          const { data: saved, error } = await supabase
            .from('budgets')
            .upsert(payload, { onConflict: 'user_id,category_id,year_month' })
            .select('id')
            .single()
          if (error) {
            const message = formatSupabaseError(error)
            console.error('[Sync] Push budget error:', message)
            errors.push({ table: 'budgets', message })
            continue
          }
          if (saved?.id && saved.id !== local.id) {
            const budgets = db.budgets as unknown as LocalTable
            await db.transaction('rw', budgets, async tx => {
              markRemoteTx(tx)
              await budgets.delete(local.id as string)
              await budgets.put({ ...local, id: saved.id as string, _dirty: 0 })
            })
            continue
          }
        } else {
          const { error } = await supabase.from(spec.remote).upsert(payload, { onConflict: 'id' })
          if (error) {
            const message = formatSupabaseError(error)
            console.error('[Sync] Push', spec.remote, 'error:', message)
            errors.push({ table: spec.remote, message })
            continue
          }
        }
        await markClean(spec, local)
      }
    }
    console.log('[Sync] Push complete for user:', userId, errors.length > 0 ? `( ${errors.length} errors )` : '(ok)')
    return { success: errors.length === 0, errors }
  } catch (error) {
    const message = formatSupabaseError(error)
    console.error('[Sync] Push unexpected error:', message)
    return { success: false, errors: [...errors, { table: 'unknown', message }] }
  }
}

/** Jumlah baris lokal milik user yang belum terkirim. */
export async function countPending(userId: string): Promise<number> {
  let total = 0
  for (const spec of SYNC_TABLES) {
    total += (await dirtyRows(spec, userId)).length
  }
  return total
}
