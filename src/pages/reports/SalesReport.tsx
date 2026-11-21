import { useEffect, useState } from 'react'
import { AlertTriangle, CheckCircle2, ReceiptText, RefreshCw } from 'lucide-react'
import { CardsSkeleton } from '../../components/Skeleton'
import { useAuth } from '../../contexts/AuthContext'
import { describePeriod, formatDateTime, periodError, type Period } from '../../lib/period'
import { downloadSheet } from '../../lib/spreadsheet'
import { incomeStatement, salesOf, salesSummary, type SaleRecord, type SalesCategory } from '../../lib/statements'
import { formatAmount, ledgerService } from '../../services/ledgerService'
import type { AccountBalance } from '../../types/accounting'
import { ReportFrame } from './ReportFrame'
import { PAYMENT_METHOD_LABELS } from '../../types/pos'

const METHOD_LABELS = PAYMENT_METHOD_LABELS
const STATUS_LABELS: Record<string, string> = { completed: 'Terminée', refunded: 'Retournée', cancelled: 'Annulée' }

type RowProps = { label: string; value: number; category?: SalesCategory; sign?: string; strong?: boolean; hint?: string; onOpen: (category: SalesCategory) => void }
/** One line of the gross-to-net table; a line with a category opens its sales. */
function Row({ label, value, category, sign = '', strong = false, hint, onOpen }: RowProps) {
  return <tr className={strong ? 'border-t-2 border-slate-300 bg-slate-50 text-base font-bold' : ''}>
    <td>{category ? <button type="button" onClick={() => onOpen(category)} className="text-left hover:text-brand-700 hover:underline">{label}</button> : label}{hint && <span className="block text-xs font-normal text-slate-500">{hint}</span>}</td>
    <td className="whitespace-nowrap text-right tabular-nums">{sign}{formatAmount(value)}</td>
  </tr>
}

