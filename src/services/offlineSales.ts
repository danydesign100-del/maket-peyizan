import type { SaleInput } from '../types/pos'

export type SyncState = 'pending_sync' | 'syncing' | 'synced' | 'sync_error'
export type OfflineSale = { id: string; clientSaleId: string; input: SaleInput; state: SyncState; attempts: number; lastError: string | null; createdAt: string; updatedAt: string }

const DB_NAME = 'maket-peyizan-offline'; const STORE = 'sales'; const VERSION = 1
const uuid = () => crypto.randomUUID()

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, VERSION)
    request.onupgradeneeded = () => { if (!request.result.objectStoreNames.contains(STORE)) request.result.createObjectStore(STORE, { keyPath: 'id' }) }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error ?? new Error('Stockage local indisponible'))
  })
}
async function withStore<T>(mode: IDBTransactionMode, operation: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await openDb()
  return new Promise((resolve, reject) => { const tx = db.transaction(STORE, mode); const request = operation(tx.objectStore(STORE)); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error ?? new Error('Erreur de stockage local')); tx.oncomplete = () => db.close(); tx.onerror = () => reject(tx.error ?? new Error('Transaction locale interrompue')) })
}

export async function enqueueSale(input: SaleInput): Promise<OfflineSale> {
  const now = new Date().toISOString(); const sale: OfflineSale = { id: uuid(), clientSaleId: uuid(), input, state: 'pending_sync', attempts: 0, lastError: null, createdAt: now, updatedAt: now }
  await withStore('readwrite', (store) => store.add(sale)); return sale
}
export async function pendingSales(): Promise<OfflineSale[]> {
  const rows = await withStore('readonly', (store) => store.getAll()) as OfflineSale[]
  return rows.filter((sale) => sale.state !== 'synced').sort((a, b) => a.createdAt.localeCompare(b.createdAt))
}
export async function pendingSaleCount(): Promise<number> { return (await pendingSales()).length }
export async function updateOfflineSale(id: string, patch: Partial<OfflineSale>): Promise<void> {
  const current = await withStore('readonly', (store) => store.get(id)) as OfflineSale | undefined
  if (!current) return
  await withStore('readwrite', (store) => store.put({ ...current, ...patch, updatedAt: new Date().toISOString() }))
}
