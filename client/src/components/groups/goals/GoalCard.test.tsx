import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'

vi.mock('../../../lib/supabase', () => ({ supabase: {} }))

vi.mock('../../../hooks/useGroupGoals', () => ({
  useGoalParticipants: vi.fn(),
  useGoalContributions: vi.fn(),
}))

import { GoalCard, type GoalCardProps } from './GoalCard'
import { useGoalContributions, useGoalParticipants } from '../../../hooks/useGroupGoals'
import type { Contribution, GoalParticipant, GroupGoal, GroupMember } from '../../../types/shared'

const ME = 'u1'
const OTHER = 'u2'

const members: GroupMember[] = [
  { userId: ME, name: 'Sari', role: 'owner', joinedAt: '2026-11-01T00:00:00Z', leftAt: null },
  { userId: OTHER, name: 'Budi', role: 'member', joinedAt: '2026-11-02T00:00:00Z', leftAt: null },
]

function goalWith(overrides: Partial<GroupGoal> = {}): GroupGoal {
  return {
    id: 'goal-1',
    groupId: 'g1',
    title: 'Laptop',
    targetAmount: 500000000,
    deadline: null,
    status: 'active',
    createdBy: ME,
    createdAt: '2026-11-01T00:00:00Z',
    updatedAt: '2026-11-01T00:00:00Z',
    ...overrides,
  }
}

function contribution(id: string, userId: string): Contribution {
  return {
    id,
    goalId: 'goal-1',
    userId,
    amount: 100000,
    contributedAt: '2026-11-10',
    note: null,
    createdAt: '2026-11-10T00:00:00Z',
    updatedAt: '2026-11-10T00:00:00Z',
    deletedAt: null,
  }
}

function mockDetails(participantIds: string[], rows: Contribution[] = []) {
  const participants: GoalParticipant[] = participantIds.map((userId) => ({ goalId: 'goal-1', userId }))
  vi.mocked(useGoalParticipants).mockReturnValue({
    data: participants,
    loading: false,
    error: null,
    refetch: vi.fn(),
  })
  vi.mocked(useGoalContributions).mockReturnValue({
    data: rows,
    loading: false,
    error: null,
    refetch: vi.fn(),
  })
}

function renderCard(overrides: Partial<GoalCardProps> = {}) {
  const props: GoalCardProps = {
    goal: goalWith(),
    progress: null,
    currency: 'IDR',
    members,
    userId: ME,
    isActiveMember: true,
    canManage: false,
    onEdit: vi.fn(),
    onChanged: vi.fn(),
    ...overrides,
  }
  render(<GoalCard {...props} />)
  return props
}

function expandDetail() {
  fireEvent.click(screen.getByRole('button', { name: 'Lihat detail' }))
}

describe('GoalCard — tombol sesuai izin', () => {
  beforeEach(() => {
    mockDetails([])
  })
  afterEach(() => cleanup())

  it('pengelola melihat "Ubah goal" pada goal aktif', () => {
    const props = renderCard({ canManage: true })
    fireEvent.click(screen.getByRole('button', { name: 'Ubah goal' }))
    expect(props.onEdit).toHaveBeenCalledWith(expect.objectContaining({ id: 'goal-1' }))
  })

  it('bukan pengelola tidak melihat "Ubah goal"', () => {
    renderCard({ canManage: false })
    expect(screen.queryByRole('button', { name: 'Ubah goal' })).toBeNull()
  })

  it('goal dibatalkan tidak menampilkan "Ubah goal", walaupun pengelola', () => {
    renderCard({ canManage: true, goal: goalWith({ status: 'cancelled' }) })
    expect(screen.queryByRole('button', { name: 'Ubah goal' })).toBeNull()
    expect(screen.getByText('Dibatalkan')).toBeTruthy()
  })

  it('peserta aktif pada goal aktif melihat "Setor" di detail', () => {
    mockDetails([ME])
    renderCard({ isActiveMember: true })
    expandDetail()
    expect(screen.getByRole('button', { name: 'Setor' })).toBeTruthy()
  })

  it('bukan peserta tidak melihat "Setor"', () => {
    mockDetails([OTHER])
    renderCard({ isActiveMember: true })
    expandDetail()
    expect(screen.queryByRole('button', { name: 'Setor' })).toBeNull()
  })

  it('goal dibatalkan menyembunyikan "Setor" meskipun peserta', () => {
    mockDetails([ME])
    renderCard({ isActiveMember: true, goal: goalWith({ status: 'cancelled' }) })
    expandDetail()
    expect(screen.queryByRole('button', { name: 'Setor' })).toBeNull()
  })

  it('mantan anggota (bukan anggota aktif) tidak melihat "Setor"', () => {
    mockDetails([ME])
    renderCard({ isActiveMember: false })
    expandDetail()
    expect(screen.queryByRole('button', { name: 'Setor' })).toBeNull()
  })

  it('tombol "Ubah" setoran hanya untuk setoran sendiri', () => {
    mockDetails([ME], [contribution('c-own', ME), contribution('c-other', OTHER)])
    renderCard({ isActiveMember: true })
    expandDetail()
    expect(screen.getAllByRole('button', { name: 'Ubah' })).toHaveLength(1)
  })

  it('tidak ada tombol "Ubah" setoran ketika goal dibatalkan', () => {
    mockDetails([ME], [contribution('c-own', ME)])
    renderCard({ isActiveMember: true, goal: goalWith({ status: 'cancelled' }) })
    expandDetail()
    expect(screen.queryByRole('button', { name: 'Ubah' })).toBeNull()
  })
})
