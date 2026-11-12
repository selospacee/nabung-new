/**
 * Lapisan data Nabung Bareng: fungsi tipis di atas Supabase (RPC, tabel, view).
 *
 * Aturan (lihat docs/shared-savings-schema.md):
 * - Query kontribusi selalu `deleted_at IS NULL`.
 * - `contributed_at` selalu dikirim eksplisit sebagai tanggal lokal (YYYY-MM-DD).
 * - `user_id` kontribusi dan `created_by` goal diambil dari session, tidak dari input.
 * - UPDATE/DELETE memakai `.select()`; hasil kosong = PERMISSION_DENIED.
 * - INSERT yang ditolak RLS (SQLSTATE 42501) = PERMISSION_DENIED.
 * - Kode galat RPC dipetakan ke `SharedSavingsError` dengan pesan Indonesia.
 *   Pesan SQL mentah tidak pernah diteruskan ke UI.
 *
 * Tidak mengimpor apa pun dari `db/` (Dexie).
 */
import { supabase } from './supabase'
import {
  mapContribution,
  mapGoalParticipant,
  mapGoalProgress,
  mapGroup,
  mapGroupActivity,
  mapGroupGoal,
  mapGroupMember,
  toCents,
  type Contribution,
  type ContributionRow,
  type Group,
  type GroupActivity,
  type GroupGoal,
  type GroupGoalRow,
  type GroupMember,
  type GroupMemberNameRow,
  type GroupRow,
  type GroupType,
  type GoalParticipant,
  type GoalParticipantRow,
  type GoalProgress,
  type GoalProgressRow,
  type GoalStatus,
  type GroupActivityRow,
} from '../types/shared'

// ---------------------------------------------------------------------------
// Galat
// ---------------------------------------------------------------------------

const RPC_ERROR_CODES = [
  'NOT_AUTHENTICATED',
  'INVALID_NAME',
  'INVALID_TYPE',
  'INVITE_INVALID',
  'ALREADY_MEMBER',
  'GROUP_FULL',
  'NOT_MEMBER',
  'NOT_OWNER',
  'OWNER_CANNOT_LEAVE',
  'SAME_USER',
  'CONTRIBUTION_DELETED',
] as const

/** Kode dari server (RPC/trigger) + kode lokal client. */
export type SharedSavingsErrorCode =
  | (typeof RPC_ERROR_CODES)[number]
  | 'PERMISSION_DENIED'
  | 'INVALID_AMOUNT'
  | 'INVALID_DATE'
  | 'UNKNOWN'

const MESSAGES: Record<SharedSavingsErrorCode, string> = {
  NOT_AUTHENTICATED: 'Kamu perlu masuk terlebih dahulu.',
  INVALID_NAME: 'Nama grup tidak valid.',
  INVALID_TYPE: 'Jenis grup tidak valid.',
  INVITE_INVALID: 'Kode undangan tidak ditemukan. Periksa kembali kodenya.',
  ALREADY_MEMBER: 'Kamu sudah menjadi anggota grup ini.',
  GROUP_FULL: 'Grup sudah penuh.',
  NOT_MEMBER: 'Kamu bukan anggota grup ini.',
  NOT_OWNER: 'Hanya pemilik grup yang bisa melakukan ini.',
  OWNER_CANNOT_LEAVE: 'Pemilik tidak bisa keluar selama masih ada anggota lain. Pindahkan kepemilikan dulu.',
  SAME_USER: 'Tidak bisa memindahkan kepemilikan ke diri sendiri.',
  CONTRIBUTION_DELETED: 'Setoran ini sudah dihapus dan tidak bisa dipulihkan.',
  PERMISSION_DENIED: 'Kamu tidak punya izin untuk melakukan ini.',
  INVALID_AMOUNT: 'Nominal harus bilangan bulat lebih dari 0.',
  INVALID_DATE: 'Format tanggal harus YYYY-MM-DD.',
  UNKNOWN: 'Terjadi kesalahan. Coba lagi beberapa saat.',
}

export class SharedSavingsError extends Error {
  readonly code: SharedSavingsErrorCode

  constructor(code: SharedSavingsErrorCode, message?: string, options?: { cause?: unknown }) {
    super(message ?? MESSAGES[code], options)
    this.name = 'SharedSavingsError'
    this.code = code
  }
}

