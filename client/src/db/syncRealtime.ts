/**
 * Realtime Supabase untuk pemicu sinkronisasi. Event TIDAK pernah menimpa data lokal:
 * event hanya memicu pull+push terjadwal lewat `trigger`, yang digabung dan di-debounce.
 */
import { supabase } from '../lib/supabase'
import { patchSyncState } from './syncStatus'
import { isCovered } from './syncCore'

interface ChangePayload {
  table?: string
  new?: { updated_at?: string } | null
}

/** Tabel yang dipublikasikan ke supabase_realtime. cashiers tidak ada di publikasi: andalkan polling. */
export const REALTIME_TABLES = ['accounts', 'categories', 'transactions', 'budgets', 'savings_goals'] as const

export function subscribeRealtime(
  userId: string,
  trigger: (reason: string) => void,
  debounceMs = 400,
): () => void {
  let timer: ReturnType<typeof setTimeout> | null = null
  const onChange = (payload?: ChangePayload) => {
    // Gema tulisan sendiri (atau perubahan yang sudah tercakup pull) tidak perlu memicu pull.
    const table = payload?.table
    const updatedAt = payload?.new?.updated_at
    if (table && updatedAt && isCovered(userId, table, updatedAt)) return
    if (timer) clearTimeout(timer)
    timer = setTimeout(() => {
      timer = null
      trigger('realtime')
    }, debounceMs)
  }

  // Satu channel, satu .on per tabel, filter per user.
  const channel = supabase.channel(`sync:${userId}`)
  for (const table of REALTIME_TABLES) {
    channel.on(
      'postgres_changes',
      { event: '*', schema: 'public', table, filter: `user_id=eq.${userId}` },
      onChange,
    )
  }
  channel.on(
    'postgres_changes',
    { event: '*', schema: 'public', table: 'profiles', filter: `id=eq.${userId}` },
    onChange,
  )

  channel.subscribe((status: string) => {
    if (status === 'SUBSCRIBED') {
      patchSyncState({ realtime: 'live' })
      // Tersambung kembali: tarik perubahan yang terlewat selama terputus.
      trigger('reconnect')
    } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
      patchSyncState({ realtime: 'down' })
    }
  })

  return () => {
    if (timer) clearTimeout(timer)
    void supabase.removeChannel(channel)
  }
}
