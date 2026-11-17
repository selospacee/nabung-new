import { db, DEFAULT_CATEGORIES } from './index'
import { supabase } from '../lib/supabase'

/**
 * Akun lama (atau akun yang pembuatan datanya gagal saat daftar) bisa tidak punya kategori/akun
 * bawaan. Setelah pull penuh yang sukses, bila SEMUA baris (termasuk yang soft-delete) untuk
 * pengguna ini nol, buat set bawaan. Baris yang dihapus pengguna tetap tercatat sebagai
 * soft-delete, jadi data yang sengaja dikosongkan tidak diisi ulang.
 * Penulisan lewat Dexie biasa: hook stempel menandai dirty dan push mengirimnya.
 * Mengembalikan true bila ada yang dibuat (pemanggil sebaiknya memicu sync).
 */
export async function seedDefaultsIfEmpty(userId: string): Promise<boolean> {
  const { data: { session } } = await supabase.auth.getSession()
  if (!session?.user || session.user.id !== userId) return false

  let seeded = false
  const now = new Date().toISOString()

  if ((await db.categories.where('userId').equals(userId).count()) === 0) {
    await db.categories.bulkAdd(
      DEFAULT_CATEGORIES.map(c => ({ ...c, id: crypto.randomUUID(), userId })),
    )
    seeded = true
  }

  if ((await db.accounts.where('userId').equals(userId).count()) === 0) {
    const currency = (await db.users.get(userId))?.currency || 'IDR'
    await db.accounts.bulkAdd([
      { id: crypto.randomUUID(), userId, name: 'Cash', type: 'cash', currency, icon: 'Wallet', color: '#10B981', createdAt: now },
      { id: crypto.randomUUID(), userId, name: 'Bank Account', type: 'bank', currency, icon: 'Building2', color: '#3B82F6', createdAt: now },
    ])
    seeded = true
  }
  return seeded
}