/**
 * Memetakan galat apa pun (PostgREST, RPC, trigger, mapper) ke SharedSavingsError.
 * Pesan asli hanya disimpan di `cause`, tidak pernah dipakai sebagai teks UI.
 */
export function toSharedSavingsError(err: unknown): SharedSavingsError {
  if (err instanceof SharedSavingsError) return err

  if (typeof err === 'object' && err !== null) {
    const raw = err as { code?: unknown; message?: unknown }
    if (raw.code === '42501') {
      return new SharedSavingsError('PERMISSION_DENIED', undefined, { cause: err })
    }
    if (typeof raw.message === 'string') {
      const msg = raw.message.trim()
      const hit = RPC_ERROR_CODES.find((c) => msg === c || new RegExp(`\\b${c}\\b`).test(msg))
      if (hit) return new SharedSavingsError(hit, undefined, { cause: err })
    }
  }

  return new SharedSavingsError('UNKNOWN', undefined, { cause: err })
}

async function run<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn()
  } catch (err) {
    throw toSharedSavingsError(err)
  }
}

/** Mengambil `data` dari respons PostgREST, atau melempar `error` mentah (dipetakan oleh `run`). */
function ok<T>(res: { data: unknown; error: unknown }): T | null {
  if (res.error) throw res.error
  return res.data as T | null
}

/** Untuk INSERT ... .select().single(): data wajib ada. */
function requireRow<T>(res: { data: unknown; error: unknown }): T {
  const row = ok<T>(res)
  if (!row) throw new SharedSavingsError('UNKNOWN')
  return row
}

/** Untuk UPDATE/DELETE dengan `.select()`: 0 baris = RLS menolak tanpa galat. */
function requireOneRow<T>(rows: T[] | null): T {
  if (!rows || rows.length === 0) {
    throw new SharedSavingsError('PERMISSION_DENIED')
  }
  return rows[0]
}

async function currentUserId(): Promise<string> {
  const { data, error } = await supabase.auth.getSession()
  const id = error ? undefined : data.session?.user.id
  if (!id) throw new SharedSavingsError('NOT_AUTHENTICATED')
  return id
}

// ---------------------------------------------------------------------------
// Validasi input
// ---------------------------------------------------------------------------

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

/** Nominal input dari user: bilangan bulat > 0 dalam cents. */
function amountInput(value: unknown): number {
  try {
    return toCents(value, 'amount')
  } catch (err) {
    throw new SharedSavingsError('INVALID_AMOUNT', undefined, { cause: err })
  }
}

function dateInput(value: string): string {
  if (!DATE_RE.test(value)) throw new SharedSavingsError('INVALID_DATE')
  return value
}

