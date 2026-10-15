/**
 * Regression test for the reported signup failure.
 *
 * Reported symptom (user, 2026-10-15): signup threw "Sign up failed" even though the
 * auth user existed. The push to `accounts` answered 400 and the old push path re-threw
 * the PostgREST error into `signUp()`.
 *
 * The 400 itself was NOT the unknown-field problem it was first assumed to be — the live
 * `accounts` table has a `BEFORE UPDATE` trigger (`update_updated_at_column()`) that writes
 * `NEW.updated_at`, but `accounts` has no `updated_at` column. So the upsert's
 * `ON CONFLICT DO UPDATE` branch raises SQLSTATE 42703, PostgREST returns 400. Same for
 * `categories`, `budgets` and `savings_goals`.
 *
 * This test runs the REAL sync.ts against a Supabase mock that returns that exact 400
 * shape, and asserts the signup flow now survives it. It fails if pushLocalChangesToSupabase
 * throws (the pre-fix behaviour) or if signUp rethrows the push failure.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import React from 'react'
import { renderHook, act, cleanup } from '@testing-library/react'
import { SupabaseAuthProvider, useSupabaseAuth } from './SupabaseAuthContext'

const h = vi.hoisted(() => {
  const USER = '48fba103-3626-4887-b214-d96617538eb8'
  const NOW = '2026-10-15T09:40:00.000Z'
  const profileRow = {
    id: USER,
    email: 'new@example.com',
    name: 'New User',
    currency: 'IDR',
    timezone: 'Asia/Jakarta',
    theme: 'dark',
    default_account_id: null,
    created_at: NOW,
  }
  const serverAccounts = [
    { id: '00000000-0000-4000-8000-000000000001', user_id: USER, name: 'Cash', type: 'cash', currency: 'IDR', icon: 'Wallet', color: '#10B981', created_at: NOW },
    { id: '00000000-0000-4000-8000-000000000002', user_id: USER, name: 'Bank Account', type: 'bank', currency: 'IDR', icon: 'Building2', color: '#3B82F6', created_at: NOW },
  ]

  const upserts: Array<{ table: string; payload: Record<string, unknown> }> = []
  const inserts: Array<{ table: string; payload: unknown }> = []
  const localAccounts: Array<Record<string, unknown>> = []
  const upsertError: { value: unknown } = { value: null }
  const signUpError: { value: unknown } = { value: null }

  const thenable = (result: unknown) => {
    const q: any = {
      select: () => q,
      eq: () => q,
      order: () => q,
      limit: () => q,
      single: async () => result,
      maybeSingle: async () => result,
      then: (onFulfilled: any, onRejected: any) => Promise.resolve(result).then(onFulfilled, onRejected),
    }
    return q
  }

  const from = (table: string) => ({
    select: () => {
      switch (table) {
        case 'profiles': return thenable({ data: profileRow, error: null })
        case 'user_settings': return thenable({ data: { is_onboarded: true }, error: null })
        case 'accounts': return thenable({ data: serverAccounts, error: null })
        default: return thenable({ data: [], error: null })
      }
    },
    insert: async (payload: unknown) => {
      inserts.push({ table, payload })
      return { error: null }
    },
    upsert: async (payload: Record<string, unknown>) => {
      upserts.push({ table, payload })
      return { error: table === 'accounts' ? upsertError.value : null }
    },
    update: () => thenable({ data: null, error: null }),
    delete: () => thenable({ data: null, error: null }),
  })

  const auth = {
    getSession: async () => ({ data: { session: null }, error: null }),
    getUser: async () => ({ data: { user: { id: USER, email: profileRow.email, user_metadata: { name: 'New User' } } }, error: null }),
    onAuthStateChange: () => ({ data: { subscription: { unsubscribe: () => {} } } }),
    signUp: async () => (signUpError.value
      ? { data: { user: null, session: null }, error: signUpError.value }
      : { data: { user: { id: USER, email: profileRow.email, user_metadata: {} }, session: { user: { id: USER } } }, error: null }),
    signInWithPassword: async () => ({ data: { session: { user: { id: USER } } }, error: null }),
    signOut: async () => ({ error: null }),
  }

  const dexieTable = (name: string) => ({
    bulkPut: async () => {},
    where: () => ({
      equals: () => ({ toArray: async () => (name === 'accounts' ? localAccounts : []) }),
    }),
  })

  const db = {
    users: { put: async () => {} },
    accounts: dexieTable('accounts'),
    categories: dexieTable('categories'),
    transactions: dexieTable('transactions'),
    budgets: dexieTable('budgets'),
    goals: dexieTable('goals'),
    cashiers: dexieTable('cashiers'),
  }

  return { USER, NOW, profileRow, serverAccounts, upserts, inserts, localAccounts, upsertError, signUpError, db, auth, supabase: { from, auth } }
})

vi.mock('../lib/supabase', () => ({ supabase: h.supabase }))
vi.mock('../db/index', () => ({ db: h.db }))
vi.mock('../db/hooks', () => ({
  setCurrentUser: () => {},
  clearCurrentUser: () => {},
  getCurrentUser: () => null,
}))

const wrapper = ({ children }: { children: React.ReactNode }) => (
  <SupabaseAuthProvider>{children}</SupabaseAuthProvider>
)

let warnSpy: ReturnType<typeof vi.spyOn>
let logSpy: ReturnType<typeof vi.spyOn>
let errorSpy: ReturnType<typeof vi.spyOn>

beforeEach(() => {
  h.upserts.length = 0
  h.inserts.length = 0
  h.upsertError.value = null
  h.signUpError.value = null
  h.localAccounts.length = 0
  // These are what sync.ts writes back into Dexie after pulling the 2 accounts created by signup.
  h.localAccounts.push(
    { id: '00000000-0000-4000-8000-000000000001', userId: h.USER, name: 'Cash', type: 'cash', currency: 'IDR', icon: 'Wallet', color: '#10B981', createdAt: h.NOW },
    { id: '00000000-0000-4000-8000-000000000002', userId: h.USER, name: 'Bank Account', type: 'bank', currency: 'IDR', icon: 'Building2', color: '#3B82F6', createdAt: h.NOW },
  )
  logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
  errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
  warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
})

afterEach(() => {
  cleanup()
  logSpy.mockRestore()
  errorSpy.mockRestore()
  warnSpy.mockRestore()
})

describe('signUp with a failing background push', () => {
  it('resolves and only warns when the accounts upsert answers 400 / 42703', async () => {
    h.upsertError.value = {
      message: 'column "updated_at" of relation "accounts" does not exist',
      code: '42703',
      details: null,
      hint: null,
    }

    const { result } = renderHook(() => useSupabaseAuth(), { wrapper })

    await act(async () => {
      await result.current.signUp('new@example.com', 'password123', 'New User', 'IDR', 'Asia/Jakarta')
    })

    // the auth user and its profile really were created
    expect(h.inserts.some(i => i.table === 'profiles')).toBe(true)
    expect(h.inserts.some(i => i.table === 'user_settings')).toBe(true)
    expect(h.inserts.some(i => i.table === 'accounts')).toBe(true)
    // the push really was attempted against accounts
    expect(h.upserts.map(u => u.table)).toEqual(['accounts', 'accounts'])
    // the failure surfaced as a warning, not a throw
    const warned = warnSpy.mock.calls.some((call: unknown[]) => String(call[0]).includes('Push local changes failed (signup succeeded)'))
    expect(warned).toBe(true)
  })

  it('creates no warning at all when the push succeeds', async () => {
    const { result } = renderHook(() => useSupabaseAuth(), { wrapper })

    await act(async () => {
      await result.current.signUp('new@example.com', 'password123', 'New User', 'IDR', 'Asia/Jakarta')
    })

    expect(warnSpy).not.toHaveBeenCalled()
    expect(h.upserts).toHaveLength(2)
  })

  it('still rejects when the auth provider itself fails (push decoupling must not swallow auth errors)', async () => {
    h.signUpError.value = { message: 'Email rate limit exceeded', code: 'over_email_send_rate_limit' }
    const { result } = renderHook(() => useSupabaseAuth(), { wrapper })

    await act(async () => {
      await expect(
        result.current.signUp('new@example.com', 'password123', 'New User', 'IDR', 'Asia/Jakarta'),
      ).rejects.toThrow(/rate limit/)
    })

    expect(h.upserts).toHaveLength(0)
  })
})
