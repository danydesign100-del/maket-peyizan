export type AccountType = 'asset' | 'liability' | 'equity' | 'revenue' | 'expense'
/** Normal balance side: débitrice or créditrice. */
export type AccountNature = 'debit' | 'credit'
/** Assets and liabilities only: court terme or long terme. */
export type AccountTerm = 'short' | 'long'
/** Income statement line fed by a revenue or expense account. */
export type StatementGroup = 'sales' | 'sales_deduction' | 'other_income' | 'cogs' | 'expense'
export type Account = { id: string; code: string; name: string; account_type: AccountType; nature: AccountNature; term: AccountTerm | null; statement_group: StatementGroup | null; parent_id: string | null; is_active: boolean; description: string | null; created_at: string; updated_at: string }
export type AccountInput = Omit<Account, 'id' | 'created_at' | 'updated_at'>

export type AccountingPeriod = { id: string; name: string; start_date: string; end_date: string; is_closed: boolean; closed_at: string | null; closed_by: string | null; notes: string | null; created_at: string; updated_at: string }
export type AccountingPeriodInput = Omit<AccountingPeriod, 'id' | 'closed_at' | 'closed_by' | 'created_at' | 'updated_at'>

export type JournalEntryStatus = 'draft' | 'posted' | 'voided'
/** standard, regularisation and opening are entered by hand; the others are generated. */
export type JournalEntryType = 'standard' | 'regularisation' | 'opening' | 'sale' | 'expense' | 'petty_cash' | 'cash'
/** Kind of period-end regularisation. */
export type RegularisationKind = 'accrued_expense' | 'accrued_revenue' | 'prepaid_expense' | 'deferred_revenue' | 'depreciation' | 'provision' | 'inventory' | 'correction' | 'other'
export type JournalEntry = { id: string; entry_number: string; period_id: string; entry_date: string; description: string; reference: string | null; entry_type: JournalEntryType; regularisation_kind: RegularisationKind | null; submitted_by: string | null; submitted_at: string | null; justification: string | null; reference_type: string | null; reference_id: string | null; status: JournalEntryStatus; total_debit: number; total_credit: number; created_by: string; posted_by: string | null; posted_at: string | null; voided_by: string | null; voided_at: string | null; void_reason: string | null; created_at: string; updated_at: string }
export type JournalEntryInput = Omit<JournalEntry, 'id' | 'entry_number' | 'total_debit' | 'total_credit' | 'posted_by' | 'posted_at' | 'created_at' | 'updated_at'>
export type JournalEntryLineInput = { account_id: string; description?: string | null; debit_amount: number; credit_amount: number }

export type AdjustmentInput = { period_id: string; adjustment_date: string; description: string; adjustment_type: 'accrual' | 'deferral' | 'depreciation' | 'provision' | 'error_correction' | 'reconciliation' | 'stock_impact'; status: 'draft' | 'pending_approval' | 'approved' | 'posted' | 'voided'; journal_entry_id?: string | null; prepared_by: string; approved_by?: string | null; supporting_document_url?: string | null; notes?: string | null }
export type TrialBalanceEntry = { account_id: string; code: string; name: string; account_type: AccountType; parent_id: string | null; total_debit: number; total_credit: number; balance: number }

export type JournalLine = { id: string; journal_entry_id: string; account_id: string; description: string | null; debit_amount: number; credit_amount: number; line_number: number; account?: Pick<Account, 'id' | 'code' | 'name' | 'nature' | 'account_type'> | null }
export type JournalEntryWithLines = JournalEntry & { lines: JournalLine[]; creator?: { full_name: string } | null; poster?: { full_name: string } | null; voider?: { full_name: string } | null; submitter?: { full_name: string } | null }
export type JournalLineDraft = { account_id: string; description: string; debit: number; credit: number }
export type JournalEntryDraft = { id?: string; entry_date: string; description: string; reference: string; entry_type: 'standard' | 'regularisation' | 'opening'; regularisation_kind: RegularisationKind; justification: string; lines: JournalLineDraft[] }
export type JournalHistory = { id: string; journal_entry_id: string; action: 'created' | 'updated' | 'submitted' | 'returned' | 'posted' | 'voided'; changed_at: string; reason: string | null; snapshot: JournalEntry & { lines: { code: string; name: string; description: string | null; debit_amount: number; credit_amount: number }[] }; author?: { full_name: string } | null }
/** One row of account_balances(from, to): the single source of balances for every report. */
export type AccountBalance = { account_id: string; code: string; name: string; account_type: AccountType; nature: AccountNature; term: AccountTerm | null; statement_group: StatementGroup | null; parent_id: string | null; is_active: boolean; opening_debit: number; opening_credit: number; period_debit: number; period_credit: number; regularisation_debit: number; regularisation_credit: number; closing_debit: number; closing_credit: number; balance: number }
/** A posted line of one account, with its entry, for the account detail. */
export type AccountMovement = { id: string; description: string | null; debit_amount: number; credit_amount: number; entry: Pick<JournalEntry, 'id' | 'entry_number' | 'entry_date' | 'description' | 'reference' | 'entry_type' | 'status'> }

export type Partner = { id: string; name: string; share_percent: number | null; capital_account_id: string; current_account_id: string; is_active: boolean; notes: string | null; created_at: string; updated_at: string }
