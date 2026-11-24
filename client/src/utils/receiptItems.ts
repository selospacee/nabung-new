/**
 * Daftar menu/barang dari baris teks OCR struk: baris "nama ... harga".
 * Murni (tanpa DOM/Tesseract) supaya bisa diuji. Hasilnya untuk kolom Notes, bukan untuk perhitungan.
 */
import { cleanReceiptLine } from './receiptTitle'

const MAX_ITEMS = 20

/** Kata yang menandakan baris ringkasan/pembayaran/header, bukan item. */
const SUMMARY_WORDS = new Set([
  'total', 'subtotal', 'jumlah', 'tunai', 'cash', 'kembali', 'kembalian', 'change', 'bayar', 'dibayar',
  'ppn', 'pajak', 'tax', 'service', 'servis', 'diskon', 'disc', 'discount', 'potongan', 'pembulatan',
  'debit', 'kredit', 'credit', 'qris', 'ovo', 'gopay', 'dana', 'shopeepay', 'grand', 'tagihan',
  'qty', 'harga', 'item', 'items', 'kasir', 'struk', 'nota', 'invoice', 'receipt', 'npwp', 'telp', 'tel',
  'terima', 'kasih', 'thanks', 'tanggal', 'tgl', 'jam', 'no', 'nomor',
])

const DATE_OR_TIME = /\b\d{1,2}[/.-]\d{1,2}[/.-]\d{2,4}\b|\b\d{1,2}:\d{2}\b/
const PHONE_LIKE = /(?<!\d)(?:\+?62|0)\d{9,}(?!\d)/
/** Harga di akhir baris: 25.000 / 1.234.567 / 45,900 / 25000 (min. 3 digit atau pola ribuan). */
const TRAILING_PRICE = /(\d{1,3}(?:[.,]\d{3})+|\d{3,})(?:[.,]00)?\s*$/
const LEADING_QTY = /^(\d{1,2})\s*[xX]?\s+(?=\p{L})/u

function words(s: string): string[] {
  return s.toLowerCase().split(/[^\p{L}]+/u).filter(Boolean)
}

export interface ReceiptItem {
  name: string
  qty: number
  price: string
}

/** Satu baris -> item, atau null bila bukan baris item. */
export function parseItemLine(raw: string): ReceiptItem | null {
  const line = raw.normalize('NFKC').replace(/\s+/g, ' ').trim()
  if (!line || DATE_OR_TIME.test(line) || PHONE_LIKE.test(line.replace(/[\s.-]/g, ''))) return null
  const m = TRAILING_PRICE.exec(line)
  if (!m) return null
  const price = m[1]
  let name = line.slice(0, m.index).replace(/\b(?:rp\.?|idr)\s*$/i, '').trim()
  let qty = 1
  const q = LEADING_QTY.exec(name)
  if (q) {
    qty = parseInt(q[1], 10)
    name = name.slice(q[0].length)
  }
  name = cleanReceiptLine(name)
  if (words(name).some(w => SUMMARY_WORDS.has(w))) return null
  if ((name.match(/\p{L}/gu) ?? []).length < 3) return null
  return { name, qty, price }
}

/** Daftar item, satu string per baris ("Nasi Goreng x2 — 50.000"). Kosong bila tidak ada. */
export function extractReceiptItems(lines: string[], title?: string | null): string[] {
  const out: string[] = []
  const titleKey = (title ?? '').toLowerCase()
  for (const raw of lines) {
    const item = parseItemLine(raw)
    if (!item) continue
    if (titleKey && item.name.toLowerCase() === titleKey) continue
    out.push(`${item.name}${item.qty > 1 ? ` x${item.qty}` : ''} — ${item.price}`)
    if (out.length >= MAX_ITEMS) break
  }
  return out
}
