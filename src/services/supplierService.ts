import { getSupabaseClient, isLocalDbConfigured } from '../lib/supabase'
import { localApi } from '../lib/localApi'
import type { Supplier, SupplierInput } from '../types/stock'
import { withOffline } from '../lib/offline/wrap'
import { fetchAllRows } from '../lib/offline/fetchAll'
import { byText, getSnapshot, matches, paginate, patchRow, patchSnapshot, registerSnapshot, upsertRow } from '../lib/offline/snapshot'

const table = () => getSupabaseClient().from('suppliers')

export type SupplierProduct = { id: string; name: string; barcode: string | null; unit: string; stock_quantity: number; average_cost: number; selling_price: number; active: boolean }
export type SupplierDelivery = { id: string; movement_type: 'entry' | 'supplier_return'; quantity: number; purchase_price: number | null; movement_at: string; reason: string | null; product: { name: string; unit: string } | null }

const fromLocalRow = ({ category_name, ...row }: any): Supplier => ({ ...row, active: Boolean(row.active), category: category_name ? { name: category_name } : null })

const service = {
  getSuppliers: async (page: number, search = '', status: 'active' | 'inactive' | 'all' = 'active', categoryId = '') => {
    if (isLocalDbConfigured) {
      const conditions = ['1=1'];
      const params: unknown[] = [];
      if (status !== 'all') {
        conditions.push('s.active = ?');
        params.push(status === 'active' ? 1 : 0);
      }
      if (categoryId) {
        conditions.push('s.category_id = ?');
        params.push(categoryId);
      }
      if (search.trim()) {
        conditions.push('(s.name LIKE ? OR s.company_name LIKE ? OR s.phone LIKE ? OR s.email LIKE ?)');
        const term = `%${search.trim()}%`;
        params.push(term, term, term, term);
      }
      const where = conditions.join(' and ');
      const offset = page * 20;
      const rows = await localApi.query<any>(`select s.*, c.name as category_name from suppliers s left join supplier_categories c on c.id = s.category_id where ${where} order by s.name limit 20 offset ?`, [...params, offset]);
      const count = await localApi.query<{ total: number }>(`select count(*) as total from suppliers s where ${where}`, params);
      return { data: rows.map(fromLocalRow), error: null, count: Number(count[0]?.total ?? 0) };
    }
    let query = table().select('*, category:supplier_categories(name)', { count: 'exact' });
    if (status !== 'all') query = query.eq('active', status === 'active');
    if (categoryId) query = query.eq('category_id', categoryId);
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

  activateSupplier: async (id: string) => {
    if (isLocalDbConfigured) {
      return localApi.mutate('update', 'suppliers', { active: 1 }, id)
        .then(() => ({ error: null }))
        .catch((error) => ({ error }));
    }
    return table().update({ active: true }).eq('id', id);
  },

  /** Products supplied (their sheet names this supplier). */
  getSupplierProducts: async (id: string) => {
    if (isLocalDbConfigured) {
      return localApi.query<SupplierProduct>('select id, name, barcode, unit, stock_quantity, average_cost, selling_price, active from products where supplier_id = ? order by name', [id])
        .then((rows) => ({ data: rows.map((row) => ({ ...row, active: Boolean(row.active) })), error: null }))
        .catch((error) => ({ data: null, error }));
    }
    return getSupabaseClient().from('products').select('id, name, barcode, unit, stock_quantity, average_cost, selling_price, active').eq('supplier_id', id).order('name');
  },

  /** Latest deliveries and returns recorded with this supplier. */
  getSupplierDeliveries: async (id: string) => {
    if (isLocalDbConfigured) {
      return localApi.query<any>(`select m.id, m.movement_type, m.quantity, m.purchase_price, m.movement_at, m.reason, p.name as product_name, p.unit as product_unit
        from stock_movements m join products p on p.id = m.product_id where m.supplier_id = ? and m.movement_type in ('entry', 'supplier_return') order by m.movement_at desc limit 50`, [id])
        .then((rows) => ({ data: rows.map(({ product_name, product_unit, ...row }) => ({ ...row, product: { name: product_name, unit: product_unit } })) as SupplierDelivery[], error: null }))
        .catch((error) => ({ data: null, error }));
    }
    return getSupabaseClient().from('stock_movements').select('id, movement_type, quantity, purchase_price, movement_at, reason, product:products(name, unit)')
      .eq('supplier_id', id).in('movement_type', ['entry', 'supplier_return']).order('movement_at', { ascending: false }).limit(50);
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
    getSuppliers: { fallback: async (page: number, search = '', status: 'active' | 'inactive' | 'all' = 'active', categoryId = '') => {
      const rows = await getSnapshot<Supplier>('suppliers')
      return rows && paginate(rows.filter((supplier) => (status === 'all' || Boolean(supplier.active) === (status === 'active')) && (!categoryId || supplier.category_id === categoryId) && supplierMatches(supplier, search)).sort(byText('name')), page)
    } },
    getSupplierById: true,
    getSupplierProducts: { fallback: async (id: string) => {
      const rows = await getSnapshot<SupplierProduct & { supplier_id: string | null }>('products')
      return rows && { data: rows.filter((product) => product.supplier_id === id).sort(byText('name')), error: null }
    } },
    getSupplierDeliveries: true,
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
    activateSupplier: { label: 'Réactivation d’un fournisseur', optimistic: async (_tempId: string, id: string) => { await patchSnapshot<Supplier>('suppliers', (rows) => patchRow(rows, id, { active: true })); return null } },
  },
})

registerSnapshot('suppliers', async () => isLocalDbConfigured
  ? (await localApi.query<any>('select s.*, c.name as category_name from suppliers s left join supplier_categories c on c.id = s.category_id order by s.name')).map(fromLocalRow)
  : fetchAllRows<Supplier>('suppliers', '*, category:supplier_categories(name)', 'name'))

export type { Supplier }
