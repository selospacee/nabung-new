import { describe, it, expect } from 'vitest'
import { pickReceiptTitle, pickReceiptTotal } from './receiptTitle'

describe('pickReceiptTitle', () => {
  it('minimarket: memilih nama toko di atas, bukan baris alamat', () => {
    expect(pickReceiptTitle(['INDOMARET KEMANG', 'Jl. Kemang Raya No. 5', 'TOTAL 25.000']))
      .toBe('Indomaret Kemang')
  })

  it('restoran: nama warung dipilih, baris tanggal dan item dilewati', () => {
    expect(pickReceiptTitle(['WARUNG SEDERHANA', '12/03/2024 19:20', 'NASI GORENG 25.000']))
      .toBe('Warung Sederhana')
  })

  it('noise OCR: baris simbol dan huruf tunggal dilewati', () => {
    expect(pickReceiptTitle(['=== ### ***', 'x 1 2 3 ~~', 'Toko Sumber Rejeki', 'Terima kasih']))
      .toBe('Toko Sumber Rejeki')
  })

  it('baris alamat dan telepon tidak dipilih', () => {
    expect(pickReceiptTitle(['Jl. Sudirman No. 10, Jakarta', '021-555-1234', 'Toko Berkah', 'Total 50.000']))
      .toBe('Toko Berkah')
  })

  it('tidak ada kandidat layak: null', () => {
    expect(pickReceiptTitle(['TOTAL 25.000', 'Tunai 30.000', '08123456789', 'Kembali 5.000'])).toBeNull()
  })

  it('ALL CAPS diubah ke Title Case', () => {
    expect(pickReceiptTitle(['SUMBER MAKMUR ABADI'])).toBe('Sumber Makmur Abadi')
  })

  it('merek umum mengalahkan baris atas yang tidak dikenal', () => {
    expect(pickReceiptTitle(['Toko Jaya Abadi', 'STARBUCKS COFFEE'])).toBe('Starbucks Coffee')
  })

  it('baris "STRUK" dilewati dan singkatan KFC tetap kapital', () => {
    expect(pickReceiptTitle(['STRUK PEMBELIAN', 'KFC SETIABUDI'])).toBe('KFC Setiabudi')
  })

  it('hanya enam baris teratas yang dipertimbangkan', () => {
    expect(pickReceiptTitle(['1', '2', '3', '4', '5', '6', 'TOKO JAUH'])).toBeNull()
  })

  it('merchantPatterns kategori memberi bonus', () => {
    expect(pickReceiptTitle(['Toko Jaya', 'Warung Mamat'], ['mamat'])).toBe('Warung Mamat')
  })
})

describe('pickReceiptTotal', () => {
  it('baris TOTAL dipilih, bukan angka terbesar di baris lain', () => {
    expect(pickReceiptTotal(['Bakso Jumbo 120.000', 'Es Teh 15.000', 'TOTAL 95.000', 'Tunai 100.000']))
      .toBe(9_500_000)
  })

  it('subtotal dan PPN dilewati, total dipakai', () => {
    expect(pickReceiptTotal(['Subtotal 40.000', 'PPN 4.000', 'TOTAL 44.000'])).toBe(4_400_000)
  })

  it('grand total mengalahkan total biasa', () => {
    expect(pickReceiptTotal(['TOTAL 45.000', 'GRAND TOTAL 50.000'])).toBe(5_000_000)
  })

  it('baris kembalian dilewati', () => {
    expect(pickReceiptTotal(['TOTAL 50.000', 'BAYAR 100.000', 'KEMBALI 50.000'])).toBe(5_000_000)
  })

  it('format angka Indonesia 25.000 dengan Rp', () => {
    expect(pickReceiptTotal(['TOTAL Rp 25.000'])).toBe(2_500_000)
  })

  it('jumlah kuantitas pada baris total tidak terpilih', () => {
    expect(pickReceiptTotal(['TOTAL 3 ITEM 75.000'])).toBe(7_500_000)
  })

  it('tanpa baris total: fallback ke angka terbesar, nomor telepon diabaikan', () => {
    expect(pickReceiptTotal(['KOPI 15.000', 'ROTI 35.000', 'Telp 0812-3456-7890'])).toBe(3_500_000)
  })

  it('tidak ada angka sama sekali: null', () => {
    expect(pickReceiptTotal(['TOKO ABC', 'Terima kasih'])).toBeNull()
  })
})
