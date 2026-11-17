import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'

vi.mock('../../lib/supabase', () => ({ supabase: {} }))

vi.mock('../../lib/sharedSavings', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../lib/sharedSavings')>()
  return {
    ...actual,
    leaveGroup: vi.fn(),
    transferOwnership: vi.fn(),
    regenerateInviteCode: vi.fn(),
  }
})

import { GroupMembersTab } from './GroupMembersTab'
import type { Group, GroupMember } from '../../types/shared'

const OWNER = 'user-owner'
const MEMBER = 'user-member'

const group: Group = {
  id: 'g1',
  name: 'Dana Liburan',
  type: 'circle',
  currency: 'IDR',
  inviteCode: 'ABCD1234',
  createdBy: OWNER,
  createdAt: '2026-11-01T00:00:00Z',
  updatedAt: '2026-11-01T00:00:00Z',
}

const members: GroupMember[] = [
  { userId: OWNER, name: 'Sari', role: 'owner', joinedAt: '2026-11-01T00:00:00Z', leftAt: null },
  { userId: MEMBER, name: 'Budi', role: 'member', joinedAt: '2026-11-02T00:00:00Z', leftAt: null },
]

function renderTab(currentUserId: string) {
  return render(
    <GroupMembersTab
      group={group}
      members={members}
      currentUserId={currentUserId}
      onChanged={vi.fn()}
      onLeft={vi.fn()}
    />,
  )
}

describe('GroupMembersTab', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })
  afterEach(() => cleanup())

  it('owner melihat tombol pindahkan kepemilikan untuk anggota lain', () => {
    renderTab(OWNER)
    expect(screen.getByRole('button', { name: 'Jadikan pemilik' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Perbarui kode undangan' })).toBeTruthy()
  })

  it('member biasa tidak melihat aksi owner', () => {
    renderTab(MEMBER)
    expect(screen.queryByRole('button', { name: 'Jadikan pemilik' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Perbarui kode undangan' })).toBeNull()
    expect(screen.getByRole('button', { name: 'Keluar dari grup' })).toBeTruthy()
  })

  it('tombol keluar memunculkan dialog konfirmasi lebih dulu', () => {
    renderTab(MEMBER)
    fireEvent.click(screen.getByRole('button', { name: 'Keluar dari grup' }))
    expect(screen.getByText('Keluar dari grup?')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Batal' })).toBeTruthy()
  })
})
