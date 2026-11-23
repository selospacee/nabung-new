import { useCallback, useEffect, useState } from 'react'
import { normalizePermissionState, type MediaPermissionName, type MediaPermissionState } from '../utils/mediaPermission'

/**
 * Membaca status izin kamera/mikrofon lewat Permissions API TANPA memicu prompt.
 * Bila API/nama izin tidak didukung (mis. Safari) status tetap 'unknown'.
 * Status diperbarui saat izin berubah, dan saat halaman kembali terlihat.
 */
export function useMediaPermission(name: MediaPermissionName) {
  const [state, setState] = useState<MediaPermissionState>('unknown')

  const refresh = useCallback(async () => {
    try {
      const status = await navigator.permissions.query({ name: name as PermissionName })
      setState(normalizePermissionState(status.state))
    } catch {
      setState('unknown')
    }
  }, [name])

  useEffect(() => {
    let status: PermissionStatus | null = null
    let cancelled = false
    const onChange = () => { if (status) setState(normalizePermissionState(status.state)) }
    const onVisible = () => { if (document.visibilityState === 'visible') void refresh() }
    ;(async () => {
      try {
        const s = await navigator.permissions.query({ name: name as PermissionName })
        if (cancelled) return
        status = s
        setState(normalizePermissionState(s.state))
        s.addEventListener('change', onChange)
      } catch {
        if (!cancelled) setState('unknown')
      }
    })()
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      cancelled = true
      status?.removeEventListener('change', onChange)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [name, refresh])

  return { state, refresh }
}
