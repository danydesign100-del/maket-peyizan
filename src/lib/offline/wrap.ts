import { readCache, writeCache } from './cache'
import { hasError, hasNetworkError, isNetworkError, OfflineError, withTimeout } from './network'
import { enqueueOp, registerExecutor } from './outbox'
import { getSyncStatus, isOnline, markOffline, markOnline, updateSyncStatus } from './status'

/* eslint-disable @typescript-eslint/no-explicit-any */
type AnyFn = (...args: any[]) => Promise<any>
type Style = 'result' | 'throw'

type ReadConfig = {
  /** Offline answer computed from local snapshots; `undefined` falls back to the cache. */
  fallback?: (...args: any[]) => Promise<unknown> | unknown
}
type WriteConfig = {
  label: string | ((...args: any[]) => string)
  /** Local effect of the write and the value returned to the page while queued. */
  optimistic?: (tempId: string, ...args: any[]) => Promise<unknown> | unknown
  createsId?: boolean
}
type OfflineConfig<T> = {
  style?: Style
  throws?: (keyof T)[]
  reads?: Partial<Record<keyof T, ReadConfig | true>>
  writes?: Partial<Record<keyof T, WriteConfig>>
  onlineOnly?: (keyof T)[]
}

const READ_TIMEOUT = 12_000
const listeners = new Set<(op: string) => void>()
/** Notified after any write so snapshots and counters can be refreshed. */
export function onOfflineWrite(listener: (op: string) => void) { listeners.add(listener); return () => { listeners.delete(listener) } }
const notifyWrite = (op: string) => listeners.forEach((listener) => listener(op))

export const OFFLINE_MISS = 'Données non disponibles hors ligne. Synchronisez dès que la connexion revient.'
export const ONLINE_REQUIRED = 'Cette action nécessite une connexion Internet.'

function offlineResult(style: Style, message: string) {
  if (style === 'throw') throw new OfflineError(message)
  return { data: null, error: new OfflineError(message), count: null }
}

/** Network-first read that stores successful answers and serves them offline. */
export async function cachedRead<R>(key: string, run: () => Promise<R>, options: { style?: Style; fallback?: () => Promise<unknown> | unknown } = {}): Promise<R> {
  const style = options.style ?? 'result'
  if (isOnline()) {
    try {
      const result = await withTimeout(run(), READ_TIMEOUT)
      if (!hasNetworkError(result)) {
        markOnline()
        if (!hasError(result)) void writeCache(key, result)
        return result
      }
    } catch (cause) {
      if (!isNetworkError(cause)) throw cause
    }
    markOffline()
  }
  const local = await options.fallback?.()
  if (local !== undefined) return local as R
  const cached = await readCache<R>(key)
  if (cached) {
    const since = getSyncStatus().cachedSince
    if (!since || cached.savedAt < since) updateSyncStatus({ cachedSince: cached.savedAt })
    return cached.value
  }
  return offlineResult(style, OFFLINE_MISS) as R
}

/** Adds caching, offline queueing or an explicit online requirement to a service. */
export function withOffline<T extends Record<string, unknown>>(name: string, service: T, config: OfflineConfig<T>): T {
  const styleOf = (method: keyof T): Style => config.throws?.includes(method) ? 'throw' : config.style ?? 'result'
  const wrapped: Record<string, unknown> = { ...service }

  for (const [method, read] of Object.entries(config.reads ?? {}) as [keyof T & string, ReadConfig | true][]) {
    const run = service[method] as AnyFn
    const fallback = read === true ? undefined : read.fallback
    wrapped[method] = (...args: unknown[]) => cachedRead(`${name}.${method}:${JSON.stringify(args)}`, () => run(...args), { style: styleOf(method), fallback: fallback && (() => fallback(...args)) })
  }

  for (const [method, write] of Object.entries(config.writes ?? {}) as [keyof T & string, WriteConfig][]) {
    const run = service[method] as AnyFn
    const op = `${name}.${method}`
    registerExecutor(op, run)
    wrapped[method] = async (...args: unknown[]) => {
      if (isOnline()) {
        try {
          const result = await run(...args)
          if (!hasNetworkError(result)) { markOnline(); notifyWrite(op); return result }
        } catch (cause) {
          if (!isNetworkError(cause)) throw cause
        }
        markOffline()
      }
      const tempId = `local-${crypto.randomUUID()}`
      const label = typeof write.label === 'function' ? write.label(...args) : write.label
      await enqueueOp({ op, label, args, tempId: write.createsId ? tempId : null })
      const data = write.optimistic ? await write.optimistic(tempId, ...args) : null
      notifyWrite(op)
      return styleOf(method) === 'throw' ? data : { data, error: null, count: null, queued: true }
    }
  }

  for (const method of config.onlineOnly ?? []) {
    const run = service[method] as AnyFn
    const style = styleOf(method)
    wrapped[method as string] = async (...args: unknown[]) => {
      if (!isOnline()) return offlineResult(style, ONLINE_REQUIRED)
      try {
        const result = await run(...args)
        if (!hasNetworkError(result)) { notifyWrite(`${name}.${String(method)}`); return result }
      } catch (cause) {
        if (!isNetworkError(cause)) throw cause
      }
      markOffline()
      return offlineResult(style, ONLINE_REQUIRED)
    }
  }

  return wrapped as T
}
