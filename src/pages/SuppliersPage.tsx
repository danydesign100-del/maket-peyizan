import { useEffect, useState, type FormEvent } from 'react'
import { Ban, ChevronLeft, ChevronRight, Eye, FileSpreadsheet, Package, Pencil, Plus, RotateCcw, Save, Tags, Truck } from 'lucide-react'
import { CatalogListDialog } from '../components/CatalogListDialog'
import { ImportDialog } from '../components/ImportDialog'
import { Modal } from '../components/Modal'
import { PageHeader } from '../components/PageHeader'
import { TableRowsSkeleton } from '../components/Skeleton'
import { useAuth } from '../contexts/AuthContext'
import { formatDateTime } from '../lib/period'
import { catalogListService } from '../services/catalogListService'
import { supplierImporter } from '../services/importers'
import { formatAmount } from '../services/ledgerService'
import { supplierService, type SupplierDelivery, type SupplierProduct } from '../services/supplierService'
import type { CatalogListItem } from '../types/catalog'
import type { Supplier, SupplierInput } from '../types/stock'

const empty: SupplierInput = { name: '', category_id: null, company_name: null, phone: null, email: null, address: null, tax_id: null, notes: null }
const errorText = (error: unknown) => error instanceof Error ? error.message : String((error as { message?: unknown })?.message ?? 'Enregistrement impossible.')

function SupplierFormDialog({ supplier, categories, onClose, onSaved }: { supplier: Supplier | null; categories: CatalogListItem[]; onClose: () => void; onSaved: (message: string) => void }) {
  const [form, setForm] = useState<SupplierInput>(() => supplier ? { name: supplier.name, category_id: supplier.category_id, company_name: supplier.company_name, phone: supplier.phone, email: supplier.email, address: supplier.address, tax_id: supplier.tax_id, notes: supplier.notes } : empty)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const set = <K extends keyof SupplierInput>(key: K, value: SupplierInput[K]) => setForm((current) => ({ ...current, [key]: value }))
  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if (!form.name.trim()) return setError('Le nom est obligatoire.')
    setSaving(true); setError(null)
    const { error: saveError } = supplier ? await supplierService.updateSupplier(supplier.id, form) : await supplierService.createSupplier(form)
    setSaving(false)
    if (saveError) return setError(errorText(saveError))
    onSaved(supplier ? `Fournisseur « ${form.name.trim()} » modifié.` : `Fournisseur « ${form.name.trim()} » créé.`)
  }
  const field = 'block text-sm font-medium text-slate-700'
  const choices = categories.filter((category) => category.active || category.id === form.category_id)
  return <Modal title={supplier ? 'Modifier le fournisseur' : 'Nouveau fournisseur'} onClose={onClose} locked={saving}
    footer={<><button type="button" onClick={onClose} className="ui-button-secondary">Annuler</button><button type="submit" form="supplier-form" disabled={saving} className="ui-button-primary"><Save className="h-4 w-4" aria-hidden="true" />{saving ? 'Enregistrement…' : 'Enregistrer'}</button></>}>
    <form id="supplier-form" onSubmit={submit} className="grid gap-4 sm:grid-cols-2">
      {error && <p role="alert" className="ui-alert-error mt-0 sm:col-span-2">{error}</p>}
      <label className={field}>Nom *<input autoFocus required maxLength={160} value={form.name} onChange={(event) => set('name', event.target.value)} className="mt-1 w-full" /></label>
      <label className={field}>Catégorie<select value={form.category_id ?? ''} onChange={(event) => set('category_id', event.target.value || null)} className="mt-1 w-full"><option value="">Non classé</option>{choices.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}</select></label>
      <label className={field}>Entreprise<input value={form.company_name ?? ''} onChange={(event) => set('company_name', event.target.value || null)} className="mt-1 w-full" /></label>
      <label className={field}>Téléphone<input value={form.phone ?? ''} onChange={(event) => set('phone', event.target.value || null)} className="mt-1 w-full" /></label>
      <label className={field}>E-mail<input type="email" value={form.email ?? ''} onChange={(event) => set('email', event.target.value || null)} className="mt-1 w-full" /></label>
      <label className={field}>NIF<input value={form.tax_id ?? ''} onChange={(event) => set('tax_id', event.target.value || null)} className="mt-1 w-full" /></label>
      <label className={`${field} sm:col-span-2`}>Adresse<input value={form.address ?? ''} onChange={(event) => set('address', event.target.value || null)} className="mt-1 w-full" /></label>
      <label className={`${field} sm:col-span-2`}>Notes<textarea rows={2} value={form.notes ?? ''} onChange={(event) => set('notes', event.target.value || null)} className="mt-1 w-full" /></label>
    </form>
  </Modal>
}

