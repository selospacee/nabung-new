import type { GroupActivity } from '../../types/shared'
import { formatShortDate } from '../../utils/sharedGoals'
import { formatCurrency } from '../../utils/currency'

/**
 * Mengubah satu baris aktivitas menjadi kalimat Bahasa Indonesia.
 * `names` memetakan userId -> nama (dari anggota grup, termasuk yang sudah keluar).
 * `currency` WAJIB: mata uang grup (groups.currency). Tidak ada default diam-diam.
 */
export function describeActivity(
  activity: GroupActivity,
  names: Map<string, string>,
  currency: string,
): string {
  const nameOf = (userId: string | null | undefined): string => {
    if (!userId) return 'Seseorang'
    return names.get(userId) ?? 'Seseorang'
  }
  const actor = nameOf(activity.actorId)
  const money = (cents: number) => formatCurrency(cents, currency)

  switch (activity.action) {
    case 'member_joined':
      return `${nameOf(activity.ref.userId)} bergabung ke grup`
    case 'member_left':
      return `${nameOf(activity.ref.userId)} keluar dari grup`
    case 'ownership_transferred':
      return `Kepemilikan grup dipindahkan ke ${nameOf(activity.ref.userId)}`
    case 'invite_regenerated':
      return `${actor} memperbarui kode undangan`
    case 'goal_created':
      return `${actor} membuat goal "${activity.ref.title}" dengan target ${money(activity.ref.targetAmount)}`
    case 'goal_updated':
      return `${actor} mengubah target goal "${activity.ref.title}" dari ${money(activity.ref.oldTargetAmount)} menjadi ${money(activity.ref.newTargetAmount)}`
    case 'goal_cancelled':
      return `${actor} membatalkan goal "${activity.ref.title}"`
    case 'contribution_added':
      return `${actor} menyetor ${money(activity.ref.amount)} ke "${activity.ref.goalTitle}"`
    case 'contribution_updated':
      return `${actor} mengubah setoran di "${activity.ref.goalTitle}" dari ${money(activity.ref.oldAmount)} menjadi ${money(activity.ref.newAmount)}`
    case 'contribution_deleted':
      return `${actor} menghapus setoran ${money(activity.ref.amount)} di "${activity.ref.goalTitle}"`
    default:
      return `${actor} melakukan aktivitas`
  }
}

export interface ActivityDayGroup {
  /** YYYY-MM-DD tanggal lokal perangkat. */
  dayKey: string
  /** "Hari ini", "Kemarin", atau tanggal pendek. */
  label: string
  items: GroupActivity[]
}

const pad2 = (n: number) => String(n).padStart(2, '0')

/** Tanggal lokal YYYY-MM-DD dari timestamp ISO. Tanggal rusak menghasilkan '' (tidak dikelompokkan). */
export function localDayKey(iso: string, date: Date = new Date(iso)): string {
  if (Number.isNaN(date.getTime())) return ''
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`
}

/**
 * Mengelompokkan aktivitas per hari (lokal). `items` harus sudah terurut terbaru dulu.
 * `now` bisa disuntik agar tes deterministik.
 */
export function groupActivityByDay(items: readonly GroupActivity[], now: Date = new Date()): ActivityDayGroup[] {
  const todayKey = localDayKey('', now)
  const yesterdayKey = localDayKey('', new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1))

  const groups: ActivityDayGroup[] = []
  for (const item of items) {
    const dayKey = localDayKey(item.createdAt)
    const last = groups[groups.length - 1]
    if (last && last.dayKey === dayKey) {
      last.items.push(item)
      continue
    }
    const label =
      dayKey === todayKey ? 'Hari ini' : dayKey === yesterdayKey ? 'Kemarin' : formatShortDate(dayKey)
    groups.push({ dayKey, label, items: [item] })
  }
  return groups
}

/** Jam lokal HH.mm untuk baris aktivitas. Tanggal rusak dikembalikan apa adanya. */
export function formatClock(iso: string): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return iso
  return `${pad2(date.getHours())}.${pad2(date.getMinutes())}`
}
