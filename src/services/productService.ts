import { getSupabaseClient, isLocalDbConfigured } from '../lib/supabase'
import { localApi } from '../lib/localApi'
import type { Category, Product, ProductInput } from '../types/catalog'
import type { Supplier } from '../types/stock'
import { withOffline } from '../lib/offline/wrap'
import { fetchAllRows } from '../lib/offline/fetchAll'
import { byText, getSnapshot, matches, paginate, patchRow, patchSnapshot, registerSnapshot, upsertRow } from '../lib/offline/snapshot'

const table = () => getSupabaseClient().from('products')

export type ProductFilters = {
  search?: string
  categoryId?: string
  status?: 'active' | 'inactive' | 'all'
  stock?: 'all' | 'low' | 'out'
}

type LocalProductRow = Product & { category_name: string | null; supplier_name: string | null }

function localError(cause: unknown) {
  return cause instanceof Error ? cause : new Error('Erreur de base locale')
}

function fromLocalRow({ category_name, supplier_name, ...product }: LocalProductRow): Product {
  return {
    ...product,
    active: Boolean(product.active),
    category: category_name ? { name: category_name } : null,
    supplier: supplier_name ? { name: supplier_name } : null,
  }
}

const service = {
  getProducts: async (page: number, filters: ProductFilters) => {
    if (isLocalDbConfigured) {
      try {
        const conditions = ['1=1']
        const params: unknown[] = []
        if (filters.status && filters.status !== 'all') {
          conditions.push('p.active = ?')
          params.push(filters.status === 'active' ? 1 : 0)
        }
        if (filters.categoryId) {
          conditions.push('p.category_id = ?')
          params.push(filters.categoryId)
        }
        if (filters.search?.trim()) {
          const term = `%${filters.search.trim()}%`
          conditions.push('(p.name like ? or p.barcode like ? or p.brand like ?)')
          params.push(term, term, term)
        }
        if (filters.stock === 'out') conditions.push('p.stock_quantity = 0')
        if (filters.stock === 'low') conditions.push('p.stock_quantity > 0 and p.stock_quantity <= p.minimum_stock')

        const where = conditions.join(' and ')
        const rows = await localApi.query<LocalProductRow>(`
          select p.*, c.name as category_name, s.name as supplier_name
          from products p
          left join categories c on c.id = p.category_id
          left join suppliers s on s.id = p.supplier_id
          where ${where}
          order by p.name
          limit 20 offset ?
        `, [...params, page * 20])
        const count = await localApi.query<{ total: number }>(`select count(*) as total from products p where ${where}`, params)
        return { data: rows.map(fromLocalRow), error: null, count: Number(count[0]?.total ?? 0) }
      } catch (cause) {
        return { data: null, error: localError(cause), count: null }
      }
    }

    const from = page * 20
    let query = table().select('*, category:categories(name), supplier:suppliers(name)', { count: 'exact' })
    if (filters.status && filters.status !== 'all') query = query.eq('active', filters.status === 'active')
    if (filters.categoryId) query = query.eq('category_id', filters.categoryId)
    if (filters.search?.trim()) query = query.or(`name.ilike.%${filters.search.trim()}%,barcode.ilike.%${filters.search.trim()}%,brand.ilike.%${filters.search.trim()}%`)
    if (filters.stock === 'out') query = query.eq('stock_quantity', 0)
    if (filters.stock === 'low') query = query.eq('is_low_stock', true)
    return query.order('name').range(from, from + 19)
  },

  getProductById: async (id: string) => {
    if (isLocalDbConfigured) {
      try {
        const rows = await localApi.query<LocalProductRow>(`
          select p.*, c.name as category_name, s.name as supplier_name
          from products p
          left join categories c on c.id = p.category_id
          left join suppliers s on s.id = p.supplier_id
          where p.id = ?
        `, [id])
        return { data: rows[0] ? fromLocalRow(rows[0]) : null, error: null }
      } catch (cause) {
        return { data: null, error: localError(cause) }
      }
    }
    return table().select('*').eq('id', id).single()
  },

  createProduct: async (input: ProductInput) => {
    if (isLocalDbConfigured) {
      // Initial stock is recorded through record_stock_movement so that an
      // auditable movement exists; it must not be written directly here.
      const { stock_quantity: _stockQuantity, ...values } = input
      return localApi.mutate<Product>('insert', 'products', { ...values, active: 1 })
        .then((data) => ({ data, error: null }))
        .catch((cause) => ({ data: null, error: localError(cause) }))
    }
    return table().insert(input).select().single()
  },

  updateProduct: async (id: string, input: Partial<ProductInput>) => isLocalDbConfigured
    ? localApi.mutate<Product>('update', 'products', input, id).then((data) => ({ data, error: null })).catch((cause) => ({ data: null, error: localError(cause) }))
    : table().update(input).eq('id', id).select().single(),

  deactivateProduct: async (id: string) => {
    if (isLocalDbConfigured) {
      try {
        await localApi.mutate('update', 'products', { active: 0 }, id)
        return { error: null }
      } catch (cause) {
        return { error: localError(cause) }
      }
    }
    const { error } = await table().update({ active: false }).eq('id', id)
    return { error }
  },

  activateProduct: async (id: string) => {
    if (isLocalDbConfigured) {
      try {
        await localApi.mutate('update', 'products', { active: 1 }, id)
        return { error: null }
      } catch (cause) {
        return { error: localError(cause) }
      }
    }
    const { error } = await table().update({ active: true }).eq('id', id)
    return { error }
  },

  setProductActive: async (id: string, active: boolean) => isLocalDbConfigured
    ? localApi.mutate<Product>('update', 'products', { active: active ? 1 : 0 }, id).then(() => ({ error: null })).catch((cause) => ({ error: localError(cause) }))
    : table().update({ active }).eq('id', id),

  findByBarcode: async (barcode: string) => {
    if (isLocalDbConfigured) {
      try {
        const rows = await localApi.query<LocalProductRow>(`
          select p.*, c.name as category_name, s.name as supplier_name
          from products p
          left join categories c on c.id = p.category_id
          left join suppliers s on s.id = p.supplier_id
          where p.barcode = ? and p.active = 1
        `, [barcode])
        return { data: rows[0] ? fromLocalRow(rows[0]) : null, error: null }
      } catch (cause) {
        return { data: null, error: localError(cause) }
      }
    }
    return table().select('*, category:categories(name), supplier:suppliers(name)').eq('barcode', barcode).maybeSingle()
  },

  getSuppliers: async () => isLocalDbConfigured
    ? localApi.query<{ id: string; name: string }>('select id, name from suppliers where active = 1 order by name').then((data) => ({ data, error: null })).catch((cause) => ({ data: null, error: localError(cause) }))
    : getSupabaseClient().from('suppliers').select('id, name').eq('active', true).order('name'),

  uploadImage: async (file: File) => {
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) throw new Error('Format image non pris en charge.')
    if (file.size > 5 * 1024 * 1024) throw new Error('L’image ne doit pas dépasser 5 Mo.')

    if (isLocalDbConfigured) {
      return new Promise<string>((resolve, reject) => {
        const reader = new FileReader()
        reader.onload = () => typeof reader.result === 'string' ? resolve(reader.result) : reject(new Error('Lecture de l’image impossible.'))
        reader.onerror = () => reject(reader.error ?? new Error('Lecture de l’image impossible.'))
        reader.readAsDataURL(file)
      })
    }

    const extension = file.name.split('.').pop()?.toLowerCase() || 'jpg'
    const path = `${crypto.randomUUID()}.${extension}`
    const client = getSupabaseClient()
    const { error } = await client.storage.from('product-images').upload(path, file, { upsert: false, contentType: file.type })
    if (error) throw error
    return client.storage.from('product-images').getPublicUrl(path).data.publicUrl
  },
}

