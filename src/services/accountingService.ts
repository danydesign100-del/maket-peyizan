import { getSessionUser, getSupabaseClient, isLocalDbConfigured } from '../lib/supabase'
import { localApi } from '../lib/localApi'
import { withOffline } from '../lib/offline/wrap'
import type { AccountInput, AccountingPeriodInput, JournalEntryInput, JournalEntryLineInput, AdjustmentInput } from '../types/accounting'

const accountsTable = () => getSupabaseClient().from('accounts')
const periodsTable = () => getSupabaseClient().from('accounting_periods')
const journalEntriesTable = () => getSupabaseClient().from('journal_entries')
const journalEntryLinesTable = () => getSupabaseClient().from('journal_entry_lines')
const adjustmentsTable = () => getSupabaseClient().from('adjustments')

const service = {
  // ============================================
  // Comptes (Plan comptable)
  // ============================================
  getAccounts: async (filters?: { type?: string; active?: boolean }) => {
    if (isLocalDbConfigured) {
      const conditions = ['1=1'];
      const params: unknown[] = [];
      if (filters?.type) {
        conditions.push('account_type = ?');
        params.push(filters.type);
      }
      if (filters?.active !== undefined) {
        conditions.push('is_active = ?');
        params.push(filters.active ? 1 : 0);
      }
      const where = conditions.join(' and ');
      const rows = await localApi.query<any>(`select * from accounts where ${where} order by code`, params);
      return { data: rows, error: null, count: rows.length };
    }
    let query = accountsTable().select('*', { count: 'exact' })
    if (filters?.type) query = query.eq('account_type', filters.type)
    if (filters?.active !== undefined) query = query.eq('is_active', filters.active)
    return query.order('code')
  },

  getAccountById: async (id: string) => {
    return accountsTable().select('*, parent:accounts(*)').eq('id', id).single()
  },

  createAccount: async (input: AccountInput) => {
    return accountsTable().insert(input).select().single()
  },

  updateAccount: async (id: string, input: Partial<AccountInput>) => {
    return accountsTable().update(input).eq('id', id).select().single()
  },

  deactivateAccount: async (id: string) => {
    return accountsTable().update({ is_active: false }).eq('id', id)
  },

  // ============================================
  // Périodes comptables
  // ============================================
  getPeriods: async () => {
    if (isLocalDbConfigured) {
      const rows = await localApi.query<any>(`select ap.*, p.full_name as closed_by_name from accounting_periods ap left join profiles p on p.id = ap.closed_by order by ap.start_date desc`);
      return { data: rows, error: null };
    }
    return periodsTable().select('*, closed_by:profiles(full_name)').order('start_date', { ascending: false })
  },

  getActivePeriod: async () => {
    if (isLocalDbConfigured) {
      const rows = await localApi.query<any>(`select * from accounting_periods where is_closed = 0 order by start_date desc limit 1`);
      return rows[0] ?? null;
    }
    return periodsTable().select('*').eq('is_closed', false).order('start_date', { ascending: false }).limit(1).maybeSingle()
  },

  createPeriod: async (input: AccountingPeriodInput) => {
    return periodsTable().insert(input).select().single()
  },

  closePeriod: async (id: string) => {
    return periodsTable().update({ 
      is_closed: true, 
      closed_at: new Date().toISOString(),
      closed_by: (await getSessionUser())?.id 
    }).eq('id', id)
  },

  // ============================================
  // Écritures comptables
  // ============================================
  getJournalEntries: async (filters?: { 
    periodId?: string; 
    status?: string; 
    fromDate?: string; 
    toDate?: string;
    page?: number;
  }) => {
    if (isLocalDbConfigured) {
      const conditions = ['1=1'];
      const params: unknown[] = [];
      if (filters?.periodId) {
        conditions.push('period_id = ?');
        params.push(filters.periodId);
      }
      if (filters?.status) {
        conditions.push('status = ?');
        params.push(filters.status);
      }
      if (filters?.fromDate) {
        conditions.push('entry_date >= ?');
        params.push(filters.fromDate);
      }
      if (filters?.toDate) {
        conditions.push('entry_date <= ?');
        params.push(filters.toDate);
      }
      const where = conditions.join(' and ');
      const offset = (filters?.page || 0) * 20;
      const rows = await localApi.query<any>(`select je.*, ap.name as period_name, p.full_name as creator_name from journal_entries je left join accounting_periods ap on ap.id = je.period_id left join profiles p on p.id = je.created_by where ${where} order by je.entry_date desc limit 20 offset ?`, [...params, offset]);
      return { data: rows, error: null, count: rows.length };
    }
    let query = journalEntriesTable().select('*, period:accounting_periods(name), creator:profiles(full_name), poster:profiles(full_name)', { count: 'exact' })
    if (filters?.periodId) query = query.eq('period_id', filters.periodId)
    if (filters?.status) query = query.eq('status', filters.status)
    if (filters?.fromDate) query = query.gte('entry_date', filters.fromDate)
    if (filters?.toDate) query = query.lte('entry_date', filters.toDate)
    
    const from = (filters?.page || 0) * 20
    return query.order('entry_date', { ascending: false }).range(from, from + 19)
  },

  getJournalEntryById: async (id: string) => {
    return journalEntriesTable().select('*, period:accounting_periods(name), creator:profiles(full_name), poster:profiles(full_name)').eq('id', id).single()
  },

  getJournalEntryLines: async (entryId: string) => {
    return journalEntryLinesTable().select('*, account:accounts(code, name)').eq('journal_entry_id', entryId).order('line_number')
  },

  createJournalEntry: async (input: JournalEntryInput, lines: JournalEntryLineInput[]) => {
    const client = getSupabaseClient()
    
    // Créer l'écriture dans une transaction
    const { data: entry, error: entryError } = await client
      .from('journal_entries')
      .insert({
        ...input,
        entry_number: undefined, // Généré automatiquement
        total_debit: 0,
        total_credit: 0
      })
      .select()
      .single()
    
    if (entryError) throw entryError
    
    // Créer les lignes
    const entryId = (entry as { id: string }).id
    const linesWithEntryId = lines.map((line, index) => ({
      ...line,
      journal_entry_id: entryId,
      line_number: index + 1
    }))
    
    const { error: linesError } = await client
      .from('journal_entry_lines')
      .insert(linesWithEntryId)
    
    if (linesError) throw linesError
    
    return entry
  },

  updateJournalEntry: async (id: string, input: Partial<JournalEntryInput>) => {
    return journalEntriesTable().update(input).eq('id', id).select().single()
  },

  postJournalEntry: async (id: string) => {
    if (isLocalDbConfigured) {
      return localApi.rpc('post_journal_entry', { p_entry_id: id })
    }
    return getSupabaseClient().rpc('post_journal_entry', { p_entry_id: id })
  },

  voidJournalEntry: async (id: string) => {
    return journalEntriesTable().update({ status: 'voided' }).eq('id', id)
  },

  // ============================================
  // Synchronisation ventes → comptabilité
  // ============================================
  syncSaleToAccounting: async (saleId: string) => {
    if (isLocalDbConfigured) {
      return localApi.rpc('sync_sale_to_accounting', { p_sale_id: saleId })
    }
    return getSupabaseClient().rpc('sync_sale_to_accounting', { p_sale_id: saleId })
  },

  getUnsyncedSales: async () => {
    if (isLocalDbConfigured) {
      const rows = await localApi.query<any>(`
        select s.*, c.full_name as customer_name
        from sales s
        left join customers c on c.id = s.customer_id
        where s.status = 'completed' and s.accounting_synced = 0
        order by s.sold_at desc
      `)
      return { data: rows, error: null }
    }
    return getSupabaseClient().from('unsynced_sales').select('*')
  },

  // ============================================
  // Écritures de régularisation
  // ============================================
  getAdjustments: async (filters?: { status?: string; type?: string; page?: number }) => {
    let query = adjustmentsTable().select('*, period:accounting_periods(name), preparer:profiles(full_name), approver:profiles(full_name)', { count: 'exact' })
    if (filters?.status) query = query.eq('status', filters.status)
    if (filters?.type) query = query.eq('adjustment_type', filters.type)
    
    const from = (filters?.page || 0) * 20
    return query.order('adjustment_date', { ascending: false }).range(from, from + 19)
  },

  getAdjustmentById: async (id: string) => {
    return adjustmentsTable().select('*, period:accounting_periods(name), preparer:profiles(full_name), approver:profiles(full_name), journal_entry:journal_entries(entry_number)').eq('id', id).single()
  },

  createAdjustment: async (input: AdjustmentInput) => {
    return adjustmentsTable().insert(input).select().single()
  },

  updateAdjustment: async (id: string, input: Partial<AdjustmentInput>) => {
    return adjustmentsTable().update(input).eq('id', id).select().single()
  },

  submitForApproval: async (id: string) => {
    return adjustmentsTable().update({ status: 'pending_approval' }).eq('id', id)
  },

  approveAdjustment: async (id: string) => {
    const userId = (await getSessionUser())?.id
    
    return adjustmentsTable().update({ 
      status: 'approved',
      approved_by: userId,
      approved_at: new Date().toISOString()
    }).eq('id', id)
  },

  // ============================================
  // Rapports et vues
  // ============================================
  getGeneralLedger: async (filters?: { accountCode?: string; fromDate?: string; toDate?: string }) => {
    if (isLocalDbConfigured) {
      const conditions = ['je.status = "posted"'];
      const params: unknown[] = [];
      if (filters?.accountCode) {
        conditions.push('a.code = ?');
        params.push(filters.accountCode);
      }
      if (filters?.fromDate) {
        conditions.push('je.entry_date >= ?');
        params.push(filters.fromDate);
      }
      if (filters?.toDate) {
        conditions.push('je.entry_date <= ?');
        params.push(filters.toDate);
      }
      const where = conditions.join(' and ');
      const rows = await localApi.query<any>(`
        select je.id as entry_id, je.entry_number, je.entry_date, je.description as entry_description,
          je.status, a.code as account_code, a.name as account_name, a.account_type,
          jel.description as line_description, jel.debit_amount, jel.credit_amount, jel.line_number,
          p.full_name as created_by_name, je.created_at
        from journal_entries je
        join journal_entry_lines jel on jel.journal_entry_id = je.id
        join accounts a on jel.account_id = a.id
        left join profiles p on p.id = je.created_by
        where ${where}
        order by je.entry_date desc
      `, params);
      return { data: rows, error: null };
    }
    let query = getSupabaseClient().from('general_ledger').select('*')
    if (filters?.accountCode) query = query.eq('account_code', filters.accountCode)
    if (filters?.fromDate) query = query.gte('entry_date', filters.fromDate)
    if (filters?.toDate) query = query.lte('entry_date', filters.toDate)
    return query.order('entry_date', { ascending: false })
  },

  getTrialBalance: async (periodId?: string) => {
    if (isLocalDbConfigured) {
      const periodFilter = periodId ? 'and je.period_id = ?' : '';
      const rows = await localApi.query<any>(`
        select a.id as account_id, a.code, a.name, a.account_type, a.parent_id,
          coalesce(sum(case when je.status = 'posted' then jel.debit_amount else 0 end), 0) as total_debit,
          coalesce(sum(case when je.status = 'posted' then jel.credit_amount else 0 end), 0) as total_credit,
          case when a.account_type in ('asset', 'expense') 
            then coalesce(sum(case when je.status = 'posted' then jel.debit_amount else 0 end), 0) - coalesce(sum(case when je.status = 'posted' then jel.credit_amount else 0 end), 0)
            else coalesce(sum(case when je.status = 'posted' then jel.credit_amount else 0 end), 0) - coalesce(sum(case when je.status = 'posted' then jel.debit_amount else 0 end), 0) 
          end as balance
        from accounts a
        left join journal_entry_lines jel on jel.account_id = a.id
        left join journal_entries je on je.id = jel.journal_entry_id ${periodFilter}
        where a.is_active = 1
        group by a.id, a.code, a.name, a.account_type, a.parent_id
        order by a.code
      `, periodId ? [periodId] : []);
      return { data: rows, error: null };
    }
    if (periodId) {
      // Filtrer par période en rejoignant avec journal_entries
      return getSupabaseClient()
        .from('trial_balance')
        .select('*')
        // Note: La vue trial_balance actuelle ne filtre pas par période
        // À améliorer si nécessaire
    }
    return getSupabaseClient().from('trial_balance').select('*').order('code')
  },

  // ============================================
  // Audit
  // ============================================
  getAuditLog: async (filters?: { 
    entityType?: string; 
    entityId?: string; 
    action?: string; 
    fromDate?: string; 
    toDate?: string; 
    page?: number 
  }) => {
    if (isLocalDbConfigured) {
      const conditions = ['1=1'];
      const params: unknown[] = [];
      if (filters?.entityType) {
        conditions.push('entity_type = ?');
        params.push(filters.entityType);
      }
      if (filters?.entityId) {
        conditions.push('entity_id = ?');
        params.push(filters.entityId);
      }
      if (filters?.action) {
        conditions.push('action = ?');
        params.push(filters.action);
      }
      if (filters?.fromDate) {
        conditions.push('created_at >= ?');
        params.push(filters.fromDate);
      }
      if (filters?.toDate) {
        conditions.push('created_at <= ?');
        params.push(filters.toDate);
      }
      const where = conditions.join(' and ');
      const offset = (filters?.page || 0) * 50;
      const rows = await localApi.query<any>(`select al.*, p.full_name as profile_name from audit_log al left join profiles p on p.id = al.profile_id where ${where} order by al.created_at desc limit 50 offset ?`, [...params, offset]);
      return { data: rows, error: null, count: rows.length };
    }
    let query = getSupabaseClient().from('audit_log').select('*, profile:profiles(full_name)', { count: 'exact' })
    if (filters?.entityType) query = query.eq('entity_type', filters.entityType)
    if (filters?.entityId) query = query.eq('entity_id', filters.entityId)
    if (filters?.action) query = query.eq('action', filters.action)
    if (filters?.fromDate) query = query.gte('created_at', filters.fromDate)
    if (filters?.toDate) query = query.lte('created_at', filters.toDate)
    
    const from = (filters?.page || 0) * 50
    return query.order('created_at', { ascending: false }).range(from, from + 49)
  },

  getBalanceSheet: async () => {
    if (isLocalDbConfigured) {
      const rows = await localApi.query<any>(`
        select a.id, a.code, a.name, a.account_type,
          case when a.account_type = 'asset'
            then coalesce(sum(case when je.status = 'posted' then jel.debit_amount else 0 end), 0) - coalesce(sum(case when je.status = 'posted' then jel.credit_amount else 0 end), 0)
            else coalesce(sum(case when je.status = 'posted' then jel.credit_amount else 0 end), 0) - coalesce(sum(case when je.status = 'posted' then jel.debit_amount else 0 end), 0)
          end as balance
        from accounts a
        left join journal_entry_lines jel on jel.account_id = a.id
        left join journal_entries je on je.id = jel.journal_entry_id
        where a.is_active = 1 and a.account_type in ('asset', 'liability', 'equity')
        group by a.id, a.code, a.name, a.account_type
        order by a.account_type, a.code
      `);
      return { data: rows, error: null };
    }
    const { data, error } = await getSupabaseClient()
      .from('trial_balance')
      .select('*')
      .in('account_type', ['asset', 'liability', 'equity'])
      .order('account_type')
    if (error) throw error
    return { data, error: null };
  },

  getIncomeStatement: async () => {
    if (isLocalDbConfigured) {
      const rows = await localApi.query<any>(`
        select a.id, a.code, a.name, a.account_type,
          case when a.account_type = 'revenue'
            then coalesce(sum(case when je.status = 'posted' then jel.credit_amount else 0 end), 0) - coalesce(sum(case when je.status = 'posted' then jel.debit_amount else 0 end), 0)
            else coalesce(sum(case when je.status = 'posted' then jel.debit_amount else 0 end), 0) - coalesce(sum(case when je.status = 'posted' then jel.credit_amount else 0 end), 0)
          end as balance
        from accounts a
        left join journal_entry_lines jel on jel.account_id = a.id
        left join journal_entries je on je.id = jel.journal_entry_id
        where a.is_active = 1 and a.account_type in ('revenue', 'expense')
        group by a.id, a.code, a.name, a.account_type
        order by a.account_type, a.code
      `);
      return { data: rows, error: null };
    }
    const { data, error } = await getSupabaseClient()
      .from('trial_balance')
      .select('*')
      .in('account_type', ['revenue', 'expense'])
      .order('account_type')
    if (error) throw error
    return { data, error: null };
  },
}

// Accounting entries are validated by the server; only reading works offline.
export const accountingService = withOffline('accounting', service, {
  reads: { getAccounts: true, getAccountById: true, getPeriods: true, getActivePeriod: true, getJournalEntries: true, getJournalEntryById: true, getJournalEntryLines: true, getUnsyncedSales: true, getAdjustments: true, getAdjustmentById: true, getGeneralLedger: true, getTrialBalance: true, getAuditLog: true, getBalanceSheet: true, getIncomeStatement: true },
  onlineOnly: ['createAccount', 'updateAccount', 'deactivateAccount', 'createPeriod', 'closePeriod', 'createJournalEntry', 'updateJournalEntry', 'postJournalEntry', 'voidJournalEntry', 'syncSaleToAccounting', 'createAdjustment', 'updateAdjustment', 'submitForApproval', 'approveAdjustment'],
})
