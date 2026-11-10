import { supabase } from '../lib/supabase'
import { db } from './index'
import type { Account, Category, Transaction, Budget, SavingsGoal, User, Cashier } from '../types'

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

function validateUserId(userId: unknown): asserts userId is string {
  if (!userId || typeof userId !== 'string' || userId.trim() === '') {
    throw new Error('[Sync] Invalid userId: must be a non-empty string')
  }
}

export async function syncUserDataFromSupabase(userId: string): Promise<void> {
  validateUserId(userId)
  console.log('[Sync] Starting sync for user:', userId)

  // Critical: verify the session user matches the userId we're syncing for
  const { data: { session } } = await supabase.auth.getSession()
  if (session?.user?.id !== userId) {
    const msg = `Auth mismatch: session user (${session?.user?.id || 'none'}) !== sync userId (${userId})`
    console.error('[Sync]', msg)
    throw new Error(msg)
  }

  try {
    // 1. Sync Profile (User)
    const { data: profile, error: profileError } = await supabase
      .from('profiles')
      .select('*')
      .eq('id', userId)
      .single()
    
    if (profileError && profileError.code !== 'PGRST116' && !profileError.message?.includes('406')) throw profileError
    
    if (profile) {
      const userData = toCamelCase(profile) as unknown as User
      // Ensure passwordHash and time fields
      const userWithDefaults = {
        ...userData,
        passwordHash: userData.passwordHash || '',
        time: userData.time || userData.createdAt || new Date().toISOString(),
      }
      await db.users.put(userWithDefaults)
      console.log('[Sync] Synced user profile')
    }

    // 2. Sync Accounts
    const { data: accounts, error: accountsError } = await supabase
      .from('accounts')
      .select('id, user_id, name, type, currency, icon, color, created_at')
      .eq('user_id', userId)
      .order('created_at', { ascending: true })
    
    if (accountsError) throw accountsError
    
    if (accounts && accounts.length > 0) {
      const accountsData = accounts.map(toCamelCase) as unknown as Account[]
      await db.accounts.bulkPut(accountsData)
      console.log('[Sync] Synced', accountsData.length, 'accounts')
    }

    // 3. Sync Categories
    const { data: categories, error: categoriesError } = await supabase
      .from('categories')
      .select('*')
      .eq('user_id', userId)
      .order('sort_order', { ascending: true })
    
    if (categoriesError) throw categoriesError
    
    if (categories && categories.length > 0) {
      const categoriesData = categories.map(toCamelCase) as unknown as Category[]
      await db.categories.bulkPut(categoriesData)
      console.log('[Sync] Synced', categoriesData.length, 'categories')
    }

    // 4. Sync Budgets
    const { data: budgets, error: budgetsError } = await supabase
      .from('budgets')
      .select('*')
      .eq('user_id', userId)
    
    if (budgetsError) throw budgetsError
    
    if (budgets && budgets.length > 0) {
      const budgetsData = budgets.map(toCamelCase) as unknown as Budget[]
      await db.budgets.bulkPut(budgetsData)
      console.log('[Sync] Synced', budgetsData.length, 'budgets')
    }

    // 5. Sync Savings Goals
    const { data: goals, error: goalsError } = await supabase
      .from('savings_goals')
      .select('*')
      .eq('user_id', userId)
      .order('target_date', { ascending: true })
  
    if (goalsError) throw goalsError
  
    if (goals && goals.length > 0) {
      const goalsData = goals.map(toCamelCase) as unknown as SavingsGoal[]
      await db.goals.bulkPut(goalsData)
      console.log('[Sync] Synced', goalsData.length, 'savings goals')
    }

    // 6. Sync Cashiers
    const { data: cashiers, error: cashiersError } = await supabase
      .from('cashiers')
      .select('*')
      .eq('user_id', userId)
      .order('name', { ascending: true })
  
    if (cashiersError) throw cashiersError
  
    if (cashiers && cashiers.length > 0) {
      const cashiersData = cashiers.map(toCamelCase) as unknown as Cashier[]
      await db.cashiers.bulkPut(cashiersData)
      console.log('[Sync] Synced', cashiersData.length, 'cashiers')
    }

    console.log('[Sync] Complete for user:', userId)
  } catch (error) {
    console.error('[Sync] Error:', error)
    throw error
  }
}

// Also export function to push local changes to Supabase
// Allowed keys per table to prevent 400 from unknown fields
const ALLOWED_KEYS = {
  accounts: ['id', 'user_id', 'name', 'type', 'currency', 'icon', 'color', 'created_at', 'updated_at'],
  categories: ['id', 'user_id', 'name', 'type', 'icon', 'color', 'parent_id', 'sort_order', 'merchant_patterns', 'updated_at'],
  transactions: ['id', 'user_id', 'account_id', 'category_id', 'cashier_id', 'amount', 'currency', 'type', 'date', 'description', 'merchant', 'notes', 'receipt_image', 'receipt_ocr_text', 'location', 'latitude', 'longitude', 'created_at', 'updated_at', 'deleted_at'],
  budgets: ['id', 'user_id', 'category_id', 'year_month', 'limit_amount', 'alert_threshold', 'rollover', 'created_at', 'updated_at'],
  savings_goals: ['id', 'user_id', 'name', 'target_amount', 'current_amount', 'target_date', 'color', 'icon', 'created_at', 'updated_at'],
  cashiers: ['id', 'user_id', 'name', 'email', 'phone', 'role', 'cup_commission', 'base_salary', 'is_active', 'merchant_name', 'created_at', 'updated_at'],
}

function stripToAllowedKeys(obj: Record<string, unknown>, table: string): Record<string, unknown> {
  const allowed = ALLOWED_KEYS[table as keyof typeof ALLOWED_KEYS]
  if (!allowed) return obj
  const result: Record<string, unknown> = {}
  for (const key of allowed) {
    if (key in obj) result[key] = obj[key]
  }
  return result
}

