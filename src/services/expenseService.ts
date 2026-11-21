import { getSessionUser, getSupabaseClient, isLocalDbConfigured } from '../lib/supabase'
import { localApi } from '../lib/localApi'
import { withOffline } from '../lib/offline/wrap'

export type ExpenseInput = {
  label: string;
  amount: number;
  expense_date?: string;
  notes?: string;
  /** Accounting accounts (Supabase): defaults 518000 and 101000 when empty. */
  expense_account_id?: string | null;
  payment_account_id?: string | null;
}

const expensesTable = () => getSupabaseClient().from('expenses')

export type MonthlyExpenses = { month: string; total: number; count: number }

const service = {
  /** Expense totals for the last `months` calendar months, oldest first. */
  getMonthlyTotals: async (months = 6): Promise<MonthlyExpenses[]> => {
    const now = new Date()
    const keys = Array.from({ length: months }, (_, index) => { const date = new Date(now.getFullYear(), now.getMonth() - months + 1 + index, 1); return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}` })
    const start = `${keys[0]}-01`
    const rows = isLocalDbConfigured
      ? await localApi.query<{ expense_date: string; amount: number }>("select expense_date, amount from expenses where expense_date >= ? and coalesce(status, 'active') <> 'cancelled'", [start])
      : await (async () => {
        const { data, error } = await expensesTable().select('expense_date, amount').gte('expense_date', start).neq('status', 'cancelled')
        if (error) throw error
        return (data ?? []) as { expense_date: string; amount: number }[]
      })()
    const totals = new Map(keys.map((month) => [month, { month, total: 0, count: 0 }]))
    for (const row of rows) {
      const bucket = totals.get(String(row.expense_date).slice(0, 7))
      if (bucket) { bucket.total += Number(row.amount); bucket.count += 1 }
    }
    return [...totals.values()]
  },

  getExpenses: async (page: number = 0) => {
    if (isLocalDbConfigured) {
      const offset = page * 20;
      const rows = await localApi.query<any>(`
        select e.*, p.full_name as created_by_name 
        from expenses e 
        left join profiles p on p.id = e.created_by 
        order by e.expense_date desc 
        limit 20 offset ?
      `, [offset]);
      const count = await localApi.query<{ total: number }>('select count(*) as total from expenses');
      return { data: rows, error: null, count: Number(count[0]?.total ?? 0) };
    }
    const from = page * 20;
    return expensesTable()
      .select('*, creator:profiles!expenses_created_by_fkey(full_name), expense_account:accounts!expenses_expense_account_id_fkey(code, name), journal:journal_entries!expenses_journal_entry_id_fkey(entry_number)', { count: 'exact' })
      .order('expense_date', { ascending: false })
      .range(from, from + 19)
  },

  createExpense: async (input: ExpenseInput) => {
    if (isLocalDbConfigured) {
      const profile = await localApi.getProfile();
      // The local server has no accounting columns.
      const { expense_account_id: _expenseAccount, payment_account_id: _paymentAccount, ...values } = input
      return localApi.mutate('insert', 'expenses', {
        ...values,
        expense_date: input.expense_date || new Date().toISOString().split('T')[0],
        created_by: profile.id
      }).then((data) => ({ data, error: null }))
      .catch((error) => ({ data: null, error }));
    }
    const user = await getSessionUser()
    if (!user) throw new Error('Non authentifié')
    return expensesTable()
      .insert({
        ...input,
        expense_date: input.expense_date || new Date().toISOString().split('T')[0],
        created_by: user.id
      })
      .select()
      .single()
  },

  /** An expense is never deleted: it is cancelled with a reason, its entry voided, and stays visible. */
  cancelExpense: async (id: string, reason: string) => {
    if (isLocalDbConfigured) {
      return localApi.rpc('cancel_expense', { id, reason })
        .then(() => ({ error: null }))
        .catch((error) => ({ error }));
    }
    const { error } = await getSupabaseClient().rpc('cancel_expense', { p_id: id, p_reason: reason })
    return { error }
  },
}

export const expenseService = withOffline('expenses', service, {
  throws: ['getMonthlyTotals'],
  reads: { getExpenses: true, getMonthlyTotals: true },
  writes: {
    createExpense: { label: (input: ExpenseInput) => `Dépense « ${input.label} »`, createsId: true, optimistic: (id: string, input: ExpenseInput) => ({ ...input, id, expense_date: input.expense_date || new Date().toISOString().split('T')[0] }) },
  },
  onlineOnly: ['cancelExpense'],
})
