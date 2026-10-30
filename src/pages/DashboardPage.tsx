import { useEffect, useState, type CSSProperties } from 'react'
import { Link } from 'react-router-dom'
import { ArrowLeftRight, ArrowRight, Banknote, Coins, CalendarCheck, ChartColumn, FileText, Package, PackagePlus, PackageX, ShoppingCart, TriangleAlert, UserPlus, Wallet, Warehouse, type LucideIcon } from 'lucide-react'
import { Skeleton } from '../components/Skeleton'
import { useAuth } from '../contexts/AuthContext'
import { useSyncStatus } from '../lib/offline/status'
import { getInventoryMetrics, getSalesMetrics, getSalesTrend, getTopProducts, localDay, type DailySales, type TopProduct } from '../services/dashboardService'
import { ColumnChart } from '../components/charts/ColumnChart'
import { BarList } from '../components/charts/BarList'

type Metrics = { productCount: number; outOfStock: number; lowStock: number; stockValue: number }
type SalesMetrics = { salesCount: number; totalSales: number; transactionCount: number }
const formatMoney = (value: number) => new Intl.NumberFormat('fr-HT', { style: 'currency', currency: 'HTG', maximumFractionDigits: 2 }).format(value)
const formatCount = (value: number) => new Intl.NumberFormat('fr-HT').format(Math.round(value))

type Shortcut = { to: string; label: string; hint: string; icon: LucideIcon; tone: string; roles: string[] }
const shortcuts: Shortcut[] = [
  { to: '/caisse', label: 'Nouvelle vente', hint: 'Point de vente', icon: ShoppingCart, tone: 'bg-brand-100 text-brand-800', roles: ['cashier', 'director', 'administrator'] },
  { to: '/comptage-caisse', label: 'Comptage de caisse', hint: 'Début et fin de quart', icon: Coins, tone: 'bg-accent-100 text-amber-800', roles: ['cashier', 'director', 'administrator', 'accountant'] },
  { to: '/produits', label: 'Ajouter un produit', hint: 'Catalogue', icon: PackagePlus, tone: 'bg-sky-50 text-sky-700', roles: ['director', 'administrator', 'stock_manager'] },
  { to: '/stock', label: 'Mouvement de stock', hint: 'Entrées et sorties', icon: ArrowLeftRight, tone: 'bg-violet-50 text-violet-700', roles: ['director', 'administrator', 'stock_manager'] },
  { to: '/clients', label: 'Nouveau client', hint: 'Répertoire', icon: UserPlus, tone: 'bg-amber-50 text-amber-700', roles: ['cashier', 'director', 'administrator'] },
  { to: '/proformas', label: 'Proforma', hint: 'Devis client', icon: FileText, tone: 'bg-teal-50 text-teal-700', roles: ['cashier', 'director', 'administrator'] },
  { to: '/recettes-journalieres', label: 'Recettes du jour', hint: 'Clôture de caisse', icon: CalendarCheck, tone: 'bg-emerald-50 text-emerald-700', roles: ['cashier', 'director', 'administrator'] },
  { to: '/depenses', label: 'Dépense', hint: 'Sorties d’argent', icon: Wallet, tone: 'bg-rose-50 text-rose-700', roles: ['director', 'administrator', 'accountant'] },
  { to: '/rapports', label: 'Rapports', hint: 'Bilan et résultat', icon: ChartColumn, tone: 'bg-indigo-50 text-indigo-700', roles: ['director', 'administrator', 'accountant'] },
]

const reducedMotion = () => typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches

/** Animates a number from 0 to its value once it is known. */
function useCountUp(target: number | undefined, duration = 900) {
  const [value, setValue] = useState(0)
  useEffect(() => {
    if (target === undefined) return
    if (reducedMotion()) { setValue(target); return }
    let frame = 0
    const start = performance.now()
    const step = (now: number) => {
      const progress = Math.min(1, (now - start) / duration)
      setValue(target * (1 - (1 - progress) ** 3))
      if (progress < 1) frame = requestAnimationFrame(step)
    }
    frame = requestAnimationFrame(step)
    return () => cancelAnimationFrame(frame)
  }, [target, duration])
  return value
}

function useNow() {
  const [now, setNow] = useState(() => new Date())
  useEffect(() => { const timer = setInterval(() => setNow(new Date()), 30_000); return () => clearInterval(timer) }, [])
  return now
}

const delay = (index: number): CSSProperties => ({ animationDelay: `${index * 70}ms` })

type Card = { label: string; value?: number; failed: boolean; money?: boolean; hint: string; tone: string; icon: LucideIcon; chip: string }

