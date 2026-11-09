import React, { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react'
import { supabase } from '../lib/supabase'
import { setCurrentUser, clearCurrentUser } from '../db/hooks'
import { syncUserDataFromSupabase, pushLocalChangesToSupabase } from '../db/sync'
import type { User, Account, Category, Transaction, Budget, SavingsGoal } from '../types'

// UUID generator with fallback for older environments
function generateUUID(): string {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID()
  }
  // Fallback RFC4122 v4 UUID generator
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
    const r = Math.random() * 16 | 0
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16)
  })
}

// Helper to create a timeout promise
function timeoutPromise<T>(ms: number, message: string): Promise<T> {
  return new Promise((_, reject) => 
    setTimeout(() => reject(new Error(message)), ms)
  )
}

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
  
  // Track if we're currently fetching a profile to prevent duplicate calls
    const fetchPromisesRef = useRef<Map<string, Promise<void>>>(new Map())
    // Track userIds that have already been fully loaded (prevents stale-closure race)
    const loadedUserRef = useRef<Set<string>>(new Set())
    // Track userId currently being fetched (prevents stale-closure race)
    const fetchingUserRef = useRef<string | null>(null)
    // Track if initial load is complete
    const initialLoadDone = useRef(false)
    // Track if signUp is in progress to prevent premature sync from auth state change
    const signUpInProgressRef = useRef<Set<string>>(new Set())

  // Global safety timeout - forces isLoading=false after 20s no matter what
  useEffect(() => {
    const globalTimeout = setTimeout(() => {
      console.error('[Auth] GLOBAL TIMEOUT - forcing isLoading=false after 20s')
      setIsLoading(false)
    }, 20000)
    return () => clearTimeout(globalTimeout)
  }, [])

  const fetchUserProfile = useCallback(async (userId: string, force = false) => {
      // Skip if already loaded and not forced (prevents stale-closure duplicate fetch)
      if (!force && loadedUserRef.current.has(userId)) {
        console.log('[Auth] Profile already loaded for:', userId, '- skipping')
        return
      }
      // Prevent duplicate concurrent fetches for the same user - but wait for existing one
      let existingPromise = fetchPromisesRef.current.get(userId)
      if (existingPromise && !force) {
        console.log('[Auth] Already fetching profile for:', userId, '- waiting for existing')
        try {
          await existingPromise
        } catch {
          // Existing fetch failed, we'll retry below
        }
        // Check if user was set by the existing fetch
        if (loadedUserRef.current.has(userId)) {
          console.log('[Auth] Profile already loaded by existing fetch')
          return
        }
        // Existing fetch didn't set user, continue with our own fetch
      }
    
      console.log('[Auth] Fetching profile for:', userId)
            fetchingUserRef.current = userId

            // Create a promise that we can share with other callers
            let resolvePromise: (value: void) => void
            let rejectPromise: (reason: Error) => void
            const promise = new Promise<void>((resolve, reject) => {
              resolvePromise = resolve
              rejectPromise = reject
            })
            fetchPromisesRef.current.set(userId, promise)
    
      const safetyTimeout = setTimeout(() => {
        console.error('[Auth] Safety timeout (10s) - forcing isLoading=false')
        setIsLoading(false)
        fetchPromisesRef.current.delete(userId)
        rejectPromise(new Error('Profile fetch safety timeout'))
      }, 10000)
    
      try {
        console.log('[Auth] Querying profiles table for:', userId)
        const { data: profile, error } = await Promise.race([
          supabase.from('profiles').select('*').eq('id', userId).single(),
          timeoutPromise<never>(15000, 'Profile fetch timeout')
        ])
      
        if (error && error.code !== 'PGRST116' && !error.message?.includes('406')) throw error
      
        if (profile) {
          console.log('[Auth] Profile found:', profile.id)
          let isOnboardedValue = false
          try {
            const { data: onboarded } = await Promise.race([
              supabase.from('user_settings').select('is_onboarded').eq('user_id', userId).single(),
              timeoutPromise<never>(10000, 'Settings fetch timeout')
            ])
            isOnboardedValue = onboarded?.is_onboarded ?? false
          } catch (settingsError) {
            // user_settings doesn't exist - create it with onboarded=true for returning users
            console.log('[Auth] No user_settings found, creating with onboarded=true')
            await supabase.from('user_settings').insert({
              user_id: userId,
              is_onboarded: true,
            })
            isOnboardedValue = true
          }
        
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
          setCurrentUser(profile.id)
          setIsOnboarded(isOnboardedValue)
        } else {
          console.log('[Auth] No profile found for user, waiting for DB trigger...')
          // User exists in auth but no profile yet - wait for DB trigger to create it
          // Poll for up to 10 seconds for the profile to appear
          let profileCreated = false
          for (let i = 0; i < 20; i++) { // 20 * 500ms = 10 seconds
            await new Promise(r => setTimeout(r, 500))
            const { data: newProfile, error: pollError } = await supabase.from('profiles').select('*').eq('id', userId).single()
            if (pollError && pollError.code !== 'PGRST116' && !pollError.message?.includes('406')) {
              console.warn('[Auth] Poll error (ignoring):', pollError.message)
            }
            if (newProfile) {
              profileCreated = true
              // Profile found, process it normally
              let isOnboardedValue = false
              try {
                const { data: onboarded } = await Promise.race([
                  supabase.from('user_settings').select('is_onboarded').eq('user_id', userId).single(),
                  timeoutPromise<never>(10000, 'Settings fetch timeout')
                ])
                isOnboardedValue = onboarded?.is_onboarded ?? false
              } catch (settingsError) {
                console.log('[Auth] No user_settings found, creating with onboarded=true')
                await supabase.from('user_settings').insert({
                  user_id: userId,
                  is_onboarded: true,
                })
                isOnboardedValue = true
              }

              setUser({
                id: newProfile.id,
                email: newProfile.email,
                name: newProfile.name,
                currency: newProfile.currency,
                timezone: newProfile.timezone,
                theme: newProfile.theme,
                defaultAccountId: newProfile.default_account_id,
                createdAt: newProfile.created_at,
                passwordHash: '',
                time: newProfile.created_at,
              })
              setCurrentUser(newProfile.id)
              setIsOnboarded(isOnboardedValue)
              break
            }
          }
          
          if (!profileCreated) {
            console.log('[Auth] Profile not created by trigger after 10s, creating minimal profile in DB')
            // Fallback: create minimal profile in DATABASE so subsequent queries find it
            // Try to get email/name from auth user metadata
            let userEmail = ''
            let userName = ''
            let userTimezone = Intl.DateTimeFormat().resolvedOptions().timeZone
            try {
              const { data: authUser } = await supabase.auth.getUser()
              if (authUser?.user) {
                userEmail = authUser.user.email || ''
                userName = authUser.user.user_metadata?.name || authUser.user.email?.split('@')[0] || ''
                userTimezone = authUser.user.user_metadata?.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone
              }
            } catch {}
            const now = new Date().toISOString()
            const minimalProfile = {
              id: userId,
              email: userEmail,
              name: userName,
              currency: 'IDR',
              timezone: userTimezone,
              theme: 'dark',
              default_account_id: null,
              created_at: now,
            }
            // Insert into database
            const { error: insertError } = await supabase
              .from('profiles')
              .insert(minimalProfile)
            if (insertError && insertError.code !== '23505') {
              console.error('[Auth] Failed to create minimal profile in DB:', insertError)
            }
            // Also ensure user_settings exists to determine onboarded status
            let isOnboardedValue = false
            try {
              const { data: settings } = await supabase
                .from('user_settings')
                .select('is_onboarded')
                .eq('user_id', userId)
                .single()
              isOnboardedValue = settings?.is_onboarded ?? false
            } catch {
              // Create user_settings if missing
              await supabase.from('user_settings').insert({
                user_id: userId,
                is_onboarded: false,
              })
            }
            setUser({
              ...minimalProfile,
              email: minimalProfile.email,
              name: minimalProfile.name,
              currency: minimalProfile.currency,
              timezone: minimalProfile.timezone,
              theme: minimalProfile.theme as 'dark' | 'light' | 'system',
              defaultAccountId: minimalProfile.default_account_id,
              createdAt: minimalProfile.created_at,
              passwordHash: '',
              time: minimalProfile.created_at,
            })
            setCurrentUser(userId)
            setIsOnboarded(isOnboardedValue)
          }
        }
        resolvePromise!()
      } catch (error) {
        console.error('[Auth] Error fetching user profile:', error)
        // On error, still set a minimal user to avoid infinite loading
        setUser({
          id: userId,
          email: '',
          name: '',
          currency: 'IDR',
          timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
          theme: 'dark',
          defaultAccountId: null,
          createdAt: new Date().toISOString(),
          passwordHash: '',
          time: new Date().toISOString(),
        })
        setCurrentUser(userId)
        setIsOnboarded(false)
        rejectPromise!(error as Error)
      } finally {
              clearTimeout(safetyTimeout)
              fetchPromisesRef.current.delete(userId)
              fetchingUserRef.current = null
              loadedUserRef.current.add(userId)
              console.log('[Auth] fetchUserProfile done, setting isLoading=false')
              setIsLoading(false)
            }
    }, [])

  useEffect(() => {
    let mounted = true
    
    // Check for existing session with timeout
    const checkSession = async () => {
      console.log('[Auth] Checking existing session')
      try {
        const { data: { session }, error } = await Promise.race([
          supabase.auth.getSession(),
          timeoutPromise<never>(10000, 'Session check timeout')
        ])
        
        if (!mounted) return
        
        if (error) {
          console.error('[Auth] Session check error:', error)
          setIsLoading(false)
          return
        }
        
        if (session?.user) {
                  console.log('[Auth] Session found, fetching profile')
                  // Only fetch if not already loaded and not currently fetching
                  if (fetchingUserRef.current !== session.user.id && !loadedUserRef.current.has(session.user.id)) {
                    await fetchUserProfile(session.user.id)
                  }
                  // Always sync data from Supabase to local Dexie (source of truth)
                  await syncUserDataFromSupabase(session.user.id)
          // NOTE: Don't push on initial session check - sync from Supabase is source of truth
        } else {
          console.log('[Auth] No session found')
          setIsLoading(false)
        }
      } catch (error) {
        console.error('[Auth] Session check failed:', error)
        if (mounted) setIsLoading(false)
      }
    }

    checkSession()

    // Listen for auth changes
    console.log('[Auth] Setting up auth state listener')
    const { data: { subscription } } = supabase.auth.onAuthStateChange(async (event, session) => {
      if (!mounted) return
      
      console.log('[Auth] Auth state change:', event, session?.user?.id)
      if (event === 'SIGNED_IN' && session?.user) {
        // Don't fetch if we already have this user loaded (use ref to avoid stale closure)
        if (loadedUserRef.current.has(session.user.id) || user?.id === session.user.id) {
          console.log('[Auth] User already loaded, skipping fetch')
          // But still sync data from Supabase to local Dexie
          await syncUserDataFromSupabase(session.user.id)
          return
        }
        // Don't fetch if we're already loading or already fetched this user
        if (!fetchPromisesRef.current.has(session.user.id)) {
          await fetchUserProfile(session.user.id)
          // Sync data from Supabase to local Dexie (skip if signUp is in progress)
          if (!signUpInProgressRef.current.has(session.user.id)) {
            await syncUserDataFromSupabase(session.user.id)
            // NOTE: Don't push on sign-in - sync from Supabase is source of truth
          }
        }
      } else if (event === 'SIGNED_OUT') {
        console.log('[Auth] User signed out')
        setUser(null)
        setIsOnboarded(false)
        setIsLoading(false)
        fetchPromisesRef.current.clear()
        loadedUserRef.current.clear()
        clearCurrentUser()
      } else if (event === 'TOKEN_REFRESHED' && session?.user) {
        // Token refreshed, ensure profile is loaded
        if (!loadedUserRef.current.has(session.user.id) && user?.id !== session.user.id) {
          await fetchUserProfile(session.user.id)
        }
        // Always sync data from Supabase to local Dexie on token refresh
        await syncUserDataFromSupabase(session.user.id)
        // NOTE: Don't push on token refresh - sync from Supabase is source of truth
      }
    })

    // Mark initial load as done after a short delay
    const initialLoadTimer = setTimeout(() => {
      initialLoadDone.current = true
    }, 1000)

    return () => {
      mounted = false
      clearTimeout(initialLoadTimer)
      subscription.unsubscribe()
    }
  }, [fetchUserProfile])

  const login = useCallback(async (email: string, password: string) => {
    console.log('[Auth] Login attempt for:', email)
    
    try {
      const { data, error } = await Promise.race([
        supabase.auth.signInWithPassword({ email, password }),
        timeoutPromise<never>(20000, 'Login timeout - check network')
      ])
      
      if (error) {
        console.error('[Auth] Login error:', error.message)
        throw error
      }
      
      console.log('[Auth] Login successful, fetching profile...')
      // Don't rely solely on auth state change - fetch profile directly
      if (data.session?.user) {
        await fetchUserProfile(data.session.user.id)
        // Sync data from Supabase to local Dexie
        await syncUserDataFromSupabase(data.session.user.id)
        // NOTE: Don't push on login - sync from Supabase is source of truth
      }
    } catch (err) {
      if (err instanceof Error && err.message.includes('timeout')) {
        console.error('[Auth] Login timeout')
        throw err
      }
      console.error('[Auth] Login failed:', err)
      throw err
    }
  }, [fetchUserProfile])

  const signUp = useCallback(async (email: string, password: string, name: string, currency: string, timezone: string) => {
      console.log('[Auth] Sign up attempt for:', email)

      let signUpUserId: string | undefined
      // Pre-generate a temporary ID to track signUp progress before Supabase returns
      const tempSignUpId = generateUUID()
      signUpInProgressRef.current.add(tempSignUpId)
      
      try {
        const { data, error } = await Promise.race([
          supabase.auth.signUp({ 
            email, 
            password,
            options: {
              data: {
                name,
                currency: currency || 'IDR',
                timezone: timezone || Intl.DateTimeFormat().resolvedOptions().timeZone,
              }
            }
          }),
          timeoutPromise<never>(20000, 'Sign up timeout')
        ])

        if (error) {
          // If user already exists, suggest login
          if (error.message.includes('already registered') || error.message.includes('User already registered') || error.code === 'email_exists') {
            console.log('[Auth] User already exists, attempting login instead...')
            // Try to login instead
            const { data: loginData, error: loginError } = await Promise.race([
              supabase.auth.signInWithPassword({ email, password }),
              timeoutPromise<never>(20000, 'Login timeout')
            ])
            if (loginError) throw loginError
            if (loginData.session?.user) {
              await fetchUserProfile(loginData.session.user.id)
              // User provided onboarding info - mark as onboarded
              await supabase.from('user_settings').upsert({
                user_id: loginData.session.user.id,
                is_onboarded: true,
              }).then(() => {})
              // Push any local changes to Supabase (non-blocking)
              const pushResult = await pushLocalChangesToSupabase(loginData.session.user.id)
              if (!pushResult.success) {
                console.warn('[Auth] Push local changes failed after login:', pushResult.errors)
              }
            }
            return
          }
          throw error
        }

        if (data.user) {
          // Replace temp ID with real user ID
          signUpInProgressRef.current.delete(tempSignUpId)
          signUpUserId = data.user.id
          signUpInProgressRef.current.add(signUpUserId)
          console.log('[Auth] Sign up successful, creating profile immediately...')
          try {
            // Create profile immediately (DB trigger is unreliable with RLS)
            const { error: profileError } = await Promise.race([
              supabase.from('profiles').insert({
                id: data.user.id,
                email,
                name,
                currency: currency || 'IDR',
                timezone: timezone || data.user.user_metadata?.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone,
                theme: 'dark',
                default_account_id: null,
                created_at: new Date().toISOString(),
              }),
              timeoutPromise<never>(10000, 'Profile creation timeout')
            ])
            if (profileError && profileError.code !== '23505') throw profileError // Ignore duplicate key

            // Create user settings - mark as onboarded since user provided all info during sign up
            const { error: settingsError } = await Promise.race([
              supabase.from('user_settings').insert({
                user_id: data.user.id,
                is_onboarded: true,
              }),
              timeoutPromise<never>(10000, 'Settings creation timeout')
            ])
            if (settingsError && settingsError.code !== '23505') throw settingsError

            // Create default categories - generate UUIDs for DB
            const toSnakeCase = (obj: Record<string, unknown>): Record<string, unknown> => {
              const result: Record<string, unknown> = {}
              for (const [key, value] of Object.entries(obj)) {
                const snakeKey = key.replace(/[A-Z]/g, letter => `_${letter.toLowerCase()}`)
                result[snakeKey] = value
              }
              return result
            }

            const defaultCategories = getDefaultCategories(data.user.id)
            const snakeCategories = defaultCategories.map(c => {
              const snake = toSnakeCase(c as Record<string, unknown>)
              snake.id = generateUUID()
              return snake
            })

            const { error: catError } = await Promise.race([
              supabase.from('categories').insert(snakeCategories),
              timeoutPromise<never>(15000, 'Categories creation timeout')
            ])
            if (catError && catError.code !== '23505') throw catError

            // Create default accounts (Cash and Bank)
            const defaultAccounts = [
              {
                id: generateUUID(),
                user_id: data.user.id,
                name: 'Cash',
                type: 'cash',
                balance: 0,
                currency: currency || 'IDR',
                icon: 'Wallet',
                color: '#10B981',
                created_at: new Date().toISOString(),
              },
              {
                id: generateUUID(),
                user_id: data.user.id,
                name: 'Bank Account',
                type: 'bank',
                balance: 0,
                currency: currency || 'IDR',
                icon: 'Building2',
                color: '#3B82F6',
                created_at: new Date().toISOString(),
              },
            ]
            const { error: accError } = await Promise.race([
              supabase.from('accounts').insert(defaultAccounts),
              timeoutPromise<never>(10000, 'Accounts creation timeout')
            ])
            if (accError && accError.code !== '23505') throw accError

            console.log('[Auth] Sign up complete, profile created')
            // Fetch the profile
            await fetchUserProfile(data.user.id)
            // Sync newly created data to local Dexie
            await syncUserDataFromSupabase(data.user.id)
            // Push any local changes to Supabase (non-blocking — don't fail signup)
            const pushResult = await pushLocalChangesToSupabase(data.user.id)
            if (!pushResult.success) {
              console.warn('[Auth] Push local changes failed (signup succeeded):', pushResult.errors)
            }
          } finally {
            // Clean up signUp in progress flag
            if (signUpUserId) {
              signUpInProgressRef.current.delete(signUpUserId)
            }
          }
        }
      } catch (err) {
        console.error('[Auth] Sign up failed:', err)
        // Clean up signUp in progress flag on error too
        if (signUpUserId) {
          signUpInProgressRef.current.delete(signUpUserId)
        }
        throw err
      }
    }, [fetchUserProfile])

  const logout = useCallback(async () => {
    console.log('[Auth] Logging out')
    fetchPromisesRef.current.clear()
    const { error } = await Promise.race([
      supabase.auth.signOut(),
      timeoutPromise<never>(10000, 'Logout timeout')
    ])
    if (error) throw error
    clearCurrentUser()
  }, [])

  const updateProfile = useCallback(async (data: Partial<User>) => {
    if (!user) return
    try {
      const { error } = await Promise.race([
        supabase.from('profiles').update({
          ...data,
          updated_at: new Date().toISOString(),
        }).eq('id', user.id),
        timeoutPromise<never>(10000, 'Profile update timeout')
      ])
      if (error) throw error

      setUser(prev => prev ? { ...prev, ...data, updatedAt: new Date().toISOString() } : null)
    } catch (err) {
      console.error('[Auth] Update profile failed:', err)
      throw err
    }
  }, [user])

  // Default categories matching Dexie
  const getDefaultCategories = (userId: string) => {
    const DEFAULT_CATEGORIES = [
      { id: 'cat-salary', userId: '', name: 'Salary', type: 'income' as const, icon: 'Briefcase', color: '#10B981', parentId: null, sortOrder: 1, merchantPatterns: ['salary', 'payroll', 'gaji', 'penggajian'] },
      { id: 'cat-freelance', userId: '', name: 'Freelance', type: 'income' as const, icon: 'Laptop', color: '#06B6D4', parentId: null, sortOrder: 2, merchantPatterns: ['freelance', 'upwork', 'fiverr', 'freelancer'] },
      { id: 'cat-food', userId: '', name: 'Food & Drinks', type: 'expense' as const, icon: 'Utensils', color: '#F59E0B', parentId: null, sortOrder: 1, merchantPatterns: ['restaurant', 'cafe', 'food', 'coffee', 'makan', 'kuliner'] },
      { id: 'cat-transport', userId: '', name: 'Transport', type: 'expense' as const, icon: 'Car', color: '#6366F1', parentId: null, sortOrder: 2, merchantPatterns: ['taxi', 'uber', 'grab', 'transport', 'gas', 'bensin', 'parkir'] },
      { id: 'cat-shopping', userId: '', name: 'Shopping', type: 'expense' as const, icon: 'ShoppingBag', color: '#EC4999', parentId: null, sortOrder: 3, merchantPatterns: ['shop', 'mall', 'store', 'belanja'] },
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