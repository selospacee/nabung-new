/**
 * Label referensi (akun, kategori) untuk daftar transaksi dan laporan.
 * Referensi ke baris terhapus tidak pernah membuang transaksi: labelnya diberi keterangan "dihapus".
 */
export interface RefRow {
  id: string
  name: string
  deletedAt?: string | null
}

export type RefKind = 'akun' | 'kategori'

/**
 * Nama untuk ditampilkan. `rows` = daftar termasuk yang terhapus.
 * - undefined (belum dimuat): '…'
 * - id kosong: ''
 * - baris tidak ditemukan: "(akun dihapus)"
 * - baris terhapus: "Nama (akun dihapus)"
 * - baris hidup: "Nama"
 */
export function refLabel(rows: RefRow[] | undefined, id: string | null | undefined, kind: RefKind): string {
  if (!id) return ''
  if (!rows) return '…'
  const row = rows.find(r => r.id === id)
  const gone = `(${kind} dihapus)`
  if (!row) return gone
  if (row.deletedAt) return `${row.name} ${gone}`
  return row.name
}
