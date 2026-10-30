import { getSupabaseClient, isLocalDbConfigured } from '../lib/supabase'
import { localApi } from '../lib/localApi'
import type { StockMovementInput } from '../types/stock'
import type { Product } from '../types/catalog'
import { withOffline } from '../lib/offline/wrap'
import { byText, getSnapshot, matches, paginate, patchRow, patchSnapshot } from '../lib/offline/snapshot'
import { isLowStock } from './productService'
export type StockFilters = { search?: string; categoryId?: string; supplierId?: string; status?: 'all' | 'in_stock' | 'low_stock' | 'out_of_stock' }
const service = {
  getStock: async (page: number, filters: StockFilters) => { if (isLocalDbConfigured) { const conditions = ['p.active = 1']; const params: unknown[] = []; if (filters.search?.trim()) { const term = `%${filters.search.trim()}%`; conditions.push('(p.name like ? or p.barcode like ? or p.brand like ?)'); params.push(term, term, term) } if (filters.categoryId) { conditions.push('p.category_id = ?'); params.push(filters.categoryId) } if (filters.supplierId) { conditions.push('p.supplier_id = ?'); params.push(filters.supplierId) } if (filters.status === 'out_of_stock') conditions.push('p.stock_quantity = 0'); if (filters.status === 'low_stock') conditions.push('p.stock_quantity > 0 and p.stock_quantity <= p.minimum_stock'); if (filters.status === 'in_stock') conditions.push('p.stock_quantity > p.minimum_stock'); const where = conditions.join(' and '); try { const data = await localApi.query<any>(`select p.*, c.name as category_name, s.name as supplier_name from products p left join categories c on c.id = p.category_id left join suppliers s on s.id = p.supplier_id where ${where} order by p.name limit 20 offset ?`, [...params, page * 20]); const count = await localApi.query<{ total: number }>(`select count(*) as total from products p where ${where}`, params); return { data: data.map(({ category_name, supplier_name, ...row }) => ({ ...row, category: category_name ? { name: category_name } : null, supplier: supplier_name ? { name: supplier_name } : null })), error: null, count: Number(count[0]?.total ?? 0) } } catch (error) { return { data: null, error: error instanceof Error ? error : new Error('Erreur de stock'), count: null } } } let query = getSupabaseClient().from('products').select('id, barcode, name, brand, stock_quantity, minimum_stock, unit, purchase_price, selling_price, category:categories(name), supplier:suppliers(name)', { count: 'exact' }).eq('active', true); if (filters.search?.trim()) query = query.or(`name.ilike.%${filters.search}%,barcode.ilike.%${filters.search}%,brand.ilike.%${filters.search}%`); if (filters.categoryId) query = query.eq('category_id', filters.categoryId); if (filters.supplierId) query = query.eq('supplier_id', filters.supplierId); if (filters.status === 'out_of_stock') query = query.eq('stock_quantity', 0); if (filters.status === 'low_stock') query = query.eq('is_low_stock', true); if (filters.status === 'in_stock') query = query.gt('stock_quantity', 0).eq('is_low_stock', false); return query.order('name').range(page * 20, page * 20 + 19) },
  getProductStock: async (id: string) => isLocalDbConfigured ? localApi.query('select id, name, stock_quantity, minimum_stock, unit from products where id = ?', [id]).then((rows) => ({ data: rows[0] ?? null, error: null })) : getSupabaseClient().from('products').select('id, name, stock_quantity, minimum_stock, unit').eq('id', id).single(),
  createMovement: async (input: StockMovementInput) => isLocalDbConfigured ? localApi.rpc<Record<string, unknown>>('record_stock_movement', input).then((data) => ({ data, error: null })).catch((error) => ({ data: null, error: error instanceof Error ? error : new Error('Erreur de mouvement') })) : getSupabaseClient().rpc('record_stock_movement', { p_product_id: input.product_id, p_movement_type: input.movement_type, p_quantity: input.quantity, p_reason: input.reason, p_supplier_id: input.supplier_id ?? null, p_purchase_price: input.purchase_price ?? null, p_reference_type: input.reference_type ?? null, p_reference_id: input.reference_id ?? null, p_movement_at: input.movement_at ?? new Date().toISOString() }),
  getLowStockProducts: async () => isLocalDbConfigured ? localApi.query('select * from products where active = 1 and stock_quantity > 0 and stock_quantity <= minimum_stock').then((data) => ({ data, count: data.length, error: null })) : getSupabaseClient().from('products').select('*', { count: 'exact', head: true }).eq('active', true).eq('is_low_stock', true),
  getOutOfStockProducts: async () => isLocalDbConfigured ? localApi.query('select * from products where active = 1 and stock_quantity = 0').then((data) => ({ data, count: data.length, error: null })) : getSupabaseClient().from('products').select('*', { count: 'exact', head: true }).eq('active', true).eq('stock_quantity', 0),
}

const activeProducts = async () => (await getSnapshot<Product>('products'))?.filter((product) => product.active)

async function offlineStock(page: number, filters: StockFilters) {
  const rows = await activeProducts()
  if (!rows) return undefined
  return paginate(rows.filter((product) =>
    matches(filters.search, product.name, product.barcode, product.brand)
    && (!filters.categoryId || product.category_id === filters.categoryId)
    && (!filters.supplierId || product.supplier_id === filters.supplierId)
    && (filters.status !== 'out_of_stock' || Number(product.stock_quantity) === 0)
    && (filters.status !== 'low_stock' || isLowStock(product))
    && (filters.status !== 'in_stock' || (Number(product.stock_quantity) > 0 && !isLowStock(product))),
  ).sort(byText('name')), page)
}

const countWhere = async (predicate: (product: Product) => boolean) => {
  const rows = await activeProducts()
  if (!rows) return undefined
  const data = rows.filter(predicate)
  return { data, count: data.length, error: null }
}

/** Mirrors record_stock_movement: exits and supplier returns subtract, adjustments are signed. */
export const stockDelta = (type: StockMovementInput['movement_type'], quantity: number) => ['exit', 'supplier_return'].includes(type) ? -Math.abs(quantity) : quantity

export const stockService = withOffline('stock', service, {
  reads: {
    getStock: { fallback: offlineStock },
    getProductStock: { fallback: async (id: string) => { const row = (await getSnapshot<Product>('products'))?.find((product) => product.id === id); return row && { data: row, error: null } } },
    getLowStockProducts: { fallback: () => countWhere(isLowStock) },
    getOutOfStockProducts: { fallback: () => countWhere((product) => Number(product.stock_quantity) === 0) },
  },
  writes: {
    createMovement: { label: (input: StockMovementInput) => `Mouvement de stock (${input.movement_type}, ${input.quantity})`, optimistic: async (_tempId: string, input: StockMovementInput) => {
      const product = (await getSnapshot<Product>('products'))?.find((item) => item.id === input.product_id)
      const newStock = Number(product?.stock_quantity ?? 0) + stockDelta(input.movement_type, Number(input.quantity))
      if (newStock < 0) throw new Error('Stock insuffisant pour ce mouvement')
      await patchSnapshot<Product>('products', (rows) => patchRow(rows, input.product_id, { stock_quantity: newStock }))
      return { ...input, old_stock: product?.stock_quantity ?? 0, new_stock: newStock }
    } },
  },
})
