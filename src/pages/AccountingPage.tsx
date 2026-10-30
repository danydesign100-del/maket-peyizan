import { BookOpen, Check, NotebookPen, Printer, Scale } from 'lucide-react'
import { TableSkeleton } from '../components/Skeleton'
import { useEffect, useState } from 'react'
import { PageHeader } from '../components/PageHeader'
import { accountingService } from '../services/accountingService'
import { useAuth } from '../contexts/AuthContext'
import type { Account, AccountType, JournalEntry, TrialBalanceEntry } from '../types/accounting'

export function AccountingPage() {
  const { profile } = useAuth()
  const canManage = profile?.role?.code === 'director' || profile?.role?.code === 'administrator' || profile?.role?.code === 'accountant'
  
  const [tab, setTab] = useState<'accounts' | 'entries' | 'trial'>('accounts')
  const [accounts, setAccounts] = useState<Account[]>([])
  const [entries, setEntries] = useState<JournalEntry[]>([])
  const [trialBalance, setTrialBalance] = useState<TrialBalanceEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  
  useEffect(() => {
    void loadData()
  }, [tab])
  
  const loadData = async () => {
    setLoading(true)
    setError(null)
    try {
      if (tab === 'accounts') {
        const { data, error: requestError } = await accountingService.getAccounts({ active: true })
        if (requestError) throw requestError
        setAccounts((data || []) as Account[])
      } else if (tab === 'entries') {
        const { data, error: requestError } = await accountingService.getJournalEntries({ status: 'draft' })
        if (requestError) throw requestError
        setEntries((data || []) as JournalEntry[])
      } else if (tab === 'trial') {
        const { data, error: requestError } = await accountingService.getTrialBalance()
        if (requestError) throw requestError
        setTrialBalance((data || []) as TrialBalanceEntry[])
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Erreur de chargement')
    } finally {
      setLoading(false)
    }
  }
  
  const accountTypeLabels: Record<AccountType, string> = {
    asset: 'Actif',
    liability: 'Passif',
    equity: 'Capitaux propres',
    revenue: 'Revenus',
    expense: 'Charges'
  }
  
  const postEntry = async (entryId: string) => {
    try {
      await accountingService.postJournalEntry(entryId)
      await loadData()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Erreur de validation')
    }
  }
  
  if (!canManage) {
    return (
      <div className="rounded-lg bg-red-50 p-6 text-red-800">
        <h2 className="text-lg font-semibold">Accès refusé</h2>
        <p className="mt-2">Seuls les directeurs et comptables peuvent accéder à la comptabilité.</p>
      </div>
    )
  }

  const handlePrint = () => {
    window.print()
  }
  
  return (
    <div>
      <PageHeader title="Comptabilité" description="Plan comptable et écritures comptables" />
      
      {error && <div className="mt-4 rounded bg-red-50 p-3 text-red-800">{error}</div>}
      
      <div className="no-print mt-4 flex gap-3">
        <button onClick={handlePrint} className="ui-button-secondary">
          <Printer className="h-4 w-4" aria-hidden="true" />Imprimer le rapport
        </button>
      </div>
      
      {/* Tabs */}
      <div className="mt-6 flex gap-2 border-b">
        <button
          onClick={() => setTab('accounts')}
          className={`inline-flex items-center gap-1.5 px-4 py-2 ${tab === 'accounts' ? 'border-b-2 border-brand-700 font-semibold' : ''}`}
        >
          <BookOpen className="h-4 w-4" aria-hidden="true" />Plan comptable
        </button>
        <button
          onClick={() => setTab('entries')}
          className={`inline-flex items-center gap-1.5 px-4 py-2 ${tab === 'entries' ? 'border-b-2 border-brand-700 font-semibold' : ''}`}
        >
          <NotebookPen className="h-4 w-4" aria-hidden="true" />Écritures
        </button>
        <button
          onClick={() => setTab('trial')}
          className={`inline-flex items-center gap-1.5 px-4 py-2 ${tab === 'trial' ? 'border-b-2 border-brand-700 font-semibold' : ''}`}
        >
          <Scale className="h-4 w-4" aria-hidden="true" />Balance
        </button>
      </div>
      
      {loading ? (
        <TableSkeleton rows={8} cols={5} />
      ) : (
        <div className="mt-6">
          {tab === 'accounts' && (
            <div className="overflow-x-auto rounded-xl bg-white shadow-sm ring-1 ring-slate-200">
              <table className="w-full text-left text-sm">
                <thead className="bg-slate-50">
                  <tr>
                    <th className="p-3">Code</th>
                    <th className="p-3">Nom</th>
                    <th className="p-3">Type</th>
                    <th className="p-3">Actif</th>
                  </tr>
                </thead>
                <tbody>
                  {accounts.map((account) => (
                    <tr key={account.id} className="border-t">
                      <td className="p-3 font-mono">{account.code}</td>
                      <td className="p-3">{account.name}</td>
                      <td className="p-3">{accountTypeLabels[account.account_type]}</td>
                      <td className="p-3">{account.is_active ? '✓' : '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          
          {tab === 'entries' && (
            <div className="overflow-x-auto rounded-xl bg-white shadow-sm ring-1 ring-slate-200">
              <table className="w-full text-left text-sm">
                <thead className="bg-slate-50">
                  <tr>
                    <th className="p-3">N°</th>
                    <th className="p-3">Date</th>
                    <th className="p-3">Description</th>
                    <th className="p-3">Débit</th>
                    <th className="p-3">Crédit</th>
                    <th className="p-3">Statut</th>
                    <th className="p-3">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {entries.length === 0 ? (
                    <tr><td colSpan={7} className="p-6 text-center text-slate-500">Aucune écriture en brouillon</td></tr>
                  ) : entries.map((entry) => (
                    <tr key={entry.id} className="border-t">
                      <td className="p-3 font-mono">{entry.entry_number}</td>
                      <td className="p-3">{entry.entry_date}</td>
                      <td className="p-3">{entry.description}</td>
                      <td className="p-3">{Number(entry.total_debit).toFixed(2)} HTG</td>
                      <td className="p-3">{Number(entry.total_credit).toFixed(2)} HTG</td>
                      <td className="p-3">
                        <span className={`rounded px-2 py-1 text-xs ${
                          entry.status === 'posted' ? 'bg-emerald-100 text-emerald-800' :
                          entry.status === 'voided' ? 'bg-red-100 text-red-800' :
                          'bg-amber-100 text-amber-800'
                        }`}>
                          {entry.status === 'posted' ? 'Validée' :
                           entry.status === 'voided' ? 'Annulée' : 'Brouillon'}
                        </span>
                      </td>
                      <td className="p-3">
                        {entry.status === 'draft' && (
                          <button
                            onClick={() => void postEntry(entry.id)}
                            className="inline-flex items-center gap-1.5 text-brand-700 hover:text-brand-900"
                          >
                            <Check className="h-4 w-4" aria-hidden="true" />Valider
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          
          {tab === 'trial' && (
            <div className="overflow-x-auto rounded-xl bg-white shadow-sm ring-1 ring-slate-200">
              <table className="w-full text-left text-sm">
                <thead className="bg-slate-50">
                  <tr>
                    <th className="p-3">Code</th>
                    <th className="p-3">Compte</th>
                    <th className="p-3">Type</th>
                    <th className="p-3">Total Débit</th>
                    <th className="p-3">Total Crédit</th>
                    <th className="p-3">Solde</th>
                  </tr>
                </thead>
                <tbody>
                  {trialBalance.map((account) => (
                    <tr key={account.account_id} className="border-t">
                      <td className="p-3 font-mono">{account.code}</td>
                      <td className="p-3">{account.name}</td>
                      <td className="p-3">{accountTypeLabels[account.account_type]}</td>
                      <td className="p-3">{Number(account.total_debit).toFixed(2)} HTG</td>
                      <td className="p-3">{Number(account.total_credit).toFixed(2)} HTG</td>
                      <td className="p-3 font-medium">{Number(account.balance).toFixed(2)} HTG</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot className="bg-slate-50 font-semibold">
                  <tr>
                    <td colSpan={3} className="p-3">Totaux</td>
                    <td className="p-3">{trialBalance.reduce((sum, a) => sum + Number(a.total_debit), 0).toFixed(2)} HTG</td>
                    <td className="p-3">{trialBalance.reduce((sum, a) => sum + Number(a.total_credit), 0).toFixed(2)} HTG</td>
                    <td className="p-3">{trialBalance.reduce((sum, a) => sum + Number(a.balance), 0).toFixed(2)} HTG</td>
                  </tr>
                </tfoot>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
