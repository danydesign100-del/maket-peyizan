import { useState } from 'react'
import { ShieldCheck, Users } from 'lucide-react'
import { PageHeader } from '../components/PageHeader'
import { useAuth } from '../contexts/AuthContext'
import { RolesTab } from './users/RolesTab'
import { UsersTab } from './users/UsersTab'

type Tab = 'users' | 'roles'

export function UsersPage() {
  const { profile, can } = useAuth()
  const canManageUsers = can('users.manage')
  const canManageRoles = can('roles.manage')
  const [tab, setTab] = useState<Tab>(canManageUsers ? 'users' : 'roles')
  if (!canManageUsers && !canManageRoles) {
    return <div className="rounded-lg bg-red-50 p-6 text-red-800"><h2 className="text-lg font-semibold">Accès refusé</h2><p className="mt-2">Seuls les responsables autorisés gèrent les utilisateurs.</p></div>
  }
  const tabs: { id: Tab; label: string; icon: typeof Users }[] = [
    ...(canManageUsers ? [{ id: 'users' as const, label: 'Utilisateurs', icon: Users }] : []),
    ...(canManageRoles ? [{ id: 'roles' as const, label: 'Rôles et permissions', icon: ShieldCheck }] : []),
  ]
  return <div>
    <PageHeader title="Utilisateurs" description="Comptes, identifiants, mots de passe, rôles et historique des activités." />
    <div role="tablist" aria-label="Utilisateurs" className="mt-6 flex gap-1 border-b border-slate-200">
      {tabs.map((item) => <button key={item.id} role="tab" aria-selected={tab === item.id} onClick={() => setTab(item.id)} className={`-mb-px inline-flex items-center gap-1.5 border-b-2 px-4 py-2.5 text-sm transition ${tab === item.id ? 'border-brand-700 font-semibold text-brand-900' : 'border-transparent text-slate-600 hover:text-slate-900'}`}><item.icon className="h-4 w-4" aria-hidden="true" />{item.label}</button>)}
    </div>
    <div className="mt-5">{tab === 'users' && canManageUsers && <UsersTab currentUserId={profile?.id} />}{tab === 'roles' && canManageRoles && <RolesTab />}</div>
  </div>
}
