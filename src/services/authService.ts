import type { AuthError, Session } from '@supabase/supabase-js'
import { getSupabaseClient } from '../lib/supabase'
import { localApi } from '../lib/localApi'
import type { Profile, RoleCode } from '../types/auth'

const USE_LOCAL_DB = import.meta.env.VITE_USE_LOCAL_DB === 'true';

export async function signInWithPassword(email: string, password: string): Promise<{ session: Session | null; error: AuthError | null }> {
  if (USE_LOCAL_DB) {
    try {
      const response = await localApi.login(email, password);
      const session = {
        user: {
          id: response.user.id,
          email: response.user.email,
        },
        access_token: response.token,
      } as Session;
      return { session, error: null };
    } catch (error) {
      return { session: null, error: error as AuthError };
    }
  }
  const { data, error } = await getSupabaseClient().auth.signInWithPassword({ email, password })
  return { session: data.session, error }
}

export async function signOut() {
  if (USE_LOCAL_DB) {
    localApi.clearToken();
    return;
  }
  return getSupabaseClient().auth.signOut()
}

export async function isInitialSetupComplete(): Promise<boolean> {
  if (USE_LOCAL_DB) return true
  const { data, error } = await getSupabaseClient().rpc('is_initial_setup_complete')
  if (error) throw error
  return Boolean(data)
}

export async function signUpFirstOwner(email: string, password: string, fullName: string) {
  if (USE_LOCAL_DB) throw new Error('La création du premier administrateur est disponible avec Supabase.')
  const { data, error } = await getSupabaseClient().auth.signUp({ email, password, options: { data: { full_name: fullName.trim() } } })
  if (error) throw error
  // If email confirmation is disabled, bootstrap immediately. If it is enabled,
  // AuthProvider runs the same safe bootstrap after the confirmed user signs in.
  if (data.session?.user) {
    const { error: bootstrapError } = await getSupabaseClient().rpc('create_first_admin_user', { user_uuid: data.session.user.id })
    if (bootstrapError) throw bootstrapError
  }
  return data
}

export async function getCurrentProfile(userId: string): Promise<Profile | null> {
  if (USE_LOCAL_DB) {
    try {
      const profile = await localApi.getProfile();
      return {
        id: profile.id,
        full_name: profile.full_name,
        email: profile.email,
        active: profile.active,
        role_id: profile.role_id,
        role: {
          code: profile.role_code as any,
          name: profile.role_name,
        },
      };
    } catch (error) {
      return null;
    }
  }
  const { data, error } = await getSupabaseClient()
    .from('profiles')
    .select('id, full_name, email, active, role_id, role:roles(code, name)')
    .eq('id', userId)
    .maybeSingle()
  if (error) throw error
  if (!data) return null
  const row = data as { id: string; full_name: string; email: string; active: boolean; role_id: string; role: { code: RoleCode; name: string } | null }
  return { id: row.id, full_name: row.full_name, email: row.email, active: row.active, role_id: row.role_id, role: row.role }
}
