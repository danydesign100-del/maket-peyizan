import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { PageHeader } from '../components/PageHeader'
import { getInventoryMetrics, getSalesMetrics } from '../services/dashboardService'

type Metrics = { productCount: number; outOfStock: number; lowStock: number; stockValue: number }
type SalesMetrics = { salesCount: number; totalSales: number; transactionCount: number }
const formatMoney = (value: number) => new Intl.NumberFormat('fr-HT', { style: 'currency', currency: 'HTG', maximumFractionDigits: 2 }).format(value)

export function DashboardPage() {
  const [metrics, setMetrics] = useState<Metrics | null>(null)
  const [salesMetrics, setSalesMetrics] = useState<SalesMetrics | null>(null)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => { 
    Promise.all([
      getInventoryMetrics().then(setMetrics).catch((cause: unknown) => setError(cause instanceof Error ? cause.message : 'Statistiques indisponibles.')),
      getSalesMetrics().then(setSalesMetrics).catch((cause: unknown) => setError(cause instanceof Error ? cause.message : 'Statistiques de ventes indisponibles.'))
    ])
  }, [])
  const cards = [
    { label: 'Ventes aujourd\'hui', value: salesMetrics ? formatMoney(salesMetrics.totalSales) : undefined, hint: `${salesMetrics?.salesCount || 0} transaction(s)`, tone: 'text-brand-700' },
    { label: 'Produits actifs', value: metrics?.productCount, hint: 'Références disponibles au catalogue', tone: 'text-slate-950' },
    { label: 'Ruptures', value: metrics?.outOfStock, hint: 'Produits à réapprovisionner', tone: Number(metrics?.outOfStock) > 0 ? 'text-red-700' : 'text-slate-950' },
    { label: 'Stock faible', value: metrics?.lowStock, hint: 'Sous le seuil configuré', tone: Number(metrics?.lowStock) > 0 ? 'text-amber-700' : 'text-slate-950' },
  ]
  return <div>
    <PageHeader title="Tableau de bord" description="Suivez les données opérationnelles réelles du catalogue, du stock et des ventes." />
    {error && <p role="alert" className="ui-alert-error">{error}</p>}
    <section aria-label="Indicateurs" className="mt-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
      {cards.map((card) => <article key={card.label} className="ui-card p-5"><p className="text-sm font-medium text-slate-600">{card.label}</p><p className={`mt-3 text-3xl font-bold tracking-tight ${card.tone}`}>{card.value ?? '—'}</p><p className="mt-2 text-xs leading-5 text-slate-500">{card.hint}</p></article>)}
    </section>
    <section className="mt-6 grid gap-5 xl:grid-cols-[1.4fr_1fr]">
      <article className="ui-card p-6"><div className="flex items-start justify-between gap-4"><div><h2 className="text-base font-bold text-slate-950">À traiter</h2><p className="mt-1 text-sm text-slate-600">Accédez directement aux exceptions de stock identifiées.</p></div><Link to="/stock" className="ui-button-secondary shrink-0">Voir le stock</Link></div><div className="mt-5 divide-y divide-slate-100 rounded-lg border border-slate-200">
        <div className="flex items-center justify-between gap-3 p-4"><span className="text-sm font-medium">Produits en rupture</span><span className={Number(metrics?.outOfStock) > 0 ? 'ui-badge ui-badge-danger' : 'ui-badge ui-badge-neutral'}>{metrics ? metrics.outOfStock : '—'}</span></div>
        <div className="flex items-center justify-between gap-3 p-4"><span className="text-sm font-medium">Produits sous le seuil</span><span className={Number(metrics?.lowStock) > 0 ? 'ui-badge ui-badge-warning' : 'ui-badge ui-badge-neutral'}>{metrics ? metrics.lowStock : '—'}</span></div>
      </div></article>
      <article className="rounded-xl bg-brand-950 p-6 text-white shadow-sm"><p className="text-[11px] font-bold uppercase tracking-[0.14em] text-accent-500">Caisse</p><h2 className="mt-2 text-lg font-bold">Démarrer une vente</h2><p className="mt-3 text-sm leading-6 text-white/70">Ouvrez votre session de caisse, scannez les produits et enregistrez le règlement depuis le point de vente.</p><Link to="/caisse" className="mt-5 inline-flex rounded-lg bg-white px-4 py-2.5 text-sm font-semibold text-brand-950 transition hover:bg-brand-100">Ouvrir la caisse</Link></article>
    </section>
  </div>
}
