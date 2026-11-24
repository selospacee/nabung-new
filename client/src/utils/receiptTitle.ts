/**
 * Deteksi nama toko (judul) dan total dari baris teks OCR struk.
 * Murni: tanpa DOM dan tanpa Tesseract, sehingga bisa diuji langsung.
 */
import { displayToCents } from './currency'
import { MERCHANT_KEYWORDS } from './parsers'

/** Jumlah baris teratas yang dipertimbangkan sebagai judul. */
const TITLE_WINDOW = 6
const TITLE_MIN = 3
const TITLE_MAX = 40

/** Nama merek umum; kecocokan memberi bonus besar. */
const KNOWN_MERCHANTS = [
  'indomaret', 'alfamart', 'alfamidi', 'superindo', 'hypermart', 'transmart', 'carrefour',
  'giant', 'lotte mart', 'ranch market', 'foodmart', 'starbucks', 'kfc', 'mcdonald', 'mcd',
  'burger king', 'pizza hut', 'hokben', 'chatime', 'janji jiwa', 'kopi kenangan', 'fore coffee',
  'mixue', 'j.co', 'dunkin', 'solaria', 'seven eleven', '7-eleven', 'kimia farma', 'guardian',
  'century', 'ikea', 'uniqlo', 'matahari', 'pertamina', 'spbu',
]

/** Kata dari kamus kata umum (MERCHANT_KEYWORDS); kecocokan memberi bonus kecil. */
const GENERIC_WORDS: string[] = Object.values(MERCHANT_KEYWORDS).flat()

/** Kata yang menandakan baris bukan nama toko (bagian total, header, footer). */
const STOP_WORDS = new Set([
  'total', 'subtotal', 'jumlah', 'tunai', 'cash', 'kembali', 'kembalian', 'bayar', 'dibayar',
  'ppn', 'pajak', 'tax', 'qty', 'harga', 'struk', 'nota', 'bon', 'receipt', 'invoice',
  'tanggal', 'tgl', 'date', 'jam', 'time', 'kasir', 'item', 'items', 'diskon', 'disc',
  'no', 'nomor', 'telp', 'tel', 'hp', 'wa', 'npwp', 'email', 'www', 'http', 'https', 'com',
  'terima', 'kasih', 'thanks', 'thank', 'you',
])

/** Penanda alamat; baris yang memuatnya bukan judul. */
const ADDRESS_TOKENS = new Set([
  'jl', 'jln', 'jalan', 'gang', 'gg', 'rt', 'rw', 'kec', 'kel', 'kab', 'blok', 'lantai',
  'ruko', 'komp', 'kav', 'desa', 'provinsi', 'prov', 'kelurahan', 'kecamatan',
])

/** Kata yang tetap huruf kapital bila judul ALL CAPS. */
const ACRONYMS = /\b(kfc|mcd|spbu|atm|jne|bca|bri|dki)\b/gi

const DATE_OR_TIME = /\b\d{1,2}[/.-]\d{1,2}[/.-]\d{2,4}\b|\b\d{1,2}:\d{2}\b/
/** Nomor telepon/NPWP: 0 atau 62 diikuti 9+ digit (setelah spasi, titik, strip dibuang). */
const PHONE_LIKE = /(?<!\d)(?:\+?62|0)\d{9,}(?!\d)/
/** Token jumlah: 25.000 / 1.234.567 / 45,900 / 50,000.00 / 30.60 / 25000 */
const AMOUNT_TOKEN = /\d{1,3}(?:[.,]\d{3})+(?:[.,]\d{1,2})?|\d+(?:[.,]\d{1,2})?/g

function countMatches(s: string, re: RegExp): number {
  return (s.match(re) ?? []).length
}

/** Kata berbentuk huruf saja, huruf kecil. */
function words(s: string): string[] {
  return s.toLowerCase().split(/[^\p{L}]+/u).filter(Boolean)
}

function containsWord(hay: string, needle: string): boolean {
  const esc = needle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return new RegExp(`(?:^|[^\\p{L}\\p{N}])${esc}(?:$|[^\\p{L}\\p{N}])`, 'u').test(hay)
}

/** Baris tanggal/jam atau nomor telepon/NPWP. */
function isNoiseLine(line: string): boolean {
  if (DATE_OR_TIME.test(line)) return true
  return PHONE_LIKE.test(line.replace(/[\s.-]/g, ''))
}

