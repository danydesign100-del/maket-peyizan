import { getSupabaseClient, isLocalDbConfigured } from '../lib/supabase'
import { localApi } from '../lib/localApi'
import type { Customer, CustomerInput } from '../types/catalog'
const table = () => getSupabaseClient().from('customers')
const fail = (error: unknown) => error instanceof Error ? error : new Error('Erreur de base locale')
export const customerService = {
  getCustomers: async (page: number, search = '', status: 'active' | 'inactive' | 'all' = 'active') => {
    if (isLocalDbConfigured) try { const where = status === 'all' ? '' : `and active = ${status === 'active' ? 1 : 0}`; const term = `%${search.trim()}%`; const rows = await localApi.query<Customer>(`select * from customers where (? = '' or full_name like ? or phone like ? or email like ? or customer_number like ?) ${where} order by full_name limit 20 offset ?`, [search.trim(), term, term, term, term, page * 20]); const count = await localApi.query<{ total: number }>(`select count(*) as total from customers where (? = '' or full_name like ? or phone like ? or email like ? or customer_number like ?) ${where}`, [search.trim(), term, term, term, term]); return { data: rows.map((row) => ({ ...row, active: Boolean(row.active) })), error: null, count: Number(count[0]?.total ?? 0) } } catch (error) { return { data: null, error: fail(error), count: null } }
    const from = page * 20; let query = table().select('*', { count: 'exact' }); if (status !== 'all') query = query.eq('active', status === 'active'); if (search.trim()) query = query.or(`full_name.ilike.%${search.trim()}%,phone.ilike.%${search.trim()}%,email.ilike.%${search.trim()}%,customer_number.ilike.%${search.trim()}%`); return query.order('full_name').range(from, from + 19)
  },
  getCustomerById: async (id: string) => isLocalDbConfigured ? { data: (await localApi.query<Customer>('select * from customers where id = ?', [id]))[0] ?? null, error: null } : table().select('*').eq('id', id).single(),
  createCustomer: async (input: CustomerInput) => isLocalDbConfigured ? localApi.mutate<Customer>('insert', 'customers', { ...input, active: 1, customer_number: `CL-${Date.now().toString().slice(-6)}` }).then((data) => ({ data, error: null })).catch((error) => ({ data: null, error: fail(error) })) : table().insert(input).select().single(),
  updateCustomer: async (id: string, input: Partial<CustomerInput>) => isLocalDbConfigured ? localApi.mutate<Customer>('update', 'customers', input, id).then((data) => ({ data, error: null })).catch((error) => ({ data: null, error: fail(error) })) : table().update(input).eq('id', id).select().single(),
  deactivateCustomer: async (id: string) => isLocalDbConfigured ? localApi.mutate<Customer>('update', 'customers', { active: 0 }, id).then((data) => ({ data, error: null })).catch((error) => ({ data: null, error: fail(error) })) : table().update({ active: false }).eq('id', id),
  searchCustomers: async (term: string) => {
    if (isLocalDbConfigured) {
      const search = term.trim()
      const like = `%${search}%`
      return localApi.query<Customer>('select * from customers where active = 1 and (? = \'\' or full_name like ? or phone like ? or email like ? or customer_number like ?) order by full_name limit 20', [search, like, like, like, like])
        .then((data) => ({ data: data.map((row) => ({ ...row, active: Boolean(row.active) })), error: null }))
        .catch((error) => ({ data: null, error: fail(error) }))
    }
    return table().select('*').or(`full_name.ilike.%${term}%,phone.ilike.%${term}%,email.ilike.%${term}%,customer_number.ilike.%${term}%`).limit(20)
  },
}
export type { Customer }
