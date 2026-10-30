import type { SaleInput } from '../types/pos'
import { idbRequest } from '../lib/offline/idb'

export type SyncState = 'pending_sync' | 'syncing' | 'synced' | 'sync_error'
export type OfflineSale = { id: string; clientSaleId: string; input: SaleInput; state: SyncState; attempts: number; lastError: string | null; createdAt: string; updatedAt: string }

const uuid = () => crypto.randomUUID()

export async function enqueueSale(input: SaleInput): Promise<OfflineSale> {
  const now = new Date().toISOString(); const sale: OfflineSale = { id: uuid(), clientSaleId: uuid(), input, state: 'pending_sync', attempts: 0, lastError: null, createdAt: now, updatedAt: now }
  await idbRequest('sales', 'readwrite', (store) => store.add(sale)); return sale
}
export async function pendingSales(): Promise<OfflineSale[]> {
  const rows = await idbRequest<OfflineSale[]>('sales', 'readonly', (store) => store.getAll())
  return rows.filter((sale) => sale.state !== 'synced').sort((a, b) => a.createdAt.localeCompare(b.createdAt))
}
export async function pendingSaleCount(): Promise<number> { return (await pendingSales()).length }
export async function updateOfflineSale(id: string, patch: Partial<OfflineSale>): Promise<void> {
  const current = await idbRequest<OfflineSale | undefined>('sales', 'readonly', (store) => store.get(id))
  if (!current) return
  await idbRequest('sales', 'readwrite', (store) => store.put({ ...current, ...patch, updatedAt: new Date().toISOString() }))
}
