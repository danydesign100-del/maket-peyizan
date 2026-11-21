import { getSupabaseClient, isLocalDbConfigured } from '../lib/supabase'
import { localApi } from '../lib/localApi'
import { withOffline } from '../lib/offline/wrap'

export type ProformaItemInput = {
  product_id: string
  description: string
  quantity: number
  unit_price: number
  discount_amount?: number
  tax_amount?: number
}

export type ProformaInput = {
  customer_id: string | null
  valid_until: string | null
  notes?: string
  items: ProformaItemInput[]
}

export type ProformaStatus = 'draft' | 'sent' | 'accepted' | 'cancelled' | 'expired' | 'converted'
export const PROFORMA_STATUS_LABELS: Record<ProformaStatus, string> = { draft: 'Brouillon', sent: 'Envoyée', accepted: 'Acceptée', cancelled: 'Annulée', expired: 'Expirée', converted: 'Transformée en vente' }
export type ProformaLine = { product_id: string; description: string; quantity: number; unit_price: number; discount_amount: number; line_total: number }
export type Proforma = {
  id: string; proforma_number: string; status: ProformaStatus; issue_date: string; valid_until: string | null; notes: string | null; revision?: number
  subtotal: number; discount_amount: number; tax_amount: number; total_amount: number; created_at: string; customer_id: string | null; converted_sale_id?: string | null
  customer?: { full_name: string; phone: string | null; email: string | null; address: string | null; company_name: string | null; tax_id: string | null } | null
  creator?: { full_name: string } | null; items: ProformaLine[]
}
export type ProformaHistory = { id: string; revision: number; action: 'created' | 'updated' | 'status' | 'converted'; status: string | null; note: string | null; changed_at: string; snapshot: { total_amount: number; items: ProformaLine[] }; author?: { full_name: string } | null }
/** Editor lines: price optional (catalogue price), discount in HTG. */
export type ProformaSaveInput = { customer_id: string | null; valid_until: string | null; notes: string; items: { product_id: string; quantity: number; unit_price?: number | null; discount_amount?: number }[]; note?: string }

const localList = () => localApi.query<any>(`
  select p.*, c.full_name as customer_name
  from proformas p left join customers c on c.id = p.customer_id
  order by p.created_at desc
`).then(async (rows) => Promise.all(rows.map(async (row) => ({
  ...row,
  customer: row.customer_name ? { full_name: row.customer_name } : null,
  items: await localApi.query<any>('select * from proforma_items where proforma_id = ? order by created_at', [row.id]),
}))))

const service = {
  list: async () => {
    if (isLocalDbConfigured) {
      try { return { data: await localList(), error: null } } catch (error) { return { data: null, error: error instanceof Error ? error : new Error('Erreur de chargement') } }
    }
    return getSupabaseClient().from('proformas').select('*, customer:customers(full_name, phone, email, address, company_name, tax_id), creator:profiles!proformas_created_by_fkey(full_name), items:proforma_items(*)').order('created_at', { ascending: false })
  },

  /** Versions of a proforma (creation, each change, status, conversion). */
  history: async (id: string) => isLocalDbConfigured
    ? { data: [] as ProformaHistory[], error: null }
    : getSupabaseClient().from('proforma_history').select('*, author:profiles!proforma_history_changed_by_fkey(full_name)').eq('proforma_id', id).order('changed_at', { ascending: false }),

  /** Creates (id null) or replaces a proforma in one transaction; totals and prices checked by the server. */
  save: async (id: string | null, input: ProformaSaveInput) => {
    if (isLocalDbConfigured) {
      if (id) throw new Error('La modification des proformas est disponible dans la version en ligne.')
      return localApi.rpc('create_proforma', { customer_id: input.customer_id, valid_until: input.valid_until, notes: input.notes, items: input.items.map((item) => ({ ...item, description: '', unit_price: item.unit_price ?? 0 })) })
    }
    const { data, error } = await getSupabaseClient().rpc('save_proforma', { p_id: id, p_customer_id: input.customer_id, p_valid_until: input.valid_until, p_notes: input.notes, p_items: input.items, p_note: input.note ?? null }).single()
    if (error) throw error
    return data
  },

  setStatus: async (id: string, status: ProformaStatus, note?: string) => {
    if (isLocalDbConfigured) return localApi.rpc('update_proforma_status', { id, status })
    const { data, error } = await getSupabaseClient().rpc('set_proforma_status', { p_id: id, p_status: status, p_note: note ?? null }).single()
    if (error) throw error
    return data
  },
  /** New proforma (queued offline); the server computes the totals in one transaction. */
  create: async (input: ProformaInput) => {
    if (isLocalDbConfigured) return localApi.rpc('create_proforma', input)
    const { data, error } = await getSupabaseClient().rpc('save_proforma', {
      p_id: null, p_customer_id: input.customer_id, p_valid_until: input.valid_until, p_notes: input.notes ?? '',
      p_items: input.items.map((item) => ({ product_id: item.product_id, quantity: item.quantity, unit_price: item.unit_price, discount_amount: item.discount_amount ?? 0 })), p_note: null,
    }).single()
    if (error) throw error
    return data
  },

}

export const proformaService = withOffline('proformas', service, {
  writes: {
    create: { label: 'Nouvelle proforma', createsId: true, optimistic: (id: string, input: ProformaInput) => {
      const subtotal = input.items.reduce((sum, item) => sum + item.quantity * item.unit_price, 0)
      const discount = input.items.reduce((sum, item) => sum + (item.discount_amount ?? 0), 0)
      const tax = input.items.reduce((sum, item) => sum + (item.tax_amount ?? 0), 0)
      return { id, ...input, status: 'draft', subtotal, discount_amount: discount, tax_amount: tax, total_amount: subtotal - discount + tax, created_at: new Date().toISOString() }
    } },
  },
  throws: ['create', 'save', 'setStatus'],
  reads: { list: true, history: true },
  onlineOnly: ['save', 'setStatus'],
})
