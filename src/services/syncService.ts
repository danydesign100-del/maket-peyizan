import { getSupabaseClient, isSupabaseConfigured } from '../lib/supabase'
import { pendingSales, updateOfflineSale } from './offlineSales'
import { getCacheScope, setCacheScope } from '../lib/offline/cache'
import { probeConnection, isNetworkError, OfflineError } from '../lib/offline/network'
import { flushOutbox, getIdMap, listOutbox, remapIds, removeOp } from '../lib/offline/outbox'
import { refreshSnapshots } from '../lib/offline/snapshot'
import { getSyncStatus, isOnline, markOffline, updateSyncStatus } from '../lib/offline/status'
import { onOfflineWrite } from '../lib/offline/wrap'
import { accountingService } from './accountingService'
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
export async function syncPendingSales(before?: string) {
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
          // Current central schema groups mobile wallets under mobile_money and
          // cheques under other; the human-readable method is preserved in the
          // reference until the central payment enum is expanded.
          p_payments: input.payments.map((payment) => ({
            method: payment.method === 'moncash' || payment.method === 'natcash' ? 'mobile_money' : payment.method === 'check' ? 'other' : payment.method,
            amount: payment.amount,
            reference: payment.method === 'moncash' || payment.method === 'natcash' || payment.method === 'check' ? `${payment.method}:${payment.reference ?? ''}` : payment.reference,
          })),
          p_notes: input.notes?.trim() || null,
        })
        if (error || !data) throw error ?? new Error('Synchronisation non confirmée')
        await updateOfflineSale(sale.id, { state: 'synced', lastError: null })
      } catch (cause) {
        const offline = isNetworkError(cause)
        await updateOfflineSale(sale.id, { state: offline ? 'pending_sync' : 'sync_error', attempts: sale.attempts + 1, lastError: cause instanceof Error ? cause.message.slice(0, 200) : 'Erreur réseau' })
        if (offline) { markOffline(); break }
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
  const result = await flushOutbox(async (op) => { if (op.op === 'pos.closeSession') await syncPendingSales(op.createdAt) })
  if (result === 'done') await syncPendingSales()
  await refreshPendingCount()
  if (result === 'offline') throw new OfflineError('Connexion perdue pendant la synchronisation')
}

const canReadAccounting = () => ['director', 'administrator', 'accountant'].includes(role)

/** Downloads reference data and the default views of each page for offline use. */
export async function pullData() {
  await refreshSnapshots()
  // Arguments match the calls made by the pages so that the cached answers are reused.
  const warmups: Array<() => Promise<unknown>> = [
    () => getSalesMetrics(), () => getInventoryMetrics(), () => getSalesTrend(), () => getTopProducts(),
    () => posService.getCurrentSession(), () => posService.getSessionSales(), () => posService.getTodaySales(),
    () => salesService.listMine(), () => salesService.listAll(),
    () => proformaService.list(), () => stockMovementService.getMovements(0, {}), () => cashCountService.list(0, ''),
  ]
  if (canReadAccounting()) warmups.push(
    () => expenseService.getExpenses(0), () => expenseService.getMonthlyTotals(),
    () => accountingService.getAccounts({ active: true }), () => accountingService.getJournalEntries({ status: 'draft' }),
    () => accountingService.getTrialBalance(), () => accountingService.getGeneralLedger(), () => accountingService.getBalanceSheet(),
    () => accountingService.getIncomeStatement(), () => accountingService.getAuditLog({ page: 0 }),
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
      updateSyncStatus({ lastError: cause instanceof Error ? cause.message : 'Synchronisation impossible' })
    } finally {
      updateSyncStatus({ syncing: false })
      await refreshPendingCount()
      syncing = null
    }
  })()
  return syncing
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
  const onVisible = () => { if (document.visibilityState === 'visible' && signedIn() && (getSyncStatus().pending || isStale())) void syncNow({ pull: isStale() }) }
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
  const interval = setInterval(tick, 30_000)
  window.addEventListener('online', onOnline); window.addEventListener('offline', onOffline)
  window.addEventListener('focus', onVisible); document.addEventListener('visibilitychange', onVisible)
  void refreshPendingCount()
  return () => {
    clearInterval(interval); clearTimeout(refreshTimer); stopWrites()
    window.removeEventListener('online', onOnline); window.removeEventListener('offline', onOffline)
    window.removeEventListener('focus', onVisible); document.removeEventListener('visibilitychange', onVisible)
  }
}