export const isLowStock = (product: Product & { is_low_stock?: boolean }) => product.is_low_stock ?? (Number(product.stock_quantity) > 0 && Number(product.stock_quantity) <= Number(product.minimum_stock))
const findProduct = async (predicate: (product: Product) => boolean) => (await getSnapshot<Product>('products'))?.find(predicate)

async function offlineProducts(page: number, filters: ProductFilters) {
  const rows = await getSnapshot<Product>('products')
  if (!rows) return undefined
  return paginate(rows.filter((product) =>
    (!filters.status || filters.status === 'all' || product.active === (filters.status === 'active'))
    && (!filters.categoryId || product.category_id === filters.categoryId)
    && matches(filters.search, product.name, product.barcode, product.brand)
    && (filters.stock !== 'out' || Number(product.stock_quantity) === 0)
    && (filters.stock !== 'low' || isLowStock(product)),
  ).sort(byText('name')), page)
}

async function withRelations(product: Product): Promise<Product> {
  const [categories, suppliers] = await Promise.all([getSnapshot<Category>('categories'), getSnapshot<Supplier>('suppliers')])
  const category = categories?.find((item) => item.id === product.category_id)
  const supplier = suppliers?.find((item) => item.id === product.supplier_id)
  return { ...product, category: category ? { name: category.name } : null, supplier: supplier ? { name: supplier.name } : null }
}

