export type AccountType = 'asset' | 'liability' | 'equity' | 'revenue' | 'expense'
export type Account = { id: string; code: string; name: string; account_type: AccountType; parent_id: string | null; is_active: boolean; description: string | null; created_at: string; updated_at: string }
export type AccountInput = Omit<Account, 'id' | 'created_at' | 'updated_at'>

export type AccountingPeriod = { id: string; name: string; start_date: string; end_date: string; is_closed: boolean; closed_at: string | null; closed_by: string | null; notes: string | null; created_at: string; updated_at: string }
export type AccountingPeriodInput = Omit<AccountingPeriod, 'id' | 'closed_at' | 'closed_by' | 'created_at' | 'updated_at'>

export type JournalEntryStatus = 'draft' | 'posted' | 'voided'
export type JournalEntry = { id: string; entry_number: string; period_id: string; entry_date: string; description: string; reference_type: string | null; reference_id: string | null; status: JournalEntryStatus; total_debit: number; total_credit: number; created_by: string; posted_by: string | null; posted_at: string | null; created_at: string; updated_at: string }
export type JournalEntryInput = Omit<JournalEntry, 'id' | 'entry_number' | 'total_debit' | 'total_credit' | 'posted_by' | 'posted_at' | 'created_at' | 'updated_at'>
export type JournalEntryLineInput = { account_id: string; description?: string | null; debit_amount: number; credit_amount: number }

export type AdjustmentInput = { period_id: string; adjustment_date: string; description: string; adjustment_type: 'accrual' | 'deferral' | 'depreciation' | 'provision' | 'error_correction' | 'reconciliation' | 'stock_impact'; status: 'draft' | 'pending_approval' | 'approved' | 'posted' | 'voided'; journal_entry_id?: string | null; prepared_by: string; approved_by?: string | null; supporting_document_url?: string | null; notes?: string | null }
export type TrialBalanceEntry = { account_id: string; code: string; name: string; account_type: AccountType; parent_id: string | null; total_debit: number; total_credit: number; balance: number }
