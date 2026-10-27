import { getSupabaseClient, isLocalDbConfigured } from '../lib/supabase'
import { localApi } from '../lib/localApi'
import type { Category, CategoryInput } from '../types/catalog'

const localError = (cause: unknown) => cause instanceof Error ? cause : new Error('Erreur de base locale')
const table = () => getSupabaseClient().from('categories')
export const categoryService = {
  getCategories: async (search = '', includeInactive = false) => {
    if (isLocalDbConfigured) try {
      const term = `%${search.trim()}%`
      const rows = await localApi.query<Category>(`select c.*, count(p.id) as product_count from categories c left join products p on p.category_id = c.id where (? = 1 or c.active = 1) and (? = '' or c.name like ?) group by c.id order by c.name`, [includeInactive ? 1 : 0, search.trim(), term])
      return { data: rows.map((row) => ({ ...row, active: Boolean(row.active), product_count: Number(row.product_count ?? 0) })), error: null }
    } catch (cause) { return { data: null, error: localError(cause) } }
    let query = table().select('id, name, description, active, created_at, updated_at, products(count)').order('name'); if (!includeInactive) query = query.eq('active', true); if (search.trim()) query = query.ilike('name', `%${search.trim()}%`); const { data, error } = await query; if (error) return { data: null, error }; const rows = (data ?? []) as unknown as Array<Record<string, unknown> & { products?: { count: number }[] }>; return { data: rows.map((row) => ({ ...row, product_count: Array.isArray(row.products) ? row.products[0]?.count ?? 0 : 0 })) as unknown as Category[], error: null }
  },
  getCategoryById: async (id: string) => isLocalDbConfigured ? { data: (await localApi.query<Category>('select * from categories where id = ?', [id]))[0] ?? null, error: null } : table().select('*').eq('id', id).single(),
  createCategory: async (input: CategoryInput) => isLocalDbConfigured ? localApi.mutate<Category>('insert', 'categories', { ...input, active: 1 }).then((data) => ({ data, error: null })).catch((error) => ({ data: null, error: localError(error) })) : table().insert(input).select().single(),
  updateCategory: async (id: string, input: CategoryInput) => isLocalDbConfigured ? localApi.mutate<Category>('update', 'categories', input, id).then((data) => ({ data, error: null })).catch((error) => ({ data: null, error: localError(error) })) : table().update(input).eq('id', id).select().single(),
  deactivateCategory: async (id: string) => isLocalDbConfigured ? localApi.mutate<Category>('update', 'categories', { active: 0 }, id).then((data) => ({ data, error: null })).catch((error) => ({ data: null, error: localError(error) })) : table().update({ active: false }).eq('id', id),
  setCategoryActive: async (id: string, active: boolean) => isLocalDbConfigured ? localApi.mutate<Category>('update', 'categories', { active: active ? 1 : 0 }, id).then((data) => ({ data, error: null })).catch((error) => ({ data: null, error: localError(error) })) : table().update({ active }).eq('id', id),
}
