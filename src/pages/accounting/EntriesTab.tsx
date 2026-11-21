import { useEffect, useMemo, useState } from 'react'
import { ChevronLeft, ChevronRight, NotebookPen, Pencil, Plus, Power, Search } from 'lucide-react'
import { PeriodFilter } from '../../components/PeriodFilter'
import { formatDateTime, formatDay, monthToDate, periodError, type Period } from '../../lib/period'
import { TableRowsSkeleton } from '../../components/Skeleton'
import type { Account, AccountBalance, AccountMovement, JournalEntryDraft, JournalEntryStatus, JournalEntryType, JournalEntryWithLines } from '../../types/accounting'
import { ACCOUNT_TYPE_LABELS, ENTRIES_PAGE_SIZE, ENTRY_TYPE_LABELS, NATURE_LABELS, REGULARISATION_KIND_LABELS, STATUS_LABELS, TERM_LABELS, entryStatus, formatAmount, ledgerService } from '../../services/ledgerService'
import { EntryActions, HistoryDialog, ReturnDialog, VoidDialog } from './EntryDialogs'
import { AccountSelect } from './AccountSelect'
import { EntryFormDialog } from './EntryForm'
import { draftFromEntry, newDraft } from './drafts'


/** Selected account: details, balance for the period, movements and actions. */
function AccountPanel({ account, period, version, onNewEntry, onEdit, onToggleActive }: { account: Account; period: Period; version: number; onNewEntry: () => void; onEdit: () => void; onToggleActive: () => void }) {
  const [balance, setBalance] = useState<AccountBalance | null>(null)
  const [movements, setMovements] = useState<AccountMovement[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    if (periodError(period)) return
    setMovements(null); setError(null)
    void Promise.all([ledgerService.balances(period.from || null, period.to || null), ledgerService.accountMovements(account.id, period.from || null, period.to || null)])
      .then(([balances, lines]) => {
        if (balances.error || lines.error) return setError((balances.error ?? lines.error)!.message)
        setBalance(balances.data?.find((row) => row.account_id === account.id) ?? null)
        setMovements(lines.data ?? [])
      })
  }, [account.id, period, version])

  const sign = account.nature === 'debit' ? 1 : -1
  const opening = balance ? sign * (Number(balance.opening_debit) - Number(balance.opening_credit)) : 0
  let running = opening
  return <section aria-label={`Compte ${account.code}`} className="ui-card mt-4 overflow-hidden animate-fade-up">
    <div className="flex flex-wrap items-start justify-between gap-4 border-b border-slate-200 bg-slate-50 px-5 py-4">
      <div>
        <p className="font-mono text-xs text-slate-500">{account.code}</p>
        <h3 className="text-lg font-bold text-slate-950">{account.name}</h3>
        <p className="mt-1 flex flex-wrap gap-1.5 text-xs">
          <span className="ui-badge ui-badge-neutral">{ACCOUNT_TYPE_LABELS[account.account_type]}</span>
          <span className={`ui-badge ${account.nature === 'debit' ? 'ui-badge-neutral' : 'ui-badge-success'}`}>Nature : {NATURE_LABELS[account.nature]}</span>
          {account.term && <span className="ui-badge ui-badge-neutral">{TERM_LABELS[account.term]}</span>}
          {!account.is_active && <span className="ui-badge ui-badge-danger">Inactif</span>}
        </p>
      </div>
      <div className="flex flex-wrap gap-2">
        <button type="button" onClick={onNewEntry} disabled={!account.is_active} className="ui-button-primary px-3 py-2"><Plus className="h-4 w-4" aria-hidden="true" />Écriture sur ce compte</button>
        <button type="button" onClick={onEdit} className="ui-button-secondary px-3 py-2"><Pencil className="h-4 w-4" aria-hidden="true" />Modifier</button>
        <button type="button" onClick={onToggleActive} className="ui-button-secondary px-3 py-2"><Power className="h-4 w-4" aria-hidden="true" />{account.is_active ? 'Désactiver' : 'Réactiver'}</button>
      </div>
    </div>
    {error && <p role="alert" className="ui-alert-error mx-5">{error}</p>}
    <dl className="grid grid-cols-2 gap-px bg-slate-200 sm:grid-cols-4">
      {[['Solde d’ouverture', opening], ['Total débit', Number(balance?.period_debit ?? 0) + Number(balance?.regularisation_debit ?? 0)], ['Total crédit', Number(balance?.period_credit ?? 0) + Number(balance?.regularisation_credit ?? 0)], ['Solde de clôture', Number(balance?.balance ?? 0)]].map(([label, value]) =>
        <div key={label as string} className="bg-white px-5 py-3"><dt className="text-xs text-slate-500">{label}</dt><dd className={`mt-0.5 text-base font-semibold tabular-nums ${Number(value) < 0 ? 'text-red-700' : 'text-slate-950'}`}>{balance || movements ? formatAmount(Number(value)) : '…'} <span className="text-xs font-normal text-slate-400">HTG</span></dd></div>)}
    </dl>
    {Number(balance?.balance ?? 0) < 0 && <p className="border-t border-amber-200 bg-amber-50 px-5 py-2 text-xs text-amber-900">Solde inversé : ce compte de nature {NATURE_LABELS[account.nature].toLowerCase()} présente un solde de sens contraire. Vérifiez les écritures.</p>}
    <div className="max-h-80 overflow-auto">
      <table className="ui-table text-sm">
        <thead className="sticky top-0"><tr><th>Date</th><th>N°</th><th>Référence</th><th>Libellé</th><th className="text-right">Débit</th><th className="text-right">Crédit</th><th className="text-right">Solde</th></tr></thead>
        <tbody>
          <tr className="bg-slate-50/60 text-slate-500"><td colSpan={6}>Solde d’ouverture au {formatDay(period.from)}</td><td className="text-right tabular-nums">{formatAmount(opening)}</td></tr>
          {movements === null ? <TableRowsSkeleton rows={4} cols={7} />
            : movements.length === 0 ? <tr><td colSpan={7} className="ui-empty py-6">Aucun mouvement validé sur la période.</td></tr>
            : movements.map((line) => {
              running += sign * (Number(line.debit_amount) - Number(line.credit_amount))
              return <tr key={line.id}>
                <td className="whitespace-nowrap tabular-nums">{formatDay(line.entry.entry_date)}</td>
                <td className="whitespace-nowrap font-mono text-xs">{line.entry.entry_number}</td>
                <td className="text-slate-600">{line.entry.reference ?? '-'}</td>
                <td>{line.description ?? line.entry.description}{line.entry.entry_type === 'regularisation' && <span className="ml-2 ui-badge ui-badge-warning">Régularisation</span>}</td>
                <td className="text-right tabular-nums">{Number(line.debit_amount) ? formatAmount(Number(line.debit_amount)) : ''}</td>
                <td className="text-right tabular-nums">{Number(line.credit_amount) ? formatAmount(Number(line.credit_amount)) : ''}</td>
                <td className="text-right font-medium tabular-nums">{formatAmount(running)}</td>
              </tr>
            })}
        </tbody>
      </table>
    </div>
  </section>
}

