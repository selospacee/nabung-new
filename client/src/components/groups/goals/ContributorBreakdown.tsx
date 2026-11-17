import { centsToDisplay } from '../../../utils/currency'
import type { Contribution, GroupMember } from '../../../types/shared'
import { barWidthPercent, buildContributorBreakdown, formatPercent } from '../../../utils/sharedGoals'

export interface ContributorBreakdownProps {
  /** Setoran aktif saja (pemanggil memfilter `deleted_at`). */
  contributions: Contribution[]
  /** Semua anggota, termasuk yang sudah keluar; mereka tetap ditampilkan. */
  members: GroupMember[]
  /** Mata uang GRUP. */
  currency: string
}

/** Rincian setoran per orang. Bar dan persentase dihitung dari 0 terhadap total setoran aktif. */
export function ContributorBreakdown({ contributions, members, currency }: ContributorBreakdownProps) {
  const { total, shares } = buildContributorBreakdown(contributions, members)

  if (shares.length === 0) {
    return <p className="text-sm text-slate-500">Belum ada setoran untuk dihitung.</p>
  }

  return (
    <section aria-label="Kontribusi per anggota" className="space-y-3">
      <p className="text-sm">
        Total terkumpul: <span className="font-semibold tabular-nums">{centsToDisplay(total, currency)}</span>
      </p>
      <ul className="space-y-2">
        {shares.map((s) => (
          <li key={s.userId} className="text-sm">
            <div className="flex items-baseline justify-between gap-2">
              <span className="min-w-0 truncate">
                {s.name}
                {s.hasLeft && <span className="ml-1 text-xs text-slate-500">(sudah keluar)</span>}
              </span>
              <span className="shrink-0 tabular-nums text-slate-600">
                {centsToDisplay(s.amount, currency)} · {formatPercent(s.percent)}
              </span>
            </div>
            <div
              className="mt-1 h-2 w-full overflow-hidden rounded-full bg-slate-100"
              role="img"
              aria-label={`${s.name}: ${formatPercent(s.percent)} dari total`}
            >
              <div className="h-full rounded-full bg-emerald-500" style={{ width: `${barWidthPercent(s.percent)}%` }} />
            </div>
          </li>
        ))}
      </ul>
    </section>
  )
}
