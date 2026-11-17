import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react'

vi.mock('../../lib/supabase', () => ({ supabase: {} }))

vi.mock('../../lib/sharedSavings', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../lib/sharedSavings')>()
  return { ...actual, joinGroupByCode: vi.fn() }
})

import { JoinGroupForm } from './JoinGroupForm'
import { joinGroupByCode, SharedSavingsError } from '../../lib/sharedSavings'

const joinMock = vi.mocked(joinGroupByCode)

describe('JoinGroupForm', () => {
  beforeEach(() => joinMock.mockReset())
  afterEach(() => cleanup())

  it('menampilkan pesan galat saat kode salah', async () => {
    joinMock.mockRejectedValueOnce(new SharedSavingsError('INVITE_INVALID'))
    const onJoined = vi.fn()
    render(<JoinGroupForm onJoined={onJoined} />)

    fireEvent.change(screen.getByLabelText('Kode undangan'), { target: { value: 'SALAH123' } })
    fireEvent.click(screen.getByRole('button', { name: 'Gabung' }))

    expect(await screen.findByText('Kode undangan tidak ditemukan. Periksa kembali kodenya.')).toBeTruthy()
    expect(onJoined).not.toHaveBeenCalled()
  })

  it('memanggil onJoined dengan id grup saat kode benar', async () => {
    joinMock.mockResolvedValueOnce('grup-1')
    const onJoined = vi.fn()
    render(<JoinGroupForm onJoined={onJoined} />)

    fireEvent.change(screen.getByLabelText('Kode undangan'), { target: { value: '1a2b3c4d' } })
    fireEvent.click(screen.getByRole('button', { name: 'Gabung' }))

    await waitFor(() => expect(onJoined).toHaveBeenCalledWith('grup-1'))
    // Kode dinormalisasi (huruf besar) sebelum dikirim ke server.
    expect(joinMock).toHaveBeenCalledWith('1A2B3C4D')
  })

  it('tidak memanggil server saat kode kosong', () => {
    render(<JoinGroupForm onJoined={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: 'Gabung' }))
    expect(joinMock).not.toHaveBeenCalled()
    expect(screen.getByText('Kode undangan tidak ditemukan. Periksa kembali kodenya.')).toBeTruthy()
  })
})

describe('JoinGroupForm normalisasi kode', () => {
  beforeEach(() => joinMock.mockReset())
  afterEach(() => cleanup())

  it('membuang spasi di tengah dan membesarkan huruf sebelum dikirim', async () => {
    joinMock.mockResolvedValueOnce('grup-2')
    const onJoined = vi.fn()
    render(<JoinGroupForm onJoined={onJoined} />)

    fireEvent.change(screen.getByLabelText('Kode undangan'), { target: { value: '  1a2b 3c4d ' } })
    fireEvent.click(screen.getByRole('button', { name: 'Gabung' }))

    await waitFor(() => expect(onJoined).toHaveBeenCalledWith('grup-2'))
    expect(joinMock).toHaveBeenCalledWith('1A2B3C4D')
  })

  it('dua submit cepat hanya mengirim satu permintaan', async () => {
    let resolve: (id: string) => void = () => {}
    joinMock.mockReturnValueOnce(new Promise<string>((r) => { resolve = r }))
    const onJoined = vi.fn()
    render(<JoinGroupForm onJoined={onJoined} />)

    fireEvent.change(screen.getByLabelText('Kode undangan'), { target: { value: '1A2B3C4D' } })
    const form = screen.getByRole('button', { name: 'Gabung' }).closest('form')!
    fireEvent.submit(form)
    fireEvent.submit(form)

    expect(joinMock).toHaveBeenCalledTimes(1)
    resolve('grup-3')
    await waitFor(() => expect(onJoined).toHaveBeenCalledWith('grup-3'))
  })
})
