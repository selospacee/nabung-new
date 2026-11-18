interface Sortable {
  id: string
  date: string
  createdAt?: string | null
}

/**
 * Urutan "terbaru dulu": tanggal transaksi turun, lalu waktu pencatatan turun, lalu id.
 * Tanpa penentu kedua dan ketiga, transaksi di tanggal yang sama keluar acak (urutan id UUID).
 */
export function compareRecentFirst(a: Sortable, b: Sortable): number {
  const byDate = (b.date || '').localeCompare(a.date || '')
  if (byDate !== 0) return byDate
  const byCreated = (b.createdAt || '').localeCompare(a.createdAt || '')
  if (byCreated !== 0) return byCreated
  return b.id.localeCompare(a.id)
}
