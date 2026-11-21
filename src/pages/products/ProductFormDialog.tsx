import { useEffect, useState, type FormEvent } from 'react'
import { AlertTriangle, Plus, Save, Settings2 } from 'lucide-react'
import { QuickCreateDialog } from '../../components/QuickCreateDialog'
import { supplierService } from '../../services/supplierService'
import { errorText } from '../../lib/errors'
import { Modal } from '../../components/Modal'
import { CatalogListDialog } from '../../components/CatalogListDialog'
import { categoryService } from '../../services/categoryService'
import { catalogListService } from '../../services/catalogListService'
import { productService } from '../../services/productService'
import { stockService } from '../../services/stockService'
import type { CatalogListItem, Category, Product, ProductInput, SupplierOption } from '../../types/catalog'
import type { StockSettlement } from '../../types/stock'
import { isLocalDbConfigured } from '../../lib/supabase'
import { SETTLEMENTS } from '../stock/StockMovementForm'

export const emptyProduct: ProductInput = {
  barcode: null, name: '', category_id: null, supplier_id: null, brand: null, description: null,
  purchase_price: 0, selling_price: 0, proforma_price: 0, stock_quantity: 0, minimum_stock: 0,
  unit: 'unité', expiration_date: null, active: true,
}

/** Same comparison as catalog_key() in the database: case and repeated spaces are ignored. */
const catalogKey = (value: string | null | undefined) => (value ?? '').trim().replace(/\s+/g, ' ').toLocaleLowerCase('fr')
const toInput = ({ id: _id, created_at: _created, updated_at: _updated, category: _category, supplier: _supplier, ...input }: Product): ProductInput => input

type Duplicates = { name: Product | null; barcode: Product | null; similar: Product[] }

/**
 * Product sheet, used by the Products page and the point of sale (quick mode:
 * optional fields folded away). Initial stock is recorded as a stock movement.
 */
