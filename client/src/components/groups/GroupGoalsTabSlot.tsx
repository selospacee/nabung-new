import { EmptyState } from '../ui'

interface GroupGoalsTabSlotProps {
  groupId: string
}

/**
 * Titik integrasi untuk tab Goals (Fase 3).
 * Fase 3 mengganti isi komponen ini; props `groupId` tetap. Jangan taruh logika data di sini.
 */
export function GroupGoalsTabSlot({ groupId: _groupId }: GroupGoalsTabSlotProps) {
  return (
    <EmptyState
      title="Goal belum tersedia"
      description="Fitur goal bersama akan hadir di pembaruan berikutnya."
    />
  )
}
