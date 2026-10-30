import { Ban, FileSpreadsheet, Pencil, Plus, RotateCcw, Save, X } from 'lucide-react'
import { ImportDialog } from '../components/ImportDialog'
import { categoryImporter } from '../services/importers'
import { TableRowsSkeleton } from '../components/Skeleton'
import { useEffect, useState, type FormEvent } from 'react'
import { categoryService } from '../services/categoryService'
import type { Category, CategoryInput } from '../types/catalog'
import { useAuth } from '../contexts/AuthContext'

const empty: CategoryInput = { name: '', description: null }

export function CategoriesPage() {
  const [importing, setImporting] = useState(false)

  const { profile } = useAuth()
  const canWrite = ['administrator', 'director', 'stock_manager'].includes(profile?.role?.code ?? '')
  const [rows, setRows] = useState<Category[]>([])
  const [search, setSearch] = useState('')
  const [includeInactive, setIncludeInactive] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [form, setForm] = useState<CategoryInput>(empty)
  const [editing, setEditing] = useState<string | null>(null)
  const [open, setOpen] = useState(false)

  const load = async () => {
    setLoading(true)
    const { data, error: requestError } = await categoryService.getCategories(search, includeInactive)
    setLoading(false)
    if (requestError) setError(requestError.message)
    else { setRows(data ?? []); setError(null) }
  }
  useEffect(() => { void load() }, [search, includeInactive])

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if (!form.name.trim()) return setError('Le nom est obligatoire.')
    const { error: requestError } = editing ? await categoryService.updateCategory(editing, form) : await categoryService.createCategory(form)
    if (requestError) return setError(requestError.message)
    setNotice(editing ? 'Catégorie modifiée.' : 'Catégorie créée.')
    setForm(empty); setEditing(null); setOpen(false); void load()
  }
  const setActive = async (category: Category, active: boolean) => {
    const action = active ? 'Réactiver' : 'Désactiver'
    if (!confirm(`${action} « ${category.name} » ? ${active ? '' : `Les ${category.product_count ?? 0} produit(s) associés conservent leur historique.`}`)) return
    const { error: requestError } = await categoryService.setCategoryActive(category.id, active)
    if (requestError) setError(requestError.message)
    else { setNotice(active ? 'Catégorie réactivée.' : 'Catégorie désactivée.'); void load() }
  }

  return <section>
    <div className="flex flex-wrap items-center justify-between gap-4">
      <div><h1 className="text-2xl font-bold">Catégories</h1><p className="mt-1 text-slate-600">Organisation du catalogue, avec archivage non destructif.</p></div>
      {canWrite && <div className="flex flex-wrap gap-2"><button type="button" onClick={() => setImporting(true)} className="ui-button-secondary"><FileSpreadsheet className="h-4 w-4" aria-hidden="true" />Importer</button><button onClick={() => { setForm(empty); setEditing(null); setOpen(true) }} className="ui-button-primary"><Plus className="h-4 w-4" aria-hidden="true" />Ajouter une catégorie</button></div>}
    </div>
    {notice && <p className="ui-alert-success">{notice}</p>}{error && <p className="ui-alert-error">{error}</p>}
    <div className="ui-filter-bar"><label className="flex-1"><span className="sr-only">Rechercher</span><input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Rechercher une catégorie" className="w-full" /></label><label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={includeInactive} onChange={(e) => setIncludeInactive(e.target.checked)} />Afficher les catégories inactives</label></div>
    {open && <form onSubmit={submit} className="mt-6 grid gap-3 rounded-xl bg-white p-5 shadow-sm ring-1 ring-slate-200"><h2 className="font-semibold">{editing ? 'Modifier la catégorie' : 'Nouvelle catégorie'}</h2><label className="text-sm font-medium">Nom <span className="text-red-700">*</span><input required value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} className="mt-1 w-full" /></label><label className="text-sm font-medium">Description <textarea value={form.description ?? ''} onChange={(e) => setForm((f) => ({ ...f, description: e.target.value || null }))} className="mt-1 w-full" /></label><div className="flex gap-3"><button className="ui-button-primary"><Save className="h-4 w-4" aria-hidden="true" />Enregistrer</button><button type="button" onClick={() => setOpen(false)} className="ui-button-secondary"><X className="h-4 w-4" aria-hidden="true" />Annuler</button></div></form>}
    <div className="mt-6 overflow-x-auto rounded-xl bg-white shadow-sm ring-1 ring-slate-200"><table className="w-full text-left text-sm"><thead className="bg-slate-50 text-slate-600"><tr><th className="p-3">Nom</th><th className="p-3">Description</th><th className="p-3">Produits</th><th className="p-3">Statut</th><th className="p-3">Actions</th></tr></thead><tbody>{loading ? <TableRowsSkeleton cols={5} /> : rows.length === 0 ? <tr><td className="p-6 text-center text-slate-500" colSpan={5}>Aucune catégorie trouvée.</td></tr> : rows.map((category) => <tr className="border-t" key={category.id}><td className="p-3 font-medium">{category.name}</td><td className="p-3">{category.description ?? '—'}</td><td className="p-3">{category.product_count ?? 0}</td><td className="p-3"><span className={`ui-badge ${category.active ? 'ui-badge-success' : 'ui-badge-neutral'}`}>{category.active ? 'Active' : 'Inactive'}</span></td><td className="p-3">{canWrite && <span className="flex gap-3"><button onClick={() => { setForm({ name: category.name, description: category.description }); setEditing(category.id); setOpen(true) }} className="inline-flex items-center gap-1.5 text-brand-700"><Pencil className="h-4 w-4" aria-hidden="true" />Modifier</button><button onClick={() => void setActive(category, !category.active)} className={`inline-flex items-center gap-1.5 ${category.active ? 'text-red-700' : 'text-emerald-700'}`}>{category.active ? <Ban className="h-4 w-4" aria-hidden="true" /> : <RotateCcw className="h-4 w-4" aria-hidden="true" />}{category.active ? 'Désactiver' : 'Réactiver'}</button></span>}</td></tr>)}</tbody></table></div>
  {importing && <ImportDialog importer={categoryImporter} onClose={() => setImporting(false)} onDone={(imported) => { setNotice(`${imported} catégorie(s) importé(s).`); void load() }} />}</section>
}
