import { Minus, Plus, Trash2 } from 'lucide-react'
import type { CartItem } from '../../types/pos'

const money = (value: number) => `${value.toFixed(2)} HTG`

/** Cart lines: quantity with + / −, never above the stock available; discount for authorised roles. */
export function CartTable({ items, canDiscount, onQuantity, onDiscount, onRemove }: {
  items: CartItem[]; canDiscount: boolean
  onQuantity: (index: number, quantity: number) => void
  onDiscount: (index: number, discount: number) => void
  onRemove: (index: number) => void
}) {
  return <div className="ui-card mt-6 overflow-x-auto">
    <table className="ui-table min-w-[40rem]">
      <thead className="bg-slate-50"><tr><th className="p-3">Produit</th><th className="p-3">Quantité</th><th className="p-3 text-right">Prix unit.</th>{canDiscount && <th className="p-3 text-right">Remise</th>}<th className="p-3 text-right">Total</th><th className="p-3"><span className="sr-only">Retirer</span></th></tr></thead>
      <tbody>
        {items.length === 0 ? <tr><td colSpan={canDiscount ? 6 : 5} className="ui-empty">Scannez un code-barres ou cherchez un produit à droite.</td></tr>
          : items.map((item, index) => {
            const limit = item.available ?? Infinity
            return <tr key={item.productId} className="border-t">
              <td className="p-3"><div className="font-medium">{item.name}</div>
                <div className="text-xs text-slate-500">{item.barcode ? `${item.barcode} · ` : ''}{Number.isFinite(limit) ? <span className={item.quantity >= limit ? 'font-semibold text-amber-700' : ''}>{limit} {item.unit} en stock</span> : item.unit}</div></td>
              <td className="p-3">
                <span className="inline-flex items-center rounded-lg border border-slate-300">
                  <button type="button" onClick={() => onQuantity(index, item.quantity - 1)} disabled={item.quantity <= 1} aria-label={`Diminuer ${item.name}`} className="px-2 py-1.5 text-slate-600 hover:bg-slate-100 disabled:opacity-40"><Minus className="h-4 w-4" aria-hidden="true" /></button>
                  <input type="number" min="0.001" step="any" value={item.quantity} onChange={(event) => onQuantity(index, Number(event.target.value))} aria-label={`Quantité de ${item.name}`} className="w-16 border-0 p-1 text-center tabular-nums focus:ring-0" />
                  <button type="button" onClick={() => onQuantity(index, item.quantity + 1)} disabled={item.quantity + 1 > limit} aria-label={`Augmenter ${item.name}`} className="px-2 py-1.5 text-slate-600 hover:bg-slate-100 disabled:opacity-40"><Plus className="h-4 w-4" aria-hidden="true" /></button>
                </span>
              </td>
              <td className="p-3 text-right font-medium tabular-nums text-slate-700">{money(item.unitPrice)}</td>
              {canDiscount && <td className="p-3 text-right"><input type="number" min="0" step="0.01" value={item.discount || ''} placeholder="0" onChange={(event) => onDiscount(index, Number(event.target.value))} aria-label={`Remise sur ${item.name}`} className="w-24 rounded border p-1 text-right tabular-nums" /></td>}
              <td className="p-3 text-right font-semibold tabular-nums">{money(item.lineTotal)}</td>
              <td className="p-3 text-right"><button type="button" onClick={() => onRemove(index)} aria-label={`Retirer ${item.name}`} className="inline-flex items-center text-red-600 hover:text-red-800"><Trash2 className="h-4 w-4" aria-hidden="true" /></button></td>
            </tr>
          })}
      </tbody>
    </table>
  </div>
}
