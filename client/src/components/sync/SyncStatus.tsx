import { useSyncExternalStore } from 'react'
import { AlertCircle, CheckCircle, CloudOff, RefreshCw } from 'lucide-react'
import { getSyncState, subscribeSyncState, FAILURE_WARNING_THRESHOLD, type SyncState } from '../../db/syncStatus'

export function useSyncState(): SyncState {
  return useSyncExternalStore(subscribeSyncState, getSyncState, getSyncState)
}

function describe(state: SyncState): { label: string; tone: string; icon: 'ok' | 'busy' | 'error' | 'offline' } {
  if (state.phase === 'offline') return { label: 'Offline', tone: 'text-muted-foreground', icon: 'offline' }
  if (state.phase === 'syncing') return { label: 'Menyinkronkan…', tone: 'text-muted-foreground', icon: 'busy' }
  if (state.phase === 'error') {
    return { label: `Gagal (${state.consecutiveFailures})`, tone: 'text-destructive', icon: 'error' }
  }
  return { label: 'Tersinkron', tone: 'text-success', icon: 'ok' }
}

function Icon({ kind }: { kind: ReturnType<typeof describe>['icon'] }) {
  const cls = 'w-3.5 h-3.5 shrink-0'
  if (kind === 'busy') return <RefreshCw className={`${cls} animate-spin`} aria-hidden />
  if (kind === 'error') return <AlertCircle className={cls} aria-hidden />
  if (kind === 'offline') return <CloudOff className={cls} aria-hidden />
  return <CheckCircle className={cls} aria-hidden />
}

/** Indikator ringkas untuk AppShell. Di layar kecil hanya ikon, teks tersedia untuk pembaca layar. */
export function SyncIndicator() {
  const state = useSyncState()
  const { label, tone, icon } = describe(state)
  const title = [
    label,
    state.lastSyncedAt ? `Terakhir: ${new Date(state.lastSyncedAt).toLocaleTimeString()}` : null,
    state.pending > 0 ? `${state.pending} perubahan tertunda` : null,
    state.lastError,
  ].filter(Boolean).join(' · ')

  return (
    <span
      role="status"
      aria-live="polite"
      title={title}
      className={`inline-flex items-center gap-1 text-xs shrink-0 ${tone}`}
    >
      <Icon kind={icon} />
      <span className="hidden sm:inline">{label}</span>
      <span className="sr-only sm:hidden">{label}</span>
      {state.pending > 0 && <span className="hidden sm:inline">· {state.pending}</span>}
    </span>
  )
}

/** Panel rinci untuk Settings: status, galat per tabel, peringatan, dan tombol Sync sekarang. */
export function SyncPanel({ onSyncNow, busy }: { onSyncNow: () => void; busy: boolean }) {
  const state = useSyncState()
  const failing = state.consecutiveFailures >= FAILURE_WARNING_THRESHOLD
  const errors = Object.entries(state.tableErrors)

  return (
    <div className="space-y-3 text-sm">
      {failing && (
        <div role="alert" className="p-3 rounded-lg border border-destructive/40 bg-destructive/10 text-destructive">
          <p className="font-medium">Sinkronisasi gagal {state.consecutiveFailures} kali berturut-turut.</p>
          <p className="text-xs mt-1">
            Data tetap tersimpan di perangkat ini dan akan dicoba lagi otomatis. Periksa koneksi, lalu tekan
            "Sync sekarang". Bila berlanjut, periksa daftar galat di bawah.
          </p>
        </div>
      )}

      <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-muted-foreground">
        <dt>Status</dt>
        <dd className="text-foreground">{describe(state).label}</dd>
        <dt>Terakhir sinkron</dt>
        <dd className="text-foreground">
          {state.lastSyncedAt ? new Date(state.lastSyncedAt).toLocaleString() : 'Belum pernah'}
        </dd>
        <dt>Perubahan tertunda</dt>
        <dd className="text-foreground">{state.pending}</dd>
        <dt>Realtime</dt>
        <dd className="text-foreground">
          {state.realtime === 'live' ? 'Tersambung' : state.realtime === 'down' ? 'Terputus (polling aktif)' : 'Menyambung'}
        </dd>
        <dt>Konflik diselesaikan</dt>
        <dd className="text-foreground">{state.conflicts}</dd>
      </dl>

      {errors.length > 0 && (
        <div className="p-3 rounded-lg bg-secondary text-xs">
          <p className="font-medium text-foreground mb-1">Galat terakhir per tabel</p>
          <ul className="list-disc list-inside space-y-1 max-h-40 overflow-y-auto text-muted-foreground">
            {errors.map(([table, message]) => (
              <li key={table}>
                <span className="font-medium text-foreground">{table}:</span> {message}
              </li>
            ))}
          </ul>
        </div>
      )}

      <button
        type="button"
        onClick={onSyncNow}
        disabled={busy}
        className="inline-flex items-center gap-2 px-3 py-2 rounded-md border border-border hover:bg-secondary disabled:opacity-50"
      >
        <RefreshCw className={`w-4 h-4 ${busy ? 'animate-spin' : ''}`} aria-hidden />
        Sync sekarang
      </button>
    </div>
  )
}
