/**
 * Saran kategori otomatis untuk input foto (OCR) dan suara.
 * Skor per kategori dijumlahkan dari: (1) riwayat transaksi pengguna dengan kata yang sama,
 * (2) merchantPatterns kategori, (3) nama kategori, (4) kamus kata umum (Indonesia + Inggris).
 */
export type TxKind = 'income' | 'expense' | 'transfer'

export interface CategoryLike {
  id: string
  name: string
  type: string
  merchantPatterns?: string[]
}

export interface HistoryTx {
  description?: string | null
  categoryId: string | null
  type: string
}

const INCOME_WORDS = ['gaji', 'salary', 'payroll', 'bonus', 'thr', 'diterima', 'terima', 'income', 'pemasukan',
  'honor', 'upah', 'komisi', 'dividen', 'freelance', 'refund', 'cashback']
const TRANSFER_WORDS = ['transfer', 'tf', 'kirim ke', 'pindah dana', 'mutasi']

/** Jenis transaksi dari kalimat (suara). Default pengeluaran. */
export function guessType(text: string): TxKind {
  const t = ` ${text.toLowerCase()} `
  if (TRANSFER_WORDS.some(w => new RegExp(`\\b${w}\\b`).test(t))) return 'transfer'
  if (INCOME_WORDS.some(w => new RegExp(`\\b${w}\\b`).test(t))) return 'income'
  return 'expense'
}

// Kamus kata umum. `name` mencocokkan nama kategori milik pengguna (bisa diganti pengguna).
const GROUPS: { name: RegExp; words: string[] }[] = [
  { name: /food|makan|minum|kuliner|dining|drink/i, words: ['makan', 'minum', 'kopi', 'coffee', 'cafe', 'kafe', 'resto', 'restoran', 'restaurant', 'warung', 'bakso', 'nasi', 'ayam', 'mie', 'sate', 'soto', 'burger', 'pizza', 'snack', 'jajan', 'sarapan', 'lunch', 'dinner', 'breakfast', 'gofood', 'grabfood', 'shopeefood', 'starbucks', 'kfc', 'mcd', 'indomaret', 'alfamart', 'boba', 'teh'] },
  { name: /transport|bensin|kendaraan|travel/i, words: ['bensin', 'pertamax', 'pertalite', 'solar', 'parkir', 'tol', 'ojek', 'gojek', 'grab', 'gocar', 'taxi', 'taksi', 'uber', 'bus', 'kereta', 'krl', 'mrt', 'busway', 'transjakarta', 'tiket', 'pesawat', 'bengkel', 'servis', 'spbu', 'shell'] },
  { name: /shop|belanja|fashion/i, words: ['belanja', 'baju', 'celana', 'sepatu', 'tas', 'mall', 'shopee', 'tokopedia', 'lazada', 'tokped', 'blibli', 'zalora', 'uniqlo', 'hnm', 'toko', 'online shop'] },
  { name: /bill|utilit|tagihan|listrik/i, words: ['listrik', 'pln', 'token', 'air', 'pdam', 'internet', 'wifi', 'indihome', 'pulsa', 'paket data', 'telkomsel', 'xl', 'tagihan', 'cicilan', 'sewa', 'kost', 'kos', 'bpjs', 'asuransi', 'electric', 'water', 'rent'] },
  { name: /health|kesehatan|medis/i, words: ['dokter', 'rumah sakit', 'rs', 'klinik', 'apotek', 'obat', 'vitamin', 'lab', 'gigi', 'hospital', 'pharmacy', 'clinic', 'kimia farma', 'guardian'] },
  { name: /entertain|hiburan|hobi/i, words: ['bioskop', 'film', 'movie', 'netflix', 'spotify', 'youtube', 'game', 'steam', 'konser', 'karaoke', 'streaming', 'cinema', 'xxi', 'disney'] },
  { name: /educat|pendidikan|sekolah|belajar/i, words: ['sekolah', 'kuliah', 'spp', 'kursus', 'buku', 'les', 'course', 'udemy', 'tuition', 'seminar', 'training', 'ukt'] },
  { name: /salary|gaji/i, words: ['gaji', 'salary', 'payroll', 'thr', 'bonus', 'upah'] },
  { name: /freelance|sampingan|side/i, words: ['freelance', 'proyek', 'project', 'honor', 'komisi', 'fee', 'upwork', 'fiverr'] },
]

const tokenize = (text: string): string[] =>
  Array.from(new Set(text.toLowerCase().split(/[^a-z0-9]+/).filter(w => w.length >= 3)))

const hasWord = (text: string, word: string): boolean =>
  new RegExp(`(^|[^a-z0-9])${word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}([^a-z0-9]|$)`).test(text)

/** Id kategori yang paling cocok untuk teks, atau null bila tidak ada petunjuk sama sekali. */
export function suggestCategory(
  text: string,
  type: TxKind,
  categories: CategoryLike[],
  history: HistoryTx[] = [],
): string | null {
  const lower = text.toLowerCase().trim()
  if (!lower) return null
  const candidates = categories.filter(c => c.type === type)
  if (candidates.length === 0) return null
  const ids = new Set(candidates.map(c => c.id))
  const score = new Map<string, number>()
  const add = (id: string, n: number) => score.set(id, (score.get(id) || 0) + n)

  // 1. Riwayat pengguna: kata yang sama pada deskripsi transaksi sebelumnya.
  const tokens = tokenize(lower)
  if (tokens.length > 0) {
    const perCat = new Map<string, number>()
    for (const h of history) {
      if (!h.categoryId || !ids.has(h.categoryId) || !h.description) continue
      const hTokens = new Set(tokenize(h.description))
      const overlap = tokens.filter(t => hTokens.has(t)).length
      if (overlap > 0) perCat.set(h.categoryId, Math.min(12, (perCat.get(h.categoryId) || 0) + overlap * 3))
    }
    for (const [id, n] of perCat) add(id, n)
  }

  for (const cat of candidates) {
    // 2. merchantPatterns
    for (const pattern of cat.merchantPatterns || []) {
      const p = pattern.toLowerCase().trim()
      if (p && lower.includes(p)) add(cat.id, 2 + Math.min(p.length, 10) / 5)
    }
    // 3. Nama kategori
    for (const part of cat.name.toLowerCase().split(/[^a-z0-9]+/).filter(w => w.length >= 4)) {
      if (hasWord(lower, part)) add(cat.id, 2)
    }
    // 4. Kamus umum
    for (const g of GROUPS) {
      if (g.name.test(cat.name) && g.words.some(w => hasWord(lower, w))) add(cat.id, 2)
    }
  }

  let best: string | null = null
  let bestScore = 0
  for (const [id, n] of score) {
    if (n > bestScore) { best = id; bestScore = n }
  }
  return best
}
