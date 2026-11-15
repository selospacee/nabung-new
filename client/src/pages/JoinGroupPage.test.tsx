import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'

vi.mock('../lib/supabase', () => ({ supabase: {} }))

vi.mock('../lib/sharedSavings', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/sharedSavings')>()
  return { ...actual, joinGroupByCode: vi.fn() }
})

vi.mock('../hooks/useGroups', () => ({
  useAuthUserId: vi.fn(),
  useMyGroups: vi.fn(),
}))

import { JoinGroupPage } from './JoinGroupPage'
import { joinGroupByCode, SharedSavingsError } from '../lib/sharedSavings'
import { useAuthUserId, useMyGroups } from '../hooks/useGroups'

const joinMock = vi.mocked(joinGroupByCode)

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/join/:code" element={<JoinGroupPage />} />
        <Route path="/groups/:groupId" element={<div>halaman grup</div>} />
        <Route path="/groups" element={<div>daftar grup</div>} />
      </Routes>
    </MemoryRouter>,
  )
}

describe('JoinGroupPage', () => {
  beforeEach(() => {
    joinMock.mockReset()
    vi.mocked(useAuthUserId).mockReturnValue('u1')
    vi.mocked(useMyGroups).mockReturnValue({ data: [], loading: false, error: null, refetch: vi.fn() })
  })
  afterEach(() => cleanup())

  it('tidak gabung otomatis saat link dibuka: menunggu konfirmasi', () => {
    renderAt('/join/1a2b3c4d')

    expect(screen.getByText('Gabung ke grup ini?')).toBeTruthy()
    expect(screen.getByText('1A2B3C4D')).toBeTruthy()
    expect(joinMock).not.toHaveBeenCalled()
  })

  it('gabung hanya setelah tombol ditekan, dengan kode yang dinormalisasi', async () => {
    joinMock.mockResolvedValueOnce('grup-7')
    renderAt('/join/1a2b3c4d')

    fireEvent.click(screen.getByRole('button', { name: 'Gabung ke grup' }))

    expect(await screen.findByText('halaman grup')).toBeTruthy()
    expect(joinMock).toHaveBeenCalledTimes(1)
    expect(joinMock).toHaveBeenCalledWith('1A2B3C4D')
  })

  it('kode salah menampilkan galat dan tetap di halaman', async () => {
    joinMock.mockRejectedValueOnce(new SharedSavingsError('INVITE_INVALID'))
    renderAt('/join/1a2b3c4d')

    fireEvent.click(screen.getByRole('button', { name: 'Gabung ke grup' }))

    expect(await screen.findByText('Kode undangan tidak ditemukan. Periksa kembali kodenya.')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Gabung ke grup' })).toBeTruthy()
  })

  it('ALREADY_MEMBER diarahkan ke grup dari daftar grup saya', async () => {
    joinMock.mockRejectedValueOnce(new SharedSavingsError('ALREADY_MEMBER'))
    vi.mocked(useMyGroups).mockReturnValue({
      data: [{ id: 'grup-5', inviteCode: '1A2B3C4D' } as never],
      loading: false,
      error: null,
      refetch: vi.fn(),
    })
    renderAt('/join/1a2b3c4d')

    fireEvent.click(screen.getByRole('button', { name: 'Gabung ke grup' }))

    expect(await screen.findByText('halaman grup')).toBeTruthy()
  })

  it('dua klik cepat hanya memanggil server sekali', async () => {
    joinMock.mockReturnValue(new Promise(() => {}))
    renderAt('/join/1a2b3c4d')

    const button = screen.getByRole('button', { name: 'Gabung ke grup' })
    fireEvent.click(button)
    fireEvent.click(button)

    await waitFor(() => expect(joinMock).toHaveBeenCalledTimes(1))
  })
})
