import { useEffect, useState } from 'react'
import { Eye, Plus } from 'lucide-react'
import { PageHeader } from '../components/PageHeader'
import { TableRowsSkeleton } from '../components/Skeleton'
import { useAuth } from '../contexts/AuthContext'
import { errorText } from '../lib/errors'
import { formatDay } from '../lib/period'
import { PROFORMA_STATUS_LABELS, proformaService, type Proforma, type ProformaStatus } from '../services/proformaService'
import { ProformaDetail } from './proformas/ProformaDetail'
import { ProformaEditor } from './proformas/ProformaEditor'

const money = (value: number) => `${Number(value).toLocaleString('fr-HT', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} HTG`
const STATUS_TONE: Record<ProformaStatus, string> = { draft: 'ui-badge-neutral', sent: 'ui-badge-warning', accepted: 'ui-badge-success', cancelled: 'ui-badge-danger', expired: 'ui-badge-neutral', converted: 'ui-badge-success' }

export function ProformasPage() {
  const { can } = useAuth()
  const canEdit = can('proformas.manage')
  const canPrice = can('proformas.price')
  const [rows, setRows] = useState<Proforma[] | null>(null)
  const [search, setSearch] = useState('')
  const [status, setStatus] = useState<ProformaStatus | ''>('')
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [viewing, setViewing] = useState<string | null>(null)
  const [editing, setEditing] = useState<Proforma | null | undefined>(undefined)
  const [refresh, setRefresh] = useState(0)
  useEffect(() => {
    void proformaService.list().then(({ data, error: loadError }) => loadError ? setError(errorText(loadError)) : setRows(((data ?? []) as Proforma[]).map((row) => ({ ...row, items: row.items ?? [] }))))
  }, [refresh])
  const done = (message: string) => { setNotice(message); setError(null); setEditing(undefined); setRefresh((value) => value + 1) }
  const term = search.trim().toLowerCase()
  const visible = (rows ?? []).filter((row) => (!status || row.status === status) && (!term || row.proforma_number.toLowerCase().includes(term) || row.customer?.full_name.toLowerCase().includes(term)))
  const current = rows?.find((row) => row.id === viewing) ?? null

  return <section>
    <PageHeader title="Proformas" description="Devis clients : consultation, modification avec historique, impression et transformation en vente."
      actions={canEdit && <button type="button" onClick={() => setEditing(null)} className="ui-button-primary"><Plus className="h-4 w-4" aria-hidden="true" />Nouvelle proforma</button>} />
    {notice && <p role="status" className="ui-alert-success">{notice}</p>}
    {error && <p role="alert" className="ui-alert-error">{error}</p>}
    <div className="ui-card mt-6 flex flex-wrap gap-3 p-4">
      <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="N° de proforma ou client" aria-label="Rechercher" className="min-w-56 flex-1" />
      <select value={status} onChange={(event) => setStatus(event.target.value as ProformaStatus | '')} aria-label="Statut"><option value="">Tous les statuts</option>{(Object.keys(PROFORMA_STATUS_LABELS) as ProformaStatus[]).map((item) => <option key={item} value={item}>{PROFORMA_STATUS_LABELS[item]}</option>)}</select>
    </div>
    <div className="ui-card mt-6 overflow-x-auto">
      <table className="ui-table text-sm">
        <thead><tr><th>N°</th><th>Date</th><th>Client</th><th>Validité</th><th className="text-right">Total</th><th>Statut</th><th className="text-right"><span className="sr-only">Ouvrir</span></th></tr></thead>
        <tbody>
          {rows === null ? <TableRowsSkeleton cols={7} /> : visible.length === 0 ? <tr><td colSpan={7} className="ui-empty">Aucune proforma.</td></tr>
            : visible.map((row) => <tr key={row.id}>
              <td><button type="button" onClick={() => setViewing(row.id)} className="font-mono text-xs font-semibold text-brand-700 hover:underline">{row.proforma_number}</button></td>
              <td className="whitespace-nowrap">{formatDay(row.issue_date)}</td>
              <td>{row.customer?.full_name ?? <span className="text-slate-400">Sans client</span>}</td>
              <td className="whitespace-nowrap">{row.valid_until ? formatDay(row.valid_until) : '-'}</td>
              <td className="text-right font-semibold tabular-nums">{money(row.total_amount)}</td>
              <td><span className={`ui-badge ${STATUS_TONE[row.status]}`}>{PROFORMA_STATUS_LABELS[row.status]}</span></td>
              <td className="text-right"><button type="button" onClick={() => setViewing(row.id)} title="Ouvrir" className="rounded p-1.5 text-slate-500 hover:bg-slate-100 hover:text-brand-700"><Eye className="h-4 w-4" aria-label="Ouvrir" /></button></td>
            </tr>)}
        </tbody>
      </table>
    </div>
    {current && <ProformaDetail proforma={current} canEdit={canEdit} canSell={canEdit} onClose={() => setViewing(null)} onEdit={() => { setEditing(current); setViewing(null) }} onChanged={(message) => { done(message) }} />}
    {editing !== undefined && <ProformaEditor proforma={editing} canPrice={canPrice} onClose={() => setEditing(undefined)} onSaved={done} />}
  </section>
}
