import type { Account, AccountType } from '../../types/accounting'
import { ACCOUNT_TYPE_LABELS } from '../../services/ledgerService'

const TYPE_ORDER: AccountType[] = ['asset', 'liability', 'equity', 'revenue', 'expense']

/** Dropdown of the chart of accounts, grouped by type ("101000 - Caisse"). */
export function AccountSelect({ accounts, value, onChange, includeInactive = false, placeholder = 'Choisir un compte…', id, className = '', required, ariaLabel }: {
  accounts: Account[]; value: string; onChange: (id: string) => void; includeInactive?: boolean; placeholder?: string; id?: string; className?: string; required?: boolean; ariaLabel?: string
}) {
  const visible = accounts.filter((account) => includeInactive || account.is_active || account.id === value)
  return <select id={id} value={value} onChange={(event) => onChange(event.target.value)} required={required} aria-label={ariaLabel} className={className}>
    <option value="">{placeholder}</option>
    {TYPE_ORDER.map((type) => {
      const group = visible.filter((account) => account.account_type === type)
      return group.length > 0 && <optgroup key={type} label={ACCOUNT_TYPE_LABELS[type]}>
        {group.map((account) => <option key={account.id} value={account.id}>{account.code} - {account.name}{account.is_active ? '' : ' (inactif)'}</option>)}
      </optgroup>
    })}
  </select>
}
