import { useEffect, useState } from 'react'
import { HandCoins, Pencil, ReceiptText, Wallet } from 'lucide-react'
import { PeriodFilter } from '../../components/PeriodFilter'
import { TableRowsSkeleton } from '../../components/Skeleton'
import { useAuth } from '../../contexts/AuthContext'
import { formatDay, monthToDate, periodError, type Period } from '../../lib/period'
import type { Account, AccountMovement } from '../../types/accounting'
import { formatAmount, ledgerService } from '../../services/ledgerService'
import { cashService } from '../../services/cashService'
import { MovementFormDialog, type MovementPreset } from './MovementForm'

/** Petite caisse: imprest fund, balance, amount to replenish, vouchers and ledger. */
export function PettyCashTab({ accounts, onNotice }: { accounts: Account[]; onNotice: (message: string) => void }) {
  const { can } = useAuth()
  const account = accounts.find((item) => item.code === '104000')
  const [period, setPeriod] = useState<Period>(monthToDate)
  const [float, setFloat] = useState<number | null>(null)
  const [balance, setBalance] = useState<number | null>(null)
  const [opening, setOpening] = useState(0)
  const [lines, setLines] = useState<AccountMovement[] | null>(null)
  const [form, setForm] = useState<MovementPreset | null>(null)
  const [editingFloat, setEditingFloat] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [refresh, setRefresh] = useState(0)

  useEffect(() => {
    if (!account || periodError(period)) return
    setLines(null)
    void Promise.all([cashService.pettyCashFloat(), ledgerService.balances(null, null), ledgerService.balances(period.from, period.to), ledgerService.accountMovements(account.id, period.from, period.to)])
      .then(([fund, now, inPeriod, movements]) => {
        const failure = fund.error ?? now.error ?? inPeriod.error ?? movements.error
        if (failure) return setError(failure.message)
        setFloat(fund.data ?? 0)
        setBalance(Number(now.data?.find((row) => row.code === '104000')?.balance ?? 0))
        const row = inPeriod.data?.find((item) => item.code === '104000')
        setOpening(row ? Number(row.opening_debit) - Number(row.opening_credit) : 0)
        setLines(movements.data ?? [])
      })
  }, [account, period, refresh])

  const reload = (message: string) => { onNotice(message); setForm(null); setRefresh((value) => value + 1) }
  const saveFloat = async () => {
    const value = Number((editingFloat ?? '').replace(',', '.'))
    if (!Number.isFinite(value) || value < 0) return setError('Montant du fonds invalide.')
    const { error: saveError } = await cashService.setPettyCashFloat(value)
    if (saveError) return setError(saveError.message)
    setEditingFloat(null); reload('Montant du fonds fixe enregistré.')
  }
  if (!account) return <p className="ui-alert-error">Le compte 104000 Petite caisse est introuvable.</p>
  const toReplenish = float !== null && balance !== null ? Math.max(0, float - balance) : 0
  let running = opening

  return <div className="space-y-5">
    {error && <p role="alert" className="ui-alert-error">{error}</p>}
    <section className="grid gap-3 sm:grid-cols-3">
      <div className="ui-card px-5 py-4"><p className="flex items-center justify-between text-xs text-slate-500">Fonds fixe{can('settings.manage') && editingFloat === null && <button type="button" onClick={() => setEditingFloat(String(float ?? 0))} title="Modifier le montant du fonds" className="text-slate-400 hover:text-brand-700"><Pencil className="h-3.5 w-3.5" aria-label="Modifier" /></button>}</p>
        {editingFloat === null ? <p className="mt-1 text-xl font-bold tabular-nums">{float === null ? '…' : formatAmount(float)}</p>
          : <span className="mt-1 flex gap-2"><input autoFocus inputMode="decimal" value={editingFloat} onChange={(event) => setEditingFloat(event.target.value)} className="w-32 text-right" /><button type="button" onClick={() => void saveFloat()} className="ui-button-primary px-3 py-1.5">OK</button></span>}</div>
      <div className="ui-card px-5 py-4"><p className="text-xs text-slate-500">Solde actuel</p><p className={`mt-1 text-xl font-bold tabular-nums ${balance !== null && balance < 0 ? 'text-red-700' : ''}`}>{balance === null ? '…' : formatAmount(balance)}</p></div>
      <div className={`ui-card px-5 py-4 ${toReplenish > 0 ? 'border-amber-300 bg-amber-50' : ''}`}><p className="text-xs text-slate-500">À réapprovisionner</p><p className="mt-1 text-xl font-bold tabular-nums">{formatAmount(toReplenish)}</p><p className="text-xs text-slate-500">Fonds fixe − solde actuel</p></div>
    </section>
    <div className="flex flex-wrap gap-2">
      <button type="button" onClick={() => setForm({ cashAccount: '101000', type: 'petty_cash_funding', label: 'Réapprovisionnement de la petite caisse', amount: toReplenish || undefined })} className="ui-button-primary"><HandCoins className="h-4 w-4" aria-hidden="true" />Approvisionner depuis la caisse principale</button>
      <button type="button" onClick={() => setForm({ cashAccount: '104000', type: 'bank_withdrawal', label: 'Approvisionnement de la petite caisse par la banque', amount: toReplenish || undefined })} className="ui-button-secondary"><Wallet className="h-4 w-4" aria-hidden="true" />depuis la banque</button>
      <button type="button" onClick={() => setForm({ cashAccount: '104000', type: 'expense' })} className="ui-button-secondary"><ReceiptText className="h-4 w-4" aria-hidden="true" />Pièce de dépense</button>
    </div>
    <section className="ui-card overflow-hidden">
      <div className="flex flex-wrap items-end justify-between gap-3 border-b border-slate-200 px-5 py-4"><h3 className="text-base font-bold text-slate-950">Mouvements de la petite caisse</h3><PeriodFilter value={period} onChange={setPeriod} /></div>
      <div className="overflow-x-auto">
        <table className="ui-table text-sm">
          <thead><tr><th>Date</th><th>N°</th><th>Libellé</th><th>Référence</th><th className="text-right">Entrée</th><th className="text-right">Sortie</th><th className="text-right">Solde</th></tr></thead>
          <tbody>
            <tr className="bg-slate-50/60 text-slate-500"><td colSpan={6}>Solde au {formatDay(period.from)}</td><td className="text-right tabular-nums">{formatAmount(opening)}</td></tr>
            {lines === null ? <TableRowsSkeleton rows={4} cols={7} /> : lines.length === 0 ? <tr><td colSpan={7} className="ui-empty py-6">Aucun mouvement sur la période.</td></tr>
              : lines.map((line) => { running += Number(line.debit_amount) - Number(line.credit_amount); return <tr key={line.id}>
                <td className="whitespace-nowrap">{formatDay(line.entry.entry_date)}</td><td className="whitespace-nowrap font-mono text-xs">{line.entry.entry_number}</td>
                <td>{line.entry.description ?? line.description}</td><td className="text-slate-600">{line.entry.reference ?? '-'}</td>
                <td className="text-right tabular-nums text-emerald-700">{Number(line.debit_amount) ? formatAmount(Number(line.debit_amount)) : ''}</td>
                <td className="text-right tabular-nums text-red-700">{Number(line.credit_amount) ? formatAmount(Number(line.credit_amount)) : ''}</td>
                <td className="text-right font-medium tabular-nums">{formatAmount(running)}</td>
              </tr> })}
          </tbody>
        </table>
      </div>
    </section>
    {form && <MovementFormDialog preset={form} accounts={accounts} canUsePettyCash onClose={() => setForm(null)} onSaved={reload} />}
  </div>
}
