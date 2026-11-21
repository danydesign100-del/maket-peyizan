import { useEffect, useState } from 'react'
import { ArrowDownLeft, ArrowUpRight, Ban, Check, Clock, Plus, Printer, X } from 'lucide-react'
import { ticketDate, ticketMoney, useTicket } from '../../components/ThermalTicket'
import { useAuth } from '../../contexts/AuthContext'
import { errorText } from '../../lib/errors'
import { Modal } from '../../components/Modal'
import { PeriodFilter } from '../../components/PeriodFilter'
import { TableRowsSkeleton } from '../../components/Skeleton'
import { formatDateTime, monthToDate, periodError, type Period } from '../../lib/period'
import type { Account } from '../../types/accounting'
import { formatAmount } from '../../services/ledgerService'
import { CASH_ACCOUNT_LABELS, MOVEMENT_TYPES, cashService, type CashAccountCode, type CashMovement } from '../../services/cashService'
import { MovementFormDialog, type MovementPreset } from './MovementForm'

function VoidMovementDialog({ movement, onClose, onDone }: { movement: CashMovement; onClose: () => void; onDone: (message: string) => void }) {
  const [reason, setReason] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const submit = async () => {
    if (reason.trim().length < 3) return setError('Indiquez le motif.')
    setSaving(true)
    const { error: voidError } = await cashService.voidMovement(movement.id, reason.trim())
    setSaving(false)
    if (voidError) return setError(voidError.message)
    onDone('Mouvement annulé ; son écriture est annulée et reste visible.')
  }
  return <Modal size="sm" title="Annuler le mouvement" subtitle={`${movement.label} - ${formatAmount(Number(movement.amount))} HTG`} onClose={onClose} locked={saving}
    footer={<><button type="button" onClick={onClose} className="ui-button-secondary">Retour</button><button type="button" onClick={() => void submit()} disabled={saving} className="ui-button-primary bg-red-700 hover:bg-red-800"><Ban className="h-4 w-4" aria-hidden="true" />Annuler le mouvement</button></>}>
    {error && <p role="alert" className="ui-alert-error mt-0 mb-3">{error}</p>}
    <label className="block text-sm font-medium text-slate-700">Motif *<textarea autoFocus rows={2} value={reason} onChange={(event) => setReason(event.target.value)} className="mt-1 w-full" /></label>
  </Modal>
}

/** Outflow above the threshold: a director or administrator authorises it (note optional) or refuses it (reason required). */
function ApprovalDialog({ movement, decision, onClose, onDone }: { movement: CashMovement; decision: 'approve' | 'reject'; onClose: () => void; onDone: (message: string) => void }) {
  const [text, setText] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const approve = decision === 'approve'
  const submit = async () => {
    if (!approve && text.trim().length < 3) return setError('Indiquez le motif du refus.')
    setSaving(true)
    const { error: saveError } = approve ? await cashService.approveMovement(movement.id, text.trim()) : await cashService.rejectMovement(movement.id, text.trim())
    setSaving(false)
    if (saveError) return setError(errorText(saveError))
    onDone(approve ? `Sortie de ${formatAmount(Number(movement.amount))} HTG autorisée et comptabilisée.` : `Sortie de ${formatAmount(Number(movement.amount))} HTG refusée : rien n’est comptabilisé.`)
  }
  return <Modal size="sm" title={approve ? 'Autoriser la sortie' : 'Refuser la sortie'} subtitle={`${movement.label} - ${formatAmount(Number(movement.amount))} HTG · ${movement.author?.full_name ?? ''}`} onClose={onClose} locked={saving}
    footer={<><button type="button" onClick={onClose} className="ui-button-secondary">Retour</button><button type="button" onClick={() => void submit()} disabled={saving} className={`ui-button-primary ${approve ? '' : 'bg-red-700 hover:bg-red-800'}`}>{approve ? <Check className="h-4 w-4" aria-hidden="true" /> : <X className="h-4 w-4" aria-hidden="true" />}{approve ? 'Autoriser' : 'Refuser'}</button></>}>
    {error && <p role="alert" className="ui-alert-error mt-0 mb-3">{error}</p>}
    <label className="block text-sm font-medium text-slate-700">{approve ? 'Note (facultative)' : 'Motif du refus *'}<textarea autoFocus rows={2} value={text} onChange={(event) => setText(event.target.value)} className="mt-1 w-full" /></label>
  </Modal>
}

