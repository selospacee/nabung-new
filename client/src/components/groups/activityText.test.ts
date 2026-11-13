import { describe, it, expect } from 'vitest'
import { describeActivity } from './activityText'
import type { GroupActivity } from '../../types/shared'

const base = { id: '1', groupId: 'g1', actorId: 'u1', createdAt: '2026-11-13T00:00:00Z' }

describe('describeActivity', () => {
  const names = new Map([['u1', 'Sari'], ['u2', 'Budi']])

  it('menyebut nama anggota untuk join', () => {
    const a = { ...base, action: 'member_joined', ref: { userId: 'u2' } } as GroupActivity
    expect(describeActivity(a, names)).toBe('Budi bergabung ke grup')
  })

  it('menulis nominal rupiah dari cents', () => {
    const a = {
      ...base,
      action: 'contribution_added',
      ref: { goalId: 'x', goalTitle: 'Laptop', amount: 3060000 },
    } as GroupActivity
    expect(describeActivity(a, names)).toContain('Laptop')
    expect(describeActivity(a, names)).toContain('30.600')
  })

  it('memakai "Seseorang" bila nama tidak dikenal', () => {
    const a = { ...base, actorId: 'tidak-dikenal', action: 'invite_regenerated', ref: {} } as GroupActivity
    expect(describeActivity(a, names)).toBe('Seseorang memperbarui kode undangan')
  })
})
