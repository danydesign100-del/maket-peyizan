import { useEffect, useMemo, useState } from 'react'
import { Eye, Pencil, Plus, Power } from 'lucide-react'
import type { Account, AccountBalance, AccountType } from '../../types/accounting'
import { ACCOUNT_TYPE_LABELS, NATURE_LABELS, TERM_LABELS, formatAmount, ledgerService } from '../../services/ledgerService'

/** Chart of accounts: active and inactive accounts, nature, term, parent and current balance. */
export function AccountsTab({ accounts, onCreate, onEdit, onToggleActive, onOpen }: { accounts: Account[]; onCreate: () => void; onEdit: (account: Account) => void; onToggleActive: (account: Account) => void; onOpen: (account: Account) => void }) {
  const [status, setStatus] = useState<'active' | 'inactive' | 'all'>('active')
  const [type, setType] = useState<AccountType | ''>('')
  const [search, setSearch] = useState('')
  const [balances, setBalances] = useState<Map<string, AccountBalance>>(new Map())
  useEffect(() => { void ledgerService.balances(null, null).then(({ data }) => setBalances(new Map((data ?? []).map((row) => [row.account_id, row])))) }, [accounts])

  const byId = useMemo(() => new Map(accounts.map((account) => [account.id, account])), [accounts])
  const needle = search.trim().toLocaleLowerCase('fr')
  const rows = accounts.filter((account) => (status === 'all' || account.is_active === (status === 'active'))
    && (!type || account.account_type === type)
    && (!needle || account.code.includes(needle) || account.name.toLocaleLowerCase('fr').includes(needle)))

  return <section className="ui-card overflow-hidden">
    <div className="flex flex-wrap items-end justify-between gap-3 border-b border-slate-200 px-5 py-4">
      <div className="flex flex-wrap items-end gap-2">
        <label className="text-xs font-medium text-slate-600">Recherche<input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Code ou intitulé" className="mt-1 block w-52" /></label>
        <label className="text-xs font-medium text-slate-600">Type<select value={type} onChange={(event) => setType(event.target.value as AccountType | '')} className="mt-1 block"><option value="">Tous</option>{(Object.keys(ACCOUNT_TYPE_LABELS) as AccountType[]).map((item) => <option key={item} value={item}>{ACCOUNT_TYPE_LABELS[item]}</option>)}</select></label>
        <label className="text-xs font-medium text-slate-600">Statut<select value={status} onChange={(event) => setStatus(event.target.value as typeof status)} className="mt-1 block"><option value="active">Actifs</option><option value="inactive">Inactifs</option><option value="all">Tous</option></select></label>
      </div>
      <button type="button" onClick={onCreate} className="ui-button-primary"><Plus className="h-4 w-4" aria-hidden="true" />Nouveau compte</button>
    </div>
    <div className="overflow-x-auto">
      <table className="ui-table text-sm">
        <thead><tr><th>Code</th><th>Intitulé</th><th>Type</th><th>Nature du compte</th><th>Terme</th><th>Compte parent</th><th className="text-right">Solde (HTG)</th><th>Statut</th><th className="text-right">Actions</th></tr></thead>
        <tbody>
          {rows.length === 0 ? <tr><td colSpan={9} className="ui-empty">Aucun compte ne correspond aux filtres.</td></tr> : rows.map((account) => {
            const parent = account.parent_id ? byId.get(account.parent_id) : null
            const balance = Number(balances.get(account.id)?.balance ?? 0)
            return <tr key={account.id} className={account.is_active ? '' : 'text-slate-400'}>
              <td className="font-mono">{account.code}</td>
              <td className="font-medium">{account.name}</td>
              <td>{ACCOUNT_TYPE_LABELS[account.account_type]}</td>
              <td><span className={`ui-badge ${account.nature === 'debit' ? 'ui-badge-neutral' : 'ui-badge-success'}`}>{NATURE_LABELS[account.nature]}</span></td>
              <td className="whitespace-nowrap">{account.term ? TERM_LABELS[account.term] : '-'}</td>
              <td className="text-slate-600">{parent ? `${parent.code} ${parent.name}` : '-'}</td>
              <td className={`text-right tabular-nums ${balance < 0 ? 'text-red-700' : ''}`}>{balances.size ? formatAmount(balance) : '…'}</td>
              <td>{account.is_active ? <span className="ui-badge ui-badge-success">Actif</span> : <span className="ui-badge ui-badge-neutral">Inactif</span>}</td>
              <td className="whitespace-nowrap text-right">
                <button type="button" onClick={() => onOpen(account)} title="Voir le détail et les mouvements" className="rounded p-1.5 text-slate-500 hover:bg-slate-100 hover:text-brand-700"><Eye className="h-4 w-4" aria-label="Détail" /></button>
                <button type="button" onClick={() => onEdit(account)} title="Modifier" className="rounded p-1.5 text-slate-500 hover:bg-slate-100 hover:text-brand-700"><Pencil className="h-4 w-4" aria-label="Modifier" /></button>
                <button type="button" onClick={() => onToggleActive(account)} title={account.is_active ? 'Désactiver' : 'Réactiver'} className="rounded p-1.5 text-slate-500 hover:bg-slate-100"><Power className="h-4 w-4" aria-label={account.is_active ? 'Désactiver' : 'Réactiver'} /></button>
              </td>
            </tr>
          })}
        </tbody>
      </table>
    </div>
    <p className="border-t border-slate-200 px-5 py-2.5 text-xs text-slate-500">{rows.length} compte(s). Un compte inactif reste visible dans l’historique mais ne peut plus recevoir de nouvelles écritures.</p>
  </section>
}
