import { Check, Lock, Printer, X } from 'lucide-react'
import { BarList } from '../components/charts/BarList'
import { PageSkeleton } from '../components/Skeleton'
import { useEffect, useState } from 'react'
import { PageHeader } from '../components/PageHeader'
import { posService } from '../services/posService'
import { useAuth } from '../contexts/AuthContext'
import { getSupabaseClient, isLocalDbConfigured } from '../lib/supabase'
import { readCache, writeCache } from '../lib/offline/cache'
import { isNetworkError, probeConnection } from '../lib/offline/network'
import { isOnline, useSyncStatus } from '../lib/offline/status'
import { errorText } from '../lib/errors'
import { pendingSales, type OfflineSale } from '../services/offlineSales'
import { CloudOff, Clock } from 'lucide-react'
import { localApi } from '../lib/localApi'
import { formatDay } from '../lib/period'
import { PrintHeader } from '../components/PrintHeader'
import { PAYMENT_METHOD_LABELS } from '../types/pos'
import { cashService } from '../services/cashService'

type PaymentSummary = {
  method: string
  count: number
  total: number
}

type DailyReport = {
  date: string
  sessionId: string | null
  openingAmount: number
  closingAmount: number | null
  totalSales: number
  totalPayments: number
  expectedCash: number
  difference: number | null
  paymentBreakdown: PaymentSummary[]
  refundCount: number
  refundTotal: number
  cancelledCount: number
  cancelledTotal: number
  sales: any[]
}

