import { describe, it, expect } from 'vitest'
import { describeActivity } from './activityText'
import type { GroupActivity } from '../../types/shared'

const base = { id: '1', groupId: 'g1', actorId: 'u1', createdAt: '2026-11-13T00:00:00Z' }

describe('describeActivity', () => {
  const names = new Map([['u1', 'Sari'], ['u2', 'Budi']])

  const setoran = {
    ...base,
    action: 'contribution_added',
    ref: { goalId: 'x', goalTitle: 'Laptop', amount: 3060000 },
  } as GroupActivity

  it('menyebut nama anggota untuk join', () => {
    const a = { ...base, action: 'member_joined', ref: { userId: 'u2' } } as GroupActivity
    expect(describeActivity(a, names, 'IDR')).toBe('Budi bergabung ke grup')
  })

  it('menulis nominal rupiah dari cents untuk grup IDR', () => {
    const text = describeActivity(setoran, names, 'IDR')
    expect(text).toContain('Laptop')
    expect(text).toContain('Rp')
    expect(text).toContain('30.600')
  })

  it('mata uang grup non-IDR (USD) dipakai untuk format, bukan Rupiah', () => {
    const text = describeActivity(setoran, names, 'USD')
    expect(text).toContain('Laptop')
    expect(text).toContain('$30,600.00')
    expect(text).not.toContain('Rp')
    expect(text).not.toContain('30.600')
  })

  it('mata uang diikuti untuk nominal lama→baru (goal_updated)', () => {
    const a = {
      ...base,
      action: 'goal_updated',
      ref: { goalId: 'x', title: 'Rumah', oldTargetAmount: 100000, newTargetAmount: 250000 },
    } as GroupActivity
    const text = describeActivity(a, names, 'USD')
    expect(text).toContain('$1,000.00')
    expect(text).toContain('$2,500.00')
    expect(text).not.toContain('Rp')
  })

  it('memakai "Seseorang" bila nama tidak dikenal', () => {
    const a = { ...base, actorId: 'tidak-dikenal', action: 'invite_regenerated', ref: {} } as GroupActivity
    expect(describeActivity(a, names, 'IDR')).toBe('Seseorang memperbarui kode undangan')
  })
})
