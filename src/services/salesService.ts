import { getSupabaseClient, isLocalDbConfigured } from '../lib/supabase'
import { localApi } from '../lib/localApi'
import { withOffline } from '../lib/offline/wrap'
const service = {
  listMine: async () => isLocalDbConfigured
    ? localApi.getProfile().then((profile) => localApi.query<Record<string, any>>('select s.*, c.full_name as customer_name from sales s left join customers c on c.id = s.customer_id where s.created_by = ? order by s.sold_at desc', [profile.id])).then((rows) => ({ data: rows.map((sale) => ({ ...sale, accounting_synced: Boolean(sale.accounting_synced), customer: sale.customer_name ? { full_name: sale.customer_name } : null })), error: null }))
    : getSupabaseClient().from('sales').select('*, customer:customers(full_name), items:sale_items(*)').order('sold_at', { ascending: false }),
  listAll: async () => isLocalDbConfigured
    ? localApi.query<Record<string, any>>('select s.*, c.full_name as customer_name from sales s left join customers c on c.id = s.customer_id order by s.sold_at desc').then((rows) => ({ data: rows.map((sale) => ({ ...sale, accounting_synced: Boolean(sale.accounting_synced), customer: sale.customer_name ? { full_name: sale.customer_name } : null })), error: null }))
    : getSupabaseClient().from('sales').select('*, customer:customers(full_name), items:sale_items(*)').order('sold_at', { ascending: false }),
}
export const salesService = withOffline('sales', service, { reads: { listMine: true, listAll: true } })
