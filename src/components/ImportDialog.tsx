import { useEffect, useMemo, useRef, useState, type DragEvent } from 'react'
import { AlertTriangle, ArrowLeft, Ban, CheckCircle2, Download, FileSpreadsheet, Upload, X } from 'lucide-react'
import { ACCEPTED_FILES, downloadTemplate, normalizeHeader, parseDate, parseNumber, readSpreadsheet, type SheetCell, type SheetData } from '../lib/spreadsheet'
import { useSyncStatus } from '../lib/offline/status'

export type ImportField = {
  key: string
  label: string
  required?: boolean
  type?: 'text' | 'number' | 'date' | 'email' | 'choice'
  /** Other header spellings recognised automatically (French, Creole, English). */
  aliases?: string[]
  /** For `choice`: accepted spellings (normalised) mapped to stored values. */
  choices?: Record<string, string>
  example: SheetCell
}
export type ImportRow = Record<string, string | number | null>

export type Importer<Ctx> = {
  title: string
  /** Plural noun used in messages, e.g. "produits". */
  entity: string
  templateName: string
  fields: ImportField[]
  prepare: () => Promise<Ctx>
  /** Returns a reason to skip the row (duplicate…); `seen` holds keys already used in this file. */
  check?: (row: ImportRow, ctx: Ctx, seen: Set<string>) => string | null
  save: (row: ImportRow, ctx: Ctx) => Promise<void>
}

type Evaluated = { line: number; row: ImportRow; status: 'ok' | 'error' | 'skip'; message: string | null }
type Step = 'file' | 'map' | 'importing' | 'done'

function convert(field: ImportField, cell: SheetCell): { value: string | number | null; error: string | null } {
  const empty = cell === null || String(cell).trim() === ''
  if (empty) return { value: null, error: field.required ? `${field.label} manquant` : null }
  switch (field.type) {
    case 'number': {
      const value = parseNumber(cell)
      if (value === null) return { value: null, error: `${field.label} : nombre invalide « ${String(cell)} »` }
      if (value < 0) return { value: null, error: `${field.label} ne peut pas être négatif` }
      return { value, error: null }
    }
    case 'date': {
      const value = parseDate(cell)
      return value ? { value, error: null } : { value: null, error: `${field.label} : date invalide « ${String(cell)} »` }
    }
    case 'email': {
      const value = String(cell).trim()
      return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value) ? { value, error: null } : { value: null, error: `${field.label} invalide « ${value} »` }
    }
    case 'choice': {
      const value = field.choices?.[normalizeHeader(String(cell))]
      return value ? { value, error: null } : { value: null, error: `${field.label} : valeur inconnue « ${String(cell)} »` }
    }
    default:
      return { value: String(cell instanceof Date ? parseDate(cell) : cell).trim(), error: null }
  }
}

/** Guesses which file column feeds each field from its header. */
function autoMap(fields: ImportField[], headers: string[]) {
  const normalized = headers.map(normalizeHeader)
  const mapping: Record<string, number> = {}
  for (const field of fields) {
    const names = [field.key, field.label, ...(field.aliases ?? [])].map((name) => normalizeHeader(name.replace(/\*/g, '')))
    const index = normalized.findIndex((header, column) => names.includes(header) && !Object.values(mapping).includes(column))
    if (index >= 0) mapping[field.key] = index
  }
  return mapping
}

