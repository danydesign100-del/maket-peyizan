import { NavLink, Outlet } from 'react-router-dom'
import { useEffect, useState } from 'react'
import { useAuth } from '../contexts/AuthContext'
import { pendingSaleCount } from '../services/offlineSales'
import { isSupabaseConfigured } from '../lib/supabase'

type NavItem = { to: string; label: string; short: string; roles?: string[] }
const navigation: NavItem[] = [
  { to: '/', label: 'Tableau de bord', short: 'TB' },
  { to: '/caisse', label: 'Point de vente', short: 'PV', roles: ['cashier', 'director', 'administrator'] },
  { to: '/ventes', label: 'Ventes', short: 'VT' },
  { to: '/recettes-journalieres', label: 'Recettes journalières', short: 'RJ', roles: ['cashier', 'director', 'administrator'] },
  { to: '/proformas', label: 'Proformas', short: 'PF', roles: ['cashier', 'director', 'administrator'] },
  { to: '/produits', label: 'Produits', short: 'PD' },
  { to: '/categories', label: 'Catégories', short: 'CT', roles: ['director', 'administrator', 'stock_manager'] },
  { to: '/stock', label: 'Stocks', short: 'ST' },
  { to: '/stock/mouvements', label: 'Mouvements', short: 'MV', roles: ['director', 'administrator', 'stock_manager'] },
  { to: '/clients', label: 'Clients', short: 'CL' },
  { to: '/fournisseurs', label: 'Fournisseurs', short: 'FR', roles: ['director', 'administrator', 'stock_manager'] },
  { to: '/depenses', label: 'Dépenses', short: 'DP', roles: ['director', 'administrator', 'accountant'] },
  { to: '/rapports', label: 'Rapports', short: 'RP', roles: ['director', 'administrator', 'accountant'] },
  { to: '/comptabilite', label: 'Comptabilité', short: 'CP', roles: ['director', 'administrator', 'accountant'] },
  { to: '/utilisateurs', label: 'Utilisateurs', short: 'US', roles: ['director', 'administrator'] },
  { to: '/parametres', label: 'Paramètres', short: 'PM', roles: ['director', 'administrator'] },
]

const roleLabels: Record<string, string> = { director: 'Directeur', administrator: 'Administrateur', accountant: 'Comptable', cashier: 'Caissière', stock_manager: 'Gestionnaire de stock' }

export function AppLayout() {
  const { profile, signOut } = useAuth()
  const [open, setOpen] = useState(false)
  const [pendingSync, setPendingSync] = useState(0)
  const role = profile?.role?.code ?? ''
  const visibleNavigation = navigation.filter((item) => !item.roles || item.roles.includes(role))
  const close = () => setOpen(false)
  useEffect(() => { if (isSupabaseConfigured) void pendingSaleCount().then(setPendingSync).catch(() => undefined) }, [])

  return <div className="min-h-screen bg-slate-50 lg:grid lg:grid-cols-[16.5rem_minmax(0,1fr)]">
    <header className="no-print flex h-16 items-center justify-between border-b border-slate-200 bg-white px-4 lg:hidden">
      <NavLink to="/" className="flex items-center gap-2 font-bold text-brand-950"><span className="grid h-8 w-8 place-items-center rounded-lg bg-accent-500 text-xs">MP</span>Makèt Peyizan</NavLink>
      <button aria-expanded={open} aria-label="Ouvrir le menu" onClick={() => setOpen((value) => !value)} className="ui-button-secondary px-3 py-2">Menu</button>
    </header>
    {open && <button aria-label="Fermer le menu" onClick={close} className="no-print fixed inset-0 z-20 bg-slate-950/30 lg:hidden" />}
    <aside className={`no-print fixed inset-y-0 left-0 z-30 flex w-[16.5rem] flex-col bg-brand-950 px-3 py-4 text-white shadow-2xl transition-transform lg:sticky lg:top-0 lg:h-screen lg:w-auto lg:translate-x-0 lg:shadow-none ${open ? 'translate-x-0' : '-translate-x-full'}`}>
      <NavLink to="/" onClick={close} className="flex items-center gap-3 rounded-lg px-3 py-2">
        <span className="grid h-9 w-9 place-items-center rounded-lg bg-accent-500 text-xs font-black text-brand-950">MP</span>
        <span><strong className="block text-sm tracking-tight">Makèt Peyizan</strong><small className="text-[11px] text-white/60">Sistèm jesyon komès</small></span>
      </NavLink>
      <p className="mt-7 px-3 text-[10px] font-bold uppercase tracking-[0.15em] text-white/45">Navigation</p>
      <nav aria-label="Navigation principale" className="mt-2 flex-1 space-y-1 overflow-y-auto pr-1">
        {visibleNavigation.map((item) => <NavLink key={item.to} to={item.to} end={item.to === '/'} onClick={close} className={({ isActive }) => `flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm transition ${isActive ? 'bg-white text-brand-950 font-semibold shadow-sm' : 'text-white/72 hover:bg-white/10 hover:text-white'}`}>
          <span aria-hidden="true" className={`grid h-6 w-6 place-items-center rounded text-[9px] font-bold ${item.to === '/' ? 'bg-accent-500/20 text-accent-500' : 'bg-white/10 text-white/70'}`}>{item.short}</span>{item.label}
        </NavLink>)}
      </nav>
      <div className="mt-4 border-t border-white/10 pt-4">
        {pendingSync > 0 && <p className="mx-3 mb-3 rounded-md bg-accent-500/15 px-2.5 py-2 text-xs text-accent-100">{pendingSync} vente(s) en attente de synchronisation</p>}
        <div className="flex items-center gap-3 px-3"><span className="grid h-8 w-8 place-items-center rounded-full bg-white/10 text-xs font-bold">{(profile?.full_name || 'U').slice(0, 1).toUpperCase()}</span><span className="min-w-0"><strong className="block truncate text-sm">{profile?.full_name || 'Utilisateur'}</strong><small className="block truncate text-[11px] text-white/55">{roleLabels[role] || ''}</small></span></div>
        <button onClick={() => void signOut()} className="mt-3 w-full rounded-lg px-3 py-2 text-left text-sm text-white/65 transition hover:bg-white/10 hover:text-white">Déconnexion</button>
      </div>
    </aside>
    <main className="min-w-0 px-4 py-6 sm:px-6 lg:px-9 lg:py-8 xl:px-11"><Outlet /></main>
  </div>
}
