// Browser tests: the real app (Vite) talks to a PGlite replica of the database
// through fake-supabase.mjs, signed in as a given user. Chrome must be installed.
import { chromium } from 'playwright-core'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { fakeSupabase } from '../fake-supabase.mjs'

export const ROOT = fileURLToPath(new URL('../../../', import.meta.url))
export const REF = 'testproj'
export const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
export const text = async (locator) => (await locator.innerText()).replace(/\s+/g, ' ').trim()

/** Starts Vite on `port` against the fake Supabase project; resolves once it answers. */
export async function startApp(port) {
  const vite = spawn('npx', ['vite', '--port', String(port), '--strictPort'], { cwd: ROOT, env: { ...process.env, VITE_USE_LOCAL_DB: 'false', VITE_SUPABASE_URL: `https://${REF}.supabase.co`, VITE_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_test' } })
  for (let i = 0; i < 120; i++) { try { if ((await fetch(`http://localhost:${port}`)).ok) break } catch { /* starting */ } await sleep(250) }
  const browser = await chromium.launch({ channel: 'chrome', headless: true })
  return { base: `http://localhost:${port}`, browser, stop: async () => { await browser.close(); vite.kill() } }
}

/** Pages opened by the current test (for screenshots on failure). */
export const openPages = []

const b64 = (value) => Buffer.from(JSON.stringify(value)).toString('base64url')

/**
 * A browser context signed in as `userId`. `network.mode` can be switched to
 * 'offline' (every Supabase request fails) or 'ok' during a test.
 */
export async function openAs(app, db, { userId, name, role }, path = '/') {
  const profile = { id: userId, full_name: name, email: `${role}@shop.ht`, active: true, role_id: null, role: { code: role, name: role.toUpperCase() } }
  const context = await app.browser.newContext({ viewport: { width: 1440, height: 1000 } })
  const network = { mode: 'ok' }
  await context.route(`https://${REF}.supabase.co/**`, fakeSupabase({ db, userId, profile }))
  await context.route(`https://${REF}.supabase.co/**`, (route) => network.mode === 'offline' ? route.abort('internetdisconnected') : route.fallback())
  const exp = Math.floor(Date.now() / 1000) + 86400
  await context.addInitScript(([key, value]) => localStorage.setItem(key, value), [`sb-${REF}-auth-token`, JSON.stringify({ access_token: `${b64({ alg: 'HS256' })}.${b64({ sub: userId, role: 'authenticated', exp })}.sig`, refresh_token: 'r', token_type: 'bearer', expires_in: 86400, expires_at: exp, user: { id: userId, email: profile.email, aud: 'authenticated', role: 'authenticated' } })])
  await context.addInitScript(() => { window.print = () => { window.__printed = (window.__printed ?? 0) + 1; setTimeout(() => window.dispatchEvent(new Event('afterprint')), 50) } })
  const page = await context.newPage()
  page.errors = []
  page.on('pageerror', (error) => page.errors.push(error.message))
  page.network = network
  openPages.push(page)
  if (path) await page.goto(`${app.base}${path}`)
  return page
}