export function ImportDialog<Ctx>({ importer, onClose, onDone }: { importer: Importer<Ctx>; onClose: () => void; onDone: (imported: number) => void }) {
  const { online } = useSyncStatus()
  const [step, setStep] = useState<Step>('file')
  const [sheet, setSheet] = useState<SheetData | null>(null)
  const [fileName, setFileName] = useState('')
  const [mapping, setMapping] = useState<Record<string, number>>({})
  // Wrapped so that an importer whose context is legitimately null still counts as prepared.
  const [prepared, setPrepared] = useState<{ ctx: Ctx } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [dragging, setDragging] = useState(false)
  const [progress, setProgress] = useState(0)
  const [result, setResult] = useState<{ imported: number; failures: { line: number; message: string }[]; skipped: number }>({ imported: 0, failures: [], skipped: 0 })
  const input = useRef<HTMLInputElement>(null)
  const dialog = useRef<HTMLDivElement>(null)

  useEffect(() => {
    dialog.current?.focus()
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape' && step !== 'importing') onClose() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [step, onClose])

  const evaluated = useMemo<Evaluated[]>(() => {
    if (!sheet || !prepared) return []
    const { ctx } = prepared
    const seen = new Set<string>()
    return sheet.rows.map((cells, index) => {
      const row: ImportRow = {}
      const errors: string[] = []
      for (const field of importer.fields) {
        const column = mapping[field.key]
        const { value, error: fieldError } = convert(field, column === undefined ? null : cells[column] ?? null)
        row[field.key] = value
        if (fieldError) errors.push(fieldError)
      }
      if (errors.length) return { line: index + 2, row, status: 'error', message: errors.join(' · ') }
      const skip = importer.check?.(row, ctx, seen) ?? null
      return { line: index + 2, row, status: skip ? 'skip' : 'ok', message: skip }
    })
  }, [sheet, prepared, mapping, importer])

  const ready = evaluated.filter((item) => item.status === 'ok')
  const invalid = evaluated.filter((item) => item.status === 'error')
  const skipped = evaluated.filter((item) => item.status === 'skip')
  const missingRequired = importer.fields.filter((field) => field.required && mapping[field.key] === undefined)
  // Problem rows first, so that what needs attention is visible without scrolling.
  const preview = [...invalid, ...skipped, ...ready].slice(0, 12)

  const openFile = async (file: File | undefined) => {
    if (!file) return
    setBusy(true); setError(null)
    try {
      const [data, context] = await Promise.all([readSpreadsheet(file), prepared ? Promise.resolve(prepared.ctx) : importer.prepare()])
      if (!data.rows.length) throw new Error('Aucune ligne de données sous l’en-tête.')
      setSheet(data); setPrepared({ ctx: context }); setFileName(file.name)
      setMapping(autoMap(importer.fields, data.headers))
      setStep('map')
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Lecture du fichier impossible.')
    } finally { setBusy(false) }
  }

  const runImport = async () => {
    if (!prepared) return
    const { ctx } = prepared
    setStep('importing'); setProgress(0)
    const failures: { line: number; message: string }[] = []
    let imported = 0
    for (const [index, item] of ready.entries()) {
      try { await importer.save(item.row, ctx); imported += 1 }
      catch (cause) { failures.push({ line: item.line, message: cause instanceof Error ? cause.message : String((cause as { message?: unknown })?.message ?? 'Erreur') }) }
      setProgress(index + 1)
    }
    setResult({ imported, failures: [...invalid.map((item) => ({ line: item.line, message: item.message ?? '' })), ...failures], skipped: skipped.length })
    setStep('done')
  }

  const onDrop = (event: DragEvent) => { event.preventDefault(); setDragging(false); void openFile(event.dataTransfer.files[0]) }
  const finish = () => { if (result.imported) onDone(result.imported); onClose() }

  return <div className="fixed inset-0 z-50 flex items-end justify-center bg-slate-950/40 p-0 sm:items-center sm:p-4" onMouseDown={(event) => { if (event.target === event.currentTarget && step !== 'importing') onClose() }}>
    <div ref={dialog} tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby="import-title" className="flex max-h-[92vh] w-full max-w-4xl flex-col overflow-hidden rounded-t-2xl bg-white shadow-2xl outline-none sm:rounded-2xl animate-fade-up">
      <header className="flex items-start justify-between gap-4 border-b border-slate-200 px-5 py-4 sm:px-6">
        <div className="flex items-center gap-3">
          <span className="grid h-10 w-10 place-items-center rounded-lg bg-brand-100 text-brand-700"><FileSpreadsheet className="h-5 w-5" aria-hidden="true" /></span>
          <div><h2 id="import-title" className="text-base font-bold text-slate-950">{importer.title}</h2><p className="text-xs text-slate-500">{step === 'file' ? 'Fichier Excel (.xlsx, .xls), CSV ou OpenDocument' : fileName}</p></div>
        </div>
        {step !== 'importing' && <button type="button" onClick={onClose} aria-label="Fermer" className="rounded-md p-1.5 text-slate-500 hover:bg-slate-100"><X className="h-5 w-5" aria-hidden="true" /></button>}
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto px-5 py-5 sm:px-6">
        {error && <p role="alert" className="ui-alert-error mt-0 mb-4">{error}</p>}
        {!online && step !== 'done' && <p className="mb-4 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">Hors ligne : les lignes importées seront enregistrées sur cet appareil puis envoyées à la prochaine synchronisation.</p>}

        {step === 'file' && <>
          <div onDragOver={(event) => { event.preventDefault(); setDragging(true) }} onDragLeave={() => setDragging(false)} onDrop={onDrop}
            className={`grid place-items-center rounded-xl border-2 border-dashed px-6 py-12 text-center transition ${dragging ? 'border-brand-600 bg-brand-100/50' : 'border-slate-300 bg-slate-50'}`}>
            <Upload className="h-8 w-8 text-slate-400" aria-hidden="true" />
            <p className="mt-3 text-sm font-semibold text-slate-800">Glissez votre fichier ici</p>
            <p className="mt-1 text-xs text-slate-500">ou</p>
            <button type="button" onClick={() => input.current?.click()} disabled={busy} className="ui-button-primary mt-3">{busy ? 'Lecture du fichier…' : 'Choisir un fichier'}</button>
            <input ref={input} type="file" accept={ACCEPTED_FILES} className="sr-only" onChange={(event) => { void openFile(event.target.files?.[0]); event.target.value = '' }} />
          </div>
          <div className="mt-5 flex flex-wrap items-start justify-between gap-4">
            <div>
              <p className="text-sm font-semibold text-slate-800">Colonnes reconnues</p>
              <p className="mt-1 max-w-xl text-xs leading-5 text-slate-500">La première ligne doit contenir les en-têtes. Les colonnes sont associées automatiquement et peuvent être corrigées à l’étape suivante. <span className="font-semibold text-slate-700">*</span> = obligatoire.</p>
              <div className="mt-2 flex flex-wrap gap-1.5">{importer.fields.map((field) => <span key={field.key} className={`ui-badge ${field.required ? 'ui-badge-success' : 'ui-badge-neutral'}`}>{field.label}{field.required ? ' *' : ''}</span>)}</div>
            </div>
            <button type="button" onClick={() => void downloadTemplate(importer.templateName, importer.fields.map((field) => field.label + (field.required ? ' *' : '')), importer.fields.map((field) => field.example))} className="ui-button-secondary">
              <Download className="h-4 w-4" aria-hidden="true" />Télécharger le modèle
            </button>
          </div>
        </>}

        {step === 'map' && sheet && <>
          <h3 className="text-sm font-semibold text-slate-800">Association des colonnes</h3>
          <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {importer.fields.map((field) => <label key={field.key} className="text-xs font-medium text-slate-600">
              {field.label}{field.required && <span className="text-red-600"> *</span>}
              <select value={mapping[field.key] ?? ''} onChange={(event) => setMapping((current) => { const next = { ...current }; if (event.target.value === '') delete next[field.key]; else next[field.key] = Number(event.target.value); return next })}
                className={`mt-1 w-full ${field.required && mapping[field.key] === undefined ? 'border-red-300' : ''}`}>
                <option value="">— Ignorer —</option>
                {sheet.headers.map((header, index) => <option key={index} value={index}>{header}</option>)}
              </select>
            </label>)}
          </div>

          <div className="mt-5 grid gap-3 sm:grid-cols-3">
            <p className="flex items-center gap-2 rounded-lg bg-emerald-50 px-3 py-2.5 text-sm text-emerald-900"><CheckCircle2 className="h-4 w-4" aria-hidden="true" /><strong>{ready.length}</strong> prête(s)</p>
            <p className="flex items-center gap-2 rounded-lg bg-red-50 px-3 py-2.5 text-sm text-red-900"><AlertTriangle className="h-4 w-4" aria-hidden="true" /><strong>{invalid.length}</strong> en erreur</p>
            <p className="flex items-center gap-2 rounded-lg bg-slate-100 px-3 py-2.5 text-sm text-slate-700"><Ban className="h-4 w-4" aria-hidden="true" /><strong>{skipped.length}</strong> ignorée(s)</p>
          </div>
          {missingRequired.length > 0 && <p className="mt-3 text-sm text-red-700">Associez une colonne à : {missingRequired.map((field) => field.label).join(', ')}.</p>}

          <div className="mt-4 overflow-x-auto rounded-lg border border-slate-200">
            <table className="ui-table text-xs">
              <thead><tr><th>Ligne</th><th>Statut</th>{importer.fields.filter((field) => mapping[field.key] !== undefined).slice(0, 5).map((field) => <th key={field.key}>{field.label}</th>)}</tr></thead>
              <tbody>{preview.map((item) => <tr key={item.line}>
                <td className="tabular-nums text-slate-500">{item.line}</td>
                <td className="max-w-xs">{item.status === 'ok' ? <span className="ui-badge ui-badge-success">Prête</span> : <span className={`ui-badge ${item.status === 'error' ? 'ui-badge-danger' : 'ui-badge-neutral'}`} title={item.message ?? ''}>{item.message}</span>}</td>
                {importer.fields.filter((field) => mapping[field.key] !== undefined).slice(0, 5).map((field) => <td key={field.key} className="max-w-[12rem] truncate">{item.row[field.key] ?? '—'}</td>)}
              </tr>)}</tbody>
            </table>
          </div>
          {evaluated.length > preview.length && <p className="mt-2 text-xs text-slate-500">Aperçu de {preview.length} lignes sur {evaluated.length}.</p>}
        </>}

        {step === 'importing' && <div className="py-10 text-center" role="status">
          <p className="text-sm font-semibold text-slate-800">Import en cours… {progress} / {ready.length}</p>
          <div className="mx-auto mt-4 h-2.5 max-w-md overflow-hidden rounded-full bg-slate-100"><div className="h-full rounded-full bg-brand-700 transition-[width]" style={{ width: `${ready.length ? (progress / ready.length) * 100 : 0}%` }} /></div>
          <p className="mt-3 text-xs text-slate-500">Gardez cette fenêtre ouverte jusqu’à la fin.</p>
        </div>}

        {step === 'done' && <div className="py-4">
          <div className="flex items-center gap-3"><CheckCircle2 className="h-8 w-8 text-emerald-600" aria-hidden="true" /><div><p className="text-base font-bold text-slate-950">{result.imported} {importer.entity} importé(s)</p><p className="text-sm text-slate-600">{result.skipped} ignoré(s) · {result.failures.length} non importé(s){!online && result.imported ? ' · en attente de synchronisation' : ''}</p></div></div>
          {result.failures.length > 0 && <ul className="mt-4 max-h-64 space-y-1 overflow-y-auto rounded-lg border border-red-200 bg-red-50 p-3 text-xs text-red-900">
            {result.failures.map((failure) => <li key={`${failure.line}-${failure.message}`}><strong>Ligne {failure.line}</strong> : {failure.message}</li>)}
          </ul>}
        </div>}
      </div>

      <footer className="flex flex-wrap justify-end gap-3 border-t border-slate-200 bg-slate-50 px-5 py-3.5 sm:px-6">
        {step === 'map' && <>
          <button type="button" onClick={() => { setStep('file'); setSheet(null) }} className="ui-button-secondary"><ArrowLeft className="h-4 w-4" aria-hidden="true" />Autre fichier</button>
          <button type="button" onClick={() => void runImport()} disabled={!ready.length || missingRequired.length > 0} className="ui-button-primary"><Upload className="h-4 w-4" aria-hidden="true" />Importer {ready.length} ligne(s)</button>
        </>}
        {step === 'done' && <button type="button" onClick={finish} className="ui-button-primary">Terminer</button>}
        {step === 'file' && <button type="button" onClick={onClose} className="ui-button-secondary">Annuler</button>}
      </footer>
    </div>
  </div>
}
