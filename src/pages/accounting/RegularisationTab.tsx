import { useEffect, useState } from 'react'
import { FileCheck2, Plus } from 'lucide-react'
import { PeriodFilter } from '../../components/PeriodFilter'
import { TableRowsSkeleton } from '../../components/Skeleton'
import { useAuth } from '../../contexts/AuthContext'
import { formatDay, monthToDate, periodError, type Period } from '../../lib/period'
import type { Account, JournalEntryDraft, JournalEntryWithLines } from '../../types/accounting'
import { REGULARISATION_KIND_LABELS, entryStatus, formatAmount, ledgerService } from '../../services/ledgerService'
import { RegularisationBalanceReport } from '../reports/RegularisationBalanceReport'
import { EntryActions, HistoryDialog, ReturnDialog, VoidDialog } from './EntryDialogs'
import { EntryFormDialog } from './EntryForm'
import { draftFromEntry, newDraft } from './drafts'

function Steps({ pending, posted }: { pending: number; posted: number }) {
  const steps = [
    { label: 'Balance avant régularisation', hint: 'Contrôler les soldes de la période', state: 'done' },
    { label: 'Écritures de régularisation', hint: pending ? `${pending} en attente de validation` : `${posted} validée(s)`, state: pending ? 'current' : 'done' },
    { label: 'Balance de régularisation', hint: 'Vérifier l’équilibre après régularisation', state: pending ? 'todo' : 'current' },
    { label: 'États financiers définitifs', hint: 'Rapports : bilan, résultat', state: 'todo' },
  ]
  return <ol aria-label="Ordre comptable" className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
    {steps.map((step, index) => <li key={step.label} className={`flex items-start gap-3 rounded-lg border px-3 py-2.5 ${step.state === 'current' ? 'border-brand-600 bg-brand-100/50' : 'border-slate-200 bg-white'}`}>
      <span className={`grid h-6 w-6 shrink-0 place-items-center rounded-full text-xs font-bold ${step.state === 'done' ? 'bg-brand-700 text-white' : step.state === 'current' ? 'bg-accent-500 text-brand-950' : 'bg-slate-200 text-slate-600'}`}>{index + 1}</span>
      <span className="min-w-0"><strong className="block text-sm text-slate-900">{step.label}</strong><small className="block text-xs text-slate-500">{step.hint}</small></span>
    </li>)}
  </ol>
}

export function RegularisationTab({ accounts, onNotice }: { accounts: Account[]; onNotice: (message: string) => void }) {
  const { can } = useAuth()
  const [period, setPeriod] = useState<Period>(monthToDate)
  const [entries, setEntries] = useState<JournalEntryWithLines[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [form, setForm] = useState<JournalEntryDraft | null>(null)
  const [voiding, setVoiding] = useState<JournalEntryWithLines | null>(null)
  const [returning, setReturning] = useState<JournalEntryWithLines | null>(null)
  const [historyOf, setHistoryOf] = useState<JournalEntryWithLines | null>(null)
  const [refresh, setRefresh] = useState(0)

  useEffect(() => {
    if (periodError(period)) return
    setEntries(null); setError(null)
    void ledgerService.listEntries({ from: period.from, to: period.to, type: 'regularisation', pageSize: 200 }).then(({ data, error: loadError }) => {
      if (loadError) return setError(loadError.message)
      setEntries(data ?? [])
    })
  }, [period, refresh])

  const reload = (message?: string) => { if (message) onNotice(message); setForm(null); setVoiding(null); setReturning(null); setRefresh((value) => value + 1) }
  const pending = entries?.filter((entry) => entry.status === 'draft') ?? []
  const toValidate = pending.filter((entry) => entry.submitted_at)
  const posted = entries?.filter((entry) => entry.status === 'posted') ?? []
  return <div className="space-y-5">
    <section className="no-print ui-card space-y-4 p-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <PeriodFilter value={period} onChange={setPeriod} />
        <button type="button" onClick={() => setForm(newDraft('', 'regularisation'))} className="ui-button-primary"><Plus className="h-4 w-4" aria-hidden="true" />Nouvelle régularisation</button>
      </div>
      <Steps pending={pending.length} posted={posted.length} />
    </section>
    {error && <p role="alert" className="ui-alert-error">{error}</p>}
    {can('accounting.validate') && toValidate.length > 0 && <p role="status" className="no-print flex items-center gap-2 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900"><FileCheck2 className="h-4 w-4" aria-hidden="true" />{toValidate.length} régularisation(s) attendent votre validation.</p>}

    <section aria-labelledby="regularisations-title" className="no-print ui-card overflow-hidden">
      <div className="border-b border-slate-200 px-5 py-4"><h3 id="regularisations-title" className="text-base font-bold text-slate-950">Écritures de régularisation</h3><p className="mt-0.5 text-sm text-slate-600">Préparées et justifiées par le comptable, validées par un directeur ou un administrateur.</p></div>
      <div className="overflow-x-auto">
        <table className="ui-table text-sm">
          <thead><tr><th>Date</th><th>N°</th><th>Référence</th><th>Nature</th><th>Libellé et justification</th><th className="text-right">Montant</th><th>Préparée par</th><th>Statut</th><th className="text-right">Actions</th></tr></thead>
          <tbody>
            {entries === null ? <TableRowsSkeleton rows={3} cols={9} />
              : entries.length === 0 ? <tr><td colSpan={9} className="ui-empty">Aucune régularisation sur la période.</td></tr>
              : entries.map((entry) => <tr key={entry.id} className={entry.status === 'voided' ? 'text-slate-400' : ''}>
                <td className="whitespace-nowrap tabular-nums">{formatDay(entry.entry_date)}</td>
                <td className="whitespace-nowrap font-mono text-xs">{entry.entry_number}</td>
                <td>{entry.reference ?? '-'}</td>
                <td className="whitespace-nowrap">{entry.regularisation_kind ? REGULARISATION_KIND_LABELS[entry.regularisation_kind] : '-'}</td>
                <td className="min-w-64"><span className={`font-medium ${entry.status === 'voided' ? 'line-through' : 'text-slate-900'}`}>{entry.description}</span>{entry.justification && <span className="block text-xs text-slate-500">{entry.justification}</span>}</td>
                <td className="text-right tabular-nums">{formatAmount(Number(entry.total_debit))}</td>
                <td className="whitespace-nowrap text-slate-600">{entry.creator?.full_name ?? '-'}{entry.submitted_at && <span className="block text-xs text-slate-400">soumise par {entry.submitter?.full_name ?? '-'}</span>}</td>
                <td><span className={`ui-badge ${entryStatus(entry).badge}`}>{entryStatus(entry).label}</span></td>
                <td className="text-right"><EntryActions entry={entry} onEdit={() => setForm(draftFromEntry(entry))} onVoid={() => setVoiding(entry)} onReturn={() => setReturning(entry)} onHistory={() => setHistoryOf(entry)} onDone={reload} onError={setError} /></td>
              </tr>)}
          </tbody>
        </table>
      </div>
    </section>

    <RegularisationBalanceReport period={period} refreshKey={refresh} />

    {form && <EntryFormDialog initial={form} accounts={accounts} onClose={() => setForm(null)} onSaved={reload} />}
    {voiding && <VoidDialog entry={voiding} onClose={() => setVoiding(null)} onDone={reload} />}
    {returning && <ReturnDialog entry={returning} onClose={() => setReturning(null)} onDone={reload} />}
    {historyOf && <HistoryDialog entry={historyOf} onClose={() => setHistoryOf(null)} />}
  </div>
}
