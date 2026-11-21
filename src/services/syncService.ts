import { cachedPermissions, defaultPermissions } from '../lib/permissions'
import { catalogListService } from './catalogListService'
import { getSupabaseClient, isSupabaseConfigured } from '../lib/supabase'
import { deleteOfflineSale, pendingSales, updateOfflineSale } from './offlineSales'
import { getCacheScope, setCacheScope } from '../lib/offline/cache'
import { probeConnection, isNetworkError, OfflineError } from '../lib/offline/network'
import { flushOutbox, getIdMap, listOutbox, remapIds, removeOp, retryOp, type PushStats } from '../lib/offline/outbox'
import { errorText } from '../lib/errors'
import { refreshSnapshots } from '../lib/offline/snapshot'
import { getSyncStatus, isOnline, markOffline, updateSyncStatus } from '../lib/offline/status'
import { onOfflineWrite } from '../lib/offline/wrap'
import { ledgerService } from './ledgerService'
import { monthToDate } from '../lib/period'
import { financialYearStart } from '../lib/statements'
import { expenseService } from './expenseService'
import { posService } from './posService'
import { proformaService } from './proformaService'
import { salesService } from './salesService'
import { stockMovementService } from './stockMovementService'
import { cashCountService } from './cashCountService'
import { getInventoryMetrics, getSalesMetrics, getSalesTrend, getTopProducts } from './dashboardService'

let salesRunning = false
let syncing: Promise<void> | null = null
let role = ''
const retryDelay = (attempts: number) => Math.min(60_000, 1_000 * 2 ** Math.min(attempts, 6))
const PULL_INTERVAL = 10 * 60_000

/** Sends queued sales; `before` limits the flush to sales recorded before a given time. */
export async function syncPendingSales(before?: string, stats?: PushStats) {
  if (salesRunning || !isSupabaseConfigured || !isOnline()) return
  salesRunning = true
  try {
    const idMap = await getIdMap()
    for (const sale of await pendingSales()) {
      if (before && sale.createdAt > before) continue
      if (sale.state === 'sync_error' && sale.attempts > 0 && Date.now() - new Date(sale.updatedAt).getTime() < retryDelay(sale.attempts)) continue
      await updateOfflineSale(sale.id, { state: 'syncing', lastError: null })
      try {
        // Customers or products created offline are referenced by temporary ids.
        const input = remapIds(sale.input, idMap)
        const { data, error } = await getSupabaseClient().rpc('complete_offline_sale', {
          p_client_sale_id: sale.clientSaleId,
          p_customer_id: input.customer_id,
          p_items: input.items.map(({ productId, quantity, discount, taxRate }) => ({ product_id: productId, quantity, discount_amount: discount, tax_amount: taxRate })),
          // Methods are sent as entered (moncash, natcash, check). MonCash/NatCash need
          // their transaction ID; a sale queued before the ID became required gets a
          // visible placeholder so that it still syncs.
          p_payments: input.payments.map((payment) => ({
            method: payment.method,
            amount: payment.amount,
            reference: (payment.method === 'moncash' || payment.method === 'natcash') && !payment.reference?.trim() ? `SANS-ID-${sale.clientSaleId.slice(0, 8)}` : payment.reference,
          })),
          p_notes: input.notes?.trim() || null,
          // The real time of the sale, not the time it reaches the server.
          p_sold_at: sale.input.soldAt ?? sale.createdAt,
        })
        if (error || !data) throw error ?? new Error('Synchronisation non confirmée')
        if (input.proformaId) {
          // The sale is on the server: the proforma it came from is now « transformée en vente ».
          const { error: linkError } = await getSupabaseClient().rpc('mark_proforma_converted', { p_proforma_id: input.proformaId, p_sale_id: (data as { id: string }).id })
          // The sale stays recorded; only the proforma's status is left to update by hand.
          if (linkError && stats) stats.errors.push(`Vente enregistrée, mais la proforma n’a pas été marquée « transformée en vente » : ${errorText(linkError)}`)
        }
        await updateOfflineSale(sale.id, { state: 'synced', lastError: null, serverSaleNumber: (data as { sale_number?: string }).sale_number })
        if (stats) stats.sent += 1
      } catch (cause) {
        const offline = isNetworkError(cause)
        // The server's real reason (stock, session, MonCash ID…), not « Erreur réseau ».
        const reason = errorText(cause).slice(0, 200)
        await updateOfflineSale(sale.id, { state: offline ? 'pending_sync' : 'sync_error', attempts: sale.attempts + 1, lastError: offline ? 'En attente de connexion' : reason })
        if (!offline && stats && sale.state !== 'sync_error') { stats.failed += 1; stats.errors.push(`Vente du ${new Date(sale.createdAt).toLocaleString('fr-HT')} : ${reason}`) }
        // A failed send: offline only if the server is unreachable; retried on the next pass.
        if (offline) { await probeConnection(); break }
      }
    }
  } finally {
    salesRunning = false
    void refreshPendingCount()
  }
}

export async function refreshPendingCount() {
  try {
    const [ops, sales] = await Promise.all([listOutbox(), pendingSales()])
    updateSyncStatus({
      pending: ops.length + sales.length,
      failed: ops.filter((op) => op.state === 'error').length + sales.filter((sale) => sale.state === 'sync_error').length,
    })
  } catch { /* IndexedDB unavailable */ }
}

