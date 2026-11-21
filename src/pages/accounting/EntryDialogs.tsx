import { useEffect, useState } from 'react'
import { Ban, Check, History, Pencil, Send, Undo2 } from 'lucide-react'
import { Modal } from '../../components/Modal'
import { useAuth } from '../../contexts/AuthContext'
import { formatDateTime, formatDay } from '../../lib/period'
import type { JournalEntryWithLines, JournalHistory } from '../../types/accounting'
import { formatAmount, ledgerService } from '../../services/ledgerService'

// Dialogs and row actions shared by the Écritures and Régularisation tabs.
const historyLabels: Record<JournalHistory['action'], string> = { created: 'Création', updated: 'Modification', submitted: 'Soumission pour validation', returned: 'Renvoi au préparateur', posted: 'Validation', voided: 'Annulation' }

export function VoidDialog({ entry, onClose, onDone }: { entry: JournalEntryWithLines; onClose: () => void; onDone: (message: string) => void }) {
  const [reason, setReason] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const submit = async () => {
    if (reason.trim().length < 3) return setError('Indiquez le motif de l’annulation.')
    setSaving(true)
    const { error: voidError } = await ledgerService.voidEntry(entry.id, reason.trim())
    setSaving(false)
    if (voidError) return setError(voidError.message)
    onDone(`Écriture ${entry.entry_number} annulée.`)
  }
  return <Modal size="sm" title={`Annuler l’écriture ${entry.entry_number}`} subtitle={entry.description} onClose={onClose} locked={saving}
    footer={<><button type="button" onClick={onClose} className="ui-button-secondary">Retour</button><button type="button" onClick={() => void submit()} disabled={saving} className="ui-button-primary bg-red-700 hover:bg-red-800"><Ban className="h-4 w-4" aria-hidden="true" />{saving ? 'Annulation…' : 'Annuler l’écriture'}</button></>}>
    {error && <p role="alert" className="ui-alert-error mt-0 mb-3">{error}</p>}
    <p className="text-sm text-slate-600">L’écriture reste visible avec la mention « Annulée », le motif, la date et votre nom. Elle n’est plus prise en compte dans les soldes et les rapports.</p>
    <label className="mt-4 block text-sm font-medium text-slate-700">Motif *<textarea autoFocus rows={3} value={reason} onChange={(event) => setReason(event.target.value)} placeholder="Ex. : saisie en double de la facture F-12" className="mt-1 w-full" /></label>
  </Modal>
}

export function HistoryDialog({ entry, onClose }: { entry: JournalEntryWithLines; onClose: () => void }) {
  const [history, setHistory] = useState<JournalHistory[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => { void ledgerService.entryHistory(entry.id).then(({ data, error: loadError }) => loadError ? setError(loadError.message) : setHistory(data ?? [])) }, [entry.id])
  return <Modal title={`Historique de l’écriture ${entry.entry_number}`} subtitle={entry.description} onClose={onClose}>
    {error && <p role="alert" className="ui-alert-error mt-0">{error}</p>}
    {history === null && !error ? <p className="text-sm text-slate-500">Chargement…</p> : history?.length === 0 ? <p className="text-sm text-slate-500">Aucun historique (écriture antérieure au suivi des modifications).</p> : <ol className="space-y-3">
      {history?.map((item) => <li key={item.id} className="rounded-lg border border-slate-200 p-3 text-sm">
        <p className="flex flex-wrap items-center justify-between gap-2"><strong className="text-slate-900">{historyLabels[item.action]}</strong><span className="text-xs text-slate-500">{formatDateTime(item.changed_at)} · {item.author?.full_name ?? '-'}</span></p>
        {item.reason && <p className={`mt-1 text-xs ${item.action === 'voided' ? 'text-red-800' : 'text-amber-800'}`}>Motif : {item.reason}</p>}
        <p className="mt-1 text-xs text-slate-600">{formatDay(item.snapshot.entry_date)} · {item.snapshot.description} · débit {formatAmount(Number(item.snapshot.total_debit))} / crédit {formatAmount(Number(item.snapshot.total_credit))}</p>
        <ul className="mt-1.5 space-y-0.5 text-xs text-slate-500">{item.snapshot.lines.map((line, index) => <li key={index} className="flex justify-between gap-3"><span>{line.code} {line.name}</span><span className="tabular-nums">{Number(line.debit_amount) ? `D ${formatAmount(Number(line.debit_amount))}` : `C ${formatAmount(Number(line.credit_amount))}`}</span></li>)}</ul>
      </li>)}
    </ol>}
  </Modal>
}

