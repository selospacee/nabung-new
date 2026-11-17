/**
 * Titik masuk sinkronisasi. Semua pull dan push lewat satu antrean:
 *   - tidak pernah berjalan bersamaan,
 *   - selalu pull dulu, lalu push,
 *   - permintaan yang datang saat siklus belum mulai digabung menjadi satu siklus.
 * Galat tidak pernah diam-diam: status diperbarui, dan push yang gagal diulang dengan backoff
 * bila auto-retry aktif. Penanda _dirty di Dexie memastikan tidak ada perubahan yang hilang.
 */
import {
  countPending,
  formatSupabaseError,
  pullFromServer,
  pushToServer,
  validateUserId,
  type PushResult,
} from './syncCore'
import { getSyncState, patchSyncState } from './syncStatus'

export type { PushResult } from './syncCore'

export interface CycleResult {
  pull: { ok: boolean; error?: string }
  push: PushResult
}

const RETRY_BASE_MS = 2_000
const RETRY_MAX_MS = 5 * 60_000

let running: Promise<CycleResult> | null = null
let queued: Promise<CycleResult> | null = null
let queuedKey: string | null = null
let retryTimer: ReturnType<typeof setTimeout> | null = null
let autoRetry = false

/** Aktifkan atau matikan retry otomatis (backoff) untuk push dan pull yang gagal. */
export function enableAutoRetry(on: boolean): void {
  autoRetry = on
  if (!on && retryTimer) {
    clearTimeout(retryTimer)
    retryTimer = null
  }
}

function scheduleRetry(userId: string, failures: number): void {
  if (!autoRetry || retryTimer) return
  const delay = Math.min(RETRY_BASE_MS * 2 ** Math.max(0, failures - 1), RETRY_MAX_MS)
  retryTimer = setTimeout(() => {
    retryTimer = null
    void requestSync(userId, 'retry').catch(() => undefined)
  }, delay)
}

/**
 * Minta satu siklus sinkronisasi lewat antrean tunggal. Siklus penuh (default) = pull lalu push.
 * `push: false` = pull saja (dipakai API pull). Semua tetap berurutan dan tidak pernah bersamaan.
 * Permintaan yang sejenis dan belum mulai digabung menjadi satu siklus.
 */
export function requestSync(userId: string, reason: string, options: { push?: boolean } = {}): Promise<CycleResult> {
  try {
    validateUserId(userId)
  } catch (error) {
    return Promise.reject(error)
  }
  const doPush = options.push !== false
  const key = `${userId}|${doPush ? 'full' : 'pull'}`
  // Siklus yang belum mulai dengan jenis yang sama menyerap permintaan ini.
  if (queued && queuedKey === key) return queued

  const previous = running ?? Promise.resolve(null)
  let job: Promise<CycleResult>
  job = previous.then(() => {
    if (queued === job) {
      queued = null
      queuedKey = null
    }
    return runCycle(userId, reason, doPush)
  })
  queued = job
  queuedKey = key
  running = job
  return job
}

async function runCycle(userId: string, reason: string, doPush: boolean): Promise<CycleResult> {
  if (retryTimer) {
    clearTimeout(retryTimer)
    retryTimer = null
  }
  console.log('[Sync] cycle start:', reason)

  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    const pending = await safeCountPending(userId)
    patchSyncState({ phase: 'offline', pending })
    return {
      pull: { ok: false, error: 'Offline' },
      push: { success: false, errors: [{ table: 'network', message: 'Offline' }] },
    }
  }

  patchSyncState({ phase: 'syncing' })

  // 1. Pull dulu. Kegagalan pull tidak menghentikan push: push aman karena LWW di sisi push.
  let pull: { ok: boolean; error?: string } = { ok: true }
  try {
    await pullFromServer(userId)
  } catch (error) {
    pull = { ok: false, error: formatSupabaseError(error) }
    console.error('[Sync] pull failed:', pull.error)
  }

  // 2. Lalu push (bila siklus ini penuh).
  let push: PushResult = { success: true, errors: [] }
  if (doPush) {
    try {
      push = await pushToServer(userId)
    } catch (error) {
      push = { success: false, errors: [{ table: 'unknown', message: formatSupabaseError(error) }] }
    }
  }

  const pending = await safeCountPending(userId)
  const tableErrors: Record<string, string> = {}
  if (doPush) {
    for (const e of push.errors) tableErrors[e.table] = e.message
  } else {
    // Siklus pull saja tidak boleh menghapus galat push yang belum teratasi.
    for (const [table, message] of Object.entries(getSyncState().tableErrors)) {
      if (table !== 'pull') tableErrors[table] = message
    }
  }
  if (!pull.ok && pull.error) tableErrors.pull = pull.error

  if (pull.ok && Object.keys(tableErrors).length === 0) {
    patchSyncState({
      phase: 'idle',
      lastSyncedAt: new Date().toISOString(),
      pending,
      tableErrors: {},
      lastError: null,
      consecutiveFailures: 0,
    })
  } else {
    const failures = getSyncState().consecutiveFailures + 1
    const lastError = Object.values(tableErrors)[0] ?? 'Sinkronisasi gagal'
    patchSyncState({
      phase: 'error',
      pending,
      tableErrors,
      lastError,
      consecutiveFailures: failures,
    })
    scheduleRetry(userId, failures)
  }

  return { pull, push }
}

async function safeCountPending(userId: string): Promise<number> {
  try {
    return await countPending(userId)
  } catch {
    return getSyncState().pending
  }
}

/** Pull saja, lewat antrean. Melempar bila pull gagal (perilaku lama dipertahankan). */
export async function syncUserDataFromSupabase(userId: string): Promise<void> {
  const result = await requestSync(userId, 'pull', { push: false })
  if (!result.pull.ok) throw new Error(result.pull.error ?? 'Pull failed')
}

/** Pull lalu push, lewat antrean. Mengembalikan hasil push seperti sebelumnya. */
export async function pushLocalChangesToSupabase(userId: string): Promise<PushResult> {
  const result = await requestSync(userId, 'push')
  return result.push
}
