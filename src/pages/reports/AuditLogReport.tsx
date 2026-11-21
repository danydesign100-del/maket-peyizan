import { auditLabel } from '../../lib/auditLabels'
import { useEffect, useState } from 'react'
import { ShieldCheck } from 'lucide-react'
import { TableRowsSkeleton } from '../../components/Skeleton'
import { describePeriod, formatDateTime, type Period } from '../../lib/period'
import { accountingService } from '../../services/accountingService'
import { ReportFrame } from './ReportFrame'

type AuditRow = { id: string; created_at: string; action: string; entity_type: string; success: boolean; profile?: { full_name: string } | null; profile_name?: string }

/** Journal d'audit for the period (directors only, per the database rules). */
export function AuditLogReport({ period }: { period: Period }) {
  const [rows, setRows] = useState<AuditRow[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    setRows(null); setError(null)
    void accountingService.getAuditLog({ page: 0, fromDate: period.from || undefined, toDate: period.to ? `${period.to}T23:59:59` : undefined })
      .then(({ data, error: loadError }) => loadError ? setError(loadError.message) : setRows((data ?? []) as AuditRow[]))
  }, [period])
  return <ReportFrame title="Journal d’audit" period={describePeriod(period)} icon={ShieldCheck} subtitle="50 dernières opérations">
    {error && <p role="alert" className="ui-alert-error mx-5">{error}</p>}
    <div className="overflow-x-auto">
      <table className="ui-table report-table text-sm">
        <thead><tr><th>Date</th><th>Utilisateur</th><th>Action</th><th>Élément</th><th>Résultat</th></tr></thead>
        <tbody>{!rows ? <TableRowsSkeleton rows={6} cols={5} /> : rows.length === 0 ? <tr><td colSpan={5} className="ui-empty">Aucune opération enregistrée sur la période.</td></tr>
          : rows.map((row) => <tr key={row.id}><td className="whitespace-nowrap tabular-nums">{formatDateTime(row.created_at)}</td><td>{row.profile?.full_name || row.profile_name || '-'}</td><td>{auditLabel(row.action)}</td><td>{row.entity_type}</td><td>{row.success ? <span className="ui-badge ui-badge-success">Réussi</span> : <span className="ui-badge ui-badge-danger">Échec</span>}</td></tr>)}</tbody>
      </table>
    </div>
  </ReportFrame>
}
