import type { CSSProperties } from 'react'

// Shimmer placeholders that keep the final layout while data is loading.
export function Skeleton({ className = '', style }: { className?: string; style?: CSSProperties }) {
  return <span aria-hidden="true" style={style} className={`shimmer block ${className}`} />
}

const widths = ['w-3/4', 'w-1/2', 'w-2/3', 'w-5/6', 'w-2/5']

/** Rows to place inside an existing `<tbody>`. */
export function TableRowsSkeleton({ rows = 6, cols }: { rows?: number; cols: number }) {
  return <>
    {Array.from({ length: rows }, (_, row) => <tr key={row} aria-hidden="true" className="border-t border-slate-100">
      {Array.from({ length: cols }, (_, col) => <td key={col} className="px-4 py-3.5"><Skeleton className={`h-3.5 ${widths[(row + col) % widths.length]}`} /></td>)}
    </tr>)}
  </>
}

/** A standalone table card with header and rows. */
export function TableSkeleton({ rows = 6, cols = 5, className = 'mt-6' }: { rows?: number; cols?: number; className?: string }) {
  return <div role="status" aria-label="Chargement" className={`ui-card overflow-hidden ${className}`}>
    <div className="flex gap-6 border-b border-slate-100 bg-slate-50/80 px-4 py-3.5">{Array.from({ length: cols }, (_, col) => <Skeleton key={col} className="h-3 flex-1" />)}</div>
    <table className="ui-table"><tbody><TableRowsSkeleton rows={rows} cols={cols} /></tbody></table>
  </div>
}

export function CardsSkeleton({ count = 4, className = 'mt-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4' }: { count?: number; className?: string }) {
  return <div role="status" aria-label="Chargement" className={className}>
    {Array.from({ length: count }, (_, index) => <div key={index} className="ui-card p-5">
      <Skeleton className="h-3.5 w-1/2" /><Skeleton className="mt-4 h-8 w-2/3" /><Skeleton className="mt-3 h-3 w-5/6" />
    </div>)}
  </div>
}

/** Generic page body: summary cards followed by a table. */
export function PageSkeleton({ cards = 3, rows = 6, cols = 5 }: { cards?: number; rows?: number; cols?: number }) {
  return <div role="status" aria-label="Chargement">
    {cards > 0 && <CardsSkeleton count={cards} className={`mt-6 grid gap-4 sm:grid-cols-2 ${cards >= 4 ? 'xl:grid-cols-4' : 'lg:grid-cols-3'}`} />}
    <TableSkeleton rows={rows} cols={cols} />
  </div>
}

/** Sidebar and page outline shown while the session and profile load. */
export function AppShellSkeleton({ label }: { label: string }) {
  return <div role="status" aria-label={label} className="min-h-screen bg-slate-50 lg:grid lg:grid-cols-[16.5rem_minmax(0,1fr)]">
    <aside className="hidden h-screen flex-col gap-2 bg-brand-950 px-5 py-6 lg:flex">
      <div className="flex items-center gap-3"><span className="shimmer-dark h-9 w-9" /><span className="shimmer-dark h-4 w-28" /></div>
      <div className="mt-8 space-y-3.5">{Array.from({ length: 10 }, (_, index) => <span key={index} className={`shimmer-dark block h-4 ${widths[index % widths.length]}`} />)}</div>
    </aside>
    <main className="px-4 py-6 sm:px-6 lg:px-9 lg:py-8">
      <Skeleton className="h-3 w-40" /><Skeleton className="mt-3 h-8 w-64" /><Skeleton className="mt-3 h-3.5 w-96 max-w-full" />
      <PageSkeleton cards={4} />
      <span className="sr-only">{label}</span>
    </main>
  </div>
}
