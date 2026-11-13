/**
 * Helper murni untuk UI goal bersama (Nabung Bareng, Fase 3).
 *
 * Tidak menyentuh Supabase maupun React. Aturan izin di sini adalah cerminan client dari
 * `can_manage_goal` dan kebijakan RLS (lihat docs/shared-savings-schema.md bagian 4 dan 6);
 * keputusan akhir tetap di server.
 */
import { z } from 'zod'
import { displayToCents } from './currency'
import {
  MAX_CENTS,
  type Contribution,
  type GoalProgress,
  type GoalStatus,
  type GoalWithProgress,
  type GroupGoal,
  type GroupMember,
  type GroupType,
} from '../types/shared'

// ---------------------------------------------------------------------------
// Status tampilan goal
// ---------------------------------------------------------------------------

/** Status yang ditampilkan UI. "tercapai" tidak disimpan di database; dihitung dari progres. */
export type GoalDisplayState = 'active' | 'achieved' | 'cancelled'

export function goalDisplayState(
  goal: Pick<GroupGoal, 'status'>,
  progress: Pick<GoalProgress, 'isAchieved'> | null,
): GoalDisplayState {
  if (goal.status === 'cancelled') return 'cancelled'
  if (progress?.isAchieved) return 'achieved'
  return 'active'
}

const STATE_ORDER: Record<GoalDisplayState, number> = { active: 0, achieved: 1, cancelled: 2 }

/** Urutan tampilan: aktif → tercapai → dibatalkan; di dalam kelompok, yang terbaru dulu. */
export function sortGoalsForDisplay<T extends GoalWithProgress>(items: readonly T[]): T[] {
  return [...items].sort((a, b) => {
    const byState =
      STATE_ORDER[goalDisplayState(a.goal, a.progress)] - STATE_ORDER[goalDisplayState(b.goal, b.progress)]
    if (byState !== 0) return byState
    return b.goal.createdAt.localeCompare(a.goal.createdAt)
  })
}

// ---------------------------------------------------------------------------
// Persentase & progres
// ---------------------------------------------------------------------------

/**
 * Persentase progres dari 0. Tidak dibatasi di 100: setoran boleh melewati target.
 * Target <= 0 atau setoran kosong = 0.
 */
export function progressPercent(contributed: number, target: number): number {
  if (!Number.isFinite(contributed) || !Number.isFinite(target) || target <= 0 || contributed <= 0) {
    return 0
  }
  return (contributed / target) * 100
}

/** Lebar bar progres: selalu 0..100 meskipun persentase melewati 100. */
export function barWidthPercent(percent: number): number {
  if (!Number.isFinite(percent) || percent <= 0) return 0
  return Math.min(percent, 100)
}

/** Teks persentase bilangan bulat ke bawah, agar 99,6% tidak tampil sebagai 100%. */
export function formatPercent(percent: number): string {
  return `${Math.floor(Math.max(0, percent))}%`
}

// ---------------------------------------------------------------------------
// Izin (cerminan client; keputusan akhir di RLS)
// ---------------------------------------------------------------------------

export interface GoalManageInput {
  groupType: GroupType | null
  goalCreatedBy: string | null
  userId: string | null | undefined
  /** Anggota aktif (left_at IS NULL) grup goal ini. */
  isActiveMember: boolean
  /** Owner aktif grup. */
  isActiveOwner: boolean
}

/**
 * Pengelola goal = anggota aktif yang (grup couple) ATAU (pembuat goal) ATAU (owner aktif).
 * Berlaku untuk mengubah goal, membatalkan goal, serta menambah/menghapus peserta.
 */
export function canManageGoal(input: GoalManageInput): boolean {
  if (!input.userId || !input.isActiveMember || input.groupType === null) return false
  return input.groupType === 'couple' || input.goalCreatedBy === input.userId || input.isActiveOwner
}

export interface ContributeInput {
  userId: string | null | undefined
  isActiveMember: boolean
  isParticipant: boolean
  goalStatus: GoalStatus
}

/** Setor, dan ubah/hapus setoran sendiri: user login, anggota aktif, peserta, dan goal aktif. */
export function canContributeToGoal(input: ContributeInput): boolean {
  return (
    Boolean(input.userId) &&
    input.isActiveMember &&
    input.isParticipant &&
    input.goalStatus === 'active'
  )
}

/** Setoran yang boleh diubah/dihapus dari UI: milik sendiri, belum dihapus, dan user masih boleh setor. */
export function canChangeContribution(
  contribution: Pick<Contribution, 'userId' | 'deletedAt'>,
  input: ContributeInput,
): boolean {
  return canContributeToGoal(input) && contribution.userId === input.userId && contribution.deletedAt === null
}

// ---------------------------------------------------------------------------
// Nominal & tanggal input
// ---------------------------------------------------------------------------

/**
 * Mengubah teks input menjadi cents. Null bila kosong, bukan angka, <= 0,
 * bukan bilangan bulat dalam cents, atau melewati batas Rp 10 triliun.
 */
