import { useEffect } from 'react'
import { requestSync, enableAutoRetry } from '../db/sync'
import { subscribeRealtime } from '../db/syncRealtime'
import { patchSyncState } from '../db/syncStatus'
import { useCurrentUser } from '../db/hooks'
import { seedDefaultsIfEmpty } from '../db/seedDefaults'

const POLL_MS = 30_000

/**
 * Memicu sinkronisasi lewat antrean tunggal (pull lalu push). Pemicu: mount, polling 30 detik,
 * fokus tab, online, visibilitychange, event realtime (digabung), dan reconnect realtime.
 */
export function useAutoSync(enabled = true) {
  const { userId } = useCurrentUser()

  useEffect(() => {
    if (!enabled || !userId) return
    enableAutoRetry(true)

    const trigger = (reason: string) => {
      requestSync(userId, reason).catch(error => console.error('[AutoSync]', reason, error))
    }

    const unsubscribeRealtime = subscribeRealtime(userId, trigger)
    const poll = setInterval(() => trigger('poll'), POLL_MS)

    const onFocus = () => trigger('focus')
    const onOnline = () => trigger('online')
    const onOffline = () => patchSyncState({ phase: 'offline' })
    const onVisible = () => {
      if (document.visibilityState === 'visible') trigger('visible')
    }

    window.addEventListener('focus', onFocus)
    window.addEventListener('online', onOnline)
    window.addEventListener('offline', onOffline)
    document.addEventListener('visibilitychange', onVisible)

    // Sinkron awal; bila pull sukses dan akun masih kosong, isi kategori/akun bawaan lalu sinkron lagi.
    requestSync(userId, 'initial')
      .then(async result => {
        if (result?.pull.ok && (await seedDefaultsIfEmpty(userId))) trigger('seed')
      })
      .catch(error => console.error('[AutoSync] initial', error))

    return () => {
      clearInterval(poll)
      unsubscribeRealtime()
      window.removeEventListener('focus', onFocus)
      window.removeEventListener('online', onOnline)
      window.removeEventListener('offline', onOffline)
      document.removeEventListener('visibilitychange', onVisible)
      enableAutoRetry(false)
    }
  }, [enabled, userId])

  return {
    syncNow: () => (userId ? requestSync(userId, 'manual') : Promise.resolve(null)),
  }
}