/** Supplier sheet: contact details, and the products it supplies with the latest deliveries. */
function SupplierDetailDialog({ supplier, canWrite, onEdit, onClose }: { supplier: Supplier; canWrite: boolean; onEdit: () => void; onClose: () => void }) {
  const [tab, setTab] = useState<'sheet' | 'products'>('products')
  const [products, setProducts] = useState<SupplierProduct[] | null>(null)
  const [deliveries, setDeliveries] = useState<SupplierDelivery[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    void Promise.all([supplierService.getSupplierProducts(supplier.id), canWrite ? supplierService.getSupplierDeliveries(supplier.id) : Promise.resolve({ data: [], error: null })]).then(([productResult, deliveryResult]) => {
      if (productResult.error || deliveryResult.error) setError(errorText(productResult.error ?? deliveryResult.error))
      setProducts((productResult.data ?? []) as SupplierProduct[])
      setDeliveries((deliveryResult.data ?? []) as unknown as SupplierDelivery[])
    })
  }, [supplier.id, canWrite])
  const entries = (deliveries ?? []).filter((delivery) => delivery.movement_type === 'entry')
  const purchased = entries.reduce((sum, delivery) => sum + Number(delivery.quantity) * Number(delivery.purchase_price ?? 0), 0)
  const details: [string, string | null][] = [['Catégorie', supplier.category?.name ?? 'Non classé'], ['Entreprise', supplier.company_name], ['Téléphone', supplier.phone], ['E-mail', supplier.email], ['NIF', supplier.tax_id], ['Adresse', supplier.address], ['Notes', supplier.notes], ['Statut', supplier.active ? 'Actif' : 'Inactif']]

  return <Modal size="lg" title={supplier.name} subtitle={supplier.category?.name ?? 'Fournisseur non classé'} onClose={onClose}
    footer={<>{canWrite && <button type="button" onClick={onEdit} className="ui-button-secondary"><Pencil className="h-4 w-4" aria-hidden="true" />Modifier</button>}<button type="button" onClick={onClose} className="ui-button-primary">Fermer</button></>}>
    <div role="tablist" aria-label="Fiche fournisseur" className="-mt-1 mb-4 flex gap-1 border-b border-slate-200">
      {([['sheet', 'Fiche', Truck], ['products', `Produits${products ? ` (${products.length})` : ''}`, Package]] as const).map(([id, label, Icon]) =>
        <button key={id} type="button" role="tab" aria-selected={tab === id} onClick={() => setTab(id)} className={`-mb-px inline-flex items-center gap-1.5 border-b-2 px-3 py-2 text-sm ${tab === id ? 'border-brand-700 font-semibold text-brand-900' : 'border-transparent text-slate-600 hover:text-slate-900'}`}><Icon className="h-4 w-4" aria-hidden="true" />{label}</button>)}
    </div>
    {error && <p role="alert" className="ui-alert-error mt-0 mb-3">{error}</p>}
    {tab === 'sheet' ? <dl className="grid gap-x-6 gap-y-3 text-sm sm:grid-cols-2">
      {details.map(([label, value]) => <div key={label}><dt className="text-xs text-slate-500">{label}</dt><dd className="mt-0.5 whitespace-pre-line text-slate-900">{value || '—'}</dd></div>)}
    </dl> : <div className="space-y-5">
      <div className="overflow-x-auto rounded-lg border border-slate-200">
        <table className="ui-table text-sm">
          <thead><tr><th>Produit</th><th className="text-right">Stock</th><th className="text-right" title="Coût moyen pondéré des entrées de stock">Coût moyen</th><th className="text-right">Prix de vente</th></tr></thead>
          <tbody>
            {products === null ? <TableRowsSkeleton rows={3} cols={4} /> : products.length === 0 ? <tr><td colSpan={4} className="ui-empty py-6">Aucun produit n’indique ce fournisseur dans sa fiche.</td></tr>
              : products.map((product) => <tr key={product.id} className={product.active ? '' : 'text-slate-400'}>
                <td><span className="font-medium">{product.name}</span>{!product.active && <span className="ml-2 text-xs">(inactif)</span>}{product.barcode && <span className="block text-xs text-slate-500">{product.barcode}</span>}</td>
                <td className="whitespace-nowrap text-right tabular-nums">{Number(product.stock_quantity)} {product.unit}</td>
                <td className="text-right tabular-nums">{formatAmount(Number(product.average_cost))}</td>
                <td className="text-right tabular-nums">{formatAmount(Number(product.selling_price))}</td>
              </tr>)}
          </tbody>
        </table>
      </div>
      {canWrite && <section>
        <h3 className="flex flex-wrap items-baseline justify-between gap-2 text-sm font-bold text-slate-950">Dernières livraisons{entries.length > 0 && <span className="text-xs font-normal text-slate-500">{entries.length} livraison(s) · {formatAmount(purchased)} HTG au prix d’achat</span>}</h3>
        <div className="mt-2 overflow-x-auto rounded-lg border border-slate-200">
          <table className="ui-table text-sm">
            <thead><tr><th>Date</th><th>Produit</th><th className="text-right">Quantité</th><th className="text-right">Prix unitaire</th><th className="text-right">Montant</th></tr></thead>
            <tbody>
              {deliveries === null ? <TableRowsSkeleton rows={3} cols={5} /> : deliveries.length === 0 ? <tr><td colSpan={5} className="ui-empty py-6">Aucune entrée de stock enregistrée avec ce fournisseur.</td></tr>
                : deliveries.map((delivery) => {
                  const sign = delivery.movement_type === 'supplier_return' ? -1 : 1
                  return <tr key={delivery.id}>
                    <td className="whitespace-nowrap tabular-nums">{formatDateTime(delivery.movement_at)}</td>
                    <td>{delivery.product?.name ?? '—'}{sign < 0 && <span className="ml-2 text-xs font-medium text-red-700">Retour</span>}</td>
                    <td className="whitespace-nowrap text-right tabular-nums">{sign < 0 ? '−' : ''}{Number(delivery.quantity)} {delivery.product?.unit}</td>
                    <td className="text-right tabular-nums">{delivery.purchase_price === null ? '—' : formatAmount(Number(delivery.purchase_price))}</td>
                    <td className="text-right tabular-nums">{delivery.purchase_price === null ? '—' : formatAmount(sign * Number(delivery.quantity) * Number(delivery.purchase_price))}</td>
                  </tr>
                })}
            </tbody>
          </table>
        </div>
      </section>}
    </div>}
  </Modal>
}

