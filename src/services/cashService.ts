import { getSupabaseClient, isLocalDbConfigured } from '../lib/supabase'
import { withOffline } from '../lib/offline/wrap'

// Cash movements, petty cash and the cash report (Supabase only, like accounting).
export type CashMovementType = 'deposit' | 'bank_withdrawal' | 'other_in' | 'expense' | 'supplier_payment' | 'withdrawal' | 'bank_deposit' | 'petty_cash_funding'
/** Where the money comes from or goes: main cash, petty cash, and (outflows only, accounting roles) bank or MonCash. */
export type CashAccountCode = '101000' | '104000' | '102000' | '105000'
export const CASH_ACCOUNT_LABELS: Record<CashAccountCode, string> = { '101000': 'Caisse principale', '104000': 'Petite caisse', '102000': 'Banque', '105000': 'MonCash / NatCash' }
export type CashMovement = {
  id: string; occurred_at: string; movement_type: CashMovementType; direction: 'in' | 'out'; amount: number; label: string; reference: string | null
  status: 'pending' | 'posted' | 'rejected' | 'voided'; void_reason: string | null; voided_at: string | null; expense_id: string | null; journal_entry_id: string | null
  approved_at: string | null; approval_note: string | null; approver?: { full_name: string } | null
  cash_account?: { code: string; name: string } | null; counter?: { code: string; name: string } | null; author?: { full_name: string } | null
  journal?: { entry_number: string } | null; expense?: { journal?: { entry_number: string } | null } | null
}
export type CashSessionRow = {
  session_id: string; cashier_id: string; cashier_name: string | null; opened_at: string; closed_at: string | null
  opening_amount: number; cash_sales: number; refunds: number; cash_in: number; cash_out: number; theoretical: number
  counted: number | null; difference: number | null; difference_validated_at: string | null; difference_validated_by_name: string | null; difference_reason: string | null
}

export const MOVEMENT_TYPES: Record<CashMovementType, { label: string; direction: 'in' | 'out'; hint: string; counter: 'choose' | 'expense' | 'fixed' }> = {
  deposit: { label: 'Apport de fonds', direction: 'in', hint: 'Argent ajouté par un associé ou le gérant', counter: 'choose' },
  bank_withdrawal: { label: 'Retrait bancaire vers la caisse', direction: 'in', hint: 'Contrepartie : 102000 Banque', counter: 'fixed' },
  other_in: { label: 'Autre entrée', direction: 'in', hint: 'Toute autre entrée ; ce n’est pas un revenu automatiquement', counter: 'choose' },
  expense: { label: 'Paiement de dépense', direction: 'out', hint: 'Enregistrée aussi dans Dépenses', counter: 'expense' },
  supplier_payment: { label: 'Paiement fournisseur', direction: 'out', hint: 'Règle un achat enregistré à crédit - contrepartie : 201000 Fournisseurs', counter: 'fixed' },
  withdrawal: { label: 'Retrait / prélèvement', direction: 'out', hint: 'Argent retiré par un associé ou le gérant', counter: 'choose' },
  bank_deposit: { label: 'Versement en banque', direction: 'out', hint: 'Contrepartie : 102000 Banque', counter: 'fixed' },
  petty_cash_funding: { label: 'Approvisionnement de la petite caisse', direction: 'out', hint: 'Contrepartie : 104000 Petite caisse', counter: 'fixed' },
}

const ONLINE_ONLY = 'La gestion de caisse est disponible dans la version en ligne.'
type Result<T> = { data: T | null; error: Error | null }
async function run<T>(query: () => PromiseLike<{ data: unknown; error: unknown }>): Promise<Result<T>> {
  if (isLocalDbConfigured) return { data: null, error: new Error(ONLINE_ONLY) }
  const { data, error } = await query()
  return error ? { data: null, error: new Error(String((error as { message?: unknown }).message ?? 'Erreur de caisse')) } : { data: data as T, error: null }
}
/** UTC bounds of local calendar days [from, to]. */
const bounds = (from: string, to: string) => { const start = new Date(`${from}T00:00:00`); const end = new Date(`${to}T00:00:00`); end.setDate(end.getDate() + 1); return [start.toISOString(), end.toISOString()] }

const service = {
  listMovements: (from: string, to: string) => run<CashMovement[]>(() => {
    const [start, end] = bounds(from, to)
    return getSupabaseClient().from('cash_movements')
      .select('*, cash_account:accounts!cash_movements_cash_account_id_fkey(code, name), counter:accounts!cash_movements_counter_account_id_fkey(code, name), author:profiles!cash_movements_created_by_fkey(full_name), approver:profiles!cash_movements_approved_by_fkey(full_name), journal:journal_entries!cash_movements_journal_entry_id_fkey(entry_number), expense:expenses(journal:journal_entries!expenses_journal_entry_id_fkey(entry_number))')
      .gte('occurred_at', start).lt('occurred_at', end).order('occurred_at', { ascending: false }).limit(1000)
  }),

  recordMovement: (input: { type: CashMovementType; amount: number; label: string; reference: string; counterAccountId: string | null; cashAccount: CashAccountCode; occurredAt?: string }) => run<CashMovement>(() => getSupabaseClient().rpc('record_cash_movement', {
    p_type: input.type, p_amount: input.amount, p_label: input.label, p_reference: input.reference, p_counter_account_id: input.counterAccountId,
    p_cash_account_code: input.cashAccount, p_occurred_at: input.occurredAt ?? new Date().toISOString(),
  }).single()),

  voidMovement: (id: string, reason: string) => run<CashMovement>(() => getSupabaseClient().rpc('void_cash_movement', { p_id: id, p_reason: reason }).single()),

  /** Outflows above the threshold: approval or refusal by a director or administrator. */
  approveMovement: (id: string, note: string) => run<CashMovement>(() => getSupabaseClient().rpc('approve_cash_movement', { p_id: id, p_note: note || null }).single()),
  rejectMovement: (id: string, reason: string) => run<CashMovement>(() => getSupabaseClient().rpc('reject_cash_movement', { p_id: id, p_reason: reason }).single()),

  sessionReport: (from: string, to: string, cashierId: string | null) => run<CashSessionRow[]>(() => getSupabaseClient().rpc('cash_session_report', { p_from: from, p_to: to, p_cashier: cashierId })),

  validateDifference: (sessionId: string, reason: string) => run<unknown>(() => getSupabaseClient().rpc('validate_cash_difference', { p_session_id: sessionId, p_reason: reason }).single()),

  /** Imprest amount of the petty cash (settings: petty_cash.float). */
  pettyCashFloat: async () => {
    const result = await run<{ value: unknown }[]>(() => getSupabaseClient().from('settings').select('value').eq('key', 'petty_cash.float'))
    return { data: result.data ? Number(result.data[0]?.value ?? 0) : null, error: result.error }
  },
  setPettyCashFloat: (amount: number) => run<unknown>(() => getSupabaseClient().from('settings').update({ value: amount }).eq('key', 'petty_cash.float')),
}

export const cashService = withOffline('cash', service, {
  reads: { listMovements: true, sessionReport: true, pettyCashFloat: true },
  onlineOnly: ['recordMovement', 'voidMovement', 'approveMovement', 'rejectMovement', 'validateDifference', 'setPettyCashFloat'],
})
