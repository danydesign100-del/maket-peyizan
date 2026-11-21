import { Fragment, useEffect, useState } from 'react'
import { AlertTriangle, CheckCircle2, ChevronDown, ChevronRight, Users } from 'lucide-react'
import { TableRowsSkeleton } from '../../components/Skeleton'
import { describePeriod, formatDay, type Period } from '../../lib/period'
import { downloadSheet } from '../../lib/spreadsheet'
import { PARTNER_CATEGORY_LABELS, balanceSheet, financialYearStart, partnersEquity, type PartnerCategory, type PartnerMovementInput } from '../../lib/statements'
import type { AccountBalance, Partner } from '../../types/accounting'
import { formatAmount, ledgerService } from '../../services/ledgerService'
import { ReportFrame } from './ReportFrame'

const COLUMNS = [
  ['opening', 'Solde d’ouverture'], ['capitalIncreases', 'Augmentations de capital'], ['contributions', 'Apports supplémentaires'],
  ['resultShare', 'Part du résultat'], ['withdrawals', 'Retraits / distributions'], ['adjustments', 'Autres ajustements'], ['closing', 'Solde de clôture'],
] as const
type Column = typeof COLUMNS[number][0]
const CATEGORY_COLUMN: Record<PartnerCategory, Column> = { capital_increase: 'capitalIncreases', contribution: 'contributions', withdrawal: 'withdrawals', adjustment: 'adjustments' }
const signed = (column: Column, value: number) => column === 'withdrawals' && value ? `− ${formatAmount(value)}` : formatAmount(value)

