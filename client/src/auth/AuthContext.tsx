import React, { createContext, useContext, useState, useEffect, useCallback } from 'react'
import { db } from '../db'
import { getDefaultCategories } from '../db'
import type { User } from '../types'

interface AuthContextType {
  user: User | null
  isLoading: boolean
  isOnboarded: boolean
  login: (email: string, password: string) => Promise<void>
  signUp: (email: string, password: string, name: string, currency: string, timezone: string) => Promise<void>
  logout: () => void
  updateProfile: (data: Partial<User>) => Promise<void>
}

const AuthContext = createContext<AuthContextType | null>(null)

// Simple UUID fallback since uuid package might not be installed
function generateId(): string {
  try {
    return crypto.randomUUID()
  } catch {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
      const r = Math.random() * 16 | 0
      return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16)
    })
  }
}

// Helper to hash password using SHA-256
async function hashPassword(password: string): Promise<string> {
  const encoder = new TextEncoder()
  const data = encoder.encode(password)
  const hashBuffer = await crypto.subtle.digest('SHA-256', data)
  const hashArray = Array.from(new Uint8Array(hashBuffer))
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('')
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [isOnboarded, setIsOnboarded] = useState(false)

  useEffect(() => {
    // Check for existing user
    const existingId = localStorage.getItem('nabung_currentUser')
    if (existingId) {
      const existing = db.users.get(existingId)
      existing.then(u => {
        if (u) {
          setUser(u)
          setIsOnboarded(true)
        }
        setIsLoading(false)
      }).catch(() => setIsLoading(false))
    } else {
      // Check if any user exists in DB
      db.users.toArray().then(users => {
        if (users.length > 0) {
          const first = users[0]
          setUser(first)
          setCurrentUserId(first.id)
          setIsOnboarded(true)
        }
        setIsLoading(false)
      }).catch(() => setIsLoading(false))
    }
  }, [])

  const setCurrentUserId = (id: string) => {
    localStorage.setItem('nabung_currentUser', id)
  }

  const login = useCallback(async (email: string, password: string) => {
    // Find user by email
    const users = await db.users.where('email').equals(email).toArray()
    if (users.length === 0) {
      throw new Error('Invalid email or password')
    }
    const existingUser = users[0]
    // Hash the provided password and compare
    const hashedPassword = await hashPassword(password)
    if (existingUser.passwordHash !== hashedPassword) {
      throw new Error('Invalid email or password')
    }
    // Set user and store ID in localStorage
    setUser(existingUser)
    localStorage.setItem('nabung_currentUser', existingUser.id)
  }, [])

  const signUp = useCallback(async (email: string, password: string, name: string, currency: string, timezone: string) => {
    // Check if user already exists
    const existing = await db.users.where('email').equals(email).toArray()
    if (existing.length > 0) {
      throw new Error('User with this email already exists')
    }
    const id = generateId()
    const now = new Date().toISOString()
    const hashedPassword = await hashPassword(password)

    const newUser: User = {
          id,
          email,
          name,
          currency: currency || 'IDR',
          timezone: timezone || Intl.DateTimeFormat().resolvedOptions().timeZone,
          theme: 'dark',
          defaultAccountId: null,
          createdAt: now,
          passwordHash: hashedPassword,
          time: now
        }

    await db.users.add(newUser)
    // Create default categories
    const categories = getDefaultCategories(id)
    await db.categories.bulkAdd(categories)

    setUser(newUser)
    localStorage.setItem('nabung_currentUser', id)
  }, [])

  const logout = useCallback(() => {
    setUser(null)
    setIsOnboarded(false)
    localStorage.removeItem('nabung_currentUser')
  }, [])

  const updateProfile = useCallback(async (data: Partial<User>) => {
    if (!user) return
    const updated = { ...user, ...data, updatedAt: new Date().toISOString() }
    await db.users.update(user.id, updated)
    setUser(updated)
  }, [user])

  return (
    <AuthContext.Provider value={{
      user: user,
      isLoading: isLoading,
      isOnboarded: isOnboarded,
      login: login,
      signUp: signUp,
      logout: logout,
      updateProfile: updateProfile
    }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth(): AuthContextType {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used within AuthProvider')
  return ctx
}
