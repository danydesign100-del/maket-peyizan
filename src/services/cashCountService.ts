import { getSessionUser, getSupabaseClient, isLocalDbConfigured } from '../lib/supabase'
import { localApi } from '../lib/localApi'
import { withOffline } from '../lib/offline/wrap'
import { readCache, writeCache } from '../lib/offline/cache'
import { cleanDetail, countTotal, overShort, type CurrencyDetail, type Direction, type Shift } from '../lib/cashCount'

export type CashCount = {
  id: string
  shift: Shift
  direction: Direction
  counted_at: string
  submitted_by: string
  submitter_name: string | null
  htg: CurrencyDetail
  usd: CurrencyDetail
  htg_total: number
  usd_total: number
  htg_over_short: number
  usd_over_short: number
  notes: string | null
  pending?: boolean
}

export type CashCountInput = { shift: Shift; direction: Direction; counted_at: string; htg: CurrencyDetail; usd: CurrencyDetail; notes: string | null }

const PAGE_SIZE = 20
const parseDetail = (value: unknown): CurrencyDetail => {
  const detail = (typeof value === 'string' ? JSON.parse(value) : value ?? {}) as Partial<CurrencyDetail>
  return cleanDetail({ counts: detail.counts ?? {}, rolled_coins: Number(detail.rolled_coins ?? 0), checks: Number(detail.checks ?? 0), paid_outs: Number(detail.paid_outs ?? 0), deposit: Number(detail.deposit ?? 0), bank_till: Number(detail.bank_till ?? 0) })
}

type RawRow = Omit<CashCount, 'htg' | 'usd' | 'submitter_name'> & { htg: unknown; usd: unknown; submitter_name?: string | null; submitter?: { full_name: string } | null }
const fromRow = ({ submitter, ...row }: RawRow): CashCount => ({
  ...row,
  submitter_name: row.submitter_name ?? submitter?.full_name ?? null,
  htg: parseDetail(row.htg), usd: parseDetail(row.usd),
  htg_total: Number(row.htg_total), usd_total: Number(row.usd_total),
  htg_over_short: Number(row.htg_over_short), usd_over_short: Number(row.usd_over_short),
})

/** UTC bounds of a local calendar day (YYYY-MM-DD). */
const dayBounds = (day: string) => { const start = new Date(`${day}T00:00:00`); const end = new Date(start); end.setDate(end.getDate() + 1); return [start.toISOString(), end.toISOString()] }

const service = {
  list: async (page = 0, day = ''): Promise<{ data: CashCount[] | null; error: Error | null; count: number | null }> => {
    try {
      if (isLocalDbConfigured) {
        const where = day ? 'where cc.counted_at >= ? and cc.counted_at < ?' : ''
        const bounds = day ? dayBounds(day) : []
        const rows = await localApi.query<RawRow>(`select cc.*, p.full_name as submitter_name from cash_counts cc left join profiles p on p.id = cc.submitted_by ${where} order by cc.counted_at desc limit ${PAGE_SIZE} offset ?`, [...bounds, page * PAGE_SIZE])
        const total = await localApi.query<{ total: number }>(`select count(*) as total from cash_counts cc ${where}`, bounds)
        return { data: rows.map(fromRow), error: null, count: Number(total[0]?.total ?? 0) }
      }
      let query = getSupabaseClient().from('cash_counts').select('*, submitter:profiles(full_name)', { count: 'exact' })
      if (day) { const [start, end] = dayBounds(day); query = query.gte('counted_at', start).lt('counted_at', end) }
      const { data, error, count } = await query.order('counted_at', { ascending: false }).range(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE - 1)
      if (error) return { data: null, error: new Error(error.message), count: null }
      return { data: ((data ?? []) as unknown as RawRow[]).map(fromRow), error: null, count: count ?? 0 }
    } catch (cause) {
      return { data: null, error: cause instanceof Error ? cause : new Error('Erreur de chargement'), count: null }
    }
  },

  /** Totals are recomputed by the server; the ones sent here only serve the local preview. */
  create: async (input: CashCountInput) => {
    const htg = cleanDetail(input.htg), usd = cleanDetail(input.usd)
    const values = {
      shift: input.shift, direction: input.direction, counted_at: input.counted_at, notes: input.notes?.trim() || null,
      htg_total: countTotal('htg', htg), usd_total: countTotal('usd', usd), htg_over_short: overShort('htg', htg), usd_over_short: overShort('usd', usd),
    }
    try {
      if (isLocalDbConfigured) {
        const profile = await localApi.getProfile()
        const row = await localApi.mutate<RawRow>('insert', 'cash_counts', { ...values, htg: JSON.stringify(htg), usd: JSON.stringify(usd), submitted_by: profile.id })
        return { data: fromRow(row), error: null }
      }
      const user = await getSessionUser()
      if (!user) throw new Error('Non authentifié')
      const { data, error } = await getSupabaseClient().from('cash_counts').insert({ ...values, htg, usd, submitted_by: user.id }).select('*').single()
      if (error) return { data: null, error }
      return { data: fromRow(data as RawRow), error: null }
    } catch (cause) {
      return { data: null, error: cause instanceof Error ? cause : new Error('Enregistrement impossible') }
    }
  },
}

// Same key as the cached read of list() for the first page without a date filter.
const FIRST_PAGE_KEY = 'cashCounts.list:[0,""]'

export const cashCountService = withOffline('cashCounts', service, {
  reads: { list: true },
  writes: {
    create: { label: (input: CashCountInput) => `Comptage de caisse (${input.shift} ${input.direction === 'in' ? 'début' : 'fin'})`, createsId: true, optimistic: async (id: string, input: CashCountInput) => {
      const htg = cleanDetail(input.htg), usd = cleanDetail(input.usd)
      const user = (() => { try { return JSON.parse(localStorage.getItem('mp:profile') ?? 'null') as { id: string; full_name: string } | null } catch { return null } })()
      const row: CashCount = {
        id, shift: input.shift, direction: input.direction, counted_at: input.counted_at, submitted_by: user?.id ?? '', submitter_name: user?.full_name ?? null,
        htg, usd, htg_total: countTotal('htg', htg), usd_total: countTotal('usd', usd), htg_over_short: overShort('htg', htg), usd_over_short: overShort('usd', usd),
        notes: input.notes?.trim() || null, pending: true,
      }
      // Show the queued entry at the top of the logsheet until it syncs.
      const cached = (await readCache<{ data: CashCount[]; error: null; count: number }>(FIRST_PAGE_KEY))?.value
      await writeCache(FIRST_PAGE_KEY, { data: [row, ...(cached?.data ?? [])], error: null, count: (cached?.count ?? 0) + 1 })
      return row
    } },
  },
})
