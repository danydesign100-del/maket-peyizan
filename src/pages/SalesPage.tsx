import { RefreshCw } from 'lucide-react'
import { Skeleton, TableSkeleton } from '../components/Skeleton'
import { useEffect, useState } from 'react'
import { PageHeader } from '../components/PageHeader'
import { salesService } from '../services/salesService'
import { accountingService } from '../services/accountingService'
import { useAuth } from '../contexts/AuthContext'

export function SalesPage() {
  const { profile } = useAuth()
  const canViewAll = profile?.role?.code === 'director' || profile?.role?.code === 'administrator' || profile?.role?.code === 'accountant'
  
  const [sales, setSales] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [syncing, setSyncing] = useState<string | null>(null)
  
  useEffect(() => {
    void loadSales()
  }, [])
  
  const loadSales = async () => {
    setLoading(true)
    try {
      const { data, error: requestError } = canViewAll 
        ? await salesService.listAll()
        : await salesService.listMine()
      
      if (requestError) throw requestError
      setSales(data || [])
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Erreur de chargement')
    } finally {
      setLoading(false)
    }
  }
  
  const syncToAccounting = async (saleId: string) => {
    setSyncing(saleId)
    try {
      await accountingService.syncSaleToAccounting(saleId)
      await loadSales()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Erreur de synchronisation')
    } finally {
      setSyncing(null)
    }
  }
  
  if (loading) return <div role="status" aria-label="Chargement"><Skeleton className="h-3 w-40" /><Skeleton className="mt-3 h-8 w-56" /><TableSkeleton rows={8} cols={6} /></div>
  
  return (
    <div>
      <PageHeader title="Ventes" description="Historique des ventes" />
      
      {error && <div className="mt-4 rounded bg-red-50 p-3 text-red-800">{error}</div>}
      
      <div className="mt-6 overflow-x-auto rounded-xl bg-white shadow-sm ring-1 ring-slate-200">
        <table className="w-full text-left text-sm">
          <thead className="bg-slate-50">
            <tr>
              <th className="p-3">N° Vente</th>
              <th className="p-3">Date</th>
              <th className="p-3">Client</th>
              <th className="p-3">Montant</th>
              <th className="p-3">Statut</th>
              <th className="p-3">Comptabilité</th>
              <th className="p-3">Actions</th>
            </tr>
          </thead>
          <tbody>
            {sales.length === 0 ? (
              <tr><td colSpan={7} className="p-6 text-center text-slate-500">Aucune vente</td></tr>
            ) : sales.map((sale) => (
              <tr key={sale.id} className="border-t">
                <td className="p-3 font-medium">{sale.sale_number}</td>
                <td className="p-3">{new Date(sale.sold_at).toLocaleString()}</td>
                <td className="p-3">{sale.customer?.full_name || '—'}</td>
                <td className="p-3 font-medium">{Number(sale.total_amount).toFixed(2)} HTG</td>
                <td className="p-3">
                  <span className={`rounded px-2 py-1 text-xs ${
                    sale.status === 'completed' ? 'bg-emerald-100 text-emerald-800' :
                    sale.status === 'cancelled' ? 'bg-red-100 text-red-800' :
                    'bg-slate-100 text-slate-800'
                  }`}>
                    {sale.status === 'completed' ? 'Complétée' :
                     sale.status === 'cancelled' ? 'Annulée' : sale.status}
                  </span>
                </td>
                <td className="p-3">
                  {sale.accounting_synced ? (
                    <span className="text-emerald-600">✓ Synchronisé</span>
                  ) : (
                    <span className="text-amber-600">En attente</span>
                  )}
                </td>
                <td className="p-3">
                  {!sale.accounting_synced && canViewAll && (
                    <button
                      onClick={() => void syncToAccounting(sale.id)}
                      disabled={syncing === sale.id}
                      className="inline-flex items-center gap-1.5 text-brand-700 hover:text-brand-900 disabled:opacity-50"
                    >
                      <RefreshCw className="h-4 w-4" aria-hidden="true" />{syncing === sale.id ? '...' : 'Synchroniser'}
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
