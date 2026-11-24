import { describe, it, expect } from 'vitest'
import { matchAccountFromText } from './matchAccount'

const accounts = [
  { id: 'a1', name: 'Cash' },
  { id: 'a2', name: 'BCA' },
  { id: 'a3', name: 'GoPay' },
  { id: 'a4', name: 'Bank Mandiri' },
  { id: 'a5', name: 'Bank Jago' },
]

describe('matchAccountFromText', () => {
  it('cocok tanpa peduli huruf besar/kecil', () => {
    expect(matchAccountFromText('beli kopi 25 ribu pakai BCA', accounts)).toBe('a2')
    expect(matchAccountFromText('makan siang dari cash', accounts)).toBe('a1')
    expect(matchAccountFromText('bayar parkir via GOPAY', accounts)).toBe('a3')
  })

  it('cocok dengan kata khas nama akun bertoken banyak', () => {
    expect(matchAccountFromText('transfer dari mandiri 100 ribu', accounts)).toBe('a4')
  })

  it('tidak cocok bila tidak ada akun disebut', () => {
    expect(matchAccountFromText('beli kopi 25 ribu', accounts)).toBeNull()
    expect(matchAccountFromText('', accounts)).toBeNull()
    expect(matchAccountFromText('pakai BCA', [])).toBeNull()
  })

  it('mengabaikan kata bersama dan nama terlalu pendek', () => {
    expect(matchAccountFromText('pakai bank', accounts)).toBeNull()
    expect(matchAccountFromText('pakai bi', [{ id: 'x', name: 'BI' }])).toBeNull()
  })

  it('hanya cocok kata utuh', () => {
    expect(matchAccountFromText('beli cashback', accounts)).toBeNull()
  })

  it('ambigu mengembalikan null', () => {
    expect(matchAccountFromText('pakai bca atau cash', accounts)).toBeNull()
  })

  it('nama penuh mengalahkan nama yang sama sebagian', () => {
    const accs = [{ id: 'c', name: 'Cash' }, { id: 'cb', name: 'Cash BCA' }]
    expect(matchAccountFromText('dari cash', accs)).toBe('c')
    expect(matchAccountFromText('dari cash bca', accs)).toBe('cb')
  })
})