export function EntriesTab({ accounts, initialAccountId = '', onEditAccount, onToggleAccount, onNotice }: { accounts: Account[]; initialAccountId?: string; onEditAccount: (account: Account) => void; onToggleAccount: (account: Account) => void; onNotice: (message: string) => void }) {
  const [period, setPeriod] = useState<Period>(monthToDate)
  const [status, setStatus] = useState<JournalEntryStatus | ''>('')
  const [type, setType] = useState<JournalEntryType | ''>('')
  const [search, setSearch] = useState('')
  const [query, setQuery] = useState('')
  const [page, setPage] = useState(0)
  const [selectedAccount, setSelectedAccount] = useState(initialAccountId)
  const [entries, setEntries] = useState<JournalEntryWithLines[] | null>(null)
  const [count, setCount] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const [form, setForm] = useState<JournalEntryDraft | null>(null)
  const [voiding, setVoiding] = useState<JournalEntryWithLines | null>(null)
  const [historyOf, setHistoryOf] = useState<JournalEntryWithLines | null>(null)
  const [refresh, setRefresh] = useState(0)
  const [returning, setReturning] = useState<JournalEntryWithLines | null>(null)
  const account = useMemo(() => accounts.find((item) => item.id === selectedAccount) ?? null, [accounts, selectedAccount])

  useEffect(() => {
    if (periodError(period)) return
    setEntries(null); setError(null)
    void ledgerService.listEntries({ from: period.from, to: period.to, status, type, search: query, page }).then(({ data, error: loadError, count: total }) => {
      if (loadError) { setError(loadError.message); setEntries([]); return }
      setEntries(data ?? []); setCount(total ?? 0)
    })
  }, [period, status, type, query, page, refresh])

  const reload = (message?: string) => { if (message) onNotice(message); setForm(null); setVoiding(null); setReturning(null); setRefresh((value) => value + 1) }

  return <div>
    <section aria-label="Consulter un compte" className="ui-card p-4">
      <div className="flex flex-wrap items-end gap-3">
        <label className="min-w-72 flex-1 text-xs font-medium text-slate-600">Compte
          <AccountSelect accounts={accounts} value={selectedAccount} onChange={setSelectedAccount} includeInactive placeholder="Tous les comptes - choisir un compte pour voir son détail" className="mt-1 w-full" />
        </label>
        <PeriodFilter value={period} onChange={(next) => { setPage(0); setPeriod(next) }} />
      </div>
    </section>
    {account && <AccountPanel account={account} period={period} version={refresh} onNewEntry={() => setForm(newDraft(account.id))} onEdit={() => onEditAccount(account)} onToggleActive={() => onToggleAccount(account)} />}

    <section aria-labelledby="journal-title" className="ui-card mt-5 overflow-hidden">
      <div className="flex flex-wrap items-end justify-between gap-3 border-b border-slate-200 px-5 py-4">
        <div><h3 id="journal-title" className="flex items-center gap-2 text-base font-bold text-slate-950"><NotebookPen className="h-5 w-5 text-brand-700" aria-hidden="true" />Journal des écritures</h3><p className="mt-0.5 text-sm text-slate-600">{count} écriture(s) sur la période</p></div>
        <div className="flex flex-wrap items-end gap-2">
          <label className="text-xs font-medium text-slate-600">Statut<select value={status} onChange={(event) => { setPage(0); setStatus(event.target.value as JournalEntryStatus | '') }} className="mt-1 block"><option value="">Tous</option>{(Object.keys(STATUS_LABELS) as JournalEntryStatus[]).map((item) => <option key={item} value={item}>{STATUS_LABELS[item]}</option>)}</select></label>
          <label className="text-xs font-medium text-slate-600">Type<select value={type} onChange={(event) => { setPage(0); setType(event.target.value as JournalEntryType | '') }} className="mt-1 block"><option value="">Tous</option>{(Object.keys(ENTRY_TYPE_LABELS) as JournalEntryType[]).map((item) => <option key={item} value={item}>{ENTRY_TYPE_LABELS[item]}</option>)}</select></label>
          <form onSubmit={(event) => { event.preventDefault(); setPage(0); setQuery(search) }} className="flex items-end gap-1"><label className="text-xs font-medium text-slate-600">Recherche<input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="N°, libellé, référence" className="mt-1 block w-48" /></label><button aria-label="Rechercher" className="ui-button-secondary px-3 py-2"><Search className="h-4 w-4" aria-hidden="true" /></button></form>
          <button type="button" onClick={() => setForm(newDraft(selectedAccount))} className="ui-button-primary"><Plus className="h-4 w-4" aria-hidden="true" />Nouvelle écriture</button>
        </div>
      </div>
      {error && <p role="alert" className="ui-alert-error mx-5">{error}</p>}
      <div className="overflow-x-auto">
        <table className="ui-table text-sm">
          <thead><tr><th>Date</th><th>N°</th><th>Référence</th><th>Libellé</th><th>Compte</th><th>Nature du compte</th><th className="text-right">Débit</th><th className="text-right">Crédit</th><th>Statut</th><th className="text-right">Actions</th></tr></thead>
          {entries === null ? <tbody><TableRowsSkeleton rows={6} cols={10} /></tbody>
            : entries.length === 0 ? <tbody><tr><td colSpan={10} className="ui-empty">Aucune écriture sur la période. Utilisez « Nouvelle écriture » pour en saisir une.</td></tr></tbody>
            : entries.map((entry) => {
              const lines = [...entry.lines].sort((a, b) => a.line_number - b.line_number)
              const voided = entry.status === 'voided'
              return <tbody key={entry.id} className={`border-t-2 border-slate-200 ${voided ? 'text-slate-400' : ''}`}>
                <tr className="bg-slate-50/70 hover:bg-slate-50/70">
                  <td className="whitespace-nowrap font-medium tabular-nums">{formatDay(entry.entry_date)}</td>
                  <td className="whitespace-nowrap font-mono text-xs">{entry.entry_number}</td>
                  <td>{entry.reference ?? '-'}</td>
                  <td colSpan={3}><span className={`font-semibold ${voided ? 'line-through' : 'text-slate-900'}`}>{entry.description}</span>
                    {entry.entry_type !== 'standard' && <span className="ml-2 ui-badge ui-badge-neutral">{entry.regularisation_kind ? `${ENTRY_TYPE_LABELS[entry.entry_type]} · ${REGULARISATION_KIND_LABELS[entry.regularisation_kind]}` : ENTRY_TYPE_LABELS[entry.entry_type]}</span>}
                    {entry.justification && <span className="mt-0.5 block text-xs text-slate-500">Justification : {entry.justification}</span>}
                    {voided && <span className="mt-0.5 block text-xs text-red-700">Annulée le {formatDateTime(entry.voided_at!)} par {entry.voider?.full_name ?? '-'} - {entry.void_reason}</span>}
                  </td>
                  <td className="text-right font-semibold tabular-nums">{formatAmount(Number(entry.total_debit))}</td>
                  <td className="text-right font-semibold tabular-nums">{formatAmount(Number(entry.total_credit))}</td>
                  <td><span className={`ui-badge ${entryStatus(entry).badge}`}>{entryStatus(entry).label}</span></td>
                  <td className="text-right"><EntryActions entry={entry} onEdit={() => setForm(draftFromEntry(entry))} onVoid={() => setVoiding(entry)} onReturn={() => setReturning(entry)} onHistory={() => setHistoryOf(entry)} onDone={reload} onError={setError} /></td>
                </tr>
                {lines.map((line) => <tr key={line.id} className="text-[13px]">
                  <td colSpan={3} />
                  <td className="text-slate-500">{line.description ?? ''}</td>
                  <td className="whitespace-nowrap"><button type="button" onClick={() => setSelectedAccount(line.account_id)} className="text-left hover:text-brand-700 hover:underline"><span className="font-mono text-xs">{line.account?.code}</span> {line.account?.name}</button></td>
                  <td>{line.account && <span className={`ui-badge ${line.account.nature === 'debit' ? 'ui-badge-neutral' : 'ui-badge-success'}`}>{NATURE_LABELS[line.account.nature]}</span>}</td>
                  <td className="text-right tabular-nums">{Number(line.debit_amount) ? formatAmount(Number(line.debit_amount)) : ''}</td>
                  <td className="text-right tabular-nums">{Number(line.credit_amount) ? formatAmount(Number(line.credit_amount)) : ''}</td>
                  <td colSpan={2} />
                </tr>)}
              </tbody>
            })}
        </table>
      </div>
      {count > ENTRIES_PAGE_SIZE && <div className="flex items-center justify-between border-t border-slate-200 px-5 py-3 text-sm">
        <span className="text-slate-500">Page {page + 1} / {Math.ceil(count / ENTRIES_PAGE_SIZE)}</span>
        <span className="flex gap-2">
          <button type="button" disabled={page === 0} onClick={() => setPage((value) => value - 1)} className="ui-button-secondary px-3 py-1.5"><ChevronLeft className="h-4 w-4" aria-hidden="true" />Précédent</button>
          <button type="button" disabled={(page + 1) * ENTRIES_PAGE_SIZE >= count} onClick={() => setPage((value) => value + 1)} className="ui-button-secondary px-3 py-1.5">Suivant<ChevronRight className="h-4 w-4" aria-hidden="true" /></button>
        </span>
      </div>}
    </section>

    {form && <EntryFormDialog initial={form} accounts={accounts} onClose={() => setForm(null)} onSaved={reload} />}
    {voiding && <VoidDialog entry={voiding} onClose={() => setVoiding(null)} onDone={reload} />}
    {returning && <ReturnDialog entry={returning} onClose={() => setReturning(null)} onDone={reload} />}
    {historyOf && <HistoryDialog entry={historyOf} onClose={() => setHistoryOf(null)} />}
  </div>
}
