import { getSupabaseClient, isLocalDbConfigured } from '../lib/supabase'
import { withOffline } from '../lib/offline/wrap'
import type { SaleRecord } from '../lib/statements'
import type { Account, AccountBalance, AccountMovement, AccountNature, AccountTerm, AccountType, JournalEntry, JournalEntryDraft, JournalEntryStatus, JournalEntryType, JournalEntryWithLines, JournalHistory, Partner, RegularisationKind, StatementGroup } from '../types/accounting'

// Chart of accounts, journal entries and balances. Accounting runs on Supabase
// only: the local preview server shows a notice instead.
export const ACCOUNTING_ONLINE_ONLY = 'La comptabilité est disponible dans la version en ligne (Supabase).'

type Result<T> = { data: T | null; error: Error | null; count?: number | null }
const toError = (error: unknown) => error instanceof Error ? error : new Error(String((error as { message?: unknown })?.message ?? 'Erreur comptable'))
async function run<T>(query: () => PromiseLike<{ data: unknown; error: unknown; count?: number | null }>): Promise<Result<T>> {
  if (isLocalDbConfigured) return { data: null, error: new Error(ACCOUNTING_ONLINE_ONLY), count: null }
  const { data, error, count } = await query()
  return error ? { data: null, error: toError(error), count: null } : { data: data as T, error: null, count: count ?? null }
}

export type AccountForm = { id?: string; code: string; name: string; account_type: AccountType; nature: AccountNature; term: AccountTerm | null; statement_group: StatementGroup | null; parent_id: string | null; description: string }
export type EntryFilters = { from?: string; to?: string; status?: JournalEntryStatus | ''; type?: JournalEntryType | ''; search?: string; page?: number; pageSize?: number }
export const ENTRIES_PAGE_SIZE = 20

const ENTRY_SELECT = '*, lines:journal_entry_lines(*, account:accounts!journal_entry_lines_account_id_fkey(id, code, name, nature, account_type)), creator:profiles!journal_entries_created_by_fkey(full_name), poster:profiles!journal_entries_posted_by_fkey(full_name), voider:profiles!journal_entries_voided_by_fkey(full_name), submitter:profiles!journal_entries_submitted_by_fkey(full_name)'

