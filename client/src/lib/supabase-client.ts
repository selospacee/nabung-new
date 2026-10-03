import { supabase } from '../lib/supabase'

// Example: Fetch data from a table
export async function fetchData() {
  const { data, error } = await supabase
    .from('your_table')
    .select('*')
  
  if (error) throw error
  return data
}

// Example: Insert data
export async function insertData(record: Record<string, unknown>) {
  const { data, error } = await supabase
    .from('your_table')
    .insert(record)
    .select()
  
  if (error) throw error
  return data
}

// Example: Auth - Sign up
export async function signUp(email: string, password: string) {
  const { data, error } = await supabase.auth.signUp({
    email,
    password
  })
  
  if (error) throw error
  return data
}

// Example: Auth - Sign in
export async function signIn(email: string, password: string) {
  const { data, error } = await supabase.auth.signInWithPassword({
    email,
    password
  })
  
  if (error) throw error
  return data
}

// Example: Auth - Get current user
export async function getUser() {
  const { data: { user }, error } = await supabase.auth.getUser()
  
  if (error) throw error
  return user
}

// Example: Auth - Sign out
export async function signOut() {
  const { error } = await supabase.auth.signOut()
  if (error) throw error
}