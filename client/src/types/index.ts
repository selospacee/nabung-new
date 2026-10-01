export interface User {
  id: string
  email: string
  name: string
  currency: string
  timezone: string
  theme: 'dark' | 'light' | 'system'
  defaultAccountId: string | null
  createdAt: string
  passwordHash: string
  time: string
}

export interface Account {
  id: string
  userId: string
  name: string
  type: 'cash' | 'bank' | 'credit' | 'investment'
  balance: number
  currency: string
  icon: string
  color: string
  createdAt: string
}

export interface Category {
  id: string
  userId: string
  name: string
  type: 'income' | 'expense' | 'transfer'
  icon: string
  color: string
  parentId: string | null
  sortOrder: number
  merchantPatterns: string[]
}

export interface Transaction {
  id: string
  userId: string
  accountId: string
  categoryId: string | null
  amount: number
  currency: string
  type: 'income' | 'expense' | 'transfer'
  date: string
  description: string
  merchant: string
  notes: string
  receiptImage: string | null
  receiptOcrText: string | null
  location: string | null
  latitude: number | null
  longitude: number | null
  createdAt: string
  updatedAt: string
  deletedAt: string | null
}

export interface Budget {
  id: string
  userId: string
  categoryId: string
  yearMonth: string
  limitAmount: number
  alertThreshold: number
  rollover: boolean
  createdAt: string
}

export interface SavingsGoal {
  id: string
  userId: string
  name: string
  targetAmount: number
  currentAmount: number
  targetDate: string
  color: string
  icon: string
  createdAt: string
}