/** Rapport des ventes: gross to net sales with each deduction shown, reconciled with the accounts. */
export function SalesReport({ period }: { period: Period }) {
  const { can } = useAuth()
  const [sales, setSales] = useState<SaleRecord[] | null>(null)
  const [balances, setBalances] = useState<AccountBalance[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [detail, setDetail] = useState<SalesCategory | null>(null)
  const [refresh, setRefresh] = useState(0)
  const [posting, setPosting] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)

  useEffect(() => {
    if (periodError(period)) return
    setSales(null); setError(null)
    void Promise.all([ledgerService.salesForPeriod(period.from, period.to), ledgerService.balances(period.from || null, period.to || null)]).then(([list, totals]) => {
      if (list.error) return setError(list.error.message)
      setSales(list.data ?? []); setBalances(totals.data ?? null)
    })
  }, [period, refresh])

  const summary = sales ? salesSummary(sales) : null
  const accounting = balances ? incomeStatement(balances) : null
  const consistent = summary && accounting ? Math.abs(summary.netSales - accounting.netSales) < 0.005 : true

  const postPending = async () => {
    setPosting(true); setNotice(null)
    const { data, error: postError } = await ledgerService.journalizePending(period.from, period.to)
    setPosting(false)
    if (postError) return setError(postError.message)
    setNotice(`${data?.journalized ?? 0} opération(s) comptabilisée(s)${data?.failed ? `, ${data.failed} en erreur : ${data.errors.map((item) => `${item.operation} (${item.error})`).join(' ; ')}` : ''}.`)
    setRefresh((value) => value + 1)
  }

  const exportSheet = () => summary && sales && void downloadSheet(`ventes-${period.from}-${period.to}.xlsx`, 'Ventes', [
    ['Rubrique', 'Montant (HTG)'], ['Ventes brutes', summary.grossSales], ['Remises', -summary.discounts], ['Commissions (non enregistrées)', 0], ['Retours', -summary.returns], ['Annulations', -summary.cancellations], ['Ventes nettes', summary.netSales], ['TVA collectée', summary.taxCollected], ['Encaissé (ventes terminées)', summary.collected],
    [], ['N° de vente', 'Date', 'Client', 'Statut', 'Brut', 'Remise', 'TVA', 'Total', 'Comptabilisée'],
    ...sales.map((sale) => [sale.sale_number, formatDateTime(sale.sold_at), sale.customer?.full_name ?? '', STATUS_LABELS[sale.status] ?? sale.status, Number(sale.subtotal), Number(sale.discount_amount), Number(sale.tax_amount), Number(sale.total_amount), sale.accounting_synced ? 'oui' : 'non']),
  ])

  const open = (category: SalesCategory) => setDetail(detail === category ? null : category)
  const detailSales = sales && detail ? salesOf(sales, detail) : []
  return <ReportFrame title="Rapport des ventes" period={describePeriod(period)} icon={ReceiptText} subtitle="ventes enregistrées à la caisse" onExport={summary ? exportSheet : undefined}>
    {error && <p role="alert" className="ui-alert-error mx-5">{error}</p>}
    {notice && <p role="status" className="ui-alert-success mx-5">{notice}</p>}
    {!summary ? <CardsSkeleton count={3} className="grid gap-4 p-5 sm:grid-cols-3" /> : <>
      <div className="grid gap-6 p-5 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)] print:grid-cols-1 print:px-0">
        <table className="ui-table report-table text-sm">
          <thead><tr><th>Des ventes brutes aux ventes nettes (hors TVA)</th><th className="text-right">HTG</th></tr></thead>
          <tbody>
            <Row onOpen={open} label={`Ventes brutes (${summary.count} vente(s))`} value={summary.grossSales} category="all" />
            <Row onOpen={open} label="Remises accordées" value={summary.discounts} sign="− " category="discounted" />
            <Row onOpen={open} label="Commissions" value={summary.commissions} sign="− " hint="Non enregistrées par l’application : à comptabiliser selon leur nature, une seule fois." />
            <Row onOpen={open} label={`Retours (${summary.refundedCount})`} value={summary.returns} sign="− " category="refunded" />
            <Row onOpen={open} label={`Annulations (${summary.cancelledCount})`} value={summary.cancellations} sign="− " category="cancelled" />
            <Row onOpen={open} label="Ventes nettes" value={summary.netSales} strong />
            <Row onOpen={open} label="TVA collectée" value={summary.taxCollected} hint="Hors ventes nettes, due à l’État" />
            <Row onOpen={open} label={`Encaissé - ventes terminées (${summary.completedCount})`} value={summary.collected} category="completed" />
          </tbody>
        </table>
        <div className="space-y-4">
          <table className="ui-table report-table text-sm">
            <thead><tr><th>Encaissements par moyen de paiement</th><th className="text-right">HTG</th></tr></thead>
            <tbody>{summary.byMethod.length === 0 ? <tr><td colSpan={2} className="ui-empty py-4">Aucun encaissement</td></tr> : summary.byMethod.map((item) => <tr key={item.method}><td>{METHOD_LABELS[item.method] ?? item.method}</td><td className="text-right tabular-nums">{formatAmount(item.amount)}</td></tr>)}</tbody>
          </table>
          {accounting && <div className={`rounded-lg border p-4 text-sm ${consistent ? 'border-emerald-200 bg-emerald-50 text-emerald-900' : 'border-amber-200 bg-amber-50 text-amber-900'}`}>
            <p className="flex items-center gap-2 font-semibold">{consistent ? <CheckCircle2 className="h-4 w-4" aria-hidden="true" /> : <AlertTriangle className="h-4 w-4" aria-hidden="true" />}Rapprochement avec la comptabilité</p>
            <p className="mt-1">Ventes nettes comptabilisées (état des résultats) : <strong className="tabular-nums">{formatAmount(accounting.netSales)}</strong>{consistent ? ' - identiques.' : ` - écart de ${formatAmount(Math.abs(summary.netSales - accounting.netSales))}.`}</p>
            {summary.pending.length > 0 && <p className="mt-1"><button type="button" onClick={() => setDetail('pending')} className="font-semibold underline">{summary.pending.length} vente(s) non comptabilisée(s)</button>{summary.pending.some((sale) => sale.accounting_error) ? ' (voir les erreurs)' : ''}.</p>}
            {!consistent && summary.pending.length === 0 && <p className="mt-1 text-xs">Des écritures manuelles sur les comptes de ventes (401, 408, 409) expliquent l’écart : vérifiez la balance de vérification.</p>}
            {summary.pending.length > 0 && can('accounting.manage') && <button type="button" onClick={() => void postPending()} disabled={posting} className="no-print ui-button-secondary mt-3 px-3 py-2"><RefreshCw className={`h-4 w-4 ${posting ? 'animate-spin' : ''}`} aria-hidden="true" />{posting ? 'Comptabilisation…' : 'Comptabiliser les opérations en attente'}</button>}
          </div>}
        </div>
      </div>
      {detail && <div className="border-t border-slate-200">
        <p className="flex items-center justify-between px-5 py-3 text-sm font-semibold text-slate-900">Détail : {{ all: 'toutes les ventes', discounted: 'ventes avec remise', refunded: 'retours', cancelled: 'annulations', completed: 'ventes terminées', pending: 'ventes non comptabilisées' }[detail]} ({detailSales.length})<button type="button" onClick={() => setDetail(null)} className="no-print text-xs font-medium text-slate-500 hover:text-slate-800">Fermer</button></p>
        <div className="max-h-96 overflow-auto">
          <table className="ui-table report-table text-sm">
            <thead><tr><th>N°</th><th>Date</th><th>Client</th><th>Statut</th><th className="text-right">Brut</th><th className="text-right">Remise</th><th className="text-right">TVA</th><th className="text-right">Total</th><th>Comptabilité</th></tr></thead>
            <tbody>{detailSales.map((sale) => <tr key={sale.id}>
              <td className="font-mono text-xs">{sale.sale_number}</td><td className="whitespace-nowrap">{formatDateTime(sale.sold_at)}</td><td>{sale.customer?.full_name ?? '-'}</td>
              <td>{STATUS_LABELS[sale.status] ?? sale.status}{sale.cancel_reason && <span className="block text-xs text-slate-500">{sale.cancel_reason}</span>}</td>
              <td className="text-right tabular-nums">{formatAmount(Number(sale.subtotal))}</td><td className="text-right tabular-nums">{Number(sale.discount_amount) ? formatAmount(Number(sale.discount_amount)) : ''}</td>
              <td className="text-right tabular-nums">{Number(sale.tax_amount) ? formatAmount(Number(sale.tax_amount)) : ''}</td><td className="text-right font-medium tabular-nums">{formatAmount(Number(sale.total_amount))}</td>
              <td>{sale.accounting_synced ? <span className="ui-badge ui-badge-success">Oui</span> : <span className="ui-badge ui-badge-warning" title={sale.accounting_error ?? undefined}>{sale.accounting_error ? 'Erreur' : 'En attente'}</span>}</td>
            </tr>)}</tbody>
          </table>
        </div>
      </div>}
    </>}
  </ReportFrame>
}
