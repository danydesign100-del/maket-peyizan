import { useEffect, useRef, useState } from 'react'
import { AlertTriangle, ChevronDown, Cloud, CloudOff, RefreshCw, Trash2, WifiOff } from 'lucide-react'
import { useSyncStatus } from '../lib/offline/status'
import type { OutboxOp } from '../lib/offline/outbox'
import { pendingSales, type OfflineSale } from '../services/offlineSales'
import { discardOperation, listOutbox, syncNow } from '../services/syncService'

const formatTime = (value: string | null) => value
  ? new Intl.DateTimeFormat('fr-HT', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(value))
  : 'jamais'

/** Connection state, pending changes and a manual "sync now" action. */
export function SyncButton({ tone = 'dark' }: { tone?: 'dark' | 'light' }) {
  const status = useSyncStatus()
  const [open, setOpen] = useState(false)
  const [ops, setOps] = useState<OutboxOp[]>([])
  const [sales, setSales] = useState<OfflineSale[]>([])
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    void Promise.all([listOutbox(), pendingSales()]).then(([nextOps, nextSales]) => { setOps(nextOps); setSales(nextSales) }).catch(() => undefined)
    const close = (event: MouseEvent) => { if (!ref.current?.contains(event.target as Node)) setOpen(false) }
    document.addEventListener('mousedown', close)
    return () => document.removeEventListener('mousedown', close)
  }, [open, status.pending, status.failed, status.syncing])

  const dark = tone === 'dark'
  const Icon = status.syncing ? RefreshCw : status.online ? Cloud : CloudOff
  const label = status.syncing ? 'Synchronisation…' : status.online ? 'En ligne' : 'Hors ligne'
  const dot = status.online ? 'bg-emerald-400' : 'bg-amber-400'

  return <div ref={ref} className="relative">
    <div className={`flex items-stretch overflow-hidden rounded-lg ${dark ? 'bg-white/[0.07] ring-1 ring-white/10' : 'border border-slate-300 bg-white shadow-sm'}`}>
      <button type="button" onClick={() => void syncNow()} disabled={status.syncing} title="Envoyer et recevoir les dernières données"
        className={`flex min-w-0 flex-1 items-center gap-2.5 px-3 py-2 text-left text-sm transition disabled:opacity-80 ${dark ? 'text-white/85 hover:bg-white/10' : 'text-slate-700 hover:bg-slate-50'}`}>
        <span className="relative grid h-5 w-5 shrink-0 place-items-center">
          <Icon className={`h-[18px] w-[18px] ${status.syncing ? 'animate-spin' : ''}`} aria-hidden="true" />
          <span className={`absolute -right-0.5 -top-0.5 h-2 w-2 rounded-full ${dot}`}>{!status.online && <span className={`absolute inset-0 rounded-full ${dot} animate-ping-soft`} />}</span>
        </span>
        <span className={`min-w-0 flex-1 leading-tight ${dark ? '' : 'sr-only min-[440px]:not-sr-only'}`}>
          <span className="block truncate font-semibold">{label}</span>
          {dark && <span className="block truncate text-[11px] text-white/50">{status.pending ? `${status.pending} en attente` : `Synchro : ${formatTime(status.lastSyncAt)}`}</span>}
        </span>
        {status.pending > 0 && <span className={`rounded-full px-1.5 text-[11px] font-bold ${status.failed ? 'bg-red-500 text-white' : 'bg-accent-500 text-brand-950'}`}>{status.pending}</span>}
      </button>
      <button type="button" aria-expanded={open} aria-label="Détails de la synchronisation" onClick={() => setOpen((value) => !value)}
        className={`px-2 transition ${dark ? 'border-l border-white/10 text-white/60 hover:bg-white/10 hover:text-white' : 'border-l border-slate-200 text-slate-500 hover:bg-slate-50'}`}>
        <ChevronDown className={`h-4 w-4 transition-transform ${open ? 'rotate-180' : ''}`} aria-hidden="true" />
      </button>
    </div>

    {open && <div className={`absolute z-40 w-80 max-w-[calc(100vw-2rem)] rounded-xl border border-slate-200 bg-white p-4 text-sm text-slate-700 shadow-xl ${dark ? 'bottom-full left-0 mb-2' : 'right-0 top-full mt-2'}`}>
      <p className="font-semibold text-slate-950">Synchronisation</p>
      <dl className="mt-2 space-y-1 text-xs text-slate-600">
        <div className="flex justify-between"><dt>Connexion</dt><dd className="font-medium">{status.online ? 'Disponible' : 'Indisponible'}</dd></div>
        <div className="flex justify-between"><dt>Dernière synchronisation</dt><dd className="font-medium">{formatTime(status.lastSyncAt)}</dd></div>
        <div className="flex justify-between"><dt>Modifications en attente</dt><dd className="font-medium">{ops.length}</dd></div>
        <div className="flex justify-between"><dt>Ventes en attente</dt><dd className="font-medium">{sales.length}</dd></div>
      </dl>
      {status.lastError && <p className="mt-3 rounded-md bg-amber-50 px-2.5 py-2 text-xs text-amber-800">{status.lastError}</p>}
      {(ops.length > 0 || sales.length > 0) && <ul className="mt-3 max-h-56 space-y-1.5 overflow-y-auto">
        {ops.map((op) => <li key={op.seq} className="flex items-start gap-2 rounded-md bg-slate-50 px-2.5 py-2 text-xs">
          {op.state === 'error' ? <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-red-600" aria-hidden="true" /> : <RefreshCw className="mt-0.5 h-3.5 w-3.5 shrink-0 text-slate-400" aria-hidden="true" />}
          <span className="min-w-0 flex-1"><span className="block font-medium text-slate-800">{op.label}</span>{op.lastError && <span className="block text-red-700">{op.lastError}</span>}</span>
          {op.state === 'error' && <button type="button" onClick={() => void discardOperation(op.seq!).then(() => setOps((rows) => rows.filter((row) => row.seq !== op.seq)))} aria-label={`Abandonner : ${op.label}`} className="text-slate-400 hover:text-red-600"><Trash2 className="h-3.5 w-3.5" aria-hidden="true" /></button>}
        </li>)}
        {sales.map((sale) => <li key={sale.id} className="flex items-start gap-2 rounded-md bg-slate-50 px-2.5 py-2 text-xs">
          {sale.state === 'sync_error' ? <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-red-600" aria-hidden="true" /> : <RefreshCw className="mt-0.5 h-3.5 w-3.5 shrink-0 text-slate-400" aria-hidden="true" />}
          <span className="min-w-0 flex-1"><span className="block font-medium text-slate-800">Vente du {formatTime(sale.createdAt)}</span>{sale.lastError && <span className="block text-red-700">{sale.lastError}</span>}</span>
        </li>)}
      </ul>}
      <button type="button" onClick={() => void syncNow()} disabled={status.syncing} className="ui-button-primary mt-4 w-full">
        <RefreshCw className={`h-4 w-4 ${status.syncing ? 'animate-spin' : ''}`} aria-hidden="true" />{status.syncing ? 'Synchronisation…' : 'Synchroniser maintenant'}
      </button>
    </div>}
  </div>
}

/** Explains offline mode at the top of every page. */
export function OfflineBanner() {
  const { online, cachedSince, pending } = useSyncStatus()
  if (online && !cachedSince) return null
  return <div role="status" className="no-print mb-5 flex items-start gap-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900 animate-fade-up">
    <WifiOff className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
    <p><strong className="font-semibold">Mode hors ligne.</strong> Vos opérations sont enregistrées sur cet appareil{pending ? ` (${pending} en attente)` : ''} et seront envoyées automatiquement au retour de la connexion.{cachedSince && <span className="block text-xs text-amber-800/80">Données affichées : copie locale du {formatTime(cachedSince)}.</span>}</p>
  </div>
}
