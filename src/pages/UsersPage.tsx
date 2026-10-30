import { Save, UserPlus, X } from 'lucide-react'
import { TableRowsSkeleton } from '../components/Skeleton'
import { useEffect, useState, type FormEvent } from 'react'
import { PageHeader } from '../components/PageHeader'
import { useAuth } from '../contexts/AuthContext'
import { cachedRead } from '../lib/offline/wrap'
import { getSupabaseClient, isLocalDbConfigured } from '../lib/supabase'
import { localApi } from '../lib/localApi'

type NewUserInput = {
  email: string
  full_name: string
  role_id: string
}

const emptyUser: NewUserInput = { email: '', full_name: '', role_id: '' }

export function UsersPage() {
  const { profile } = useAuth()
  const canManageUsers = profile?.role?.code === 'director' || profile?.role?.code === 'administrator'
  
  const [users, setUsers] = useState<any[]>([])
  const [roles, setRoles] = useState<any[]>([])
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [notice, setNotice] = useState<string | null>(null)
  const [showAddForm, setShowAddForm] = useState(false)
  const [newUser, setNewUser] = useState<NewUserInput>(emptyUser)
  const [submitting, setSubmitting] = useState(false)
  
  useEffect(() => {
    void loadData()
  }, [])
  
  const loadData = async () => {
    try {
      const data = await cachedRead('users', async () => {
        if (isLocalDbConfigured) return localApi.getManagedUsers()
        const client = getSupabaseClient()

        const [usersData, rolesData] = await Promise.all([
          client.from('profiles').select('id, full_name, email, active, role_id, role:roles(code, name)').order('full_name'),
          client.from('roles').select('*').order('name')
        ])

        if (usersData.error) throw usersData.error
        if (rolesData.error) throw rolesData.error
        return { users: (usersData.data || []) as any[], roles: (rolesData.data || []) as any[] }
      }, { style: 'throw' })
      setUsers(data.users as any)
      setRoles(data.roles as any)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Erreur de chargement')
    } finally { setLoading(false) }
  }
  
  const toggleActive = async (userId: string, currentActive: boolean) => {
    try {
      if (isLocalDbConfigured) {
        await localApi.updateManagedUser(userId, { active: !currentActive })
        await loadData()
        return
      }
      const client = getSupabaseClient()
      const { error } = await client.from('profiles').update({ active: !currentActive }).eq('id', userId)
      if (error) throw error
      await loadData()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Erreur de modification')
    }
  }
  
  const changeRole = async (userId: string, newRoleId: string) => {
    try {
      if (isLocalDbConfigured) {
        await localApi.updateManagedUser(userId, { role_id: newRoleId })
        await loadData()
        return
      }
      const client = getSupabaseClient()
      const { error } = await client.from('profiles').update({ role_id: newRoleId }).eq('id', userId)
      if (error) throw error
      await loadData()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Erreur de modification')
    }
  }

  const createUser = async (event: FormEvent) => {
    event.preventDefault()
    if (!newUser.email.trim() || !newUser.full_name.trim() || !newUser.role_id) {
      return setError('Tous les champs sont obligatoires')
    }

    setSubmitting(true)
    setError(null)
    setNotice(null)

    try {
      if (isLocalDbConfigured) {
        // Pour la base locale, utiliser l'API serveur
        const tempPassword = Math.random().toString(36).slice(-8)
        
        await localApi.mutate('insert', 'profiles', {
          id: crypto.randomUUID(),
          email: newUser.email.trim(),
          full_name: newUser.full_name.trim(),
          role_id: newUser.role_id,
          active: true
        })
        
        setNotice(`Utilisateur créé. Mot de passe temporaire : ${tempPassword} (à communiquer manuellement)`)
      } else {
        // Pour Supabase, créer l'utilisateur via RPC qui envoie l'invitation
        const client = getSupabaseClient()
        const { error: createError } = await client.rpc('create_user_with_invitation', {
          p_email: newUser.email.trim(),
          p_full_name: newUser.full_name.trim(),
          p_role_id: newUser.role_id
        })
        
        if (createError) throw createError
        
        setNotice(`Invitation envoyée à ${newUser.email}`)
      }
      
      setNewUser(emptyUser)
      setShowAddForm(false)
      await loadData()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Erreur de création')
    } finally {
      setSubmitting(false)
    }
  }
  
  if (!canManageUsers) {
    return (
      <div className="rounded-lg bg-red-50 p-6 text-red-800">
        <h2 className="text-lg font-semibold">Accès refusé</h2>
        <p className="mt-2">Seuls les directeurs peuvent gérer les utilisateurs.</p>
      </div>
    )
  }
  
  return (
    <div>
      <PageHeader title="Utilisateurs" description="Gestion des comptes et rôles" />
      
      {error && <div className="mt-4 rounded bg-red-50 p-3 text-red-800">{error}</div>}
      {notice && <div className="mt-4 rounded bg-emerald-50 p-3 text-emerald-800">{notice}</div>}
      
      <div className="no-print mt-4">
        <button onClick={() => setShowAddForm(true)} className="ui-button-primary">
          <UserPlus className="h-4 w-4" aria-hidden="true" />Ajouter un utilisateur
        </button>
      </div>
      
      {showAddForm && (
        <form onSubmit={createUser} className="mt-6 rounded-xl bg-white p-6 shadow-sm ring-1 ring-slate-200">
          <h2 className="text-lg font-semibold">Nouvel utilisateur</h2>
          <div className="mt-4 grid gap-4 md:grid-cols-2">
            <div>
              <label className="block text-sm font-medium">Nom complet *</label>
              <input
                type="text"
                value={newUser.full_name}
                onChange={(e) => setNewUser({ ...newUser, full_name: e.target.value })}
                className="mt-1 w-full rounded border p-2"
                required
              />
            </div>
            <div>
              <label className="block text-sm font-medium">Email *</label>
              <input
                type="email"
                value={newUser.email}
                onChange={(e) => setNewUser({ ...newUser, email: e.target.value })}
                className="mt-1 w-full rounded border p-2"
                required
              />
            </div>
            <div>
              <label className="block text-sm font-medium">Rôle *</label>
              <select
                value={newUser.role_id}
                onChange={(e) => setNewUser({ ...newUser, role_id: e.target.value })}
                className="mt-1 w-full rounded border p-2"
                required
              >
                <option value="">Sélectionner un rôle</option>
                {roles.map((role) => (
                  <option key={role.id} value={role.id}>{role.name}</option>
                ))}
              </select>
            </div>
          </div>
          <div className="mt-4 flex gap-3">
            <button type="submit" disabled={submitting} className="ui-button-primary">
              <Save className="h-4 w-4" aria-hidden="true" />{submitting ? 'Création...' : 'Créer'}
            </button>
            <button type="button" onClick={() => { setShowAddForm(false); setNewUser(emptyUser) }} className="ui-button-secondary">
              <X className="h-4 w-4" aria-hidden="true" />Annuler
            </button>
          </div>
        </form>
      )}
      
      <div className="mt-6 overflow-x-auto rounded-xl bg-white shadow-sm ring-1 ring-slate-200">
        <table className="w-full text-left text-sm">
          <thead className="bg-slate-50">
            <tr>
              <th className="p-3">Nom</th>
              <th className="p-3">Email</th>
              <th className="p-3">Rôle</th>
              <th className="p-3">Actif</th>
              <th className="p-3">Actions</th>
            </tr>
          </thead>
          <tbody>
            {loading ? <TableRowsSkeleton cols={5} /> : users.length === 0 ? (
              <tr><td colSpan={5} className="p-6 text-center text-slate-500">Aucun utilisateur</td></tr>
            ) : users.map((user) => (
              <tr key={user.id} className="border-t">
                <td className="p-3 font-medium">{user.full_name}</td>
                <td className="p-3">{user.email}</td>
                <td className="p-3">
                  <select
                    value={user.role_id}
                    onChange={(e) => void changeRole(user.id, e.target.value)}
                    className="rounded border p-1"
                    disabled={user.id === profile?.id}
                  >
                    {roles.map((role) => (
                      <option key={role.id} value={role.id}>{role.name}</option>
                    ))}
                  </select>
                </td>
                <td className="p-3">
                  <button
                    onClick={() => void toggleActive(user.id, user.active)}
                    disabled={user.id === profile?.id}
                    className={`rounded px-2 py-1 text-xs ${
                      user.active 
                        ? 'bg-emerald-100 text-emerald-800' 
                        : 'bg-slate-100 text-slate-800'
                    } disabled:opacity-50`}
                  >
                    {user.active ? 'Actif' : 'Inactif'}
                  </button>
                </td>
                <td className="p-3 text-slate-400">
                  {user.id === profile?.id && '(vous)'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      
      <div className="mt-6 rounded-xl bg-white p-6 shadow-sm ring-1 ring-slate-200">
        <h3 className="text-lg font-semibold">Rôles disponibles</h3>
        <dl className="mt-4 space-y-3">
          {roles.map((role) => (
            <div key={role.id} className="flex items-start gap-3">
              <dt className="font-medium">{role.name}</dt>
              <dd className="text-slate-600">{role.description}</dd>
            </div>
          ))}
        </dl>
      </div>
    </div>
  )
}
