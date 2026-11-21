import { useState } from 'react'
import { CloudOff, FileCheck2, Landmark, ReceiptText, Scale, ShieldCheck, TrendingUp, Users } from 'lucide-react'
import { PageHeader } from '../components/PageHeader'
import { PeriodFilter } from '../components/PeriodFilter'
import { useAuth } from '../contexts/AuthContext'
import { isLocalDbConfigured } from '../lib/supabase'
import { monthToDate, periodError, type Period } from '../lib/period'
import { ACCOUNTING_ONLINE_ONLY } from '../services/ledgerService'
import { AuditLogReport } from './reports/AuditLogReport'
import { BalanceSheetReport } from './reports/BalanceSheetReport'
import { IncomeStatementReport } from './reports/IncomeStatementReport'
import { RegularisationBalanceReport } from './reports/RegularisationBalanceReport'
import { TrialBalanceReport } from './reports/TrialBalanceReport'
import { PartnersEquityReport } from './reports/PartnersEquityReport'
import { SalesReport } from './reports/SalesReport'

type Tab = 'trial' | 'regularisation' | 'income' | 'sales' | 'balance' | 'partners' | 'audit'
const TABS: { id: Tab; label: string; icon: typeof Scale; auditOnly?: boolean }[] = [
  { id: 'trial', label: 'Balance de vérification', icon: Scale },
  { id: 'regularisation', label: 'Balance de régularisation', icon: FileCheck2 },
  { id: 'income', label: 'État des résultats', icon: TrendingUp },
  { id: 'sales', label: 'Ventes', icon: ReceiptText },
  { id: 'balance', label: 'Bilan', icon: Landmark },
  { id: 'partners', label: 'Avoir des associés', icon: Users },
  { id: 'audit', label: 'Journal d’audit', icon: ShieldCheck, auditOnly: true },
]

/**
 * Accounting reports. Every report reads account_balances() over the same posted
 * entries, so their figures always agree. Order of work: trial balance before
 * regularisation → validated regularisations → regularisation balance → statements.
 */
export function ReportsPage() {
  const { can } = useAuth()
  const canViewReports = can('accounting.manage')
  const [tab, setTab] = useState<Tab>('trial')
  const [period, setPeriod] = useState<Period>(monthToDate)
  const invalid = periodError(period)

  if (!canViewReports) return <div className="rounded-lg bg-red-50 p-6 text-red-800"><h2 className="text-lg font-semibold">Accès refusé</h2><p className="mt-2">Seuls les directeurs, administrateurs et comptables peuvent consulter les rapports.</p></div>

  return <div>
    <PageHeader title="Rapports comptables" description="États financiers et balances à partir des écritures validées, sur la période choisie." />
    {isLocalDbConfigured ? <p className="mt-6 flex items-start gap-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900"><CloudOff className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />{ACCOUNTING_ONLINE_ONLY}</p> : <>
      <div className="no-print mt-6 flex flex-wrap items-end justify-between gap-4">
        <div role="tablist" aria-label="Rapports" className="flex flex-wrap gap-1 rounded-xl border border-slate-200 bg-white p-1 shadow-sm">
          {TABS.filter((item) => !item.auditOnly || can('audit.view')).map((item) => <button key={item.id} role="tab" aria-selected={tab === item.id} onClick={() => setTab(item.id)}
            className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-sm transition ${tab === item.id ? 'bg-brand-700 font-semibold text-white' : 'text-slate-600 hover:bg-slate-50 hover:text-slate-900'}`}><item.icon className="h-4 w-4" aria-hidden="true" />{item.label}</button>)}
        </div>
        <div>
          <PeriodFilter value={period} onChange={setPeriod} />
          {tab === 'balance' && <p className="mt-1 text-xs text-slate-500">Le bilan est établi à la date « Au ».</p>}
        </div>
      </div>
      <div className="mt-5">
        {invalid ? <p role="alert" className="ui-alert-error">{invalid}</p> : <>
          {tab === 'trial' && <TrialBalanceReport period={period} />}
          {tab === 'regularisation' && <RegularisationBalanceReport period={period} />}
          {tab === 'income' && <IncomeStatementReport period={period} />}
          {tab === 'sales' && <SalesReport period={period} />}
          {tab === 'balance' && <BalanceSheetReport date={period.to} onOpenTrialBalance={() => setTab('trial')} />}
          {tab === 'partners' && <PartnersEquityReport period={period} />}
          {tab === 'audit' && <AuditLogReport period={period} />}
        </>}
      </div>
    </>}
  </div>
}
