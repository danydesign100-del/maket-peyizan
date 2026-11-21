import { getSupabaseClient, isLocalDbConfigured } from '../lib/supabase'
import { cachedRead } from '../lib/offline/wrap'

/**
 * Reads a few application settings (readable by every signed-in user), with the
 * last known values offline. The local server keeps them behind its admin API:
 * defaults apply there.
 */
export async function readSettings(keys: string[]): Promise<Record<string, unknown>> {
  if (isLocalDbConfigured) return {}
  return cachedRead(`settings:${keys.join(',')}`, async () => {
    const { data, error } = await getSupabaseClient().from('settings').select('key, value').in('key', keys)
    if (error) throw error
    return Object.fromEntries(((data ?? []) as { key: string; value: unknown }[]).map((row) => [row.key, row.value]))
  }, { style: 'throw' }).catch(() => ({}))
}