/** État de l'avoir des associés: each partner's equity from opening to closing, reconciled with the balance sheet. */
export function PartnersEquityReport({ period }: { period: Period }) {
  const [partners, setPartners] = useState<Partner[] | null>(null)
  const [balances, setBalances] = useState<AccountBalance[] | null>(null)
  const [sheetBalances, setSheetBalances] = useState<AccountBalance[] | null>(null)
  const [movements, setMovements] = useState<PartnerMovementInput[]>([])
  const [error, setError] = useState<string | null>(null)
  const [selected, setSelected] = useState('')
  const [expanded, setExpanded] = useState<string | null>(null)

  useEffect(() => {
    setBalances(null); setError(null)
    void (async () => {
      const list = await ledgerService.listPartners()
      if (list.error) return setError(list.error.message)
      const ids = (list.data ?? []).flatMap((partner) => [partner.capital_account_id, partner.current_account_id])
      const [totals, sheet, lines] = await Promise.all([
        ledgerService.balances(period.from || null, period.to || null),
        ledgerService.balances(financialYearStart(period.to), period.to),
        ledgerService.movementsForAccounts(ids, period.from || null, period.to || null),
      ])
      const failure = totals.error ?? sheet.error ?? lines.error
      if (failure) return setError(failure.message)
      setPartners(list.data ?? []); setBalances(totals.data ?? []); setSheetBalances(sheet.data ?? []); setMovements((lines.data ?? []) as PartnerMovementInput[])
    })()
  }, [period])

  const report = partners && balances ? partnersEquity(partners, balances, movements) : null
  const sheet = sheetBalances ? balanceSheet(sheetBalances) : null
  const rows = report?.rows.filter((row) => !selected || row.partner.id === selected) ?? []
  const visibleRows = rows.filter((row) => row.partner.is_active || COLUMNS.some(([column]) => row[column]))
  const totals = Object.fromEntries(COLUMNS.map(([column]) => [column, visibleRows.reduce((sum, row) => sum + row[column], 0)])) as Record<Column, number>
  const consistent = report && sheet ? Math.abs(report.totalEquity - sheet.totalEquity) < 0.005 : true

  const exportSheet = () => report && void downloadSheet(`avoir-des-associes-${period.from}-${period.to}.xlsx`, 'Avoir des associés', [
    ['Associé', 'Part (%)', ...COLUMNS.map(([, label]) => label)],
    ...visibleRows.map((row) => [row.partner.name, row.partner.share_percent ?? '', ...COLUMNS.map(([column]) => column === 'withdrawals' ? -row[column] : row[column])]),
    ['Total des associés', report.allocatedPercent, ...COLUMNS.map(([column]) => column === 'withdrawals' ? -totals[column] : totals[column])],
    [], ['Détail des mouvements'], ['Associé', 'Date', 'N°', 'Référence', 'Libellé', 'Catégorie', 'Montant'],
    ...visibleRows.flatMap((row) => row.details.map((detail) => [row.partner.name, detail.date, detail.number, detail.reference ?? '', detail.description, PARTNER_CATEGORY_LABELS[detail.category], detail.amount])),
  ])

  return <ReportFrame title="État de l’avoir des associés" period={describePeriod(period)} icon={Users} subtitle="écritures validées" landscape onExport={report ? exportSheet : undefined}
    actions={partners && partners.length > 1 ? <label className="text-xs font-medium text-slate-600">Associé<select value={selected} onChange={(event) => setSelected(event.target.value)} className="ml-2"><option value="">Tous</option>{partners.map((partner) => <option key={partner.id} value={partner.id}>{partner.name}</option>)}</select></label> : undefined}>
    {error && <p role="alert" className="ui-alert-error mx-5">{error}</p>}
    {partners?.length === 0 && <p className="ui-empty">Aucun associé enregistré. Ajoutez-les dans Comptabilité → Associés.</p>}
    {partners?.length !== 0 && <div className="overflow-x-auto">
      <table className="ui-table report-table text-sm [&_td]:px-3 [&_th]:px-3">
        {/* Headers wrap so that all nine columns fit on screen and on the printed page. */}
        <thead><tr><th>Associé</th><th className="text-right">Part</th>{COLUMNS.map(([column, label]) => <th key={column} className="whitespace-normal text-right align-bottom leading-tight">{label}</th>)}</tr></thead>
        <tbody>
          {!report ? <TableRowsSkeleton rows={3} cols={9} /> : visibleRows.map((row) => {
            const open = expanded === row.partner.id
            return <Fragment key={row.partner.id}>
              <tr>
                <td className="whitespace-nowrap font-medium"><button type="button" onClick={() => setExpanded(open ? null : row.partner.id)} aria-expanded={open} className="inline-flex items-center gap-1 hover:text-brand-700">{open ? <ChevronDown className="no-print h-3.5 w-3.5" aria-hidden="true" /> : <ChevronRight className="no-print h-3.5 w-3.5" aria-hidden="true" />}{row.partner.name}</button>{!row.partner.is_active && <span className="ml-2 ui-badge ui-badge-neutral">Inactif</span>}</td>
                <td className="whitespace-nowrap text-right tabular-nums">{row.partner.share_percent === null ? '-' : `${Number(row.partner.share_percent).toLocaleString('fr-HT')} %`}</td>
                {COLUMNS.map(([column]) => <td key={column} className={`text-right tabular-nums ${column === 'closing' ? 'font-semibold' : ''}`}>{signed(column, row[column])}</td>)}
              </tr>
              {open && <>
                {row.details.length === 0 && <tr className="bg-slate-50/70 text-xs text-slate-500"><td /><td colSpan={8}>Aucun mouvement sur les comptes de l’associé pendant la période.</td></tr>}
                {/* Each movement's amount sits in the column of its category. */}
                {row.details.map((detail, index) => <tr key={index} className="bg-slate-50/70 text-xs text-slate-600">
                  <td colSpan={2} className="whitespace-normal pl-8">{formatDay(detail.date)} · {detail.number}{detail.reference ? ` · ${detail.reference}` : ''}<span className="block text-slate-500">{detail.description} - {PARTNER_CATEGORY_LABELS[detail.category]}</span></td>
                  {COLUMNS.map(([column]) => <td key={column} className="text-right tabular-nums">{CATEGORY_COLUMN[detail.category] === column ? (column === 'withdrawals' ? `− ${formatAmount(-detail.amount)}` : formatAmount(detail.amount)) : ''}</td>)}
                </tr>)}
                {row.resultShare !== 0 && <tr className="bg-slate-50/70 text-xs text-slate-600"><td colSpan={2} className="whitespace-normal pl-8">Part du résultat : {formatAmount(report!.periodResult)} × {(row.share * 100).toLocaleString('fr-HT')} %</td>{COLUMNS.map(([column]) => <td key={column} className="text-right tabular-nums">{column === 'resultShare' ? formatAmount(row.resultShare) : ''}</td>)}</tr>}
              </>}
            </Fragment>
          })}
        </tbody>
        {report && <tfoot className="bg-slate-50 font-semibold"><tr><td className="whitespace-nowrap">{selected ? 'Total' : 'Total des associés'}</td><td className="whitespace-nowrap text-right tabular-nums">{selected ? '' : `${report.allocatedPercent.toLocaleString('fr-HT')} %`}</td>{COLUMNS.map(([column]) => <td key={column} className="text-right tabular-nums">{signed(column, totals[column])}</td>)}</tr></tfoot>}
      </table>
    </div>}
    {report && sheet && !selected && <div className="mx-5 my-4 max-w-xl space-y-1 rounded-lg border border-slate-200 p-4 text-sm print:mx-0">
      <p className="mb-2 font-semibold text-slate-900">Rapprochement avec le bilan au {formatDay(period.to)}</p>
      {[['Total de l’avoir des associés', totals.closing], ['Capitaux propres non attribués aux associés (réserves, capital non réparti…)', report.otherEquity], ['Résultat non réparti entre associés', report.unallocatedResult]].map(([label, value]) =>
        <p key={label as string} className="flex justify-between gap-4 text-slate-600"><span>{label}</span><span className="tabular-nums">{formatAmount(Number(value))}</span></p>)}
      <p className="flex justify-between gap-4 border-t border-slate-200 pt-1 font-semibold"><span>Total des capitaux propres</span><span className="tabular-nums">{formatAmount(report.totalEquity)}</span></p>
      <p className={`flex items-center gap-2 pt-1 font-semibold ${consistent ? 'text-emerald-700' : 'text-red-700'}`}>{consistent ? <CheckCircle2 className="h-4 w-4" aria-hidden="true" /> : <AlertTriangle className="h-4 w-4" aria-hidden="true" />}
        Capitaux propres du bilan : {formatAmount(sheet.totalEquity)} {consistent ? '- cohérent' : `- écart de ${formatAmount(Math.abs(report.totalEquity - sheet.totalEquity))}`}</p>
    </div>}
    <p className="px-5 pb-4 text-xs leading-5 text-slate-500 print:px-0">Solde de clôture = solde d’ouverture + augmentations de capital + apports + part du résultat ± autres ajustements − retraits. Le solde d’ouverture inclut la part des résultats antérieurs non affectés ; la part du résultat est calculée selon le pourcentage de chaque associé actif.</p>
  </ReportFrame>
}
