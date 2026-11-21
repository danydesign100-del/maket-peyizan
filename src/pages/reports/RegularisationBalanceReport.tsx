import { Fragment, useEffect, useMemo, useState } from 'react'
import { ChevronDown, ChevronRight, Scale } from 'lucide-react'
import { TableRowsSkeleton } from '../../components/Skeleton'
import { describePeriod, formatDay, periodError, type Period } from '../../lib/period'
import { downloadSheet } from '../../lib/spreadsheet'
import { cents, sides } from '../../lib/statements'
import type { AccountBalance, JournalEntryWithLines } from '../../types/accounting'
import { NATURE_LABELS, formatAmount, ledgerService } from '../../services/ledgerService'
import { ReportFrame } from './ReportFrame'
import { Check } from './TrialBalanceReport'

type Row = { account: AccountBalance; before: { debit: number; credit: number }; regularisation: { debit: number; credit: number }; after: { debit: number; credit: number } }

/** Before = opening + movements without regularisations; after = closing (regularisations included). */
function toRows(balances: AccountBalance[]): Row[] {
  return balances.map((account) => {
    const beforeNet = Number(account.opening_debit) + Number(account.period_debit) - Number(account.opening_credit) - Number(account.period_credit)
    return { account, before: sides(beforeNet), regularisation: { debit: Number(account.regularisation_debit), credit: Number(account.regularisation_credit) }, after: sides(Number(account.closing_debit) - Number(account.closing_credit)) }
  }).filter((row) => row.before.debit || row.before.credit || row.regularisation.debit || row.regularisation.credit || row.after.debit || row.after.credit)
}

