import { useState, type FormEvent } from 'react'
import { Save } from 'lucide-react'
import { Modal } from './Modal'

export type QuickField = {
  key: string
  label: string
  required?: boolean
  type?: 'text' | 'email' | 'tel' | 'select'
  options?: { value: string; label: string }[]
  placeholder?: string
}

/**
 * Small creation window opened from another form (« + Ajouter »): the caller
 * creates the record and selects it. `onSubmit` returns an error message, or null.
 */
export function QuickCreateDialog({ title, fields, initial = {}, onSubmit, onClose }: {
  title: string; fields: QuickField[]; initial?: Record<string, string>
  onSubmit: (values: Record<string, string>) => Promise<string | null>; onClose: () => void
}) {
  const [values, setValues] = useState<Record<string, string>>(() => Object.fromEntries(fields.map((field) => [field.key, initial[field.key] ?? (field.type === 'select' ? field.options?.[0]?.value ?? '' : '')])))
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const submit = async (event: FormEvent) => {
    event.preventDefault()
    event.stopPropagation()
    const missing = fields.find((field) => field.required && !values[field.key]?.trim())
    if (missing) return setError(`${missing.label} : champ obligatoire.`)
    setSaving(true); setError(null)
    const failure = await onSubmit(Object.fromEntries(Object.entries(values).map(([key, value]) => [key, value.trim()])))
    setSaving(false)
    if (failure) setError(failure)
  }
  return <Modal size="sm" title={title} onClose={onClose} locked={saving}
    footer={<><button type="button" onClick={onClose} className="ui-button-secondary">Annuler</button><button type="submit" form="quick-create-form" disabled={saving} className="ui-button-primary"><Save className="h-4 w-4" aria-hidden="true" />{saving ? 'Enregistrement…' : 'Enregistrer'}</button></>}>
    <form id="quick-create-form" onSubmit={submit} className="space-y-3">
      {error && <p role="alert" className="ui-alert-error mt-0">{error}</p>}
      {fields.map((field, index) => <label key={field.key} className="block text-sm font-medium text-slate-700">{field.label}{field.required ? ' *' : ''}
        {field.type === 'select'
          ? <select value={values[field.key]} onChange={(event) => setValues((current) => ({ ...current, [field.key]: event.target.value }))} className="mt-1 w-full">{field.options?.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select>
          : <input autoFocus={index === 0} type={field.type ?? 'text'} value={values[field.key]} placeholder={field.placeholder} onChange={(event) => setValues((current) => ({ ...current, [field.key]: event.target.value }))} className="mt-1 w-full" />}
      </label>)}
    </form>
  </Modal>
}
