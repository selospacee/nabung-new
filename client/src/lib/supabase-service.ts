import { supabase } from './supabase'
import type { User, Account, Category, Transaction, Budget, SavingsGoal } from '../types'

// Helper to convert snake_case to camelCase
function toCamelCase(obj: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(obj)) {
    const camelKey = key.replace(/_([a-z])/g, (_, letter) => letter.toUpperCase())
    result[camelKey] = value
  }
  return result
}

// Helper to convert camelCase to snake_case
function toSnakeCase(obj: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(obj)) {
    const snakeKey = key.replace(/[A-Z]/g, letter => `_${letter.toLowerCase()}`)
    result[snakeKey] = value
  }
  return result
}

// Profiles
export async function getProfile(userId: string): Promise<User | null> {
  const { data, error } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', userId)
    .single()
  
  if (error && error.code !== 'PGRST116') throw error
  return data ? toCamelCase(data) as unknown as User : null
}

export async function updateProfile(userId: string, data: Partial<User>): Promise<User> {
  const { data: result, error } = await supabase
    .from('profiles')
    .update({ ...toSnakeCase(data as Record<string, unknown>), updatedAt: new Date().toISOString() })
    .eq('id', userId)
    .select()
    .single()
  
  if (error) throw error
  return toCamelCase(result) as unknown as User
}

// Accounts
export async function getAccounts(userId: string): Promise<Account[]> {
  const { data, error } = await supabase
    .from('accounts')
    .select('*')
    .eq('user_id', userId)
    .order('created_at', { ascending: true })
  
  if (error) throw error
  return (data || []).map(toCamelCase) as unknown as Account[]
}

export async function createAccount(account: Omit<Account, 'id' | 'createdAt'>): Promise<Account> {
  const { data, error } = await supabase
    .from('accounts')
    .insert(toSnakeCase(account as Record<string, unknown>))
    .select()
    .single()
  
  if (error) throw error
  return toCamelCase(data) as unknown as Account
}

export async function updateAccount(id: string, data: Partial<Account>): Promise<Account> {
  const { data: result, error } = await supabase
    .from('accounts')
    .update(toSnakeCase(data as Record<string, unknown>))
    .eq('id', id)
    .select()
    .single()
  
  if (error) throw error
  return toCamelCase(result) as unknown as Account
}

export async function deleteAccount(id: string): Promise<void> {
  const { error } = await supabase.from('accounts').delete().eq('id', id)
  if (error) throw error
}

// Categories
export async function getCategories(userId: string): Promise<Category[]> {
  const { data, error } = await supabase
    .from('categories')
    .select('*')
    .eq('user_id', userId)
    .order('sort_order', { ascending: true })
  
  if (error) throw error
  return (data || []).map(toCamelCase) as unknown as Category[]
}

export async function createCategory(category: Omit<Category, 'id' | 'createdAt'>): Promise<Category> {
  const { data, error } = await supabase
    .from('categories')
    .insert(toSnakeCase(category as Record<string, unknown>))
    .select()
    .single()
  
  if (error) throw error
  return toCamelCase(data) as unknown as Category
}

export async function updateCategory(id: string, data: Partial<Category>): Promise<Category> {
  const { data: result, error } = await supabase
    .from('categories')
    .update(toSnakeCase(data as Record<string, unknown>))
    .eq('id', id)
    .select()
    .single()
  
  if (error) throw error
  return toCamelCase(result) as unknown as Category
}

export async function deleteCategory(id: string): Promise<void> {
  const { error } = await supabase.from('categories').delete().eq('id', id)
  if (error) throw error
}

// Transactions
export async function getTransactions(userId: string, options?: { 
  limit?: number; 
  offset?: number;
  accountId?: string;
  categoryId?: string;
  type?: 'income' | 'expense' | 'transfer';
  startDate?: string;
  endDate?: string;
}): Promise<Transaction[]> {
  let query = supabase
    .from('transactions')
    .select('*')
    .eq('user_id', userId)
    .is('deleted_at', null)
    .order('date', { ascending: false })

  if (options?.limit) query = query.limit(options.limit)
  if (options?.offset) query = query.range(options.offset, options.offset + (options.limit || 50) - 1)
  if (options?.accountId) query = query.eq('account_id', options.accountId)
  if (options?.categoryId) query = query.eq('category_id', options.categoryId)
  if (options?.type) query = query.eq('type', options.type)
  if (options?.startDate) query = query.gte('date', options.startDate)
  if (options?.endDate) query = query.lte('date', options.endDate)

  const { data, error } = await query
  if (error) throw error
  return (data || []).map(toCamelCase) as unknown as Transaction[]
}