/** Sends local changes in order. A cash register closure first flushes the sales made before it. */
export async function pushChanges() {
  if (!isOnline()) return
  const stats: PushStats = { sent: 0, failed: 0, errors: [] }
  const result = await flushOutbox(async (op) => { if (op.op === 'pos.closeSession') await syncPendingSales(op.createdAt, stats) }, stats)
  if (result === 'done') await syncPendingSales(undefined, stats)
  await refreshPendingCount()
  if (stats.sent || stats.failed) updateSyncStatus({ report: { at: new Date().toISOString(), ...stats } })
  if (result === 'offline') throw new OfflineError('Connexion perdue pendant la synchronisation')
}

const canReadAccounting = () => (cachedPermissions(getCacheScope()) ?? defaultPermissions(role)).includes('accounting.manage')

/** Downloads reference data and the default views of each page for offline use. */
export async function pullData() {
  await refreshSnapshots()
  // Arguments match the calls made by the pages so that the cached answers are reused.
  const warmups: Array<() => Promise<unknown>> = [
    () => getSalesMetrics(), () => getInventoryMetrics(), () => getSalesTrend(), () => getTopProducts(),
    () => posService.getCurrentSession(), () => posService.getSessionSales(), () => posService.getTodaySales(),
    () => salesService.listMine(), () => salesService.listAll(),
    () => proformaService.list(), () => stockMovementService.getMovements(0, {}), () => cashCountService.list(0, ''),
    () => catalogListService.list('units'), () => catalogListService.list('supplier_categories'),
  ]
  if (canReadAccounting()) warmups.push(
    () => expenseService.getExpenses(0), () => expenseService.getMonthlyTotals(),
    // Same arguments as the accounting screens' defaults (this month, this year's balance sheet).
    () => ledgerService.listAccounts(), () => ledgerService.listPartners(), () => ledgerService.balances(null, null),
    () => ledgerService.balances(monthToDate().from, monthToDate().to), () => ledgerService.balances(financialYearStart(monthToDate().to), monthToDate().to),
    () => ledgerService.listEntries({ from: monthToDate().from, to: monthToDate().to, status: '', type: '', search: '', page: 0 }),
  )
  for (const warmup of warmups) {
    if (!isOnline()) break
    try { await warmup() } catch { /* a page the role cannot read */ }
  }
}

/** Full synchronisation: check the connection, send local changes, then refresh local data. */
export function syncNow(options: { pull?: boolean } = {}) {
  syncing ??= (async () => {
    updateSyncStatus({ syncing: true, lastError: null })
    try {
      if (!(await probeConnection())) throw new OfflineError('Pas de connexion Internet')
      await pushChanges()
      if (options.pull !== false) await pullData()
      updateSyncStatus({ lastSyncAt: new Date().toISOString() })
    } catch (cause) {
      updateSyncStatus({ lastError: errorText(cause, 'Synchronisation impossible') })
    } finally {
      updateSyncStatus({ syncing: false })
      await refreshPendingCount()
      syncing = null
    }
  })()
  return syncing
}

/** New attempt for a refused sale, now. */
export async function retrySale(id: string) {
  await updateOfflineSale(id, { state: 'pending_sync', attempts: 0, lastError: null })
  await syncNow({ pull: false })
}

/** New attempt for a refused operation, now. */
export async function retryOperation(seq: number) {
  await retryOp(seq)
  await syncNow({ pull: false })
}

/** Abandons a refused sale: it will never be recorded on the server. */
export async function discardSale(id: string) {
  await deleteOfflineSale(id)
  await refreshPendingCount()
}

export async function discardOperation(seq: number) {
  await removeOp(seq)
  await refreshPendingCount()
}

export { listOutbox }

/** Called by the auth context so that the cache and queue belong to the signed-in user. */
export function setSyncUser(userId: string | null, userRole = '') {
  const changed = getCacheScope() !== (userId ?? 'anon')
  setCacheScope(userId)
  role = userRole
  if (changed && userId) void syncNow()
  void refreshPendingCount()
}

const isStale = () => { const last = getSyncStatus().lastSyncAt; return !last || Date.now() - new Date(last).getTime() > PULL_INTERVAL }

export function startBackgroundSync() {
  if (typeof window === 'undefined') return () => undefined
  let refreshTimer: ReturnType<typeof setTimeout> | undefined
  const signedIn = () => getCacheScope() !== 'anon'
  const onOnline = () => { if (signedIn()) void syncNow({ pull: isStale() }) }
  const onOffline = () => markOffline()
  const onVisible = () => {
    if (document.visibilityState !== 'visible' || !signedIn()) return
    // Back on the tab or the device woke up: check the connection now rather than at the next tick.
    if (!isOnline()) void probeConnection().then((online) => { if (online) onOnline() })
    else if (getSyncStatus().pending || isStale()) void syncNow({ pull: isStale() })
  }
  const tick = () => {
    if (!signedIn()) return
    if (!isOnline()) void probeConnection().then((online) => { if (online) onOnline() })
    else if (getSyncStatus().pending || isStale()) void syncNow({ pull: isStale() })
  }
  // After an online write, refresh the snapshots so that they keep matching the server.
  const stopWrites = onOfflineWrite(() => {
    void refreshPendingCount()
    clearTimeout(refreshTimer)
    refreshTimer = setTimeout(() => { if (isOnline()) void refreshSnapshots() }, 3000)
  })
  const interval = setInterval(tick, 15_000)
  window.addEventListener('online', onOnline); window.addEventListener('offline', onOffline)
  window.addEventListener('focus', onVisible); document.addEventListener('visibilitychange', onVisible)
  void refreshPendingCount()
  return () => {
    clearInterval(interval); clearTimeout(refreshTimer); stopWrites()
    window.removeEventListener('online', onOnline); window.removeEventListener('offline', onOffline)
    window.removeEventListener('focus', onVisible); document.removeEventListener('visibilitychange', onVisible)
  }
}
