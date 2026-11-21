import type { ReactNode } from 'react'
import { AlertTriangle, CheckCircle2, Landmark } from 'lucide-react'
import { CardsSkeleton } from '../../components/Skeleton'
import { formatDay } from '../../lib/period'
import { downloadSheet } from '../../lib/spreadsheet'
import { balanceSheet, financialYearStart, type SheetSection, type StatementLine } from '../../lib/statements'
import { formatAmount } from '../../services/ledgerService'
import { ReportFrame } from './ReportFrame'
import { useBalances } from './useBalances'

const Line = ({ line }: { line: StatementLine }) => <div className="flex justify-between gap-4 py-1 pl-4 text-sm text-slate-600">
  <span><span className="font-mono text-xs text-slate-400">{line.account.code}</span> {line.account.name}</span>
  <span className={`tabular-nums ${line.amount < 0 ? 'text-slate-500' : ''}`}>{line.amount < 0 ? `(${formatAmount(-line.amount)})` : formatAmount(line.amount)}</span>
</div>

function Section({ section }: { section: SheetSection }) {
  return <div className="break-inside-avoid">
    <p className="mt-3 text-xs font-bold uppercase tracking-wide text-slate-700">{section.label}</p>
    {section.lines.length ? section.lines.map((line) => <Line key={line.account.account_id} line={line} />) : <p className="py-1 pl-4 text-xs italic text-slate-400">Aucun solde</p>}
    <div className="mt-1 flex justify-between border-t border-slate-200 pt-1 text-sm font-semibold"><span>Total {section.label.toLowerCase()}</span><span className="tabular-nums">{formatAmount(section.total)}</span></div>
  </div>
}

const Column = ({ title, total, children }: { title: string; total: number; children: ReactNode }) => <div className="flex flex-col">
  <h3 className="border-b-2 border-slate-800 pb-1 text-sm font-bold uppercase tracking-wide text-slate-900">{title}</h3>
  <div className="flex-1">{children}</div>
  <div className="mt-4 flex justify-between border-t-2 border-slate-800 bg-slate-50 px-2 py-2 text-base font-bold"><span>Total</span><span className="tabular-nums">{formatAmount(total)}</span></div>
</div>

/** Bilan at the "Au" date: assets = liabilities + equity, with this year's and prior results. */
export function BalanceSheetReport({ date, onOpenTrialBalance }: { date: string; onOpenTrialBalance: () => void }) {
  const yearStart = financialYearStart(date)
  const { balances, error } = useBalances(yearStart, date, Boolean(date))
  const r = balances ? balanceSheet(balances) : null
  const ok = r ? Math.abs(r.difference) < 0.005 : true

  const exportSheet = () => r && void downloadSheet(`bilan-${date}.xlsx`, 'Bilan', [
    ['Rubrique', 'Compte', 'Montant'],
    ...r.assets.flatMap((section) => [...section.lines.map((l) => [section.label, `${l.account.code} ${l.account.name}`, l.amount]), [`Total ${section.label}`, '', section.total]]),
    ['Total de l’actif', '', r.totalAssets],
    ...r.liabilities.flatMap((section) => [...section.lines.map((l) => [section.label, `${l.account.code} ${l.account.name}`, l.amount]), [`Total ${section.label}`, '', section.total]]),
    ...r.equityLines.map((l) => ['Capitaux propres', `${l.account.code} ${l.account.name}`, l.amount]),
    ['Capitaux propres', 'Résultats antérieurs non affectés', r.priorResults], ['Capitaux propres', 'Résultat de l’exercice', r.currentResult],
    ['Total des capitaux propres', '', r.totalEquity], ['Total du passif et des capitaux propres', '', r.totalLiabilitiesAndEquity],
  ])

  return <ReportFrame title="Bilan - état de la situation financière" period={date ? `Situation au ${formatDay(date)}` : 'Choisissez une date'} icon={Landmark} subtitle={`exercice ouvert le ${formatDay(yearStart)}`} onExport={r ? exportSheet : undefined}>
    {error && <p role="alert" className="ui-alert-error mx-5">{error}</p>}
    {!r ? <CardsSkeleton count={2} className="grid gap-4 p-5 lg:grid-cols-2" /> : <>
      <div className={`mx-5 mt-4 flex flex-wrap items-center justify-between gap-3 rounded-lg px-4 py-3 text-sm print:mx-0 ${ok ? 'bg-emerald-50 text-emerald-900' : 'bg-red-50 text-red-900'}`}>
        <p className="flex items-center gap-2 font-semibold">{ok ? <CheckCircle2 className="h-4 w-4" aria-hidden="true" /> : <AlertTriangle className="h-4 w-4" aria-hidden="true" />}
          Actif {formatAmount(r.totalAssets)} {ok ? '=' : '≠'} Passif {formatAmount(r.totalLiabilities)} + Capitaux propres {formatAmount(r.totalEquity)}
          {!ok && ` - écart de ${formatAmount(Math.abs(r.difference))}`}</p>
        {!ok && <button type="button" onClick={onOpenTrialBalance} className="no-print rounded-md bg-white px-3 py-1.5 text-xs font-semibold text-red-800 ring-1 ring-red-200 hover:bg-red-100">Rechercher dans la balance de vérification</button>}
      </div>
      <div className="grid gap-8 p-5 lg:grid-cols-2 print:grid-cols-2 print:px-0">
        <Column title="Actif" total={r.totalAssets}>{r.assets.map((section) => <Section key={section.label} section={section} />)}</Column>
        <Column title="Passif et capitaux propres" total={r.totalLiabilitiesAndEquity}>
          {r.liabilities.map((section) => <Section key={section.label} section={section} />)}
          <div className="break-inside-avoid">
            <p className="mt-3 text-xs font-bold uppercase tracking-wide text-slate-700">Capitaux propres</p>
            {r.equityLines.map((line) => <Line key={line.account.account_id} line={line} />)}
            <Line line={{ account: { account_id: 'prior', code: '', name: 'Résultats antérieurs non affectés' } as StatementLine['account'], amount: r.priorResults }} />
            <Line line={{ account: { account_id: 'current', code: '', name: `Résultat de l’exercice ${date.slice(0, 4)}${r.currentResult < 0 ? ' (perte)' : ''}` } as StatementLine['account'], amount: r.currentResult }} />
            <div className="mt-1 flex justify-between border-t border-slate-200 pt-1 text-sm font-semibold"><span>Total capitaux propres</span><span className="tabular-nums">{formatAmount(r.totalEquity)}</span></div>
          </div>
        </Column>
      </div>
      <p className="px-5 pb-4 text-xs text-slate-500 print:px-0">Montants entre parenthèses : comptes correcteurs (amortissements) déduits de l’actif. Le résultat de l’exercice est intégré aux capitaux propres jusqu’à son affectation.</p>
    </>}
  </ReportFrame>
}
