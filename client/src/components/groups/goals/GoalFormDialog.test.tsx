import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react'

vi.mock('../../../lib/supabase', () => ({ supabase: {} }))

vi.mock('../../../lib/sharedSavings', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../lib/sharedSavings')>()
  return {
    ...actual,
    createGoal: vi.fn(),
    updateGoal: vi.fn(),
    addGoalParticipant: vi.fn(),
    removeGoalParticipant: vi.fn(),
  }
})

const participantsState = vi.hoisted(() => ({ rows: [] as Array<{ goalId: string; userId: string }> }))

vi.mock('../../../hooks/useGroupGoals', () => ({
  useGoalParticipants: () => ({ data: participantsState.rows, loading: false, error: null, refetch: vi.fn() }),
}))

import { GoalFormDialog, type GoalFormDialogProps } from './GoalFormDialog'
import { addGoalParticipant, createGoal, updateGoal } from '../../../lib/sharedSavings'
import type { GroupGoal, GroupMember } from '../../../types/shared'

const members: GroupMember[] = [
  { userId: 'u1', name: 'Sari', role: 'owner', joinedAt: '2026-11-01T00:00:00Z', leftAt: null },
  { userId: 'u2', name: 'Budi', role: 'member', joinedAt: '2026-11-02T00:00:00Z', leftAt: null },
]

