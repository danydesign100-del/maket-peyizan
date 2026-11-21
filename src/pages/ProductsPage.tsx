import { Ban, Eye, EyeOff, FileSpreadsheet, Pencil, Plus, RotateCcw, Ruler } from 'lucide-react'
import { ImportDialog } from '../components/ImportDialog'
import { productImporter } from '../services/importers'
import { TableRowsSkeleton, TableSkeleton } from '../components/Skeleton'
import { useEffect, useState } from 'react'
import { CatalogListDialog } from '../components/CatalogListDialog'
import { ProductFormDialog } from './products/ProductFormDialog'
import { categoryService } from '../services/categoryService'
import { productService, type ProductFilters } from '../services/productService'
import type { Category, Product } from '../types/catalog'
import { useAuth } from '../contexts/AuthContext'

export function ProductsPage() {
  const [importing, setImporting] = useState(false)

  const { can } = useAuth()
  const canWrite = can('catalog.manage')
  
  const [rows, setRows] = useState<Product[]>([])
  const [categories, setCategories] = useState<Category[]>([])
  const [, setCount] = useState(0)
  const [page, setPage] = useState(0)
  const [filters, setFilters] = useState<ProductFilters>({ status: 'active', stock: 'all' })
  const [showInactive, setShowInactive] = useState(false)
  const [inactiveProducts, setInactiveProducts] = useState<Product[]>([])
  const [inactiveLoading, setInactiveLoading] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [editingProduct, setEditingProduct] = useState<Product | null>(null)
  const [managingUnits, setManagingUnits] = useState(false)
  const [open, setOpen] = useState(false)

  const load = async () => {
    setLoading(true)
    const { data, error: requestError, count: total } = await productService.getProducts(page, filters)
    setLoading(false)
    if (requestError) {
      setError(requestError.message)
    } else {
      setRows(data as unknown as Product[])
      setCount(total ?? 0)
      setError(null)
    }
  }
  
  useEffect(() => { void load() }, [page, filters])
  
  useEffect(() => {
    void categoryService.getCategories().then(({ data, error: categoryError }) => categoryError ? setError(categoryError.message) : setCategories(data ?? []))
  }, [])
  
  const edit = (product: Product) => { setEditingProduct(product); setOpen(true) }

  const deactivate = async (product: Product) => {
    if (!confirm(`Désactiver « ${product.name} » ? Son historique sera conservé.`)) return
    const { error: requestError } = await productService.deactivateProduct(product.id)
    if (requestError) {
      setError(requestError.message)
    } else {
      setNotice('Produit désactivé.')
      void load()
    }
  }
  
  const activate = async (product: Product) => {
    if (!confirm(`Réactiver « ${product.name} » ?`)) return
    const { error: requestError } = await productService.activateProduct(product.id)
    if (requestError) {
      setError(requestError.message)
    } else {
      setNotice('Produit réactivé.')
      void load()
    }
  }
  
  const activeCategories = categories.filter(c => c.active)
  
  return (
    <section>
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">Produits</h1>
          <p className="mt-1 text-slate-600">Catalogue de produits</p>
        </div>
        {canWrite && (
          <div className="flex flex-wrap gap-2"><button type="button" onClick={() => setManagingUnits(true)} className="ui-button-secondary"><Ruler className="h-4 w-4" aria-hidden="true" />Unités</button><button type="button" onClick={() => setImporting(true)} className="ui-button-secondary"><FileSpreadsheet className="h-4 w-4" aria-hidden="true" />Importer</button><button 
            onClick={() => { setEditingProduct(null); setOpen(true) }} 
            className="ui-button-primary"
          >
            <Plus className="h-4 w-4" aria-hidden="true" />Ajouter un produit
          </button></div>
        )}
      </div>
      
      {notice && <p className="mt-4 rounded bg-emerald-50 p-3 text-emerald-800">{notice}</p>}
      {error && <p className="mt-4 rounded bg-red-50 p-3 text-red-800">{error}</p>}
      
      {/* Filtres */}
      <div className="mt-6 flex flex-wrap gap-3 rounded-xl bg-white p-4 shadow-sm ring-1 ring-slate-200">
        <input 
          value={filters.search ?? ''} 
          onChange={(e) => { setFilters((f) => ({ ...f, search: e.target.value })); setPage(0) }} 
          placeholder="Nom, barcode ou marque" 
          className="rounded-lg border px-3 py-2" 
        />
        <select 
          value={filters.categoryId ?? ''} 
          onChange={(e) => { setFilters((f) => ({ ...f, categoryId: e.target.value || undefined })); setPage(0) }} 
          className="rounded-lg border px-3 py-2"
        >
          <option value="">Toutes catégories</option>
          {activeCategories.map((category) => (
            <option key={category.id} value={category.id}>{category.name}</option>
          ))}
        </select>
        <select 
          value={filters.stock ?? 'all'} 
          onChange={(e) => { setFilters((f) => ({ ...f, stock: e.target.value as ProductFilters['stock'] })); setPage(0) }} 
          className="rounded-lg border px-3 py-2"
        >
          <option value="all">Tous les stocks</option>
          <option value="low">Stock faible</option>
          <option value="out">Rupture</option>
        </select>
        <button 
          type="button"
          onClick={() => { setShowInactive(!showInactive); if (!showInactive) { setInactiveLoading(true); productService.getProducts(0, { status: 'inactive' }).then(({ data }) => { setInactiveProducts(data as unknown as Product[]); setInactiveLoading(false) }) } }} 
          className="ui-button-secondary"
        >
          {showInactive ? <EyeOff className="h-4 w-4" aria-hidden="true" /> : <Eye className="h-4 w-4" aria-hidden="true" />}{showInactive ? 'Masquer les inactifs' : 'Voir les inactifs'}
        </button>
      </div>
      
      {open && <ProductFormDialog product={editingProduct} onClose={() => { setOpen(false); setEditingProduct(null) }} onSaved={(_product, message) => { setOpen(false); setEditingProduct(null); setNotice(message); void load() }} />}
      {managingUnits && <CatalogListDialog list="units" canWrite={canWrite} onClose={() => setManagingUnits(false)} />}

      {/* Liste des produits */}
      <div className="mt-6 overflow-x-auto rounded-xl bg-white shadow-sm ring-1 ring-slate-200">
        <table className="w-full text-left text-sm">
          <thead className="bg-slate-50">
            <tr>
              <th className="p-3">Nom</th>
              <th className="p-3">Catégorie</th>
              <th className="p-3">Prix vente</th>
              <th className="p-3">Stock</th>
              <th className="p-3">Statut</th>
              {canWrite && <th className="p-3">Actions</th>}
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <TableRowsSkeleton rows={8} cols={canWrite ? 6 : 5} />
            ) : rows.length === 0 ? (
              <tr><td colSpan={canWrite ? 6 : 5} className="p-6 text-center text-slate-500">Aucun produit</td></tr>
            ) : rows.map((product) => (
              <tr key={product.id} className="border-t">
                <td className="p-3">
                  <div className="font-medium">{product.name}</div>
                  {product.barcode && <div className="text-xs text-slate-500">{product.barcode}</div>}
                </td>
                <td className="p-3">{product.category?.name || '-'}</td>
                <td className="p-3">{Number(product.selling_price).toFixed(2)} HTG</td>
                <td className="p-3">
                  <span className={product.stock_quantity <= product.minimum_stock ? 'text-red-600' : ''}>
                    {product.stock_quantity} {product.unit}
                  </span>
                </td>
                <td className="p-3">
                  <span className={`rounded px-2 py-1 text-xs ${product.active ? 'bg-emerald-100 text-emerald-800' : 'bg-slate-100 text-slate-600'}`}>
                    {product.active ? 'Actif' : 'Inactif'}
                  </span>
                </td>
                {canWrite && (
                  <td className="p-3">
                    <div className="flex gap-2">
                      <button onClick={() => edit(product)} className="inline-flex items-center gap-1.5 text-brand-700 hover:underline"><Pencil className="h-4 w-4" aria-hidden="true" />Modifier</button>
                      {product.active && (
                        <button onClick={() => void deactivate(product)} className="inline-flex items-center gap-1.5 text-red-600 hover:underline"><Ban className="h-4 w-4" aria-hidden="true" />Désactiver</button>
                      )}
                    </div>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      
      {/* Section Produits inactifs */}
      {showInactive && (
        <div className="mt-6 rounded-xl bg-white p-6 shadow-sm ring-1 ring-slate-200">
          <h2 className="text-lg font-semibold">Produits inactifs</h2>
          <p className="mt-1 text-sm text-slate-600">Produits désactivés qui peuvent être réactivés</p>
          
          {inactiveLoading ? (
            <TableSkeleton rows={3} cols={4} className="mt-4" />
          ) : inactiveProducts.length === 0 ? (
            <p className="mt-4 text-center text-slate-500">Aucun produit inactif</p>
          ) : (
            <div className="mt-4 overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="bg-slate-50">
                  <tr>
                    <th className="p-3">Nom</th>
                    <th className="p-3">Catégorie</th>
                    <th className="p-3">Prix vente</th>
                    <th className="p-3">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {inactiveProducts.map((product) => (
                    <tr key={product.id} className="border-t">
                      <td className="p-3">
                        <div className="font-medium">{product.name}</div>
                        {product.barcode && <div className="text-xs text-slate-500">{product.barcode}</div>}
                      </td>
                      <td className="p-3">{product.category?.name || '-'}</td>
                      <td className="p-3">{Number(product.selling_price).toFixed(2)} HTG</td>
                      <td className="p-3">
                        {canWrite && (
                          <button 
                            onClick={() => void activate(product)} 
                            className="inline-flex items-center gap-1.5 text-brand-700 hover:underline"
                          >
                            <RotateCcw className="h-4 w-4" aria-hidden="true" />Réactiver
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
{importing && <ImportDialog importer={productImporter} onClose={() => setImporting(false)} onDone={(imported) => { setNotice(`${imported} produit(s) importé(s).`); void load() }} />}    </section>
  )
}
