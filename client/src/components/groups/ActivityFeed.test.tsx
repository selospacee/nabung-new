import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react'

vi.mock('../../lib/supabase', () => ({ supabase: {} }))

vi.mock('../../lib/sharedSavings', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../lib/sharedSavings')>()
  return { ...actual, listGroupActivity: vi.fn() }
})

vi.mock('../../hooks/useGroupGoals', () => ({
  useGroupActivity: vi.fn(),
}))

import { ActivityFeed, ACTIVITY_PAGE_SIZE, mergeActivity } from './ActivityFeed'
import { listGroupActivity } from '../../lib/sharedSavings'
import { useGroupActivity } from '../../hooks/useGroupGoals'
import type { GroupActivity, GroupMember } from '../../types/shared'

const members: GroupMember[] = [
  { userId: 'u1', name: 'Sari', role: 'owner', joinedAt: '2026-11-01T00:00:00Z', leftAt: null },
  { userId: 'u2', name: 'Budi', role: 'member', joinedAt: '2026-11-02T00:00:00Z', leftAt: null },
]

function leftEvent(id: string, createdAt: string): GroupActivity {
  return {
    id,
    groupId: 'g1',
    actorId: 'u2',
    createdAt,
    action: 'member_left',
    ref: { userId: 'u2' },
  } as GroupActivity
}

function setActivity(data: GroupActivity[]) {
  vi.mocked(useGroupActivity).mockReturnValue({
    data,
    loading: false,
    error: null,
    refetch: vi.fn(),
  })
}

function renderFeed() {
  return render(<ActivityFeed groupId="g1" members={members} currency="IDR" />)
}

describe('ActivityFeed', () => {
  beforeEach(() => {
    vi.mocked(listGroupActivity).mockReset()
  })
  afterEach(() => cleanup())

  it('menampilkan kalimat per aksi dengan nama anggota', () => {
    setActivity([leftEvent('a1', '2026-11-10T08:00:00Z')])
    renderFeed()
    expect(screen.getByText('Budi keluar dari grup')).toBeTruthy()
  })

  it('kosong: menampilkan pesan belum ada aktivitas', () => {
    setActivity([])
    renderFeed()
    expect(screen.getByText('Belum ada aktivitas')).toBeTruthy()
  })

  it('aktivitas hari ini dikelompokkan di bawah "Hari ini"', () => {
    setActivity([leftEvent('a1', new Date().toISOString())])
    renderFeed()
    expect(screen.getByRole('region', { name: 'Hari ini' })).toBeTruthy()
  })

  it('tanpa halaman berikutnya tidak ada tombol "Muat lebih banyak"', () => {
    setActivity([leftEvent('a1', '2026-11-10T08:00:00Z')])
    renderFeed()
    expect(screen.queryByRole('button', { name: 'Muat lebih banyak' })).toBeNull()
  })

  it('muat lebih banyak memakai cursor dari baris terakhir', async () => {
    const page: GroupActivity[] = Array.from({ length: ACTIVITY_PAGE_SIZE }, (_, i) =>
      leftEvent(`a${String(i).padStart(3, '0')}`, new Date(Date.UTC(2026, 10, 10, 12, 0) - i * 60_000).toISOString()),
    )
    const oldest = page[page.length - 1]
    setActivity(page)
    vi.mocked(listGroupActivity).mockResolvedValue([leftEvent('older-1', '2026-11-01T00:00:00Z')])
    renderFeed()

    fireEvent.click(screen.getByRole('button', { name: 'Muat lebih banyak' }))

    expect(listGroupActivity).toHaveBeenCalledWith('g1', {
      limit: ACTIVITY_PAGE_SIZE,
      cursor: expect.objectContaining({ createdAt: oldest.createdAt, id: oldest.id }),
    })
    // Halaman tambahan kurang dari ukuran halaman: tombol hilang setelah state diperbarui.
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Muat lebih banyak' })).toBeNull())
    expect(screen.getAllByText('Budi keluar dari grup')).toHaveLength(ACTIVITY_PAGE_SIZE + 1)
  })

  it('gagal muat lebih banyak menampilkan galat dan tombol tetap ada', async () => {
    const page: GroupActivity[] = Array.from({ length: ACTIVITY_PAGE_SIZE }, (_, i) =>
      leftEvent(`b${String(i).padStart(3, '0')}`, new Date(Date.UTC(2026, 10, 10, 12, 0) - i * 60_000).toISOString()),
    )
    setActivity(page)
    vi.mocked(listGroupActivity).mockRejectedValue(new Error('jaringan putus'))
    renderFeed()

    fireEvent.click(screen.getByRole('button', { name: 'Muat lebih banyak' }))

    expect(await screen.findByRole('alert')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Muat lebih banyak' })).toBeTruthy()
    expect(listGroupActivity).toHaveBeenCalledTimes(1)
  })
})

describe('mergeActivity', () => {
  it('membuang duplikat id dan mengurutkan terbaru dulu', () => {
    const a = leftEvent('x', '2026-11-10T08:00:00Z')
    const b = leftEvent('y', '2026-11-11T08:00:00Z')
    const merged = mergeActivity([a], [b, a])
    expect(merged.map((m) => m.id)).toEqual(['y', 'x'])
  })
})
