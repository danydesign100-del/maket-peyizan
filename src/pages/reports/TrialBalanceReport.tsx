import { Fragment, useState } from 'react'
import { AlertTriangle, CheckCircle2, Scale } from 'lucide-react'
import { TableRowsSkeleton } from '../../components/Skeleton'
import { describePeriod, type Period } from '../../lib/period'
import { downloadSheet } from '../../lib/spreadsheet'
import { TRIAL_GROUP_LABELS, isBalanced, trialBalance, type Columns } from '../../lib/statements'
import { NATURE_LABELS, formatAmount } from '../../services/ledgerService'
import { ReportFrame } from './ReportFrame'
import { useBalances } from './useBalances'

const amount = (value: number) => value ? formatAmount(value) : ''
const COLUMNS: (keyof Columns)[] = ['openingDebit', 'openingCredit', 'movementDebit', 'movementCredit', 'closingDebit', 'closingCredit']

export function Check({ label, debit, credit }: { label: string; debit: number; credit: number }) {
  const ok = isBalanced(debit, credit)
  return <span className={`inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-semibold ${ok ? 'bg-emerald-50 text-emerald-800' : 'bg-red-50 text-red-800'}`}>
    {ok ? <CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" /> : <AlertTriangle className="h-3.5 w-3.5" aria-hidden="true" />}{label} : {ok ? 'débit = crédit' : `écart ${formatAmount(Math.abs(debit - credit))}`}
  </span>
}

/** Balance de vérification: accounts by class, assets split short/long term, D = C checks. */
export function TrialBalanceReport({ period }: { period: Period }) {
  const [mode, setMode] = useState<'after' | 'before'>('after')
  const [showEmpty, setShowEmpty] = useState(false)
  const { balances, error } = useBalances(period.from || null, period.to || null)
  const report = balances ? trialBalance(balances, { includeRegularisation: mode === 'after', includeEmpty: showEmpty }) : null
  const title = mode === 'after' ? 'Balance de vérification' : 'Balance de vérification avant régularisation'

  const exportSheet = () => report && void downloadSheet(`balance-verification-${period.from}-${period.to}.xlsx`, 'Balance', [
    ['Groupe', 'Code', 'Compte', 'Nature', "Ouverture - débit", "Ouverture - crédit", 'Mouvements - débit', 'Mouvements - crédit', 'Clôture - débit', 'Clôture - crédit'],
    ...report.groups.flatMap((group) => [
      ...group.rows.map((row) => [TRIAL_GROUP_LABELS[group.id], row.account.code, row.account.name, NATURE_LABELS[row.account.nature], ...COLUMNS.map((column) => row[column])]),
      [`Total ${TRIAL_GROUP_LABELS[group.id]}`, '', '', '', ...COLUMNS.map((column) => group.totals[column])],
    ]),
    ['Totaux', '', '', '', ...COLUMNS.map((column) => report.totals[column])],
  ])

  return <ReportFrame title={title} period={describePeriod(period)} icon={Scale} subtitle="écritures validées" onExport={report ? exportSheet : undefined} landscape
    actions={<>
      <span role="radiogroup" aria-label="Régularisations" className="inline-flex rounded-lg border border-slate-300 bg-white p-0.5 text-xs font-semibold">
        {(['before', 'after'] as const).map((value) => <button key={value} type="button" role="radio" aria-checked={mode === value} onClick={() => setMode(value)} className={`rounded-md px-2.5 py-1.5 ${mode === value ? 'bg-brand-700 text-white' : 'text-slate-600 hover:bg-slate-50'}`}>{value === 'before' ? 'Avant régularisation' : 'Après régularisation'}</button>)}
      </span>
      <label className="inline-flex items-center gap-2 text-sm text-slate-600"><input type="checkbox" checked={showEmpty} onChange={(event) => setShowEmpty(event.target.checked)} />Comptes sans mouvement</label>
    </>}>
    {error && <p role="alert" className="ui-alert-error mx-5">{error}</p>}
    {report && <div className="flex flex-wrap gap-2 px-5 py-3 print:px-0">
      <Check label="Ouverture" debit={report.totals.openingDebit} credit={report.totals.openingCredit} />
      <Check label="Mouvements" debit={report.totals.movementDebit} credit={report.totals.movementCredit} />
      <Check label="Clôture" debit={report.totals.closingDebit} credit={report.totals.closingCredit} />
    </div>}
    <div className="overflow-x-auto">
      <table className="ui-table report-table text-sm">
        <thead>
          <tr><th rowSpan={2}>Code</th><th rowSpan={2}>Compte</th><th rowSpan={2}>Nature</th>{['Solde d’ouverture', 'Mouvements de la période', 'Solde de clôture'].map((label) => <th key={label} colSpan={2} className="border-l border-slate-200 text-center">{label}</th>)}</tr>
          <tr>{COLUMNS.map((column, index) => <th key={column} className={`text-right ${index % 2 === 0 ? 'border-l border-slate-200' : ''}`}>{index % 2 === 0 ? 'Débit' : 'Crédit'}</th>)}</tr>
        </thead>
        <tbody>
          {!report ? <TableRowsSkeleton rows={8} cols={9} /> : report.groups.length === 0 ? <tr><td colSpan={9} className="ui-empty">Aucune écriture validée sur la période.</td></tr>
            : report.groups.map((group) => <Fragment key={group.id}>
              <tr className="bg-slate-100/80"><td colSpan={9} className="text-xs font-bold uppercase tracking-wide text-slate-700">{TRIAL_GROUP_LABELS[group.id]}</td></tr>
              {group.rows.map((row) => <tr key={row.account.account_id}>
                <td className="font-mono">{row.account.code}</td><td>{row.account.name}</td><td>{NATURE_LABELS[row.account.nature]}</td>
                {COLUMNS.map((column, index) => <td key={column} className={`text-right tabular-nums ${index % 2 === 0 ? 'border-l border-slate-100' : ''} ${index >= 4 ? 'font-medium' : ''}`}>{amount(row[column])}</td>)}
              </tr>)}
              <tr className="font-semibold"><td colSpan={3} className="text-slate-700">Total {TRIAL_GROUP_LABELS[group.id].toLowerCase()}</td>
                {COLUMNS.map((column, index) => <td key={column} className={`text-right tabular-nums ${index % 2 === 0 ? 'border-l border-slate-100' : ''}`}>{formatAmount(group.totals[column])}</td>)}
              </tr>
            </Fragment>)}
        </tbody>
        {report && <tfoot className="bg-slate-50 font-bold"><tr><td colSpan={3}>Totaux généraux</td>
          {COLUMNS.map((column, index) => <td key={column} className={`text-right tabular-nums ${index % 2 === 0 ? 'border-l border-slate-200' : ''}`}>{formatAmount(report.totals[column])}</td>)}
        </tr></tfoot>}
      </table>
    </div>
  </ReportFrame>
}
