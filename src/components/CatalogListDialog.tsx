import { useEffect, useState, type FormEvent } from 'react'
import { Ban, Check, Pencil, Plus, RotateCcw, X } from 'lucide-react'
import { Modal } from './Modal'
import { CATALOG_LISTS, catalogListService } from '../services/catalogListService'
import type { CatalogList, CatalogListItem } from '../types/catalog'

/** Add, rename, deactivate and reactivate the items of a short managed list. */
export function CatalogListDialog({ list, canWrite, onClose, onChanged }: { list: CatalogList; canWrite: boolean; onClose: () => void; onChanged?: () => void }) {
  const meta = CATALOG_LISTS[list]
  const [items, setItems] = useState<CatalogListItem[] | null>(null)
  const [name, setName] = useState('')
  const [editing, setEditing] = useState<{ id: string; name: string } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [refresh, setRefresh] = useState(0)

  useEffect(() => {
    void catalogListService.list(list).then(({ data, error: loadError }) => loadError ? setError(loadError.message) : setItems(data ?? []))
  }, [list, refresh])

  const run = async (action: () => Promise<{ error: Error | null }>) => {
    setSaving(true); setError(null)
    const { error: saveError } = await action()
    setSaving(false)
    if (saveError) return false
    setRefresh((value) => value + 1); onChanged?.()
    return true
  }
  const fail = (result: { error: Error | null }) => { if (result.error) setError(result.error.message); return result }
  const add = async (event: FormEvent) => {
    event.preventDefault()
    if (!name.trim()) return
    if (await run(async () => fail(await catalogListService.create(list, name)))) setName('')
  }
  const rename = async () => {
    if (!editing?.name.trim()) return
    if (await run(async () => fail(await catalogListService.update(list, editing.id, { name: editing.name })))) setEditing(null)
  }
  const toggle = (item: CatalogListItem) => void run(async () => fail(await catalogListService.update(list, item.id, { active: !item.active })))

  return <Modal size="sm" title={meta.title} subtitle={meta.hint} onClose={onClose} locked={saving}
    footer={<button type="button" onClick={onClose} className="ui-button-secondary">Fermer</button>}>
    {error && <p role="alert" className="ui-alert-error mt-0 mb-3">{error}</p>}
    {canWrite && <form onSubmit={add} className="mb-4 flex gap-2">
      <input value={name} onChange={(event) => setName(event.target.value)} placeholder={meta.placeholder} aria-label={`Nouvelle ${meta.item}`} maxLength={list === 'units' ? 40 : 80} className="min-w-0 flex-1" />
      <button type="submit" disabled={saving || !name.trim()} className="ui-button-primary px-3"><Plus className="h-4 w-4" aria-hidden="true" />Ajouter</button>
    </form>}
    <ul className="divide-y divide-slate-100 rounded-lg border border-slate-200">
      {items === null ? <li className="px-3 py-3 text-sm text-slate-500">Chargement…</li>
        : items.length === 0 ? <li className="px-3 py-3 text-sm text-slate-500">Aucun élément.</li>
        : items.map((item) => <li key={item.id} className="flex items-center gap-2 px-3 py-2 text-sm">
          {editing?.id === item.id
            ? <><input autoFocus value={editing.name} onChange={(event) => setEditing({ id: item.id, name: event.target.value })} onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); void rename() } if (event.key === 'Escape') { event.stopPropagation(); setEditing(null) } }} aria-label={`Renommer ${item.name}`} className="min-w-0 flex-1 py-1" />
              <button type="button" onClick={() => void rename()} title="Enregistrer" className="rounded p-1.5 text-emerald-700 hover:bg-emerald-50"><Check className="h-4 w-4" aria-label="Enregistrer" /></button>
              <button type="button" onClick={() => setEditing(null)} title="Annuler" className="rounded p-1.5 text-slate-500 hover:bg-slate-100"><X className="h-4 w-4" aria-label="Annuler" /></button></>
            : <><span className={`flex-1 ${item.active ? 'text-slate-900' : 'text-slate-400 line-through'}`}>{item.name}</span>
              {!item.active && <span className="text-xs text-slate-400">inactive</span>}
              {canWrite && <>
                <button type="button" onClick={() => setEditing({ id: item.id, name: item.name })} title="Renommer" className="rounded p-1.5 text-slate-500 hover:bg-slate-100 hover:text-brand-700"><Pencil className="h-4 w-4" aria-label="Renommer" /></button>
                <button type="button" onClick={() => toggle(item)} title={item.active ? 'Désactiver' : 'Réactiver'} className={`rounded p-1.5 ${item.active ? 'text-slate-500 hover:bg-red-50 hover:text-red-700' : 'text-slate-500 hover:bg-emerald-50 hover:text-emerald-700'}`}>{item.active ? <Ban className="h-4 w-4" aria-label="Désactiver" /> : <RotateCcw className="h-4 w-4" aria-label="Réactiver" />}</button>
              </>}</>}
        </li>)}
    </ul>
    {list === 'units' && <p className="mt-3 text-xs text-slate-500">Renommer une unité ne modifie pas les produits existants ; changez leur unité dans leur fiche.</p>}
  </Modal>
}
