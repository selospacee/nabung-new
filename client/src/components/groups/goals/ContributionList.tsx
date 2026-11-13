import { centsToDisplay } from '../../../utils/currency'
import type { Contribution, GroupMember } from '../../../types/shared'
import { formatShortDate, memberName } from '../../../utils/sharedGoals'

export interface ContributionListProps {
  /** Setoran aktif saja (pemanggil memfilter `deleted_at`). */
  contributions: Contribution[]
  /** Semua anggota, termasuk yang sudah keluar, untuk nama. */
  members: GroupMember[]
  /** Mata uang GRUP. */
  currency: string
  /** Tombol ubah hanya muncul bila true (setoran sendiri, goal aktif). */
  canChange: (contribution: Contribution) => boolean
  onEdit: (contribution: Contribution) => void
}

export function ContributionList({ contributions, members, currency, canChange, onEdit }: ContributionListProps) {
  if (contributions.length === 0) {
    return <p className="text-sm text-slate-500">Belum ada setoran.</p>
  }

  return (
    <ul className="divide-y divide-slate-100">
      {contributions.map((c) => {
        const member = members.find((m) => m.userId === c.userId)
        return (
          <li key={c.id} className="flex items-start justify-between gap-3 py-2 text-sm">
            <div className="min-w-0">
              <p className="font-medium">
                {memberName(members, c.userId)}
                {member?.leftAt && <span className="ml-1 text-xs font-normal text-slate-500">(sudah keluar)</span>}
              </p>
              <p className="text-xs text-slate-500">
                {formatShortDate(c.contributedAt)}
                {c.note ? ` · ${c.note}` : ''}
              </p>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <span className="tabular-nums">{centsToDisplay(c.amount, currency)}</span>
              {canChange(c) && (
                <button type="button" className="text-xs text-emerald-700" onClick={() => onEdit(c)}>
                  Ubah
                </button>
              )}
            </div>
          </li>
        )
      })}
    </ul>
  )
}