const existingGoal: GroupGoal = {
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

function renderDialog(overrides: Partial<GoalFormDialogProps> = {}) {
  const onClose = vi.fn()
  const onSaved = vi.fn()
  render(
    <GoalFormDialog
      groupId="g1"
      groupType="couple"
      currency="IDR"
      members={members}
      goal={null}
      canManage={false}
      onClose={onClose}
      onSaved={onSaved}
      {...overrides}
    />,
  )
  return { onClose, onSaved }
}

function fillGoal(title: string, target: string) {
  fireEvent.change(document.getElementById('goal-title') as HTMLInputElement, { target: { value: title } })
  fireEvent.change(document.getElementById('goal-target') as HTMLInputElement, { target: { value: target } })
}

function submitForm() {
  return screen.getByRole('button', { name: 'Simpan' }).closest('form') as HTMLFormElement
}

describe('GoalFormDialog', () => {
  beforeEach(() => {
    participantsState.rows = []
    vi.mocked(createGoal).mockReset()
    vi.mocked(updateGoal).mockReset()
    vi.mocked(addGoalParticipant).mockReset()
  })
  afterEach(() => cleanup())

  it('validasi judul dan nominal kosong; server tidak dipanggil', () => {
    renderDialog()
    fireEvent.click(screen.getByRole('button', { name: 'Simpan' }))

    expect(screen.getByText('Judul goal wajib diisi.')).toBeTruthy()
    expect(screen.getByText('Target harus lebih dari Rp 0 dan tidak lebih dari Rp 10 triliun.')).toBeTruthy()
    expect(createGoal).not.toHaveBeenCalled()
  })

  it('menolak nominal nol dan negatif', () => {
    renderDialog()
    fillGoal('Laptop', '0')
    fireEvent.click(screen.getByRole('button', { name: 'Simpan' }))
    expect(screen.getByText('Target harus lebih dari Rp 0 dan tidak lebih dari Rp 10 triliun.')).toBeTruthy()

    fillGoal('Laptop', '-5.000')
    fireEvent.click(screen.getByRole('button', { name: 'Simpan' }))
    expect(screen.getByText('Target harus lebih dari Rp 0 dan tidak lebih dari Rp 10 triliun.')).toBeTruthy()
    expect(createGoal).not.toHaveBeenCalled()
  })

  it('menolak nominal melewati batas Rp 10 triliun', () => {
    renderDialog()
    fillGoal('Laptop', '99.999.999.999.999.999')
    fireEvent.click(screen.getByRole('button', { name: 'Simpan' }))
    expect(screen.getByText('Target harus lebih dari Rp 0 dan tidak lebih dari Rp 10 triliun.')).toBeTruthy()
    expect(createGoal).not.toHaveBeenCalled()
  })

  it('wajib memilih minimal satu peserta', () => {
    renderDialog()
    fillGoal('Laptop', '5.000.000')
    fireEvent.click(screen.getByRole('checkbox', { name: 'Sari' }))
    fireEvent.click(screen.getByRole('checkbox', { name: 'Budi' }))
    fireEvent.click(screen.getByRole('button', { name: 'Simpan' }))

    expect(screen.getByText('Pilih minimal satu peserta.')).toBeTruthy()
    expect(createGoal).not.toHaveBeenCalled()
  })

  it('menyimpan goal baru dengan nominal dalam cents lalu menambahkan semua peserta', async () => {
    vi.mocked(createGoal).mockResolvedValue({ ...existingGoal, id: 'goal-new' })
    vi.mocked(addGoalParticipant).mockResolvedValue(undefined)
    const { onSaved } = renderDialog()

    fillGoal('Laptop', '5.000.000')
    fireEvent.click(screen.getByRole('button', { name: 'Simpan' }))

    await waitFor(() => expect(onSaved).toHaveBeenCalled())
    expect(createGoal).toHaveBeenCalledWith('g1', { title: 'Laptop', targetAmount: 500000000, deadline: null })
    expect(addGoalParticipant).toHaveBeenCalledWith('goal-new', 'u1')
    expect(addGoalParticipant).toHaveBeenCalledWith('goal-new', 'u2')
  })

  it('dua submit cepat hanya membuat satu goal', async () => {
    vi.mocked(createGoal).mockReturnValue(new Promise(() => {}))
    renderDialog()
    fillGoal('Laptop', '5.000.000')

    const form = submitForm()
    fireEvent.submit(form)
    fireEvent.submit(form)

    expect(createGoal).toHaveBeenCalledTimes(1)
  })

  it('peserta gagal ditambahkan: goal tidak dibuat ulang saat disimpan lagi', async () => {
    vi.mocked(createGoal).mockResolvedValue({ ...existingGoal, id: 'goal-9' })
    vi.mocked(addGoalParticipant).mockRejectedValue(new Error('jaringan putus'))
    renderDialog()
    fillGoal('Laptop', '5.000.000')
    fireEvent.click(screen.getByRole('button', { name: 'Simpan' }))

    expect(await screen.findByText(/Goal sudah tersimpan, tetapi peserta belum lengkap/)).toBeTruthy()
    expect((screen.getByRole('button', { name: 'Simpan' }) as HTMLButtonElement).disabled).toBe(true)

    fireEvent.submit(submitForm())
    expect(createGoal).toHaveBeenCalledTimes(1)
  })

  it('mode ubah: perubahan judul dan target disimpan ke goal yang sama', async () => {
    participantsState.rows = [{ goalId: 'goal-1', userId: 'u1' }]
    vi.mocked(updateGoal).mockResolvedValue(existingGoal)
    const { onSaved } = renderDialog({ goal: existingGoal, canManage: true })

    fireEvent.change(document.getElementById('goal-title') as HTMLInputElement, { target: { value: 'Laptop baru' } })
    fireEvent.click(screen.getByRole('button', { name: 'Simpan' }))

    await waitFor(() => expect(onSaved).toHaveBeenCalled())
    expect(updateGoal).toHaveBeenCalledWith('goal-1', {
      title: 'Laptop baru',
      targetAmount: 500000000,
      deadline: null,
    })
    expect(createGoal).not.toHaveBeenCalled()
  })

  it('goal yang sudah dibatalkan hanya-baca: tidak ada tombol Simpan', () => {
    renderDialog({ goal: { ...existingGoal, status: 'cancelled' }, canManage: true })

    expect(screen.getByText('Goal yang sudah dibatalkan tidak bisa diubah.')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Simpan' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Batalkan goal' })).toBeNull()
  })

  it('bukan pengelola: hanya-baca dan tidak ada tombol Simpan', () => {
    renderDialog({ goal: existingGoal, canManage: false })

    expect(screen.getByText('Hanya pengelola goal yang bisa mengubah goal ini.')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Simpan' })).toBeNull()
  })
})
