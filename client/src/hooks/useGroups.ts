import { useCallback, useEffect, useRef, useState } from 'react'
import type { RealtimeChannel } from '@supabase/supabase-js'
import { supabase } from '../lib/supabase'
import { getGroup, listMyGroups, SharedSavingsError, toSharedSavingsError } from '../lib/sharedSavings'
import type { Group } from '../types/shared'

export interface SharedQuery<T> {
  data: T
  loading: boolean
  error: SharedSavingsError | null
  refetch: () => Promise<void>
}

/** Satu tabel yang dipantau realtime. `filter` memakai sintaks Realtime, mis. `group_id=eq.<id>`. */
export interface RealtimeSubscription {
  table: string
  filter?: string
}

interface QueryState<T> {
  key: string | null
  data: T
  error: SharedSavingsError | null
  loaded: boolean
}

let channelSeq = 0

/** Status channel yang berarti event bisa terlewat; setelah SUBSCRIBED lagi, query dimuat ulang. */
const DOWN_STATUSES = new Set(['CHANNEL_ERROR', 'TIMED_OUT', 'CLOSED'])

/**
 * Pola bersama untuk hook Nabung Bareng:
 * - `key` adalah id aktif (null = tidak ada query). Hasil respons untuk key lama dibuang.
 * - Realtime memicu refetch query ini saja, bukan sinkronisasi penuh.
 * - Refetch juga terjadi saat channel kembali SUBSCRIBED setelah putus, dan saat tab kembali terlihat,
 *   supaya event yang terlewat terkejar.
 * - Channel dan listener dilepas saat unmount dan saat key berganti (cleanup di effect).
 */
export function useSharedQuery<T>(
  key: string | null,
  empty: T,
  fetcher: (key: string) => Promise<T>,
  subscriptions: (key: string) => RealtimeSubscription[] = () => [],
): SharedQuery<T> {
  const [state, setState] = useState<QueryState<T>>({ key: null, data: empty, error: null, loaded: false })

  // Ref supaya callback realtime & fetch selalu memakai fetcher/empty terbaru tanpa masuk dependensi effect.
  const latest = useRef({ fetcher, subscriptions, empty })
  const keyRef = useRef<string | null>(key)
  const reqRef = useRef(0)

  useEffect(() => {
    latest.current = { fetcher, subscriptions, empty }
  })

  const load = useCallback(async (k: string) => {
    const req = ++reqRef.current
    try {
      const data = await latest.current.fetcher(k)
      if (req !== reqRef.current) return
      setState({ key: k, data, error: null, loaded: true })
    } catch (err) {
      if (req !== reqRef.current) return
      setState((prev: QueryState<T>) => ({
        key: k,
        data: prev.key === k ? prev.data : latest.current.empty,
        error: toSharedSavingsError(err),
        loaded: true,
      }))
    }
  }, [])

  useEffect(() => {
    keyRef.current = key
    if (key === null) return

    void load(key)

    const onVisible = () => {
      if (document.visibilityState === 'visible' && keyRef.current === key) void load(key)
    }
    document.addEventListener('visibilitychange', onVisible)

    let channel: RealtimeChannel | null = null
    const subs = latest.current.subscriptions(key)
    if (subs.length > 0) {
      let ch = supabase.channel(`shared:${++channelSeq}:${key}`)
      for (const sub of subs) {
        ch = ch.on(
          'postgres_changes',
          { event: '*', schema: 'public', table: sub.table, filter: sub.filter },
          () => {
            if (keyRef.current === key) void load(key)
          },
        )
      }
      let wasDown = false
      ch.subscribe((status: string) => {
        if (DOWN_STATUSES.has(status)) {
          wasDown = true
          return
        }
        if (status === 'SUBSCRIBED' && wasDown) {
          wasDown = false
          if (keyRef.current === key) void load(key)
        }
      })
      channel = ch
    }

    return () => {
      document.removeEventListener('visibilitychange', onVisible)
      // Buang respons yang masih terbang untuk key ini, lalu lepas channel.
      reqRef.current++
      keyRef.current = null
      if (channel) supabase.removeChannel(channel)
    }
  }, [key, load])

  const refetch = useCallback(async () => {
    if (keyRef.current !== null) await load(keyRef.current)
  }, [load])

  // Hasil dari key lain (atau belum dimuat) tidak boleh terlihat sebagai data key ini.
  const isCurrent = state.key === key
  return {
    data: isCurrent ? state.data : empty,
    loading: key !== null && !(isCurrent && state.loaded),
    error: isCurrent ? state.error : null,
    refetch,
  }
}

/**
 * Id user yang sedang login. `undefined` = belum diketahui, `null` = tidak ada session.
 * Mengikuti perubahan akun (login, logout, ganti akun).
 */
export function useAuthUserId(): string | null | undefined {
  const [userId, setUserId] = useState<string | null | undefined>(undefined)

  useEffect(() => {
    let active = true
    supabase.auth
      .getSession()
      .then(({ data }: { data: { session: { user: { id: string } } | null } }) => {
        if (active) setUserId(data.session?.user.id ?? null)
      })
      .catch(() => {
        if (active) setUserId(null)
      })
    const { data: sub } = supabase.auth.onAuthStateChange((_event: string, session: { user: { id: string } } | null) => {
      if (active) setUserId(session?.user.id ?? null)
    })
    return () => {
      active = false
      sub.subscription.unsubscribe()
    }
  }, [])

  return userId
}

const NO_GROUPS: Group[] = []

/**
 * Daftar grup tempat saya anggota aktif. Key memuat id user, sehingga daftar akun sebelumnya
 * tidak pernah terlihat setelah ganti akun. Tanpa user, key null (tidak ada query).
 */
export function useMyGroups(): SharedQuery<Group[]> {
  const userId = useAuthUserId()
  const key = userId ? `me:${userId}` : null
  return useSharedQuery<Group[]>(
    key,
    NO_GROUPS,
    () => listMyGroups(),
    () => [{ table: 'group_members' }, { table: 'groups' }],
  )
}

/** Satu grup. `data` null bila grup tidak ditemukan atau tidak bisa dilihat. */
export function useGroup(groupId: string | null | undefined): SharedQuery<Group | null> {
  return useSharedQuery<Group | null>(
    groupId ?? null,
    null,
    (id) => getGroup(id),
    (id) => [
      { table: 'groups', filter: `id=eq.${id}` },
      { table: 'group_members', filter: `group_id=eq.${id}` },
    ],
  )
}
