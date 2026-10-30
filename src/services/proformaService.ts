import { getSessionUser, getSupabaseClient, isLocalDbConfigured } from '../lib/supabase'
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

export type ProformaStatus = 'draft' | 'sent' | 'accepted' | 'cancelled' | 'expired'

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
    return getSupabaseClient().from('proformas').select('*, customer:customers(full_name), items:proforma_items(*)').order('created_at', { ascending: false })
  },
  create: async (input: ProformaInput) => {
    if (isLocalDbConfigured) return localApi.rpc('create_proforma', input)
    const client = getSupabaseClient()
    const user = await getSessionUser()
    if (!user) throw new Error('Non authentifié')
    const subtotal = input.items.reduce((sum, item) => sum + item.quantity * item.unit_price, 0)
    const discount = input.items.reduce((sum, item) => sum + (item.discount_amount ?? 0), 0)
    const tax = input.items.reduce((sum, item) => sum + (item.tax_amount ?? 0), 0)
    const { data, error } = await client.from('proformas').insert({ customer_id: input.customer_id, valid_until: input.valid_until, notes: input.notes?.trim() || null, subtotal, discount_amount: discount, tax_amount: tax, total_amount: subtotal - discount + tax, created_by: user.id }).select().single()
    if (error) throw error
    const proforma = data as { id: string }
    const { error: itemsError } = await client.from('proforma_items').insert(input.items.map((item) => ({ ...item, proforma_id: proforma.id, discount_amount: item.discount_amount ?? 0, tax_amount: item.tax_amount ?? 0, line_total: item.quantity * item.unit_price - (item.discount_amount ?? 0) + (item.tax_amount ?? 0) })))
    if (itemsError) throw itemsError
    return data
  },
  updateStatus: async (id: string, status: ProformaStatus) => isLocalDbConfigured
    ? localApi.rpc('update_proforma_status', { id, status })
    : getSupabaseClient().from('proformas').update({ status }).eq('id', id),
}

export const proformaService = withOffline('proformas', service, {
  throws: ['create'],
  reads: { list: true },
  writes: {
    create: { label: 'Nouvelle proforma', createsId: true, optimistic: (id: string, input: ProformaInput) => {
      const subtotal = input.items.reduce((sum, item) => sum + item.quantity * item.unit_price, 0)
      const discount = input.items.reduce((sum, item) => sum + (item.discount_amount ?? 0), 0)
      const tax = input.items.reduce((sum, item) => sum + (item.tax_amount ?? 0), 0)
      return { id, ...input, status: 'draft', subtotal, discount_amount: discount, tax_amount: tax, total_amount: subtotal - discount + tax, created_at: new Date().toISOString() }
    } },
    updateStatus: { label: (_id: string, status: ProformaStatus) => `Statut de proforma : ${status}` },
  },
})
