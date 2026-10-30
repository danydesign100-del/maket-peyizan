import { useEffect, useMemo, useState, type FormEvent, type ReactNode } from 'react'
import { AlertTriangle, CheckCircle2, ChevronLeft, ChevronRight, Clock, Coins, Info, RotateCcw, Save, TrendingUp } from 'lucide-react'
import { PageHeader } from '../components/PageHeader'
import { TableRowsSkeleton } from '../components/Skeleton'
import { useAuth } from '../contexts/AuthContext'
import { AMOUNT_FIELDS, AMOUNT_LABELS, CURRENCY_LABELS, DENOMINATIONS, DIRECTIONS, SHIFTS, cashCounted, countTotal, emptyDetail, formatCurrency, overShort, type Currency, type CurrencyDetail, type Direction, type Shift } from '../lib/cashCount'
import { cashCountService, type CashCount } from '../services/cashCountService'

const CURRENCIES: Currency[] = ['htg', 'usd']
const formatDateTime = (value: string) => new Intl.DateTimeFormat('fr-HT', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' }).format(new Date(value))
const shiftLabel = (shift: Shift) => SHIFTS.find((item) => item.value === shift)?.label ?? shift
const directionShort = (direction: Direction) => DIRECTIONS.find((item) => item.value === direction)?.short ?? direction
const defaultShift = (): Shift => { const hour = new Date().getHours(); return hour < 12 ? 'AM' : hour < 18 ? 'PM' : 'NIGHT' }

/** Over/short with an icon and a word, never colour alone. */
function Balance({ currency, value, compact = false }: { currency: Currency; value: number; compact?: boolean }) {
  if (Math.abs(value) < 0.005) return <span className="inline-flex items-center gap-1 font-semibold text-emerald-700"><CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" />{compact ? formatCurrency(currency, 0) : 'Équilibré'}</span>
  const short = value < 0
  return <span className={`inline-flex items-center gap-1 font-semibold ${short ? 'text-red-700' : 'text-amber-700'}`}>
    {short ? <AlertTriangle className="h-3.5 w-3.5" aria-hidden="true" /> : <TrendingUp className="h-3.5 w-3.5" aria-hidden="true" />}
    {!compact && (short ? 'Manquant ' : 'Excédent ')}{value > 0 ? '+' : ''}{formatCurrency(currency, value)}
  </span>
}

function CurrencyPanel({ currency, detail, onChange }: { currency: Currency; detail: CurrencyDetail; onChange: (detail: CurrencyDetail) => void }) {
  const meta = CURRENCY_LABELS[currency]
  const total = countTotal(currency, detail)
  const setCount = (key: string, raw: string) => {
    const quantity = Math.max(0, Math.floor(Number(raw) || 0))
    onChange({ ...detail, counts: { ...detail.counts, [key]: quantity } })
  }
  const groups = [
    { title: currency === 'htg' ? 'Pièces' : 'Pièces (coins)', items: DENOMINATIONS[currency].filter((item) => item.kind === 'coin') },
    { title: currency === 'htg' ? 'Billets' : 'Billets (bills)', items: DENOMINATIONS[currency].filter((item) => item.kind === 'bill') },
  ]
  return <fieldset className="ui-card overflow-hidden">
    <legend className="sr-only">{meta.name} ({meta.code})</legend>
    <div className="flex items-center justify-between gap-3 border-b border-slate-200 bg-slate-50 px-4 py-3">
      <p className="flex items-center gap-2 text-sm font-bold text-slate-900"><span className="grid h-7 w-7 place-items-center rounded-md bg-brand-100 text-xs font-black text-brand-800">{meta.symbol}</span>{meta.name} <span className="font-medium text-slate-500">({meta.code})</span></p>
      <p className="text-right text-xs text-slate-500">Total<strong className="block text-base text-slate-950 tabular-nums">{formatCurrency(currency, total)}</strong></p>
    </div>
    <div className="space-y-4 p-4">
      {groups.map((group) => <div key={group.title}>
        <p className="text-[11px] font-bold uppercase tracking-[0.08em] text-slate-500">{group.title}</p>
        <div className="mt-2 space-y-1.5">
          {group.items.map((item) => {
            const quantity = detail.counts[item.key] ?? 0
            return <label key={item.key} className="grid grid-cols-[minmax(0,1fr)_5.5rem_6.5rem] items-center gap-2 text-sm">
              <span className="truncate text-slate-700">{item.label}</span>
              <input type="number" inputMode="numeric" min={0} step={1} value={quantity || ''} placeholder="0" onChange={(event) => setCount(item.key, event.target.value)} aria-label={`Nombre de ${item.label}`} className="w-full px-2 py-1.5 text-right tabular-nums" />
              <span className={`text-right tabular-nums ${quantity ? 'font-medium text-slate-900' : 'text-slate-400'}`}>{formatCurrency(currency, item.value * quantity)}</span>
            </label>
          })}
        </div>
      </div>)}
      <p className="flex justify-between border-t border-dashed border-slate-200 pt-2 text-sm text-slate-600">Espèces comptées<strong className="tabular-nums text-slate-900">{formatCurrency(currency, cashCounted(currency, detail))}</strong></p>
      <div className="grid gap-2.5 sm:grid-cols-2">
        {AMOUNT_FIELDS.map((field) => <label key={field} className="text-xs font-medium text-slate-600" title={AMOUNT_LABELS[field].hint}>
          {AMOUNT_LABELS[field].label}
          <input type="number" inputMode="decimal" min={0} step="0.01" value={detail[field] || ''} placeholder="0,00" onChange={(event) => onChange({ ...detail, [field]: Math.max(0, Number(event.target.value) || 0) })} className="mt-1 w-full text-right tabular-nums" />
        </label>)}
      </div>
      <div className="flex items-center justify-between rounded-lg bg-slate-50 px-3 py-2.5 text-sm"><span className="text-slate-600">Écart (over/short)</span><Balance currency={currency} value={overShort(currency, detail)} /></div>
    </div>
  </fieldset>
}

const breakdown = (currency: Currency, detail: CurrencyDetail) => [
  ...DENOMINATIONS[currency].filter((item) => detail.counts[item.key]).map((item) => ({ label: item.short, value: formatCurrency(currency, item.value * detail.counts[item.key]), quantity: detail.counts[item.key] })),
  ...(['rolled_coins', 'checks'] as const).filter((field) => detail[field]).map((field) => ({ label: field === 'checks' ? 'Chèques' : 'Rouleaux', value: formatCurrency(currency, detail[field]), quantity: null })),
]

/** One line per currency, prefixed with its code. */
function Pair({ render }: { render: (currency: Currency) => ReactNode }) {
  return <div className="space-y-1">{CURRENCIES.map((currency) => <p key={currency} className="whitespace-nowrap tabular-nums"><span className="mr-1.5 text-[10px] font-bold text-slate-400">{CURRENCY_LABELS[currency].code}</span>{render(currency)}</p>)}</div>
}

export function CashCountPage() {
  const { profile } = useAuth()
  const canCount = ['cashier', 'director', 'administrator'].includes(profile?.role?.code ?? '')
  const [shift, setShift] = useState<Shift>(defaultShift)
  const [direction, setDirection] = useState<Direction>('in')
  const [details, setDetails] = useState<Record<Currency, CurrencyDetail>>({ htg: emptyDetail(), usd: emptyDetail() })
  const [notes, setNotes] = useState('')
  const [rows, setRows] = useState<CashCount[]>([])
  const [count, setCount] = useState(0)
  const [page, setPage] = useState(0)
  const [day, setDay] = useState('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [tillLoaded, setTillLoaded] = useState(false)

  const load = async () => {
    setLoading(true)
    const { data, error: requestError, count: total } = await cashCountService.list(page, day)
    setLoading(false)
    if (requestError) return setError(requestError.message)
    setRows(data ?? []); setCount(total ?? 0)
    // The bank till is usually the same from one shift to the next: start from the last value.
    if (!tillLoaded && data?.length && !day && page === 0) {
      setDetails((current) => ({ htg: { ...current.htg, bank_till: current.htg.bank_till || data[0].htg.bank_till }, usd: { ...current.usd, bank_till: current.usd.bank_till || data[0].usd.bank_till } }))
      setTillLoaded(true)
    }
  }
  useEffect(() => { void load() }, [page, day])

  const totals = useMemo(() => Object.fromEntries(CURRENCIES.map((currency) => [currency, countTotal(currency, details[currency])])) as Record<Currency, number>, [details])
  const empty = CURRENCIES.every((currency) => totals[currency] === 0 && details[currency].deposit === 0)

  const reset = () => { setDetails((current) => ({ htg: emptyDetail(current.htg.bank_till), usd: emptyDetail(current.usd.bank_till) })); setNotes('') }

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if (empty) return setError('Saisissez au moins une coupure ou un montant.')
    setSaving(true); setError(null); setNotice(null)
    try {
      const result = await cashCountService.create({ shift, direction, counted_at: new Date().toISOString(), htg: details.htg, usd: details.usd, notes: notes.trim() || null })
      if (result.error) throw result.error
      setNotice((result as { queued?: boolean }).queued ? 'Comptage enregistré sur cet appareil. Il sera envoyé à la prochaine synchronisation.' : 'Comptage enregistré.')
      reset()
      setDirection((current) => current === 'in' ? 'out' : 'in')
      if (page !== 0 || day) { setPage(0); setDay('') } else void load()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String((cause as { message?: unknown })?.message ?? 'Enregistrement impossible'))
    } finally { setSaving(false) }
  }

  return <div>
    <PageHeader title="Comptage de caisse" description="Comptez la caisse en gourdes et en dollars au début et à la fin de chaque quart. Chaque comptage est conservé dans le registre et ne peut pas être modifié." />
    {error && <p role="alert" className="ui-alert-error">{error}</p>}
    {notice && <p role="status" className="ui-alert-success">{notice}</p>}

    {canCount && <form onSubmit={submit} className="mt-6 overflow-hidden rounded-xl border border-slate-200 bg-slate-100/70 shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-3 bg-brand-700 px-5 py-3.5 text-white">
        <h2 className="flex items-center gap-2 text-base font-bold"><Coins className="h-5 w-5" aria-hidden="true" />Nouveau comptage</h2>
        <p className="flex items-center gap-1.5 text-xs text-white/80"><Clock className="h-3.5 w-3.5" aria-hidden="true" />Heure enregistrée au moment de valider</p>
      </div>
      <div className="space-y-5 p-4 sm:p-5">
        <div className="flex flex-wrap items-end gap-4">
          <label className="text-xs font-medium text-slate-600">Quart
            <select value={shift} onChange={(event) => setShift(event.target.value as Shift)} className="mt-1 block min-w-40">{SHIFTS.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</select>
          </label>
          <div role="radiogroup" aria-label="Moment du comptage" className="inline-flex rounded-lg border border-slate-300 bg-white p-1 shadow-xs">
            {DIRECTIONS.map((item) => <button key={item.value} type="button" role="radio" aria-checked={direction === item.value} onClick={() => setDirection(item.value)}
              className={`rounded-md px-3.5 py-1.5 text-sm font-semibold transition ${direction === item.value ? 'bg-brand-700 text-white shadow-sm' : 'text-slate-600 hover:bg-slate-50'}`}>{item.label}</button>)}
          </div>
          <p className="flex items-start gap-1.5 text-xs leading-5 text-slate-500 sm:ml-auto sm:max-w-sm"><Info className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />Écart = Total − Dépôt/Retrait − Fond de caisse. Il vaut 0 quand la caisse est juste.</p>
        </div>
        <div className="grid gap-5 lg:grid-cols-2">
          {CURRENCIES.map((currency) => <CurrencyPanel key={currency} currency={currency} detail={details[currency]} onChange={(detail) => setDetails((current) => ({ ...current, [currency]: detail }))} />)}
        </div>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
          <label className="flex-1 text-xs font-medium text-slate-600">Notes
            <textarea value={notes} onChange={(event) => setNotes(event.target.value)} maxLength={1000} rows={2} placeholder="Ex. : billet de 500 abîmé, retrait remis au directeur…" className="mt-1 block w-full" />
          </label>
          <div className="flex gap-2">
            <button type="button" onClick={reset} className="ui-button-secondary"><RotateCcw className="h-4 w-4" aria-hidden="true" />Effacer</button>
            <button type="submit" disabled={saving || empty} className="ui-button-primary"><Save className="h-4 w-4" aria-hidden="true" />{saving ? 'Enregistrement…' : 'Enregistrer le comptage'}</button>
          </div>
        </div>
      </div>
    </form>}

    <section className="ui-card mt-6 overflow-hidden" aria-labelledby="logsheet-title">
      <div className="flex flex-wrap items-end justify-between gap-3 border-b border-slate-200 px-5 py-4">
        <div><h2 id="logsheet-title" className="text-base font-bold text-slate-950">Registre des comptages</h2><p className="mt-1 text-sm text-slate-600">{count} comptage(s){day ? ` le ${new Intl.DateTimeFormat('fr-HT').format(new Date(`${day}T12:00:00`))}` : ''}</p></div>
        <label className="text-xs font-medium text-slate-600">Jour
          <span className="mt-1 flex gap-2"><input type="date" value={day} onChange={(event) => { setPage(0); setDay(event.target.value) }} />{day && <button type="button" onClick={() => { setPage(0); setDay('') }} className="ui-button-secondary px-3 py-2">Tous</button>}</span>
        </label>
      </div>
      <div className="overflow-x-auto">
        <table className="ui-table text-xs">
          <thead><tr><th>Date et heure</th><th>Quart</th><th>Agent</th><th>Détail HTG</th><th>Détail USD</th><th>Sorties</th><th>Total</th><th>Dépôt / Retrait</th><th>Fond de caisse</th><th>Écart</th><th>Notes</th></tr></thead>
          <tbody>
            {loading ? <TableRowsSkeleton rows={5} cols={11} />
              : rows.length === 0 ? <tr><td colSpan={11} className="ui-empty">Aucun comptage enregistré{day ? ' ce jour-là' : ''}.</td></tr>
              : rows.map((entry) => <tr key={entry.id} className="align-top">
                <td className="whitespace-nowrap tabular-nums text-slate-700">{formatDateTime(entry.counted_at)}{entry.pending && <span className="mt-1 block"><span className="ui-badge ui-badge-warning">En attente de synchro</span></span>}</td>
                <td className="whitespace-nowrap"><span className="font-semibold text-slate-900">{shiftLabel(entry.shift)}</span><span className={`ml-1.5 ui-badge ${entry.direction === 'in' ? 'ui-badge-success' : 'ui-badge-neutral'}`}>{directionShort(entry.direction)}</span></td>
                <td className="whitespace-nowrap text-slate-700">{entry.submitter_name ?? '—'}</td>
                {CURRENCIES.map((currency) => {
                  const lines = breakdown(currency, entry[currency])
                  return <td key={currency} className="min-w-40">{lines.length ? <dl className="space-y-0.5">{lines.map((line) => <div key={line.label} className="flex justify-between gap-3 whitespace-nowrap"><dt className="text-slate-500">{line.label}{line.quantity ? ` × ${line.quantity}` : ''}</dt><dd className="tabular-nums font-medium text-slate-800">{line.value}</dd></div>)}</dl> : <span className="text-slate-400">—</span>}</td>
                })}
                <td><Pair render={(currency) => formatCurrency(currency, entry[currency].paid_outs)} /></td>
                <td><Pair render={(currency) => <strong className="text-slate-950">{formatCurrency(currency, currency === 'htg' ? entry.htg_total : entry.usd_total)}</strong>} /></td>
                <td><Pair render={(currency) => formatCurrency(currency, entry[currency].deposit)} /></td>
                <td><Pair render={(currency) => formatCurrency(currency, entry[currency].bank_till)} /></td>
                <td><Pair render={(currency) => <Balance compact currency={currency} value={currency === 'htg' ? entry.htg_over_short : entry.usd_over_short} />} /></td>
                <td className="min-w-40 max-w-60 whitespace-pre-line text-slate-600">{entry.notes ?? '—'}</td>
              </tr>)}
          </tbody>
        </table>
      </div>
      {count > 20 && <div className="flex items-center justify-between border-t border-slate-200 px-5 py-3 text-sm">
        <span className="text-slate-500">Page {page + 1} / {Math.ceil(count / 20)}</span>
        <span className="flex gap-2">
          <button type="button" disabled={page === 0} onClick={() => setPage((value) => value - 1)} className="ui-button-secondary px-3 py-1.5"><ChevronLeft className="h-4 w-4" aria-hidden="true" />Précédent</button>
          <button type="button" disabled={(page + 1) * 20 >= count} onClick={() => setPage((value) => value + 1)} className="ui-button-secondary px-3 py-1.5">Suivant<ChevronRight className="h-4 w-4" aria-hidden="true" /></button>
        </span>
      </div>}
    </section>
  </div>
}
