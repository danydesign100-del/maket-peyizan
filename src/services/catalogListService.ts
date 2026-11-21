import { getSupabaseClient, isLocalDbConfigured } from '../lib/supabase'
import { localApi } from '../lib/localApi'
import { withOffline } from '../lib/offline/wrap'
import type { CatalogList, CatalogListItem } from '../types/catalog'

// Short managed lists: units of measure and supplier categories.
const localError = (cause: unknown) => cause instanceof Error ? cause : new Error('Erreur de base locale')
type Result<T> = { data: T | null; error: Error | null }
const wrap = async <T>(run: () => Promise<T>): Promise<Result<T>> => { try { return { data: await run(), error: null } } catch (cause) { return { data: null, error: localError(cause) } } }
const failure = (error: { message: string } | null) => error ? new Error(error.message) : null

const service = {
  list: async (list: CatalogList): Promise<Result<CatalogListItem[]>> => {
    if (isLocalDbConfigured) return wrap(async () => (await localApi.query<CatalogListItem>(`select id, name, active from ${list} order by name`)).map((row) => ({ ...row, active: Boolean(row.active) })))
    const { data, error } = await getSupabaseClient().from(list).select('id, name, active').order('name')
    return { data: (data ?? null) as CatalogListItem[] | null, error: failure(error) }
  },
  create: async (list: CatalogList, name: string): Promise<Result<CatalogListItem>> => {
    if (isLocalDbConfigured) return wrap(() => localApi.mutate<CatalogListItem>('insert', list, { name, active: 1 }))
    const { data, error } = await getSupabaseClient().from(list).insert({ name }).select('id, name, active').single()
    return { data: data as CatalogListItem | null, error: error?.code === '23505' ? new Error(`« ${name.trim()} » existe déjà.`) : failure(error) }
  },
  update: async (list: CatalogList, id: string, values: Partial<Pick<CatalogListItem, 'name' | 'active'>>): Promise<Result<CatalogListItem>> => {
    if (isLocalDbConfigured) return wrap(() => localApi.mutate<CatalogListItem>('update', list, 'active' in values ? { ...values, active: values.active ? 1 : 0 } : values, id))
    const { data, error } = await getSupabaseClient().from(list).update(values).eq('id', id).select('id, name, active').single()
    return { data: data as CatalogListItem | null, error: error?.code === '23505' ? new Error(`« ${values.name?.trim()} » existe déjà.`) : failure(error) }
  },
}

export const catalogListService = withOffline('catalog-lists', service, {
  reads: { list: true },
  onlineOnly: ['create', 'update'],
})

export const CATALOG_LISTS: Record<CatalogList, { title: string; item: string; placeholder: string; hint: string }> = {
  units: { title: 'Unités de mesure', item: 'unité', placeholder: 'Ex. : marmite, sac de 50 lb', hint: 'Les unités proposées dans la fiche produit. Une unité désactivée reste sur les produits qui l’utilisent déjà.' },
  supplier_categories: { title: 'Catégories de fournisseurs', item: 'catégorie', placeholder: 'Ex. : Producteurs locaux', hint: 'Pour classer les fournisseurs. Une catégorie désactivée reste sur les fournisseurs déjà classés.' },
}
