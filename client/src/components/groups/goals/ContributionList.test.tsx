import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Contribution, GroupMember } from '../../../types/shared'
import { ContributionList } from './ContributionList'

const contribution = (over: Partial<Contribution>): Contribution => ({
  id: 'c1',
  goalId: 'g1',
  userId: 'u1',
  amount: 3_060_000,
  contributedAt: '2026-11-10',
  note: 'Gaji',
  createdAt: '2026-11-10T00:00:00Z',
  updatedAt: '2026-11-10T00:00:00Z',
  deletedAt: null,
  ...over,
})

const members: GroupMember[] = [
  { userId: 'u1', name: 'Ayu', role: 'owner', joinedAt: '2026-11-01T00:00:00Z', leftAt: null },
  { userId: 'u2', name: 'Budi', role: 'member', joinedAt: '2026-11-01T00:00:00Z', leftAt: '2026-11-06T00:00:00Z' },
]

afterEach(() => {
  cleanup()
})

describe('ContributionList', () => {
  it('kosong: menampilkan pesan belum ada setoran', () => {
    render(
      <ContributionList contributions={[]} members={members} currency="IDR" canChange={() => false} onEdit={vi.fn()} />,
    )
    expect(screen.getByText('Belum ada setoran.')).toBeTruthy()
  })

  it('menampilkan nama, catatan, dan nominal; anggota keluar tetap diberi nama dan tanda', () => {
    const items = [contribution({ id: 'a' }), contribution({ id: 'b', userId: 'u2', note: null, amount: 100_000 })]
    render(<ContributionList contributions={items} members={members} currency="IDR" canChange={() => false} onEdit={vi.fn()} />)

    expect(screen.getByText('Ayu')).toBeTruthy()
    expect(screen.getByText(/Gaji/)).toBeTruthy()
    expect(screen.getByText('Budi')).toBeTruthy()
    expect(screen.getByText('(sudah keluar)')).toBeTruthy()
  })

  it('tombol Ubah hanya untuk setoran yang diizinkan canChange', () => {
    const items = [contribution({ id: 'mine', userId: 'u1' }), contribution({ id: 'theirs', userId: 'u2' })]
    const onEdit = vi.fn()
    render(
      <ContributionList
        contributions={items}
        members={members}
        currency="IDR"
        canChange={(c) => c.id === 'mine'}
        onEdit={onEdit}
      />,
    )

    const buttons = screen.getAllByRole('button', { name: 'Ubah' })
    expect(buttons).toHaveLength(1)
    fireEvent.click(buttons[0])
    expect(onEdit).toHaveBeenCalledWith(expect.objectContaining({ id: 'mine' }))
  })
})