/** Balance de régularisation: balance before, regularisation movements, balance after. */
export function RegularisationBalanceReport({ period, refreshKey = 0 }: { period: Period; refreshKey?: number }) {
  const [balances, setBalances] = useState<AccountBalance[] | null>(null)
  const [entries, setEntries] = useState<JournalEntryWithLines[]>([])
  const [error, setError] = useState<string | null>(null)
  const [onlyRegularised, setOnlyRegularised] = useState(false)
  const [expanded, setExpanded] = useState<string | null>(null)

  useEffect(() => {
    if (periodError(period)) return
    setBalances(null); setError(null)
    void Promise.all([ledgerService.balances(period.from || null, period.to || null), ledgerService.listEntries({ from: period.from, to: period.to, type: 'regularisation', pageSize: 200 })])
      .then(([totals, list]) => {
        if (totals.error || list.error) return setError((totals.error ?? list.error)!.message)
        setBalances(totals.data ?? []); setEntries(list.data ?? [])
      })
  }, [period, refreshKey])

  const pending = entries.filter((entry) => entry.status === 'draft').length
  const rows = useMemo(() => toRows(balances ?? []).filter((row) => !onlyRegularised || row.regularisation.debit || row.regularisation.credit), [balances, onlyRegularised])
  const total = (pick: (row: Row) => number) => cents(rows.reduce((sum, row) => sum + pick(row), 0))
  const totals = { beforeDebit: total((r) => r.before.debit), beforeCredit: total((r) => r.before.credit), regDebit: total((r) => r.regularisation.debit), regCredit: total((r) => r.regularisation.credit), afterDebit: total((r) => r.after.debit), afterCredit: total((r) => r.after.credit) }
  // Posted regularisation lines per account, for the detail of a row.
  const linesByAccount = useMemo(() => {
    const map = new Map<string, { entry: JournalEntryWithLines; debit: number; credit: number }[]>()
    for (const entry of entries.filter((item) => item.status === 'posted')) for (const line of entry.lines) map.set(line.account_id, [...(map.get(line.account_id) ?? []), { entry, debit: Number(line.debit_amount), credit: Number(line.credit_amount) }])
    return map
  }, [entries])

  const exportSheet = () => void downloadSheet(`balance-regularisation-${period.from}-${period.to}.xlsx`, 'Balance de régularisation', [
    ['Code', 'Compte', 'Nature', 'Solde avant - débit', 'Solde avant - crédit', 'Régularisation - débit', 'Régularisation - crédit', 'Solde après - débit', 'Solde après - crédit'],
    ...rows.map((row) => [row.account.code, row.account.name, NATURE_LABELS[row.account.nature], row.before.debit, row.before.credit, row.regularisation.debit, row.regularisation.credit, row.after.debit, row.after.credit]),
    ['', 'Totaux', '', totals.beforeDebit, totals.beforeCredit, totals.regDebit, totals.regCredit, totals.afterDebit, totals.afterCredit],
  ])
  const amount = (value: number) => value ? formatAmount(value) : ''

  return <ReportFrame title="Balance de régularisation" period={describePeriod(period)} icon={Scale} subtitle="écritures validées uniquement" landscape onExport={rows.length ? exportSheet : undefined}
    note={pending ? `${pending} régularisation(s) en brouillon ou à valider ne sont pas incluses tant qu’elles ne sont pas validées.` : undefined}
    actions={<label className="inline-flex items-center gap-2 text-sm text-slate-600"><input type="checkbox" checked={onlyRegularised} onChange={(event) => setOnlyRegularised(event.target.checked)} />Comptes régularisés seulement</label>}>
    {error && <p role="alert" className="ui-alert-error mx-5">{error}</p>}
    <div className="flex flex-wrap gap-2 px-5 py-3 print:px-0">
      <Check label="Avant régularisation" debit={totals.beforeDebit} credit={totals.beforeCredit} />
      <Check label="Régularisations" debit={totals.regDebit} credit={totals.regCredit} />
      <Check label="Après régularisation" debit={totals.afterDebit} credit={totals.afterCredit} />
    </div>
    <div className="overflow-x-auto">
      <table className="ui-table report-table text-sm">
        <thead>
          <tr><th rowSpan={2}>Code</th><th rowSpan={2}>Compte</th><th rowSpan={2}>Nature</th>{['Solde avant régularisation', 'Régularisations', 'Solde après régularisation'].map((label) => <th key={label} colSpan={2} className="border-l border-slate-200 text-center">{label}</th>)}</tr>
          <tr>{['Débit', 'Crédit', 'Débit', 'Crédit', 'Débit', 'Crédit'].map((label, index) => <th key={index} className={`text-right ${index % 2 === 0 ? 'border-l border-slate-200' : ''}`}>{label}</th>)}</tr>
        </thead>
        <tbody>
          {balances === null ? <TableRowsSkeleton rows={6} cols={9} />
            : rows.length === 0 ? <tr><td colSpan={9} className="ui-empty">Aucun solde ni mouvement validé sur la période.</td></tr>
            : rows.map((row) => {
              const detail = linesByAccount.get(row.account.account_id) ?? []
              const open = expanded === row.account.account_id
              return <Fragment key={row.account.account_id}>
                <tr className={row.regularisation.debit || row.regularisation.credit ? 'bg-amber-50/40' : ''}>
                  <td className="font-mono">{detail.length > 0
                    ? <button type="button" onClick={() => setExpanded(open ? null : row.account.account_id)} aria-expanded={open} className="inline-flex items-center gap-1 hover:text-brand-700">{open ? <ChevronDown className="no-print h-3.5 w-3.5" aria-hidden="true" /> : <ChevronRight className="no-print h-3.5 w-3.5" aria-hidden="true" />}{row.account.code}</button>
                    : row.account.code}</td>
                  <td>{row.account.name}</td><td>{NATURE_LABELS[row.account.nature]}</td>
                  <td className="border-l border-slate-100 text-right tabular-nums">{amount(row.before.debit)}</td><td className="text-right tabular-nums">{amount(row.before.credit)}</td>
                  <td className="border-l border-slate-100 text-right font-medium tabular-nums">{amount(row.regularisation.debit)}</td><td className="text-right font-medium tabular-nums">{amount(row.regularisation.credit)}</td>
                  <td className="border-l border-slate-100 text-right font-semibold tabular-nums">{amount(row.after.debit)}</td><td className="text-right font-semibold tabular-nums">{amount(row.after.credit)}</td>
                </tr>
                {open && detail.map((line, index) => <tr key={`${row.account.account_id}-${index}`} className="bg-slate-50/70 text-xs text-slate-600">
                  <td /><td colSpan={4}>{formatDay(line.entry.entry_date)} · {line.entry.entry_number} · {line.entry.description}{line.entry.reference ? ` (${line.entry.reference})` : ''}</td>
                  <td className="border-l border-slate-100 text-right tabular-nums">{amount(line.debit)}</td><td className="text-right tabular-nums">{amount(line.credit)}</td><td colSpan={2} className="border-l border-slate-100" />
                </tr>)}
              </Fragment>
            })}
        </tbody>
        <tfoot className="bg-slate-50 font-semibold"><tr><td colSpan={3}>Totaux</td>
          {[totals.beforeDebit, totals.beforeCredit, totals.regDebit, totals.regCredit, totals.afterDebit, totals.afterCredit].map((value, index) => <td key={index} className={`text-right tabular-nums ${index % 2 === 0 ? 'border-l border-slate-200' : ''}`}>{formatAmount(value)}</td>)}
        </tr></tfoot>
      </table>
    </div>
  </ReportFrame>
}
