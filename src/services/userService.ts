import { getSupabaseClient, isLocalDbConfigured } from '../lib/supabase'
import { localApi } from '../lib/localApi'
import { cachedRead } from '../lib/offline/wrap'

// User accounts. With Supabase, accounts are created and passwords set by the
// `users` Edge Function (it holds the secret key); roles and activation are
// profile updates protected by the database rules.
export type ManagedUser = { id: string; full_name: string; email: string | null; username: string | null; active: boolean; role_id: string; role?: { code: string; name: string } | null }
export type Role = { id: string; code: string; name: string; description: string | null }
export type NewUser = { full_name: string; username: string; email: string; role_id: string; password: string }

/** Addresses given to accounts created without an e-mail (see the Edge Function). */
export const isPlaceholderEmail = (email: string | null) => Boolean(email?.endsWith('.maket-peyizan.invalid'))

/** Calls the `users` Edge Function; its error message is returned as an Error. */
export async function callUsersFunction<T>(body: Record<string, unknown>): Promise<T> {
  const { data, error } = await getSupabaseClient().functions.invoke('users', { body })
  if (error) {
    const context = (error as { context?: Response }).context
    const detail = context && typeof context.json === 'function' ? await context.json().catch(() => null) : null
    throw new Error(detail?.error ?? (/Failed to send|fetch/i.test(error.message) ? 'Fonction « users » injoignable : déployez-la (npx supabase functions deploy users).' : error.message))
  }
  return data as T
}

export type Permission = { code: string; module: string; label: string; sort: number }
export type PermissionMatrix = { permissions: Permission[]; roles: Role[]; granted: Record<string, string[]> }

export type Activity = { id: string; created_at: string; action: string; entity_type: string | null; success: boolean }

export const userService = {
  /** What a user did, from the audit log (latest first). */
  activity: async (userId: string): Promise<Activity[]> => {
    if (isLocalDbConfigured) return localApi.query<Activity>('select id, created_at, action, entity_type, success from audit_log where user_id = ? order by created_at desc limit 200', [userId])
    const { data, error } = await getSupabaseClient().from('audit_log').select('id, created_at, action, entity_type, success').or(`user_id.eq.${userId},profile_id.eq.${userId}`).order('created_at', { ascending: false }).limit(200)
    if (error) throw error
    return (data ?? []) as Activity[]
  },

  list: () => cachedRead('users', async () => {
    if (isLocalDbConfigured) return localApi.getManagedUsers() as Promise<{ users: ManagedUser[]; roles: Role[] }>
    const client = getSupabaseClient()
    const [users, roles] = await Promise.all([
      client.from('profiles').select('id, full_name, email, username, active, role_id, role:roles(code, name)').order('full_name'),
      client.from('roles').select('*').order('name'),
    ])
    if (users.error) throw users.error
    if (roles.error) throw roles.error
    return { users: (users.data ?? []) as unknown as ManagedUser[], roles: (roles.data ?? []) as Role[] }
  }, { style: 'throw' }),

  /** Permissions, roles and what each role is granted (online database only). */
  permissionMatrix: async (): Promise<PermissionMatrix> => {
    const client = getSupabaseClient()
    const [permissions, roles, links] = await Promise.all([
      client.from('permissions').select('code, module, label, sort').order('sort'),
      client.from('roles').select('*').order('name'),
      client.from('role_permissions').select('role_id, permission_code'),
    ])
    for (const result of [permissions, roles, links]) if (result.error) throw result.error
    const granted: Record<string, string[]> = {}
    for (const link of (links.data ?? []) as { role_id: string; permission_code: string }[]) (granted[link.role_id] ??= []).push(link.permission_code)
    return { permissions: (permissions.data ?? []) as Permission[], roles: (roles.data ?? []) as Role[], granted }
  },

  setRolePermissions: async (roleId: string, codes: string[]) => {
    const { error } = await getSupabaseClient().rpc('set_role_permissions', { p_role_id: roleId, p_permissions: codes })
    if (error) throw error
  },

  create: (input: NewUser) => isLocalDbConfigured
    ? localApi.createManagedUser(input)
    : callUsersFunction<{ user: { id: string } }>({ action: 'create', ...input }),

  setPassword: (userId: string, password: string) => isLocalDbConfigured
    ? localApi.setManagedUserPassword(userId, password)
    : callUsersFunction({ action: 'set_password', user_id: userId, password }),

  /** Name, user name and e-mail. */
  update: (userId: string, input: { full_name?: string; username?: string | null; email?: string }) => isLocalDbConfigured
    ? localApi.updateManagedUser(userId, input)
    : callUsersFunction({ action: 'update', user_id: userId, ...input }),

  /** Role and activation (database rules: managers only, never their own account). */
  setAccess: async (userId: string, input: { active?: boolean; role_id?: string }) => {
    if (isLocalDbConfigured) return localApi.updateManagedUser(userId, input)
    const { error } = await getSupabaseClient().from('profiles').update(input).eq('id', userId)
    if (error) throw error
  },
}
