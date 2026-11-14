import { useState } from 'react'
import { useAuthUserId, useGroup } from '../../../hooks/useGroups'
import { useGroupGoals } from '../../../hooks/useGroupGoals'
import { useGroupMembers } from '../../../hooks/useGroupMembers'
import type { GroupGoal } from '../../../types/shared'
import { canManageGoal, sortGoalsForDisplay } from '../../../utils/sharedGoals'
import { ErrorNotice, GoalFormDialog } from './GoalFormDialog'
import { GoalCard } from './GoalCard'

export interface GroupGoalsTabProps {
  groupId: string
}

type DialogState = { mode: 'create' } | { mode: 'edit'; goal: GroupGoal } | null

/**
 * Tab "Goal" pada halaman grup Nabung Bareng. Satu-satunya pintu masuk fitur ini.
 * Semua data lewat hook dan lapisan lib; komponen ini tidak memanggil Supabase langsung.
 */
export function GroupGoalsTab({ groupId }: GroupGoalsTabProps) {
  const userId = useAuthUserId()
  const group = useGroup(groupId)
  const members = useGroupMembers(groupId)
  const goals = useGroupGoals(groupId)
  const [dialog, setDialog] = useState<DialogState>(null)

  const groupData = group.data
  const currency = groupData?.currency ?? 'IDR'
  const groupType = groupData?.type ?? null

  const activeMembers = members.data.filter((m) => m.leftAt === null)
  const me = activeMembers.find((m) => m.userId === userId)
  const isActiveMember = me !== undefined
  const isActiveOwner = me?.role === 'owner'

  const loadError = group.error ?? members.error ?? goals.error
  const items = sortGoalsForDisplay(goals.data)

  return (
    <section className="space-y-4" aria-label="Goal grup">
      <header className="flex items-center justify-between gap-3">
        <h2 className="text-lg font-semibold">Goal</h2>
        {groupData && isActiveMember && (
          <button
            type="button"
            className="rounded-lg bg-emerald-600 px-4 py-2 text-sm text-white"
            onClick={() => setDialog({ mode: 'create' })}
          >
            Tambah goal
          </button>
        )}
      </header>

      <ErrorNotice error={loadError} />

      {!group.loading && groupData === null && (
        <p className="text-sm text-slate-500">Grup tidak ditemukan atau tidak bisa dilihat.</p>
      )}

      {goals.loading ? (
        <p className="text-sm text-slate-500">Memuat goal…</p>
      ) : items.length === 0 ? (
        <p className="text-sm text-slate-500">Belum ada goal. Buat goal pertama untuk grup ini.</p>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          {items.map(({ goal, progress }) => (
            <GoalCard
              key={goal.id}
              goal={goal}
              progress={progress}
              currency={currency}
              members={members.data}
              userId={userId}
              isActiveMember={isActiveMember}
              canManage={canManageGoal({
                groupType,
                goalCreatedBy: goal.createdBy,
                userId,
                isActiveMember,
                isActiveOwner,
              })}
              onEdit={(g) => setDialog({ mode: 'edit', goal: g })}
              onChanged={() => void goals.refetch()}
            />
          ))}
        </div>
      )}

      {dialog?.mode === 'create' && groupData && (
        <GoalFormDialog
          groupId={groupId}
          groupType={groupData.type}
          currency={currency}
          members={activeMembers}
          goal={null}
          canManage={false}
          onClose={() => setDialog(null)}
          onSaved={() => void goals.refetch()}
        />
      )}

      {dialog?.mode === 'edit' && groupData && (
        <GoalFormDialog
          groupId={groupId}
          groupType={groupData.type}
          currency={currency}
          members={activeMembers}
          goal={dialog.goal}
          canManage={canManageGoal({
            groupType,
            goalCreatedBy: dialog.goal.createdBy,
            userId,
            isActiveMember,
            isActiveOwner,
          })}
          onClose={() => setDialog(null)}
          onSaved={() => void goals.refetch()}
        />
      )}
    </section>
  )
}
