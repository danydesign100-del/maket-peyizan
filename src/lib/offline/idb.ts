// Single IndexedDB database shared by every offline feature. Each store is
// opened through this module so that version upgrades never conflict.
const DB_NAME = 'maket-peyizan-offline'
const VERSION = 2

export type OfflineStore = 'sales' | 'cache' | 'outbox'

let dbPromise: Promise<IDBDatabase> | null = null

export function openOfflineDb(): Promise<IDBDatabase> {
  dbPromise ??= new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, VERSION)
    request.onupgradeneeded = () => {
      const db = request.result
      if (!db.objectStoreNames.contains('sales')) db.createObjectStore('sales', { keyPath: 'id' })
      if (!db.objectStoreNames.contains('cache')) db.createObjectStore('cache', { keyPath: 'key' })
      if (!db.objectStoreNames.contains('outbox')) db.createObjectStore('outbox', { keyPath: 'seq', autoIncrement: true })
    }
    request.onsuccess = () => {
      const db = request.result
      db.onversionchange = () => { db.close(); dbPromise = null }
      resolve(db)
    }
    request.onerror = () => { dbPromise = null; reject(request.error ?? new Error('Stockage local indisponible')) }
  })
  return dbPromise
}

export async function idbRequest<T>(store: OfflineStore, mode: IDBTransactionMode, operation: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await openOfflineDb()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, mode)
    const request = operation(tx.objectStore(store))
    tx.oncomplete = () => resolve(request.result)
    tx.onerror = () => reject(tx.error ?? request.error ?? new Error('Transaction locale interrompue'))
    tx.onabort = () => reject(tx.error ?? new Error('Transaction locale annulée'))
  })
}
