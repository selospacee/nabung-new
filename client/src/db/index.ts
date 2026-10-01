import Dexie, { type Table } from 'dexie'
import type { User, Account, Category, Transaction, Budget, SavingsGoal } from '../types'

class NabungDB extends Dexie {
  users!: Table<User, string>
  accounts!: Table<Account, string>
  categories!: Table<Category, string>
  transactions!: Table<Transaction, string>
  budgets!: Table<Budget, string>
  goals!: Table<SavingsGoal, string>

  constructor() {
    super('nabung-db')
    this.version(2).stores({
      users: 'id, email',
      accounts: 'id, userId, type',
      categories: 'id, userId, type, parentId',
      transactions: 'id, userId, accountId, categoryId, date, type, deletedAt, latitude, longitude',
      budgets: 'id, userId, categoryId, yearMonth',
      goals: 'id, userId',
    })
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