export function DailyReceiptsPage() {
  const { profile, can } = useAuth()
  const canViewDailyReceipts = can('pos.sell')
  
  const [selectedDate, setSelectedDate] = useState(() => { const now = new Date(); now.setMinutes(now.getMinutes() - now.getTimezoneOffset()); return now.toISOString().slice(0, 10) })
  const [report, setReport] = useState<DailyReport | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [closingAmount, setClosingAmount] = useState<number | null>(null)
  const [showCloseForm, setShowCloseForm] = useState(false)
  const [success, setSuccess] = useState<string | null>(null)
  // Where the figures come from, and the sales of the day still waiting on this device.
  const [origin, setOrigin] = useState<{ kind: 'server' | 'cache' | 'none'; at: string | null }>({ kind: 'server', at: null })
  const [waiting, setWaiting] = useState<OfflineSale[]>([])
  const { online, lastSyncAt } = useSyncStatus()

  // Reloaded when the date changes, the connection returns or a synchronisation ends.
  useEffect(() => {
    void loadReport()
  }, [selectedDate, online, lastSyncAt])

  const fetchReport = async (): Promise<DailyReport> => {
    // Bounds of the selected local day, in UTC.
    const dayStart = new Date(`${selectedDate}T00:00:00`)
    const dayEnd = new Date(dayStart)
    dayEnd.setDate(dayEnd.getDate() + 1)

    if (isLocalDbConfigured) {
      // SQLite stores UTC as 'YYYY-MM-DD HH:MM:SS' or ISO; datetime() normalises both.
      const bounds = [dayStart, dayEnd].map((date) => date.toISOString().replace('T', ' ').slice(0, 19))
      const salesRows = await localApi.query<any>(`
        select s.*, c.full_name as customer_name
        from sales s
        left join customers c on c.id = s.customer_id
        where datetime(s.sold_at) >= ? and datetime(s.sold_at) < ?
        order by s.sold_at desc
      `, bounds)
      const paymentRows = await localApi.query<any>(`
        select sp.method, count(*) as count, sum(sp.amount) as total
        from payments sp
        join sales s on s.id = sp.sale_id
        where datetime(s.sold_at) >= ? and datetime(s.sold_at) < ? and s.status = 'completed'
        group by sp.method
      `, bounds)
      const sessionRows = await localApi.query<any>(`
        select * from cash_sessions
        where datetime(opened_at) >= ? and datetime(opened_at) < ?
        order by opened_at desc
        limit 1
      `, bounds)

      const session = sessionRows[0] as { id: string; opening_amount?: number; closing_amount?: number | null } | undefined
      const byStatus = (status: string) => salesRows.filter((sale: any) => sale.status === status)
      const sum = (rows: any[]) => rows.reduce((total: number, sale: any) => total + Number(sale.total_amount), 0)
      const paymentBreakdown = paymentRows.map((row: any) => ({ method: row.method, count: Number(row.count), total: Number(row.total) }))
      const cash = paymentBreakdown.find((payment) => payment.method === 'cash')?.total ?? 0
      const openingAmount = Number(session?.opening_amount ?? 0)
      const closingAmount = session?.closing_amount == null ? null : Number(session.closing_amount)
      const expectedCash = openingAmount + cash

      return {
        date: selectedDate,
        sessionId: session?.id ?? null,
        openingAmount,
        closingAmount,
        totalSales: sum(byStatus('completed')),
        totalPayments: paymentBreakdown.reduce((total, payment) => total + payment.total, 0),
        expectedCash,
        difference: closingAmount === null ? null : closingAmount - expectedCash,
        paymentBreakdown,
        refundCount: byStatus('refunded').length,
        refundTotal: sum(byStatus('refunded')),
        cancelledCount: byStatus('cancelled').length,
        cancelledTotal: sum(byStatus('cancelled')),
        sales: salesRows
      }
    } else {
      const client = getSupabaseClient()
      
      const { data: salesData, error: salesError } = await client
        .from('sales')
        .select('*, customer:customers(full_name), payments(*)')
        .gte('sold_at', dayStart.toISOString())
        .lt('sold_at', dayEnd.toISOString())
        .order('sold_at', { ascending: false })

      if (salesError) throw salesError

      const completedSales = (salesData || []).filter((s: any) => s.status === 'completed')
      const refundedSales = (salesData || []).filter((s: any) => s.status === 'refunded')
      const cancelledSales = (salesData || []).filter((s: any) => s.status === 'cancelled')

      const totalSales = completedSales.reduce((sum: number, s: any) => sum + Number(s.total_amount), 0)
      const refundTotal = refundedSales.reduce((sum: number, s: any) => sum + Number(s.total_amount), 0)
      const cancelledTotal = cancelledSales.reduce((sum: number, s: any) => sum + Number(s.total_amount), 0)

      const paymentBreakdown: PaymentSummary[] = []
      completedSales.forEach((sale: any) => {
        (sale.payments || []).forEach((payment: any) => {
          const existing = paymentBreakdown.find(p => p.method === payment.method)
          if (existing) {
            existing.count++
            existing.total += Number(payment.amount)
          } else {
            paymentBreakdown.push({
              method: payment.method,
              count: 1,
              total: Number(payment.amount)
            })
          }
        })
      })

      // Same figures as the cash report: opening + cash sales − refunds ± cash movements.
      const { data: sessions, error: sessionError } = await cashService.sessionReport(selectedDate, selectedDate, null)
      if (sessionError) throw sessionError
      const session = sessions?.[0]
      const openingAmount = Number(session?.opening_amount ?? 0)
      const cash = paymentBreakdown.find((payment) => payment.method === 'cash')?.total ?? 0

      return {
        date: selectedDate,
        sessionId: session?.session_id ?? null,
        openingAmount,
        closingAmount: session?.counted == null ? null : Number(session.counted),
        totalSales,
        totalPayments: paymentBreakdown.reduce((total, payment) => total + payment.total, 0),
        expectedCash: session ? Number(session.theoretical) : openingAmount + cash,
        difference: session?.difference == null ? null : Number(session.difference),
        paymentBreakdown,
        refundCount: refundedSales.length,
        refundTotal,
        cancelledCount: cancelledSales.length,
        cancelledTotal,
        sales: salesData || []
      }
    }
  }

  const loadReport = async () => {
    setLoading(true)
    setError(null)
    const key = `daily-report:${selectedDate}`
    try {
      // Sales of that local day not yet on the server (shown apart, added to the totals).
      const day = (sale: OfflineSale) => new Date(sale.input.soldAt ?? sale.createdAt).toLocaleDateString('en-CA')
      setWaiting((await pendingSales().catch(() => [])).filter((sale) => sale.state !== 'synced' && day(sale) === selectedDate))
      let next: DailyReport | null = null
      if (isOnline()) {
        try {
          next = await fetchReport()
          await writeCache(key, next)
          setOrigin({ kind: 'server', at: new Date().toISOString() })
        } catch (cause) {
          if (!isNetworkError(cause)) throw cause
          await probeConnection()
        }
      }
      if (!next) {
        // Offline: the last figures received for this date, if any.
        const cached = await readCache<DailyReport>(key)
        next = cached?.value ?? null
        setOrigin({ kind: cached ? 'cache' : 'none', at: cached?.savedAt ?? null })
      }
      setReport(next ?? { date: selectedDate, sessionId: null, openingAmount: 0, closingAmount: null, totalSales: 0, totalPayments: 0, expectedCash: 0, difference: null, paymentBreakdown: [], refundCount: 0, refundTotal: 0, cancelledCount: 0, cancelledTotal: 0, sales: [] })
    } catch (cause) {
      setError(errorText(cause, 'Erreur de chargement'))
    } finally {
      setLoading(false)
    }
  }
  // A pending sale is worth its items (a cash payment holds the amount tendered, change included).
  const saleTotal = (sale: OfflineSale) => sale.input.items.reduce((sum, item) => sum + item.quantity * item.unitPrice - item.discount + item.taxRate, 0)
  const waitingTotal = waiting.reduce((sum, sale) => sum + saleTotal(sale), 0)
  const waitingByMethod = waiting.reduce((map, sale) => {
    const shares = sale.input.payments.length === 1 ? [{ method: sale.input.payments[0].method, amount: saleTotal(sale) }] : sale.input.payments.map((payment) => ({ method: payment.method, amount: Number(payment.amount) }))
    for (const share of shares) map.set(share.method, { count: (map.get(share.method)?.count ?? 0) + 1, total: (map.get(share.method)?.total ?? 0) + share.amount })
    return map
  }, new Map<string, { count: number; total: number }>())

  const closeDay = async () => {
    if (!closingAmount || closingAmount < 0) return setError('Montant invalide')
    
    setLoading(true)
    setError(null)
    try {
      if (isLocalDbConfigured) {
        if (!report?.sessionId) throw new Error('Aucune session de caisse ouverte ce jour-là.')
        await localApi.mutate('update', 'cash_sessions', {
          closed_at: new Date().toISOString(),
          closing_amount: closingAmount
        }, report.sessionId)
      } else {
        await posService.closeSession(closingAmount, `Clôture journalière ${selectedDate}`)
      }
      setSuccess('Clôture enregistrée')
      setShowCloseForm(false)
      setClosingAmount(null)
      void loadReport()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Erreur de clôture')
    } finally {
      setLoading(false)
    }
  }

  const formatMoney = (value: number) => new Intl.NumberFormat('fr-HT', { style: 'currency', currency: 'HTG', maximumFractionDigits: 2 }).format(value)

  const paymentMethodLabels = PAYMENT_METHOD_LABELS

  if (!canViewDailyReceipts) {
    return (
      <div className="rounded-lg bg-red-50 p-6 text-red-800">
        <h2 className="text-lg font-semibold">Accès refusé</h2>
        <p className="mt-2">Accès réservé aux superviseurs de caisse et directeurs.</p>
      </div>
    )
  }

  const handlePrint = () => {
    window.print()
  }

  return (
    <div>
      <div className="print:hidden"><PageHeader title="Recettes journalières" description="Suivi des encaissements et contrôle de caisse" /></div>
      <PrintHeader title="Recettes journalières" period={`Journée du ${formatDay(selectedDate)}`} note={profile?.full_name ? `Imprimé par ${profile.full_name}` : undefined} />
      
      {error && <div className="mt-4 rounded bg-red-50 p-3 text-red-800">{error}</div>}
      {success && <div className="mt-4 rounded bg-emerald-50 p-3 text-emerald-800">{success}</div>}
      
      {/* Filtres */}
      <div className="no-print mt-6 flex flex-wrap items-center gap-4 rounded-xl bg-white p-4 shadow-sm ring-1 ring-slate-200">
        <div>
          <label className="block text-sm font-medium">Date</label>
          <input
            type="date"
            value={selectedDate}
            onChange={(e) => setSelectedDate(e.target.value)}
            className="mt-1 rounded border p-2"
          />
        </div>
        <button onClick={handlePrint} className="ui-button-secondary mt-5">
          <Printer className="h-4 w-4" aria-hidden="true" />Imprimer le rapport
        </button>
      </div>
      
      {loading ? (
        <PageSkeleton cards={4} rows={6} cols={5} />
      ) : report && (
        <div className="mt-6 space-y-6">
          {/* Résumé */}
          <p role="status" className={`flex items-start gap-2 rounded-xl border px-4 py-3 text-sm ${origin.kind === 'server' ? 'border-emerald-200 bg-emerald-50 text-emerald-900' : 'border-amber-200 bg-amber-50 text-amber-900'}`}>
            {origin.kind === 'server' ? <Check className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" /> : <CloudOff className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />}
            <span>{origin.kind === 'server' ? `Données du serveur, actualisées à ${origin.at ? new Date(origin.at).toLocaleTimeString('fr-HT', { hour: '2-digit', minute: '2-digit' }) : ''}.`
              : origin.kind === 'cache' ? `Hors ligne : copie locale du ${new Date(origin.at!).toLocaleString('fr-HT', { dateStyle: 'short', timeStyle: 'short' })}. Actualisation automatique au retour de la connexion.`
              : 'Hors ligne : aucune copie locale des ventes déjà synchronisées pour cette date. Seules les ventes enregistrées sur cet appareil sont affichées.'}
              {waiting.length > 0 && ` ${waiting.length} vente(s) de cet appareil en attente de synchronisation (${formatMoney(waitingTotal)}) sont incluses ci-dessous.`}</span>
          </p>
          <div className="rounded-xl bg-white p-6 shadow-sm ring-1 ring-slate-200">
            <h2 className="text-lg font-semibold">Résumé du {formatDay(report.date)}</h2>
            <div className="mt-4 grid gap-4 md:grid-cols-4">
              <div className="rounded-lg bg-slate-50 p-4">
                <p className="text-sm text-slate-600">Ventes totales</p>
                <p className="mt-1 text-2xl font-bold">{formatMoney(report.totalSales + waitingTotal)}</p>
                {waiting.length > 0 && <p className="text-xs text-amber-700">dont {formatMoney(waitingTotal)} en attente</p>}
              </div>
              <div className="rounded-lg bg-slate-50 p-4">
                <p className="text-sm text-slate-600">Encaissements</p>
                <p className="mt-1 text-2xl font-bold">{formatMoney(report.totalPayments + waitingTotal)}</p>
                {waiting.length > 0 && <p className="text-xs text-amber-700">dont {formatMoney(waitingTotal)} en attente</p>}
              </div>
              <div className="rounded-lg bg-slate-50 p-4">
                <p className="text-sm text-slate-600">Remboursements</p>
                <p className="mt-1 text-2xl font-bold text-red-600">{formatMoney(report.refundTotal)}</p>
                <p className="text-xs text-slate-500">{report.refundCount} transaction(s)</p>
              </div>
              <div className="rounded-lg bg-slate-50 p-4">
                <p className="text-sm text-slate-600">Annulations</p>
                <p className="mt-1 text-2xl font-bold text-amber-600">{formatMoney(report.cancelledTotal)}</p>
                <p className="text-xs text-slate-500">{report.cancelledCount} transaction(s)</p>
              </div>
            </div>
          </div>
          
          {/* Ventilation par moyen de paiement */}
          <div className="rounded-xl bg-white p-6 shadow-sm ring-1 ring-slate-200">
            <h2 className="text-lg font-semibold">Ventilation par moyen de paiement</h2>
            {report.paymentBreakdown.length > 0 && <div className="no-print mt-5 max-w-2xl">
              <BarList ariaLabel="Montant encaissé par moyen de paiement" formatValue={formatMoney}
                data={[...report.paymentBreakdown].sort((a, b) => b.total - a.total).map((payment) => ({ key: payment.method, label: paymentMethodLabels[payment.method] || payment.method, value: payment.total, detail: `${payment.count} paiement(s)` }))} />
            </div>}
            <div className="mt-5 overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="bg-slate-50">
                  <tr>
                    <th className="p-3">Moyen de paiement</th>
                    <th className="p-3">Nombre</th>
                    <th className="p-3">Total</th>
                  </tr>
                </thead>
                <tbody>
                  {[...waitingByMethod].map(([method, row]) => (
                    <tr key={`waiting-${method}`} className="border-t bg-amber-50/60">
                      <td className="p-3 font-medium">{paymentMethodLabels[method] || method} <span className="text-xs font-normal text-amber-700">(en attente)</span></td>
                      <td className="p-3">{row.count}</td>
                      <td className="p-3 font-medium">{formatMoney(row.total)}</td>
                    </tr>
                  ))}
                  {report.paymentBreakdown.length === 0 && waiting.length > 0 ? null : report.paymentBreakdown.length === 0 ? (
                    <tr><td colSpan={3} className="p-6 text-center text-slate-500">Aucun paiement</td></tr>
                  ) : report.paymentBreakdown.map((payment) => (
                    <tr key={payment.method} className="border-t">
                      <td className="p-3 font-medium">{paymentMethodLabels[payment.method] || payment.method}</td>
                      <td className="p-3">{payment.count}</td>
                      <td className="p-3 font-medium">{formatMoney(payment.total)}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot className="bg-slate-50 font-semibold">
                  <tr>
                    <td className="p-3">Total</td>
                    <td className="p-3">{report.paymentBreakdown.reduce((sum, p) => sum + p.count, 0) + [...waitingByMethod.values()].reduce((sum, row) => sum + row.count, 0)}</td>
                    <td className="p-3">{formatMoney(report.paymentBreakdown.reduce((sum, p) => sum + p.total, 0) + waitingTotal)}</td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </div>
          
          {waiting.length > 0 && <div className="rounded-xl bg-white p-6 shadow-sm ring-1 ring-amber-200">
            <h2 className="flex items-center gap-2 text-lg font-semibold"><Clock className="h-5 w-5 text-amber-600" aria-hidden="true" />En attente de synchronisation</h2>
            <p className="mt-1 text-sm text-slate-600">Ventes enregistrées sur cet appareil, pas encore reçues par le serveur. Elles seront envoyées automatiquement.</p>
            <ul className="mt-4 divide-y divide-slate-100 text-sm">{waiting.map((sale) => <li key={sale.id} className="flex flex-wrap justify-between gap-3 py-2">
              <span><span className="tabular-nums text-slate-500">{new Date(sale.input.soldAt ?? sale.createdAt).toLocaleTimeString('fr-HT', { hour: '2-digit', minute: '2-digit' })}</span> · {sale.input.items.map((item) => `${item.quantity} × ${item.name}`).join(', ')}
                {sale.state === 'sync_error' && <span className="block text-xs text-red-700">Refusée : {sale.lastError}</span>}</span>
              <span className="font-semibold tabular-nums">{formatMoney(saleTotal(sale))} <span className="font-normal text-slate-500">· {sale.input.payments.map((payment) => paymentMethodLabels[payment.method] || payment.method).join(', ')}</span></span>
            </li>)}</ul>
          </div>}

          {/* Contrôle de caisse */}
          <div className="rounded-xl bg-white p-6 shadow-sm ring-1 ring-slate-200">
            <h2 className="text-lg font-semibold">Contrôle de caisse</h2>
            <div className="mt-4 grid gap-4 md:grid-cols-4">
              <div>
                <p className="text-sm text-slate-600">Montant d'ouverture</p>
                <p className="mt-1 text-xl font-bold">{formatMoney(report.openingAmount)}</p>
              </div>
              <div>
                <p className="text-sm text-slate-600">Espèces attendues</p>
                <p className="mt-1 text-xl font-bold">{formatMoney(report.expectedCash)}</p>
              </div>
              <div>
                <p className="text-sm text-slate-600">Montant de clôture</p>
                <p className="mt-1 text-xl font-bold">
                  {report.closingAmount !== null ? formatMoney(report.closingAmount) : 'Non clôturé'}
                </p>
              </div>
              <div>
                <p className="text-sm text-slate-600">Écart</p>
                <p className={`mt-1 text-xl font-bold ${report.difference !== null && Math.abs(report.difference) > 0.01 ? 'text-red-600' : 'text-emerald-600'}`}>
                  {report.difference !== null ? formatMoney(report.difference) : '-'}
                </p>
              </div>
            </div>
            
            {report.closingAmount === null && (
              <div className="no-print mt-4">
                {!showCloseForm ? (
                  <button onClick={() => setShowCloseForm(true)} className="ui-button-primary">
                    <Lock className="h-4 w-4" aria-hidden="true" />Clôturer la journée
                  </button>
                ) : (
                  <div className="flex gap-3">
                    <input
                      type="number"
                      step="0.01"
                      placeholder="Montant en caisse"
                      value={closingAmount || ''}
                      onChange={(e) => setClosingAmount(Number(e.target.value))}
                      className="rounded border p-2"
                    />
                    <button onClick={() => void closeDay()} disabled={loading} className="ui-button-primary">
                      <Check className="h-4 w-4" aria-hidden="true" />Confirmer
                    </button>
                    <button onClick={() => setShowCloseForm(false)} className="ui-button-secondary">
                      <X className="h-4 w-4" aria-hidden="true" />Annuler
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>
          
          {/* Liste des ventes */}
          <div className="rounded-xl bg-white p-6 shadow-sm ring-1 ring-slate-200">
            <h2 className="text-lg font-semibold">Détail des ventes</h2>
            <div className="mt-4 overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="bg-slate-50">
                  <tr>
                    <th className="p-3">N° Vente</th>
                    <th className="p-3">Heure</th>
                    <th className="p-3">Client</th>
                    <th className="p-3">Total</th>
                    <th className="p-3">Statut</th>
                  </tr>
                </thead>
                <tbody>
                  {report.sales.length === 0 ? (
                    <tr><td colSpan={5} className="p-6 text-center text-slate-500">Aucune vente</td></tr>
                  ) : report.sales.map((sale) => (
                    <tr key={sale.id} className="border-t">
                      <td className="p-3 font-mono">{sale.sale_number || sale.id.slice(0, 8)}</td>
                      <td className="p-3">{new Date(sale.sold_at).toLocaleTimeString('fr-FR')}</td>
                      <td className="p-3">{sale.customer_name || '-'}</td>
                      <td className="p-3 font-medium">{formatMoney(Number(sale.total_amount))}</td>
                      <td className="p-3">
                        <span className={`rounded px-2 py-1 text-xs ${
                          sale.status === 'completed' ? 'bg-emerald-100 text-emerald-800' :
                          sale.status === 'refunded' ? 'bg-red-100 text-red-800' :
                          sale.status === 'cancelled' ? 'bg-amber-100 text-amber-800' :
                          'bg-slate-100 text-slate-800'
                        }`}>
                          {sale.status === 'completed' ? 'Complétée' :
                           sale.status === 'refunded' ? 'Remboursée' :
                           sale.status === 'cancelled' ? 'Annulée' : sale.status}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