export function ProductFormDialog({ product, initial, quick = false, onClose, onSaved }: {
  product?: Product | null; initial?: Partial<ProductInput>; quick?: boolean
  onClose: () => void; onSaved: (product: Product, message: string) => void
}) {
  const editing = product?.id ?? null
  const [form, setForm] = useState<ProductInput>(() => product ? toInput(product) : { ...emptyProduct, ...initial })
  const [categories, setCategories] = useState<Category[]>([])
  const [suppliers, setSuppliers] = useState<SupplierOption[]>([])
  const [units, setUnits] = useState<CatalogListItem[]>([])
  const [managingUnits, setManagingUnits] = useState(false)
  const [image, setImage] = useState<File | null>(null)
  const [duplicates, setDuplicates] = useState<Duplicates>({ name: null, barcode: null, similar: [] })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [unitsVersion, setUnitsVersion] = useState(0)
  const [settlement, setSettlement] = useState<StockSettlement | null>(null)
  // « + Ajouter » next to Catégorie, Fournisseur and Unité: created, then selected.
  const [adding, setAdding] = useState<'category' | 'supplier' | 'unit' | null>(null)
  const [supplierCategories, setSupplierCategories] = useState<CatalogListItem[]>([])
  useEffect(() => { if (adding === 'supplier') void catalogListService.list('supplier_categories').then(({ data }) => setSupplierCategories((data ?? []).filter((item) => item.active))) }, [adding])
  const addCategory = async (values: Record<string, string>) => {
    const { data, error: createError } = await categoryService.createCategory({ name: values.name, description: values.description || null })
    if (createError || !data) return errorText(createError, 'Création impossible')
    const created = data as Category
    setCategories((current) => [...current.filter((item) => item.id !== created.id), created].sort((a, b) => a.name.localeCompare(b.name, 'fr')))
    set('category_id', created.id); setAdding(null); return null
  }
  const addSupplier = async (values: Record<string, string>) => {
    const { data, error: createError } = await supplierService.createSupplier({ name: values.name, category_id: values.category_id || null, phone: values.phone || null, company_name: null, email: null, address: null, tax_id: null, notes: null })
    if (createError || !data) return errorText(createError, 'Création impossible')
    const created = data as { id: string; name: string }
    setSuppliers((current) => [...current.filter((item) => item.id !== created.id), { id: created.id, name: created.name }].sort((a, b) => a.name.localeCompare(b.name, 'fr')))
    set('supplier_id', created.id); setAdding(null); return null
  }
  const addUnit = async (values: Record<string, string>) => {
    const { data, error: createError } = await catalogListService.create('units', values.name)
    if (createError || !data) return errorText(createError, 'Création impossible')
    setUnits((current) => [...current, data]); set('unit', data.name); setAdding(null); return null
  }
  const addButton = (what: 'category' | 'supplier' | 'unit', label: string) => <button type="button" onClick={() => setAdding(what)} className="inline-flex items-center gap-0.5 text-xs font-medium text-brand-700 hover:underline"><Plus className="h-3.5 w-3.5" aria-hidden="true" />{label}</button>

  useEffect(() => {
    void Promise.all([categoryService.getCategories(), productService.getSuppliers()]).then(([categoryResult, supplierResult]) => {
      if (categoryResult.error || supplierResult.error) setError((categoryResult.error ?? supplierResult.error)!.message)
      setCategories((categoryResult.data ?? []).filter((category) => category.active))
      setSuppliers((supplierResult.data ?? []) as SupplierOption[])
    })
  }, [])
  useEffect(() => {
    void catalogListService.list('units').then(({ data, error: loadError }) => loadError ? setError(loadError.message) : setUnits(data ?? []))
  }, [unitsVersion])

  // Duplicate warnings while typing (the database refuses them anyway).
  useEffect(() => {
    const name = form.name.trim(); const barcode = form.barcode?.trim() ?? ''
    if (name.length < 3 && !barcode) { setDuplicates({ name: null, barcode: null, similar: [] }); return }
    const timer = window.setTimeout(() => {
      const none = Promise.resolve({ data: [] as Product[] })
      const firstWord = name.split(' ')[0]
      void Promise.all([
        name.length >= 3 ? productService.getProducts(0, { search: name.replace(/\s+/g, ' '), status: 'all' }) : none,
        name.length >= 3 && firstWord.length >= 3 ? productService.getProducts(0, { search: firstWord, status: 'all' }) : none,
        barcode ? productService.getProducts(0, { search: barcode, status: 'all' }) : none,
      ]).then(([byName, byWord, byBarcode]) => {
        const others = [...((byName.data ?? []) as Product[]), ...((byWord.data ?? []) as Product[])].filter((item, index, all) => item.id !== editing && all.findIndex((other) => other.id === item.id) === index)
        const sameName = others.find((item) => catalogKey(item.name) === catalogKey(name)) ?? null
        const words = catalogKey(name).split(' ').filter((word) => word.length > 2)
        setDuplicates({
          name: sameName,
          barcode: ((byBarcode.data ?? []) as Product[]).find((item) => item.id !== editing && item.barcode?.trim() === barcode) ?? null,
          similar: sameName ? [] : others.filter((item) => words.length > 0 && words.every((word) => catalogKey(item.name).includes(word))).slice(0, 3),
        })
      })
    }, 350)
    return () => window.clearTimeout(timer)
  }, [form.name, form.barcode, editing])

  const set = <K extends keyof ProductInput>(key: K, value: ProductInput[K]) => setForm((current) => ({ ...current, [key]: value }))
  const activeUnits = units.filter((unit) => unit.active || catalogKey(unit.name) === catalogKey(form.unit))
  const knownUnit = units.some((unit) => catalogKey(unit.name) === catalogKey(form.unit))
  // Initial stock: already in the shop (opening) unless a supplier delivered it.
  const initialSettlement: StockSettlement = settlement ?? (form.supplier_id ? 'supplier' : 'opening')

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    const problem = !form.name.trim() ? 'Le nom du produit est obligatoire.'
      : !form.category_id ? 'La catégorie est obligatoire.'
      : duplicates.name ? `Un produit nommé « ${duplicates.name.name} » existe déjà${duplicates.name.active ? '' : ' (inactif : réactivez-le plutôt)'}.`
      : duplicates.barcode ? `Le code-barres ${form.barcode?.trim()} est déjà utilisé par « ${duplicates.barcode.name} ».`
      : [form.selling_price, form.purchase_price, form.stock_quantity, form.minimum_stock, form.proforma_price].some((value) => !Number.isFinite(value) || value < 0) ? 'Les prix et quantités doivent être positifs.'
      : !editing && !knownUnit ? 'Choisissez une unité de la liste.'
      : null
    if (problem) return setError(problem)
    setSaving(true); setError(null)
    try {
      const image_url = image ? await productService.uploadImage(image) : form.image_url ?? null
      const { stock_quantity: initialStock, ...payload } = { ...form, name: form.name.trim().replace(/\s+/g, ' '), barcode: form.barcode?.trim() || null, image_url }
      if (editing) {
        const { data, error: requestError } = await productService.updateProduct(editing, payload)
        if (requestError) throw requestError
        onSaved({ ...product!, ...payload, ...(data as Product | null) }, `Produit « ${payload.name} » modifié.`)
        return
      }
      const { data, error: requestError } = await productService.createProduct({ ...payload, stock_quantity: 0 })
      if (requestError) throw requestError
      const created = data as Product
      if (initialStock > 0) {
        const { error: movementError } = await stockService.createMovement({ product_id: created.id, movement_type: 'entry', quantity: initialStock, reason: 'Stock initial', purchase_price: payload.purchase_price, supplier_id: payload.supplier_id, settlement: initialSettlement })
        if (movementError) throw movementError
      }
      onSaved({ ...created, stock_quantity: initialStock }, `Produit « ${payload.name} » créé${initialStock > 0 ? ` avec ${initialStock} ${payload.unit} en stock` : ''}.`)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String((cause as { message?: unknown })?.message ?? 'Impossible d’enregistrer le produit.'))
    } finally {
      setSaving(false)
    }
  }

  const field = 'block text-sm font-medium text-slate-700'
  const optional = <>
    <label className={field}>Marque<input value={form.brand ?? ''} onChange={(event) => set('brand', event.target.value || null)} className="mt-1 w-full" /></label>
    <label className={field}>Prix proforma<input type="number" step="0.01" min="0" value={form.proforma_price} onChange={(event) => set('proforma_price', Number(event.target.value))} className="mt-1 w-full" /></label>
    <label className={field}>Stock minimum<input type="number" step="0.001" min="0" value={form.minimum_stock} onChange={(event) => set('minimum_stock', Number(event.target.value))} className="mt-1 w-full" /></label>
    <label className={field}>Date d’expiration<input type="date" value={form.expiration_date ?? ''} onChange={(event) => set('expiration_date', event.target.value || null)} className="mt-1 w-full" /></label>
    <label className={`${field} sm:col-span-2`}>Description<textarea rows={2} value={form.description ?? ''} onChange={(event) => set('description', event.target.value || null)} className="mt-1 w-full" /></label>
    <label className={`${field} sm:col-span-2`}>Image<input type="file" accept="image/jpeg,image/png,image/webp" onChange={(event) => setImage(event.target.files?.[0] ?? null)} className="mt-1 block w-full text-sm" />
      {form.image_url && !image && <img src={form.image_url} alt="" className="mt-2 h-16 w-16 rounded object-cover" />}</label>
  </>

  return <>
    <Modal size="lg" title={editing ? 'Modifier le produit' : 'Nouveau produit'} subtitle={quick ? 'Créé depuis le point de vente ; il est ajouté au panier s’il est en stock.' : undefined} onClose={onClose} locked={saving || managingUnits || adding !== null}
      footer={<><button type="button" onClick={onClose} className="ui-button-secondary">Annuler</button><button type="submit" form="product-form" disabled={saving} className="ui-button-primary"><Save className="h-4 w-4" aria-hidden="true" />{saving ? 'Enregistrement…' : editing ? 'Enregistrer' : 'Créer le produit'}</button></>}>
      <form id="product-form" onSubmit={submit} className="grid gap-4 sm:grid-cols-2">
        {error && <p role="alert" className="ui-alert-error mt-0 sm:col-span-2">{error}</p>}
        <label className={field}>Nom du produit *<input autoFocus={!form.name} required value={form.name} onChange={(event) => set('name', event.target.value)} maxLength={180} className="mt-1 w-full" />
          {duplicates.name && <span role="alert" className="mt-1 flex items-start gap-1 text-xs font-normal text-red-700"><AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />Existe déjà : « {duplicates.name.name} »{duplicates.name.active ? ` (${duplicates.name.stock_quantity} ${duplicates.name.unit} en stock)` : ' — inactif, réactivez-le plutôt'}</span>}
          {duplicates.similar.length > 0 && <span className="mt-1 block text-xs font-normal text-amber-700">Produits proches : {duplicates.similar.map((item) => item.name).join(' · ')}</span>}
        </label>
        <label className={field}>Code-barres<input value={form.barcode ?? ''} onChange={(event) => set('barcode', event.target.value || null)} placeholder="Scanner ou saisir" maxLength={80} className="mt-1 w-full" />
          {duplicates.barcode && <span role="alert" className="mt-1 flex items-start gap-1 text-xs font-normal text-red-700"><AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />Déjà utilisé par « {duplicates.barcode.name} »</span>}
        </label>
        <label className={field}><span className="flex items-center justify-between">Catégorie *{addButton('category', 'Ajouter une catégorie')}</span><select required value={form.category_id ?? ''} onChange={(event) => set('category_id', event.target.value || null)} className="mt-1 w-full"><option value="">Choisir…</option>{categories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}</select></label>
        <label className={field}><span className="flex items-center justify-between">Fournisseur{addButton('supplier', 'Ajouter un fournisseur')}</span><select value={form.supplier_id ?? ''} onChange={(event) => set('supplier_id', event.target.value || null)} className="mt-1 w-full"><option value="">Aucun</option>{suppliers.map((supplier) => <option key={supplier.id} value={supplier.id}>{supplier.name}</option>)}</select></label>
        <label className={field}><span className="flex items-center justify-between">Unité *<span className="flex gap-3">{addButton('unit', 'Ajouter une unité')}<button type="button" onClick={() => setManagingUnits(true)} title="Gérer les unités" className="inline-flex items-center text-xs font-medium text-slate-500 hover:text-brand-700"><Settings2 className="h-3.5 w-3.5" aria-label="Gérer les unités" /></button></span></span>
          <select value={activeUnits.find((unit) => catalogKey(unit.name) === catalogKey(form.unit))?.name ?? form.unit} onChange={(event) => set('unit', event.target.value)} className="mt-1 w-full">
            {!knownUnit && <option value={form.unit}>{form.unit} (hors liste)</option>}
            {activeUnits.map((unit) => <option key={unit.id} value={unit.name}>{unit.name}</option>)}
          </select></label>
        <label className={field}>Prix de vente (HTG) *<input required type="number" step="0.01" min="0" value={form.selling_price} onChange={(event) => set('selling_price', Number(event.target.value))} className="mt-1 w-full" /></label>
        <label className={field}>Prix d’achat (HTG)<input type="number" step="0.01" min="0" value={form.purchase_price} onChange={(event) => set('purchase_price', Number(event.target.value))} className="mt-1 w-full" /></label>
        {!editing && <label className={field}>Stock initial<input type="number" step="0.001" min="0" value={form.stock_quantity} onChange={(event) => set('stock_quantity', Number(event.target.value))} className="mt-1 w-full" /><span className="mt-1 block text-xs font-normal text-slate-500">Enregistré comme entrée de stock, au prix d’achat.</span></label>}
        {!editing && !isLocalDbConfigured && form.stock_quantity > 0 && form.purchase_price > 0 && <label className={`${field} sm:col-span-2`}>Origine du stock initial
          <select value={initialSettlement} onChange={(event) => setSettlement(event.target.value as StockSettlement)} className="mt-1 w-full">
            {(Object.keys(SETTLEMENTS) as StockSettlement[]).map((key) => <option key={key} value={key}>{SETTLEMENTS[key].label} ({SETTLEMENTS[key].account})</option>)}
          </select>
          <span className="mt-1 block text-xs font-normal text-slate-500">Écriture : débit 120000 Stock, crédit {SETTLEMENTS[initialSettlement].account} - {(form.stock_quantity * form.purchase_price).toLocaleString('fr-HT', { minimumFractionDigits: 2 })} HTG.</span>
        </label>}
        {quick
          ? <details className="sm:col-span-2"><summary className="cursor-pointer text-sm font-medium text-slate-600">Plus de détails (marque, stock minimum, image…)</summary><div className="mt-3 grid gap-4 sm:grid-cols-2">{optional}</div></details>
          : optional}
      </form>
    </Modal>
    {adding === 'category' && <QuickCreateDialog title="Nouvelle catégorie" onClose={() => setAdding(null)} onSubmit={addCategory}
      fields={[{ key: 'name', label: 'Nom', required: true, placeholder: 'Ex. : Épicerie' }, { key: 'description', label: 'Description' }]} />}
    {adding === 'supplier' && <QuickCreateDialog title="Nouveau fournisseur" onClose={() => setAdding(null)} onSubmit={addSupplier}
      fields={[{ key: 'name', label: 'Nom', required: true }, { key: 'category_id', label: 'Catégorie', type: 'select', options: [{ value: '', label: 'Non classé' }, ...supplierCategories.map((item) => ({ value: item.id, label: item.name }))] }, { key: 'phone', label: 'Téléphone', type: 'tel' }]} />}
    {adding === 'unit' && <QuickCreateDialog title="Nouvelle unité" onClose={() => setAdding(null)} onSubmit={addUnit}
      fields={[{ key: 'name', label: 'Nom de l’unité', required: true, placeholder: 'Ex. : marmite, sac de 50 lb' }]} />}
    {managingUnits && <CatalogListDialog list="units" canWrite onClose={() => setManagingUnits(false)} onChanged={() => setUnitsVersion((value) => value + 1)} />}
  </>
}
