import { useEffect, useState, type FormEvent } from 'react'
import { Eye, HandCoins, Pencil, Plus, Power, Save, Users } from 'lucide-react'
import { Modal } from '../../components/Modal'
import { TableRowsSkeleton } from '../../components/Skeleton'
import type { Account, AccountBalance, JournalEntryDraft, Partner } from '../../types/accounting'
import { formatAmount, ledgerService } from '../../services/ledgerService'
import { EntryFormDialog } from './EntryForm'
import { emptyLine, newDraft } from './drafts'

function PartnerDialog({ partner, onClose, onSaved }: { partner: Partner | null; onClose: () => void; onSaved: (message: string) => void }) {
  const [name, setName] = useState(partner?.name ?? '')
  const [share, setShare] = useState(partner?.share_percent === null || partner?.share_percent === undefined ? '' : String(partner.share_percent))
  const [notes, setNotes] = useState(partner?.notes ?? '')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const submit = async (event: FormEvent) => {
    event.preventDefault()
    const percent = share.trim() === '' ? null : Number(share.replace(',', '.'))
    if (percent !== null && (!Number.isFinite(percent) || percent < 0 || percent > 100)) return setError('La part doit être comprise entre 0 et 100 %.')
    setSaving(true); setError(null)
    const { data, error: saveError } = await ledgerService.savePartner({ id: partner?.id, name, share_percent: percent, notes })
    setSaving(false)
    if (saveError || !data) return setError(saveError?.message ?? 'Enregistrement impossible')
    onSaved(partner ? `Associé « ${data.name} » modifié.` : `Associé « ${data.name} » ajouté, avec son compte de capital et son compte courant.`)
  }
  return <Modal size="sm" title={partner ? `Modifier ${partner.name}` : 'Nouvel associé'} subtitle="Associés" onClose={onClose} locked={saving}
    footer={<><button type="button" onClick={onClose} className="ui-button-secondary">Annuler</button><button type="submit" form="partner-form" disabled={saving} className="ui-button-primary"><Save className="h-4 w-4" aria-hidden="true" />{saving ? 'Enregistrement…' : 'Enregistrer'}</button></>}>
    <form id="partner-form" onSubmit={submit} className="space-y-4">
      {error && <p role="alert" className="ui-alert-error mt-0">{error}</p>}
      <label className="block text-sm font-medium text-slate-700">Nom de l’associé *<input required value={name} onChange={(event) => setName(event.target.value)} className="mt-1 w-full" /></label>
      <label className="block text-sm font-medium text-slate-700">Part dans les bénéfices et pertes (%)<input inputMode="decimal" value={share} onChange={(event) => setShare(event.target.value)} placeholder="Ex. : 50 - laisser vide si le résultat n’est pas réparti" className="mt-1 w-full" /></label>
      <label className="block text-sm font-medium text-slate-700">Notes<textarea rows={2} value={notes} onChange={(event) => setNotes(event.target.value)} className="mt-1 w-full" /></label>
      {!partner && <p className="rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-600">Deux comptes de capitaux propres sont créés : <strong>Capital</strong> (3011xx) pour les apports et augmentations de capital, <strong>Compte courant</strong> (3021xx) pour les apports complémentaires et les retraits.</p>}
    </form>
  </Modal>
}

