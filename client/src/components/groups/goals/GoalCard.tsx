import { useState } from 'react'
import { useGoalContributions, useGoalParticipants } from '../../../hooks/useGroupGoals'
import type { Contribution, GoalProgress, GroupGoal, GroupMember } from '../../../types/shared'
import { centsToDisplay } from '../../../utils/currency'
import {
  barWidthPercent,
  canChangeContribution,
  canContributeToGoal,
  formatPercent,
  formatShortDate,
  goalDisplayState,
  memberName,
  progressPercent,
  type GoalDisplayState,
} from '../../../utils/sharedGoals'
import { ContributionFormDialog } from './ContributionFormDialog'
import { ContributionList } from './ContributionList'
import { ContributorBreakdown } from './ContributorBreakdown'
import { ErrorNotice } from './GoalFormDialog'

const STATE_LABEL: Record<GoalDisplayState, string> = {
  active: 'Aktif',
  achieved: 'Tercapai',
  cancelled: 'Dibatalkan',
}

const STATE_CLASS: Record<GoalDisplayState, string> = {
  active: 'bg-sky-100 text-sky-800',
  achieved: 'bg-emerald-100 text-emerald-800',
  cancelled: 'bg-slate-200 text-slate-600',
}

export interface GoalCardProps {
  goal: GroupGoal
  /** null bila view belum punya baris untuk goal ini (dianggap 0). */
  progress: GoalProgress | null
  /** Mata uang GRUP. */
  currency: string
  /** Semua anggota grup (termasuk yang keluar) untuk nama. */
  members: GroupMember[]
  userId: string | null | undefined
  isActiveMember: boolean
  /** Pengelola goal (lihat canManageGoal). */
  canManage: boolean
  onEdit: (goal: GroupGoal) => void
  /** Dipanggil setelah setoran berubah agar progres goal dimuat ulang. */
  onChanged: () => void
}

export function GoalCard({
  goal,
  progress,
  currency,
  members,
  userId,
  isActiveMember,
  canManage,
  onEdit,
  onChanged,
}: GoalCardProps) {
  const [expanded, setExpanded] = useState(false)
  const state = goalDisplayState(goal, progress)
  const contributed = progress?.contributedAmount ?? 0
  const percent = progressPercent(contributed, goal.targetAmount)
  const contributorCount = progress?.contributorCount ?? 0

  return (
    <article className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
      <header className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="truncate font-semibold">{goal.title}</h3>
          <p className="text-xs text-slate-500">
            {goal.deadline ? `Batas waktu ${formatShortDate(goal.deadline)}` : 'Tanpa batas waktu'}
          </p>
        </div>
        <span className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-medium ${STATE_CLASS[state]}`}>
          {STATE_LABEL[state]}
        </span>
      </header>

      <div className="mt-3">
        <div
          className="h-2.5 w-full overflow-hidden rounded-full bg-slate-100"
          role="progressbar"
          aria-label={`Progres ${goal.title}`}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.floor(barWidthPercent(percent))}
        >
          <div
            className={`h-full rounded-full ${state === 'achieved' ? 'bg-emerald-500' : 'bg-sky-500'}`}
            style={{ width: `${barWidthPercent(percent)}%` }}
          />
        </div>
        <div className="mt-1 flex justify-between text-xs text-slate-600">
          <span className="tabular-nums">
            {centsToDisplay(contributed, currency)} dari {centsToDisplay(goal.targetAmount, currency)}
          </span>
          <span className="tabular-nums">{formatPercent(percent)}</span>
        </div>
        <p className="mt-1 text-xs text-slate-500">
          {contributorCount} kontributor
        </p>
      </div>

      <div className="mt-3 flex gap-2">
        <button
          type="button"
          className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm"
          aria-expanded={expanded}
          onClick={() => setExpanded((v) => !v)}
        >
          {expanded ? 'Tutup detail' : 'Lihat detail'}
        </button>
        {canManage && state !== 'cancelled' && (
          <button
            type="button"
            className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm"
            onClick={() => onEdit(goal)}
          >
            Ubah goal
          </button>
        )}
      </div>

      {expanded && (
        <GoalDetails
          goal={goal}
          currency={currency}
          members={members}
          userId={userId}
          isActiveMember={isActiveMember}
          onChanged={onChanged}
        />
      )}
    </article>
  )
}

interface GoalDetailsProps {
  goal: GroupGoal
  currency: string
  members: GroupMember[]
  userId: string | null | undefined
  isActiveMember: boolean
  onChanged: () => void
}

/**
 * Detail goal. Hook setoran dan peserta hanya dijalankan saat panel dibuka.
 * Ini komponen terpisah agar hook tidak dipanggil secara kondisional di GoalCard.
 */
function GoalDetails({ goal, currency, members, userId, isActiveMember, onChanged }: GoalDetailsProps) {
  const participants = useGoalParticipants(goal.id)
  const contributions = useGoalContributions(goal.id)
  const [creating, setCreating] = useState(false)
  const [editing, setEditing] = useState<Contribution | null>(null)

  const isParticipant = participants.data.some((p) => p.userId === userId)
  const access = { userId, isActiveMember, isParticipant, goalStatus: goal.status }
  const canContribute = canContributeToGoal(access)
  const participantNames = participants.data.map((p) => memberName(members, p.userId))

  function refreshAfterChange() {
    void contributions.refetch()
    onChanged()
  }

  return (
    <div className="mt-4 space-y-4 border-t border-slate-100 pt-4">
      <p className="text-sm">
        <span className="text-slate-500">Peserta: </span>
        {participantNames.length > 0 ? participantNames.join(', ') : 'Belum ada peserta'}
      </p>

      <ErrorNotice error={participants.error ?? contributions.error} />

      {canContribute && (
        <button
          type="button"
          className="rounded-lg bg-emerald-600 px-4 py-2 text-sm text-white"
          onClick={() => setCreating(true)}
        >
          Setor
        </button>
      )}

      <ContributorBreakdown contributions={contributions.data} members={members} currency={currency} />

      <ContributionList
        contributions={contributions.data}
        members={members}
        currency={currency}
        canChange={(c) => canChangeContribution(c, access)}
        onEdit={setEditing}
      />

      {creating && (
        <ContributionFormDialog
          goal={goal}
          currency={currency}
          contribution={null}
          onClose={() => setCreating(false)}
          onSaved={refreshAfterChange}
        />
      )}

      {editing && (
        <ContributionFormDialog
          goal={goal}
          currency={currency}
          contribution={editing}
          onClose={() => setEditing(null)}
          onSaved={refreshAfterChange}
        />
      )}
    </div>
  )
}
