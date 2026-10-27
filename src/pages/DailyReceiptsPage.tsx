import { useEffect, useState } from 'react'
import { PageHeader } from '../components/PageHeader'
import { posService } from '../services/posService'
import { useAuth } from '../contexts/AuthContext'
import { getSupabaseClient, isLocalDbConfigured } from '../lib/supabase'
import { localApi } from '../lib/localApi'

type PaymentSummary = {
  method: string
  count: number
  total: number
}

type DailyReport = {
  date: string
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
  const { profile } = useAuth()
  const canViewDailyReceipts = profile?.role?.code === 'director' || 
                               profile?.role?.code === 'administrator' || 
                               profile?.role?.code === 'cashier'
  
  const [selectedDate, setSelectedDate] = useState(new Date().toISOString().split('T')[0])
  const [report, setReport] = useState<DailyReport | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [closingAmount, setClosingAmount] = useState<number | null>(null)
  const [showCloseForm, setShowCloseForm] = useState(false)
  const [success, setSuccess] = useState<string | null>(null)

  useEffect(() => {
    void loadReport()
  }, [selectedDate])

  const loadReport = async () => {
    setLoading(true)
    setError(null)
    try {
      if (isLocalDbConfigured) {
        const rows = await localApi.query<any>(`
          select 
            date(s.sold_at) as report_date,
            coalesce(sum(case when s.status = 'completed' then s.total_amount else 0 end), 0) as total_sales,
            coalesce(sum(case when s.status = 'refunded' then s.total_amount else 0 end), 0) as refund_total,
            coalesce(count(case when s.status = 'refunded' then 1 end), 0) as refund_count,
            coalesce(sum(case when s.status = 'cancelled' then s.total_amount else 0 end), 0) as cancelled_total,
            coalesce(count(case when s.status = 'cancelled' then 1 end), 0) as cancelled_count,
            coalesce(
              (select sum(amount) from sale_payments sp where sp.sale_id = s.id),
              0
            ) as total_payments
          from sales s
          where date(s.sold_at) = ?
          group by date(s.sold_at)
        `, [selectedDate])
        
        if (rows.length === 0) {
          setReport({
            date: selectedDate,
            openingAmount: 0,
            closingAmount: null,
            totalSales: 0,
            totalPayments: 0,
            expectedCash: 0,
            difference: null,
            paymentBreakdown: [],
            refundCount: 0,
            refundTotal: 0,
            cancelledCount: 0,
            cancelledTotal: 0,
            sales: []
          })
          return
        }

        const paymentRows = await localApi.query<any>(`
          select 
            sp.method,
            count(*) as count,
            sum(sp.amount) as total
          from sale_payments sp
          join sales s on s.id = sp.sale_id
          where date(s.sold_at) = ? and s.status = 'completed'
          group by sp.method
        `, [selectedDate])

        const salesRows = await localApi.query<any>(`
          select s.*, c.full_name as customer_name
          from sales s
          left join customers c on c.id = s.customer_id
          where date(s.sold_at) = ?
          order by s.sold_at desc
        `, [selectedDate])

        const sessionRows = await localApi.query<any>(`
          select * from cash_sessions 
          where date(opened_at) = ? 
          order by opened_at desc 
          limit 1
        `, [selectedDate])

        const session = sessionRows[0] as { opening_amount?: number; closing_amount?: number } | null

        setReport({
          date: selectedDate,
          openingAmount: session?.opening_amount || 0,
          closingAmount: session?.closing_amount || null,
          totalSales: Number(rows[0].total_sales),
          totalPayments: Number(rows[0].total_payments),
          expectedCash: session?.opening_amount || 0,
          difference: session?.closing_amount ? Number(session.closing_amount) - (session?.opening_amount || 0) : null,
          paymentBreakdown: paymentRows.map((row: any) => ({
            method: row.method,
            count: row.count,
            total: Number(row.total)
          })),
          refundCount: Number(rows[0].refund_count),
          refundTotal: Number(rows[0].refund_total),
          cancelledCount: Number(rows[0].cancelled_count),
          cancelledTotal: Number(rows[0].cancelled_total),
          sales: salesRows
        })
      } else {
        const client = getSupabaseClient()
        
        const { data: salesData, error: salesError } = await client
          .from('sales')
          .select('*, customer:customers(full_name), payments:sale_payments(*)')
          .gte('sold_at', selectedDate)
          .lt('sold_at', new Date(new Date(selectedDate).getTime() + 24 * 60 * 60 * 1000).toISOString())
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

        const { data: sessionData } = await client
          .from('cash_sessions')
          .select('*')
          .gte('opened_at', selectedDate)
          .lt('opened_at', new Date(new Date(selectedDate).getTime() + 24 * 60 * 60 * 1000).toISOString())
          .order('opened_at', { ascending: false })
          .limit(1)

        const session = sessionData?.[0] as { opening_amount?: number; closing_amount?: number } | null

        setReport({
          date: selectedDate,
          openingAmount: session?.opening_amount || 0,
          closingAmount: session?.closing_amount || null,
          totalSales,
          totalPayments: totalSales,
          expectedCash: session?.opening_amount || 0,
          difference: session?.closing_amount ? Number(session.closing_amount) - (session?.opening_amount || 0) : null,
          paymentBreakdown,
          refundCount: refundedSales.length,
          refundTotal,
          cancelledCount: cancelledSales.length,
          cancelledTotal,
          sales: salesData || []
        })
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Erreur de chargement')
    } finally {
      setLoading(false)
    }
  }

  const closeDay = async () => {
    if (!closingAmount || closingAmount < 0) return setError('Montant invalide')
    
    setLoading(true)
    setError(null)
    try {
      if (isLocalDbConfigured) {
        await localApi.mutate('update', 'cash_sessions', {
          closed_at: new Date().toISOString(),
          closing_amount: closingAmount
        }, report?.date)
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

  const paymentMethodLabels: Record<string, string> = {
    cash: 'Espèces',
    card: 'Carte',
    moncash: 'MonCash',
    natcash: 'NatCash',
    bank_transfer: 'Virement',
    check: 'Chèque'
  }

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
      <PageHeader title="Recettes journalières" description="Suivi des encaissements et contrôle de caisse" />
      
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
          Imprimer le rapport
        </button>
      </div>
      
      {loading ? (
        <div className="mt-6 p-8">Chargement...</div>
      ) : report && (
        <div className="mt-6 space-y-6">
          {/* Résumé */}
          <div className="rounded-xl bg-white p-6 shadow-sm ring-1 ring-slate-200">
            <h2 className="text-lg font-semibold">Résumé du {new Date(report.date).toLocaleDateString('fr-FR')}</h2>
            <div className="mt-4 grid gap-4 md:grid-cols-4">
              <div className="rounded-lg bg-slate-50 p-4">
                <p className="text-sm text-slate-600">Ventes totales</p>
                <p className="mt-1 text-2xl font-bold">{formatMoney(report.totalSales)}</p>
              </div>
              <div className="rounded-lg bg-slate-50 p-4">
                <p className="text-sm text-slate-600">Encaissements</p>
                <p className="mt-1 text-2xl font-bold">{formatMoney(report.totalPayments)}</p>
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
            <div className="mt-4 overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="bg-slate-50">
                  <tr>
                    <th className="p-3">Moyen de paiement</th>
                    <th className="p-3">Nombre</th>
                    <th className="p-3">Total</th>
                  </tr>
                </thead>
                <tbody>
                  {report.paymentBreakdown.length === 0 ? (
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
                    <td className="p-3">{report.paymentBreakdown.reduce((sum, p) => sum + p.count, 0)}</td>
                    <td className="p-3">{formatMoney(report.paymentBreakdown.reduce((sum, p) => sum + p.total, 0))}</td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </div>
          
          {/* Contrôle de caisse */}
          <div className="rounded-xl bg-white p-6 shadow-sm ring-1 ring-slate-200">
            <h2 className="text-lg font-semibold">Contrôle de caisse</h2>
            <div className="mt-4 grid gap-4 md:grid-cols-3">
              <div>
                <p className="text-sm text-slate-600">Montant d'ouverture</p>
                <p className="mt-1 text-xl font-bold">{formatMoney(report.openingAmount)}</p>
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
                  {report.difference !== null ? formatMoney(report.difference) : '—'}
                </p>
              </div>
            </div>
            
            {!report.closingAmount && (
              <div className="no-print mt-4">
                {!showCloseForm ? (
                  <button onClick={() => setShowCloseForm(true)} className="ui-button-primary">
                    Clôturer la journée
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
                      Confirmer
                    </button>
                    <button onClick={() => setShowCloseForm(false)} className="ui-button-secondary">
                      Annuler
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
                      <td className="p-3">{sale.customer_name || '—'}</td>
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
