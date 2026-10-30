import { idbRequest } from './idb'

// Cached entries are scoped to the signed-in user so that a shared device never
// shows one user's data to another while offline.
let scope = 'anon'
export function setCacheScope(userId: string | null) { scope = userId ?? 'anon' }
export const getCacheScope = () => scope

type CacheEntry<T> = { key: string; value: T; savedAt: string }

export async function readCache<T>(key: string): Promise<CacheEntry<T> | undefined> {
  try { return await idbRequest<CacheEntry<T> | undefined>('cache', 'readonly', (store) => store.get(`${scope}:${key}`)) } catch { return undefined }
}

export async function writeCache<T>(key: string, value: T) {
  try { await idbRequest('cache', 'readwrite', (store) => store.put({ key: `${scope}:${key}`, value, savedAt: new Date().toISOString() })) } catch { /* quota or private mode */ }
}

export async function deleteCache(key: string) {
  try { await idbRequest('cache', 'readwrite', (store) => store.delete(`${scope}:${key}`)) } catch { /* ignore */ }
}
