import { useEffect, useId, useMemo, useRef, useState } from 'react'
import { Table2 } from 'lucide-react'

export type ColumnDatum = { key: string; label: string; value: number; detail?: string }

type Props = {
  data: ColumnDatum[]
  formatValue: (value: number) => string
  /** Short form for axis ticks, e.g. 12,5 k. */
  formatTick?: (value: number) => string
  height?: number
  /** Key of the column to emphasise (e.g. today); the others take a lighter step. */
  highlightKey?: string
  ariaLabel: string
}

const SERIES = '#25713e' // brand-700, validated against the white card surface
const SERIES_SOFT = '#8fbf9c'
const GRID = '#e2e8f0'
const AXIS = '#cbd5e1'
const INK_MUTED = '#64748b'

/** Rounds the axis maximum to 1, 2, 2.5 or 5 × 10ⁿ so ticks are clean numbers. */
function niceMax(max: number, ticks = 4) {
  if (max <= 0) return 1
  const raw = max / ticks
  const power = 10 ** Math.floor(Math.log10(raw))
  const step = [1, 2, 2.5, 5, 10].find((candidate) => candidate * power >= raw)! * power
  return step * ticks
}

const compact = new Intl.NumberFormat('fr-HT', { notation: 'compact', maximumFractionDigits: 1 })

/** Column with a 4px rounded data end and a square baseline. */
function columnPath(x: number, y: number, width: number, height: number) {
  const r = Math.min(4, width / 2, height)
  return `M${x},${y + height}V${y + r}Q${x},${y} ${x + r},${y}H${x + width - r}Q${x + width},${y} ${x + width},${y + r}V${y + height}Z`
}

export function ColumnChart({ data, formatValue, formatTick = (value) => compact.format(value), height = 220, highlightKey, ariaLabel }: Props) {
  const ref = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(0)
  const [active, setActive] = useState<number | null>(null)
  const [showTable, setShowTable] = useState(false)
  const tableId = useId()

  useEffect(() => {
    const element = ref.current
    if (!element) return
    const observer = new ResizeObserver(([entry]) => setWidth(entry.contentRect.width))
    observer.observe(element)
    return () => observer.disconnect()
  }, [])

  const max = useMemo(() => niceMax(Math.max(0, ...data.map((item) => item.value))), [data])
  const peak = data.reduce((best, item, index) => item.value > (data[best]?.value ?? -1) ? index : best, 0)
  const margin = { top: 22, right: 8, bottom: 26, left: 44 }
  const plotWidth = Math.max(0, width - margin.left - margin.right)
  const plotHeight = height - margin.top - margin.bottom
  const band = data.length ? plotWidth / data.length : 0
  const barWidth = Math.max(4, Math.min(24, band * 0.62))
  const labelEvery = Math.max(1, Math.ceil(46 / Math.max(band, 1)))
  const y = (value: number) => margin.top + plotHeight - (value / max) * plotHeight
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((ratio) => ratio * max)
  const current = active === null ? null : data[active]

  return <div>
    <div ref={ref} className="relative" onPointerLeave={() => setActive(null)}>
      {width > 0 && <svg width={width} height={height} role="img" aria-label={ariaLabel} aria-describedby={showTable ? tableId : undefined} className="block overflow-visible">
        {ticks.map((tick) => <g key={tick}>
          <line x1={margin.left} x2={width - margin.right} y1={y(tick)} y2={y(tick)} stroke={tick === 0 ? AXIS : GRID} strokeWidth={1} shapeRendering="crispEdges" />
          <text x={margin.left - 8} y={y(tick)} dy="0.32em" textAnchor="end" fontSize={11} fill={INK_MUTED} style={{ fontVariantNumeric: 'tabular-nums' }}>{formatTick(tick)}</text>
        </g>)}
        {data.map((item, index) => {
          const x = margin.left + index * band + (band - barWidth) / 2
          const top = y(item.value)
          const emphasised = !highlightKey || item.key === highlightKey || active === index
          return <g key={item.key} tabIndex={0} role="img" aria-label={`${item.label} : ${formatValue(item.value)}${item.detail ? `, ${item.detail}` : ''}`}
            onPointerEnter={() => setActive(index)} onFocus={() => setActive(index)} onBlur={() => setActive(null)} className="cursor-default outline-none">
            {/* The whole band is the hit target, not only the painted column. */}
            <rect x={margin.left + index * band} y={margin.top} width={band} height={plotHeight} fill="transparent" />
            {active === index && <rect x={margin.left + index * band + 1} y={margin.top} width={Math.max(0, band - 2)} height={plotHeight} rx={6} fill="#f1f5f9" />}
            {item.value > 0 && <path d={columnPath(x, top, barWidth, margin.top + plotHeight - top)} fill={emphasised ? SERIES : SERIES_SOFT} className="transition-[fill]" />}
            {index % labelEvery === (data.length - 1) % labelEvery && <text x={x + barWidth / 2} y={height - 8} textAnchor="middle" fontSize={11} fill={INK_MUTED}>{item.label}</text>}
            {index === peak && item.value > 0 && active === null && <text x={x + barWidth / 2} y={top - 7} textAnchor="middle" fontSize={11} fontWeight={600} fill="#334155">{formatTick(item.value)}</text>}
          </g>
        })}
      </svg>}
      {current && <div role="status" className="pointer-events-none absolute z-10 -translate-x-1/2 -translate-y-full rounded-lg bg-slate-950 px-3 py-2 text-xs text-white shadow-lg"
        style={{ left: Math.min(Math.max(margin.left + (active! + 0.5) * band, 70), width - 70), top: Math.max(y(current.value) - 8, 40) }}>
        <strong className="block text-sm tabular-nums">{formatValue(current.value)}</strong>
        <span className="block whitespace-nowrap text-white/70">{current.label}{current.detail ? ` · ${current.detail}` : ''}</span>
      </div>}
    </div>
    <button type="button" onClick={() => setShowTable((value) => !value)} aria-expanded={showTable} aria-controls={tableId} className="mt-2 inline-flex items-center gap-1.5 text-xs font-medium text-slate-500 hover:text-brand-700">
      <Table2 className="h-3.5 w-3.5" aria-hidden="true" />{showTable ? 'Masquer le tableau' : 'Voir le tableau'}
    </button>
    {showTable && <div id={tableId} className="mt-2 max-h-56 overflow-auto rounded-lg border border-slate-200">
      <table className="ui-table text-xs"><thead><tr><th>Période</th><th className="text-right">Valeur</th></tr></thead>
        <tbody>{data.map((item) => <tr key={item.key}><td>{item.label}{item.detail ? <span className="ml-2 text-slate-400">{item.detail}</span> : null}</td><td className="text-right tabular-nums">{formatValue(item.value)}</td></tr>)}</tbody>
      </table>
    </div>}
  </div>
}
