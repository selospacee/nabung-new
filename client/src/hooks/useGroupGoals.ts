import {
  getGoalProgress,
  listContributions,
  listGoalParticipants,
  listGroupActivity,
  listGroupGoals,
} from '../lib/sharedSavings'
import type { Contribution, GoalParticipant, GroupActivity, GoalWithProgress } from '../types/shared'
import { useSharedQuery, type SharedQuery } from './useGroups'

const NO_GOALS: GoalWithProgress[] = []
const NO_CONTRIBUTIONS: Contribution[] = []
const NO_ACTIVITY: GroupActivity[] = []
const NO_PARTICIPANTS: GoalParticipant[] = []

/**
 * Goal sebuah grup beserta progresnya (dari view `goal_progress`).
 * Realtime: perubahan goal di grup ini, dan setoran (RLS membatasi ke yang boleh dilihat).
 */
export function useGroupGoals(groupId: string | null | undefined): SharedQuery<GoalWithProgress[]> {
  return useSharedQuery<GoalWithProgress[]>(
    groupId ?? null,
    NO_GOALS,
    async (id) => {
      const [goals, progress] = await Promise.all([listGroupGoals(id), getGoalProgress(id)])
      const byGoal = new Map(progress.map((p) => [p.goalId, p]))
      return goals.map((goal) => ({ goal, progress: byGoal.get(goal.id) ?? null }))
    },
    (id) => [
      { table: 'group_goals', filter: `group_id=eq.${id}` },
      // contributions tidak punya group_id; RLS membatasi event ke setoran yang boleh dilihat.
      { table: 'contributions' },
    ],
  )
}

/** Setoran aktif sebuah goal (`deleted_at IS NULL`). */
export function useGoalContributions(goalId: string | null | undefined): SharedQuery<Contribution[]> {
  return useSharedQuery<Contribution[]>(
    goalId ?? null,
    NO_CONTRIBUTIONS,
    (id) => listContributions(id),
    (id) => [{ table: 'contributions', filter: `goal_id=eq.${id}` }],
  )
}

/** Peserta sebuah goal. Realtime: perubahan `goal_participants` untuk goal ini. */
export function useGoalParticipants(goalId: string | null | undefined): SharedQuery<GoalParticipant[]> {
  return useSharedQuery<GoalParticipant[]>(
    goalId ?? null,
    NO_PARTICIPANTS,
    (id) => listGoalParticipants(id),
    (id) => [{ table: 'goal_participants', filter: `goal_id=eq.${id}` }],
  )
}

/** Halaman pertama aktivitas grup (terbaru dulu). Halaman berikutnya: `listGroupActivity(id, { cursor })`. */
export function useGroupActivity(groupId: string | null | undefined): SharedQuery<GroupActivity[]> {
  return useSharedQuery<GroupActivity[]>(
    groupId ?? null,
    NO_ACTIVITY,
    (id) => listGroupActivity(id),
    (id) => [{ table: 'group_activity', filter: `group_id=eq.${id}` }],
  )
}
