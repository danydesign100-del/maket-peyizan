import { useEffect, useState } from 'react'
import { PageHeader } from '../components/PageHeader'
import { accountingService } from '../services/accountingService'
import { useAuth } from '../contexts/AuthContext'

export function ReportsPage() {
  const { profile } = useAuth()
  const canViewReports = profile?.role?.code === 'director' || profile?.role?.code === 'administrator' || profile?.role?.code === 'accountant'
  
  const [tab, setTab] = useState<'trial' | 'ledger' | 'balance' | 'income' | 'audit'>('trial')
  const [trialBalance, setTrialBalance] = useState<any[]>([])
  const [ledger, setLedger] = useState<any[]>([])
  const [balanceSheet, setBalanceSheet] = useState<any[]>([])
  const [incomeStatement, setIncomeStatement] = useState<any[]>([])
  const [auditLog, setAuditLog] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  
  useEffect(() => {
    void loadData()
  }, [tab])
  
  const loadData = async () => {
    setLoading(true)
    setError(null)
    try {
      if (tab === 'trial') {
        const { data, error: requestError } = await accountingService.getTrialBalance()
        if (requestError) throw requestError
        setTrialBalance(data || [])
      } else if (tab === 'ledger') {
        const { data, error: requestError } = await accountingService.getGeneralLedger()
        if (requestError) throw requestError
        setLedger(data || [])
      } else if (tab === 'balance') {
        const { data, error: requestError } = await accountingService.getBalanceSheet()
        if (requestError) throw requestError
        setBalanceSheet(data || [])
      } else if (tab === 'income') {
        const { data, error: requestError } = await accountingService.getIncomeStatement()
        if (requestError) throw requestError
        setIncomeStatement(data || [])
      } else if (tab === 'audit') {
        const { data, error: requestError } = await accountingService.getAuditLog({ page: 0 })
        if (requestError) throw requestError
        setAuditLog(data || [])
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Erreur de chargement')
    } finally {
      setLoading(false)
    }
  }
  
  const formatMoney = (value: number) => new Intl.NumberFormat('fr-HT', { style: 'currency', currency: 'HTG', maximumFractionDigits: 2 }).format(value)
  
  const accountTypeLabels: Record<string, string> = {
    asset: 'Actif',
    liability: 'Passif',
    equity: 'Capitaux propres',
    revenue: 'Revenus',
    expense: 'Charges'
  }
  
  if (!canViewReports) {
    return (
      <div className="rounded-lg bg-red-50 p-6 text-red-800">
        <h2 className="text-lg font-semibold">Accès refusé</h2>
        <p className="mt-2">Seuls les directeurs et comptables peuvent accéder aux rapports.</p>
      </div>
    )
  }
  
  const handlePrint = () => {
    window.print()
  }

  return (
    <div>
      <PageHeader title="Rapports financiers" description="Balance, grand livre, bilan et compte de résultat" />
      
      {error && <div className="mt-4 rounded bg-red-50 p-3 text-red-800">{error}</div>}
      
      <div className="no-print mt-4 flex gap-3">
        <button onClick={handlePrint} className="ui-button-secondary">
          Imprimer le rapport
        </button>
      </div>
      
      {/* Tabs */}
      <div className="mt-6 flex flex-wrap gap-2 border-b">
        <button
          onClick={() => setTab('trial')}
          className={`px-4 py-2 ${tab === 'trial' ? 'border-b-2 border-brand-700 font-semibold' : ''}`}
        >
          Balance
        </button>
        <button
          onClick={() => setTab('ledger')}
          className={`px-4 py-2 ${tab === 'ledger' ? 'border-b-2 border-brand-700 font-semibold' : ''}`}
        >
          Grand livre
        </button>
        <button
          onClick={() => setTab('balance')}
          className={`px-4 py-2 ${tab === 'balance' ? 'border-b-2 border-brand-700 font-semibold' : ''}`}
        >
          Bilan
        </button>
        <button
          onClick={() => setTab('income')}
          className={`px-4 py-2 ${tab === 'income' ? 'border-b-2 border-brand-700 font-semibold' : ''}`}
        >
          Résultat
        </button>
        {(profile?.role?.code === 'director' || profile?.role?.code === 'administrator') && (
          <button
            onClick={() => setTab('audit')}
            className={`px-4 py-2 ${tab === 'audit' ? 'border-b-2 border-brand-700 font-semibold' : ''}`}
          >
            Audit
          </button>
        )}
      </div>
      
      {loading ? (
        <div className="mt-6 p-8">Chargement...</div>
      ) : (
        <div className="mt-6">
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
                      <td className="p-3">{account.account_type}</td>
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
          
          {tab === 'ledger' && (
            <div className="overflow-x-auto rounded-xl bg-white shadow-sm ring-1 ring-slate-200">
              <table className="w-full text-left text-sm">
                <thead className="bg-slate-50">
                  <tr>
                    <th className="p-3">Date</th>
                    <th className="p-3">N° Écriture</th>
                    <th className="p-3">Compte</th>
                    <th className="p-3">Description</th>
                    <th className="p-3">Débit</th>
                    <th className="p-3">Crédit</th>
                  </tr>
                </thead>
                <tbody>
                  {ledger.length === 0 ? (
                    <tr><td colSpan={6} className="p-6 text-center text-slate-500">Aucune écriture</td></tr>
                  ) : ledger.map((entry) => (
                    <tr key={`${entry.entry_id}-${entry.line_number}`} className="border-t">
                      <td className="p-3">{new Date(entry.entry_date).toLocaleDateString()}</td>
                      <td className="p-3 font-mono">{entry.entry_number}</td>
                      <td className="p-3 font-mono">{entry.account_code}</td>
                      <td className="p-3">{entry.line_description || entry.entry_description}</td>
                      <td className="p-3">{entry.debit_amount > 0 ? entry.debit_amount.toFixed(2) + ' HTG' : '—'}</td>
                      <td className="p-3">{entry.credit_amount > 0 ? entry.credit_amount.toFixed(2) + ' HTG' : '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          
          {tab === 'balance' && (
            <div className="space-y-6">
              {['asset', 'liability', 'equity'].map((type) => {
                const accounts = balanceSheet.filter((a) => a.account_type === type)
                if (accounts.length === 0) return null
                const total = accounts.reduce((sum, a) => sum + Number(a.balance), 0)
                return (
                  <div key={type} className="rounded-xl bg-white shadow-sm ring-1 ring-slate-200">
                    <div className="border-b border-slate-200 bg-slate-50 px-4 py-3">
                      <h3 className="font-semibold text-slate-950">{accountTypeLabels[type]}</h3>
                    </div>
                    <table className="w-full text-left text-sm">
                      <tbody>
                        {accounts.map((account) => (
                          <tr key={account.id} className="border-t">
                            <td className="p-3 font-mono">{account.code}</td>
                            <td className="p-3">{account.name}</td>
                            <td className="p-3 text-right font-medium">{formatMoney(Number(account.balance))}</td>
                          </tr>
                        ))}
                      </tbody>
                      <tfoot className="bg-slate-50 font-semibold">
                        <tr>
                          <td colSpan={2} className="p-3">Total {accountTypeLabels[type]}</td>
                          <td className="p-3 text-right">{formatMoney(total)}</td>
                        </tr>
                      </tfoot>
                    </table>
                  </div>
                )
              })}
              <div className="rounded-xl bg-brand-950 p-6 text-white">
                <h3 className="font-semibold">Total Actif = Total Passif + Capitaux propres</h3>
                <p className="mt-2 text-2xl font-bold">
                  {formatMoney(balanceSheet.filter((a) => a.account_type === 'asset').reduce((sum, a) => sum + Number(a.balance), 0))}
                </p>
              </div>
            </div>
          )}
          
          {tab === 'income' && (
            <div className="space-y-6">
              {['revenue', 'expense'].map((type) => {
                const accounts = incomeStatement.filter((a) => a.account_type === type)
                if (accounts.length === 0) return null
                const total = accounts.reduce((sum, a) => sum + Number(a.balance), 0)
                return (
                  <div key={type} className="rounded-xl bg-white shadow-sm ring-1 ring-slate-200">
                    <div className="border-b border-slate-200 bg-slate-50 px-4 py-3">
                      <h3 className="font-semibold text-slate-950">{accountTypeLabels[type]}</h3>
                    </div>
                    <table className="w-full text-left text-sm">
                      <tbody>
                        {accounts.map((account) => (
                          <tr key={account.id} className="border-t">
                            <td className="p-3 font-mono">{account.code}</td>
                            <td className="p-3">{account.name}</td>
                            <td className="p-3 text-right font-medium">{formatMoney(Number(account.balance))}</td>
                          </tr>
                        ))}
                      </tbody>
                      <tfoot className="bg-slate-50 font-semibold">
                        <tr>
                          <td colSpan={2} className="p-3">Total {accountTypeLabels[type]}</td>
                          <td className="p-3 text-right">{formatMoney(total)}</td>
                        </tr>
                      </tfoot>
                    </table>
                  </div>
                )
              })}
              <div className="rounded-xl bg-brand-950 p-6 text-white">
                <h3 className="font-semibold">Résultat net</h3>
                <p className="mt-2 text-2xl font-bold">
                  {formatMoney(
                    incomeStatement.filter((a) => a.account_type === 'revenue').reduce((sum, a) => sum + Number(a.balance), 0) -
                    incomeStatement.filter((a) => a.account_type === 'expense').reduce((sum, a) => sum + Number(a.balance), 0)
                  )}
                </p>
              </div>
            </div>
          )}
          
          {tab === 'audit' && (
            <div className="overflow-x-auto rounded-xl bg-white shadow-sm ring-1 ring-slate-200">
              <table className="w-full text-left text-sm">
                <thead className="bg-slate-50">
                  <tr>
                    <th className="p-3">Date</th>
                    <th className="p-3">Utilisateur</th>
                    <th className="p-3">Action</th>
                    <th className="p-3">Entité</th>
                    <th className="p-3">Succès</th>
                  </tr>
                </thead>
                <tbody>
                  {auditLog.length === 0 ? (
                    <tr><td colSpan={5} className="p-6 text-center text-slate-500">Aucune entrée d'audit</td></tr>
                  ) : auditLog.map((log) => (
                    <tr key={log.id} className="border-t">
                      <td className="p-3">{new Date(log.created_at).toLocaleString()}</td>
                      <td className="p-3">{log.profile?.full_name || log.profile_name || '—'}</td>
                      <td className="p-3">{log.action}</td>
                      <td className="p-3">{log.entity_type}</td>
                      <td className="p-3">
                        {log.success ? (
                          <span className="text-emerald-600">✓</span>
                        ) : (
                          <span className="text-red-600">✗</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