const setActive = async (id: string, active: boolean) => { await patchSnapshot<Product>('products', (rows) => patchRow(rows, id, { active })); return { error: null } }

export const productService = withOffline('products', service, {
  throws: ['uploadImage'],
  reads: {
    getProducts: { fallback: offlineProducts },
    getProductById: { fallback: async (id: string) => { const row = await findProduct((product) => product.id === id); return row && { data: row, error: null } } },
    findByBarcode: { fallback: async (barcode: string) => { const rows = await getSnapshot<Product>('products'); return rows && { data: rows.find((product) => product.barcode === barcode && product.active) ?? null, error: null } } },
    getSuppliers: { fallback: async () => { const rows = await getSnapshot<Supplier>('suppliers'); return rows && { data: rows.filter((supplier) => supplier.active).map(({ id, name }) => ({ id, name })).sort(byText('name')), error: null } } },
  },
  writes: {
    createProduct: { label: (input: ProductInput) => `Nouveau produit « ${input.name} »`, createsId: true, optimistic: async (id: string, input: ProductInput) => {
      const now = new Date().toISOString()
      const row = await withRelations({ image_url: null, ...input, id, active: true, created_at: now, updated_at: now } as Product)
      await patchSnapshot<Product>('products', (rows) => upsertRow(rows, row)); return row
    } },
    updateProduct: { label: (_id: string, input: Partial<ProductInput>) => `Modification du produit${input.name ? ` « ${input.name} »` : ''}`, optimistic: async (_tempId: string, id: string, input: Partial<ProductInput>) => {
      const current = await findProduct((product) => product.id === id)
      const row = await withRelations({ ...current, ...input, id } as Product)
      await patchSnapshot<Product>('products', (rows) => upsertRow(rows, row)); return row
    } },
    deactivateProduct: { label: 'Désactivation d’un produit', optimistic: (_tempId: string, id: string) => setActive(id, false) },
    activateProduct: { label: 'Réactivation d’un produit', optimistic: (_tempId: string, id: string) => setActive(id, true) },
    setProductActive: { label: (_id: string, active: boolean) => active ? 'Réactivation d’un produit' : 'Désactivation d’un produit', optimistic: (_tempId: string, id: string, active: boolean) => setActive(id, active) },
  },
  // Images go to Supabase Storage; the local server keeps them inline.
  onlineOnly: isLocalDbConfigured ? [] : ['uploadImage'],
})

registerSnapshot('products', async () => isLocalDbConfigured
  ? (await localApi.query<LocalProductRow>(`
      select p.*, c.name as category_name, s.name as supplier_name
      from products p
      left join categories c on c.id = p.category_id
      left join suppliers s on s.id = p.supplier_id
      order by p.name
    `)).map(fromLocalRow)
  : fetchAllRows<Product>('products', '*, category:categories(name), supplier:suppliers(name)', 'name'))

export type { Product }
