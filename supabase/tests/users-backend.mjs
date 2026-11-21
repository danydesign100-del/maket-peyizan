// Back end of the `users` Edge Function for the tests: the real database for
// profiles and roles; passwords kept in memory (Supabase Auth's job in production).
export function makeUsersBackend(db) {
  const passwords = new Map()
  const backend = {
    userFromToken: async (token) => token,
    profile: async (id) => (await db.query('select p.active, p.email, r.code role_code from profiles p left join roles r on r.id = p.role_id where p.id = $1', [id])).rows[0] ?? null,
    allowed: async (id, permission) => {
      const has = await db.query(`select to_regprocedure('public.user_has_permission(uuid,text)') is not null ok`)
      if (has.rows[0].ok) return (await db.query('select public.user_has_permission($1, $2) ok', [id, permission])).rows[0].ok
      return ['director', 'administrator'].includes((await backend.profile(id))?.role_code)
    },
    roleExists: async (id) => (await db.query('select 1 from roles where id = $1', [id])).rows.length > 0,
    usernameOwner: async (username) => (await db.query('select id from profiles where lower(username) = lower($1)', [username])).rows[0]?.id ?? null,
    emailForUsername: async (username) => (await db.query('select email from profiles where lower(username) = lower($1) and active', [username])).rows[0]?.email ?? null,
    createAuthUser: async ({ email, password, fullName }) => {
      const id = (await db.query(`insert into auth.users (email, raw_user_meta_data) values ($1, jsonb_build_object('full_name', $2::text)) returning id`, [email, fullName])).rows[0].id
      passwords.set(email, password); return id
    },
    updateAuthUser: async (id, { password }) => { const email = (await db.query('select email from auth.users where id = $1', [id])).rows[0].email; if (password) passwords.set(email, password) },
    updateProfile: async (id, input) => { for (const [key, value] of Object.entries(input)) await db.query(`update profiles set ${key} = $1 where id = $2`, [value, id]) },
    signIn: async (email, password) => passwords.get(email) === password ? { access_token: `token-${email}`, refresh_token: 'r', expires_in: 3600, user: { email } } : null,
    audit: async (actor, action, target, details) => { await db.query('insert into audit_log (user_id, profile_id, action, entity_type, entity_id, new_values, success) values ($1, $1, $2, $3, $4, $5, true)', [actor, action, 'profiles', target, JSON.stringify(details)]) },
  }
  return backend
}