export function parseAmountInput(input: string, currency: string): number | null {
  const cents = displayToCents(input, currency)
  if (cents === null || !Number.isSafeInteger(cents) || cents <= 0 || cents > MAX_CENTS) return null
  return cents
}

/** Nilai awal input nominal dari cents. Bilangan utuh tanpa pemisah agar bisa di-parse ulang. */
export function centsToInputValue(cents: number): string {
  const whole = cents / 100
  return Number.isInteger(whole) ? String(whole) : whole.toFixed(2)
}

const ISO_DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/

/** YYYY-MM-DD yang benar-benar ada di kalender (menolak 2026-02-30). */
export function isRealIsoDate(value: string): boolean {
  const m = ISO_DATE_RE.exec(value)
  if (!m) return false
  const year = Number(m[1])
  const month = Number(m[2])
  const day = Number(m[3])
  const d = new Date(Date.UTC(year, month - 1, day))
  return d.getUTCFullYear() === year && d.getUTCMonth() === month - 1 && d.getUTCDate() === day
}

/** Tanggal YYYY-MM-DD ditampilkan sebagai "13 Nov 2026". Tanggal rusak dikembalikan apa adanya. */
export function formatShortDate(value: string): string {
  if (!isRealIsoDate(value)) return value
  const [y, m, d] = value.split('-').map(Number)
  return new Date(y, m - 1, d).toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric' })
}

// ---------------------------------------------------------------------------
// Validasi form (zod)
// ---------------------------------------------------------------------------

export function createGoalFormSchema(currency: string) {
  return z.object({
    title: z
      .string()
      .trim()
      .min(1, { message: 'Judul goal wajib diisi.' })
      .max(100, { message: 'Judul maksimal 100 karakter.' }),
    targetAmount: z.string().refine((v) => parseAmountInput(v, currency) !== null, {
      message: 'Target harus lebih dari Rp 0 dan tidak lebih dari Rp 10 triliun.',
    }),
    /** Kosong = tanpa deadline. */
    deadline: z.string().refine((v) => v === '' || isRealIsoDate(v), { message: 'Tanggal tidak valid.' }),
    participantIds: z.array(z.string()).min(1, { message: 'Pilih minimal satu peserta.' }),
  })
}

export type GoalFormValues = z.infer<ReturnType<typeof createGoalFormSchema>>

export function createContributionFormSchema(currency: string) {
  return z.object({
    amount: z.string().refine((v) => parseAmountInput(v, currency) !== null, {
      message: 'Nominal harus lebih dari Rp 0 dan tidak lebih dari Rp 10 triliun.',
    }),
    contributedAt: z.string().refine((v) => isRealIsoDate(v), { message: 'Tanggal tidak valid.' }),
    note: z.string().trim().max(200, { message: 'Catatan maksimal 200 karakter.' }),
  })
}

export type ContributionFormValues = z.infer<ReturnType<typeof createContributionFormSchema>>

// ---------------------------------------------------------------------------
// Anggota & kontributor
// ---------------------------------------------------------------------------

/** Nama anggota dari daftar (termasuk yang sudah keluar). Fallback sama dengan mapper: "Pengguna". */
export function memberName(members: readonly GroupMember[], userId: string): string {
  return members.find((m) => m.userId === userId)?.name ?? 'Pengguna'
}

export interface ContributorShare {
  userId: string
  name: string
  /** true bila anggota sudah keluar dari grup; tetap ditampilkan. */
  hasLeft: boolean
  /** cents, jumlah setoran aktif */
  amount: number
  count: number
  /** 0..100 (bisa tepat 0 bila tidak ada setoran). Dari total setoran aktif. */
  percent: number
}

export interface ContributorBreakdown {
  /** cents, jumlah semua setoran aktif */
  total: number
  /** Diurutkan dari setoran terbesar. */
  shares: ContributorShare[]
}

/** Rincian kontribusi per orang. Setoran yang dihapus (soft delete) tidak dihitung. */
export function buildContributorBreakdown(
  contributions: readonly Contribution[],
  members: readonly GroupMember[],
): ContributorBreakdown {
  const byUser = new Map<string, { amount: number; count: number }>()
  for (const c of contributions) {
    if (c.deletedAt !== null) continue
    const entry = byUser.get(c.userId) ?? { amount: 0, count: 0 }
    entry.amount += c.amount
    entry.count += 1
    byUser.set(c.userId, entry)
  }

  let total = 0
  for (const entry of byUser.values()) total += entry.amount

  const memberById = new Map(members.map((m) => [m.userId, m]))
  const shares: ContributorShare[] = [...byUser.entries()].map(([userId, entry]) => {
    const member = memberById.get(userId)
    return {
      userId,
      name: member?.name ?? 'Pengguna',
      hasLeft: member ? member.leftAt !== null : false,
      amount: entry.amount,
      count: entry.count,
      percent: total > 0 ? (entry.amount / total) * 100 : 0,
    }
  })
  shares.sort((a, b) => b.amount - a.amount || a.name.localeCompare(b.name, 'id'))

  return { total, shares }
}
