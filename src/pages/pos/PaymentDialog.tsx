import { useState, type FormEvent } from 'react'
import { Check } from 'lucide-react'
import { Modal } from '../../components/Modal'
import { PAYMENT_METHOD_LABELS, type CartItem, type Payment, type PaymentMethod } from '../../types/pos'

type Totals = { subtotal: number; totalDiscount: number; totalTax: number; totalAmount: number }
const money = (value: number) => `${value.toFixed(2)} HTG`
const METHODS: PaymentMethod[] = ['cash', 'card', 'moncash', 'natcash', 'bank_transfer', 'check']

/** Recap of the sale and payment, confirmed before anything is recorded. */
export function PaymentDialog({ items, totals, customer, saving, failure, onConfirm, onClose }: {
  items: CartItem[]; totals: Totals; customer: string | null; saving: boolean; failure?: string | null
  onConfirm: (payment: Payment) => void; onClose: () => void
}) {
  const [method, setMethod] = useState<PaymentMethod>('cash')
  const [received, setReceived] = useState('')
  const [reference, setReference] = useState('')
  const [error, setError] = useState<string | null>(null)
  const mobile = method === 'moncash' || method === 'natcash'
  const paid = method === 'cash' ? Number((received || String(totals.totalAmount)).replace(',', '.')) : totals.totalAmount
  const change = method === 'cash' ? Math.max(0, Math.round((paid - totals.totalAmount) * 100) / 100) : 0

  const submit = (event: FormEvent) => {
    event.preventDefault()
    if (!Number.isFinite(paid) || paid <= 0) return setError('Le montant reçu doit être positif.')
    if (paid + 0.01 < totals.totalAmount) return setError(`Montant insuffisant : il manque ${money(totals.totalAmount - paid)}.`)
    if (mobile && !reference.trim()) return setError(`Saisissez l’ID de transaction ${PAYMENT_METHOD_LABELS[method]}.`)
    onConfirm({ method, amount: paid, reference: reference.trim() || undefined })
  }

  return <Modal title="Valider la vente" subtitle={customer ? `Client : ${customer}` : 'Vente sans client'} onClose={onClose} locked={saving}
    footer={<><button type="button" onClick={onClose} className="ui-button-secondary">Retour au panier</button><button type="submit" form="payment-form" disabled={saving} className="ui-button-primary"><Check className="h-4 w-4" aria-hidden="true" />{saving ? 'Enregistrement…' : `Valider la vente (${money(totals.totalAmount)})`}</button></>}>
    <form id="payment-form" onSubmit={submit} className="grid gap-5 sm:grid-cols-2">
      {(error || failure) && <p role="alert" className="ui-alert-error mt-0 sm:col-span-2">{error ?? failure}</p>}
      <section className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm">
        <h3 className="font-semibold text-slate-900">Récapitulatif</h3>
        <ul className="mt-2 space-y-1">{items.map((item) => <li key={item.productId} className="flex justify-between gap-3"><span>{item.quantity} × {item.name}</span><span className="tabular-nums">{money(item.lineTotal)}</span></li>)}</ul>
        <dl className="mt-3 space-y-0.5 border-t border-slate-200 pt-2">
          <div className="flex justify-between"><dt>Sous-total</dt><dd className="tabular-nums">{money(totals.subtotal)}</dd></div>
          <div className="flex justify-between"><dt>Remises</dt><dd className="tabular-nums">− {money(totals.totalDiscount)}</dd></div>
          <div className="flex justify-between"><dt>Taxes</dt><dd className="tabular-nums">{money(totals.totalTax)}</dd></div>
          <div className="flex justify-between text-base font-bold"><dt>Total à payer</dt><dd className="tabular-nums">{money(totals.totalAmount)}</dd></div>
        </dl>
      </section>
      <section className="space-y-3">
        <label className="block text-sm font-medium text-slate-700">Mode de paiement
          <select value={method} onChange={(event) => { setMethod(event.target.value as PaymentMethod); setError(null) }} className="mt-1 w-full">{METHODS.map((item) => <option key={item} value={item}>{PAYMENT_METHOD_LABELS[item]}</option>)}</select>
        </label>
        {method === 'cash'
          ? <label className="block text-sm font-medium text-slate-700">Montant reçu (HTG)<input autoFocus inputMode="decimal" value={received} placeholder={totals.totalAmount.toFixed(2)} onChange={(event) => setReceived(event.target.value)} className="mt-1 w-full text-right text-lg tabular-nums" /></label>
          : <p className="text-sm text-slate-600">Montant : <strong>{money(totals.totalAmount)}</strong> (égal au total)</p>}
        {method !== 'cash' && <label className="block text-sm font-medium text-slate-700">{mobile ? `ID de transaction ${PAYMENT_METHOD_LABELS[method]} *` : method === 'check' ? 'N° du chèque' : 'Référence (si disponible)'}
          <input value={reference} onChange={(event) => setReference(event.target.value)} className="mt-1 w-full" />
          {mobile && <span className="mt-1 block text-xs font-normal text-slate-500">Recopiez l’ID du SMS de confirmation du client ; un même ID ne sert qu’une fois.</span>}
        </label>}
        {method === 'cash' && <p className={`rounded-lg px-3 py-2 text-sm ${change > 0 ? 'bg-amber-50 text-amber-900' : 'bg-slate-50 text-slate-600'}`}>Monnaie à rendre : <strong className="tabular-nums">{money(change)}</strong></p>}
      </section>
    </form>
  </Modal>
}
