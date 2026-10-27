import { getSupabaseClient, isLocalDbConfigured } from '../lib/supabase'
import { localApi } from '../lib/localApi'
import type { Product, ProductInput } from '../types/catalog'

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

export const productService = {
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

export type { Product }
