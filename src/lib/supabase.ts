import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '../types/database'

const USE_LOCAL_DB = import.meta.env.VITE_USE_LOCAL_DB === 'true';
const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY || import.meta.env.VITE_SUPABASE_ANON_KEY

export const isSupabaseConfigured = !USE_LOCAL_DB && Boolean(supabaseUrl && supabaseAnonKey)
export const isLocalDbConfigured = USE_LOCAL_DB

/** Client PostgreSQL/Auth public. Ne jamais utiliser service_role dans ce code. */
export const supabase: SupabaseClient<Database> | null = isSupabaseConfigured
  ? createClient<Database>(supabaseUrl, supabaseAnonKey, { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true } })
  : null

export function getSupabaseClient(): SupabaseClient<Database> {
  if (!supabase) throw new Error('Supabase n’est pas configuré. Renseignez VITE_SUPABASE_URL et VITE_SUPABASE_ANON_KEY dans .env.local.')
  return supabase
}
