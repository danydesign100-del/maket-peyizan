import { getSupabaseClient, isLocalDbConfigured } from '../lib/supabase'
import { localApi } from '../lib/localApi'
import type { Supplier, SupplierInput } from '../types/stock'
import { withOffline } from '../lib/offline/wrap'
import { fetchAllRows } from '../lib/offline/fetchAll'
import { byText, getSnapshot, matches, paginate, patchRow, patchSnapshot, registerSnapshot, upsertRow } from '../lib/offline/snapshot'

const table = () => getSupabaseClient().from('suppliers')

const service = {
  getSuppliers: async (page: number, search = '', status: 'active' | 'inactive' | 'all' = 'active') => {
    if (isLocalDbConfigured) {
      const conditions = ['1=1'];
      const params: unknown[] = [];
      if (status !== 'all') {
        conditions.push('active = ?');
        params.push(status === 'active' ? 1 : 0);
      }
      if (search.trim()) {
        conditions.push('(name LIKE ? OR company_name LIKE ? OR phone LIKE ? OR email LIKE ?)');
        const term = `%${search.trim()}%`;
        params.push(term, term, term, term);
      }
      const where = conditions.join(' and ');
      const offset = page * 20;
      const rows = await localApi.query<any>(`select * from suppliers where ${where} order by name limit 20 offset ?`, [...params, offset]);
      const count = await localApi.query<{ total: number }>(`select count(*) as total from suppliers where ${where}`, params);
      return { data: rows, error: null, count: Number(count[0]?.total ?? 0) };
    }
    let query = table().select('*', { count: 'exact' });
    if (status !== 'all') query = query.eq('active', status === 'active');
    if (search.trim()) query = query.or(`name.ilike.%${search.trim()}%,company_name.ilike.%${search.trim()}%,phone.ilike.%${search.trim()}%,email.ilike.%${search.trim()}%`);
    return query.order('name').range(page * 20, page * 20 + 19);
  },

  getSupplierById: async (id: string) => {
    if (isLocalDbConfigured) {
      const rows = await localApi.query<any>('select * from suppliers where id = ?', [id]);
      return rows[0] ?? null;
    }
    return table().select('*').eq('id', id).single();
  },

  createSupplier: async (input: SupplierInput) => {
    if (isLocalDbConfigured) {
      return localApi.mutate('insert', 'suppliers', input)
        .then((data) => ({ data, error: null }))
        .catch((error) => ({ data: null, error }));
    }
    return table().insert(input).select().single();
  },

  updateSupplier: async (id: string, input: Partial<SupplierInput>) => {
    if (isLocalDbConfigured) {
      return localApi.mutate('update', 'suppliers', input, id)
        .then((data) => ({ data, error: null }))
        .catch((error) => ({ data: null, error }));
    }
    return table().update(input).eq('id', id).select().single();
  },

  deactivateSupplier: async (id: string) => {
    if (isLocalDbConfigured) {
      return localApi.mutate('update', 'suppliers', { active: 0 }, id)
        .then(() => ({ error: null }))
        .catch((error) => ({ error }));
    }
    return table().update({ active: false }).eq('id', id);
  },

  searchSuppliers: async (term: string) => {
    if (isLocalDbConfigured) {
      const searchTerm = `%${term}%`;
      const rows = await localApi.query<any>(
        'select id, name from suppliers where active = 1 and (name LIKE ? OR company_name LIKE ? OR phone LIKE ? OR email LIKE ?) limit 20',
        [searchTerm, searchTerm, searchTerm, searchTerm]
      );
      return { data: rows, error: null };
    }
    return table().select('id, name').eq('active', true).or(`name.ilike.%${term}%,company_name.ilike.%${term}%,phone.ilike.%${term}%,email.ilike.%${term}%`).limit(20);
  },
}

const supplierMatches = (supplier: Supplier, term: string) => matches(term, supplier.name, supplier.company_name, supplier.phone, supplier.email)

export const supplierService = withOffline('suppliers', service, {
  reads: {
    getSuppliers: { fallback: async (page: number, search = '', status: 'active' | 'inactive' | 'all' = 'active') => {
      const rows = await getSnapshot<Supplier>('suppliers')
      return rows && paginate(rows.filter((supplier) => (status === 'all' || Boolean(supplier.active) === (status === 'active')) && supplierMatches(supplier, search)).sort(byText('name')), page)
    } },
    getSupplierById: true,
    searchSuppliers: { fallback: async (term: string) => {
      const rows = await getSnapshot<Supplier>('suppliers')
      return rows && { data: rows.filter((supplier) => supplier.active && supplierMatches(supplier, term)).slice(0, 20).map(({ id, name }) => ({ id, name })), error: null }
    } },
  },
  writes: {
    createSupplier: { label: (input: SupplierInput) => `Nouveau fournisseur « ${input.name} »`, createsId: true, optimistic: async (id: string, input: SupplierInput) => {
      const now = new Date().toISOString()
      const row = { ...input, id, active: true, created_at: now, updated_at: now } as Supplier
      await patchSnapshot<Supplier>('suppliers', (rows) => upsertRow(rows, row)); return row
    } },
    updateSupplier: { label: (_id: string, input: Partial<SupplierInput>) => `Modification du fournisseur${input.name ? ` « ${input.name} »` : ''}`, optimistic: async (_tempId: string, id: string, input: Partial<SupplierInput>) => { await patchSnapshot<Supplier>('suppliers', (rows) => patchRow<Supplier>(rows, id, input as Partial<Supplier>)); return { id, ...input } } },
    deactivateSupplier: { label: 'Désactivation d’un fournisseur', optimistic: async (_tempId: string, id: string) => { await patchSnapshot<Supplier>('suppliers', (rows) => patchRow(rows, id, { active: false })); return null } },
  },
})

registerSnapshot('suppliers', async () => isLocalDbConfigured
  ? (await localApi.query<Supplier>('select * from suppliers order by name')).map((row) => ({ ...row, active: Boolean(row.active) }))
  : fetchAllRows<Supplier>('suppliers', '*', 'name'))

export type { Supplier }
