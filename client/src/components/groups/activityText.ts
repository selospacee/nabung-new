import type { GroupActivity } from '../../types/shared'
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