/** Tanggal lokal perangkat sebagai YYYY-MM-DD (bukan UTC). */
export function localDateString(date: Date = new Date()): string {
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

function requireGroupType(value: string): GroupType {
  if (value !== 'couple' && value !== 'circle') throw new SharedSavingsError('INVALID_TYPE')
  return value
}

// ---------------------------------------------------------------------------
// Grup
// ---------------------------------------------------------------------------

/** Membuat grup; pembuat otomatis menjadi owner (RPC `create_group`). */
export function createGroup(input: { name: string; type: GroupType; currency?: string }): Promise<Group> {
  return run(async () => {
    const res = await supabase.rpc('create_group', {
      p_name: input.name.trim(),
      p_type: requireGroupType(input.type),
      p_currency: input.currency ?? null,
    })
    const data = ok(res)
    const row = Array.isArray(data) ? data[0] : data
    if (!row) throw new SharedSavingsError('UNKNOWN')
    return mapGroup(row as GroupRow)
  })
}

/** Bergabung lewat kode undangan (RPC `join_group_by_code`). Mengembalikan id grup. */
export function joinGroupByCode(code: string): Promise<string> {
  return run(async () => {
    const res = await supabase.rpc('join_group_by_code', { p_code: code.trim().toUpperCase() })
    const id = ok(res)
    if (typeof id !== 'string') throw new SharedSavingsError('UNKNOWN')
    return id
  })
}

export function leaveGroup(groupId: string): Promise<void> {
  return run(async () => {
    const res = await supabase.rpc('leave_group', { p_group_id: groupId })
    ok(res)
  })
}

export function transferOwnership(groupId: string, newOwnerId: string): Promise<void> {
  return run(async () => {
    const res = await supabase.rpc('transfer_ownership', { p_group_id: groupId, p_new_owner: newOwnerId })
    ok(res)
  })
}

/** Membuat kode undangan baru (RPC `regenerate_invite_code`). Kode lama langsung tidak berlaku. */
export function regenerateInviteCode(groupId: string): Promise<string> {
  return run(async () => {
    const res = await supabase.rpc('regenerate_invite_code', { p_group_id: groupId })
    const code = ok(res)
    if (typeof code !== 'string') throw new SharedSavingsError('UNKNOWN')
    return code
  })
}

/** Grup tempat saya anggota aktif (RLS membatasi hasil). */
export function listMyGroups(): Promise<Group[]> {
  return run(async () => {
    const res = await supabase
      .from('groups')
      .select('*')
      .order('created_at', { ascending: false })
    return (ok<GroupRow[]>(res) ?? []).map((row) => mapGroup(row))
  })
}

export function getGroup(groupId: string): Promise<Group | null> {
  return run(async () => {
    const res = await supabase.from('groups').select('*').eq('id', groupId).maybeSingle()
    const row = ok(res)
    return row ? mapGroup(row as GroupRow) : null
  })
}

/** Anggota grup beserta nama (RPC `group_member_names`), termasuk yang sudah keluar (`leftAt`). */
export function getGroupMembers(groupId: string): Promise<GroupMember[]> {
  return run(async () => {
    const res = await supabase.rpc('group_member_names', { p_group_id: groupId })
    return (ok<GroupMemberNameRow[]>(res) ?? []).map((row) => mapGroupMember(row))
  })
}

// ---------------------------------------------------------------------------
// Goal
// ---------------------------------------------------------------------------

export function listGroupGoals(groupId: string): Promise<GroupGoal[]> {
  return run(async () => {
    const res = await supabase
      .from('group_goals')
      .select('*')
      .eq('group_id', groupId)
      .order('created_at', { ascending: false })
    return (ok<GroupGoalRow[]>(res) ?? []).map((row) => mapGroupGoal(row))
  })
}

/** Membuat goal. `created_by` diisi dari session. */
export function createGoal(
  groupId: string,
  input: { title: string; targetAmount: number; deadline?: string | null },
): Promise<GroupGoal> {
  return run(async () => {
    const targetAmount = amountInput(input.targetAmount)
    const deadline = input.deadline ? dateInput(input.deadline) : null
    const createdBy = await currentUserId()
    const res = await supabase
      .from('group_goals')
      .insert({
        group_id: groupId,
        title: input.title.trim(),
        target_amount: targetAmount,
        deadline,
        status: 'active',
        created_by: createdBy,
      })
      .select()
      .single()
    return mapGroupGoal(requireRow<GroupGoalRow>(res))
  })
}

/** Mengubah goal (pengelola goal saja; RLS menentukan). 0 baris = PERMISSION_DENIED. */
export function updateGoal(
  goalId: string,
  patch: { title?: string; targetAmount?: number; deadline?: string | null; status?: GoalStatus },
): Promise<GroupGoal> {
  return run(async () => {
    const update: Record<string, unknown> = {}
    if (patch.title !== undefined) update.title = patch.title.trim()
    if (patch.targetAmount !== undefined) update.target_amount = amountInput(patch.targetAmount)
    if (patch.deadline !== undefined) {
      update.deadline = patch.deadline ? dateInput(patch.deadline) : null
    }
    if (patch.status !== undefined) update.status = patch.status

    const res = await supabase.from('group_goals').update(update).eq('id', goalId).select()
    return mapGroupGoal(requireOneRow(ok<GroupGoalRow[]>(res)))
  })
}

// ---------------------------------------------------------------------------
// Peserta goal
// ---------------------------------------------------------------------------

export function listGoalParticipants(goalId: string): Promise<GoalParticipant[]> {
  return run(async () => {
    const res = await supabase.from('goal_participants').select('*').eq('goal_id', goalId)
    return (ok<GoalParticipantRow[]>(res) ?? []).map((row) => mapGoalParticipant(row))
  })
}

export function addGoalParticipant(goalId: string, userId: string): Promise<void> {
  return run(async () => {
    const res = await supabase.from('goal_participants').insert({ goal_id: goalId, user_id: userId })
    ok(res)
  })
}

/** 0 baris terhapus = PERMISSION_DENIED (termasuk bila peserta memang tidak ada). */
export function removeGoalParticipant(goalId: string, userId: string): Promise<void> {
  return run(async () => {
    const res = await supabase
      .from('goal_participants')
      .delete()
      .eq('goal_id', goalId)
      .eq('user_id', userId)
      .select()
    requireOneRow(ok<unknown[]>(res))
  })
}

// ---------------------------------------------------------------------------
// Progres goal (view)
// ---------------------------------------------------------------------------

export function getGoalProgress(groupId: string): Promise<GoalProgress[]> {
  return run(async () => {
    const res = await supabase.from('goal_progress').select('*').eq('group_id', groupId)
    return (ok<GoalProgressRow[]>(res) ?? []).map((row) => mapGoalProgress(row))
  })
}

// ---------------------------------------------------------------------------
// Kontribusi
// ---------------------------------------------------------------------------

/** Setoran aktif saja (`deleted_at IS NULL`), terbaru dulu. */
export function listContributions(goalId: string): Promise<Contribution[]> {
  return run(async () => {
    const res = await supabase
      .from('contributions')
      .select('*')
      .eq('goal_id', goalId)
      .is('deleted_at', null)
      .order('contributed_at', { ascending: false })
      .order('created_at', { ascending: false })
    return (ok<ContributionRow[]>(res) ?? []).map((row) => mapContribution(row))
  })
}

/**
 * Menambah setoran. `user_id` diambil dari session. `contributedAt` default = tanggal lokal hari ini.
 */
export function addContribution(
  goalId: string,
  input: { amount: number; contributedAt?: string; note?: string | null },
): Promise<Contribution> {
  return run(async () => {
    const amount = amountInput(input.amount)
    const contributedAt = input.contributedAt ? dateInput(input.contributedAt) : localDateString()
    const userId = await currentUserId()
    const res = await supabase
      .from('contributions')
      .insert({
        goal_id: goalId,
        user_id: userId,
        amount,
        contributed_at: contributedAt,
        note: input.note?.trim() || null,
      })
      .select()
      .single()
    return mapContribution(requireRow<ContributionRow>(res))
  })
}

/**
 * Mengubah setoran. Setoran yang sudah dihapus ditolak trigger dengan CONTRIBUTION_DELETED.
 * 0 baris = PERMISSION_DENIED.
 */
export function updateContribution(
  contributionId: string,
  patch: { amount?: number; contributedAt?: string; note?: string | null },
): Promise<Contribution> {
  return run(async () => {
    const update: Record<string, unknown> = {}
    if (patch.amount !== undefined) update.amount = amountInput(patch.amount)
    if (patch.contributedAt !== undefined) update.contributed_at = dateInput(patch.contributedAt)
    if (patch.note !== undefined) update.note = patch.note?.trim() || null

    const res = await supabase.from('contributions').update(update).eq('id', contributionId).select()
    return mapContribution(requireOneRow(ok<ContributionRow[]>(res)))
  })
}

/** Soft delete: mengisi `deleted_at`. Tidak bisa dipulihkan. 0 baris = PERMISSION_DENIED. */
export function deleteContribution(contributionId: string): Promise<Contribution> {
  return run(async () => {
    const res = await supabase
      .from('contributions')
      .update({ deleted_at: new Date().toISOString() })
      .eq('id', contributionId)
      .select()
    return mapContribution(requireOneRow(ok<ContributionRow[]>(res)))
  })
}

// ---------------------------------------------------------------------------
// Aktivitas (paginasi berbasis cursor `before` = created_at baris terakhir)
// ---------------------------------------------------------------------------

export function listGroupActivity(
  groupId: string,
  opts: { limit?: number; before?: string } = {},
): Promise<GroupActivity[]> {
  return run(async () => {
    const limit = Math.min(Math.max(Math.trunc(opts.limit ?? 50), 1), 100)
    let query = supabase
      .from('group_activity')
      .select('*')
      .eq('group_id', groupId)
      .order('created_at', { ascending: false })
      .order('id', { ascending: false })
      .limit(limit)
    if (opts.before) query = query.lt('created_at', opts.before)
    const res = await query
    return (ok<GroupActivityRow[]>(res) ?? []).map((row) => mapGroupActivity(row))
  })
}
