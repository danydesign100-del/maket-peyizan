import { useEffect, useState } from 'react'
import { CheckCircle2, ClipboardCheck, Coins, Printer } from 'lucide-react'
import { Modal } from '../../components/Modal'
import { PeriodFilter } from '../../components/PeriodFilter'
import { TableRowsSkeleton } from '../../components/Skeleton'
import { useAuth } from '../../contexts/AuthContext'
import { describePeriod, formatDateTime, monthToDate, periodError, type Period } from '../../lib/period'
import { downloadSheet } from '../../lib/spreadsheet'
import { formatAmount } from '../../services/ledgerService'
import { cashService, type CashSessionRow } from '../../services/cashService'
import { ReportFrame } from '../reports/ReportFrame'
import { ticketDate, ticketMoney, useTicket } from '../../components/ThermalTicket'

const COLUMNS = [['opening_amount', 'Solde initial'], ['cash_sales', 'Ventes espèces'], ['refunds', 'Rembour\u00adsements'], ['cash_in', 'Entrées'], ['cash_out', 'Sorties'], ['theoretical', 'Solde théorique'], ['counted', 'Compté'], ['difference', 'Écart']] as const

function ValidateDialog({ row, onClose, onDone }: { row: CashSessionRow; onClose: () => void; onDone: (message: string) => void }) {
  const [reason, setReason] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const difference = Number(row.difference ?? 0)
  const submit = async () => {
    if (reason.trim().length < 3) return setError('Indiquez la justification.')
    setSaving(true)
    const { error: validateError } = await cashService.validateDifference(row.session_id, reason.trim())
    setSaving(false)
    if (validateError) return setError(validateError.message)
    onDone(difference ? `Écart de ${formatAmount(difference)} HTG validé et comptabilisé (${difference < 0 ? '519100 Manquants' : '407000 Excédents'} de caisse).` : 'Clôture validée sans écart.')
  }
  return <Modal size="sm" title="Valider l’écart de caisse" subtitle={`${row.cashier_name ?? '-'} · ${formatDateTime(row.opened_at)}`} onClose={onClose} locked={saving}
    footer={<><button type="button" onClick={onClose} className="ui-button-secondary">Retour</button><button type="button" onClick={() => void submit()} disabled={saving} className="ui-button-primary"><ClipboardCheck className="h-4 w-4" aria-hidden="true" />Valider</button></>}>
    {error && <p role="alert" className="ui-alert-error mt-0 mb-3">{error}</p>}
    <p className="text-sm text-slate-700">Écart : <strong className={difference < 0 ? 'text-red-700' : difference > 0 ? 'text-amber-700' : 'text-emerald-700'}>{difference > 0 ? '+' : ''}{formatAmount(difference)} HTG</strong> ({difference < 0 ? 'manquant' : difference > 0 ? 'excédent' : 'aucun écart'}).</p>
    <p className="mt-1 text-xs text-slate-500">{difference ? `L’écart sera comptabilisé en ${difference < 0 ? '519100 Manquants de caisse' : '407000 Excédents de caisse'}. ` : ''}La validation est définitive et tracée.</p>
    <label className="mt-4 block text-sm font-medium text-slate-700">Justification *<textarea autoFocus rows={2} value={reason} onChange={(event) => setReason(event.target.value)} placeholder="Ex. : erreur de rendu de monnaie" className="mt-1 w-full" /></label>
  </Modal>
}

