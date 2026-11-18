import { describe, it, expect } from 'vitest'
import { compareRecentFirst } from './sortTx'

describe('compareRecentFirst', () => {
  it('mengurutkan tanggal terbaru lebih dulu', () => {
    const rows = [
      { id: 'a', date: '2026-11-10', createdAt: '2026-11-10T01:00:00Z' },
      { id: 'b', date: '2026-11-12', createdAt: '2026-11-12T01:00:00Z' },
    ]
    expect(rows.sort(compareRecentFirst).map(r => r.id)).toEqual(['b', 'a'])
  })

  it('tanggal sama: yang dicatat belakangan lebih dulu, bukan acak', () => {
    const rows = [
      { id: 'zzz', date: '2026-11-12', createdAt: '2026-11-12T08:00:00Z' },
      { id: 'aaa', date: '2026-11-12', createdAt: '2026-11-12T20:00:00Z' },
      { id: 'mmm', date: '2026-11-12', createdAt: '2026-11-12T12:00:00Z' },
    ]
    expect(rows.sort(compareRecentFirst).map(r => r.id)).toEqual(['aaa', 'mmm', 'zzz'])
  })

  it('stabil walau createdAt kosong', () => {
    const rows = [
      { id: 'a', date: '2026-11-12' },
      { id: 'b', date: '2026-11-12' },
    ]
    expect(rows.sort(compareRecentFirst).map(r => r.id)).toEqual(['b', 'a'])
  })
})
