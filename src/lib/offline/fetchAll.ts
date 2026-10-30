import { getSupabaseClient } from '../supabase'

/** Reads a whole Supabase table in 1000-row pages (the PostgREST default limit). */
export async function fetchAllRows<T>(table: string, columns: string, orderBy: string): Promise<T[]> {
  const rows: T[] = []
  for (let from = 0; ; from += 1000) {
    const { data, error } = await getSupabaseClient().from(table as never).select(columns).order(orderBy).range(from, from + 999)
    if (error) throw error
    rows.push(...((data ?? []) as T[]))
    if (!data || data.length < 1000) return rows
  }
}
