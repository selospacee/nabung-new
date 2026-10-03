import React, { createContext, useContext, useState, useEffect, useCallback } from 'react'
import { supabase } from '../lib/supabase'
import type { User, Account, Category, Transaction, Budget, SavingsGoal } from '../types'

interface SupabaseAuthContextType {
  user: User | null
  isLoading: boolean
  isOnboarded: boolean
  login: (email: string, password: string) => Promise<void>
  signUp: (email: string, password: string, name: string, currency: string, timezone: string) => Promise<void>
  logout: () => Promise<void>
  updateProfile: (data: Partial<User>) => Promise<void>
}

const SupabaseAuthContext = createContext<SupabaseAuthContextType | null>(null)

export function SupabaseAuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [isOnboarded, setIsOnboarded] = useState(false)

  useEffect(() => {
    // Check for existing session
    const checkSession = async () => {
      const { data: { session } } = await supabase.auth.getSession()
      if (session?.user) {
        await fetchUserProfile(session.user.id)
      } else {
        setIsLoading(false)
      }
    }

    checkSession()

    // Listen for auth changes
    const { data: { subscription } } = supabase.auth.onAuthStateChange(async (event, session) => {
      if (event === 'SIGNED_IN' && session?.user) {
        await fetchUserProfile(session.user.id)
      } else if (event === 'SIGNED_OUT') {
        setUser(null)
        setIsOnboarded(false)
        setIsLoading(false)
      }
    })

    return () => subscription.unsubscribe()
  }, [])

  const fetchUserProfile = async (userId: string) => {
    try {
      const { data: profile, error } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', userId)
        .single()

      if (error && error.code !== 'PGRST116') throw error

      if (profile) {
        const { data: onboarded } = await supabase
          .from('user_settings')
          .select('is_onboarded')
          .eq('user_id', userId)
          .single()

        setUser({
          id: profile.id,
          email: profile.email,
          name: profile.name,
          currency: profile.currency,
          timezone: profile.timezone,
          theme: profile.theme,
          defaultAccountId: profile.default_account_id,
          createdAt: profile.created_at,
          passwordHash: '',
          time: profile.created_at,
        })
        setIsOnboarded(onboarded?.is_onboarded ?? false)
      }
    } catch (error) {
      console.error('Error fetching user profile:', error)
    } finally {
      setIsLoading(false)
    }
  }

  const login = useCallback(async (email: string, password: string) => {
    const { error } = await supabase.auth.signInWithPassword({ email, password })
    if (error) throw error
  }, [])

  const signUp = useCallback(async (email: string, password: string, name: string, currency: string, timezone: string) => {
    const { data, error } = await supabase.auth.signUp({ email, password })
    if (error) throw error

    if (data.user) {
      // Create profile
      const { error: profileError } = await supabase
        .from('profiles')
        .insert({
          id: data.user.id,
          email,
          name,
          currency: currency || 'USD',
          timezone: timezone || Intl.DateTimeFormat().resolvedOptions().timeZone,
          theme: 'dark',
          default_account_id: null,
          created_at: new Date().toISOString(),
        })
      if (profileError) throw profileError

      // Create user settings
      const { error: settingsError } = await supabase
        .from('user_settings')
        .insert({
          user_id: data.user.id,
          is_onboarded: false,
        })
      if (settingsError) throw settingsError

      // Create default categories
      const defaultCategories = getDefaultCategories(data.user.id)
      const { error: catError } = await supabase
        .from('categories')
        .insert(defaultCategories)
      if (catError) throw catError
    }
  }, [])

  const logout = useCallback(async () => {
    const { error } = await supabase.auth.signOut()
    if (error) throw error
  }, [])

  const updateProfile = useCallback(async (data: Partial<User>) => {
    if (!user) return
    const { error } = await supabase
      .from('profiles')
      .update({
        ...data,
        updated_at: new Date().toISOString(),
      })
      .eq('id', user.id)
    if (error) throw error

    setUser(prev => prev ? { ...prev, ...data, updatedAt: new Date().toISOString() } : null)
  }, [user])

  // Default categories matching Dexie
  const getDefaultCategories = (userId: string) => {
    const DEFAULT_CATEGORIES = [
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
    return DEFAULT_CATEGORIES.map(c => ({ ...c, userId }))
  }

  return (
    <SupabaseAuthContext.Provider value={{
      user,
      isLoading,
      isOnboarded,
      login,
      signUp,
      logout,
      updateProfile,
    }}>
      {children}
    </SupabaseAuthContext.Provider>
  )
}

export function useSupabaseAuth(): SupabaseAuthContextType {
  const ctx = useContext(SupabaseAuthContext)
  if (!ctx) throw new Error('useSupabaseAuth must be used within SupabaseAuthProvider')
  return ctx
}