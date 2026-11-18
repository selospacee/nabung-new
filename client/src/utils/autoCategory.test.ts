import { describe, it, expect } from 'vitest'
import { guessType, suggestCategory, type CategoryLike } from './autoCategory'

const cats: CategoryLike[] = [
  { id: 'food', name: 'Food & Drinks', type: 'expense', merchantPatterns: ['restaurant'] },
  { id: 'trans', name: 'Transport', type: 'expense', merchantPatterns: ['grab'] },
  { id: 'bills', name: 'Bills & Utilities', type: 'expense', merchantPatterns: [] },
  { id: 'other', name: 'Other', type: 'expense', merchantPatterns: [] },
  { id: 'sal', name: 'Salary', type: 'income', merchantPatterns: [] },
  { id: 'free', name: 'Freelance', type: 'income', merchantPatterns: [] },
]

describe('guessType', () => {
  it('mengenali pemasukan dan transfer, default pengeluaran', () => {
    expect(guessType('terima gaji 5 juta')).toBe('income')
    expect(guessType('transfer ke tabungan')).toBe('transfer')
    expect(guessType('beli kopi 25 ribu')).toBe('expense')
  })
})

describe('suggestCategory', () => {
  it('memakai kamus kata umum', () => {
    expect(suggestCategory('beli kopi di cafe 25 ribu', 'expense', cats)).toBe('food')
    expect(suggestCategory('bayar listrik pln', 'expense', cats)).toBe('bills')
    expect(suggestCategory('naik gojek ke kantor', 'expense', cats)).toBe('trans')
  })

  it('kategori pemasukan', () => {
    expect(suggestCategory('gaji bulan november', 'income', cats)).toBe('sal')
  })

  it('riwayat pengguna mengalahkan kamus', () => {
    const history = [{ description: 'kopi kenangan', categoryId: 'other', type: 'expense' }]
    expect(suggestCategory('kopi kenangan 30 ribu', 'expense', cats, history)).toBe('other')
  })

  it('tanpa petunjuk mengembalikan null', () => {
    expect(suggestCategory('xyz qwe', 'expense', cats)).toBeNull()
    expect(suggestCategory('', 'expense', cats)).toBeNull()
  })

  it('hanya memilih kategori dengan jenis yang sama', () => {
    expect(suggestCategory('gaji', 'expense', cats)).not.toBe('sal')
  })
})
