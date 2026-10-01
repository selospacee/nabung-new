import { useMemo } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '../db'
import type { Transaction } from '../types'

let currentUserId: string | null = null

export function setCurrentUser(id: string) {
  currentUserId = id
  localStorage.setItem('nabung_currentUser', id)
}

export function getCurrentUser(): string | null {
  if (!currentUserId) {
    currentUserId = localStorage.getItem('nabung_currentUser') || null
  }
  return currentUserId
}

export function clearCurrentUser() {
  currentUserId = null
  localStorage.removeItem('nabung_currentUser')
}

// User hooks
export function useCurrentUser() {
  const id = getCurrentUser()
  const user = useLiveQuery(() => id ? db.users.get(id) : undefined)
  return { user, userId: id }
}

export function useUsers() {
  return useLiveQuery(() => db.users.toArray())
}

// Account hooks
export function useAccounts(userId?: string | null) {
  return useLiveQuery(async () => {
    if (!userId) userId = getCurrentUser()
    if (!userId) return []
    return db.accounts.where('userId').equals(userId).sortBy('createdAt')
  }, [])
}

export function useAccount(id: string | null) {
  const uid = getCurrentUser()
  return useLiveQuery(async () => {
    if (!id || !uid) return undefined
    return db.accounts.get(id)
  }, [id, uid])
}

export function useDefaultAccount() {
  const { user } = useCurrentUser()
  const accounts = useAccounts()
  const account = useMemo(() => {
    if (!user?.defaultAccountId || !accounts) return null
    return accounts.find(a => a.id === user.defaultAccountId) || accounts[0] || null
  }, [user, accounts])
  return account
}

// Category hooks
export function useCategories(userId?: string | null) {
  return useLiveQuery(async () => {
    if (!userId) userId = getCurrentUser()
    if (!userId) return []
    return db.categories.where('userId').equals(userId).sortBy('sortOrder')
  }, [])
}

export function useCategoriesByType(type: 'income' | 'expense' | 'transfer', userId?: string | null) {
  const all = useCategories(userId)
  return useMemo(() => {
    if (!all) return []
    return all.filter(c => c.type === type)
  }, [all, type])
}

export function useIncomeCategories(userId?: string | null) {
  return useCategoriesByType('income', userId)
}

export function useExpenseCategories(userId?: string | null) {
  return useCategoriesByType('expense', userId)
}

// Transaction hooks
export function useTransactions(userId?: string | null, filters?: {
  startDate?: string
  endDate?: string
  categoryIds?: string[]
  accountIds?: string[]
  type?: 'income' | 'expense' | 'transfer'
  search?: string
}) {
  return useLiveQuery(async () => {
    if (!userId) userId = getCurrentUser()
    if (!userId) return []

    let query = db.transactions.where('userId').equals(userId).and(t => !t.deletedAt)

    // Apply filters
    const results = await query.toArray()

    let filtered = results

    if (filters?.startDate) {
      filtered = filtered.filter(t => t.date >= filters.startDate!)
    }
    if (filters?.endDate) {
      filtered = filtered.filter(t => t.date <= filters.endDate!)
    }
    if (filters?.categoryIds?.length) {
      filtered = filtered.filter(t => t.categoryId && filters.categoryIds!.includes(t.categoryId))
    }
    if (filters?.accountIds?.length) {
      filtered = filtered.filter(t => filters.accountIds!.includes(t.accountId))
    }
    if (filters?.type) {
      filtered = filtered.filter(t => t.type === filters.type)
    }
    if (filters?.search) {
      const q = filters.search.toLowerCase()
      filtered = filtered.filter(t =>
        t.description.toLowerCase().includes(q) ||
        t.merchant?.toLowerCase().includes(q)
      )
    }

    return filtered.sort((a, b) => b.date.localeCompare(a.date))
  }, [])
}

export function useTransaction(id: string | null) {
  const uid = getCurrentUser()
  return useLiveQuery(async () => {
    if (!id || !uid) return undefined
    return db.transactions.get(id)
  }, [id, uid])
}

// Budget hooks
export function useBudgets(userId?: string | null, yearMonth?: string) {
  return useLiveQuery(async () => {
    if (!userId) userId = getCurrentUser()
    if (!userId || !yearMonth) return []
    return db.budgets.where({ userId, yearMonth }).toArray()
  }, [])
}

export function useBudgetsByCategory(categoryId: string, yearMonth?: string) {
  const budgets = useBudgets(undefined, yearMonth)
  return useMemo(() => {
    if (!budgets) return undefined
    return budgets.find(b => b.categoryId === categoryId)
  }, [budgets, categoryId])
}

// Goal hooks
export function useGoals(userId?: string | null) {
  return useLiveQuery(async () => {
    if (!userId) userId = getCurrentUser()
    if (!userId) return []
    return db.goals.where('userId').equals(userId).toArray()
  }, [])
}

// Stats helpers
export function computeMonthlyStats(transactions: Transaction[], yearMonth: string) {
  const prefix = yearMonth + '-'
  const monthTxns = transactions.filter(t => t.date.startsWith(prefix))

  const income = monthTxns.filter(t => t.type === 'income').reduce((sum, t) => sum + t.amount, 0)
  const expense = monthTxns.filter(t => t.type === 'expense').reduce((sum, t) => sum + t.amount, 0)
  const transfer = monthTxns.filter(t => t.type === 'transfer').reduce((sum, t) => sum + t.amount, 0)
  const net = income - expense

  const byCategory: Record<string, { income: number; expense: number }> = {}
  for (const t of monthTxns) {
    if (t.categoryId) {
      if (!byCategory[t.categoryId]) byCategory[t.categoryId] = { income: 0, expense: 0 }
      if (t.type === 'income') byCategory[t.categoryId].income += t.amount
      else if (t.type === 'expense') byCategory[t.categoryId].expense += t.amount
    }
  }

  return { income, expense, transfer, net, byCategory, count: monthTxns.length }
}

export function computeMonthlyTrend(transactions: Transaction[], months = 6) {
  const result: { month: string; income: number; expense: number }[] = []
  const now = new Date()

  for (let i = months - 1; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1)
    const ym = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
    const monthTxns = transactions.filter(t => t.date.startsWith(ym))
    const income = monthTxns.filter(t => t.type === 'income').reduce((s, t) => s + t.amount, 0)
    const expense = monthTxns.filter(t => t.type === 'expense').reduce((s, t) => s + t.amount, 0)
    result.push({ month: ym, income, expense })
  }

  return result
}