export function SuppliersPage() {
  const { can } = useAuth()
  const canWrite = can('catalog.manage')
  const [rows, setRows] = useState<Supplier[]>([])
  const [categories, setCategories] = useState<CatalogListItem[]>([])
  const [search, setSearch] = useState('')
  const [categoryId, setCategoryId] = useState('')
  const [status, setStatus] = useState<'active' | 'inactive' | 'all'>('active')
  const [page, setPage] = useState(0)
  const [count, setCount] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [editing, setEditing] = useState<Supplier | null | undefined>(undefined)
  const [viewing, setViewing] = useState<Supplier | null>(null)
  const [managingCategories, setManagingCategories] = useState(false)
  const [importing, setImporting] = useState(false)
  const [refresh, setRefresh] = useState(0)

  useEffect(() => {
    void catalogListService.list('supplier_categories').then(({ data }) => setCategories(data ?? []))
  }, [refresh])
  useEffect(() => {
    setLoading(true)
    void supplierService.getSuppliers(page, search, status, categoryId).then(({ data, error: requestError, count: total }) => {
      setLoading(false)
      if (requestError) return setError(errorText(requestError))
      setRows((data ?? []) as unknown as Supplier[]); setCount(total ?? 0)
    })
  }, [page, search, status, categoryId, refresh])

  const done = (message: string) => { setNotice(message); setError(null); setEditing(undefined); setRefresh((value) => value + 1) }
  const setActive = async (supplier: Supplier, active: boolean) => {
    if (!active && !confirm(`Désactiver ${supplier.name} ? Son historique est conservé.`)) return
    const { error: requestError } = active ? await supplierService.activateSupplier(supplier.id) : await supplierService.deactivateSupplier(supplier.id)
    if (requestError) return setError(errorText(requestError))
    done(active ? `Fournisseur « ${supplier.name} » réactivé.` : `Fournisseur « ${supplier.name} » désactivé.`)
  }

  return <section>
    <PageHeader title="Fournisseurs" description="Fournisseurs par catégorie, avec les produits qu’ils livrent."
      actions={canWrite && <div className="flex flex-wrap gap-2">
        <button type="button" onClick={() => setManagingCategories(true)} className="ui-button-secondary"><Tags className="h-4 w-4" aria-hidden="true" />Catégories</button>
        <button type="button" onClick={() => setImporting(true)} className="ui-button-secondary"><FileSpreadsheet className="h-4 w-4" aria-hidden="true" />Importer</button>
        <button type="button" onClick={() => setEditing(null)} className="ui-button-primary"><Plus className="h-4 w-4" aria-hidden="true" />Ajouter un fournisseur</button>
      </div>} />
    {notice && <p role="status" className="ui-alert-success">{notice}</p>}
    {error && <p role="alert" className="ui-alert-error">{error}</p>}
    <div className="ui-card mt-6 flex flex-wrap gap-3 p-4">
      <input value={search} onChange={(event) => { setSearch(event.target.value); setPage(0) }} placeholder="Nom, entreprise, téléphone, e-mail" aria-label="Rechercher" className="min-w-56 flex-1" />
      <select value={categoryId} onChange={(event) => { setCategoryId(event.target.value); setPage(0) }} aria-label="Catégorie"><option value="">Toutes les catégories</option>{categories.map((category) => <option key={category.id} value={category.id}>{category.name}{category.active ? '' : ' (inactive)'}</option>)}</select>
      <select value={status} onChange={(event) => { setStatus(event.target.value as typeof status); setPage(0) }} aria-label="Statut"><option value="active">Actifs</option><option value="inactive">Inactifs</option><option value="all">Tous</option></select>
    </div>
    <div className="ui-card mt-6 overflow-x-auto">
      <table className="ui-table text-sm">
        <thead><tr><th>Nom</th><th>Catégorie</th><th>Téléphone</th><th>E-mail</th><th>Statut</th><th className="text-right">Actions</th></tr></thead>
        <tbody>
          {loading ? <TableRowsSkeleton cols={6} /> : rows.length === 0 ? <tr><td colSpan={6} className="ui-empty">Aucun fournisseur trouvé.</td></tr>
            : rows.map((supplier) => <tr key={supplier.id} className={supplier.active ? '' : 'text-slate-400'}>
              <td><button type="button" onClick={() => setViewing(supplier)} className="text-left font-medium text-slate-900 hover:text-brand-700 hover:underline">{supplier.name}</button>{supplier.company_name && <span className="block text-xs text-slate-500">{supplier.company_name}</span>}</td>
              <td>{supplier.category?.name ?? <span className="text-slate-400">Non classé</span>}</td>
              <td className="whitespace-nowrap">{supplier.phone ?? '—'}</td>
              <td>{supplier.email ?? '—'}</td>
              <td>{supplier.active ? 'Actif' : 'Inactif'}</td>
              <td><span className="flex justify-end gap-1">
                <button type="button" onClick={() => setViewing(supplier)} title="Voir la fiche et les produits" className="rounded p-1.5 text-slate-500 hover:bg-slate-100 hover:text-brand-700"><Eye className="h-4 w-4" aria-label="Voir" /></button>
                {canWrite && <button type="button" onClick={() => setEditing(supplier)} title="Modifier" className="rounded p-1.5 text-slate-500 hover:bg-slate-100 hover:text-brand-700"><Pencil className="h-4 w-4" aria-label="Modifier" /></button>}
                {canWrite && (supplier.active
                  ? <button type="button" onClick={() => void setActive(supplier, false)} title="Désactiver" className="rounded p-1.5 text-slate-500 hover:bg-red-50 hover:text-red-700"><Ban className="h-4 w-4" aria-label="Désactiver" /></button>
                  : <button type="button" onClick={() => void setActive(supplier, true)} title="Réactiver" className="rounded p-1.5 text-slate-500 hover:bg-emerald-50 hover:text-emerald-700"><RotateCcw className="h-4 w-4" aria-label="Réactiver" /></button>)}
              </span></td>
            </tr>)}
        </tbody>
      </table>
    </div>
    <div className="mt-4 flex items-center justify-between text-sm">
      <span className="text-slate-600">{count} fournisseur(s)</span>
      <span className="flex gap-2">
        <button type="button" disabled={!page} onClick={() => setPage((value) => value - 1)} className="ui-button-secondary px-3 py-1.5"><ChevronLeft className="h-4 w-4" aria-hidden="true" />Précédent</button>
        <button type="button" disabled={(page + 1) * 20 >= count} onClick={() => setPage((value) => value + 1)} className="ui-button-secondary px-3 py-1.5">Suivant<ChevronRight className="h-4 w-4" aria-hidden="true" /></button>
      </span>
    </div>
    {editing !== undefined && <SupplierFormDialog supplier={editing} categories={categories} onClose={() => setEditing(undefined)} onSaved={done} />}
    {viewing && <SupplierDetailDialog supplier={viewing} canWrite={canWrite} onClose={() => setViewing(null)} onEdit={() => { setEditing(viewing); setViewing(null) }} />}
    {managingCategories && <CatalogListDialog list="supplier_categories" canWrite={canWrite} onClose={() => setManagingCategories(false)} onChanged={() => setRefresh((value) => value + 1)} />}
    {importing && <ImportDialog importer={supplierImporter} onClose={() => setImporting(false)} onDone={(imported) => done(`${imported} fournisseur(s) importé(s).`)} />}
  </section>
}
