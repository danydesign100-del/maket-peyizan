export type BarDatum = { key: string; label: string; value: number; detail?: string }

/**
 * Ranked horizontal bars with the value at each tip. Every value is printed,
 * so no tooltip or separate table is needed to read it.
 */
export function BarList({ data, formatValue, ariaLabel, empty = 'Aucune donnée' }: { data: BarDatum[]; formatValue: (value: number) => string; ariaLabel: string; empty?: string }) {
  const max = Math.max(0, ...data.map((item) => item.value))
  if (!data.length || max === 0) return <p className="ui-empty py-8">{empty}</p>
  return <ul aria-label={ariaLabel} className="space-y-3">
    {data.map((item) => <li key={item.key} className="group">
      <div className="flex items-baseline justify-between gap-3 text-sm">
        <span className="min-w-0 truncate font-medium text-slate-700" title={item.label}>{item.label}</span>
        <span className="shrink-0 tabular-nums text-slate-950"><strong className="font-semibold">{formatValue(item.value)}</strong>{item.detail && <span className="ml-1.5 text-xs text-slate-500">{item.detail}</span>}</span>
      </div>
      <div className="mt-1.5 h-2.5 rounded-full bg-slate-100">
        <div className="h-full rounded-r-[4px] rounded-l-full bg-brand-700 transition-[width,background-color] duration-700 group-hover:bg-brand-600" style={{ width: `${Math.max(1.5, (item.value / max) * 100)}%` }} />
      </div>
    </li>)}
  </ul>
}