function formatSupabaseError(error: any): string {
  if (!error) return 'Unknown error'
  const parts: string[] = []
  if (error.message) parts.push(error.message)
  if (error.code) parts.push(`code:${error.code}`)
  if (error.details) parts.push(`details:${error.details}`)
  if (error.hint) parts.push(`hint:${error.hint}`)
  return parts.length > 0 ? parts.join(' | ') : JSON.stringify(error)
}

interface PushResult {
  success: boolean
  errors: Array<{ table: string; message: string }>
}

export async function pushLocalChangesToSupabase(userId: string): Promise<PushResult> {
  validateUserId(userId)
  console.log('[Sync] Pushing local changes for user:', userId)
  
  // Debug: check auth state
  const { data: { session } } = await supabase.auth.getSession()
  console.log('[Sync] Supabase session:', session?.user?.id || 'none')
  
  // Critical: verify the session user matches the userId we're pushing for
  if (session?.user?.id !== userId) {
    const msg = `Auth mismatch: session user (${session?.user?.id || 'none'}) !== push userId (${userId})`
    console.error('[Sync]', msg)
    return { success: false, errors: [{ table: 'auth', message: msg }] }
  }
  
  const errors: Array<{ table: string; message: string }> = []

  try {
    // Push accounts
    const localAccounts = await db.accounts.where('userId').equals(userId).toArray()
    for (const account of localAccounts) {
      const snakeAccount = toSnakeCase(account as unknown as Record<string, unknown>)
      snakeAccount.user_id = userId
      delete snakeAccount.balance
      const cleanPayload = stripToAllowedKeys(snakeAccount, 'accounts')
      const { error } = await supabase.from('accounts').upsert(cleanPayload, { onConflict: 'id' })
      if (error) {
        const msg = formatSupabaseError(error)
        console.error('[Sync] Push account error:', msg)
        errors.push({ table: 'accounts', message: msg })
      }
    }

    // Push categories
    const localCategories = await db.categories.where('userId').equals(userId).toArray()
    for (const category of localCategories) {
      const snakeCategory = toSnakeCase(category as unknown as Record<string, unknown>)
      snakeCategory.user_id = userId
      const cleanPayload = stripToAllowedKeys(snakeCategory, 'categories')
      const { error } = await supabase.from('categories').upsert(cleanPayload, { onConflict: 'id' })
      if (error) {
        const msg = formatSupabaseError(error)
        console.error('[Sync] Push category error:', msg)
        errors.push({ table: 'categories', message: msg })
      }
    }

    // Push transactions
    const localTransactions = await db.transactions.where('userId').equals(userId).toArray()
    console.log('[Sync] Found local transactions:', localTransactions.length)
    for (const transaction of localTransactions) {
      const snakeTransaction = toSnakeCase(transaction as unknown as Record<string, unknown>)
      snakeTransaction.user_id = userId
      const cleanPayload = stripToAllowedKeys(snakeTransaction, 'transactions')
      console.log('[Sync] Upserting transaction:', cleanPayload)
      const { error } = await supabase.from('transactions').upsert(cleanPayload, { onConflict: 'id' })
      if (error) {
        const msg = formatSupabaseError(error)
        console.error('[Sync] Push transaction error:', msg)
        errors.push({ table: 'transactions', message: msg })
      }
    }

    // Push budgets
    const localBudgets = await db.budgets.where('userId').equals(userId).toArray()
    for (const budget of localBudgets) {
      const snakeBudget = toSnakeCase(budget as unknown as Record<string, unknown>)
      snakeBudget.user_id = userId
      const cleanPayload = stripToAllowedKeys(snakeBudget, 'budgets')
      const { error } = await supabase.from('budgets').upsert(cleanPayload, { onConflict: 'id' })
      if (error) {
        const msg = formatSupabaseError(error)
        console.error('[Sync] Push budget error:', msg)
        errors.push({ table: 'budgets', message: msg })
      }
    }

    // Push goals
    const localGoals = await db.goals.where('userId').equals(userId).toArray()
    for (const goal of localGoals) {
      const snakeGoal = toSnakeCase(goal as unknown as Record<string, unknown>)
      snakeGoal.user_id = userId
      const cleanPayload = stripToAllowedKeys(snakeGoal, 'savings_goals')
      const { error } = await supabase.from('savings_goals').upsert(cleanPayload, { onConflict: 'id' })
      if (error) {
        const msg = formatSupabaseError(error)
        console.error('[Sync] Push goal error:', msg)
        errors.push({ table: 'savings_goals', message: msg })
      }
    }

    // Push cashiers
    const localCashiers = await db.cashiers.where('userId').equals(userId).toArray()
    for (const cashier of localCashiers) {
      const snakeCashier = toSnakeCase(cashier as unknown as Record<string, unknown>)
      snakeCashier.user_id = userId
      const cleanPayload = stripToAllowedKeys(snakeCashier, 'cashiers')
      const { error } = await supabase.from('cashiers').upsert(cleanPayload, { onConflict: 'id' })
      if (error) {
        const msg = formatSupabaseError(error)
        console.error('[Sync] Push cashier error:', msg)
        errors.push({ table: 'cashiers', message: msg })
      }
    }

    console.log('[Sync] Push complete for user:', userId, errors.length > 0 ? `( ${errors.length} errors )` : '(ok)')
    return { success: errors.length === 0, errors }
  } catch (error) {
    console.error('[Sync] Push unexpected error:', formatSupabaseError(error))
    return { success: false, errors: [{ table: 'unknown', message: formatSupabaseError(error) }] }
  }
}