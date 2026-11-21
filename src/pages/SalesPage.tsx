import { RefreshCw, Undo2 } from 'lucide-react'
import { Modal } from '../components/Modal'
import { isLocalDbConfigured } from '../lib/supabase'
import { Skeleton, TableSkeleton } from '../components/Skeleton'
import { useEffect, useState } from 'react'
import { PageHeader } from '../components/PageHeader'
import { salesService } from '../services/salesService'
import { accountingService } from '../services/accountingService'
import { useAuth } from '../contexts/AuthContext'

/** Whole-sale cancellation (sale not handed over) or return (goods brought back). */
function CancelSaleDialog({ sale, onClose, onDone }: { sale: { id: string; sale_number: string; total_amount: number }; onClose: () => void; onDone: (message: string) => void }) {
  const [kind, setKind] = useState<'refunded' | 'cancelled'>('refunded')
  const [reason, setReason] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const submit = async () => {
    if (reason.trim().length < 3) return setError('Indiquez le motif.')
    setSaving(true)
    const { error: cancelError } = await salesService.cancelSale(sale.id, kind, reason.trim())
    setSaving(false)
    if (cancelError) return setError(cancelError.message)
    onDone(`Vente ${sale.sale_number} ${kind === 'refunded' ? 'remboursée' : 'annulée'} : stock remis et écriture d’extourne enregistrée.`)
  }
  return <Modal size="sm" title={`Vente ${sale.sale_number}`} subtitle={`${Number(sale.total_amount).toFixed(2)} HTG`} onClose={onClose} locked={saving}
    footer={<><button type="button" onClick={onClose} className="ui-button-secondary">Retour</button><button type="button" onClick={() => void submit()} disabled={saving} className="ui-button-primary bg-red-700 hover:bg-red-800"><Undo2 className="h-4 w-4" aria-hidden="true" />{saving ? 'Enregistrement…' : 'Confirmer'}</button></>}>
    {error && <p role="alert" className="ui-alert-error mt-0 mb-3">{error}</p>}
    <fieldset className="grid gap-2 sm:grid-cols-2"><legend className="sr-only">Type</legend>
      {([['refunded', 'Retour', 'Le client rapporte la marchandise et est remboursé.'], ['cancelled', 'Annulation', 'La vente est annulée (erreur, marchandise non remise).']] as const).map(([value, label, hint]) =>
        <label key={value} className={`cursor-pointer rounded-lg border p-3 text-sm ${kind === value ? 'border-brand-600 bg-brand-100/50' : 'border-slate-300'}`}><input type="radio" name="kind" checked={kind === value} onChange={() => setKind(value)} className="mr-2" /><strong>{label}</strong><span className="mt-1 block text-xs text-slate-500">{hint}</span></label>)}
    </fieldset>
    <label className="mt-4 block text-sm font-medium text-slate-700">Motif *<textarea rows={2} value={reason} onChange={(event) => setReason(event.target.value)} className="mt-1 w-full" /></label>
    <p className="mt-3 text-xs text-slate-500">Toute la vente est concernée : les articles reviennent en stock et une écriture inverse est passée (compte 408000, TVA, remboursement).</p>
  </Modal>
}

export function SalesPage() {
  const { profile, can } = useAuth()
  const canViewAll = profile?.role?.code === 'director' || profile?.role?.code === 'administrator' || profile?.role?.code === 'accountant'
  
  const [sales, setSales] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [syncing, setSyncing] = useState<string | null>(null)
  const [cancelling, setCancelling] = useState<any | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const canCancel = !isLocalDbConfigured && can('sales.cancel')
  
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
      // The service returns database errors instead of throwing them.
      const { error: syncError } = await accountingService.syncSaleToAccounting(saleId) as { error: { message: string } | null }
      if (syncError) throw new Error(syncError.message)
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
      {notice && <div className="ui-alert-success">{notice}</div>}
      
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
                <td className="p-3">{sale.customer?.full_name || '-'}</td>
                <td className="p-3 font-medium">{Number(sale.total_amount).toFixed(2)} HTG</td>
                <td className="p-3">
                  <span className={`rounded px-2 py-1 text-xs ${
                    sale.status === 'completed' ? 'bg-emerald-100 text-emerald-800' :
                    sale.status === 'cancelled' || sale.status === 'refunded' ? 'bg-red-100 text-red-800' :
                    'bg-slate-100 text-slate-800'
                  }`}>
                    {sale.status === 'completed' ? 'Complétée' :
                     sale.status === 'cancelled' ? 'Annulée' : sale.status === 'refunded' ? 'Remboursée' : sale.status}
                  </span>
                  {sale.cancel_reason && <span className="mt-1 block text-xs text-slate-500">{sale.cancel_reason}</span>}
                </td>
                <td className="p-3">
                  {sale.accounting_synced ? (
                    <span className="text-emerald-600">✓ Comptabilisée</span>
                  ) : (
                    <span className="text-amber-600" title={sale.accounting_error ?? undefined}>En attente{sale.accounting_error ? ' (erreur)' : ''}</span>
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
                  {canCancel && sale.status === 'completed' && <button type="button" onClick={() => setCancelling(sale)} className="ml-3 inline-flex items-center gap-1.5 text-red-700 hover:text-red-900"><Undo2 className="h-4 w-4" aria-hidden="true" />Annuler / Retour</button>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {cancelling && <CancelSaleDialog sale={cancelling} onClose={() => setCancelling(null)} onDone={(message) => { setCancelling(null); setNotice(message); void loadSales() }} />}
    </div>
  )
}
