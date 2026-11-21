import { useEffect, useState, type FormEvent } from 'react'
import { History, KeyRound, Pencil, Save, UserPlus, Wand2 } from 'lucide-react'
import { Modal } from '../../components/Modal'
import { TableRowsSkeleton } from '../../components/Skeleton'
import { auditLabel } from '../../lib/auditLabels'
import { errorText } from '../../lib/errors'
import { formatDateTime } from '../../lib/period'
import { isPlaceholderEmail, userService, type Activity, type ManagedUser, type NewUser, type Role } from '../../services/userService'

/** Random password without ambiguous characters, to give to the person. */
const generatePassword = () => Array.from(crypto.getRandomValues(new Uint32Array(10)), (value) => 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789'[value % 55]).join('')
/** « Rose Marie Caisse » → « rose.caisse ». */
const suggestUsername = (name: string) => {
  const parts = name.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9 ]/g, ' ').split(/\s+/).filter(Boolean)
  return parts.length > 1 ? `${parts[0]}.${parts.at(-1)}` : parts[0] ?? ''
}

function PasswordField({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  return <label className="block text-sm font-medium text-slate-700">Mot de passe *
    <span className="mt-1 flex gap-2"><input required minLength={8} value={value} onChange={(event) => onChange(event.target.value)} className="min-w-0 flex-1 font-mono" autoComplete="new-password" />
      <button type="button" onClick={() => onChange(generatePassword())} className="ui-button-secondary px-3"><Wand2 className="h-4 w-4" aria-hidden="true" />Générer</button></span>
    <span className="mt-1 block text-xs font-normal text-slate-500">8 caractères minimum. Communiquez-le à la personne : elle pourra le changer dans Paramètres › Mon compte.</span>
  </label>
}

function CreateDialog({ roles, onClose, onDone }: { roles: Role[]; onClose: () => void; onDone: (message: string) => void }) {
  const [form, setForm] = useState<NewUser>({ full_name: '', username: '', email: '', role_id: roles.find((role) => role.code === 'cashier')?.id ?? '', password: generatePassword() })
  const [usernameTouched, setUsernameTouched] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const submit = async (event: FormEvent) => {
    event.preventDefault()
    setSaving(true); setError(null)
    try {
      await userService.create({ ...form, username: form.username.trim().toLowerCase() })
      onDone(`Compte de ${form.full_name} créé. Identifiant : ${form.username.trim().toLowerCase()} · mot de passe : ${form.password}`)
    } catch (cause) { setError(errorText(cause, 'Création impossible')) } finally { setSaving(false) }
  }
  const field = 'block text-sm font-medium text-slate-700'
  return <Modal title="Nouvel utilisateur" onClose={onClose} locked={saving}
    footer={<><button type="button" onClick={onClose} className="ui-button-secondary">Annuler</button><button type="submit" form="user-form" disabled={saving} className="ui-button-primary"><Save className="h-4 w-4" aria-hidden="true" />{saving ? 'Création…' : 'Créer le compte'}</button></>}>
    <form id="user-form" onSubmit={submit} className="grid gap-4 sm:grid-cols-2">
      {error && <p role="alert" className="ui-alert-error mt-0 sm:col-span-2">{error}</p>}
      <label className={field}>Nom complet *<input autoFocus required value={form.full_name} onChange={(event) => setForm((current) => ({ ...current, full_name: event.target.value, username: usernameTouched ? current.username : suggestUsername(event.target.value) }))} className="mt-1 w-full" /></label>
      <label className={field}>Nom d’utilisateur *<input required pattern="[a-z0-9][a-z0-9._\-]{2,31}" value={form.username} onChange={(event) => { setUsernameTouched(true); setForm((current) => ({ ...current, username: event.target.value.toLowerCase() })) }} className="mt-1 w-full font-mono" autoCapitalize="none" />
        <span className="mt-1 block text-xs font-normal text-slate-500">Pour se connecter. Lettres minuscules, chiffres, point ou tiret.</span></label>
      <label className={field}>E-mail (facultatif)<input type="email" value={form.email} onChange={(event) => setForm((current) => ({ ...current, email: event.target.value }))} className="mt-1 w-full" />
        <span className="mt-1 block text-xs font-normal text-slate-500">Permet aussi de se connecter et de réinitialiser soi-même son mot de passe.</span></label>
      <label className={field}>Rôle *<select required value={form.role_id} onChange={(event) => setForm((current) => ({ ...current, role_id: event.target.value }))} className="mt-1 w-full">{roles.map((role) => <option key={role.id} value={role.id}>{role.name}</option>)}</select></label>
      <div className="sm:col-span-2"><PasswordField value={form.password} onChange={(password) => setForm((current) => ({ ...current, password }))} /></div>
    </form>
  </Modal>
}

function EditDialog({ user, onClose, onDone }: { user: ManagedUser; onClose: () => void; onDone: (message: string) => void }) {
  const [fullName, setFullName] = useState(user.full_name)
  const [username, setUsername] = useState(user.username ?? '')
  const [email, setEmail] = useState(isPlaceholderEmail(user.email) ? '' : user.email ?? '')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const submit = async (event: FormEvent) => {
    event.preventDefault()
    setSaving(true); setError(null)
    try {
      await userService.update(user.id, { full_name: fullName.trim(), username: username.trim().toLowerCase() || null, ...(email.trim() && email.trim() !== user.email ? { email: email.trim() } : {}) })
      onDone(`Compte de ${fullName.trim()} modifié.`)
    } catch (cause) { setError(errorText(cause, 'Modification impossible')) } finally { setSaving(false) }
  }
  return <Modal size="sm" title="Modifier le compte" subtitle={user.full_name} onClose={onClose} locked={saving}
    footer={<><button type="button" onClick={onClose} className="ui-button-secondary">Annuler</button><button type="submit" form="edit-user-form" disabled={saving} className="ui-button-primary"><Save className="h-4 w-4" aria-hidden="true" />Enregistrer</button></>}>
    <form id="edit-user-form" onSubmit={submit} className="space-y-3">
      {error && <p role="alert" className="ui-alert-error mt-0">{error}</p>}
      <label className="block text-sm font-medium text-slate-700">Nom complet *<input required value={fullName} onChange={(event) => setFullName(event.target.value)} className="mt-1 w-full" /></label>
      <label className="block text-sm font-medium text-slate-700">Nom d’utilisateur<input value={username} onChange={(event) => setUsername(event.target.value.toLowerCase())} className="mt-1 w-full font-mono" autoCapitalize="none" /></label>
      <label className="block text-sm font-medium text-slate-700">E-mail<input type="email" value={email} onChange={(event) => setEmail(event.target.value)} className="mt-1 w-full" /></label>
    </form>
  </Modal>
}

function PasswordDialog({ user, onClose, onDone }: { user: ManagedUser; onClose: () => void; onDone: (message: string) => void }) {
  const [password, setPassword] = useState(generatePassword)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const submit = async (event: FormEvent) => {
    event.preventDefault()
    setSaving(true); setError(null)
    try { await userService.setPassword(user.id, password); onDone(`Nouveau mot de passe de ${user.full_name} : ${password}`) } catch (cause) { setError(errorText(cause, 'Réinitialisation impossible')) } finally { setSaving(false) }
  }
  return <Modal size="sm" title="Réinitialiser le mot de passe" subtitle={user.full_name} onClose={onClose} locked={saving}
    footer={<><button type="button" onClick={onClose} className="ui-button-secondary">Annuler</button><button type="submit" form="password-form" disabled={saving} className="ui-button-primary"><KeyRound className="h-4 w-4" aria-hidden="true" />Enregistrer le mot de passe</button></>}>
    <form id="password-form" onSubmit={submit}>
      {error && <p role="alert" className="ui-alert-error mt-0 mb-3">{error}</p>}
      <PasswordField value={password} onChange={setPassword} />
    </form>
  </Modal>
}

function ActivityDialog({ user, onClose }: { user: ManagedUser; onClose: () => void }) {
  const [rows, setRows] = useState<Activity[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => { void userService.activity(user.id).then(setRows).catch((cause) => setError(errorText(cause))) }, [user.id])
  return <Modal size="lg" title="Historique des activités" subtitle={`${user.full_name} · 200 dernières opérations tracées`} onClose={onClose}
    footer={<button type="button" onClick={onClose} className="ui-button-primary">Fermer</button>}>
    {error && <p role="alert" className="ui-alert-error mt-0">{error}</p>}
    <div className="overflow-x-auto rounded-lg border border-slate-200">
      <table className="ui-table text-sm">
        <thead><tr><th>Date</th><th>Opération</th><th>Élément</th><th>Résultat</th></tr></thead>
        <tbody>{rows === null ? <TableRowsSkeleton rows={4} cols={4} /> : rows.length === 0 ? <tr><td colSpan={4} className="ui-empty">Aucune opération tracée pour ce compte.</td></tr>
          : rows.map((row) => <tr key={row.id}><td className="whitespace-nowrap tabular-nums">{formatDateTime(row.created_at)}</td><td>{auditLabel(row.action)}</td><td className="text-slate-600">{row.entity_type ?? '-'}</td><td>{row.success ? <span className="ui-badge ui-badge-success">Réussi</span> : <span className="ui-badge ui-badge-danger">Échec</span>}</td></tr>)}</tbody>
      </table>
    </div>
  </Modal>
}

/** Accounts: creation (with user name and password), edit, password reset, role, activation, activity. */
export function UsersTab({ currentUserId }: { currentUserId: string | undefined }) {
  const [users, setUsers] = useState<ManagedUser[] | null>(null)
  const [roles, setRoles] = useState<Role[]>([])
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [dialog, setDialog] = useState<{ kind: 'create' } | { kind: 'edit' | 'password' | 'activity'; user: ManagedUser } | null>(null)
  const [refresh, setRefresh] = useState(0)
  useEffect(() => { void userService.list().then((data) => { setUsers(data.users); setRoles(data.roles) }).catch((cause) => setError(errorText(cause))) }, [refresh])
  const done = (message: string) => { setNotice(message); setError(null); setDialog(null); setRefresh((value) => value + 1) }
  const setAccess = async (user: ManagedUser, input: { active?: boolean; role_id?: string }) => {
    try { await userService.setAccess(user.id, input); done(input.active === undefined ? `Rôle de ${user.full_name} modifié.` : `Compte de ${user.full_name} ${input.active ? 'activé' : 'désactivé'}.`) } catch (cause) { setError(errorText(cause)) }
  }
  const icon = 'rounded p-1.5 text-slate-500 hover:bg-slate-100 hover:text-brand-700'
  return <div className="space-y-4">
    {notice && <p role="status" className="ui-alert-success mt-0 font-medium">{notice}</p>}
    {error && <p role="alert" className="ui-alert-error mt-0">{error}</p>}
    <button type="button" onClick={() => setDialog({ kind: 'create' })} className="ui-button-primary"><UserPlus className="h-4 w-4" aria-hidden="true" />Ajouter un utilisateur</button>
    <div className="ui-card overflow-x-auto">
      <table className="ui-table text-sm">
        <thead><tr><th>Nom</th><th>Identifiant</th><th>E-mail</th><th>Rôle</th><th>Statut</th><th className="text-right">Actions</th></tr></thead>
        <tbody>
          {users === null ? <TableRowsSkeleton cols={6} /> : users.length === 0 ? <tr><td colSpan={6} className="ui-empty">Aucun utilisateur.</td></tr>
            : users.map((user) => {
              const self = user.id === currentUserId
              return <tr key={user.id} className={user.active ? '' : 'text-slate-400'}>
                <td className="font-medium">{user.full_name}{self && <span className="ml-2 text-xs text-slate-500">(vous)</span>}</td>
                <td className="font-mono text-xs">{user.username ?? '-'}</td>
                <td className="text-slate-600">{isPlaceholderEmail(user.email) ? '-' : user.email}</td>
                <td><select value={user.role_id} disabled={self} onChange={(event) => void setAccess(user, { role_id: event.target.value })} aria-label={`Rôle de ${user.full_name}`} className="rounded border p-1">{roles.map((role) => <option key={role.id} value={role.id}>{role.name}</option>)}</select></td>
                <td><button type="button" disabled={self} onClick={() => void setAccess(user, { active: !user.active })} className={`rounded px-2 py-1 text-xs ${user.active ? 'bg-emerald-100 text-emerald-800' : 'bg-slate-100 text-slate-700'} disabled:opacity-50`}>{user.active ? 'Actif' : 'Inactif'}</button></td>
                <td><span className="flex justify-end gap-1">
                  <button type="button" onClick={() => setDialog({ kind: 'edit', user })} title="Modifier le nom, l’identifiant ou l’e-mail" className={icon}><Pencil className="h-4 w-4" aria-label="Modifier" /></button>
                  <button type="button" onClick={() => setDialog({ kind: 'password', user })} title="Réinitialiser le mot de passe" className={icon}><KeyRound className="h-4 w-4" aria-label="Mot de passe" /></button>
                  <button type="button" onClick={() => setDialog({ kind: 'activity', user })} title="Historique des activités" className={icon}><History className="h-4 w-4" aria-label="Activité" /></button>
                </span></td>
              </tr>
            })}
        </tbody>
      </table>
    </div>
    {dialog?.kind === 'create' && <CreateDialog roles={roles} onClose={() => setDialog(null)} onDone={done} />}
    {dialog?.kind === 'edit' && <EditDialog user={dialog.user} onClose={() => setDialog(null)} onDone={done} />}
    {dialog?.kind === 'password' && <PasswordDialog user={dialog.user} onClose={() => setDialog(null)} onDone={done} />}
    {dialog?.kind === 'activity' && <ActivityDialog user={dialog.user} onClose={() => setDialog(null)} />}
  </div>
}
