import { useEffect, useState, type FormEvent } from 'react'
import { Save, Search, Trash2 } from 'lucide-react'
import { Modal } from '../../components/Modal'
import { errorText } from '../../lib/errors'
import { productService } from '../../services/productService'
import { proformaService, type Proforma } from '../../services/proformaService'
import type { Customer, Product } from '../../types/catalog'
import { CustomerPicker } from '../pos/CustomerPicker'

type Line = { product_id: string; name: string; unit: string; quantity: number; unit_price: number; catalog: number[]; discount: number }
const money = (value: number) => `${value.toLocaleString('fr-HT', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} HTG`

/** Create or edit a proforma; the server recomputes totals and checks prices against the user's rights. */
export function ProformaEditor({ proforma, canPrice, onClose, onSaved }: { proforma: Proforma | null; canPrice: boolean; onClose: () => void; onSaved: (message: string) => void }) {
  const [customer, setCustomer] = useState<Customer | null>(proforma?.customer && proforma.customer_id ? { id: proforma.customer_id, ...proforma.customer } as unknown as Customer : null)
  const [validUntil, setValidUntil] = useState(proforma?.valid_until ?? new Date(Date.now() + 15 * 86400e3).toLocaleDateString('en-CA'))
  const [notes, setNotes] = useState(proforma?.notes ?? '')
  const [note, setNote] = useState('')
  const [lines, setLines] = useState<Line[]>(() => (proforma?.items ?? []).map((item) => ({ product_id: item.product_id, name: item.description, unit: '', quantity: Number(item.quantity), unit_price: Number(item.unit_price), catalog: [Number(item.unit_price)], discount: Number(item.discount_amount) })))
  const [query, setQuery] = useState('')
  const [matches, setMatches] = useState<Product[]>([])
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    const term = query.trim()
    if (term.length < 2) { setMatches([]); return }
    const timer = window.setTimeout(() => { void productService.getProducts(0, { search: term, status: 'active' }).then(({ data }) => setMatches((data ?? []) as Product[])) }, 250)
    return () => window.clearTimeout(timer)
  }, [query])

  const add = (product: Product) => {
    const price = Number(product.proforma_price) || Number(product.selling_price)
    setLines((current) => current.some((line) => line.product_id === product.id)
      ? current.map((line) => line.product_id === product.id ? { ...line, quantity: line.quantity + 1 } : line)
      : [...current, { product_id: product.id, name: product.name, unit: product.unit, quantity: 1, unit_price: price, catalog: [Number(product.proforma_price), Number(product.selling_price)], discount: 0 }])
    setQuery(''); setMatches([])
  }
  const update = (index: number, patch: Partial<Line>) => setLines((current) => current.map((line, i) => i === index ? { ...line, ...patch } : line))
  const lineTotal = (line: Line) => Math.max(0, line.quantity * line.unit_price - line.discount)
  const subtotal = lines.reduce((sum, line) => sum + line.quantity * line.unit_price, 0)
  const discount = lines.reduce((sum, line) => sum + line.discount, 0)

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if (!lines.length) return setError('Ajoutez au moins un produit.')
    if (lines.some((line) => !(line.quantity > 0) || line.discount < 0 || line.discount > line.quantity * line.unit_price)) return setError('Vérifiez les quantités et les remises.')
    setSaving(true); setError(null)
    try {
      const items = lines.map((line) => ({ product_id: line.product_id, quantity: line.quantity, unit_price: line.unit_price, discount_amount: line.discount }))
      if (proforma) await proformaService.save(proforma.id, { customer_id: customer?.id ?? null, valid_until: validUntil || null, notes, items, note })
      else await proformaService.create({ customer_id: customer?.id ?? null, valid_until: validUntil || null, notes, items: lines.map((line) => ({ product_id: line.product_id, description: line.name, quantity: line.quantity, unit_price: line.unit_price, discount_amount: line.discount })) })
      onSaved(proforma ? `Proforma ${proforma.proforma_number} modifiée (version ${(proforma.revision ?? 1) + 1}).` : 'Proforma créée.')
    } catch (cause) { setError(errorText(cause, 'Enregistrement impossible')) } finally { setSaving(false) }
  }

  return <Modal size="xl" title={proforma ? `Modifier la proforma ${proforma.proforma_number}` : 'Nouvelle proforma'} subtitle="Une proforma ne déduit jamais le stock : seule la vente le fait." onClose={onClose} locked={saving}
    footer={<><span className="mr-auto text-sm text-slate-600">Total : <strong className="text-base text-slate-950">{money(subtotal - discount)}</strong></span><button type="button" onClick={onClose} className="ui-button-secondary">Annuler</button><button type="submit" form="proforma-form" disabled={saving} className="ui-button-primary"><Save className="h-4 w-4" aria-hidden="true" />{saving ? 'Enregistrement…' : 'Enregistrer'}</button></>}>
    <form id="proforma-form" onSubmit={submit} className="space-y-4">
      {error && <p role="alert" className="ui-alert-error mt-0">{error}</p>}
      <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_12rem]">
        <div className="-mt-4"><CustomerPicker customer={customer} onChange={setCustomer} required={false} /></div>
        <label className="block text-sm font-medium text-slate-700">Valable jusqu’au<input type="date" value={validUntil} onChange={(event) => setValidUntil(event.target.value)} className="mt-1 w-full" /></label>
      </div>
      <div className="relative">
        <label className="relative block"><Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" aria-hidden="true" />
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Ajouter un produit : nom, référence ou marque" aria-label="Ajouter un produit" className="w-full pl-9" /></label>
        {matches.length > 0 && <ul className="absolute z-10 mt-1 max-h-64 w-full overflow-y-auto rounded-lg border border-slate-200 bg-white shadow-lg">{matches.map((product) => <li key={product.id}><button type="button" onClick={() => add(product)} className="flex w-full justify-between gap-3 px-3 py-2 text-left text-sm hover:bg-slate-50"><span>{product.name}<span className="ml-2 text-xs text-slate-500">{product.stock_quantity} {product.unit} en stock</span></span><span className="font-semibold">{money(Number(product.proforma_price) || Number(product.selling_price))}</span></button></li>)}</ul>}
      </div>
      <div className="overflow-x-auto rounded-lg border border-slate-200">
        <table className="ui-table text-sm">
          <thead><tr><th>Produit</th><th className="text-right">Quantité</th><th className="text-right">Prix unitaire</th><th className="text-right">Remise</th><th className="text-right">Total</th><th><span className="sr-only">Retirer</span></th></tr></thead>
          <tbody>{lines.length === 0 ? <tr><td colSpan={6} className="ui-empty py-6">Cherchez un produit ci-dessus pour l’ajouter.</td></tr>
            : lines.map((line, index) => <tr key={line.product_id}>
              <td className="font-medium">{line.name}</td>
              <td className="text-right"><input type="number" min="0.001" step="any" value={line.quantity} onChange={(event) => update(index, { quantity: Number(event.target.value) })} aria-label={`Quantité de ${line.name}`} className="w-20 rounded border p-1 text-right" /></td>
              <td className="text-right">{canPrice ? <input type="number" min="0" step="0.01" value={line.unit_price} onChange={(event) => update(index, { unit_price: Number(event.target.value) })} aria-label={`Prix de ${line.name}`} className="w-28 rounded border p-1 text-right" /> : <span className="tabular-nums">{money(line.unit_price)}</span>}</td>
              <td className="text-right"><input type="number" min="0" step="0.01" value={line.discount || ''} placeholder="0" onChange={(event) => update(index, { discount: Number(event.target.value) })} aria-label={`Remise sur ${line.name}`} className="w-24 rounded border p-1 text-right" /></td>
              <td className="text-right font-semibold tabular-nums">{money(lineTotal(line))}</td>
              <td className="text-right"><button type="button" onClick={() => setLines((current) => current.filter((_, i) => i !== index))} aria-label={`Retirer ${line.name}`} className="text-red-600 hover:text-red-800"><Trash2 className="h-4 w-4" aria-hidden="true" /></button></td>
            </tr>)}</tbody>
          {lines.length > 0 && <tfoot className="bg-slate-50 text-sm"><tr><td colSpan={4} className="text-right">Sous-total</td><td className="text-right tabular-nums">{money(subtotal)}</td><td /></tr><tr><td colSpan={4} className="text-right">Remises</td><td className="text-right tabular-nums">− {money(discount)}</td><td /></tr><tr className="font-bold"><td colSpan={4} className="text-right">Total</td><td className="text-right tabular-nums">{money(subtotal - discount)}</td><td /></tr></tfoot>}
        </table>
      </div>
      {!canPrice && <p className="text-xs text-slate-500">Prix du catalogue (prix proforma, sinon prix de vente). Un autre prix ne peut être fixé que par un responsable autorisé.</p>}
      <div className="grid gap-4 md:grid-cols-2">
        <label className="block text-sm font-medium text-slate-700">Notes (imprimées)<textarea rows={2} value={notes} onChange={(event) => setNotes(event.target.value)} className="mt-1 w-full" /></label>
        {proforma && <label className="block text-sm font-medium text-slate-700">Motif de la modification (historique)<textarea rows={2} value={note} onChange={(event) => setNote(event.target.value)} placeholder="Ex. : ajout d’un produit oublié" className="mt-1 w-full" /></label>}
      </div>
    </form>
  </Modal>
}
