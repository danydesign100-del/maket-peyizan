import { useEffect, useState } from 'react'
import { BookOpen, CloudOff, FileCheck2, NotebookPen, Printer, Scale, Users } from 'lucide-react'
import { PageHeader } from '../components/PageHeader'
import { TableSkeleton } from '../components/Skeleton'
import { useAuth } from '../contexts/AuthContext'
import { isLocalDbConfigured } from '../lib/supabase'
import type { Account } from '../types/accounting'
import { ACCOUNTING_ONLINE_ONLY, ledgerService } from '../services/ledgerService'
import { PeriodFilter } from '../components/PeriodFilter'
import { monthToDate, periodError, type Period } from '../lib/period'
import { TrialBalanceReport } from './reports/TrialBalanceReport'
import { AccountFormDialog } from './accounting/AccountForm'
import { AccountsTab } from './accounting/AccountsTab'
import { EntriesTab } from './accounting/EntriesTab'
import { RegularisationTab } from './accounting/RegularisationTab'
import { PartnersTab } from './accounting/PartnersTab'

type Tab = 'accounts' | 'entries' | 'regularisation' | 'partners' | 'trial'
const TABS: { id: Tab; label: string; icon: typeof BookOpen }[] = [
  { id: 'accounts', label: 'Plan comptable', icon: BookOpen },
  { id: 'entries', label: 'Écritures', icon: NotebookPen },
  { id: 'regularisation', label: 'Régularisation', icon: FileCheck2 },
  { id: 'partners', label: 'Associés', icon: Users },
  { id: 'trial', label: 'Balance', icon: Scale },
]

/** Same trial balance as the Reports page, with its own period. */
function BalanceTab() {
  const [period, setPeriod] = useState<Period>(monthToDate)
  const invalid = periodError(period)
  return <div className="space-y-4">
    <div className="no-print ui-card p-4"><PeriodFilter value={period} onChange={setPeriod} /></div>
    {invalid ? <p role="alert" className="ui-alert-error">{invalid}</p> : <TrialBalanceReport period={period} />}
  </div>
}

export function AccountingPage() {
  const { can } = useAuth()
  const canManage = can('accounting.manage')
  const [tab, setTab] = useState<Tab>('entries')
  const [accounts, setAccounts] = useState<Account[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [editing, setEditing] = useState<Account | null | undefined>(undefined)
  const [openAccount, setOpenAccount] = useState('')

  const loadAccounts = async () => {
    const { data, error: loadError } = await ledgerService.listAccounts()
    if (loadError) return setError(loadError.message)
    setAccounts(data ?? [])
  }
  useEffect(() => { if (canManage && !isLocalDbConfigured) void loadAccounts() }, [canManage])

  const toggleActive = async (account: Account) => {
    setError(null)
    const { error: toggleError } = await ledgerService.setAccountActive(account.id, !account.is_active)
    if (toggleError) return setError(toggleError.message)
    setNotice(`Compte ${account.code} ${account.is_active ? 'désactivé' : 'réactivé'}.`)
    void loadAccounts()
  }

  if (!canManage) return <div className="rounded-lg bg-red-50 p-6 text-red-800"><h2 className="text-lg font-semibold">Accès refusé</h2><p className="mt-2">Seuls les directeurs, administrateurs et comptables peuvent accéder à la comptabilité.</p></div>

  return <div>
    <PageHeader title="Comptabilité" description="Plan comptable, écritures, régularisations et consultation des comptes." />
    {isLocalDbConfigured ? <p className="mt-6 flex items-start gap-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900"><CloudOff className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />{ACCOUNTING_ONLINE_ONLY}</p> : <>
      {error && <p role="alert" className="ui-alert-error">{error}</p>}
      {notice && <p role="status" className="ui-alert-success">{notice}</p>}
      <div className="no-print mt-6 flex flex-wrap items-center justify-between gap-3 border-b border-slate-200">
        <div role="tablist" aria-label="Comptabilité" className="flex gap-1">
          {TABS.map((item) => <button key={item.id} role="tab" aria-selected={tab === item.id} onClick={() => setTab(item.id)} className={`-mb-px inline-flex items-center gap-1.5 border-b-2 px-4 py-2.5 text-sm transition ${tab === item.id ? 'border-brand-700 font-semibold text-brand-900' : 'border-transparent text-slate-600 hover:text-slate-900'}`}><item.icon className="h-4 w-4" aria-hidden="true" />{item.label}</button>)}
        </div>
        <button type="button" onClick={() => window.print()} className="ui-button-secondary mb-2 px-3 py-2"><Printer className="h-4 w-4" aria-hidden="true" />Imprimer</button>
      </div>
      <div className="mt-5">
        {accounts === null ? <TableSkeleton rows={8} cols={6} /> : <>
          {tab === 'accounts' && <AccountsTab accounts={accounts} onCreate={() => setEditing(null)} onEdit={setEditing} onToggleActive={(account) => void toggleActive(account)} onOpen={(account) => { setOpenAccount(account.id); setTab('entries') }} />}
          {tab === 'entries' && <EntriesTab key={openAccount} accounts={accounts} initialAccountId={openAccount} onEditAccount={setEditing} onToggleAccount={(account) => void toggleActive(account)} onNotice={(message) => { setError(null); setNotice(message) }} />}
          {tab === 'regularisation' && <RegularisationTab accounts={accounts} onNotice={(message) => { setError(null); setNotice(message) }} />}
          {tab === 'partners' && <PartnersTab accounts={accounts} onOpenAccount={(id) => { setOpenAccount(id); setTab('entries') }} onNotice={(message) => { setError(null); setNotice(message) }} onAccountsChanged={() => void loadAccounts()} />}
          {tab === 'trial' && <BalanceTab />}
        </>}
      </div>
      {editing !== undefined && accounts && <AccountFormDialog account={editing} accounts={accounts} onClose={() => setEditing(undefined)} onSaved={(account) => { setEditing(undefined); setNotice(`Compte ${account.code} enregistré.`); void loadAccounts() }} />}
    </>}
  </div>
}
