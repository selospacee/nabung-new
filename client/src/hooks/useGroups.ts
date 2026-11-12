import { useCallback, useEffect, useRef, useState } from 'react'
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

/**
 * Pola bersama untuk hook Nabung Bareng:
 * - `key` adalah id aktif (null = tidak ada query). Hasil respons untuk key lama dibuang.
 * - Realtime memicu refetch query ini saja, bukan sinkronisasi penuh.
 * - Channel dilepas saat unmount dan saat key berganti (cleanup di effect).
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

    const subs = latest.current.subscriptions(key)
    if (subs.length === 0) return

    const id = ++channelSeq
    let channel = supabase.channel(`shared:${id}:${key}`)
    for (const sub of subs) {
      channel = channel.on(
        'postgres_changes',
        { event: '*', schema: 'public', table: sub.table, filter: sub.filter },
        () => {
          if (keyRef.current === key) void load(key)
        },
      )
    }
    channel.subscribe()

    return () => {
      // Buang respons yang masih terbang untuk key ini, lalu lepas channel.
      reqRef.current++
      keyRef.current = null
      supabase.removeChannel(channel)
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

const NO_GROUPS: Group[] = []

/** Daftar grup tempat saya anggota aktif. */
export function useMyGroups(): SharedQuery<Group[]> {
  return useSharedQuery<Group[]>(
    'me',
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
