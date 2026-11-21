// Account administration for Makèt Peyizan, run by the `users` Edge Function
// (index.ts) with the project's secret key, which never reaches the browser.
// The logic only talks to `Backend`, so the tests can run it on the test database.

export type Session = { access_token: string; refresh_token: string; expires_in: number; expires_at?: number; user: unknown }
export type Backend = {
  /** User id of a signed-in caller's access token, or null. */
  userFromToken(token: string): Promise<string | null>
  /** Active profile and role code of a user. */
  profile(userId: string): Promise<{ active: boolean; role_code: string | null; email: string | null } | null>
  /** Whether the user's role grants a permission (step F3), falling back to the role code. */
  allowed(userId: string, permission: string): Promise<boolean>
  roleExists(roleId: string): Promise<boolean>
  usernameOwner(username: string): Promise<string | null>
  emailForUsername(username: string): Promise<string | null>
  createAuthUser(input: { email: string; password: string; fullName: string }): Promise<string>
  updateAuthUser(userId: string, input: { password?: string; email?: string }): Promise<void>
  updateProfile(userId: string, input: { username?: string | null; full_name?: string; role_id?: string; email?: string; active?: boolean }): Promise<void>
  signIn(email: string, password: string): Promise<Session | null>
  audit(actorId: string | null, action: string, targetId: string | null, details: Record<string, unknown>): Promise<void>
}

export class HttpError extends Error {
  status: number
  constructor(status: number, message: string) { super(message); this.status = status }
}

const USERNAME = /^[a-z0-9][a-z0-9._-]{2,31}$/
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
/** Accounts without an e-mail get a placeholder address that can never receive mail. */
export const placeholderEmail = (username: string) => `${username}@utilisateurs.maket-peyizan.invalid`

const text = (value: unknown) => typeof value === 'string' ? value.trim() : ''
function checkPassword(password: unknown) {
  if (typeof password !== 'string' || password.length < 8) throw new HttpError(400, 'Le mot de passe doit contenir au moins 8 caractères')
  return password
}
function checkUsername(value: unknown) {
  const username = text(value).toLowerCase()
  if (!USERNAME.test(username)) throw new HttpError(400, 'Nom d’utilisateur invalide : 3 à 32 caractères, lettres minuscules, chiffres, point, tiret ou tiret bas')
  return username
}

async function requireManager(backend: Backend, token: string | null) {
  const caller = token ? await backend.userFromToken(token) : null
  if (!caller) throw new HttpError(401, 'Session expirée : reconnectez-vous')
  const profile = await backend.profile(caller)
  if (!profile?.active || !(await backend.allowed(caller, 'users.manage'))) throw new HttpError(403, 'Seuls les responsables autorisés gèrent les comptes utilisateurs')
  return caller
}

/** Handles one request body; `token` is the caller's access token (absent for `login`). */
export async function handle(body: Record<string, unknown>, token: string | null, backend: Backend): Promise<Record<string, unknown>> {
  const action = text(body.action)

  if (action === 'login') {
    // Sign in with a user name: the e-mail is looked up here, never sent to the browser.
    const identifier = text(body.identifier).toLowerCase()
    const password = typeof body.password === 'string' ? body.password : ''
    const email = identifier.includes('@') ? identifier : await backend.emailForUsername(identifier)
    const session = email && password ? await backend.signIn(email, password) : null
    if (!session) throw new HttpError(401, 'Identifiant ou mot de passe incorrect')
    return { session }
  }

  const caller = await requireManager(backend, token)

  if (action === 'create') {
    const fullName = text(body.full_name)
    if (fullName.length < 2) throw new HttpError(400, 'Le nom complet est obligatoire')
    const username = checkUsername(body.username)
    const password = checkPassword(body.password)
    const roleId = text(body.role_id)
    if (!roleId || !(await backend.roleExists(roleId))) throw new HttpError(400, 'Rôle inconnu')
    const realEmail = text(body.email).toLowerCase()
    if (realEmail && !EMAIL.test(realEmail)) throw new HttpError(400, 'Adresse e-mail invalide')
    if (await backend.usernameOwner(username)) throw new HttpError(409, `Le nom d’utilisateur « ${username} » est déjà pris`)
    const email = realEmail || placeholderEmail(username)
    const userId = await backend.createAuthUser({ email, password, fullName })
    await backend.updateProfile(userId, { username, full_name: fullName, role_id: roleId, email: realEmail || email, active: true })
    await backend.audit(caller, 'user_created', userId, { username, role_id: roleId, email: realEmail || null })
    return { user: { id: userId, username, email: realEmail || null } }
  }

  const userId = text(body.user_id)
  if (!userId || !(await backend.profile(userId))) throw new HttpError(404, 'Utilisateur introuvable')

  if (action === 'set_password') {
    await backend.updateAuthUser(userId, { password: checkPassword(body.password) })
    await backend.audit(caller, 'user_password_reset', userId, {})
    return { ok: true }
  }

  if (action === 'update') {
    const patch: { username?: string | null; full_name?: string; email?: string } = {}
    if ('username' in body) {
      const username = body.username === null || body.username === '' ? null : checkUsername(body.username)
      const owner = username ? await backend.usernameOwner(username) : null
      if (owner && owner !== userId) throw new HttpError(409, `Le nom d’utilisateur « ${username} » est déjà pris`)
      patch.username = username
    }
    if ('full_name' in body) {
      const fullName = text(body.full_name)
      if (fullName.length < 2) throw new HttpError(400, 'Le nom complet est obligatoire')
      patch.full_name = fullName
    }
    if ('email' in body && text(body.email)) {
      const email = text(body.email).toLowerCase()
      if (!EMAIL.test(email)) throw new HttpError(400, 'Adresse e-mail invalide')
      await backend.updateAuthUser(userId, { email })
      patch.email = email
    }
    await backend.updateProfile(userId, patch)
    await backend.audit(caller, 'user_updated', userId, patch)
    return { ok: true }
  }

  throw new HttpError(400, 'Action inconnue')
}
