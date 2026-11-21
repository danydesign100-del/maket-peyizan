import { useEffect, useRef, useState } from 'react'
import { Banknote, Check, FileText, Pencil, Printer, Send, X } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { Modal } from '../../components/Modal'
import { PrintHeader } from '../../components/PrintHeader'
import { ThermalTicket, ticketMoney, useTicketPrinter } from '../../components/ThermalTicket'
import { errorText } from '../../lib/errors'
import { formatDateTime, formatDay } from '../../lib/period'
import { printSection } from '../../lib/print'
import { PROFORMA_STATUS_LABELS, proformaService, type Proforma, type ProformaHistory, type ProformaStatus } from '../../services/proformaService'

const money = (value: number) => `${Number(value).toLocaleString('fr-HT', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} HTG`
const ACTIONS: Record<ProformaHistory['action'], string> = { created: 'Création', updated: 'Modification', status: 'Statut', converted: 'Transformée en vente' }

/** A proforma: details, history, printing (A4 and 80 mm), status and sale. */
export function ProformaDetail({ proforma, canEdit, canSell, onEdit, onClose, onChanged }: { proforma: Proforma; canEdit: boolean; canSell: boolean; onEdit: () => void; onClose: () => void; onChanged: (message: string) => void }) {
  const navigate = useNavigate()
  const [history, setHistory] = useState<ProformaHistory[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const a4 = useRef<HTMLElement>(null)
  const ticket = useTicketPrinter()
  useEffect(() => { void proformaService.history(proforma.id).then(({ data }) => setHistory((data ?? []) as ProformaHistory[])) }, [proforma.id])
  const editable = ['draft', 'sent'].includes(proforma.status)
  const expired = proforma.valid_until !== null && proforma.valid_until < new Date().toLocaleDateString('en-CA')
  const setStatus = async (status: ProformaStatus) => {
    try { await proformaService.setStatus(proforma.id, status); onChanged(`Proforma ${proforma.proforma_number} : ${PROFORMA_STATUS_LABELS[status].toLowerCase()}.`) } catch (cause) { setError(errorText(cause)) }
  }
  const customer = proforma.customer
  const meta: [string, string][] = [['N°', proforma.proforma_number], ['Date', formatDay(proforma.issue_date)], ...(proforma.valid_until ? [['Valable jusqu’au', formatDay(proforma.valid_until)] as [string, string]] : []), ...(customer ? [['Client', customer.full_name] as [string, string]] : [])]

  return <><Modal size="lg" title={`Proforma ${proforma.proforma_number}`} subtitle={`${PROFORMA_STATUS_LABELS[proforma.status]}${expired && editable ? ' · validité dépassée' : ''} · version ${proforma.revision ?? 1}`} onClose={onClose}
    footer={<>
      <button type="button" onClick={() => printSection(a4.current)} className="ui-button-secondary"><FileText className="h-4 w-4" aria-hidden="true" />Imprimer (A4)</button>
      <button type="button" onClick={ticket.print} className="ui-button-secondary"><Printer className="h-4 w-4" aria-hidden="true" />Ticket 80 mm</button>
      {canEdit && editable && <button type="button" onClick={onEdit} className="ui-button-secondary"><Pencil className="h-4 w-4" aria-hidden="true" />Modifier</button>}
      {canSell && ['draft', 'sent', 'accepted'].includes(proforma.status) && <button type="button" onClick={() => navigate('/caisse', { state: { proformaId: proforma.id } })} className="ui-button-primary"><Banknote className="h-4 w-4" aria-hidden="true" />Encaisser à la caisse</button>}
    </>}>
    {error && <p role="alert" className="ui-alert-error mt-0 mb-3">{error}</p>}
    <div className="grid gap-4 text-sm sm:grid-cols-2">
      <dl className="space-y-1"><div><dt className="text-xs text-slate-500">Client</dt><dd className="font-medium">{customer?.full_name ?? 'Sans client'}</dd></div>
        {customer && <dd className="text-slate-600">{[customer.company_name, customer.phone, customer.email, customer.address, customer.tax_id && `NIF ${customer.tax_id}`].filter(Boolean).join(' · ') || '-'}</dd>}</dl>
      <dl className="space-y-1 sm:text-right"><div><dt className="text-xs text-slate-500">Date · validité</dt><dd>{formatDay(proforma.issue_date)} · {proforma.valid_until ? `jusqu’au ${formatDay(proforma.valid_until)}` : 'sans limite'}</dd></div>
        <div><dt className="text-xs text-slate-500">Créée par</dt><dd>{proforma.creator?.full_name ?? '-'}</dd></div></dl>
    </div>
    <div className="mt-4 overflow-x-auto rounded-lg border border-slate-200">
      <table className="ui-table text-sm">
        <thead><tr><th>Produit</th><th className="text-right">Quantité</th><th className="text-right">Prix unitaire</th><th className="text-right">Remise</th><th className="text-right">Total</th></tr></thead>
        <tbody>{proforma.items.map((item, index) => <tr key={index}><td>{item.description}</td><td className="text-right tabular-nums">{Number(item.quantity)}</td><td className="text-right tabular-nums">{money(item.unit_price)}</td><td className="text-right tabular-nums">{Number(item.discount_amount) ? money(item.discount_amount) : '-'}</td><td className="text-right font-semibold tabular-nums">{money(item.line_total)}</td></tr>)}</tbody>
        <tfoot className="bg-slate-50 font-semibold"><tr><td colSpan={4} className="text-right">Total</td><td className="text-right tabular-nums">{money(proforma.total_amount)}</td></tr></tfoot>
      </table>
    </div>
    {proforma.notes && <p className="mt-3 whitespace-pre-line text-sm text-slate-600">{proforma.notes}</p>}
    {canEdit && proforma.status !== 'converted' && <div className="mt-4 flex flex-wrap gap-2 text-sm">
      <span className="self-center text-slate-500">Statut :</span>
      {proforma.status === 'draft' && <button type="button" onClick={() => void setStatus('sent')} className="ui-button-secondary px-3 py-1.5"><Send className="h-4 w-4" aria-hidden="true" />Marquer envoyée</button>}
      {['draft', 'sent'].includes(proforma.status) && <button type="button" onClick={() => void setStatus('accepted')} className="ui-button-secondary px-3 py-1.5"><Check className="h-4 w-4" aria-hidden="true" />Acceptée par le client</button>}
      {!['cancelled', 'expired'].includes(proforma.status) && <button type="button" onClick={() => void setStatus('cancelled')} className="ui-button-secondary px-3 py-1.5 text-red-700"><X className="h-4 w-4" aria-hidden="true" />Annuler</button>}
    </div>}
    <section className="mt-5">
      <h3 className="text-sm font-bold text-slate-900">Historique des modifications</h3>
      <ul className="mt-2 divide-y divide-slate-100 rounded-lg border border-slate-200 text-sm">{history === null ? <li className="px-3 py-2 text-slate-500">Chargement…</li> : history.length === 0 ? <li className="px-3 py-2 text-slate-500">Aucun historique (proforma créée avant le suivi des versions).</li>
        : history.map((row) => <li key={row.id} className="flex flex-wrap justify-between gap-2 px-3 py-2"><span><strong>{ACTIONS[row.action]}</strong>{row.action === 'status' && row.status ? ` : ${PROFORMA_STATUS_LABELS[row.status as ProformaStatus] ?? row.status}` : ''} · version {row.revision}{row.note ? ` · ${row.note}` : ''}</span>
          <span className="text-slate-500">{formatDateTime(row.changed_at)} · {row.author?.full_name ?? '-'} · {money(row.snapshot.total_amount)}</span></li>)}</ul>
    </section>

  </Modal>
    {/* Printable documents live outside the window (which is never printed). */}
    <section ref={a4} aria-label={`Proforma ${proforma.proforma_number}`} className="print-only hidden">
      <PrintHeader title={`Facture proforma N° ${proforma.proforma_number}`} period={`Date : ${formatDay(proforma.issue_date)}${proforma.valid_until ? ` · valable jusqu’au ${formatDay(proforma.valid_until)}` : ''}`} />
      <div className="mt-4 rounded border border-slate-400 p-3 text-sm"><p className="text-xs uppercase text-slate-600">Client</p><p className="font-bold">{customer?.full_name ?? '-'}</p>
        {customer && <p>{[customer.company_name, customer.address].filter(Boolean).join(' · ')}</p>}{customer && <p>{[customer.phone, customer.email, customer.tax_id && `NIF ${customer.tax_id}`].filter(Boolean).join(' · ')}</p>}</div>
      <table className="report-table mt-4 w-full border-collapse text-sm">
        <thead><tr className="border-b-2 border-slate-800 text-left"><th className="py-1">Désignation</th><th className="py-1 text-right">Quantité</th><th className="py-1 text-right">Prix unitaire</th><th className="py-1 text-right">Remise</th><th className="py-1 text-right">Montant</th></tr></thead>
        <tbody>{proforma.items.map((item, index) => <tr key={index} className="border-b border-slate-300"><td className="py-1">{item.description}</td><td className="py-1 text-right">{Number(item.quantity)}</td><td className="py-1 text-right">{money(item.unit_price)}</td><td className="py-1 text-right">{Number(item.discount_amount) ? money(item.discount_amount) : ''}</td><td className="py-1 text-right">{money(item.line_total)}</td></tr>)}</tbody>
        <tfoot><tr><td colSpan={4} className="py-1 text-right">Sous-total</td><td className="py-1 text-right">{money(proforma.subtotal)}</td></tr>
          {Number(proforma.discount_amount) > 0 && <tr><td colSpan={4} className="py-1 text-right">Remises</td><td className="py-1 text-right">− {money(proforma.discount_amount)}</td></tr>}
          <tr className="text-base font-bold"><td colSpan={4} className="border-t-2 border-slate-800 py-1 text-right">TOTAL</td><td className="border-t-2 border-slate-800 py-1 text-right">{money(proforma.total_amount)}</td></tr></tfoot>
      </table>
      {proforma.notes && <p className="mt-4 whitespace-pre-line text-sm">{proforma.notes}</p>}
      <p className="mt-6 text-xs text-slate-600">Proforma établie par {proforma.creator?.full_name ?? '-'}. Ce document n’est pas une facture ; les prix sont garantis jusqu’à la date de validité indiquée.</p>
    </section>
    <ThermalTicket sectionRef={ticket.ref} company={ticket.company} data={{
      title: 'Facture proforma',
      meta,
      lines: proforma.items.map((item) => ({ label: item.description, quantity: `${Number(item.quantity)} × ${ticketMoney(Number(item.unit_price), '')}`, amount: ticketMoney(Number(item.line_total), ''), detail: Number(item.discount_amount) ? `Remise : − ${ticketMoney(Number(item.discount_amount), '')}` : undefined })),
      totals: [...(Number(proforma.discount_amount) > 0 ? [{ label: 'Remises', amount: `− ${ticketMoney(Number(proforma.discount_amount))}` }] : []), { label: 'TOTAL', amount: ticketMoney(Number(proforma.total_amount)), strong: true }],
      notes: proforma.notes ? <p>{proforma.notes}</p> : undefined,
      footer: <p>Document non comptable, n’est pas une facture.{proforma.valid_until ? ` Valable jusqu’au ${formatDay(proforma.valid_until)}.` : ''}</p>,
    }} />
  </>
}
