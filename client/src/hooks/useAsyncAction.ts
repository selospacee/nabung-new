import { useCallback, useRef, useState } from 'react'

/**
 * Runs an async action at most once at a time.
 *
 * `pending` (state) drives the loading UI; the ref lock closes the gap between a click and the
 * re-render that disables the button, so a fast double click / Enter can never submit twice.
 */
export function useAsyncAction() {
  const lockRef = useRef(false)
  const [pending, setPending] = useState(false)

  const run = useCallback(async <T,>(fn: () => Promise<T>): Promise<T | undefined> => {
    if (lockRef.current) return undefined
    lockRef.current = true
    setPending(true)
    try {
      return await fn()
    } finally {
      lockRef.current = false
      setPending(false)
    }
  }, [])

  return { run, pending }
}
