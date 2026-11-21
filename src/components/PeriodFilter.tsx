import { CalendarRange } from 'lucide-react'
import { monthToDate, periodError, yearToDate, type Period } from '../lib/period'

/** "Du / Au" filter shared by the accounting screens, with quick presets. */
export function PeriodFilter({ value, onChange, className = '' }: { value: Period; onChange: (period: Period) => void; className?: string }) {
  const error = periodError(value)
  const presets: [string, () => Period][] = [['Ce mois', monthToDate], ['Cette année', yearToDate]]
  return <div className={className}>
    <div className="flex flex-wrap items-end gap-3">
      <label className="text-xs font-medium text-slate-600">Du<input type="date" value={value.from} max={value.to || undefined} onChange={(event) => onChange({ ...value, from: event.target.value })} aria-invalid={Boolean(error)} className="mt-1 block" /></label>
      <label className="text-xs font-medium text-slate-600">Au<input type="date" value={value.to} min={value.from || undefined} onChange={(event) => onChange({ ...value, to: event.target.value })} aria-invalid={Boolean(error)} className="mt-1 block" /></label>
      <span className="flex gap-1.5 pb-0.5">{presets.map(([label, make]) => <button key={label} type="button" onClick={() => onChange(make())} className="rounded-md border border-slate-300 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50"><CalendarRange className="mr-1 inline h-3.5 w-3.5" aria-hidden="true" />{label}</button>)}</span>
    </div>
    {error && <p role="alert" className="mt-2 text-xs font-medium text-red-700">{error}</p>}
  </div>
}
