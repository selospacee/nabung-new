import { getGroupMembers } from '../lib/sharedSavings'
import type { GroupMember } from '../types/shared'
import { useSharedQuery, type SharedQuery } from './useGroups'

const NO_MEMBERS: GroupMember[] = []

/**
 * Anggota grup beserta nama (termasuk yang sudah keluar, ditandai `leftAt`).
 * Realtime: perubahan `group_members` untuk grup ini.
 */
export function useGroupMembers(groupId: string | null | undefined): SharedQuery<GroupMember[]> {
  return useSharedQuery<GroupMember[]>(
    groupId ?? null,
    NO_MEMBERS,
    (id) => getGroupMembers(id),
    (id) => [{ table: 'group_members', filter: `group_id=eq.${id}` }],
  )
}
