import { useEffect, useRef } from 'react'
import { supabase } from '../lib/supabase'
import { syncUserDataFromSupabase, pushLocalChangesToSupabase } from '../db/sync'
import { useCurrentUser } from '../db/hooks'

type RealtimePayload = {
  eventType: 'INSERT' | 'UPDATE' | 'DELETE'
  new: Record<string, any> | null
  old: Record<string, any> | null
}

export function useAutoSync(enabled = true) {
  const { userId } = useCurrentUser()
  const intervalRef = useRef<NodeJS.Timeout | null>(null)
  const channelRef = useRef<any>(null)
  const isSyncingRef = useRef(false)
  const pushIntervalRef = useRef<NodeJS.Timeout | null>(null)

  const doSync = async (source: string) => {
    if (!userId || isSyncingRef.current) return
    isSyncingRef.current = true
    try {
      console.log(`[AutoSync] ${source} sync for user:`, userId)
      await syncUserDataFromSupabase(userId)
      console.log(`[AutoSync] ${source} sync complete`)
    } catch (error) {
      console.error(`[AutoSync] ${source} sync error:`, error)
    } finally {
      isSyncingRef.current = false
    }
  }

  const doPush = async (source: string) => {
    if (!userId) return
    try {
      console.log(`[AutoSync] ${source} push for user:`, userId)
      const result = await pushLocalChangesToSupabase(userId)
      if (result.success) {
        console.log(`[AutoSync] ${source} push complete`)
      } else {
        console.warn(`[AutoSync] ${source} push had errors:`, result.errors)
      }
    } catch (error) {
      console.error(`[AutoSync] ${source} push error:`, error)
    }
  }

  useEffect(() => {
    if (!enabled || !userId) return

    // 1. Initial sync on mount (pull from Supabase)
    doSync('initial')

    // 2. Periodic sync every 30 seconds (pull from Supabase)
    intervalRef.current = setInterval(() => {
      doSync('periodic')
    }, 30_000)

    // 2b. Periodic push every 60 seconds (push local changes to Supabase)
    pushIntervalRef.current = setInterval(() => {
      doPush('periodic')
    }, 60_000)

    // 3. Supabase Realtime for instant sync (pull from Supabase)
    channelRef.current = supabase
      .channel(`sync:${userId}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          filter: `user_id=eq.${userId}`,
        },
        (payload: RealtimePayload) => {
          console.log('[AutoSync] Realtime change:', payload.eventType, payload.new?.id || payload.old?.id)
          // Debounce rapid changes
          setTimeout(() => doSync('realtime'), 500)
        }
      )
      .subscribe()

    // 4. Sync when window gains focus (user switched back to tab) - pull AND push
    const handleFocus = () => {
      doSync('focus')
      doPush('focus')
    }
    window.addEventListener('focus', handleFocus)

    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current)
      if (pushIntervalRef.current) clearInterval(pushIntervalRef.current)
      if (channelRef.current) {
        supabase.removeChannel(channelRef.current)
      }
      window.removeEventListener('focus', handleFocus)
    }
  }, [enabled, userId])

  // Expose manual sync trigger
  return { syncNow: () => { doSync('manual'); doPush('manual') } }
}