function StatCard({ card, index }: { card: Card; index: number }) {
  const animated = useCountUp(card.value)
  return <article style={delay(index)} className="ui-card group p-5 transition hover:-translate-y-0.5 hover:shadow-md animate-fade-up">
    <div className="flex items-center justify-between gap-3">
      <p className="text-sm font-medium text-slate-600">{card.label}</p>
      <span className={`grid h-9 w-9 place-items-center rounded-lg transition group-hover:scale-110 ${card.chip}`}><card.icon className="h-[18px] w-[18px]" aria-hidden="true" /></span>
    </div>
    {card.value !== undefined
      ? <p className={`mt-3 text-3xl font-bold tracking-tight tabular-nums ${card.tone}`}>{card.money ? formatMoney(animated) : formatCount(animated)}</p>
      : card.failed ? <p className="mt-3 text-3xl font-bold tracking-tight text-slate-400">—</p> : <Skeleton className="mt-4 h-8 w-2/3" />}
    <p className="mt-2 text-xs leading-5 text-slate-500">{card.hint}</p>
  </article>
}

function CountBadge({ value, failed, tone }: { value?: number; failed: boolean; tone: string }) {
  if (value === undefined && !failed) return <Skeleton className="h-6 w-10 rounded-full" />
  return <span className={Number(value) > 0 ? `ui-badge ${tone}` : 'ui-badge ui-badge-neutral'}>{value ?? '—'}</span>
}

