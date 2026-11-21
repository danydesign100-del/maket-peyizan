import { useState, type FormEvent } from 'react'
import { AlertTriangle, Check, X } from 'lucide-react'
import { isLocalDbConfigured } from '../../lib/supabase'
import { formatAmount } from '../../services/ledgerService'
import { stockService } from '../../services/stockService'
import type { SupplierOption } from '../../types/catalog'
import type { StockMovementInput, StockSettlement } from '../../types/stock'

type ProductRow = { id: string; name: string; unit: string; stock_quantity: number; average_cost?: number | null }

export const SETTLEMENTS: Record<StockSettlement, { label: string; account: string }> = {
  supplier: { label: 'À crédit - à payer au fournisseur', account: '201000 Fournisseurs' },
  bank: { label: 'Payé par banque', account: '102000 Banque' },
  opening: { label: 'Stock d’ouverture (déjà en magasin)', account: '304000 Report à nouveau' },
}

/** The entry posted for a movement, as the database will post it (Supabase only). */
function entryPreview(type: StockMovementInput['movement_type'], quantity: number, price: number | null, average: number, settlement: StockSettlement) {
  const counter = SETTLEMENTS[settlement].account
  const amount = Math.abs(quantity) * (type === 'entry' ? price ?? 0 : type === 'supplier_return' && price ? price : average)
  if (!amount) return null
  const [debit, credit] = type === 'entry' ? ['120000 Stock', counter]
    : type === 'supplier_return' ? [counter, '120000 Stock']
    : type === 'exit' || (type === 'adjustment' && quantity < 0) ? ['501100 Écarts d’inventaire', '120000 Stock']
    : ['120000 Stock', '501100 Écarts d’inventaire']
  return { amount, debit, credit, atAverage: type !== 'entry' && !(type === 'supplier_return' && price) }
}

