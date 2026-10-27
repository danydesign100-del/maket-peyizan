import { getSupabaseClient, isLocalDbConfigured } from '../lib/supabase'
import { localApi } from '../lib/localApi'
import type { CartItem, CashSessionInput, SaleInput } from '../types/pos'
import { enqueueSale } from './offlineSales'
import { syncPendingSales } from './syncService'

const cashSessionsTable = () => getSupabaseClient().from('cash_sessions')
const salesTable = () => getSupabaseClient().from('sales')

export const posService = {
  getCurrentSession: async () => {
    if (isLocalDbConfigured) {
      const profile = await localApi.getProfile()
      const rows = await localApi.query('select * from cash_sessions where opened_by = ? and closed_at is null order by opened_at desc limit 1', [profile.id])
      return rows[0] ?? null
    }
    const { data: { user } } = await getSupabaseClient().auth.getUser()
    if (!user) throw new Error('Non authentifie')

    const { data, error } = await cashSessionsTable()
      .select('*, opener:profiles(full_name)')
      .eq('opened_by', user.id)
      .is('closed_at', null)
      .maybeSingle()
    if (error) throw error
    return data
  },

  openSession: async (input: CashSessionInput) => {
    if (isLocalDbConfigured) {
      const profile = await localApi.getProfile()
      const existing = await posService.getCurrentSession()
      if (existing) throw new Error('Une session de caisse est deja ouverte')
      return localApi.mutate('insert', 'cash_sessions', { opened_by: profile.id, opening_amount: input.opening_amount, notes: input.notes ?? null })
    }
    // Opening a register is a protected server operation.  This avoids relying
    // on browser-side RLS details and gives the cashier an actionable error.
    const { data, error } = await getSupabaseClient().rpc('open_cash_session', {
      p_opening_amount: input.opening_amount,
      p_notes: input.notes?.trim() || null,
    })
    if (error) throw error
    return data
  },

  closeSession: async (closingAmount: number, notes?: string) => {
    const session = await posService.getCurrentSession()
    if (!session) throw new Error('Aucune session de caisse ouverte')
    const sessionId = (session as { id: string }).id
    const sessionNotes = (session as { notes?: string | null }).notes
    if (isLocalDbConfigured) return localApi.mutate('update', 'cash_sessions', { closed_at: new Date().toISOString(), closing_amount: closingAmount, notes: notes || sessionNotes || null }, sessionId)
    const { data, error } = await getSupabaseClient().rpc('close_cash_session', {
      p_closing_amount: closingAmount,
      p_notes: notes?.trim() || sessionNotes || null,
    })
    if (error) throw error
    return data
  },

  getSessionSales: async () => {
    const session = await posService.getCurrentSession()
    if (!session) return { data: [], error: null }
    if (isLocalDbConfigured) {
      const profile = await localApi.getProfile()
      const rows = await localApi.query('select s.*, c.full_name as customer_name from sales s left join customers c on c.id = s.customer_id where s.created_by = ? and s.sold_at >= ? order by s.sold_at desc', [profile.id, (session as { opened_at: string }).opened_at])
      return { data: rows, error: null }
    }
    const { data: { user } } = await getSupabaseClient().auth.getUser()
    if (!user) return { data: [], error: null }
    return salesTable()
      .select('*, customer:customers(full_name)')
      .eq('created_by', user.id)
      .gte('sold_at', (session as { opened_at: string }).opened_at)
      .order('sold_at', { ascending: false })
  },

  createSale: async (input: SaleInput) => {
    if (!input.items.length) throw new Error('Le panier est vide')
    if (!input.payments.length) throw new Error('Au moins un paiement est requis')

    // The RPC is one PostgreSQL transaction. Product prices, permissions,
    // payment totals and stock changes are validated server-side.
    if (isLocalDbConfigured) return localApi.rpc('complete_sale', {
      customer_id: input.customer_id,
      items: input.items.map(({ productId, quantity, discount, taxRate }) => ({ product_id: productId, quantity, discount_amount: discount, tax_amount: taxRate })),
      payments: input.payments,
      notes: input.notes?.trim() || null,
    })
    // Offline-first: persist the sale before any network request, then sync in background.
    const localSale = await enqueueSale(input)
    void syncPendingSales()
    return { id: localSale.clientSaleId, sale_number: `LOCAL-${localSale.clientSaleId.slice(0, 8)}`, sync_state: localSale.state }
  },

  findProductByBarcode: async (barcode: string) => isLocalDbConfigured ? localApi.query('select id, barcode, name, unit, selling_price, stock_quantity from products where barcode = ? and active = 1', [barcode]).then((rows) => ({ data: rows[0] ?? null, error: null })) : getSupabaseClient()
    .from('products')
    .select('id, barcode, name, unit, selling_price, stock_quantity, category:categories(name)')
    .eq('barcode', barcode)
    .eq('active', true)
    .maybeSingle(),

  calculateCartTotals: (items: CartItem[]) => {
    const subtotal = items.reduce((sum, item) => sum + item.quantity * item.unitPrice, 0)
    const totalDiscount = items.reduce((sum, item) => sum + item.discount, 0)
    const totalTax = items.reduce((sum, item) => sum + item.taxRate, 0)
    return { subtotal, totalDiscount, totalTax, totalAmount: subtotal - totalDiscount + totalTax }
  },

  getTodaySales: async () => {
    const today = new Date().toISOString().split('T')[0]
    if (isLocalDbConfigured) return localApi.query('select s.*, c.full_name as customer_name from sales s left join customers c on c.id = s.customer_id where s.sold_at >= ? order by s.sold_at desc', [today]).then((data) => ({ data, error: null }))
    return salesTable()
      .select('*, customer:customers(full_name), items:sale_items(*)')
      .gte('sold_at', today)
      .order('sold_at', { ascending: false })
  },
}
