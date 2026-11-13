import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import type { Contribution, GroupMember } from '../../../types/shared'
import { ContributorBreakdown } from './ContributorBreakdown'

const contribution = (over: Partial<Contribution>): Contribution => ({
  id: 'c',
  goalId: 'g1',
  userId: 'u1',
  amount: 100_000,
  contributedAt: '2026-11-10',
  note: null,
  createdAt: '2026-11-10T00:00:00Z',
  updatedAt: '2026-11-10T00:00:00Z',
  deletedAt: null,
  ...over,
})

const member = (over: Partial<GroupMember>): GroupMember => ({
  userId: 'u1',
  name: 'Ayu',
  role: 'member',
  joinedAt: '2026-11-01T00:00:00Z',
  leftAt: null,
  ...over,
})

describe('ContributorBreakdown', () => {
  it('tanpa setoran menampilkan keadaan kosong', () => {
    render(<ContributorBreakdown contributions={[]} members={[member({})]} currency="IDR" />)
    expect(screen.getByText('Belum ada setoran untuk dihitung.')).toBeTruthy()
  })

  it('menampilkan nama dari daftar anggota, persentase, dan total', () => {
    const contributions = [
      contribution({ id: 'a', userId: 'u1', amount: 300_000 }),
      contribution({ id: 'b', userId: 'u2', amount: 100_000 }),
    ]
    const members = [member({ userId: 'u1', name: 'Ayu' }), member({ userId: 'u2', name: 'Budi' })]
    render(<ContributorBreakdown contributions={contributions} members={members} currency="IDR" />)

    expect(screen.getByText('Ayu')).toBeTruthy()
    expect(screen.getByText('Budi')).toBeTruthy()
    expect(screen.getByText(/75%/)).toBeTruthy()
    expect(screen.getByText(/25%/)).toBeTruthy()
  })

  it('anggota yang sudah keluar tetap tampil dan ditandai', () => {
    const contributions = [contribution({ userId: 'u3', amount: 50_000 })]
    const members = [member({ userId: 'u3', name: 'Cici', leftAt: '2026-11-05T00:00:00Z' })]
    render(<ContributorBreakdown contributions={contributions} members={members} currency="IDR" />)

    expect(screen.getByText('Cici')).toBeTruthy()
    expect(screen.getByText('(sudah keluar)')).toBeTruthy()
  })

  it('setoran yang dihapus tidak dihitung', () => {
    const contributions = [
      contribution({ id: 'a', userId: 'u1', amount: 100_000 }),
      contribution({ id: 'b', userId: 'u2', amount: 900_000, deletedAt: '2026-11-11T00:00:00Z' }),
    ]
    render(
      <ContributorBreakdown
        contributions={contributions}
        members={[member({ userId: 'u1' }), member({ userId: 'u2', name: 'Budi' })]}
        currency="IDR"
      />,
    )
    expect(screen.queryByText('Budi')).toBeNull()
    expect(screen.getByText(/100%/)).toBeTruthy()
  })
})