const service = {
  listAccounts: () => run<Account[]>(() => getSupabaseClient().from('accounts').select('*').order('code')),

  saveAccount: (form: AccountForm) => run<Account>(() => getSupabaseClient().rpc('save_account', {
    p_id: form.id ?? null, p_code: form.code, p_name: form.name, p_account_type: form.account_type,
    p_nature: form.nature, p_term: form.term, p_parent_id: form.parent_id, p_description: form.description, p_statement_group: form.statement_group,
  }).single()),

  setAccountActive: (id: string, active: boolean) => run<Account>(() => getSupabaseClient().rpc('set_account_active', { p_id: id, p_active: active }).single()),

  /** Balances from account_balances(from, to): opening before `from`, movements up to `to`. */
  balances: (from: string | null, to: string | null) => run<AccountBalance[]>(() => getSupabaseClient().rpc('account_balances', { p_from: from, p_to: to })),

  listEntries: (filters: EntryFilters) => run<JournalEntryWithLines[]>(() => {
    const page = filters.page ?? 0
    const size = filters.pageSize ?? ENTRIES_PAGE_SIZE
    let query = getSupabaseClient().from('journal_entries').select(ENTRY_SELECT, { count: 'exact' })
    if (filters.from) query = query.gte('entry_date', filters.from)
    if (filters.to) query = query.lte('entry_date', filters.to)
    if (filters.status) query = query.eq('status', filters.status)
    if (filters.type) query = query.eq('entry_type', filters.type)
    const term = filters.search?.trim().replace(/[,()]/g, ' ')
    if (term) query = query.or(`description.ilike.%${term}%,reference.ilike.%${term}%,entry_number.ilike.%${term}%`)
    return query.order('entry_date', { ascending: false }).order('entry_number', { ascending: false }).range(page * size, page * size + size - 1)
  }),

  /** Posted lines of one account between two dates, oldest first. */
  accountMovements: async (accountId: string, from: string | null, to: string | null) => {
    const result = await run<AccountMovement[]>(() => {
      let query = getSupabaseClient().from('journal_entry_lines')
        .select('id, description, debit_amount, credit_amount, entry:journal_entries!inner(id, entry_number, entry_date, description, reference, entry_type, status)')
        .eq('account_id', accountId).eq('entry.status', 'posted')
      if (from) query = query.gte('entry.entry_date', from)
      if (to) query = query.lte('entry.entry_date', to)
      return query.limit(1000)
    })
    result.data?.sort((a, b) => a.entry.entry_date.localeCompare(b.entry.entry_date) || a.entry.entry_number.localeCompare(b.entry.entry_number))
    return result
  },

  saveEntry: (draft: JournalEntryDraft) => run<JournalEntry>(() => getSupabaseClient().rpc('save_journal_entry', {
    p_entry_id: draft.id ?? null, p_entry_date: draft.entry_date, p_description: draft.description, p_reference: draft.reference,
    p_entry_type: draft.entry_type, p_justification: draft.justification,
    p_regularisation_kind: draft.entry_type === 'regularisation' ? draft.regularisation_kind : null,
    p_lines: draft.lines.map((line) => ({ account_id: line.account_id, description: line.description, debit: line.debit || 0, credit: line.credit || 0 })),
  }).single()),

  /** Regularisations: the preparer submits; a director or administrator validates or returns it. */
  submitEntry: (id: string) => run<JournalEntry>(() => getSupabaseClient().rpc('submit_journal_entry', { p_entry_id: id }).single()),

  returnEntry: (id: string, reason: string) => run<JournalEntry>(() => getSupabaseClient().rpc('return_journal_entry', { p_entry_id: id, p_reason: reason }).single()),

  postEntry: (id: string) => run<boolean>(() => getSupabaseClient().rpc('post_journal_entry', { p_entry_id: id })),

  voidEntry: (id: string, reason: string) => run<JournalEntry>(() => getSupabaseClient().rpc('void_journal_entry', { p_entry_id: id, p_reason: reason }).single()),

  listPartners: () => run<Partner[]>(() => getSupabaseClient().from('partners').select('*').order('name')),

  savePartner: (partner: { id?: string; name: string; share_percent: number | null; notes: string }) => run<Partner>(() => getSupabaseClient().rpc('save_partner', { p_id: partner.id ?? null, p_name: partner.name, p_share_percent: partner.share_percent, p_notes: partner.notes }).single()),

  setPartnerActive: (id: string, active: boolean) => run<Partner>(() => getSupabaseClient().rpc('set_partner_active', { p_id: id, p_active: active }).single()),

  /** Posted lines of several accounts between two dates (partners' equity detail). */
  movementsForAccounts: (accountIds: string[], from: string | null, to: string | null) => run<(AccountMovement & { account_id: string })[]>(() => {
    let query = getSupabaseClient().from('journal_entry_lines')
      .select('id, account_id, description, debit_amount, credit_amount, entry:journal_entries!inner(id, entry_number, entry_date, description, reference, entry_type, status)')
      .in('account_id', accountIds.length ? accountIds : ['00000000-0000-0000-0000-000000000000']).eq('entry.status', 'posted')
    if (from) query = query.gte('entry.entry_date', from)
    if (to) query = query.lte('entry.entry_date', to)
    return query.limit(5000)
  }),

  /** Generates the missing automatic entries (sales, returns, expenses) of the period. */
  journalizePending: (from: string | null, to: string | null) => run<{ journalized: number; failed: number; errors: { operation: string; error: string }[] }>(() => getSupabaseClient().rpc('journalize_pending', { p_from: from, p_to: to })),

  /** Sales of the period (Haiti calendar days) with their payments, for the sales report. */
  salesForPeriod: (from: string, to: string) => run<SaleRecord[]>(() => {
    const start = new Date(`${from}T00:00:00`); const end = new Date(`${to}T00:00:00`); end.setDate(end.getDate() + 1)
    return getSupabaseClient().from('sales')
      .select('id, sale_number, sold_at, status, subtotal, discount_amount, tax_amount, total_amount, accounting_synced, accounting_error, cancel_reason, customer:customers(full_name), payments(method, amount)')
      .neq('status', 'draft').gte('sold_at', start.toISOString()).lt('sold_at', end.toISOString()).order('sold_at').limit(5000)
  }),

  entryHistory: (id: string) => run<JournalHistory[]>(() => getSupabaseClient().from('journal_entry_history').select('*, author:profiles!journal_entry_history_changed_by_fkey(full_name)').eq('journal_entry_id', id).order('changed_at')),
}

