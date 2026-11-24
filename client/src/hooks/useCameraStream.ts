import { useCallback, useEffect, useRef, useState } from 'react'
import { getPermissionStatus, CAMERA_DENIED_MESSAGE } from '../lib/permissions'

/**
 * Owns a camera MediaStream so it can ALWAYS be released.
 *
 * The stream lives in a ref (not only on the <video> element), so it can be stopped even when the
 * <video> is unmounted. It is stopped automatically when:
 *  - `stop()` is called,
 *  - the component using the hook unmounts,
 *  - the tab is hidden or the page is being left (privacy: no background camera).
 *
 * `videoRef` is a callback ref: the stream is attached whenever a <video> mounts, so the video
 * element may be rendered conditionally.
 */
export function useCameraStream() {
  const streamRef = useRef<MediaStream | null>(null)
  const videoElRef = useRef<HTMLVideoElement | null>(null)
  const requestIdRef = useRef(0)
  const pendingRef = useRef<{ facingMode: string; promise: Promise<MediaStream | null> } | null>(null)
  const [active, setActive] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const attach = useCallback(() => {
    const video = videoElRef.current
    const stream = streamRef.current
    if (video && stream && video.srcObject !== stream) {
      video.srcObject = stream
      void video.play().catch(() => {})
    }
  }, [])

  const videoRef = useCallback((el: HTMLVideoElement | null) => {
    videoElRef.current = el
    if (el) attach()
  }, [attach])

  const stop = useCallback(() => {
    // Invalidate any getUserMedia request still in flight so it releases its own stream.
    requestIdRef.current++
    pendingRef.current = null
    const stream = streamRef.current
    streamRef.current = null
    stream?.getTracks().forEach(t => t.stop())
    if (videoElRef.current) videoElRef.current.srcObject = null
    setActive(false)
  }, [])

  const start = useCallback((facingMode: 'user' | 'environment' = 'environment'): Promise<MediaStream | null> => {
    // Permintaan yang masih menunggu izin untuk mode yang sama dipakai ulang. Tombol "Open Camera" yang
    // ditekan saat prompt masih terbuka (atau auto-open ganda) tidak memanggil getUserMedia kedua.
    const pending = pendingRef.current
    if (pending && pending.facingMode === facingMode) return pending.promise
    stop()
    const requestId = requestIdRef.current
    setError(null)
    const promise = (async (): Promise<MediaStream | null> => {
      try {
        if (!navigator.mediaDevices?.getUserMedia) throw new Error('Camera is not supported in this browser.')
        // 'denied' berarti getUserMedia pasti gagal; cukup beri tahu pengguna, jangan minta lagi.
        if (await getPermissionStatus('camera') === 'denied') throw new Error(CAMERA_DENIED_MESSAGE)
        if (requestId !== requestIdRef.current) return null
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: facingMode } },
          audio: false,
        })
        // stop() was called (or another start()) while the permission prompt was open: release it.
        if (requestId !== requestIdRef.current) {
          stream.getTracks().forEach(t => t.stop())
          return null
        }
        streamRef.current = stream
        setActive(true)
        attach()
        return stream
      } catch (e: any) {
        if (requestId === requestIdRef.current) {
          setError(e?.name === 'NotAllowedError' ? CAMERA_DENIED_MESSAGE : (e?.message || 'Camera access denied.'))
          setActive(false)
        }
        return null
      }
    })()
    pendingRef.current = { facingMode, promise }
    void promise.finally(() => {
      if (pendingRef.current?.promise === promise) pendingRef.current = null
    })
    return promise
  }, [stop, attach])

  const getVideoTrack = useCallback(() => streamRef.current?.getVideoTracks()[0] ?? null, [])
  const getVideoEl = useCallback(() => videoElRef.current, [])

  // Release the camera on unmount and whenever the page is hidden/left.
  useEffect(() => {
    const onHidden = () => { if (document.visibilityState === 'hidden') stop() }
    document.addEventListener('visibilitychange', onHidden)
    window.addEventListener('pagehide', stop)
    return () => {
      document.removeEventListener('visibilitychange', onHidden)
      window.removeEventListener('pagehide', stop)
      stop()
    }
  }, [stop])

  return { videoRef, active, error, start, stop, getVideoTrack, getVideoEl }
}
