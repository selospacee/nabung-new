import { useCallback, useEffect, useRef, useState } from 'react'

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
    const stream = streamRef.current
    streamRef.current = null
    stream?.getTracks().forEach(t => t.stop())
    if (videoElRef.current) videoElRef.current.srcObject = null
    setActive(false)
  }, [])

  const start = useCallback(async (facingMode: 'user' | 'environment' = 'environment'): Promise<MediaStream | null> => {
    stop()
    const requestId = requestIdRef.current
    setError(null)
    try {
      if (!navigator.mediaDevices?.getUserMedia) throw new Error('Camera is not supported in this browser.')
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
        setError(e?.message || 'Camera access denied.')
        setActive(false)
      }
      return null
    }
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
