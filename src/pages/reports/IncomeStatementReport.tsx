import { TrendingUp } from 'lucide-react'
import { CardsSkeleton } from '../../components/Skeleton'
import { describePeriod, type Period } from '../../lib/period'
import { downloadSheet } from '../../lib/spreadsheet'
import { incomeStatement, type StatementLine } from '../../lib/statements'
import { formatAmount } from '../../services/ledgerService'
import { ReportFrame } from './ReportFrame'
import { useBalances } from './useBalances'

function Lines({ lines, sign = '' }: { lines: StatementLine[]; sign?: string }) {
  return <>{lines.map((line) => <tr key={line.account.account_id} className="text-slate-600">
    <td className="pl-8"><span className="font-mono text-xs text-slate-400">{line.account.code}</span> {line.account.name}</td>
    <td className="text-right tabular-nums">{sign}{formatAmount(line.amount)}</td><td />
  </tr>)}</>
}
const Total = ({ label, value, strong = false, sign = '' }: { label: string; value: number; strong?: boolean; sign?: string }) =>
  <tr className={strong ? 'border-t-2 border-slate-300 bg-slate-50 text-base font-bold' : 'font-semibold'}><td>{label}</td><td /><td className="text-right tabular-nums">{sign}{formatAmount(value)}</td></tr>
const Empty = ({ label }: { label: string }) => <tr><td className="pl-8 text-xs italic text-slate-400">{label}</td><td /><td /></tr>

/** État des résultats from posted entries of the period (regularisations included). */
export function IncomeStatementReport({ period }: { period: Period }) {
  const { balances, error } = useBalances(period.from || null, period.to || null)
  const r = balances ? incomeStatement(balances) : null

  const exportSheet = () => r && void downloadSheet(`etat-des-resultats-${period.from}-${period.to}.xlsx`, 'État des résultats', [
    ['Rubrique', 'Compte', 'Montant'],
    ...r.sales.map((l) => ['Ventes brutes', `${l.account.code} ${l.account.name}`, l.amount]), ['Ventes brutes', '', r.grossSales],
    ...r.deductions.map((l) => ['Réductions sur ventes', `${l.account.code} ${l.account.name}`, -l.amount]), ['Ventes nettes', '', r.netSales],
    ...r.cogs.map((l) => ['Coût des marchandises vendues', `${l.account.code} ${l.account.name}`, -l.amount]), ['Marge brute', '', r.grossMargin],
    ...r.otherIncome.map((l) => ['Autres produits', `${l.account.code} ${l.account.name}`, l.amount]),
    ...r.expenses.map((l) => ["Charges d'exploitation", `${l.account.code} ${l.account.name}`, -l.amount]),
    ['Résultat net', '', r.netResult],
  ])

  return <ReportFrame title="État des résultats" period={describePeriod(period)} icon={TrendingUp} subtitle="écritures validées, régularisations comprises" onExport={r ? exportSheet : undefined}>
    {error && <p role="alert" className="ui-alert-error mx-5">{error}</p>}
    {!r ? <CardsSkeleton count={3} className="grid gap-4 p-5 sm:grid-cols-3" /> : <>
      <dl className="grid grid-cols-2 gap-px bg-slate-200 sm:grid-cols-4 print:hidden">
        {[['Ventes nettes', r.netSales], ['Marge brute', r.grossMargin], ['Charges d’exploitation', r.totalExpenses], [r.netResult >= 0 ? 'Bénéfice net' : 'Perte nette', r.netResult]].map(([label, value]) =>
          <div key={label as string} className="bg-white px-5 py-3"><dt className="text-xs text-slate-500">{label}</dt><dd className={`mt-0.5 text-lg font-bold tabular-nums ${label === 'Perte nette' ? 'text-red-700' : 'text-slate-950'}`}>{formatAmount(Number(value))}</dd></div>)}
      </dl>
      <div className="overflow-x-auto">
        <table className="ui-table report-table mx-auto max-w-3xl text-sm">
          <thead><tr><th>Rubrique</th><th className="text-right">Détail</th><th className="text-right">Montant (HTG)</th></tr></thead>
          <tbody>
            <tr className="bg-slate-100/80"><td colSpan={3} className="text-xs font-bold uppercase tracking-wide text-slate-700">Ventes</td></tr>
            {r.sales.length ? <Lines lines={r.sales} /> : <Empty label="Aucune vente" />}
            <Total label="Ventes brutes" value={r.grossSales} />
            {r.deductions.length ? <Lines lines={r.deductions} sign="− " /> : <Empty label="Aucune remise ni retour" />}
            <Total label="Total des remises, retours et annulations" value={r.totalDeductions} sign="− " />
            <Total label="Ventes nettes" value={r.netSales} strong />
            {r.cogs.length ? <Lines lines={r.cogs} sign="− " /> : <Empty label="Aucun coût des marchandises vendues" />}
            <Total label="Coût des marchandises vendues" value={r.totalCogs} sign="− " />
            <Total label={`Marge brute${r.marginRate !== null ? ` (${(r.marginRate * 100).toFixed(1).replace('.', ',')} % des ventes nettes)` : ''}`} value={r.grossMargin} strong />
            <tr className="bg-slate-100/80"><td colSpan={3} className="text-xs font-bold uppercase tracking-wide text-slate-700">Autres produits</td></tr>
            {r.otherIncome.length ? <Lines lines={r.otherIncome} /> : <Empty label="Aucun autre produit" />}
            <Total label="Total des autres produits" value={r.totalOtherIncome} />
            <tr className="bg-slate-100/80"><td colSpan={3} className="text-xs font-bold uppercase tracking-wide text-slate-700">Charges d’exploitation</td></tr>
            {r.expenses.length ? <Lines lines={r.expenses} sign="− " /> : <Empty label="Aucune charge" />}
            <Total label="Total des charges" value={r.totalExpenses} sign="− " />
          </tbody>
          <tfoot><tr className={`border-t-2 border-slate-800 text-base font-bold ${r.netResult < 0 ? 'text-red-700' : 'text-slate-950'}`}><td>{r.netResult >= 0 ? 'Résultat net - bénéfice' : 'Résultat net - perte'}</td><td /><td className="text-right tabular-nums">{formatAmount(r.netResult)}</td></tr></tfoot>
        </table>
      </div>
      <p className="mx-auto max-w-3xl px-5 py-3 text-xs leading-5 text-slate-500 print:px-0">
        Ventes nettes = ventes brutes − remises − retours et annulations. Marge brute = ventes nettes − coût des marchandises vendues. Résultat net = marge brute + autres produits − charges.
        Les commissions sont prises en compte selon le compte où elles sont enregistrées (charge ou réduction des ventes), une seule fois. Les dépenses de caisse n’entrent dans ce rapport qu’une fois comptabilisées.
        {!r.consistent && <strong className="block text-red-700">Attention : le résultat ne correspond pas au total des comptes de produits et de charges. Vérifiez la ligne de l’état des résultats des comptes.</strong>}
      </p>
    </>}
  </ReportFrame>
}
