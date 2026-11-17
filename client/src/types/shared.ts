/**
 * Tipe & mapper untuk Nabung Bareng (kontrak: docs/shared-savings-schema.md, Fase 0).
 *
 * - Baris mentah dari PostgREST/RPC memakai snake_case (`*Row`).
 * - Tipe yang dipakai UI memakai camelCase.
 * - Semua nominal adalah number dalam cents (Rp 30.600 = 3060000) dan wajib bilangan bulat.
 *
 * File ini tidak mengimpor apa pun dari `db/` (Dexie) dan tidak menyentuh Supabase.
 */

/** Batas atas nominal: Rp 10 triliun dalam cents (sesuai CHECK di database). */
export const MAX_CENTS = 1_000_000_000_000_000

export const GROUP_TYPES = ['couple', 'circle'] as const
export const GROUP_ROLES = ['owner', 'member'] as const
export const GOAL_STATUSES = ['active', 'cancelled'] as const
export const ACTIVITY_ACTIONS = [
  'member_joined',
  'member_left',
  'ownership_transferred',
  'invite_regenerated',
  'goal_created',
  'goal_updated',
  'goal_cancelled',
  'contribution_added',
  'contribution_updated',
  'contribution_deleted',
] as const

export type GroupType = (typeof GROUP_TYPES)[number]
export type GroupRole = (typeof GROUP_ROLES)[number]
export type GoalStatus = (typeof GOAL_STATUSES)[number]
export type ActivityAction = (typeof ACTIVITY_ACTIONS)[number]

// ---------------------------------------------------------------------------
// Baris mentah (snake_case) sesuai kolom database
// ---------------------------------------------------------------------------

export interface GroupRow {
  id: string
  name: string
  type: string
  currency: string
  invite_code: string
  created_by: string | null
  created_at: string
  updated_at: string
}

/** Hasil RPC `group_member_names`. */
export interface GroupMemberNameRow {
  user_id: string
  name: string | null
  role: string
  joined_at: string
  left_at: string | null
}

export interface GroupGoalRow {
  id: string
  group_id: string
  title: string
  target_amount: number | string
  deadline: string | null
  status: string
  created_by: string | null
  created_at: string
  updated_at: string
}

export interface GoalParticipantRow {
  goal_id: string
  user_id: string
}

/** Baris view `goal_progress`. */
export interface GoalProgressRow {
  goal_id: string
  group_id: string
  target_amount: number | string
  contributed_amount: number | string
  contributor_count: number | string
  is_achieved: boolean
}

export interface ContributionRow {
  id: string
  goal_id: string
  user_id: string
  amount: number | string
  contributed_at: string
  note: string | null
  created_at: string
  updated_at: string
  deleted_at: string | null
}

export interface GroupActivityRow {
  id: string
  group_id: string
  actor_id: string | null
  action: string
  ref: unknown
  created_at: string
}

// ---------------------------------------------------------------------------
// Tipe untuk UI (camelCase)
// ---------------------------------------------------------------------------

export interface Group {
  id: string
  name: string
  type: GroupType
  currency: string
  inviteCode: string
  createdBy: string | null
  createdAt: string
  updatedAt: string
}

/** Anggota grup beserta nama (dari RPC `group_member_names`). `leftAt` terisi bila sudah keluar. */
export interface GroupMember {
  userId: string
  name: string
  role: GroupRole
  joinedAt: string
  leftAt: string | null
}

export interface GroupGoal {
  id: string
  groupId: string
  title: string
  /** cents, > 0 */
  targetAmount: number
  /** YYYY-MM-DD atau null */
  deadline: string | null
  status: GoalStatus
  createdBy: string | null
  createdAt: string
  updatedAt: string
}

export interface GoalProgress {
  goalId: string
  groupId: string
  /** cents, > 0 */
  targetAmount: number
  /** cents, >= 0 (jumlah setoran aktif) */
  contributedAmount: number
  contributorCount: number
  isAchieved: boolean
}

export interface GoalParticipant {
  goalId: string
  userId: string
}

export interface Contribution {
  id: string
  goalId: string
  userId: string
  /** cents, > 0 */
  amount: number
  /** YYYY-MM-DD (tanggal lokal) */
  contributedAt: string
  note: string | null
  createdAt: string
  updatedAt: string
  /** null = aktif. Setoran yang dihapus tetap terlihat oleh anggota, tetapi query client memfilternya. */
  deletedAt: string | null
}

