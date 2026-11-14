import { GroupGoalsTab } from './goals'

interface GroupGoalsTabSlotProps {
  groupId: string
}

/**
 * Titik integrasi tab Goals di halaman grup. Hanya meneruskan ke GroupGoalsTab
 * (pintu masuk tunggal di ./goals); tidak ada logika data di sini.
 */
export function GroupGoalsTabSlot({ groupId }: GroupGoalsTabSlotProps) {
  return <GroupGoalsTab groupId={groupId} />
}
