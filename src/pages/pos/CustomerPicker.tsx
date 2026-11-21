import { useEffect, useState } from 'react'
import { Search, UserPlus, X } from 'lucide-react'
import { QuickCreateDialog } from '../../components/QuickCreateDialog'
import { errorText } from '../../lib/errors'
import { customerService } from '../../services/customerService'
import type { Customer } from '../../types/catalog'

/** Customer of the sale: search while typing, or « + Nouveau client » created and selected without leaving the sale. */
export function CustomerPicker({ customer, onChange, required }: { customer: Customer | null; onChange: (customer: Customer | null) => void; required: boolean }) {
  const [query, setQuery] = useState('')
  const [matches, setMatches] = useState<Customer[] | null>(null)
  const [creating, setCreating] = useState(false)
  useEffect(() => {
    const term = query.trim()
    if (term.length < 2) { setMatches(null); return }
    const timer = window.setTimeout(() => { void customerService.searchCustomers(term).then(({ data }) => setMatches((data ?? []) as Customer[])) }, 250)
    return () => window.clearTimeout(timer)
  }, [query])

  const create = async (values: Record<string, string>) => {
    const { data, error } = await customerService.createCustomer({ full_name: values.full_name, phone: values.phone || null, email: values.email || null, customer_type: values.customer_type as Customer['customer_type'], address: null, company_name: null, tax_id: null, notes: null })
    if (error || !data) return errorText(error, 'Création du client impossible')
    onChange(data as Customer); setCreating(false); setQuery(''); setMatches(null)
    return null
  }

  return <div className="ui-card mt-4 p-3">
    {customer
      ? <div className="flex items-center justify-between gap-3"><span className="text-sm"><strong>{customer.full_name}</strong>{customer.phone && <span className="ml-2 text-slate-500">{customer.phone}</span>}<span className="ml-2 text-slate-500">· client de la vente</span></span><button type="button" onClick={() => onChange(null)} className="inline-flex items-center gap-1.5 text-sm text-red-700"><X className="h-4 w-4" aria-hidden="true" />Retirer</button></div>
      : <div className="flex gap-2">
        <label className="relative min-w-0 flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" aria-hidden="true" />
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={required ? 'Rechercher le client (obligatoire)' : 'Rechercher un client (optionnel)'} aria-label="Rechercher un client" className="w-full pl-9" />
        </label>
        <button type="button" onClick={() => setCreating(true)} className="ui-button-secondary px-3"><UserPlus className="h-4 w-4" aria-hidden="true" />Nouveau client</button>
      </div>}
    {!customer && matches && <div className="mt-2 divide-y rounded border">
      {matches.length === 0 ? <p className="px-3 py-2 text-sm text-slate-500">Aucun client trouvé : créez-le avec « Nouveau client ».</p>
        : matches.map((item) => <button key={item.id} type="button" onClick={() => { onChange(item); setMatches(null); setQuery('') }} className="block w-full px-3 py-2 text-left text-sm hover:bg-slate-50"><strong>{item.full_name}</strong>{item.phone && <span className="ml-2 text-slate-500">{item.phone}</span>}</button>)}
    </div>}
    {creating && <QuickCreateDialog title="Nouveau client" onClose={() => setCreating(false)} onSubmit={create} initial={{ full_name: /\d/.test(query) ? '' : query.trim(), phone: /\d/.test(query) ? query.trim() : '' }}
      fields={[{ key: 'full_name', label: 'Nom complet', required: true }, { key: 'phone', label: 'Téléphone', type: 'tel' }, { key: 'email', label: 'E-mail', type: 'email' }, { key: 'customer_type', label: 'Type', type: 'select', options: [{ value: 'individual', label: 'Particulier' }, { value: 'business', label: 'Entreprise' }] }]} />}
  </div>
}
