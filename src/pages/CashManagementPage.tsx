import { useEffect, useState } from 'react'
import { ArrowLeftRight, CloudOff, Coins, HandCoins } from 'lucide-react'
import { PageHeader } from '../components/PageHeader'
import { TableSkeleton } from '../components/Skeleton'
import { useAuth } from '../contexts/AuthContext'
import { isLocalDbConfigured } from '../lib/supabase'
import type { Account } from '../types/accounting'
import { ledgerService } from '../services/ledgerService'
import { MovementsTab } from './cash/MovementsTab'
import { PettyCashTab } from './cash/PettyCashTab'
import { CashReportTab } from './cash/CashReportTab'

type Tab = 'movements' | 'petty' | 'report'
const TABS: { id: Tab; label: string; icon: typeof Coins; manageOnly?: boolean }[] = [
  { id: 'movements', label: 'Mouvements', icon: ArrowLeftRight },
  { id: 'petty', label: 'Petite caisse', icon: HandCoins, manageOnly: true },
  { id: 'report', label: 'Rapport de caisse', icon: Coins },
]

export function CashManagementPage() {
  const { can } = useAuth()
  const canManage = can('cash.other_accounts')
  const allowed = canManage || can('cash.movements')
  const [tab, setTab] = useState<Tab>('movements')
  const [accounts, setAccounts] = useState<Account[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  useEffect(() => {
    if (!allowed || isLocalDbConfigured) return
    void ledgerService.listAccounts().then(({ data, error: loadError }) => loadError ? setError(loadError.message) : setAccounts((data ?? []).filter((account) => account.is_active)))
  }, [allowed])

  if (!allowed) return <div className="rounded-lg bg-red-50 p-6 text-red-800"><h2 className="text-lg font-semibold">Accès refusé</h2><p className="mt-2">Réservé aux caissiers, directeurs, administrateurs et comptables.</p></div>
  const onNotice = (message: string) => { setError(null); setNotice(message) }

  return <div>
    <PageHeader title="Mouvements de caisse" description="Dépôts, versements, sorties, petite caisse et rapport de caisse par session." />
    {isLocalDbConfigured ? <p className="mt-6 flex items-start gap-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900"><CloudOff className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />La gestion de caisse est disponible dans la version en ligne.</p> : <>
      {error && <p role="alert" className="ui-alert-error">{error}</p>}
      {notice && <p role="status" className="ui-alert-success">{notice}</p>}
      <div role="tablist" aria-label="Caisse" className="no-print mt-6 flex gap-1 border-b border-slate-200">
        {TABS.filter((item) => canManage || !item.manageOnly).map((item) => <button key={item.id} role="tab" aria-selected={tab === item.id} onClick={() => { setTab(item.id); setNotice(null) }} className={`-mb-px inline-flex items-center gap-1.5 border-b-2 px-4 py-2.5 text-sm transition ${tab === item.id ? 'border-brand-700 font-semibold text-brand-900' : 'border-transparent text-slate-600 hover:text-slate-900'}`}><item.icon className="h-4 w-4" aria-hidden="true" />{item.label}</button>)}
      </div>
      <div className="mt-5">
        {tab === 'report' ? <CashReportTab onNotice={onNotice} />
          : accounts === null ? <TableSkeleton rows={6} cols={6} />
          : tab === 'movements' ? <MovementsTab accounts={accounts} canManage={canManage} onNotice={onNotice} />
          : <PettyCashTab accounts={accounts} onNotice={onNotice} />}
      </div>
    </>}
  </div>
}
