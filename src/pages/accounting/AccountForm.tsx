import { useState, type FormEvent } from 'react'
import { Save } from 'lucide-react'
import { Modal } from '../../components/Modal'
import type { Account, AccountType } from '../../types/accounting'
import { ACCOUNT_TYPE_LABELS, NATURE_LABELS, STATEMENT_GROUP_LABELS, TERM_LABELS, defaultNature, defaultStatementGroup, ledgerService, type AccountForm as Form } from '../../services/ledgerService'
import type { StatementGroup } from '../../types/accounting'
import { AccountSelect } from './AccountSelect'

const fromAccount = (account?: Account | null): Form => account
  ? { id: account.id, code: account.code, name: account.name, account_type: account.account_type, nature: account.nature, term: account.term, statement_group: account.statement_group, parent_id: account.parent_id, description: account.description ?? '' }
  : { code: '', name: '', account_type: 'asset', nature: 'debit', term: 'short', statement_group: null, parent_id: null, description: '' }

/** Create or edit an account of the chart. */
export function AccountFormDialog({ account, accounts, onClose, onSaved }: { account?: Account | null; accounts: Account[]; onClose: () => void; onSaved: (account: Account) => void }) {
  const [form, setForm] = useState<Form>(() => fromAccount(account))
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const hasTerm = form.account_type === 'asset' || form.account_type === 'liability'

  const setType = (type: AccountType) => setForm((current) => ({
    ...current, account_type: type,
    // Keep a deliberate choice (e.g. a contra-account); otherwise follow the type.
    nature: current.nature === defaultNature(current.account_type) ? defaultNature(type) : current.nature,
    term: type === 'asset' || type === 'liability' ? current.term ?? 'short' : null,
    statement_group: defaultStatementGroup(type, current.nature === defaultNature(current.account_type) ? defaultNature(type) : current.nature),
  }))

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if (!/^[0-9]{4,6}$/.test(form.code.trim())) return setError('Le code doit contenir de 4 à 6 chiffres.')
    setSaving(true); setError(null)
    const { data, error: saveError } = await ledgerService.saveAccount({ ...form, term: hasTerm ? form.term : null })
    setSaving(false)
    if (saveError || !data) return setError(saveError?.message ?? 'Enregistrement impossible')
    onSaved(data)
  }

  return <Modal title={account ? `Modifier le compte ${account.code}` : 'Nouveau compte'} subtitle="Plan comptable" onClose={onClose} locked={saving}
    footer={<><button type="button" onClick={onClose} className="ui-button-secondary">Annuler</button><button type="submit" form="account-form" disabled={saving} className="ui-button-primary"><Save className="h-4 w-4" aria-hidden="true" />{saving ? 'Enregistrement…' : 'Enregistrer'}</button></>}>
    <form id="account-form" onSubmit={submit} className="grid gap-4 sm:grid-cols-2">
      {error && <p role="alert" className="ui-alert-error mt-0 sm:col-span-2">{error}</p>}
      <label className="text-sm font-medium text-slate-700">Code *<input required inputMode="numeric" value={form.code} onChange={(event) => setForm({ ...form, code: event.target.value })} placeholder="104000" className="mt-1 w-full font-mono" /></label>
      <label className="text-sm font-medium text-slate-700">Intitulé *<input required value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} placeholder="Petite caisse" className="mt-1 w-full" /></label>
      <label className="text-sm font-medium text-slate-700">Type *
        <select value={form.account_type} onChange={(event) => setType(event.target.value as AccountType)} className="mt-1 w-full">
          {(Object.keys(ACCOUNT_TYPE_LABELS) as AccountType[]).map((type) => <option key={type} value={type}>{ACCOUNT_TYPE_LABELS[type]}</option>)}
        </select>
      </label>
      <fieldset className="text-sm font-medium text-slate-700"><legend>Nature du compte *</legend>
        <div className="mt-1 flex gap-2">{(['debit', 'credit'] as const).map((nature) => <label key={nature} className={`flex flex-1 cursor-pointer items-center gap-2 rounded-lg border px-3 py-2 ${form.nature === nature ? 'border-brand-600 bg-brand-100/60 text-brand-900' : 'border-slate-300'}`}>
          <input type="radio" name="nature" checked={form.nature === nature} onChange={() => setForm({ ...form, nature })} className="h-4 w-4" />{NATURE_LABELS[nature]}
        </label>)}</div>
        {form.nature !== defaultNature(form.account_type) && <p className="mt-1 text-xs font-normal text-amber-700">Nature inhabituelle pour ce type (compte correcteur, ex. amortissements).</p>}
      </fieldset>
      {hasTerm && <label className="text-sm font-medium text-slate-700">Terme *
        <select value={form.term ?? 'short'} onChange={(event) => setForm({ ...form, term: event.target.value as 'short' | 'long' })} className="mt-1 w-full">
          <option value="short">{TERM_LABELS.short}</option><option value="long">{TERM_LABELS.long}</option>
        </select>
      </label>}
      {(form.account_type === 'revenue' || form.account_type === 'expense') && <label className="text-sm font-medium text-slate-700">Ligne de l’état des résultats *
        <select value={form.statement_group ?? ''} onChange={(event) => setForm({ ...form, statement_group: event.target.value as StatementGroup })} className="mt-1 w-full">
          {(form.account_type === 'revenue' ? ['sales', 'sales_deduction', 'other_income'] as const : ['cogs', 'expense'] as const).map((group) => <option key={group} value={group}>{STATEMENT_GROUP_LABELS[group]}</option>)}
        </select>
      </label>}
      <label className="text-sm font-medium text-slate-700">Compte parent
        <AccountSelect accounts={accounts.filter((item) => item.id !== form.id)} value={form.parent_id ?? ''} onChange={(id) => setForm({ ...form, parent_id: id || null })} includeInactive placeholder="Aucun" className="mt-1 w-full" />
      </label>
      <label className="text-sm font-medium text-slate-700 sm:col-span-2">Description<textarea rows={2} value={form.description} onChange={(event) => setForm({ ...form, description: event.target.value })} className="mt-1 w-full" /></label>
    </form>
  </Modal>
}