/** Entry, exit, adjustment or return; purchases and returns say how they are settled. */
export function StockMovementForm({ products, suppliers, onClose, onSaved }: { products: ProductRow[]; suppliers: SupplierOption[]; onClose: () => void; onSaved: (message: string) => void }) {
  const [form, setForm] = useState<StockMovementInput>({ product_id: '', movement_type: 'entry', quantity: 1, reason: '', supplier_id: null, purchase_price: null, settlement: 'supplier' })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const set = <K extends keyof StockMovementInput>(key: K, value: StockMovementInput[K]) => setForm((current) => ({ ...current, [key]: value }))
  const product = products.find((item) => item.id === form.product_id)
  const purchase = form.movement_type === 'entry' || form.movement_type === 'supplier_return'
  const settlement = (form.settlement ?? 'supplier') as StockSettlement
  const preview = !isLocalDbConfigured && product ? entryPreview(form.movement_type, form.quantity, form.purchase_price ?? null, Number(product.average_cost ?? 0), settlement) : null

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if (!form.reason.trim()) return setError('Le motif est obligatoire.')
    setSaving(true); setError(null)
    const { error: requestError } = await stockService.createMovement({ ...form, settlement: purchase ? settlement : null })
    setSaving(false)
    if (requestError) return setError(requestError.message)
    onSaved(preview ? `Mouvement enregistré et comptabilisé (${formatAmount(preview.amount)} HTG : D ${preview.debit} / C ${preview.credit}).` : 'Mouvement enregistré et stock mis à jour.')
  }

  const field = 'block text-sm font-medium text-slate-700'
  return <form onSubmit={submit} className="mt-6 grid gap-4 rounded-xl bg-white p-5 shadow-sm ring-1 ring-slate-200 md:grid-cols-2">
    <h2 className="font-semibold md:col-span-2">Entrée, sortie ou ajustement</h2>
    {error && <p role="alert" className="ui-alert-error mt-0 md:col-span-2">{error}</p>}
    <label className={field}>Produit *<select required value={form.product_id} onChange={(event) => set('product_id', event.target.value)} className="mt-1 w-full"><option value="">Choisir…</option>{products.map((item) => <option key={item.id} value={item.id}>{item.name} ({item.stock_quantity} {item.unit})</option>)}</select></label>
    <label className={field}>Type *<select value={form.movement_type} onChange={(event) => { const type = event.target.value as StockMovementInput['movement_type']; setForm((current) => ({ ...current, movement_type: type, settlement: type === 'supplier_return' && current.settlement === 'opening' ? 'supplier' : current.settlement })) }} className="mt-1 w-full">
      <option value="entry">Entrée (achat, livraison)</option><option value="exit">Sortie (casse, perte, consommation)</option><option value="adjustment">Ajustement d’inventaire (+/-)</option><option value="supplier_return">Retour fournisseur</option><option value="customer_return">Retour client (hors vente annulée)</option>
    </select></label>
    <label className={field}>Quantité *<input required type="number" step="0.001" value={form.quantity} onChange={(event) => set('quantity', Number(event.target.value))} className="mt-1 w-full" />{form.movement_type === 'adjustment' && <span className="mt-1 block text-xs font-normal text-slate-500">Négatif pour retirer du stock (ex. : -2).</span>}</label>
    <label className={field}>Motif *<input required value={form.reason} onChange={(event) => set('reason', event.target.value)} placeholder={form.movement_type === 'entry' ? 'Ex. : livraison, facture n°…' : 'Ex. : sacs déchirés, inventaire du mois'} className="mt-1 w-full" /></label>
    {purchase && <>
      <label className={field}>Fournisseur<select value={form.supplier_id ?? ''} onChange={(event) => set('supplier_id', event.target.value || null)} className="mt-1 w-full"><option value="">Aucun</option>{suppliers.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
      <label className={field}>{form.movement_type === 'entry' ? 'Prix d’achat unitaire (HTG)' : 'Prix unitaire facturé (HTG)'}<input type="number" min="0" step="0.01" value={form.purchase_price ?? ''} onChange={(event) => set('purchase_price', event.target.value === '' ? null : Number(event.target.value))} className="mt-1 w-full" />
        {form.movement_type === 'supplier_return' && <span className="mt-1 block text-xs font-normal text-slate-500">Vide : valorisé au coût moyen.</span>}</label>
      {!isLocalDbConfigured && <label className={`${field} md:col-span-2`}>{form.movement_type === 'entry' ? 'Règlement' : 'Remboursement'}
        <select value={settlement} onChange={(event) => set('settlement', event.target.value as StockSettlement)} className="mt-1 w-full">
          {(Object.keys(SETTLEMENTS) as StockSettlement[]).filter((key) => form.movement_type === 'entry' || key !== 'opening').map((key) => <option key={key} value={key}>{form.movement_type === 'supplier_return' && key === 'supplier' ? 'Avoir - déduit de la dette fournisseur' : SETTLEMENTS[key].label} ({SETTLEMENTS[key].account})</option>)}
        </select>
        {form.movement_type === 'entry' && settlement === 'supplier' && <span className="mt-1 block text-xs font-normal text-slate-500">Payé en espèces : enregistrez-le ici à crédit, puis « Paiement fournisseur » dans Mouvements de caisse, pour que la caisse reste juste.</span>}
      </label>}
    </>}
    {!isLocalDbConfigured && form.movement_type === 'entry' && !form.purchase_price && form.product_id && <p className="flex items-start gap-2 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900 md:col-span-2"><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />Sans prix d’achat, l’entrée est comptée à coût nul : elle n’est pas comptabilisée et fait baisser le coût moyen.</p>}
    {preview && <p className="rounded-lg bg-slate-50 px-3 py-2 text-sm text-slate-700 md:col-span-2">Écriture automatique : <strong>{formatAmount(preview.amount)} HTG</strong>{preview.atAverage ? ' au coût moyen' : ''} - débit {preview.debit}, crédit {preview.credit}.</p>}
    <div className="flex gap-3 md:col-span-2">
      <button type="submit" disabled={saving} className="ui-button-primary"><Check className="h-4 w-4" aria-hidden="true" />{saving ? 'Enregistrement…' : 'Valider'}</button>
      <button type="button" onClick={onClose} className="ui-button-secondary"><X className="h-4 w-4" aria-hidden="true" />Annuler</button>
    </div>
  </form>
}
