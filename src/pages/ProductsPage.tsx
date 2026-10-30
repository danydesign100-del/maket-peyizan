import { Ban, Eye, EyeOff, FileSpreadsheet, Pencil, Plus, RotateCcw, Save, X } from 'lucide-react'
import { ImportDialog } from '../components/ImportDialog'
import { productImporter } from '../services/importers'
import { TableRowsSkeleton, TableSkeleton } from '../components/Skeleton'
import { useEffect, useState, type FormEvent } from 'react'
import { categoryService } from '../services/categoryService'
import { productService, type ProductFilters } from '../services/productService'
import type { Category, Product, ProductInput, SupplierOption } from '../types/catalog'
import { useAuth } from '../contexts/AuthContext'
import { stockService } from '../services/stockService'

const empty: ProductInput = { 
  barcode: null, 
  name: '', 
  category_id: null, 
  supplier_id: null, 
  brand: null, 
  description: null, 
  purchase_price: 0, 
  selling_price: 0, 
  proforma_price: 0, 
  stock_quantity: 0, 
  minimum_stock: 0, 
  unit: 'unité', 
  expiration_date: null, 
  active: true 
}

export function ProductsPage() {
  const [importing, setImporting] = useState(false)

  const { profile } = useAuth()
  const canWrite = ['administrator', 'director', 'stock_manager'].includes(profile?.role?.code ?? '')
  
  const [rows, setRows] = useState<Product[]>([])
  const [categories, setCategories] = useState<Category[]>([])
  const [suppliers, setSuppliers] = useState<SupplierOption[]>([])
  const [, setCount] = useState(0)
  const [page, setPage] = useState(0)
  const [filters, setFilters] = useState<ProductFilters>({ status: 'active', stock: 'all' })
  const [showInactive, setShowInactive] = useState(false)
  const [inactiveProducts, setInactiveProducts] = useState<Product[]>([])
  const [inactiveLoading, setInactiveLoading] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [form, setForm] = useState<ProductInput>(empty)
  const [editing, setEditing] = useState<string | null>(null)
  const [image, setImage] = useState<File | null>(null)
  const [open, setOpen] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)
  
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
    void Promise.all([categoryService.getCategories(), productService.getSuppliers()])
      .then(([categoryResult, supplierResult]) => {
        if (categoryResult.error) {
          setError(categoryResult.error.message)
        } else {
          setCategories(categoryResult.data ?? [])
        }
        if (supplierResult.error) {
          setError(supplierResult.error.message)
        } else {
          setSuppliers(supplierResult.data as unknown as SupplierOption[])
        }
      })
  }, [])
  
  const set = <K extends keyof ProductInput>(key: K, value: ProductInput[K]) => 
    setForm((current) => ({ ...current, [key]: value }))
  
  const edit = (product: Product) => {
    const { id, created_at, updated_at, category, supplier, image_url, ...input } = product
    setForm({ ...input, image_url })
    setImage(null)
    setEditing(id)
    setOpen(true)
    setFormError(null)
  }
  
  const validateForm = (): string | null => {
    if (!form.name.trim()) return 'Le nom du produit est obligatoire.'
    if (!form.category_id) return 'La catégorie est obligatoire.'
    if (form.selling_price < 0) return 'Le prix de vente doit être positif.'
    if (form.purchase_price < 0) return 'Le prix d\'achat doit être positif.'
    if (form.stock_quantity < 0) return 'Le stock doit être positif.'
    if (form.minimum_stock < 0) return 'Le stock minimum doit être positif.'
    if (form.barcode && !form.barcode.trim()) return 'Le code-barres ne peut pas être vide.'
    return null
  }
  
  const submit = async (event: FormEvent) => {
    event.preventDefault()
    
    const validationError = validateForm()
    if (validationError) {
      setFormError(validationError)
      return
    }
    
    setSubmitting(true)
    setError(null)
    setFormError(null)
    
    try {
      const image_url = image ? await productService.uploadImage(image) : form.image_url ?? null
      const payload = { 
        ...form, 
        barcode: form.barcode?.trim() || null, 
        image_url 
      }
      
      if (editing) {
        const { stock_quantity: _stock, ...editablePayload } = payload
        const { error: requestError } = await productService.updateProduct(editing, editablePayload)
        if (requestError) throw requestError
      } else {
        const initialStock = payload.stock_quantity
        const { stock_quantity: _stock, ...newPayload } = payload
        const { data: product, error: requestError } = await productService.createProduct({ 
          ...newPayload, 
          stock_quantity: 0 
        })
        if (requestError) throw requestError
        
        if (initialStock > 0) {
          const { error: movementError } = await stockService.createMovement({ 
            product_id: (product as { id: string }).id, 
            movement_type: 'entry', 
            quantity: initialStock, 
            reason: 'Stock initial', 
            purchase_price: payload.purchase_price 
          })
          if (movementError) throw movementError
        }
      }
      
      setNotice(editing ? 'Produit modifié.' : 'Produit créé.')
      setOpen(false)
      setEditing(null)
      setForm(empty)
      setImage(null)
      void load()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Impossible d\'enregistrer le produit.')
    } finally {
      setSubmitting(false)
    }
  }
  
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
  const activeSuppliers = suppliers
  
  return (
    <section>
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">Produits</h1>
          <p className="mt-1 text-slate-600">Catalogue de produits</p>
        </div>
        {canWrite && (
          <div className="flex flex-wrap gap-2"><button type="button" onClick={() => setImporting(true)} className="ui-button-secondary"><FileSpreadsheet className="h-4 w-4" aria-hidden="true" />Importer</button><button 
            onClick={() => { setForm(empty); setEditing(null); setImage(null); setOpen(true); setFormError(null) }} 
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
      
      {/* Formulaire */}
      {open && (
        <form onSubmit={submit} className="mt-6 rounded-xl bg-white p-6 shadow-sm ring-1 ring-slate-200">
          <h2 className="text-lg font-semibold">{editing ? 'Modifier le produit' : 'Nouveau produit'}</h2>
          
          {formError && <p className="mt-4 rounded bg-red-50 p-3 text-sm text-red-800">{formError}</p>}
          
          {/* Section Informations de base */}
          <div className="mt-6">
            <h3 className="mb-4 text-sm font-semibold uppercase tracking-wide text-slate-500">Informations de base</h3>
            <div className="grid gap-4 md:grid-cols-2">
              <div>
                <label className="block text-sm font-medium">Nom du produit *</label>
                <input 
                  required
                  value={form.name} 
                  onChange={(e) => set('name', e.target.value)} 
                  placeholder="Nom du produit" 
                  className="mt-1 w-full rounded border p-2" 
                />
              </div>
              <div>
                <label className="block text-sm font-medium">Code-barres</label>
                <input 
                  value={form.barcode ?? ''} 
                  onChange={(e) => set('barcode', e.target.value || null)} 
                  placeholder="Scanner ou entrer manuellement" 
                  className="mt-1 w-full rounded border p-2" 
                />
              </div>
              <div>
                <label className="block text-sm font-medium">Catégorie *</label>
                <select 
                  required
                  value={form.category_id ?? ''} 
                  onChange={(e) => set('category_id', e.target.value || null)} 
                  className="mt-1 w-full rounded border p-2"
                >
                  <option value="">Sélectionner une catégorie</option>
                  {activeCategories.map((category) => (
                    <option key={category.id} value={category.id}>{category.name}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium">Fournisseur</label>
                <select 
                  value={form.supplier_id ?? ''} 
                  onChange={(e) => set('supplier_id', e.target.value || null)} 
                  className="mt-1 w-full rounded border p-2"
                >
                  <option value="">Sélectionner un fournisseur</option>
                  {activeSuppliers.map((supplier) => (
                    <option key={supplier.id} value={supplier.id}>{supplier.name}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium">Marque</label>
                <input 
                  value={form.brand ?? ''} 
                  onChange={(e) => set('brand', e.target.value || null)} 
                  placeholder="Marque du produit" 
                  className="mt-1 w-full rounded border p-2" 
                />
              </div>
              <div>
                <label className="block text-sm font-medium">Unité</label>
                <select 
                  value={form.unit} 
                  onChange={(e) => set('unit', e.target.value)} 
                  className="mt-1 w-full rounded border p-2"
                >
                  <option value="unité">Unité</option>
                  <option value="kg">Kilogramme</option>
                  <option value="litre">Litre</option>
                  <option value="mètre">Mètre</option>
                  <option value="pièce">Pièce</option>
                </select>
              </div>
            </div>
            <div className="mt-4">
              <label className="block text-sm font-medium">Description</label>
              <textarea 
                value={form.description ?? ''} 
                onChange={(e) => set('description', e.target.value || null)} 
                placeholder="Description du produit" 
                rows={3}
                className="mt-1 w-full rounded border p-2" 
              />
            </div>
          </div>
          
          {/* Section Prix */}
          <div className="mt-6 border-t pt-6">
            <h3 className="mb-4 text-sm font-semibold uppercase tracking-wide text-slate-500">Prix</h3>
            <div className="grid gap-4 md:grid-cols-3">
              <div>
                <label className="block text-sm font-medium">Prix d'achat *</label>
                <input 
                  required
                  type="number"
                  step="0.01"
                  min="0"
                  value={form.purchase_price} 
                  onChange={(e) => set('purchase_price', Number(e.target.value))} 
                  className="mt-1 w-full rounded border p-2" 
                />
              </div>
              <div>
                <label className="block text-sm font-medium">Prix de vente *</label>
                <input 
                  required
                  type="number"
                  step="0.01"
                  min="0"
                  value={form.selling_price} 
                  onChange={(e) => set('selling_price', Number(e.target.value))} 
                  className="mt-1 w-full rounded border p-2" 
                />
              </div>
              <div>
                <label className="block text-sm font-medium">Prix proforma</label>
                <input 
                  type="number"
                  step="0.01"
                  min="0"
                  value={form.proforma_price} 
                  onChange={(e) => set('proforma_price', Number(e.target.value))} 
                  className="mt-1 w-full rounded border p-2" 
                />
              </div>
            </div>
          </div>
          
          {/* Section Stock */}
          <div className="mt-6 border-t pt-6">
            <h3 className="mb-4 text-sm font-semibold uppercase tracking-wide text-slate-500">Stock</h3>
            <div className="grid gap-4 md:grid-cols-2">
              <div>
                <label className="block text-sm font-medium">Stock initial *</label>
                <input 
                  required
                  type="number"
                  step="0.01"
                  min="0"
                  value={form.stock_quantity} 
                  onChange={(e) => set('stock_quantity', Number(e.target.value))} 
                  className="mt-1 w-full rounded border p-2" 
                />
              </div>
              <div>
                <label className="block text-sm font-medium">Stock minimum</label>
                <input 
                  type="number"
                  step="0.01"
                  min="0"
                  value={form.minimum_stock} 
                  onChange={(e) => set('minimum_stock', Number(e.target.value))} 
                  className="mt-1 w-full rounded border p-2" 
                />
              </div>
              <div>
                <label className="block text-sm font-medium">Date d'expiration</label>
                <input 
                  type="date"
                  value={form.expiration_date ?? ''} 
                  onChange={(e) => set('expiration_date', e.target.value || null)} 
                  className="mt-1 w-full rounded border p-2" 
                />
              </div>
            </div>
          </div>
          
          {/* Section Image */}
          <div className="mt-6 border-t pt-6">
            <h3 className="mb-4 text-sm font-semibold uppercase tracking-wide text-slate-500">Image</h3>
            <div>
              <input 
                type="file" 
                accept="image/*"
                onChange={(e) => setImage(e.target.files?.[0] ?? null)} 
                className="rounded border p-2" 
              />
              {form.image_url && (
                <div className="mt-2">
                  <img src={form.image_url} alt="Produit" className="h-20 w-20 rounded object-cover" />
                </div>
              )}
            </div>
          </div>
          
          <div className="mt-6 flex gap-3">
            <button type="submit" disabled={submitting} className="ui-button-primary">
              <Save className="h-4 w-4" aria-hidden="true" />{submitting ? 'Enregistrement...' : editing ? 'Modifier' : 'Créer'}
            </button>
            <button 
              type="button" 
              onClick={() => { setOpen(false); setForm(empty); setEditing(null); setImage(null); setFormError(null) }} 
              className="ui-button-secondary"
            >
              <X className="h-4 w-4" aria-hidden="true" />Annuler
            </button>
          </div>
        </form>
      )}
      
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
                <td className="p-3">{product.category?.name || '—'}</td>
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
                      <td className="p-3">{product.category?.name || '—'}</td>
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
