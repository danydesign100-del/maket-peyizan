import { isLocalDbConfigured } from '../supabase'
import { markOffline, markOnline } from './status'

const NETWORK_ERROR = /failed to fetch|networkerror|network request failed|load failed|fetch failed|err_internet|err_network|connexion indisponible|délai de connexion/i

export class OfflineError extends Error {
  constructor(message = 'Connexion indisponible') { super(message); this.name = 'OfflineError' }
}

export function isNetworkError(cause: unknown): boolean {
  if (!cause) return false
  if (cause instanceof OfflineError) return true
  const message = typeof cause === 'string' ? cause : String((cause as { message?: unknown }).message ?? '')
  return NETWORK_ERROR.test(message)
}

/** True when a `{ data, error }` result failed because the server was unreachable. */
export function hasNetworkError(result: unknown) {
  return Boolean(result && typeof result === 'object' && 'error' in result && isNetworkError((result as { error: unknown }).error))
}

export function hasError(result: unknown) {
  return Boolean(result && typeof result === 'object' && 'error' in result && (result as { error: unknown }).error)
}

export function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new OfflineError('Délai de connexion dépassé')), ms)
    promise.then((value) => { clearTimeout(timer); resolve(value) }, (cause) => { clearTimeout(timer); reject(cause) })
  })
}

/** Checks that the backend actually answers; `navigator.onLine` alone is unreliable. */
export async function probeConnection(): Promise<boolean> {
  if (typeof navigator !== 'undefined' && !navigator.onLine) { markOffline(); return false }
  const url = isLocalDbConfigured
    ? `${import.meta.env.VITE_API_URL || 'http://localhost:3001'}/health`
    : `${import.meta.env.VITE_SUPABASE_URL}/auth/v1/health`
  const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY || import.meta.env.VITE_SUPABASE_ANON_KEY
  try {
    const response = await withTimeout(fetch(url, { cache: 'no-store', headers: !isLocalDbConfigured && key ? { apikey: key } : undefined }), 6000)
    if (response.ok) { markOnline(); return true }
  } catch { /* unreachable */ }
  markOffline()
  return false
}
