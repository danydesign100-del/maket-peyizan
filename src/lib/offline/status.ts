import { useSyncExternalStore } from 'react'

// Connectivity and synchronisation state shared by the services and the UI.
export type SyncStatus = {
  online: boolean
  syncing: boolean
  pending: number
  failed: number
  lastSyncAt: string | null
  lastError: string | null
  cachedSince: string | null
}

const LAST_SYNC_KEY = 'mp:last-sync'
const readLastSync = () => { try { return localStorage.getItem(LAST_SYNC_KEY) } catch { return null } }

let status: SyncStatus = {
  online: typeof navigator === 'undefined' ? true : navigator.onLine,
  syncing: false,
  pending: 0,
  failed: 0,
  lastSyncAt: readLastSync(),
  lastError: null,
  cachedSince: null,
}
const listeners = new Set<() => void>()

export function getSyncStatus() { return status }

export function updateSyncStatus(patch: Partial<SyncStatus>) {
  const next = { ...status, ...patch }
  if (Object.keys(patch).every((key) => next[key as keyof SyncStatus] === status[key as keyof SyncStatus])) return
  if (patch.lastSyncAt) try { localStorage.setItem(LAST_SYNC_KEY, patch.lastSyncAt) } catch { /* storage unavailable */ }
  status = next
  listeners.forEach((listener) => listener())
}

export function subscribeSyncStatus(listener: () => void) {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}

export function useSyncStatus() {
  return useSyncExternalStore(subscribeSyncStatus, getSyncStatus, getSyncStatus)
}

export const isOnline = () => status.online && (typeof navigator === 'undefined' || navigator.onLine)
export const markOnline = () => updateSyncStatus({ online: true, cachedSince: null })
export const markOffline = () => updateSyncStatus({ online: false })
