import { useMemo, useState } from 'react'
import { AlertTriangle, CheckCircle2, Plus, Save, Send, Trash2 } from 'lucide-react'
import { Modal } from '../../components/Modal'
import type { Account, JournalEntryDraft, JournalLineDraft, RegularisationKind } from '../../types/accounting'
import { emptyLine } from './drafts'
import { ENTRY_TYPE_LABELS, NATURE_LABELS, REGULARISATION_KIND_LABELS, formatAmount, ledgerService } from '../../services/ledgerService'
import { AccountSelect } from './AccountSelect'

const cents = (value: number) => Math.round(value * 100) / 100

/** Multi-line journal entry. Drafts may be unbalanced; posting requires debit = credit. */
export function EntryFormDialog({ initial, accounts, onClose, onSaved }: { initial: JournalEntryDraft; accounts: Account[]; onClose: () => void; onSaved: (message: string) => void }) {
  const [draft, setDraft] = useState<JournalEntryDraft>(initial)
  const [saving, setSaving] = useState<'draft' | 'post' | null>(null)
  const [error, setError] = useState<string | null>(null)
  const byId = useMemo(() => new Map(accounts.map((account) => [account.id, account])), [accounts])
  const totalDebit = cents(draft.lines.reduce((sum, line) => sum + (line.debit || 0), 0))
  const totalCredit = cents(draft.lines.reduce((sum, line) => sum + (line.credit || 0), 0))
  const difference = cents(totalDebit - totalCredit)
  const balanced = difference === 0 && totalDebit > 0

  const setLine = (index: number, patch: Partial<JournalLineDraft>) => setDraft((current) => ({ ...current, lines: current.lines.map((line, position) => position === index ? { ...line, ...patch } : line) }))
  // A line is either a debit or a credit: typing one clears the other.
  const setAmount = (index: number, side: 'debit' | 'credit', raw: string) => {
    const value = Math.max(0, Number(raw) || 0)
    setLine(index, side === 'debit' ? { debit: value, credit: value ? 0 : draft.lines[index].credit } : { credit: value, debit: value ? 0 : draft.lines[index].debit })
  }
  // Puts the remaining difference on a line, as accounting software usually offers.
  const balanceOn = (index: number) => {
    const line = draft.lines[index]
    const rest = cents(totalDebit - (line.debit || 0) - (totalCredit - (line.credit || 0)))
    setLine(index, rest > 0 ? { credit: rest, debit: 0 } : { debit: -rest, credit: 0 })
  }

  const regularisation = draft.entry_type === 'regularisation'
  const save = async (post: boolean) => {
    setError(null)
    const lines = draft.lines.filter((line) => line.account_id || line.debit || line.credit)
    if (!draft.description.trim()) return setError('Le libellé est obligatoire.')
    if (draft.entry_type === 'regularisation' && !draft.justification.trim()) return setError('Une régularisation doit être justifiée.')
    if (lines.length < 2) return setError('Saisissez au moins deux lignes.')
    if (lines.some((line) => !line.account_id)) return setError('Chaque ligne doit avoir un compte.')
    if (lines.some((line) => !(line.debit > 0) === !(line.credit > 0))) return setError('Chaque ligne doit avoir soit un débit, soit un crédit.')
    if (post && !balanced) return setError(`L’écriture doit être équilibrée pour être ${regularisation ? 'soumise' : 'validée'} (débit = crédit).`)
    setSaving(post ? 'post' : 'draft')
    const { data, error: saveError } = await ledgerService.saveEntry({ ...draft, lines })
    if (saveError || !data) { setSaving(null); return setError(saveError?.message ?? 'Enregistrement impossible') }
    if (post) {
      // Regularisations are submitted for validation; other entries are posted directly.
      const { error: postError } = regularisation ? await ledgerService.submitEntry(data.id) : await ledgerService.postEntry(data.id)
      if (postError) { setSaving(null); setDraft((current) => ({ ...current, id: data.id })); return setError(`Brouillon ${data.entry_number} enregistré, mais non ${regularisation ? 'soumis' : 'validé'} : ${postError.message}`) }
    }
    onSaved(!post ? `Brouillon ${data.entry_number} enregistré.` : regularisation ? `Régularisation ${data.entry_number} soumise pour validation.` : `Écriture ${data.entry_number} validée.`)
  }

  return <Modal size="xl" title={draft.id ? 'Modifier le brouillon' : regularisation ? 'Nouvelle régularisation' : 'Nouvelle écriture'} subtitle="Écriture comptable" onClose={onClose} locked={saving !== null}
    footer={<>
      <p className={`mr-auto flex items-center gap-1.5 text-sm font-semibold ${balanced ? 'text-emerald-700' : 'text-amber-700'}`}>
        {balanced ? <CheckCircle2 className="h-4 w-4" aria-hidden="true" /> : <AlertTriangle className="h-4 w-4" aria-hidden="true" />}
        {balanced ? 'Écriture équilibrée' : `Écart : ${formatAmount(Math.abs(difference))} HTG ${difference > 0 ? '(débit supérieur)' : difference < 0 ? '(crédit supérieur)' : ''}`}
      </p>
      <button type="button" onClick={onClose} disabled={saving !== null} className="ui-button-secondary">Annuler</button>
      <button type="button" onClick={() => void save(false)} disabled={saving !== null} className="ui-button-secondary"><Save className="h-4 w-4" aria-hidden="true" />{saving === 'draft' ? 'Enregistrement…' : 'Enregistrer le brouillon'}</button>
      <button type="button" onClick={() => void save(true)} disabled={saving !== null || !balanced} className="ui-button-primary"><Send className="h-4 w-4" aria-hidden="true" />{saving === 'post' ? (regularisation ? 'Soumission…' : 'Validation…') : regularisation ? 'Enregistrer et soumettre' : 'Enregistrer et valider'}</button>
    </>}>
    {error && <p role="alert" className="ui-alert-error mt-0 mb-4">{error}</p>}
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
      <label className="text-sm font-medium text-slate-700">Date *<input type="date" required value={draft.entry_date} onChange={(event) => setDraft({ ...draft, entry_date: event.target.value })} className="mt-1 w-full" /></label>
      <label className="text-sm font-medium text-slate-700">Type
        <select value={draft.entry_type} onChange={(event) => setDraft({ ...draft, entry_type: event.target.value as JournalEntryDraft['entry_type'] })} className="mt-1 w-full">
          {(['standard', 'regularisation', 'opening'] as const).map((type) => <option key={type} value={type}>{ENTRY_TYPE_LABELS[type]}</option>)}
        </select>
      </label>
      <label className="text-sm font-medium text-slate-700">Référence / pièce<input value={draft.reference} onChange={(event) => setDraft({ ...draft, reference: event.target.value })} placeholder="FACT-0142" className="mt-1 w-full" /></label>
      <label className="text-sm font-medium text-slate-700 sm:col-span-2 lg:col-span-1">Libellé *<input required value={draft.description} onChange={(event) => setDraft({ ...draft, description: event.target.value })} placeholder="Paiement loyer novembre" className="mt-1 w-full" /></label>
      {draft.entry_type === 'regularisation' && <label className="text-sm font-medium text-slate-700">Nature de la régularisation *
        <select value={draft.regularisation_kind} onChange={(event) => setDraft({ ...draft, regularisation_kind: event.target.value as RegularisationKind })} className="mt-1 w-full">
          {(Object.keys(REGULARISATION_KIND_LABELS) as RegularisationKind[]).map((kind) => <option key={kind} value={kind}>{REGULARISATION_KIND_LABELS[kind]}</option>)}
        </select>
      </label>}
      {draft.entry_type === 'regularisation' && <label className="text-sm font-medium text-slate-700 sm:col-span-2 lg:col-span-3">Justification *<textarea rows={2} value={draft.justification} onChange={(event) => setDraft({ ...draft, justification: event.target.value })} placeholder="Ex. : facture d’électricité d’octobre reçue en novembre" className="mt-1 w-full" /></label>}
    </div>

    <div className="mt-5 overflow-x-auto rounded-lg border border-slate-200">
      <table className="ui-table text-sm">
        <thead><tr><th className="w-10">#</th><th className="min-w-72">Compte</th><th>Nature du compte</th><th className="min-w-48">Libellé de la ligne</th><th className="text-right">Débit</th><th className="text-right">Crédit</th><th><span className="sr-only">Actions</span></th></tr></thead>
        <tbody>{draft.lines.map((line, index) => {
          const account = byId.get(line.account_id)
          return <tr key={index}>
            <td className="text-slate-400 tabular-nums">{index + 1}</td>
            <td><AccountSelect accounts={accounts} value={line.account_id} onChange={(id) => setLine(index, { account_id: id })} ariaLabel={`Compte de la ligne ${index + 1}`} className="w-full" /></td>
            <td className="whitespace-nowrap">{account ? <span className={`ui-badge ${account.nature === 'debit' ? 'ui-badge-neutral' : 'ui-badge-success'}`}>{NATURE_LABELS[account.nature]}</span> : <span className="text-slate-300">-</span>}</td>
            <td><input value={line.description} onChange={(event) => setLine(index, { description: event.target.value })} placeholder={draft.description || 'Libellé'} aria-label={`Libellé de la ligne ${index + 1}`} className="w-full" /></td>
            <td><input type="number" inputMode="decimal" min={0} step="0.01" value={line.debit || ''} onChange={(event) => setAmount(index, 'debit', event.target.value)} aria-label={`Débit de la ligne ${index + 1}`} className="w-32 text-right tabular-nums" /></td>
            <td><input type="number" inputMode="decimal" min={0} step="0.01" value={line.credit || ''} onChange={(event) => setAmount(index, 'credit', event.target.value)} aria-label={`Crédit de la ligne ${index + 1}`} className="w-32 text-right tabular-nums" /></td>
            <td className="whitespace-nowrap">
              {!balanced && <button type="button" onClick={() => balanceOn(index)} title="Équilibrer sur cette ligne" className="mr-1 rounded px-1.5 py-1 text-xs font-semibold text-brand-700 hover:bg-brand-100">=</button>}
              <button type="button" onClick={() => setDraft({ ...draft, lines: draft.lines.filter((_, position) => position !== index) })} disabled={draft.lines.length <= 2} aria-label={`Supprimer la ligne ${index + 1}`} className="rounded p-1 text-slate-400 hover:text-red-600 disabled:opacity-30"><Trash2 className="h-4 w-4" aria-hidden="true" /></button>
            </td>
          </tr>
        })}</tbody>
        <tfoot className="bg-slate-50 font-semibold"><tr>
          <td colSpan={4}><button type="button" onClick={() => setDraft({ ...draft, lines: [...draft.lines, emptyLine()] })} className="inline-flex items-center gap-1.5 text-sm text-brand-700 hover:text-brand-900"><Plus className="h-4 w-4" aria-hidden="true" />Ajouter une ligne</button></td>
          <td className="text-right tabular-nums">{formatAmount(totalDebit)}</td><td className="text-right tabular-nums">{formatAmount(totalCredit)}</td><td />
        </tr></tfoot>
      </table>
    </div>
  </Modal>
}
