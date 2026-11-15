import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react'

vi.mock('../../../lib/supabase', () => ({ supabase: {} }))

vi.mock('../../../lib/sharedSavings', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../lib/sharedSavings')>()
  return {
    ...actual,
    addContribution: vi.fn(),
    updateContribution: vi.fn(),
    deleteContribution: vi.fn(),
  }
})

import { ContributionFormDialog } from './ContributionFormDialog'
import { addContribution, deleteContribution, localDateString, updateContribution } from '../../../lib/sharedSavings'
import type { Contribution, GroupGoal } from '../../../types/shared'

const goal: GroupGoal = {
  id: 'goal-1',
  groupId: 'g1',
  title: 'Laptop',
  targetAmount: 500000000,
  deadline: null,
  status: 'active',
  createdBy: 'u1',
  createdAt: '2026-11-01T00:00:00Z',
  updatedAt: '2026-11-01T00:00:00Z',
}

const ownContribution: Contribution = {
  id: 'c1',
  goalId: 'goal-1',
  userId: 'u1',
  amount: 300000,
  contributedAt: '2026-11-10',
  note: null,
  createdAt: '2026-11-10T00:00:00Z',
  updatedAt: '2026-11-10T00:00:00Z',
  deletedAt: null,
}

const AMOUNT_ERROR = 'Nominal harus lebih dari Rp 0 dan tidak lebih dari Rp 10 triliun.'

function renderDialog(contribution: Contribution | null) {
  const onClose = vi.fn()
  const onSaved = vi.fn()
  render(
    <ContributionFormDialog
      goal={goal}
      currency="IDR"
      contribution={contribution}
      onClose={onClose}
      onSaved={onSaved}
    />,
  )
  return { onClose, onSaved }
}

function amountInput() {
  return document.getElementById('contribution-amount') as HTMLInputElement
}

describe('ContributionFormDialog', () => {
  beforeEach(() => {
    vi.mocked(addContribution).mockReset()
    vi.mocked(updateContribution).mockReset()
    vi.mocked(deleteContribution).mockReset()
  })
  afterEach(() => cleanup())

  it('setoran baru: nominal kosong ditolak tanpa memanggil server', () => {
    renderDialog(null)
    fireEvent.click(screen.getByRole('button', { name: 'Setor' }))

    expect(screen.getByText(AMOUNT_ERROR)).toBeTruthy()
    expect(addContribution).not.toHaveBeenCalled()
  })

  it('setoran baru: nominal nol dan negatif ditolak', () => {
    renderDialog(null)
    fireEvent.change(amountInput(), { target: { value: '0' } })
    fireEvent.click(screen.getByRole('button', { name: 'Setor' }))
    expect(screen.getByText(AMOUNT_ERROR)).toBeTruthy()

    fireEvent.change(amountInput(), { target: { value: '-1.000' } })
    fireEvent.click(screen.getByRole('button', { name: 'Setor' }))
    expect(screen.getByText(AMOUNT_ERROR)).toBeTruthy()
    expect(addContribution).not.toHaveBeenCalled()
  })

  it('setoran baru: menyimpan dalam cents dengan tanggal lokal hari ini', async () => {
    vi.mocked(addContribution).mockResolvedValue(ownContribution)
    const { onSaved } = renderDialog(null)

    fireEvent.change(amountInput(), { target: { value: '500.000' } })
    fireEvent.click(screen.getByRole('button', { name: 'Setor' }))

    await waitFor(() => expect(onSaved).toHaveBeenCalled())
    expect(addContribution).toHaveBeenCalledWith('goal-1', {
      amount: 50000000,
      contributedAt: localDateString(),
      note: null,
    })
  })

  it('ubah setoran: judul "Ubah setoran" dan nilai awal dari setoran', () => {
    renderDialog(ownContribution)

    expect(screen.getByText('Ubah setoran')).toBeTruthy()
    expect(amountInput().value).toBe('3000')
  })

  it('ubah setoran: perubahan nominal disimpan ke setoran yang sama', async () => {
    vi.mocked(updateContribution).mockResolvedValue(ownContribution)
    const { onSaved } = renderDialog(ownContribution)

    fireEvent.change(amountInput(), { target: { value: '4.000' } })
    fireEvent.click(screen.getByRole('button', { name: 'Simpan perubahan' }))

    await waitFor(() => expect(onSaved).toHaveBeenCalled())
    expect(updateContribution).toHaveBeenCalledWith('c1', {
      amount: 400000,
      contributedAt: '2026-11-10',
      note: null,
    })
    expect(addContribution).not.toHaveBeenCalled()
  })

  it('hapus setoran: wajib konfirmasi, lalu soft delete', async () => {
    vi.mocked(deleteContribution).mockResolvedValue(ownContribution)
    const { onSaved } = renderDialog(ownContribution)

    fireEvent.click(screen.getByRole('button', { name: 'Hapus setoran' }))
    expect(deleteContribution).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Ya, hapus' }))

    await waitFor(() => expect(onSaved).toHaveBeenCalled())
    expect(deleteContribution).toHaveBeenCalledWith('c1')
  })

  it('klik hapus ganda hanya mengirim satu permintaan', async () => {
    vi.mocked(deleteContribution).mockReturnValue(new Promise(() => {}))
    renderDialog(ownContribution)

    fireEvent.click(screen.getByRole('button', { name: 'Hapus setoran' }))
    const confirm = screen.getByRole('button', { name: 'Ya, hapus' })
    fireEvent.click(confirm)
    fireEvent.click(confirm)

    expect(deleteContribution).toHaveBeenCalledTimes(1)
  })

  it('setoran baru tidak punya tombol hapus', () => {
    renderDialog(null)
    expect(screen.queryByRole('button', { name: 'Hapus setoran' })).toBeNull()
  })
})
