import { getSupabaseClient, isLocalDbConfigured } from '../lib/supabase'
import { localApi } from '../lib/localApi'
import type { Category, CategoryInput, Product } from '../types/catalog'
import { withOffline } from '../lib/offline/wrap'
import { byText, getSnapshot, matches, patchRow, patchSnapshot, registerSnapshot, upsertRow } from '../lib/offline/snapshot'

const localError = (cause: unknown) => cause instanceof Error ? cause : new Error('Erreur de base locale')
const table = () => getSupabaseClient().from('categories')
const service = {
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

async function offlineCategories(search = '', includeInactive = false) {
  const [categories, products] = await Promise.all([getSnapshot<Category>('categories'), getSnapshot<Product>('products')])
  if (!categories) return undefined
  const data = categories.filter((category) => (includeInactive || category.active) && matches(search, category.name))
    .map((category) => ({ ...category, product_count: products?.filter((product) => product.category_id === category.id).length ?? category.product_count ?? 0 }))
    .sort(byText('name'))
  return { data, error: null }
}
const setActive = async (id: string, active: boolean) => patchSnapshot<Category>('categories', (rows) => patchRow(rows, id, { active }))

export const categoryService = withOffline('categories', service, {
  reads: {
    getCategories: { fallback: offlineCategories },
    getCategoryById: { fallback: async (id: string) => { const row = (await getSnapshot<Category>('categories'))?.find((item) => item.id === id); return row && { data: row, error: null } } },
  },
  writes: {
    createCategory: { label: (input: CategoryInput) => `Nouvelle catégorie « ${input.name} »`, createsId: true, optimistic: async (id: string, input: CategoryInput) => {
      const row = { ...input, id, active: true, product_count: 0, created_at: new Date().toISOString(), updated_at: new Date().toISOString() } as Category
      await patchSnapshot<Category>('categories', (rows) => upsertRow(rows, row)); return row
    } },
    updateCategory: { label: (_id: string, input: CategoryInput) => `Modification de la catégorie « ${input.name} »`, optimistic: async (_tempId: string, id: string, input: CategoryInput) => { await patchSnapshot<Category>('categories', (rows) => patchRow(rows, id, input)); return { id, ...input } } },
    deactivateCategory: { label: 'Désactivation d’une catégorie', optimistic: (_tempId: string, id: string) => setActive(id, false) },
    setCategoryActive: { label: (_id: string, active: boolean) => active ? 'Réactivation d’une catégorie' : 'Désactivation d’une catégorie', optimistic: (_tempId: string, id: string, active: boolean) => setActive(id, active) },
  },
})

registerSnapshot('categories', async () => {
  const { data, error } = await service.getCategories('', true)
  if (error) throw error
  return (data ?? []) as unknown as Category[]
})
