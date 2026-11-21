import { useState, type FormEvent } from 'react'
import { Save } from 'lucide-react'
import { Modal } from '../../components/Modal'
import type { Account } from '../../types/accounting'
import { CASH_ACCOUNT_LABELS, MOVEMENT_TYPES, cashService, type CashAccountCode, type CashMovementType } from '../../services/cashService'
import { errorText } from '../../lib/errors'
import { AccountSelect } from '../accounting/AccountSelect'

const localNow = () => { const now = new Date(); now.setMinutes(now.getMinutes() - now.getTimezoneOffset()); return now.toISOString().slice(0, 16) }
/** Types offered per cash box: the petty cash is funded from the main cash or the bank. */
const TYPES_BY_CASH: Record<CashAccountCode, CashMovementType[]> = {
  '101000': ['deposit', 'bank_withdrawal', 'other_in', 'expense', 'supplier_payment', 'withdrawal', 'bank_deposit', 'petty_cash_funding'],
  '104000': ['bank_withdrawal', 'other_in', 'expense', 'supplier_payment', 'bank_deposit'],
  // Paid from the bank or the MonCash account (accounting roles): expenses and suppliers only.
  '102000': ['expense', 'supplier_payment'],
  '105000': ['expense', 'supplier_payment'],
}

export type MovementPreset = { cashAccount: CashAccountCode; type: CashMovementType; label?: string; amount?: number }

/** Records a cash movement; the entry is posted by the database. */
export function MovementFormDialog({ preset, accounts, canUsePettyCash, outOnly = false, onClose, onSaved }: { preset: MovementPreset; accounts: Account[]; canUsePettyCash: boolean; outOnly?: boolean; onClose: () => void; onSaved: (message: string) => void }) {
  const [cashAccount, setCashAccount] = useState<CashAccountCode>(preset.cashAccount)
  const [type, setType] = useState<CashMovementType>(preset.type)
  const [amount, setAmount] = useState(preset.amount ? String(preset.amount) : '')
  const [label, setLabel] = useState(preset.label ?? '')
  const [reference, setReference] = useState('')
  const [counter, setCounter] = useState('')
  const [occurredAt, setOccurredAt] = useState(localNow)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const meta = MOVEMENT_TYPES[type]
  const cashId = accounts.find((account) => account.code === cashAccount)?.id
  const counterOptions = accounts.filter((account) => account.id !== cashId && (meta.counter !== 'expense' || (account.account_type === 'expense' && account.statement_group === 'expense')))

  const changeCash = (code: CashAccountCode) => { setCashAccount(code); if (!TYPES_BY_CASH[code].includes(type)) setType(TYPES_BY_CASH[code][0]) }
  const submit = async (event: FormEvent) => {
    event.preventDefault()
    const value = Number(amount.replace(',', '.'))
    if (!Number.isFinite(value) || value <= 0) return setError('Le montant doit être positif.')
    if (meta.counter !== 'fixed' && !counter) return setError(meta.counter === 'expense' ? 'Choisissez le compte de charge.' : 'Choisissez le compte de contrepartie.')
    setSaving(true); setError(null)
    const { data, error: saveError } = await cashService.recordMovement({ type, amount: value, label, reference, counterAccountId: meta.counter === 'fixed' ? null : counter, cashAccount, occurredAt: new Date(occurredAt).toISOString() })
    setSaving(false)
    if (saveError) return setError(errorText(saveError))
    const amountText = `${value.toLocaleString('fr-HT', { minimumFractionDigits: 2 })} HTG`
    onSaved(data?.status === 'pending'
      ? `${meta.label} de ${amountText} enregistré : en attente de validation par un directeur (montant au-delà du seuil autorisé). Rien n’est comptabilisé avant son accord.`
      : `${meta.label} de ${amountText} enregistré${type === 'expense' ? ' (visible aussi dans Dépenses)' : ''}.`)
  }

  return <Modal title={outOnly ? 'Sortie de caisse' : 'Mouvement de caisse'} subtitle={meta.direction === 'in' ? 'Entrée d’argent' : 'Sortie d’argent'} onClose={onClose} locked={saving}
    footer={<><button type="button" onClick={onClose} className="ui-button-secondary">Annuler</button><button type="submit" form="movement-form" disabled={saving} className="ui-button-primary"><Save className="h-4 w-4" aria-hidden="true" />{saving ? 'Enregistrement…' : 'Enregistrer'}</button></>}>
    <form id="movement-form" onSubmit={submit} className="grid gap-4 sm:grid-cols-2">
      {error && <p role="alert" className="ui-alert-error mt-0 sm:col-span-2">{error}</p>}
      <label className="text-sm font-medium text-slate-700">{outOnly ? 'Mode de décaissement' : 'Caisse'}
        <select value={cashAccount} onChange={(event) => changeCash(event.target.value as CashAccountCode)} disabled={!canUsePettyCash} className="mt-1 w-full">
          {(Object.keys(CASH_ACCOUNT_LABELS) as CashAccountCode[]).filter((code) => code === '101000' || canUsePettyCash)
            .map((code) => <option key={code} value={code}>{code} - {CASH_ACCOUNT_LABELS[code]}</option>)}
        </select>
      </label>
      <label className="text-sm font-medium text-slate-700">Type d’opération
        <select value={type} onChange={(event) => { setType(event.target.value as CashMovementType); setCounter('') }} className="mt-1 w-full">
          {(outOnly ? ['out'] as const : ['in', 'out'] as const).map((direction) => <optgroup key={direction} label={direction === 'in' ? 'Entrées' : 'Sorties'}>
            {TYPES_BY_CASH[cashAccount].filter((item) => MOVEMENT_TYPES[item].direction === direction).map((item) => <option key={item} value={item}>{MOVEMENT_TYPES[item].label}</option>)}
          </optgroup>)}
        </select>
        <span className="mt-1 block text-xs font-normal text-slate-500">{meta.hint}</span>
      </label>
      <label className="text-sm font-medium text-slate-700">Montant (HTG) *<input required inputMode="decimal" value={amount} onChange={(event) => setAmount(event.target.value)} className="mt-1 w-full text-right tabular-nums" /></label>
      <label className="text-sm font-medium text-slate-700">Date et heure<input type="datetime-local" value={occurredAt} max={localNow()} onChange={(event) => setOccurredAt(event.target.value)} className="mt-1 w-full" /></label>
      <label className="text-sm font-medium text-slate-700">Libellé / motif *<input required value={label} onChange={(event) => setLabel(event.target.value)} placeholder="Ex. : versement des recettes du jour" className="mt-1 w-full" /></label>
      <label className="text-sm font-medium text-slate-700">Référence<input value={reference} onChange={(event) => setReference(event.target.value)} placeholder="N° de bordereau, de reçu, de pièce" className="mt-1 w-full" /></label>
      {meta.counter !== 'fixed' && <label className="text-sm font-medium text-slate-700 sm:col-span-2">{meta.counter === 'expense' ? 'Compte de charge *' : 'Compte de contrepartie *'}
        <AccountSelect accounts={counterOptions} value={counter} onChange={setCounter} className="mt-1 w-full" />
        {meta.counter === 'choose' && <span className="mt-1 block text-xs font-normal text-slate-500">Ex. : compte courant d’un associé pour un apport ou un retrait. Une entrée n’est jamais un revenu automatiquement.</span>}
      </label>}
    </form>
  </Modal>
}