/** Ref per action, sesuai tabel bagian 5 kontrak. */
export type GroupActivityRef =
  | { action: 'member_joined' | 'member_left' | 'ownership_transferred'; ref: { userId: string } }
  | { action: 'invite_regenerated'; ref: Record<string, never> }
  | { action: 'goal_created'; ref: { goalId: string; title: string; targetAmount: number } }
  | {
      action: 'goal_updated'
      ref: { goalId: string; title: string; oldTargetAmount: number; newTargetAmount: number }
    }
  | { action: 'goal_cancelled'; ref: { goalId: string; title: string } }
  | { action: 'contribution_added' | 'contribution_deleted'; ref: { goalId: string; goalTitle: string; amount: number } }
  | {
      action: 'contribution_updated'
      ref: { goalId: string; goalTitle: string; oldAmount: number; newAmount: number }
    }

interface GroupActivityBase {
  id: string
  groupId: string
  actorId: string | null
  createdAt: string
}

export type GroupActivity = GroupActivityBase & GroupActivityRef

/** Gabungan goal dengan progresnya (progres null bila view belum punya baris untuk goal itu). */
export interface GoalWithProgress {
  goal: GroupGoal
  progress: GoalProgress | null
}

// ---------------------------------------------------------------------------
// Helper validasi
// ---------------------------------------------------------------------------

