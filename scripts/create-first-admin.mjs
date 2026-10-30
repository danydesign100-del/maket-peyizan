#!/usr/bin/env node
// Creates the first administrator of a hosted Makèt Peyizan project, without
// the confirmation email. Run it yourself so the password stays on your machine:
//
//   node scripts/create-first-admin.mjs            create the account
//   node scripts/create-first-admin.mjs --check    only check the project state
//
// Requires the Supabase CLI to be signed in (npx supabase login) and the project
// settings in .env.production.local (VITE_SUPABASE_URL, VITE_SUPABASE_PUBLISHABLE_KEY).
// The secret key is read through the CLI, kept in memory and never printed.
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { createInterface } from 'node:readline'

const CHECK_ONLY = process.argv.includes('--check')

function readEnv(file) {
  const values = {}
  for (const line of readFileSync(file, 'utf8').split('\n')) {
    const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/)
    if (match) values[match[1]] = match[2]
  }
  return values
}

const env = readEnv(new URL('../.env.production.local', import.meta.url))
const url = env.VITE_SUPABASE_URL
const publishable = env.VITE_SUPABASE_PUBLISHABLE_KEY
if (!url || !publishable) throw new Error('VITE_SUPABASE_URL or VITE_SUPABASE_PUBLISHABLE_KEY missing from .env.production.local')
const ref = new URL(url).hostname.split('.')[0]

async function call(path, { key = publishable, token, method = 'GET', body } = {}) {
  const headers = { apikey: key, 'Content-Type': 'application/json' }
  if (token) headers.Authorization = `Bearer ${token}`
  // Legacy service_role keys are JWTs and must also be sent as the bearer token.
  else if (key !== publishable && key.startsWith('eyJ')) headers.Authorization = `Bearer ${key}`
  const response = await fetch(`${url}${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) })
  const text = await response.text()
  const data = text ? JSON.parse(text) : null
  if (!response.ok) throw new Error(data?.msg || data?.message || data?.error_description || data?.error || `HTTP ${response.status}`)
  return data
}

function secretKey() {
  const output = execFileSync('npx', ['--yes', 'supabase@2', 'projects', 'api-keys', '--project-ref', ref, '--reveal', '-o', 'json'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })
  const keys = JSON.parse(output.slice(output.indexOf('[') >= 0 && output.indexOf('[') < output.indexOf('{') ? output.indexOf('[') : output.indexOf('{')))
  const list = Array.isArray(keys) ? keys : keys.keys ?? []
  const key = list.find((item) => item.type === 'secret')?.api_key ?? list.find((item) => item.name === 'service_role')?.api_key
  if (!key) throw new Error('No secret key found for this project')
  return key
}

const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: true })
const ask = (question) => new Promise((resolve) => rl.question(question, (answer) => resolve(answer.trim())))
// Hidden input: nothing typed is echoed to the terminal.
const askHidden = (question) => new Promise((resolve) => {
  process.stdout.write(question)
  const original = rl._writeToOutput
  rl._writeToOutput = () => {}
  rl.question('', (answer) => { rl._writeToOutput = original; process.stdout.write('\n'); resolve(answer) })
})

try {
  console.log(`Projet Supabase : ${ref}`)
  const complete = await call('/rest/v1/rpc/is_initial_setup_complete', { method: 'POST', body: {} })
  if (complete) { console.log('Un administrateur existe déjà : rien à faire. Connectez-vous sur le site.'); process.exit(0) }
  // Without --reveal the CLI returns a masked secret key, which Supabase rejects.
  const key = secretKey()
  await call('/auth/v1/admin/users?page=1&per_page=1', { key })
  console.log('Aucun administrateur pour le moment. Clé du projet vérifiée (non affichée).')
  if (CHECK_ONLY) process.exit(0)

  const fullName = await ask('Nom complet : ')
  const email = (await ask('E-mail : ')).toLowerCase()
  if (!fullName || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error('Nom ou e-mail invalide')
  const password = await askHidden('Mot de passe (8 caractères minimum, non affiché) : ')
  if (password.length < 8) throw new Error('Le mot de passe doit contenir au moins 8 caractères')
  if (await askHidden('Confirmez le mot de passe : ') !== password) throw new Error('Les mots de passe ne correspondent pas')

  // 1. Account created already confirmed: no confirmation email needed.
  const user = await call('/auth/v1/admin/users', { key, method: 'POST', body: { email, password, email_confirm: true, user_metadata: { full_name: fullName } } })
  console.log('✓ Compte créé et confirmé')
  // 2. Sign in as that account and promote it with the app's own bootstrap function.
  const session = await call('/auth/v1/token?grant_type=password', { method: 'POST', body: { email, password } })
  await call('/rest/v1/rpc/create_first_admin_user', { token: session.access_token, method: 'POST', body: { user_uuid: user.id } })
  const [profile] = await call(`/rest/v1/profiles?id=eq.${user.id}&select=full_name,active,role:roles(code,name)`, { token: session.access_token })
  console.log(`✓ ${profile.full_name} est maintenant ${profile.role?.name ?? profile.role?.code} (${profile.active ? 'actif' : 'inactif'})`)
  console.log('Connectez-vous sur le site avec cet e-mail et ce mot de passe.')
} catch (error) {
  console.error(`✗ ${error.message}`)
  process.exitCode = 1
} finally {
  rl.close()
}
