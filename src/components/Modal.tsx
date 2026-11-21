import { useEffect, useRef, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { X } from 'lucide-react'

/**
 * Accessible dialog: Escape and backdrop close it unless `locked` (e.g. while saving).
 * Rendered into <body> so that no animated or positioned parent can place it under the sidebar.
 */
export function Modal({ title, subtitle, onClose, children, footer, size = 'md', locked = false }: {
  title: string; subtitle?: string; onClose: () => void; children: ReactNode; footer?: ReactNode; size?: 'sm' | 'md' | 'lg' | 'xl'; locked?: boolean
}) {
  const dialog = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null
    dialog.current?.focus()
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape' && !locked) onClose() }
    document.addEventListener('keydown', onKey)
    return () => { document.removeEventListener('keydown', onKey); previous?.focus?.() }
  }, [onClose, locked])
  const width = { sm: 'max-w-md', md: 'max-w-2xl', lg: 'max-w-4xl', xl: 'max-w-6xl' }[size]
  return createPortal(<div className="no-print fixed inset-0 z-50 flex items-end justify-center bg-slate-950/40 sm:items-center sm:p-4" onMouseDown={(event) => { if (event.target === event.currentTarget && !locked) onClose() }}>
    <div ref={dialog} tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby="modal-title" className={`flex max-h-[94vh] w-full ${width} flex-col overflow-hidden rounded-t-2xl bg-white shadow-2xl outline-none sm:rounded-2xl animate-fade-up`}>
      <header className="flex items-start justify-between gap-4 border-b border-slate-200 px-5 py-4 sm:px-6">
        <div className="min-w-0"><h2 id="modal-title" className="text-base font-bold text-slate-950">{title}</h2>{subtitle && <p className="mt-0.5 text-xs text-slate-500">{subtitle}</p>}</div>
        {!locked && <button type="button" onClick={onClose} aria-label="Fermer" className="rounded-md p-1.5 text-slate-500 hover:bg-slate-100"><X className="h-5 w-5" aria-hidden="true" /></button>}
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto px-5 py-5 sm:px-6">{children}</div>
      {footer && <footer className="flex flex-wrap items-center justify-end gap-3 border-t border-slate-200 bg-slate-50 px-5 py-3.5 sm:px-6">{footer}</footer>}
    </div>
  </div>, document.body)
}
