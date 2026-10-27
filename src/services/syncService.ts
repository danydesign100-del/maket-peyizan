import { getSupabaseClient, isSupabaseConfigured } from '../lib/supabase'
import { pendingSales, updateOfflineSale } from './offlineSales'

let running = false
const retryDelay = (attempts: number) => Math.min(60_000, 1_000 * 2 ** Math.min(attempts, 6))

export async function syncPendingSales() {
  if (running || !isSupabaseConfigured || !navigator.onLine) return
  running = true
  try {
    for (const sale of await pendingSales()) {
      if (sale.state === 'sync_error' && sale.attempts > 0 && Date.now() - new Date(sale.updatedAt).getTime() < retryDelay(sale.attempts)) continue
      await updateOfflineSale(sale.id, { state: 'syncing', lastError: null })
      const { data, error } = await getSupabaseClient().rpc('complete_offline_sale', {
        p_client_sale_id: sale.clientSaleId,
        p_customer_id: sale.input.customer_id,
        p_items: sale.input.items.map(({ productId, quantity, discount, taxRate }) => ({ product_id: productId, quantity, discount_amount: discount, tax_amount: taxRate })),
        // Current central schema groups mobile wallets under mobile_money and
        // cheques under other; the human-readable method is preserved in the
        // reference until the central payment enum is expanded.
        p_payments: sale.input.payments.map((payment) => ({
          method: payment.method === 'moncash' || payment.method === 'natcash' ? 'mobile_money' : payment.method === 'check' ? 'other' : payment.method,
          amount: payment.amount,
          reference: payment.method === 'moncash' || payment.method === 'natcash' || payment.method === 'check' ? `${payment.method}:${payment.reference ?? ''}` : payment.reference,
        })),
        p_notes: sale.input.notes?.trim() || null,
      })
      if (error || !data) throw error ?? new Error('Synchronisation non confirmée')
      await updateOfflineSale(sale.id, { state: 'synced', lastError: null })
    }
  } catch (cause) {
    const unsynced = await pendingSales(); const current = unsynced.find((sale) => sale.state === 'syncing')
    if (current) await updateOfflineSale(current.id, { state: 'sync_error', attempts: current.attempts + 1, lastError: cause instanceof Error ? cause.message.slice(0, 200) : 'Erreur réseau' })
  } finally { running = false }
}

export function startBackgroundSync() {
  if (!isSupabaseConfigured || typeof window === 'undefined') return () => undefined
  const trigger = () => { void syncPendingSales() }
  const onVisibilityChange = () => { if (document.visibilityState === 'visible') trigger() }
  window.addEventListener('online', trigger); window.addEventListener('focus', trigger); document.addEventListener('visibilitychange', onVisibilityChange); trigger()
  return () => { window.removeEventListener('online', trigger); window.removeEventListener('focus', trigger); document.removeEventListener('visibilitychange', onVisibilityChange) }
}
