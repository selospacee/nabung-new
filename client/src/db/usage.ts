import { db } from './index'
import { nowIso } from './stamps'

/** Dipakai untuk menolak hapus bila masih ada yang merujuk. Hanya baris yang tidak terhapus yang dihitung. */
export async function categoryUsage(categoryId: string): Promise<{ transactions: number; budgets: number }> {
  const transactions = await db.transactions.where('categoryId').equals(categoryId).filter(t => !t.deletedAt).count()
  const budgets = await db.budgets.where('categoryId').equals(categoryId).filter(b => !b.deletedAt).count()
  return { transactions, budgets }
}

export async function accountUsage(accountId: string): Promise<number> {
  return db.transactions.where('accountId').equals(accountId).filter(t => !t.deletedAt).count()
}

export class InUseError extends Error {}

/** Hapus lunak akun. Ditolak bila masih dipakai transaksi. Dalam satu transaksi Dexie supaya cek dan tulis atomik. */
export async function softDeleteAccount(id: string): Promise<void> {
  await db.transaction('rw', db.accounts, db.transactions, async () => {
    const n = await accountUsage(id)
    if (n > 0) throw new InUseError(`Akun masih dipakai oleh ${n} transaksi. Pindahkan atau hapus transaksinya dulu.`)
    await db.accounts.update(id, { deletedAt: nowIso() })
  })
}

/** Hapus lunak kategori. Ditolak bila masih dipakai transaksi atau budget. */
export async function softDeleteCategory(id: string): Promise<void> {
  await db.transaction('rw', db.categories, db.transactions, db.budgets, async () => {
    const u = await categoryUsage(id)
    if (u.transactions + u.budgets > 0) {
      throw new InUseError(
        `Kategori masih dipakai oleh ${u.transactions} transaksi dan ${u.budgets} budget. Pindahkan transaksinya atau hapus budgetnya dulu.`,
      )
    }
    await db.categories.update(id, { deletedAt: nowIso() })
  })
}

/** Hapus lunak budget. Tidak ada rujukan yang perlu diperiksa. */
export async function softDeleteBudget(id: string): Promise<void> {
  await db.budgets.update(id, { deletedAt: nowIso() })
}
