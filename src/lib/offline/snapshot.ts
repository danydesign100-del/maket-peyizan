import { readCache, writeCache } from './cache'

// Full local copies of the reference tables, so that search, filters and
// pagination keep working offline on data that was never displayed before.
export type SnapshotName = 'products' | 'customers' | 'suppliers' | 'categories'
type Row = { id: string }

const loaders = new Map<SnapshotName, () => Promise<Row[]>>()
export function registerSnapshot(name: SnapshotName, loader: () => Promise<Row[]>) { loaders.set(name, loader) }

export async function getSnapshot<T = Row>(name: SnapshotName): Promise<T[] | undefined> {
  return (await readCache<T[]>(`snapshot:${name}`))?.value
}

export async function saveSnapshot(name: SnapshotName, rows: Row[]) { await writeCache(`snapshot:${name}`, rows) }

export async function patchSnapshot<T extends Row>(name: SnapshotName, mutate: (rows: T[]) => T[]) {
  const rows = await getSnapshot<T>(name)
  if (rows) await saveSnapshot(name, mutate(rows))
}

export const upsertRow = <T extends Row>(rows: T[], row: T) => rows.some((item) => item.id === row.id) ? rows.map((item) => item.id === row.id ? { ...item, ...row } : item) : [row, ...rows]
export const patchRow = <T extends Row>(rows: T[], id: string, patch: Partial<T>) => rows.map((item) => item.id === id ? { ...item, ...patch } : item)

/** Refreshes every registered snapshot; a failing loader keeps the previous copy. */
export async function refreshSnapshots() {
  await Promise.all([...loaders].map(async ([name, loader]) => {
    try { await saveSnapshot(name, await loader()) } catch { /* keep previous snapshot */ }
  }))
}

export const matches = (term: string | undefined, ...values: unknown[]) => {
  const needle = term?.trim().toLocaleLowerCase('fr')
  return !needle || values.some((value) => typeof value === 'string' && value.toLocaleLowerCase('fr').includes(needle))
}

export const byText = <T>(key: keyof T) => (a: T, b: T) => String(a[key] ?? '').localeCompare(String(b[key] ?? ''), 'fr')

export function paginate<T>(rows: T[], page: number, size = 20) {
  return { data: rows.slice(page * size, page * size + size), error: null, count: rows.length }
}
