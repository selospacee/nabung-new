import { describe, it, expect } from 'vitest'
import { extractPlaceFromSpeech, extractPlaceFromReceipt } from './geocode'

describe('extractPlaceFromSpeech', () => {
  it('mengambil nama tempat setelah "di"', () => {
    expect(extractPlaceFromSpeech('beli kopi di Starbucks Sudirman 25 ribu')).toBe('Starbucks Sudirman')
    expect(extractPlaceFromSpeech('makan siang at Warung Bu Tini')).toBe('Warung Bu Tini')
  })
  it('memakai "di" terakhir dan membuang kata tanggal', () => {
    expect(extractPlaceFromSpeech('belanja di rumah tadi di Indomaret Kemang kemarin')).toBe('Indomaret Kemang')
  })
  it('null bila tidak ada petunjuk tempat', () => {
    expect(extractPlaceFromSpeech('beli kopi 25 ribu')).toBeNull()
  })
})

describe('extractPlaceFromReceipt', () => {
  it('nama toko dari baris pertama + alamat bila ada', () => {
    expect(extractPlaceFromReceipt(['INDOMARET KEMANG', 'Jl. Kemang Raya No. 5', 'Total 25.000']))
      .toBe('INDOMARET KEMANG, Jl. Kemang Raya No. 5')
  })
  it('mengabaikan baris angka dan kosong', () => {
    expect(extractPlaceFromReceipt(['', '12:30 2026', 'Toko Maju'])).toBe('Toko Maju')
    expect(extractPlaceFromReceipt([])).toBeNull()
  })
})