export function DashboardPage() {
  const { profile } = useAuth()
  const { online, pending } = useSyncStatus()
  const now = useNow()
  const [metrics, setMetrics] = useState<Metrics | null>(null)
  const [salesMetrics, setSalesMetrics] = useState<SalesMetrics | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [settled, setSettled] = useState(false)
  const [trend, setTrend] = useState<DailySales[] | null>(null)
  const [topProducts, setTopProducts] = useState<TopProduct[] | null>(null)
  const [chartsSettled, setChartsSettled] = useState(false)
  useEffect(() => {
    void Promise.all([
      getInventoryMetrics().then(setMetrics).catch((cause: unknown) => setError(cause instanceof Error ? cause.message : 'Statistiques indisponibles.')),
      getSalesMetrics().then(setSalesMetrics).catch((cause: unknown) => setError(cause instanceof Error ? cause.message : 'Statistiques de ventes indisponibles.'))
    ]).finally(() => setSettled(true))
    // Charts are secondary: a failure leaves an empty state rather than an error banner.
    void Promise.all([
      getSalesTrend(14).then(setTrend).catch(() => undefined),
      getTopProducts(30, 5).then(setTopProducts).catch(() => undefined),
    ]).finally(() => setChartsSettled(true))
  }, [])

  const role = profile?.role?.code ?? ''
  const visibleShortcuts = shortcuts.filter((item) => item.roles.includes(role))
  const firstName = (profile?.full_name || '').split(' ')[0]
  const hour = now.getHours()
  const greeting = hour < 12 ? 'Bonjour' : hour < 18 ? 'Bon après-midi' : 'Bonsoir'
  const todaySales = useCountUp(salesMetrics?.totalSales)
  // Once both requests are done, a missing value means it failed: show a dash, not a shimmer.
  const inventoryFailed = settled && !metrics
  const salesFailed = settled && !salesMetrics

  const cards: Card[] = [
    { label: 'Ventes aujourd\'hui', value: salesMetrics?.totalSales, failed: salesFailed, money: true, hint: `${salesMetrics?.salesCount || 0} transaction(s)`, tone: 'text-brand-700', icon: Banknote, chip: 'bg-brand-100 text-brand-700' },
    { label: 'Produits actifs', value: metrics?.productCount, failed: inventoryFailed, hint: 'Références disponibles au catalogue', tone: 'text-slate-950', icon: Package, chip: 'bg-sky-50 text-sky-700' },
    { label: 'Ruptures', value: metrics?.outOfStock, failed: inventoryFailed, hint: 'Produits à réapprovisionner', tone: Number(metrics?.outOfStock) > 0 ? 'text-red-700' : 'text-slate-950', icon: PackageX, chip: 'bg-red-50 text-red-700' },
    { label: 'Stock faible', value: metrics?.lowStock, failed: inventoryFailed, hint: 'Sous le seuil configuré', tone: Number(metrics?.lowStock) > 0 ? 'text-amber-700' : 'text-slate-950', icon: TriangleAlert, chip: 'bg-amber-50 text-amber-700' },
  ]

  return <div>
    <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-brand-700">Makèt Peyizan · Gestion commerciale</p>
    {error && <p role="alert" className="ui-alert-error">{error}</p>}

    <section aria-label="Bienvenue" className="relative mt-6 overflow-hidden rounded-2xl bg-brand-950 px-6 py-7 text-white shadow-lg shadow-brand-950/10 sm:px-8 animate-fade-up">
      <span aria-hidden="true" className="absolute -right-16 -top-20 h-64 w-64 rounded-full bg-brand-600/40 blur-3xl animate-drift" />
      <span aria-hidden="true" className="absolute -bottom-24 left-1/3 h-56 w-56 rounded-full bg-accent-500/20 blur-3xl animate-drift" style={{ animationDelay: '-6s' }} />
      <span aria-hidden="true" className="absolute inset-0 bg-[radial-gradient(circle_at_1px_1px,rgb(255_255_255/0.07)_1px,transparent_0)] [background-size:22px_22px]" />
      <div className="relative flex flex-wrap items-end justify-between gap-6">
        <div>
          <p className="text-[11px] font-bold uppercase tracking-[0.16em] text-accent-500">{new Intl.DateTimeFormat('fr-HT', { weekday: 'long', day: 'numeric', month: 'long' }).format(now)}</p>
          <h2 className="mt-2 text-2xl font-bold tracking-tight sm:text-3xl">{greeting}{firstName ? `, ${firstName}` : ''}</h2>
          <p className="mt-2 max-w-xl text-sm leading-6 text-white/70">Voici l’essentiel de votre activité. Les raccourcis ci-dessous vous mènent directement aux tâches courantes.</p>
          <span className={`mt-4 inline-flex items-center gap-2 rounded-full px-3 py-1 text-xs font-semibold ring-1 ${online ? 'bg-emerald-400/10 text-emerald-200 ring-emerald-300/30' : 'bg-amber-400/10 text-amber-200 ring-amber-300/30'}`}>
            <span className={`h-1.5 w-1.5 rounded-full ${online ? 'bg-emerald-300' : 'bg-amber-300'}`} />
            {online ? 'Connecté' : 'Hors ligne'}{pending ? ` · ${pending} en attente de synchronisation` : ''}
          </span>
        </div>
        <div className="rounded-xl bg-white/[0.07] px-5 py-4 ring-1 ring-white/10 backdrop-blur-sm">
          <p className="text-xs font-medium text-white/60">Recettes du jour</p>
          {salesMetrics ? <p className="mt-1 text-2xl font-bold tabular-nums">{formatMoney(todaySales)}</p> : salesFailed ? <p className="mt-1 text-2xl font-bold">—</p> : <span className="shimmer-dark mt-2 block h-7 w-36" />}
          <p className="mt-1 text-xs text-white/50">{salesMetrics?.salesCount ?? 0} vente(s) · {new Intl.DateTimeFormat('fr-HT', { timeStyle: 'short' }).format(now)}</p>
        </div>
      </div>
    </section>

    {visibleShortcuts.length > 0 && <section aria-labelledby="shortcuts-title" className="mt-6">
      <h2 id="shortcuts-title" className="text-sm font-bold text-slate-950">Raccourcis</h2>
      <div className="mt-3 grid grid-cols-1 gap-3 min-[420px]:grid-cols-2 lg:grid-cols-3">
        {visibleShortcuts.map((item, index) => <Link key={item.to} to={item.to} style={delay(index + 1)} className="ui-card group flex items-center gap-3 p-3.5 transition hover:-translate-y-0.5 hover:border-brand-600/30 hover:shadow-md animate-fade-up">
          <span className={`grid h-10 w-10 shrink-0 place-items-center rounded-lg transition group-hover:scale-110 ${item.tone}`}><item.icon className="h-5 w-5" aria-hidden="true" /></span>
          <span className="min-w-0 flex-1"><strong className="block truncate text-sm text-slate-900">{item.label}</strong><small className="block truncate text-xs text-slate-500">{item.hint}</small></span>
          <ArrowRight className="h-4 w-4 shrink-0 text-slate-300 transition group-hover:translate-x-0.5 group-hover:text-brand-700" aria-hidden="true" />
        </Link>)}
      </div>
    </section>}

    <section aria-label="Indicateurs" className="mt-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
      {cards.map((card, index) => <StatCard key={card.label} card={card} index={index + 3} />)}
    </section>
    <section aria-label="Tendances" className="mt-6 grid gap-5 xl:grid-cols-[1.4fr_1fr]">
      <article style={delay(7)} className="ui-card p-6 animate-fade-up">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <div><h2 className="text-base font-bold text-slate-950">Ventes des 14 derniers jours</h2><p className="mt-1 text-sm text-slate-600">Montant encaissé par jour, ventes terminées.</p></div>
          {trend && <p className="text-sm text-slate-600">Total : <strong className="text-slate-950">{formatMoney(trend.reduce((sum, day) => sum + day.total, 0))}</strong></p>}
        </div>
        <div className="mt-5">
          {trend ? <ColumnChart ariaLabel="Ventes par jour sur 14 jours" highlightKey={localDay(now)} formatValue={formatMoney}
            data={trend.map((day) => ({ key: day.date, label: new Intl.DateTimeFormat('fr-HT', { day: 'numeric', month: 'short' }).format(new Date(`${day.date}T12:00:00`)), value: day.total, detail: `${day.count} vente(s)` }))} />
            : chartsSettled ? <p className="ui-empty">Historique des ventes indisponible hors ligne.</p>
            : <div role="status" aria-label="Chargement" className="flex h-[220px] items-end gap-2 pl-11">{Array.from({ length: 14 }, (_, index) => <Skeleton key={index} className="flex-1 rounded-b-none" style={{ height: `${30 + ((index * 37) % 60)}%` }} />)}</div>}
        </div>
      </article>
      <article style={delay(8)} className="ui-card p-6 animate-fade-up">
        <h2 className="text-base font-bold text-slate-950">Meilleurs produits</h2>
        <p className="mt-1 text-sm text-slate-600">Chiffre d’affaires des 30 derniers jours.</p>
        <div className="mt-5">
          {topProducts ? <BarList ariaLabel="Meilleurs produits par chiffre d’affaires" formatValue={formatMoney} empty="Aucune vente sur la période."
            data={topProducts.map((product) => ({ key: product.name, label: product.name, value: product.revenue, detail: `× ${formatCount(product.quantity)}` }))} />
            : chartsSettled ? <p className="ui-empty">Données indisponibles hors ligne.</p>
            : <div role="status" aria-label="Chargement" className="space-y-4">{Array.from({ length: 5 }, (_, index) => <div key={index}><Skeleton className="h-3.5 w-1/2" /><Skeleton className="mt-2 h-2.5 rounded-full" /></div>)}</div>}
        </div>
      </article>
    </section>
    <section className="mt-6 grid gap-5 xl:grid-cols-[1.4fr_1fr]">
      <article style={delay(9)} className="ui-card p-6 animate-fade-up"><div className="flex items-start justify-between gap-4"><div><h2 className="text-base font-bold text-slate-950">À traiter</h2><p className="mt-1 text-sm text-slate-600">Accédez directement aux exceptions de stock identifiées.</p></div><Link to="/stock" className="ui-button-secondary shrink-0"><Warehouse className="h-4 w-4" aria-hidden="true" />Voir le stock</Link></div><div className="mt-5 divide-y divide-slate-100 rounded-lg border border-slate-200">
        <div className="flex items-center justify-between gap-3 p-4"><span className="flex items-center gap-2.5 text-sm font-medium"><PackageX className="h-4 w-4 text-red-600" aria-hidden="true" />Produits en rupture</span><CountBadge value={metrics?.outOfStock} failed={inventoryFailed} tone="ui-badge-danger" /></div>
        <div className="flex items-center justify-between gap-3 p-4"><span className="flex items-center gap-2.5 text-sm font-medium"><TriangleAlert className="h-4 w-4 text-amber-600" aria-hidden="true" />Produits sous le seuil</span><CountBadge value={metrics?.lowStock} failed={inventoryFailed} tone="ui-badge-warning" /></div>
      </div></article>
      <article style={delay(10)} className="relative overflow-hidden rounded-xl bg-brand-950 p-6 text-white shadow-sm animate-fade-up">
        <span aria-hidden="true" className="absolute -right-10 -top-10 h-40 w-40 rounded-full bg-accent-500/15 blur-2xl animate-drift" />
        <ShoppingCart aria-hidden="true" className="absolute -bottom-4 right-4 h-28 w-28 text-white/[0.05]" />
        <div className="relative"><p className="text-[11px] font-bold uppercase tracking-[0.14em] text-accent-500">Caisse</p><h2 className="mt-2 text-lg font-bold">Démarrer une vente</h2><p className="mt-3 text-sm leading-6 text-white/70">Ouvrez votre session de caisse, scannez les produits et enregistrez le règlement depuis le point de vente.</p><Link to="/caisse" className="group mt-5 inline-flex items-center gap-2 rounded-lg bg-white px-4 py-2.5 text-sm font-semibold text-brand-950 transition hover:bg-brand-100"><ShoppingCart className="h-4 w-4" aria-hidden="true" />Ouvrir la caisse<ArrowRight className="h-4 w-4 transition group-hover:translate-x-0.5" aria-hidden="true" /></Link></div>
      </article>
    </section>
  </div>
}
