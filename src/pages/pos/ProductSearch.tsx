import { useEffect, useState } from 'react'
import { PackagePlus, Search } from 'lucide-react'
import { productService } from '../../services/productService'
import type { Product } from '../../types/catalog'

/** Search while typing (name, barcode, brand); out-of-stock products cannot be added. */
export function ProductSearch({ available, onPick, canCreate, missingBarcode, onCreate }: {
  available: (product: Product) => number
  onPick: (product: Product) => void
  canCreate: boolean
  missingBarcode: string | null
  onCreate: (initial: { name?: string; barcode?: string }) => void
}) {
  const [query, setQuery] = useState('')
  const [matches, setMatches] = useState<Product[] | null>(null)
  useEffect(() => {
    const term = query.trim()
    if (term.length < 2) { setMatches(null); return }
    const timer = window.setTimeout(() => {
      void productService.getProducts(0, { search: term, status: 'active' }).then(({ data }) => setMatches((data ?? []) as Product[]))
    }, 250)
    return () => window.clearTimeout(timer)
  }, [query])

  return <aside className="ui-card h-fit p-5 xl:sticky xl:top-6">
    <h2 className="text-base font-bold text-slate-950">Recherche produit</h2>
    <label className="relative mt-3 block">
      <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" aria-hidden="true" />
      <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Nom, référence ou marque" aria-label="Rechercher un produit" className="w-full pl-9" />
    </label>
    {matches && matches.length > 0 && <ul className="mt-3 max-h-[28rem] divide-y divide-slate-100 overflow-y-auto rounded-lg border border-slate-200">
      {matches.map((product) => {
        const stock = available(product)
        const out = stock <= 0
        return <li key={product.id}>
          <button type="button" disabled={out} onClick={() => { onPick(product); setQuery(''); setMatches(null) }} className="flex w-full items-center justify-between gap-3 px-3 py-2.5 text-left hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60 disabled:hover:bg-transparent">
            <span className="min-w-0"><strong className="block truncate text-sm text-slate-900">{product.name}</strong>
              <small className={`text-xs ${out ? 'font-semibold text-red-700' : stock <= Number(product.minimum_stock) ? 'text-amber-700' : 'text-slate-500'}`}>{out ? 'Rupture de stock' : `${stock} ${product.unit} disponible(s)`}</small></span>
            <strong className="shrink-0 text-sm text-brand-700">{Number(product.selling_price).toFixed(2)} HTG</strong>
          </button>
        </li>
      })}
    </ul>}
    {matches && matches.length === 0 && <p className="mt-3 text-sm text-slate-500">Aucun produit correspondant.</p>}
    {canCreate && <div className="mt-4 border-t border-slate-200 pt-4">
      {missingBarcode && <p className="mb-2 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900">Code-barres <strong>{missingBarcode}</strong> inconnu.</p>}
      <button type="button" onClick={() => onCreate(missingBarcode ? { barcode: missingBarcode } : matches?.length === 0 ? { name: query.trim() } : {})} className="ui-button-secondary w-full"><PackagePlus className="h-4 w-4" aria-hidden="true" />{missingBarcode ? 'Créer le produit avec ce code' : 'Nouveau produit'}</button>
    </div>}
  </aside>
}
