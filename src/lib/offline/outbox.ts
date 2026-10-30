import { idbRequest } from './idb'
import { getCacheScope, readCache, writeCache } from './cache'
import { hasError, hasNetworkError, isNetworkError } from './network'

// Persistent queue of writes made while the server was unreachable. Each entry
// names a registered executor so that it can be replayed after a reload.
export type OutboxOp = {
  seq?: number
  user: string
  op: string
  label: string
  args: unknown[]
  tempId: string | null
  state: 'pending' | 'error'
  attempts: number
  lastError: string | null
  createdAt: string
}

type Executor = (...args: never[]) => Promise<unknown>
const executors = new Map<string, Executor>()

export function registerExecutor(op: string, executor: Executor) { executors.set(op, executor) }

export async function enqueueOp(op: Pick<OutboxOp, 'op' | 'label' | 'args' | 'tempId'>) {
  const entry: OutboxOp = { ...op, user: getCacheScope(), state: 'pending', attempts: 0, lastError: null, createdAt: new Date().toISOString() }
  await idbRequest('outbox', 'readwrite', (store) => store.add(entry))
}

export async function listOutbox(): Promise<OutboxOp[]> {
  const rows = await idbRequest<OutboxOp[]>('outbox', 'readonly', (store) => store.getAll())
  return rows.filter((row) => row.user === getCacheScope()).sort((a, b) => (a.seq ?? 0) - (b.seq ?? 0))
}

export async function removeOp(seq: number) { await idbRequest('outbox', 'readwrite', (store) => store.delete(seq)) }
async function saveOp(op: OutboxOp) { await idbRequest('outbox', 'readwrite', (store) => store.put(op)) }

// Records created offline get a temporary id; once the server assigns the real
// one, later queued operations referencing the temporary id are rewritten.
type IdMap = Record<string, string>
const ID_MAP_KEY = 'outbox:id-map'
export async function getIdMap(): Promise<IdMap> { return (await readCache<IdMap>(ID_MAP_KEY))?.value ?? {} }

export function remapIds<T>(value: T, map: IdMap): T {
  if (typeof value === 'string') return (map[value] ?? value) as T
  if (Array.isArray(value)) return value.map((item) => remapIds(item, map)) as T
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, remapIds(item, map)])) as T
  return value
}

const errorMessage = (cause: unknown) => (cause instanceof Error ? cause.message : String((cause as { message?: unknown })?.message ?? cause ?? 'Erreur inconnue')).slice(0, 200)

/** Replays queued operations in order. Stops at the first network failure. */
export async function flushOutbox(beforeOp?: (op: OutboxOp) => Promise<void>): Promise<'done' | 'offline'> {
  const idMap = await getIdMap()
  for (const op of await listOutbox()) {
    const executor = executors.get(op.op)
    if (!executor) { await saveOp({ ...op, state: 'error', lastError: 'Opération inconnue' }); continue }
    try {
      await beforeOp?.(op)
      const result = await executor(...(remapIds(op.args, idMap) as never[]))
      if (hasNetworkError(result)) return 'offline'
      if (hasError(result)) throw (result as { error: unknown }).error
      const record = (result as { data?: { id?: string } } | null)?.data ?? result
      const realId = (record as { id?: unknown } | null)?.id
      if (op.tempId && typeof realId === 'string') { idMap[op.tempId] = realId; await writeCache(ID_MAP_KEY, idMap) }
      await removeOp(op.seq!)
    } catch (cause) {
      if (isNetworkError(cause)) return 'offline'
      await saveOp({ ...op, state: 'error', attempts: op.attempts + 1, lastError: errorMessage(cause) })
    }
  }
  return 'done'
}
