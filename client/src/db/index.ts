import Dexie, { type Table } from 'dexie'
import type { User, Account, Category, Transaction, Budget, SavingsGoal, Cashier } from '../types'
import { installStampHooks, markRemoteTx, SYNCED_TABLES } from './stamps'

/** Penanda sinkronisasi per baris: _dirty = 1 berarti belum terkirim ke server. */
export type SyncMeta = { _dirty?: 0 | 1 }

/** Kursor pull per (user, tabel). cursor = updated_at server tertinggi yang sudah di-apply. */
export interface SyncMetaRow {
  key: string
  cursor: string | null
  /** Waktu (ISO, jam perangkat) pull penuh terakhir yang selesai. Dipakai untuk jaring pengaman N jam. */
  lastFullAt: string | null
}

class NabungDB extends Dexie {
  users!: Table<User, string>
  accounts!: Table<Account & SyncMeta, string>
  categories!: Table<Category & SyncMeta, string>
  transactions!: Table<Transaction & SyncMeta, string>
  budgets!: Table<Budget & SyncMeta, string>
  goals!: Table<SavingsGoal & SyncMeta, string>
  cashiers!: Table<Cashier & SyncMeta, string>
  /** Penanda pull bertahap per (user, tabel): key = `${userId}:${table}`. */
  syncMeta!: Table<SyncMetaRow, string>

  constructor() {
    super('nabung-db')
    this.version(3).stores({
      users: 'id, email',
      accounts: 'id, userId, type',
      categories: 'id, userId, type, parentId',
      transactions: 'id, userId, accountId, categoryId, cashierId, date, type, deletedAt, latitude, longitude',
      budgets: 'id, userId, categoryId, yearMonth',
      goals: 'id, userId',
      cashiers: 'id, userId, isActive',
    })
    // v4: indeks _dirty untuk push delta, dan stempel updatedAt untuk semua tabel yang disinkronkan.
    this.version(4)
      .stores({
        users: 'id, email',
        accounts: 'id, userId, type, _dirty',
        categories: 'id, userId, type, parentId, _dirty',
        transactions: 'id, userId, accountId, categoryId, cashierId, date, type, deletedAt, latitude, longitude, _dirty',
        budgets: 'id, userId, categoryId, yearMonth, _dirty',
        goals: 'id, userId, _dirty',
        cashiers: 'id, userId, isActive, _dirty',
      })
      .upgrade(tx => {
        // Data lama belum tentu sudah terkirim: tandai semua sebagai dirty. Push tetap aman
        // karena server menang bila versinya lebih baru. Penulisan ini dari upgrade, bukan user,
        // sehingga stempel tidak boleh digeser: updatedAt lama dipertahankan.
        markRemoteTx(tx)
        return Promise.all(
          SYNCED_TABLES.map(name =>
            tx.table(name).toCollection().modify((row: Record<string, unknown>) => {
              row._dirty = 1
              if (!row.updatedAt) row.updatedAt = (row.createdAt as string) ?? new Date().toISOString()
            }),
          ),
        )
      })
    // v5: penghapusan lunak (deleted_at) untuk akun, kategori, budget, goal, cashier; penanda pull bertahap.
    this.version(5).stores({
      users: 'id, email',
      accounts: 'id, userId, type, deletedAt, _dirty',
      categories: 'id, userId, type, parentId, deletedAt, _dirty',
      transactions: 'id, userId, accountId, categoryId, cashierId, date, type, deletedAt, latitude, longitude, _dirty',
      budgets: 'id, userId, categoryId, yearMonth, deletedAt, _dirty',
      goals: 'id, userId, deletedAt, _dirty',
      cashiers: 'id, userId, isActive, deletedAt, _dirty',
      syncMeta: 'key',
    })
    for (const name of SYNCED_TABLES) {
      installStampHooks(this[name] as unknown as { hook: (...args: any[]) => any })
    }
  }
}

export const db = new NabungDB()

// Default categories
export const DEFAULT_CATEGORIES = [
  { id: 'cat-salary', userId: '', name: 'Salary', type: 'income' as const, icon: 'Briefcase', color: '#10B981', parentId: null, sortOrder: 1, merchantPatterns: ['salary', 'payroll', 'gaji', 'penggajian'] },
  { id: 'cat-freelance', userId: '', name: 'Freelance', type: 'income' as const, icon: 'Laptop', color: '#06B6D4', parentId: null, sortOrder: 2, merchantPatterns: ['freelance', 'upwork', 'fiverr', 'freelancer'] },
  { id: 'cat-food', userId: '', name: 'Food & Drinks', type: 'expense' as const, icon: 'Utensils', color: '#F59E0B', parentId: null, sortOrder: 1, merchantPatterns: ['restaurant', 'cafe', 'food', 'coffee', 'makan', 'kuliner'] },
  { id: 'cat-transport', userId: '', name: 'Transport', type: 'expense' as const, icon: 'Car', color: '#6366F1', parentId: null, sortOrder: 2, merchantPatterns: ['taxi', 'uber', 'grab', 'transport', 'gas', 'bensin', 'parkir'] },
  { id: 'cat-shopping', userId: '', name: 'Shopping', type: 'expense' as const, icon: 'ShoppingBag', color: '#EC4899', parentId: null, sortOrder: 3, merchantPatterns: ['shop', 'mall', 'store', 'belanja'] },
  { id: 'cat-bills', userId: '', name: 'Bills & Utilities', type: 'expense' as const, icon: 'FileText', color: '#8B5CF6', parentId: null, sortOrder: 4, merchantPatterns: ['electric', 'water', 'internet', 'phone', 'tagihan', 'pln', 'pulsa'] },
  { id: 'cat-health', userId: '', name: 'Health', type: 'expense' as const, icon: 'Heart', color: '#EF4444', parentId: null, sortOrder: 5, merchantPatterns: ['hospital', 'clinic', 'pharmacy', 'kesehatan', 'obat'] },
  { id: 'cat-entertainment', userId: '', name: 'Entertainment', type: 'expense' as const, icon: 'Film', color: '#14B8A6', parentId: null, sortOrder: 6, merchantPatterns: ['movie', 'game', 'streaming', 'hiburan'] },
  { id: 'cat-education', userId: '', name: 'Education', type: 'expense' as const, icon: 'GraduationCap', color: '#F97316', parentId: null, sortOrder: 7, merchantPatterns: ['course', 'school', 'university', 'belajar'] },
  { id: 'cat-other-expense', userId: '', name: 'Other', type: 'expense' as const, icon: 'MoreHorizontal', color: '#6B7280', parentId: null, sortOrder: 99, merchantPatterns: [] },
  { id: 'cat-transfer', userId: '', name: 'Transfer', type: 'transfer' as const, icon: 'ArrowRightLeft', color: '#6B7280', parentId: null, sortOrder: 1, merchantPatterns: ['transfer', 'mutasi', 'tf'] },
]

export function getDefaultCategories(userId: string) {
  return DEFAULT_CATEGORIES.map(c => ({ ...c, userId }))
}
