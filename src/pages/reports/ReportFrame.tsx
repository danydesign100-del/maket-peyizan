import { useRef, type ReactNode } from 'react'
import { Download, Printer } from 'lucide-react'
import { PrintHeader } from '../../components/PrintHeader'
import { printSection } from '../../lib/print'

/**
 * A report as shown on screen and printed: the same element is printed, so the
 * printed amounts are always those on screen.
 */
export function ReportFrame({ title, period, icon: Icon, subtitle, note, onExport, landscape = false, actions, children }: {
  title: string; period: string; icon: typeof Printer; subtitle?: string; note?: string; onExport?: () => void; landscape?: boolean; actions?: ReactNode; children: ReactNode
}) {
  const section = useRef<HTMLElement>(null)
  return <section ref={section} aria-label={title} className="ui-card overflow-hidden print:border-0 print:shadow-none">
    <PrintHeader title={title} period={period} note={note} />
    <div className="no-print flex flex-wrap items-end justify-between gap-3 border-b border-slate-200 px-5 py-4">
      <div><h2 className="flex items-center gap-2 text-base font-bold text-slate-950"><Icon className="h-5 w-5 text-brand-700" aria-hidden="true" />{title}</h2><p className="mt-0.5 text-sm text-slate-600">{period}{subtitle ? ` · ${subtitle}` : ''}</p></div>
      <div className="flex flex-wrap items-center gap-2">
        {actions}
        {onExport && <button type="button" onClick={onExport} className="ui-button-secondary px-3 py-2"><Download className="h-4 w-4" aria-hidden="true" />Excel</button>}
        <button type="button" onClick={() => printSection(section.current, { landscape })} className="ui-button-secondary px-3 py-2"><Printer className="h-4 w-4" aria-hidden="true" />Imprimer</button>
      </div>
    </div>
    {note && <p className="no-print border-b border-amber-200 bg-amber-50 px-5 py-2 text-xs text-amber-900">{note}</p>}
    {children}
  </section>
}
