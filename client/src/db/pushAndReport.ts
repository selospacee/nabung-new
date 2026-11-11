import { pushLocalChangesToSupabase } from './sync'

/**
 * Push local changes and tell the user when it fails. Local data is already saved (offline-first)
 * and the auto-sync retries, but a silent failure is how data ends up "missing" on other devices.
 */
export async function pushAndReport(userId: string | null | undefined): Promise<boolean> {
  if (!userId) return false
  const result = await pushLocalChangesToSupabase(userId)
  if (!result.success) {
    console.error('[Push] failed:', result.errors)
    alert(
      'Tersimpan di perangkat ini, tetapi belum terkirim ke server (akan dicoba lagi otomatis).\n' +
      result.errors.map(e => `${e.table}: ${e.message}`).join('\n')
    )
  }
  return result.success
}
