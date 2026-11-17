/**
 * Tes hook Nabung Bareng: isolasi per akun, pemulihan realtime, dan refetch saat tab terlihat lagi.
 * Batas Supabase (client, auth, channel) dan fungsi lib di-mock.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { act, cleanup, renderHook, waitFor } from '@testing-library/react'
import type { Group } from '../types/shared'

const h = vi.hoisted(() => {
  const state = {
    session: null as { user: { id: string } } | null,
    authCb: null as null | ((event: string, session: unknown) => void),
    channelCb: null as null | ((status: string) => void),
    visibility: 'visible' as 'visible' | 'hidden',
  }
  const chan = {
    on: () => chan,
    subscribe: (cb: (status: string) => void) => {
      state.channelCb = cb
      return chan
    },
  }
  const supabase = {
    channel: vi.fn(() => chan),
    removeChannel: vi.fn(),
    auth: {
      getSession: vi.fn(async () => ({ data: { session: state.session }, error: null })),
      onAuthStateChange: vi.fn((cb: (event: string, session: unknown) => void) => {
        state.authCb = cb
        return { data: { subscription: { unsubscribe: vi.fn() } } }
      }),
    },
  }
  const listMyGroups = vi.fn(async (): Promise<Group[]> => [])
  const getGroup = vi.fn(async (): Promise<Group | null> => null)
  return { state, supabase, listMyGroups, getGroup }
})

vi.mock('../lib/supabase', () => ({ supabase: h.supabase }))
vi.mock('../lib/sharedSavings', async (importOriginal: () => Promise<Record<string, unknown>>) => ({
  ...(await importOriginal()),
  listMyGroups: h.listMyGroups,
  getGroup: h.getGroup,
}))

import { useGroup, useMyGroups } from './useGroups'

const USER_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const USER_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'

function groupFor(id: string, name: string): Group {
  return {
    id,
    name,
    type: 'couple',
    currency: 'IDR',
    inviteCode: 'AB12CD34',
    createdBy: null,
    createdAt: '2026-11-01T00:00:00Z',
    updatedAt: '2026-11-01T00:00:00Z',
  }
}

const GROUP_OF_A = groupFor('g-a', 'Grup milik A')
const GROUP_OF_B = groupFor('g-b', 'Grup milik B')

beforeEach(() => {
  h.state.session = { user: { id: USER_A } }
  h.state.authCb = null
  h.state.channelCb = null
  h.state.visibility = 'visible'
  h.listMyGroups.mockReset()
  h.listMyGroups.mockImplementation(async () => (h.state.session?.user.id === USER_A ? [GROUP_OF_A] : [GROUP_OF_B]))
  h.getGroup.mockReset()
  h.getGroup.mockImplementation(async () => groupFor('g1', 'Rumah'))
  h.supabase.removeChannel.mockClear()
  Object.defineProperty(document, 'visibilityState', {
    configurable: true,
    get: () => h.state.visibility,
  })
})

afterEach(() => {
  cleanup()
})

describe('useMyGroups: isolasi per akun', () => {
  it('data user A tidak pernah terlihat setelah ganti ke user B', async () => {
    const snapshots: string[][] = []
    const { result } = renderHook(() => {
      const r = useMyGroups()
      snapshots.push(r.data.map((g: Group) => g.id))
      return r
    })

    await waitFor(() => expect(result.current.data.map((g: Group) => g.id)).toEqual(['g-a']))

    const mark = snapshots.length
    h.state.session = { user: { id: USER_B } }
    await act(async () => {
      h.state.authCb?.('SIGNED_IN', h.state.session)
    })

    await waitFor(() => expect(result.current.data.map((g: Group) => g.id)).toEqual(['g-b']))

    const afterSwitch = snapshots.slice(mark)
    expect(afterSwitch.length).toBeGreaterThan(0)
    expect(afterSwitch.some((ids) => ids.includes('g-a'))).toBe(false)
  })

  it('tanpa user, tidak ada query dan data kosong', async () => {
    h.state.session = null
    const { result } = renderHook(() => useMyGroups())
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.data).toEqual([])
    expect(h.listMyGroups).not.toHaveBeenCalled()
  })
})

describe('useSharedQuery: pemulihan realtime', () => {
  it('channel putus (CHANNEL_ERROR) lalu SUBSCRIBED lagi memicu refetch', async () => {
    renderHook(() => useGroup('g1'))
    await waitFor(() => expect(h.getGroup).toHaveBeenCalledTimes(1))

    act(() => h.state.channelCb?.('CHANNEL_ERROR'))
    act(() => h.state.channelCb?.('SUBSCRIBED'))

    await waitFor(() => expect(h.getGroup).toHaveBeenCalledTimes(2))
  })

  it('TIMED_OUT dan CLOSED juga dianggap putus; SUBSCRIBED awal tanpa putus tidak refetch', async () => {
    renderHook(() => useGroup('g1'))
    await waitFor(() => expect(h.getGroup).toHaveBeenCalledTimes(1))

    act(() => h.state.channelCb?.('SUBSCRIBED'))
    await new Promise((r) => setTimeout(r, 10))
    expect(h.getGroup).toHaveBeenCalledTimes(1)

    act(() => h.state.channelCb?.('TIMED_OUT'))
    act(() => h.state.channelCb?.('SUBSCRIBED'))
    await waitFor(() => expect(h.getGroup).toHaveBeenCalledTimes(2))

    act(() => h.state.channelCb?.('CLOSED'))
    act(() => h.state.channelCb?.('SUBSCRIBED'))
    await waitFor(() => expect(h.getGroup).toHaveBeenCalledTimes(3))
  })

  it('tab kembali visible memicu refetch; tab hidden tidak', async () => {
    renderHook(() => useGroup('g1'))
    await waitFor(() => expect(h.getGroup).toHaveBeenCalledTimes(1))

    h.state.visibility = 'hidden'
    act(() => {
      document.dispatchEvent(new Event('visibilitychange'))
    })
    await new Promise((r) => setTimeout(r, 10))
    expect(h.getGroup).toHaveBeenCalledTimes(1)

    h.state.visibility = 'visible'
    act(() => {
      document.dispatchEvent(new Event('visibilitychange'))
    })
    await waitFor(() => expect(h.getGroup).toHaveBeenCalledTimes(2))
  })

  it('unmount melepas channel dan listener visibilitychange', async () => {
    const { unmount } = renderHook(() => useGroup('g1'))
    await waitFor(() => expect(h.getGroup).toHaveBeenCalledTimes(1))
    unmount()
    expect(h.supabase.removeChannel).toHaveBeenCalled()

    h.state.visibility = 'visible'
    act(() => {
      document.dispatchEvent(new Event('visibilitychange'))
    })
    await new Promise((r) => setTimeout(r, 10))
    expect(h.getGroup).toHaveBeenCalledTimes(1)
  })
})