/** Typed cash movements of the period, with totals in and out. */
export function MovementsTab({ accounts, canManage, onNotice }: { accounts: Account[]; canManage: boolean; onNotice: (message: string) => void }) {
  const [period, setPeriod] = useState<Period>(monthToDate)
  const [cash, setCash] = useState<CashAccountCode | ''>('')
  const [movements, setMovements] = useState<CashMovement[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [form, setForm] = useState<MovementPreset | null>(null)
  const [voiding, setVoiding] = useState<CashMovement | null>(null)
  const [deciding, setDeciding] = useState<{ movement: CashMovement; decision: 'approve' | 'reject' } | null>(null)
  const [refresh, setRefresh] = useState(0)
  const { can } = useAuth()
  const ticket = useTicket()
  const printVoucher = (movement: CashMovement) => ticket.print({
    title: movement.direction === 'out' ? 'Bon de sortie de caisse' : 'Bon d’entrée de caisse',
    meta: [['N°', movement.journal?.entry_number ?? movement.expense?.journal?.entry_number ?? movement.id.slice(0, 8).toUpperCase()], ['Date', ticketDate(movement.occurred_at)], ['Caisse', CASH_ACCOUNT_LABELS[(movement.cash_account?.code ?? '101000') as CashAccountCode] ?? '-']],
    lines: [
      { label: MOVEMENT_TYPES[movement.movement_type].label, strong: true },
      { label: movement.label, detail: [movement.reference && `Réf. ${movement.reference}`, movement.counter && `Compte ${movement.counter.code} ${movement.counter.name}`].filter(Boolean).join(' · ') || undefined },
    ],
    totals: [{ label: 'MONTANT', amount: ticketMoney(Number(movement.amount)), strong: true }],
    notes: <><p>Enregistré par : {movement.author?.full_name ?? '-'}</p>
      {movement.approver && movement.status === 'posted' && <p>Autorisé par : {movement.approver.full_name}{movement.approval_note ? ` (${movement.approval_note})` : ''}</p>}
      {movement.status === 'pending' && <p className="font-bold">EN ATTENTE D’AUTORISATION</p>}
      {movement.status === 'voided' && <p className="font-bold">ANNULÉ : {movement.void_reason}</p>}
      {movement.status === 'rejected' && <p className="font-bold">REFUSÉ : {movement.approval_note}</p>}</>,
    footer: <div className="mt-4 grid grid-cols-3 gap-2 text-left text-[7.5pt]"><p className="border-t border-black pt-1">Remis par</p><p className="border-t border-black pt-1">Reçu par</p><p className="border-t border-black pt-1">Autorisé par</p></div>,
  })
  const canApprove = can('cash.approve')

  useEffect(() => {
    if (periodError(period)) return
    setMovements(null)
    void cashService.listMovements(period.from, period.to).then(({ data, error: loadError }) => loadError ? setError(loadError.message) : setMovements(data ?? []))
  }, [period, refresh])

  const reload = (message: string) => { onNotice(message); setForm(null); setVoiding(null); setDeciding(null); setRefresh((value) => value + 1) }
  const pending = (movements ?? []).filter((movement) => movement.status === 'pending')
  const rows = (movements ?? []).filter((movement) => !cash || movement.cash_account?.code === cash)
  const posted = rows.filter((movement) => movement.status === 'posted')
  const totalIn = posted.filter((m) => m.direction === 'in').reduce((sum, m) => sum + Number(m.amount), 0)
  const totalOut = posted.filter((m) => m.direction === 'out').reduce((sum, m) => sum + Number(m.amount), 0)

  return <div className="space-y-5">
    <section className="ui-card flex flex-wrap items-end justify-between gap-3 p-4">
      <div className="flex flex-wrap items-end gap-3">
        <PeriodFilter value={period} onChange={setPeriod} />
        <label className="text-xs font-medium text-slate-600">Caisse<select value={cash} onChange={(event) => setCash(event.target.value as CashAccountCode | '')} className="mt-1 block"><option value="">Toutes</option>{(Object.keys(CASH_ACCOUNT_LABELS) as CashAccountCode[]).map((code) => <option key={code} value={code}>{CASH_ACCOUNT_LABELS[code]}</option>)}</select></label>
      </div>
      <button type="button" onClick={() => setForm({ cashAccount: '101000', type: 'bank_deposit' })} className="ui-button-primary"><Plus className="h-4 w-4" aria-hidden="true" />Nouveau mouvement</button>
    </section>
    {error && <p role="alert" className="ui-alert-error">{error}</p>}
    {pending.length > 0 && <p role="status" className="flex items-center gap-2 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900"><Clock className="h-4 w-4 shrink-0" aria-hidden="true" /><span><strong>{pending.length} sortie(s) en attente de validation</strong> ({formatAmount(pending.reduce((sum, m) => sum + Number(m.amount), 0))} HTG){canApprove ? ' : autorisez-les ou refusez-les ci-dessous.' : ' par un directeur ou un administrateur.'} Elles ne comptent pas dans la caisse avant leur accord.</span></p>}
    <dl className="grid gap-3 sm:grid-cols-3">
      {[['Entrées', totalIn, 'text-emerald-700'], ['Sorties', totalOut, 'text-red-700'], ['Solde des mouvements', totalIn - totalOut, 'text-slate-950']].map(([label, value, tone]) =>
        <div key={label as string} className="ui-card px-5 py-3"><dt className="text-xs text-slate-500">{label}</dt><dd className={`mt-0.5 text-lg font-bold tabular-nums ${tone}`}>{formatAmount(Number(value))} <span className="text-xs font-normal text-slate-400">HTG</span></dd></div>)}
    </dl>
    <section className="ui-card overflow-x-auto">
      <table className="ui-table text-sm">
        <thead><tr><th>Date</th><th>Opération</th><th>Libellé</th><th>Contrepartie</th><th className="text-right">Montant</th><th>Écriture</th><th className="text-right"><span className="sr-only">Actions</span></th></tr></thead>
        <tbody>
          {movements === null ? <TableRowsSkeleton rows={5} cols={7} /> : rows.length === 0 ? <tr><td colSpan={7} className="ui-empty">Aucun mouvement sur la période.</td></tr>
            : rows.map((movement) => {
              const voided = movement.status === 'voided' || movement.status === 'rejected'
              const waiting = movement.status === 'pending'
              const entry = movement.journal?.entry_number ?? movement.expense?.journal?.entry_number
              return <tr key={movement.id} className={voided ? 'text-slate-400' : ''}>
                <td className="whitespace-nowrap tabular-nums">{formatDateTime(movement.occurred_at)}<span className="block text-xs text-slate-500">{movement.author?.full_name ?? '-'}</span></td>
                <td><span className={`inline-flex items-center gap-1 font-medium ${movement.direction === 'in' ? 'text-emerald-700' : 'text-red-700'} ${voided ? 'opacity-60' : ''}`}>{movement.direction === 'in' ? <ArrowDownLeft className="h-4 w-4 shrink-0" aria-hidden="true" /> : <ArrowUpRight className="h-4 w-4 shrink-0" aria-hidden="true" />}{MOVEMENT_TYPES[movement.movement_type].label}</span><span className="block pl-5 text-xs text-slate-500">{CASH_ACCOUNT_LABELS[(movement.cash_account?.code ?? '101000') as CashAccountCode] ?? movement.cash_account?.name}</span>
                  {waiting && <span className="ml-5 mt-1 inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-800"><Clock className="h-3 w-3" aria-hidden="true" />À valider</span>}
                  {movement.status === 'rejected' && <span className="ml-5 mt-1 inline-block rounded-full bg-red-100 px-2 py-0.5 text-xs font-semibold text-red-800">Refusée</span>}</td>
                <td><span className={voided ? 'line-through' : 'font-medium text-slate-900'}>{movement.label}</span>{movement.reference && <span className="block text-xs text-slate-500">Réf. {movement.reference}</span>}{movement.status === 'voided' && <span className="block text-xs text-red-700">Annulé : {movement.void_reason}</span>}
                  {movement.status === 'rejected' && <span className="block text-xs text-red-700">Refusé par {movement.approver?.full_name ?? '-'} : {movement.approval_note}</span>}
                  {movement.status === 'posted' && movement.direction === 'out' && movement.approver && <span className="block text-xs text-slate-500">Autorisé par {movement.approver.full_name}{movement.approval_note ? ` : ${movement.approval_note}` : ''}</span>}</td>
                <td className="text-slate-600">{movement.counter ? `${movement.counter.code} ${movement.counter.name}` : '-'}</td>
                <td className={`whitespace-nowrap text-right font-semibold tabular-nums ${voided ? 'text-slate-400 line-through' : movement.direction === 'in' ? 'text-emerald-700' : 'text-red-700'}`}>{movement.direction === 'in' ? '+' : '−'} {formatAmount(Number(movement.amount))}</td>
                <td className="whitespace-nowrap font-mono text-xs">{entry ?? '-'}</td>
                <td className="whitespace-nowrap text-right">
                  {waiting && canApprove && <span className="inline-flex gap-1">
                    <button type="button" onClick={() => setDeciding({ movement, decision: 'approve' })} className="inline-flex items-center gap-1 rounded-md bg-emerald-700 px-2 py-1 text-xs font-semibold text-white hover:bg-emerald-800"><Check className="h-3.5 w-3.5" aria-hidden="true" />Autoriser</button>
                    <button type="button" onClick={() => setDeciding({ movement, decision: 'reject' })} className="inline-flex items-center gap-1 rounded-md border border-red-200 px-2 py-1 text-xs font-semibold text-red-700 hover:bg-red-50"><X className="h-3.5 w-3.5" aria-hidden="true" />Refuser</button>
                  </span>}
                  <button type="button" onClick={() => printVoucher(movement)} title="Imprimer le bon" className="rounded p-1.5 text-slate-500 hover:bg-slate-100 hover:text-brand-700"><Printer className="h-4 w-4" aria-label="Imprimer le bon" /></button>
                  {canManage && movement.status === 'posted' && <button type="button" onClick={() => setVoiding(movement)} title="Annuler" className="rounded p-1.5 text-slate-500 hover:bg-red-50 hover:text-red-700"><Ban className="h-4 w-4" aria-label="Annuler" /></button>}
                </td>
              </tr>
            })}
        </tbody>
      </table>
    </section>
    {form && <MovementFormDialog preset={form} accounts={accounts} canUsePettyCash={canManage} onClose={() => setForm(null)} onSaved={reload} />}
    {voiding && <VoidMovementDialog movement={voiding} onClose={() => setVoiding(null)} onDone={reload} />}
    {ticket.element}
    {deciding && <ApprovalDialog movement={deciding.movement} decision={deciding.decision} onClose={() => setDeciding(null)} onDone={reload} />}
  </div>
}