/** Sends a submitted regularisation back to its preparer, with the reason. */
export function ReturnDialog({ entry, onClose, onDone }: { entry: JournalEntryWithLines; onClose: () => void; onDone: (message: string) => void }) {
  const [reason, setReason] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const submit = async () => {
    if (reason.trim().length < 3) return setError('Indiquez le motif du renvoi.')
    setSaving(true)
    const { error: returnError } = await ledgerService.returnEntry(entry.id, reason.trim())
    setSaving(false)
    if (returnError) return setError(returnError.message)
    onDone(`Régularisation ${entry.entry_number} renvoyée au préparateur.`)
  }
  return <Modal size="sm" title={`Renvoyer la régularisation ${entry.entry_number}`} subtitle={entry.description} onClose={onClose} locked={saving}
    footer={<><button type="button" onClick={onClose} className="ui-button-secondary">Retour</button><button type="button" onClick={() => void submit()} disabled={saving} className="ui-button-primary"><Undo2 className="h-4 w-4" aria-hidden="true" />{saving ? 'Envoi…' : 'Renvoyer'}</button></>}>
    {error && <p role="alert" className="ui-alert-error mt-0 mb-3">{error}</p>}
    <p className="text-sm text-slate-600">L’écriture redevient un brouillon modifiable. Le motif est conservé dans l’historique.</p>
    <label className="mt-4 block text-sm font-medium text-slate-700">Motif *<textarea autoFocus rows={3} value={reason} onChange={(event) => setReason(event.target.value)} placeholder="Ex. : joindre la facture, le montant ne correspond pas" className="mt-1 w-full" /></label>
  </Modal>
}

type ActionHandlers = { onEdit: () => void; onVoid: () => void; onReturn: () => void; onHistory: () => void; onDone: (message: string) => void; onError: (message: string) => void }

/**
 * Row actions following the entry's state: drafts are edited, standard drafts are
 * posted directly, regularisations are submitted then validated or returned by
 * an authorised role.
 */
export function EntryActions({ entry, onEdit, onVoid, onReturn, onHistory, onDone, onError }: { entry: JournalEntryWithLines } & ActionHandlers) {
  const [busy, setBusy] = useState(false)
  const manual = ['standard', 'regularisation', 'opening'].includes(entry.entry_type)
  const regularisation = entry.entry_type === 'regularisation'
  const submitted = Boolean(entry.submitted_at)
  const validator = useAuth().can('accounting.validate')
  const act = async (action: () => Promise<{ error: Error | null }>, message: string) => {
    setBusy(true)
    const { error } = await action()
    setBusy(false)
    if (error) onError(`${entry.entry_number} : ${error.message}`)
    else onDone(message)
  }
  const button = 'rounded p-1.5 text-slate-500 disabled:opacity-40'
  return <span className="inline-flex whitespace-nowrap">
    {entry.status === 'draft' && manual && <button type="button" onClick={onEdit} disabled={busy} title={submitted ? 'Modifier (retire la soumission)' : 'Modifier'} className={`${button} hover:bg-slate-100 hover:text-brand-700`}><Pencil className="h-4 w-4" aria-label="Modifier" /></button>}
    {entry.status === 'draft' && regularisation && !submitted && <button type="button" onClick={() => void act(() => ledgerService.submitEntry(entry.id), `Régularisation ${entry.entry_number} soumise pour validation.`)} disabled={busy} title="Soumettre pour validation" className={`${button} hover:bg-amber-50 hover:text-amber-700`}><Send className="h-4 w-4" aria-label="Soumettre" /></button>}
    {entry.status === 'draft' && (!regularisation || (submitted && validator)) && <button type="button" onClick={() => void act(() => ledgerService.postEntry(entry.id), `Écriture ${entry.entry_number} validée.`)} disabled={busy} title="Valider" className={`${button} hover:bg-emerald-50 hover:text-emerald-700`}><Check className="h-4 w-4" aria-label="Valider" /></button>}
    {entry.status === 'draft' && regularisation && submitted && validator && <button type="button" onClick={onReturn} disabled={busy} title="Renvoyer au préparateur" className={`${button} hover:bg-amber-50 hover:text-amber-700`}><Undo2 className="h-4 w-4" aria-label="Renvoyer" /></button>}
    {entry.status !== 'voided' && <button type="button" onClick={onVoid} disabled={busy} title="Annuler" className={`${button} hover:bg-red-50 hover:text-red-700`}><Ban className="h-4 w-4" aria-label="Annuler" /></button>}
    <button type="button" onClick={onHistory} title="Historique" className={`${button} hover:bg-slate-100`}><History className="h-4 w-4" aria-label="Historique" /></button>
  </span>
}
