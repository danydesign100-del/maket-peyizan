import { NavLink, Outlet } from 'react-router-dom'
import { ArrowLeftRight, Calculator, CalendarCheck, ChartColumn, Coins, FileText, LayoutDashboard, LogOut, Menu, Package, Receipt, Settings, ShoppingCart, Tags, Truck, UserCog, Users, Wallet, Warehouse, type LucideIcon } from 'lucide-react'
import { useState } from 'react'
import { useAuth } from '../contexts/AuthContext'
import { OfflineBanner, SyncButton } from '../components/SyncStatus'
import { InstallButton, UpdateBanner } from '../components/InstallApp'

type NavItem = { to: string; label: string; icon: LucideIcon; roles?: string[] }
const navigation: NavItem[] = [
  { to: '/', label: 'Tableau de bord', icon: LayoutDashboard },
  { to: '/caisse', label: 'Point de vente', icon: ShoppingCart, roles: ['cashier', 'director', 'administrator'] },
  { to: '/ventes', label: 'Ventes', icon: Receipt },
  { to: '/recettes-journalieres', label: 'Recettes journalières', icon: CalendarCheck, roles: ['cashier', 'director', 'administrator'] },
  { to: '/comptage-caisse', label: 'Comptage de caisse', icon: Coins, roles: ['cashier', 'director', 'administrator', 'accountant'] },
  { to: '/proformas', label: 'Proformas', icon: FileText, roles: ['cashier', 'director', 'administrator'] },
  { to: '/produits', label: 'Produits', icon: Package },
  { to: '/categories', label: 'Catégories', icon: Tags, roles: ['director', 'administrator', 'stock_manager'] },
  { to: '/stock', label: 'Stocks', icon: Warehouse },
  { to: '/stock/mouvements', label: 'Mouvements', icon: ArrowLeftRight, roles: ['director', 'administrator', 'stock_manager'] },
  { to: '/clients', label: 'Clients', icon: Users },
  { to: '/fournisseurs', label: 'Fournisseurs', icon: Truck, roles: ['director', 'administrator', 'stock_manager'] },
  { to: '/depenses', label: 'Dépenses', icon: Wallet, roles: ['director', 'administrator', 'accountant'] },
  { to: '/rapports', label: 'Rapports', icon: ChartColumn, roles: ['director', 'administrator', 'accountant'] },
  { to: '/comptabilite', label: 'Comptabilité', icon: Calculator, roles: ['director', 'administrator', 'accountant'] },
  { to: '/utilisateurs', label: 'Utilisateurs', icon: UserCog, roles: ['director', 'administrator'] },
  { to: '/parametres', label: 'Paramètres', icon: Settings, roles: ['director', 'administrator'] },
]

const roleLabels: Record<string, string> = { director: 'Directeur', administrator: 'Administrateur', accountant: 'Comptable', cashier: 'Caissière', stock_manager: 'Gestionnaire de stock' }

export function AppLayout() {
  const { profile, signOut } = useAuth()
  const [open, setOpen] = useState(false)
  const role = profile?.role?.code ?? ''
  const visibleNavigation = navigation.filter((item) => !item.roles || item.roles.includes(role))
  const close = () => setOpen(false)

  return <div className="min-h-screen bg-slate-50 lg:grid lg:grid-cols-[16.5rem_minmax(0,1fr)]">
    <header className="no-print flex h-16 items-center justify-between border-b border-slate-200 bg-white px-4 lg:hidden">
      <NavLink to="/" className="flex items-center gap-2 whitespace-nowrap text-sm font-bold text-brand-950"><span className="grid h-8 w-8 place-items-center rounded-lg bg-accent-500 text-xs">MP</span>Makèt Peyizan</NavLink>
      <div className="flex items-center gap-2"><SyncButton tone="light" /><button aria-expanded={open} aria-label="Ouvrir le menu" onClick={() => setOpen((value) => !value)} className="ui-button-secondary gap-2 px-3 py-2"><Menu className="h-4 w-4" aria-hidden="true" />Menu</button></div>
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
          <item.icon aria-hidden="true" className="h-[18px] w-[18px] shrink-0" strokeWidth={1.9} />{item.label}
        </NavLink>)}
      </nav>
      <div className="mt-4 border-t border-white/10 pt-4">
        <div className="mb-4 space-y-2 px-1"><InstallButton /><SyncButton /></div>
        <div className="flex items-center gap-3 px-3"><span className="grid h-8 w-8 place-items-center rounded-full bg-white/10 text-xs font-bold">{(profile?.full_name || 'U').slice(0, 1).toUpperCase()}</span><span className="min-w-0"><strong className="block truncate text-sm">{profile?.full_name || 'Utilisateur'}</strong><small className="block truncate text-[11px] text-white/55">{roleLabels[role] || ''}</small></span></div>
        <button onClick={() => void signOut()} className="mt-3 flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left text-sm text-white/65 transition hover:bg-white/10 hover:text-white"><LogOut className="h-[18px] w-[18px]" aria-hidden="true" />Déconnexion</button>
      </div>
    </aside>
    <main className="min-w-0 px-4 py-6 sm:px-6 lg:px-9 lg:py-8 xl:px-11"><OfflineBanner /><Outlet /></main>
    <UpdateBanner />
  </div>
}