/** Partners: shares, their two equity accounts and current balances. */
export function PartnersTab({ accounts, onOpenAccount, onNotice, onAccountsChanged }: { accounts: Account[]; onOpenAccount: (accountId: string) => void; onNotice: (message: string) => void; onAccountsChanged: () => void }) {
  const [partners, setPartners] = useState<Partner[] | null>(null)
  const [balances, setBalances] = useState<Map<string, AccountBalance>>(new Map())
  const [error, setError] = useState<string | null>(null)
  const [editing, setEditing] = useState<Partner | null | undefined>(undefined)
  const [entry, setEntry] = useState<JournalEntryDraft | null>(null)
  const [refresh, setRefresh] = useState(0)
  const byId = new Map(accounts.map((account) => [account.id, account]))

  useEffect(() => {
    setPartners(null)
    void Promise.all([ledgerService.listPartners(), ledgerService.balances(null, null)]).then(([list, totals]) => {
      if (list.error) return setError(list.error.message)
      setPartners(list.data ?? [])
      setBalances(new Map((totals.data ?? []).map((row) => [row.account_id, row])))
    })
  }, [refresh])

  // New partners create accounts: the chart of accounts is reloaded too.
  const reload = (message: string) => { onNotice(message); setEditing(undefined); setEntry(null); onAccountsChanged(); setRefresh((value) => value + 1) }
  const toggle = async (partner: Partner) => {
    const { error: toggleError } = await ledgerService.setPartnerActive(partner.id, !partner.is_active)
    if (toggleError) return setError(toggleError.message)
    reload(`Associé « ${partner.name} » ${partner.is_active ? 'désactivé' : 'réactivé'}.`)
  }
  // Opening capital: an « à-nouveau » entry crediting the partner's capital account.
  const openingEntry = (partner: Partner) => setEntry({ ...newDraft('', 'opening'), description: `Capital d’ouverture - ${partner.name}`, lines: [emptyLine(), { ...emptyLine(partner.capital_account_id) }] })
  const totalShare = (partners ?? []).filter((partner) => partner.is_active).reduce((sum, partner) => sum + Number(partner.share_percent ?? 0), 0)
  const balance = (accountId: string) => Number(balances.get(accountId)?.balance ?? 0)

  return <section className="ui-card overflow-hidden">
    <div className="flex flex-wrap items-end justify-between gap-3 border-b border-slate-200 px-5 py-4">
      <div><h3 className="flex items-center gap-2 text-base font-bold text-slate-950"><Users className="h-5 w-5 text-brand-700" aria-hidden="true" />Associés</h3>
        <p className="mt-0.5 text-sm text-slate-600">Parts attribuées : <strong className={totalShare === 100 ? 'text-emerald-700' : 'text-amber-700'}>{totalShare.toLocaleString('fr-HT')} %</strong>{totalShare < 100 && partners?.length ? ' - le reste du résultat n’est pas réparti' : ''}</p></div>
      <button type="button" onClick={() => setEditing(null)} className="ui-button-primary"><Plus className="h-4 w-4" aria-hidden="true" />Nouvel associé</button>
    </div>
    {error && <p role="alert" className="ui-alert-error mx-5">{error}</p>}
    <div className="overflow-x-auto">
      <table className="ui-table text-sm">
        <thead><tr><th>Associé</th><th className="text-right">Part</th><th>Compte de capital</th><th>Compte courant</th><th className="text-right">Solde total (HTG)</th><th>Statut</th><th className="text-right">Actions</th></tr></thead>
        <tbody>
          {partners === null ? <TableRowsSkeleton rows={3} cols={7} /> : partners.length === 0 ? <tr><td colSpan={7} className="ui-empty">Aucun associé. Ajoutez les associés pour produire l’état de l’avoir des associés.</td></tr>
            : partners.map((partner) => {
              const capital = byId.get(partner.capital_account_id), current = byId.get(partner.current_account_id)
              return <tr key={partner.id} className={partner.is_active ? '' : 'text-slate-400'}>
                <td className="font-medium">{partner.name}{partner.notes && <span className="block text-xs font-normal text-slate-500">{partner.notes}</span>}</td>
                <td className="text-right tabular-nums">{partner.share_percent === null ? '-' : `${Number(partner.share_percent).toLocaleString('fr-HT')} %`}</td>
                <td><button type="button" onClick={() => onOpenAccount(partner.capital_account_id)} className="hover:text-brand-700 hover:underline"><span className="font-mono text-xs">{capital?.code}</span> {formatAmount(balance(partner.capital_account_id))}</button></td>
                <td><button type="button" onClick={() => onOpenAccount(partner.current_account_id)} className="hover:text-brand-700 hover:underline"><span className="font-mono text-xs">{current?.code}</span> {formatAmount(balance(partner.current_account_id))}</button></td>
                <td className="text-right font-semibold tabular-nums">{formatAmount(balance(partner.capital_account_id) + balance(partner.current_account_id))}</td>
                <td>{partner.is_active ? <span className="ui-badge ui-badge-success">Actif</span> : <span className="ui-badge ui-badge-neutral">Inactif</span>}</td>
                <td className="whitespace-nowrap text-right">
                  <button type="button" onClick={() => openingEntry(partner)} title="Saisir le capital d’ouverture (écriture d’à-nouveau)" className="rounded p-1.5 text-slate-500 hover:bg-slate-100 hover:text-brand-700"><HandCoins className="h-4 w-4" aria-label="Capital d’ouverture" /></button>
                  <button type="button" onClick={() => onOpenAccount(partner.capital_account_id)} title="Voir le compte de capital" className="rounded p-1.5 text-slate-500 hover:bg-slate-100 hover:text-brand-700"><Eye className="h-4 w-4" aria-label="Voir le compte" /></button>
                  <button type="button" onClick={() => setEditing(partner)} title="Modifier" className="rounded p-1.5 text-slate-500 hover:bg-slate-100 hover:text-brand-700"><Pencil className="h-4 w-4" aria-label="Modifier" /></button>
                  <button type="button" onClick={() => void toggle(partner)} title={partner.is_active ? 'Désactiver' : 'Réactiver'} className="rounded p-1.5 text-slate-500 hover:bg-slate-100"><Power className="h-4 w-4" aria-label={partner.is_active ? 'Désactiver' : 'Réactiver'} /></button>
                </td>
              </tr>
            })}
        </tbody>
      </table>
    </div>
    <p className="border-t border-slate-200 px-5 py-2.5 text-xs text-slate-500">Crédit au compte de capital = augmentation de capital · crédit au compte courant = apport supplémentaire · débit au compte courant = retrait / distribution. Un associé inactif ne reçoit plus de part du résultat.</p>
    {editing !== undefined && <PartnerDialog partner={editing} onClose={() => setEditing(undefined)} onSaved={reload} />}
    {entry && <EntryFormDialog initial={entry} accounts={accounts} onClose={() => setEntry(null)} onSaved={reload} />}
  </section>
}
