// Edge Function `users`: account creation, password reset, user names, and
// sign-in by user name. Deploy: npx supabase functions deploy users
// SUPABASE_URL, SUPABASE_ANON_KEY and SUPABASE_SERVICE_ROLE_KEY are provided by Supabase.
import { createClient } from 'npm:@supabase/supabase-js@2.116.0'
import { handle, HttpError, type Backend } from './handler.ts'

const url = Deno.env.get('SUPABASE_URL')!
const admin = createClient(url, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false, autoRefreshToken: false } })
const publicKey = Deno.env.get('SUPABASE_ANON_KEY') ?? Deno.env.get('SUPABASE_PUBLISHABLE_KEY')!

const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type', 'Access-Control-Allow-Methods': 'POST, OPTIONS' }
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } })
const must = <T>(result: { data: T; error: { message: string } | null }) => { if (result.error) throw new Error(result.error.message); return result.data }

const backend: Backend = {
  async userFromToken(token) { const { data } = await admin.auth.getUser(token); return data.user?.id ?? null },
  async profile(userId) {
    const row = must(await admin.from('profiles').select('active, email, role:roles(code)').eq('id', userId).maybeSingle()) as { active: boolean; email: string | null; role: { code: string } | null } | null
    return row ? { active: row.active, email: row.email, role_code: row.role?.code ?? null } : null
  },
  async allowed(userId, permission) {
    const { data, error } = await admin.rpc('user_has_permission', { p_user_id: userId, p_permission: permission })
    if (!error) return Boolean(data)
    // Before step F3 is applied: directors and administrators.
    const profile = await backend.profile(userId)
    return profile?.role_code === 'director' || profile?.role_code === 'administrator'
  },
  async roleExists(roleId) { return Boolean(must(await admin.from('roles').select('id').eq('id', roleId).maybeSingle())) },
  async usernameOwner(username) { return (must(await admin.from('profiles').select('id').ilike('username', username).maybeSingle()) as { id: string } | null)?.id ?? null },
  async emailForUsername(username) {
    const row = must(await admin.from('profiles').select('email, active').ilike('username', username).maybeSingle()) as { email: string | null; active: boolean } | null
    return row?.active ? row.email : null
  },
  async createAuthUser({ email, password, fullName }) {
    const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true, user_metadata: { full_name: fullName } })
    if (error) throw new HttpError(error.status === 422 ? 409 : 400, /already/i.test(error.message) ? 'Cette adresse e-mail est déjà utilisée' : error.message)
    return data.user.id
  },
  async updateAuthUser(userId, input) {
    const { error } = await admin.auth.admin.updateUserById(userId, { ...input, ...(input.email ? { email_confirm: true } : {}) })
    if (error) throw new HttpError(400, error.message)
  },
  async updateProfile(userId, input) { if (Object.keys(input).length) must(await admin.from('profiles').update(input).eq('id', userId)) },
  async signIn(email, password) {
    const client = createClient(url, publicKey, { auth: { persistSession: false, autoRefreshToken: false } })
    const { data } = await client.auth.signInWithPassword({ email, password })
    return data.session ? { access_token: data.session.access_token, refresh_token: data.session.refresh_token, expires_in: data.session.expires_in, expires_at: data.session.expires_at, user: data.session.user } : null
  },
  async audit(actorId, action, targetId, details) {
    await admin.from('audit_log').insert({ user_id: actorId, profile_id: actorId, action, entity_type: 'profiles', entity_id: targetId, new_values: details, success: true })
  },
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (request.method !== 'POST') return json(405, { error: 'Méthode non autorisée' })
  try {
    const body = await request.json().catch(() => ({}))
    const token = request.headers.get('Authorization')?.replace(/^Bearer\s+/i, '') ?? null
    // The publishable key is not a user token.
    const userToken = token && token.split('.').length === 3 ? token : null
    return json(200, await handle(body, userToken, backend))
  } catch (error) {
    const status = error instanceof HttpError ? error.status : 500
    return json(status, { error: error instanceof Error ? error.message : 'Erreur inattendue' })
  }
})