function fail(field: string, value: unknown): never {
  throw new Error(`Data ${field} tidak valid: ${String(value)}`)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function str(value: unknown, field: string): string {
  if (typeof value !== 'string') fail(field, value)
  return value
}

function nullableStr(value: unknown, field: string): string | null {
  if (value === null || value === undefined) return null
  return str(value, field)
}

function oneOf<T extends string>(value: unknown, list: readonly T[], field: string): T {
  if (typeof value !== 'string' || !(list as readonly string[]).includes(value)) fail(field, value)
  return value as T
}

function bool(value: unknown, field: string): boolean {
  if (typeof value !== 'boolean') fail(field, value)
  return value
}

function int(value: unknown, field: string, min: number): number {
  const n = typeof value === 'string' && /^-?\d+$/.test(value) ? Number(value) : value
  if (typeof n !== 'number' || !Number.isSafeInteger(n) || n < min) fail(field, value)
  return n
}

/**
 * Memvalidasi nominal dalam cents: bilangan bulat, >= `min`, <= MAX_CENTS.
 * Menerima number atau string digit (BIGINT kadang dikirim sebagai string).
 */
export function toCents(value: unknown, field: string, min = 1): number {
  const n = typeof value === 'string' && /^-?\d+$/.test(value) ? Number(value) : value
  if (typeof n !== 'number' || !Number.isSafeInteger(n) || n < min || n > MAX_CENTS) {
    fail(field, value)
  }
  return n
}

// ---------------------------------------------------------------------------
// Mapper: baris snake_case -> tipe camelCase
// ---------------------------------------------------------------------------

export function mapGroup(row: GroupRow): Group {
  return {
    id: str(row.id, 'groups.id'),
    name: str(row.name, 'groups.name'),
    type: oneOf(row.type, GROUP_TYPES, 'groups.type'),
    currency: str(row.currency, 'groups.currency'),
    inviteCode: str(row.invite_code, 'groups.invite_code'),
    createdBy: nullableStr(row.created_by, 'groups.created_by'),
    createdAt: str(row.created_at, 'groups.created_at'),
    updatedAt: str(row.updated_at, 'groups.updated_at'),
  }
}

export function mapGroupMember(row: GroupMemberNameRow): GroupMember {
  return {
    userId: str(row.user_id, 'member.user_id'),
    name: nullableStr(row.name, 'member.name') ?? 'Pengguna',
    role: oneOf(row.role, GROUP_ROLES, 'member.role'),
    joinedAt: str(row.joined_at, 'member.joined_at'),
    leftAt: nullableStr(row.left_at, 'member.left_at'),
  }
}

export function mapGroupGoal(row: GroupGoalRow): GroupGoal {
  return {
    id: str(row.id, 'goal.id'),
    groupId: str(row.group_id, 'goal.group_id'),
    title: str(row.title, 'goal.title'),
    targetAmount: toCents(row.target_amount, 'goal.target_amount'),
    deadline: nullableStr(row.deadline, 'goal.deadline'),
    status: oneOf(row.status, GOAL_STATUSES, 'goal.status'),
    createdBy: nullableStr(row.created_by, 'goal.created_by'),
    createdAt: str(row.created_at, 'goal.created_at'),
    updatedAt: str(row.updated_at, 'goal.updated_at'),
  }
}

export function mapGoalProgress(row: GoalProgressRow): GoalProgress {
  return {
    goalId: str(row.goal_id, 'progress.goal_id'),
    groupId: str(row.group_id, 'progress.group_id'),
    targetAmount: toCents(row.target_amount, 'progress.target_amount'),
    contributedAmount: toCents(row.contributed_amount, 'progress.contributed_amount', 0),
    contributorCount: int(row.contributor_count, 'progress.contributor_count', 0),
    isAchieved: bool(row.is_achieved, 'progress.is_achieved'),
  }
}

export function mapGoalParticipant(row: GoalParticipantRow): GoalParticipant {
  return {
    goalId: str(row.goal_id, 'participant.goal_id'),
    userId: str(row.user_id, 'participant.user_id'),
  }
}

export function mapContribution(row: ContributionRow): Contribution {
  return {
    id: str(row.id, 'contribution.id'),
    goalId: str(row.goal_id, 'contribution.goal_id'),
    userId: str(row.user_id, 'contribution.user_id'),
    amount: toCents(row.amount, 'contribution.amount'),
    contributedAt: str(row.contributed_at, 'contribution.contributed_at'),
    note: nullableStr(row.note, 'contribution.note'),
    createdAt: str(row.created_at, 'contribution.created_at'),
    updatedAt: str(row.updated_at, 'contribution.updated_at'),
    deletedAt: nullableStr(row.deleted_at, 'contribution.deleted_at'),
  }
}

export function mapGroupActivity(row: GroupActivityRow): GroupActivity {
  const action = oneOf(row.action, ACTIVITY_ACTIONS, 'activity.action')
  if (!isRecord(row.ref)) fail('activity.ref', row.ref)
  const ref = row.ref
  const base: GroupActivityBase = {
    id: str(row.id, 'activity.id'),
    groupId: str(row.group_id, 'activity.group_id'),
    actorId: nullableStr(row.actor_id, 'activity.actor_id'),
    createdAt: str(row.created_at, 'activity.created_at'),
  }

  switch (action) {
    case 'member_joined':
    case 'member_left':
    case 'ownership_transferred':
      return { ...base, action, ref: { userId: str(ref.user_id, 'ref.user_id') } }
    case 'invite_regenerated':
      return { ...base, action, ref: {} }
    case 'goal_created':
      return {
        ...base,
        action,
        ref: {
          goalId: str(ref.goal_id, 'ref.goal_id'),
          title: str(ref.title, 'ref.title'),
          targetAmount: toCents(ref.target_amount, 'ref.target_amount'),
        },
      }
    case 'goal_updated':
      return {
        ...base,
        action,
        ref: {
          goalId: str(ref.goal_id, 'ref.goal_id'),
          title: str(ref.title, 'ref.title'),
          oldTargetAmount: toCents(ref.old_target_amount, 'ref.old_target_amount'),
          newTargetAmount: toCents(ref.new_target_amount, 'ref.new_target_amount'),
        },
      }
    case 'goal_cancelled':
      return {
        ...base,
        action,
        ref: { goalId: str(ref.goal_id, 'ref.goal_id'), title: str(ref.title, 'ref.title') },
      }
    case 'contribution_added':
    case 'contribution_deleted':
      return {
        ...base,
        action,
        ref: {
          goalId: str(ref.goal_id, 'ref.goal_id'),
          goalTitle: str(ref.goal_title, 'ref.goal_title'),
          amount: toCents(ref.amount, 'ref.amount'),
        },
      }
    case 'contribution_updated':
      return {
        ...base,
        action,
        ref: {
          goalId: str(ref.goal_id, 'ref.goal_id'),
          goalTitle: str(ref.goal_title, 'ref.goal_title'),
          oldAmount: toCents(ref.old_amount, 'ref.old_amount'),
          newAmount: toCents(ref.new_amount, 'ref.new_amount'),
        },
      }
  }
}