export const ledgerService = withOffline('ledger', service, {
  reads: { listAccounts: true, balances: true, listEntries: true, accountMovements: true, entryHistory: true, listPartners: true, movementsForAccounts: true, salesForPeriod: true },
  onlineOnly: ['saveAccount', 'setAccountActive', 'saveEntry', 'submitEntry', 'returnEntry', 'postEntry', 'voidEntry', 'savePartner', 'setPartnerActive', 'journalizePending'],
})

export const ACCOUNT_TYPE_LABELS: Record<AccountType, string> = { asset: 'Actif', liability: 'Passif', equity: 'Capitaux propres', revenue: 'Produits', expense: 'Charges' }
export const NATURE_LABELS: Record<AccountNature, string> = { debit: 'Débitrice', credit: 'Créditrice' }
export const TERM_LABELS: Record<AccountTerm, string> = { short: 'Court terme', long: 'Long terme' }
export const STATEMENT_GROUP_LABELS: Record<StatementGroup, string> = { sales: 'Ventes', sales_deduction: 'Réduction des ventes (remises, retours)', other_income: 'Autres produits', cogs: 'Coût des marchandises vendues', expense: 'Charges d’exploitation' }
export const defaultStatementGroup = (type: AccountType, nature: AccountNature): StatementGroup | null => type === 'revenue' ? (nature === 'debit' ? 'sales_deduction' : 'sales') : type === 'expense' ? 'expense' : null
export const ENTRY_TYPE_LABELS: Record<JournalEntryType, string> = { standard: 'Opération diverse', regularisation: 'Régularisation', opening: 'À-nouveau', sale: 'Vente', expense: 'Dépense', petty_cash: 'Petite caisse', cash: 'Caisse' }
export const STATUS_LABELS: Record<JournalEntryStatus, string> = { draft: 'Brouillon', posted: 'Validée', voided: 'Annulée' }
export const REGULARISATION_KIND_LABELS: Record<RegularisationKind, string> = {
  accrued_expense: 'Charges à payer', accrued_revenue: 'Produits à recevoir', prepaid_expense: 'Charges constatées d’avance', deferred_revenue: 'Produits constatés d’avance',
  depreciation: 'Dotation aux amortissements', provision: 'Provision / dépréciation', inventory: 'Stock / inventaire', correction: 'Correction d’erreur', other: 'Autre',
}
/** Roles allowed to validate regularisations (mirrors can_validate_regularisation in the database). */
/** Display status: a submitted regularisation draft is « À valider ». */
export const entryStatus = (entry: Pick<JournalEntry, 'status' | 'submitted_at'>) => entry.status === 'draft' && entry.submitted_at ? { label: 'À valider', badge: 'ui-badge-warning' } : { label: STATUS_LABELS[entry.status], badge: entry.status === 'posted' ? 'ui-badge-success' : entry.status === 'voided' ? 'ui-badge-danger' : 'ui-badge-neutral' }
export const defaultNature = (type: AccountType): AccountNature => type === 'asset' || type === 'expense' ? 'debit' : 'credit'
export const formatAmount = (value: number) => new Intl.NumberFormat('fr-HT', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value)