/** Rapport de caisse: per session, theoretical balance against the counted amount. */
export function CashReportTab({ onNotice }: { onNotice: (message: string) => void }) {
  const { can } = useAuth()
  const canValidate = can('cash.validate_difference')
  const [period, setPeriod] = useState<Period>(monthToDate)
  const [cashier, setCashier] = useState('')
  const [rows, setRows] = useState<CashSessionRow[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [validating, setValidating] = useState<CashSessionRow | null>(null)
  const [refresh, setRefresh] = useState(0)
  const ticket = useTicket()
  const printClosing = (row: CashSessionRow) => ticket.print({
    title: 'Rapport de clôture de caisse',
    meta: [['Caissier', row.cashier_name ?? '-'], ['Ouverture', ticketDate(row.opened_at)], ['Clôture', row.closed_at ? ticketDate(row.closed_at) : 'Session ouverte']],
    lines: [
      { label: 'Solde initial', amount: ticketMoney(Number(row.opening_amount)) },
      { label: 'Ventes en espèces', amount: `+ ${ticketMoney(Number(row.cash_sales))}` },
      { label: 'Remboursements', amount: `− ${ticketMoney(Number(row.refunds))}` },
      { label: 'Entrées (dépôts, apports)', amount: `+ ${ticketMoney(Number(row.cash_in))}` },
      { label: 'Sorties', amount: `− ${ticketMoney(Number(row.cash_out))}` },
    ],
    totals: [
      { label: 'Solde théorique', amount: ticketMoney(Number(row.theoretical)), strong: true },
      { label: 'Compté', amount: row.counted === null ? '-' : ticketMoney(Number(row.counted)) },
      { label: 'Écart', amount: row.difference === null ? '-' : `${Number(row.difference) > 0 ? '+' : ''}${ticketMoney(Number(row.difference))}`, strong: true },
    ],
    notes: row.difference_validated_at ? <p>Écart validé par {row.difference_validated_by_name} : {row.difference_reason}</p> : row.closed_at && Number(row.difference ?? 0) !== 0 ? <p>Écart à valider par la direction.</p> : undefined,
    footer: <div className="mt-4 grid grid-cols-2 gap-4 text-left"><p className="border-t border-black pt-1">Caissier</p><p className="border-t border-black pt-1">Responsable</p></div>,
  })

  useEffect(() => {
    if (periodError(period)) return
    setRows(null)
    void cashService.sessionReport(period.from, period.to, null).then(({ data, error: loadError }) => loadError ? setError(loadError.message) : setRows(data ?? []))
  }, [period, refresh])

  const cashiers = [...new Map((rows ?? []).map((row) => [row.cashier_id, row.cashier_name ?? '-'])).entries()]
  const visible = (rows ?? []).filter((row) => !cashier || row.cashier_id === cashier)
  const totals = Object.fromEntries(COLUMNS.map(([column]) => [column, visible.reduce((sum, row) => sum + Number(row[column] ?? 0), 0)])) as Record<typeof COLUMNS[number][0], number>
  const exportSheet = () => void downloadSheet(`rapport-de-caisse-${period.from}-${period.to}.xlsx`, 'Rapport de caisse', [
    ['Caissier', 'Ouverture', 'Clôture', ...COLUMNS.map(([, label]) => label), 'Validation'],
    ...visible.map((row) => [row.cashier_name ?? '', formatDateTime(row.opened_at), row.closed_at ? formatDateTime(row.closed_at) : 'Ouverte', ...COLUMNS.map(([column]) => row[column] === null ? '' : Number(row[column])), row.difference_validated_at ? `${row.difference_validated_by_name ?? ''} : ${row.difference_reason ?? ''}` : '']),
    ['Totaux', '', '', ...COLUMNS.map(([column]) => totals[column])],
  ])

  return <div className="space-y-4">
    <div className="no-print ui-card flex flex-wrap items-end gap-3 p-4">
      <PeriodFilter value={period} onChange={setPeriod} />
      {cashiers.length > 1 && <label className="text-xs font-medium text-slate-600">Caissier<select value={cashier} onChange={(event) => setCashier(event.target.value)} className="mt-1 block"><option value="">Tous</option>{cashiers.map(([id, name]) => <option key={id} value={id}>{name}</option>)}</select></label>}
    </div>
    {error && <p role="alert" className="ui-alert-error">{error}</p>}
    <ReportFrame title="Rapport de caisse" period={describePeriod(period)} icon={Coins} subtitle={cashier ? `caissier : ${cashiers.find(([id]) => id === cashier)?.[1]}` : 'tous les caissiers'} landscape onExport={visible.length ? exportSheet : undefined}>
      <div className="overflow-x-auto">
        <table className="ui-table report-table text-sm [&_td]:px-3 [&_th]:px-3">
          <thead><tr><th>Caissier</th><th>Session</th>{COLUMNS.map(([column, label]) => <th key={column} className="whitespace-normal text-right align-bottom leading-tight">{label}</th>)}<th>Validation</th></tr></thead>
          <tbody>
            {rows === null ? <TableRowsSkeleton rows={4} cols={11} /> : visible.length === 0 ? <tr><td colSpan={11} className="ui-empty">Aucune session de caisse sur la période.</td></tr>
              : visible.map((row) => {
                const difference = row.difference === null ? null : Number(row.difference)
                return <tr key={row.session_id}>
                  <td className="whitespace-nowrap font-medium">{row.cashier_name ?? '-'}</td>
                  <td className="whitespace-nowrap text-xs text-slate-600">{formatDateTime(row.opened_at)}<span className="block">{row.closed_at ? `→ ${formatDateTime(row.closed_at).slice(0, 10) === formatDateTime(row.opened_at).slice(0, 10) ? formatDateTime(row.closed_at).slice(-5) : formatDateTime(row.closed_at)}` : 'Ouverte'}</span><button type="button" onClick={() => printClosing(row)} className="no-print mt-1 inline-flex items-center gap-1 font-semibold text-brand-700 hover:underline"><Printer className="h-3 w-3" aria-hidden="true" />Ticket de clôture</button></td>
                  {COLUMNS.slice(0, 6).map(([column]) => <td key={column} className={`text-right tabular-nums ${column === 'theoretical' ? 'font-semibold' : ''}`}>{formatAmount(Number(row[column]))}</td>)}
                  <td className="text-right tabular-nums">{row.counted === null ? '-' : formatAmount(Number(row.counted))}</td>
                  <td className={`whitespace-nowrap text-right font-semibold tabular-nums ${difference === null ? '' : difference < 0 ? 'text-red-700' : difference > 0 ? 'text-amber-700' : 'text-emerald-700'}`}>{difference === null ? '-' : `${difference > 0 ? '+' : ''}${formatAmount(difference)}`}</td>
                  <td className="min-w-36 text-xs">{row.difference_validated_at
                    ? <><span className="inline-flex items-center gap-1 whitespace-nowrap font-medium text-emerald-700"><CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" />{row.difference_validated_by_name}</span><span className="block text-slate-500">{row.difference_reason}</span></>
                    : row.closed_at ? (canValidate ? <button type="button" onClick={() => setValidating(row)} className="no-print font-semibold text-brand-700 hover:underline">Valider l’écart</button> : <span className="text-amber-700">À valider</span>) : '-'}</td>
                </tr>
              })}
          </tbody>
          {visible.length > 0 && <tfoot className="bg-slate-50 font-semibold"><tr><td colSpan={2}>Totaux</td>{COLUMNS.map(([column]) => <td key={column} className="text-right tabular-nums">{formatAmount(totals[column])}</td>)}<td /></tr></tfoot>}
        </table>
      </div>
      <p className="px-5 py-3 text-xs leading-5 text-slate-500 print:px-0">Solde théorique = solde initial + encaissements en espèces − remboursements + dépôts et entrées − sorties. Écart = montant compté − solde théorique. Un écart n’est jamais corrigé automatiquement : il est comptabilisé seulement après validation par un directeur ou un administrateur.</p>
    </ReportFrame>
    {ticket.element}
    {validating && <ValidateDialog row={validating} onClose={() => setValidating(null)} onDone={(message) => { setValidating(null); onNotice(message); setRefresh((value) => value + 1) }} />}
  </div>
}
