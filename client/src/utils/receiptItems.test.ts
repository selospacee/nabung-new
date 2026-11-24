import { describe, it, expect } from 'vitest'
import { parseItemLine, extractReceiptItems } from './receiptItems'

describe('parseItemLine', () => {
  it('nama + harga', () => {
    expect(parseItemLine('Nasi Goreng 25.000')).toEqual({ name: 'Nasi Goreng', qty: 1, price: '25.000' })
  })
  it('qty di depan', () => {
    expect(parseItemLine('2 Es Teh Manis 10.000')).toEqual({ name: 'Es Teh Manis', qty: 2, price: '10.000' })
    expect(parseItemLine('3x Kopi Susu 54.000')).toEqual({ name: 'Kopi Susu', qty: 3, price: '54.000' })
  })
  it('harga tanpa pemisah dan dengan Rp', () => {
    expect(parseItemLine('Ayam Bakar Rp 32000')?.name).toBe('Ayam Bakar')
  })
  it('menolak baris ringkasan/pembayaran', () => {
    for (const l of ['TOTAL 85.000', 'Subtotal 80.000', 'PPN 10% 8.000', 'Tunai 100.000', 'Kembali 15.000', 'Grand Total 88.000']) {
      expect(parseItemLine(l)).toBeNull()
    }
  })
  it('menolak tanggal, telepon, dan baris tanpa harga', () => {
    expect(parseItemLine('12/11/2026 14:30')).toBeNull()
    expect(parseItemLine('Telp 0812 3456 7890')).toBeNull()
    expect(parseItemLine('Terima kasih')).toBeNull()
  })
})

describe('extractReceiptItems', () => {
  it('mengambil menu dan melewatkan ringkasan', () => {
    const lines = ['WARUNG BU TINI', 'Jl. Mawar No 5', '2 Nasi Goreng 50.000', 'Es Teh 8.000', 'Subtotal 58.000', 'PPN 5.800', 'TOTAL 63.800', 'Tunai 70.000']
    expect(extractReceiptItems(lines, 'Warung Bu Tini')).toEqual(['Nasi Goreng x2 — 50.000', 'Es Teh — 8.000'])
  })
  it('kosong bila tidak ada item', () => {
    expect(extractReceiptItems(['TOKO MAJU', 'TOTAL 10.000'])).toEqual([])
  })
  it('dibatasi 20 item', () => {
    const lines = Array.from({ length: 30 }, (_, i) => `Barang ${String.fromCharCode(65 + (i % 26))}${i} 1${String(i).padStart(2, '0')}.000`)
    expect(extractReceiptItems(lines).length).toBe(20)
  })
})