/** Buang karakter sampah OCR, rapikan spasi. */
export function cleanReceiptLine(raw: string): string {
  return raw
    .normalize('NFKC')
    .replace(/[^\p{L}\p{N}\s&'.-]/gu, ' ')
    .replace(/\s+/g, ' ')
    .replace(/^[\s.'&-]+|[\s.'&-]+$/g, '')
    .trim()
}

function isValidTitle(line: string): boolean {
  if (line.length < TITLE_MIN || line.length > TITLE_MAX) return false
  if (isNoiseLine(line)) return false
  // baris item/harga ("NASI GORENG 25.000") bukan judul
  if (/\d[.,]\d{3}(?!\d)|\brp\b/i.test(line)) return false
  const ws = words(line)
  if (ws.some(w => STOP_WORDS.has(w) || ADDRESS_TOKENS.has(w))) return false
  if (!ws.some(w => w.length >= 3)) return false

  const letters = countMatches(line, /\p{L}/gu)
  const digits = countMatches(line, /\p{N}/gu)
  const spaces = countMatches(line, /\s/g)
  const symbols = line.length - letters - digits - spaces
  if (letters < 3) return false
  return letters / (letters + digits + symbols) >= 0.6
}

/** ALL CAPS menjadi Title Case; campuran huruf dibiarkan. */
function normalizeTitle(line: string): string {
  if (/\p{Ll}/u.test(line) || !/\p{Lu}/u.test(line)) return line
  return line
    .toLowerCase()
    .replace(/(^|[\s'&.-])(\p{L})/gu, (_m, sep: string, ch: string) => sep + ch.toUpperCase())
    .replace(ACRONYMS, m => m.toUpperCase())
}

/**
 * Nama toko dari baris atas struk. Null bila tidak ada kandidat yang layak.
 * `knownNames` (mis. merchantPatterns kategori pengguna) ikut diberi bonus.
 */
export function pickReceiptTitle(lines: string[], knownNames: string[] = []): string | null {
  const known = [
    ...KNOWN_MERCHANTS,
    ...knownNames.map(k => k.trim().toLowerCase()).filter(k => k.length >= 3),
  ]

  let best: { line: string; score: number } | null = null
  for (const [index, raw] of lines.slice(0, TITLE_WINDOW).entries()) {
    const line = cleanReceiptLine(raw)
    if (!isValidTitle(line)) continue

    const lower = line.toLowerCase()
    let score = TITLE_WINDOW - index // baris paling atas paling kuat
    if (known.some(k => containsWord(lower, k))) score += 5
    else if (GENERIC_WORDS.some(k => containsWord(lower, k))) score += 2
    if (countMatches(line, /\p{L}/gu) >= 6) score += 1

    if (!best || score > best.score) best = { line, score }
  }
  return best ? normalizeTitle(best.line) : null
}

/** Semua nilai uang di satu baris, dalam sen. */
function amountsIn(line: string): number[] {
  const out: number[] = []
  for (const m of line.matchAll(AMOUNT_TOKEN)) {
    const cents = displayToCents(m[0])
    if (cents !== null && cents > 0) out.push(cents)
  }
  return out
}

/**
 * Prioritas baris total: 3 = grand total, 2 = total/amount due, 1 = jumlah/bayar, 0 = bukan.
 * Subtotal, kembalian, diskon dilewatkan.
 */
function totalPriority(lower: string): number {
  if (/subtotal|sub\s*total|kembali|diskon|\bdisc\b|hemat|\bpoin/.test(lower)) return 0
  if (/\bgrand\s*total\b/.test(lower)) return 3
  if (/\btotal\b|amount\s+(due|payable)|total\s+amount/.test(lower)) return 2
  if (/\bjumlah\b|\bbayar\b|\bdibayar\b|\bpembayaran\b/.test(lower)) {
    // "jumlah item 3" menghitung barang, bukan uang
    return /\bitems?\b|\bqty\b|\bpcs\b/.test(lower) ? 0 : 1
  }
  return 0
}

/**
 * Total dalam sen. Prioritas: baris grand total, lalu total, lalu jumlah/bayar.
 * Bila tidak ada baris berkata demikian, pakai nilai uang terbesar di luar baris tanggal/telepon.
 * Pada satu baris diambil nilai terbesar, agar angka kuantitas ("3 item") tidak terpilih.
 */
export function pickReceiptTotal(lines: string[]): number | null {
  let best: { priority: number; value: number } | null = null
  for (const line of lines) {
    const priority = totalPriority(line.toLowerCase())
    if (priority === 0) continue
    const amounts = amountsIn(line)
    if (amounts.length === 0) continue
    // seri: baris yang lebih bawah menang, karena total biasanya di bawah
    const candidate = { priority, value: Math.max(...amounts) }
    if (!best || candidate.priority >= best.priority) best = candidate
  }
  if (best) return best.value

  let largest: number | null = null
  for (const line of lines) {
    if (isNoiseLine(line)) continue
    for (const v of amountsIn(line)) {
      if (largest === null || v > largest) largest = v
    }
  }
  return largest
}
