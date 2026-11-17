/**
 * Status sinkronisasi yang terlihat oleh UI (indikator di AppShell dan panel di Settings).
 * Modul ini tidak bergantung pada React; UI membacanya lewat useSyncExternalStore.
 */

export type SyncPhase = 'idle' | 'syncing' | 'error' | 'offline'
export type RealtimeState = 'connecting' | 'live' | 'down'

export interface SyncState {
  phase: SyncPhase
  lastSyncedAt: string | null
  /** Jumlah baris lokal yang belum terkirim (penanda _dirty). */
  pending: number
  /** Galat terakhir per tabel (kunci "pull" untuk galat pull). Kosong bila siklus terakhir bersih. */
  tableErrors: Record<string, string>
  lastError: string | null
  consecutiveFailures: number
  /** Jumlah konflik yang diselesaikan dengan versi server yang lebih baru (sejak sesi dibuka). */
  conflicts: number
  realtime: RealtimeState
}

/** Di atas jumlah ini, UI menampilkan peringatan yang jelas. */
export const FAILURE_WARNING_THRESHOLD = 3

const initialState: SyncState = {
  phase: 'idle',
  lastSyncedAt: null,
  pending: 0,
  tableErrors: {},
  lastError: null,
  consecutiveFailures: 0,
  conflicts: 0,
  realtime: 'connecting',
}

let state: SyncState = { ...initialState }
const listeners = new Set<() => void>()

export function getSyncState(): SyncState {
  return state
}

export function patchSyncState(patch: Partial<SyncState>): void {
  state = { ...state, ...patch }
  for (const listener of listeners) listener()
}

export function subscribeSyncState(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export function bumpConflicts(count: number): void {
  patchSyncState({ conflicts: state.conflicts + count })
}

/** Hanya untuk tes: mengembalikan status ke keadaan awal. */
export function resetSyncState(): void {
  state = { ...initialState, tableErrors: {} }
  for (const listener of listeners) listener()
}
