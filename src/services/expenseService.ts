import { getSupabaseClient, isLocalDbConfigured } from '../lib/supabase'
import { localApi } from '../lib/localApi'

export type ExpenseInput = {
  label: string;
  amount: number;
  expense_date?: string;
  notes?: string;
}

const expensesTable = () => getSupabaseClient().from('expenses')

export const expenseService = {
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
      .select('*, creator:profiles(full_name)', { count: 'exact' })
      .order('expense_date', { ascending: false })
      .range(from, from + 19)
  },

  createExpense: async (input: ExpenseInput) => {
    if (isLocalDbConfigured) {
      const profile = await localApi.getProfile();
      return localApi.mutate('insert', 'expenses', {
        ...input,
        expense_date: input.expense_date || new Date().toISOString().split('T')[0],
        created_by: profile.id
      }).then((data) => ({ data, error: null }))
      .catch((error) => ({ data: null, error }));
    }
    const { data: { user } } = await getSupabaseClient().auth.getUser()
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

  deleteExpense: async (id: string) => {
    if (isLocalDbConfigured) {
      return localApi.rpc('delete_expense', { id })
        .then(() => ({ error: null }))
        .catch((error) => ({ error }));
    }
    return expensesTable().delete().eq('id', id)
  },
}