export async function createTransaction(transaction: Omit<Transaction, 'id' | 'createdAt' | 'updatedAt'>): Promise<Transaction> {
  const { data, error } = await supabase
    .from('transactions')
    .insert(toSnakeCase(transaction as Record<string, unknown>))
    .select()
    .single()
  
  if (error) throw error
  return toCamelCase(data) as unknown as Transaction
}

export async function updateTransaction(id: string, data: Partial<Transaction>): Promise<Transaction> {
  const { data: result, error } = await supabase
    .from('transactions')
    .update({ ...toSnakeCase(data as Record<string, unknown>), updatedAt: new Date().toISOString() })
    .eq('id', id)
    .select()
    .single()
  
  if (error) throw error
  return toCamelCase(result) as unknown as Transaction
}

export async function deleteTransaction(id: string): Promise<void> {
  const { error } = await supabase
    .from('transactions')
    .update({ deletedAt: new Date().toISOString() })
    .eq('id', id)
  if (error) throw error
}

// Budgets
export async function getBudgets(userId: string, yearMonth?: string): Promise<Budget[]> {
  let query = supabase
    .from('budgets')
    .select('*')
    .eq('user_id', userId)
  
  if (yearMonth) query = query.eq('year_month', yearMonth)
  
  const { data, error } = await query
  if (error) throw error
  return (data || []).map(toCamelCase) as unknown as Budget[]
}

export async function createBudget(budget: Omit<Budget, 'id' | 'createdAt'>): Promise<Budget> {
  const { data, error } = await supabase
    .from('budgets')
    .insert(toSnakeCase(budget as Record<string, unknown>))
    .select()
    .single()
  
  if (error) throw error
  return toCamelCase(data) as unknown as Budget
}

export async function updateBudget(id: string, data: Partial<Budget>): Promise<Budget> {
  const { data: result, error } = await supabase
    .from('budgets')
    .update(toSnakeCase(data as Record<string, unknown>))
    .eq('id', id)
    .select()
    .single()
  
  if (error) throw error
  return toCamelCase(result) as unknown as Budget
}

export async function deleteBudget(id: string): Promise<void> {
  const { error } = await supabase.from('budgets').delete().eq('id', id)
  if (error) throw error
}

// Savings Goals
export async function getSavingsGoals(userId: string): Promise<SavingsGoal[]> {
  const { data, error } = await supabase
    .from('savings_goals')
    .select('*')
    .eq('user_id', userId)
    .order('target_date', { ascending: true })
  
  if (error) throw error
  return (data || []).map(toCamelCase) as unknown as SavingsGoal[]
}

export async function createSavingsGoal(goal: Omit<SavingsGoal, 'id' | 'createdAt'>): Promise<SavingsGoal> {
  const { data, error } = await supabase
    .from('savings_goals')
    .insert(toSnakeCase(goal as Record<string, unknown>))
    .select()
    .single()
  
  if (error) throw error
  return toCamelCase(data) as unknown as SavingsGoal
}

export async function updateSavingsGoal(id: string, data: Partial<SavingsGoal>): Promise<SavingsGoal> {
  const { data: result, error } = await supabase
    .from('savings_goals')
    .update(toSnakeCase(data as Record<string, unknown>))
    .eq('id', id)
    .select()
    .single()
  
  if (error) throw error
  return toCamelCase(result) as unknown as SavingsGoal
}

export async function deleteSavingsGoal(id: string): Promise<void> {
  const { error } = await supabase.from('savings_goals').delete().eq('id', id)
  if (error) throw error
}

// User Settings
export async function getUserSettings(userId: string): Promise<{ isOnboarded: boolean } | null> {
  const { data, error } = await supabase
    .from('user_settings')
    .select('is_onboarded')
    .eq('user_id', userId)
    .single()
  
  if (error && error.code !== 'PGRST116') throw error
  return data ? { isOnboarded: data.is_onboarded } : null
}

export async function updateUserSettings(userId: string, data: { isOnboarded?: boolean }): Promise<void> {
  const { error } = await supabase
    .from('user_settings')
    .update(toSnakeCase(data as Record<string, unknown>))
    .eq('user_id', userId)
  
  if (error) throw error
}