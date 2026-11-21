import { Fragment, useEffect, useState } from 'react'
import { RotateCcw, Save } from 'lucide-react'
import { TableRowsSkeleton } from '../../components/Skeleton'
import { useAuth } from '../../contexts/AuthContext'
import { errorText } from '../../lib/errors'
import { isLocalDbConfigured } from '../../lib/supabase'
import { userService, type PermissionMatrix } from '../../services/userService'

const ROLE_ORDER = ['director', 'administrator', 'accountant', 'cashier', 'stock_manager']
const sameSet = (a: string[] = [], b: string[] = []) => a.length === b.length && a.every((code) => b.includes(code))

/** Who may do what: one column per role, one line per permission. Saved role by role (audited). */
export function RolesTab() {
  const { refreshProfile } = useAuth()
  const [matrix, setMatrix] = useState<PermissionMatrix | null>(null)
  const [draft, setDraft] = useState<Record<string, string[]>>({})
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const load = () => userService.permissionMatrix().then((next) => { setMatrix(next); setDraft(next.granted) }).catch((cause) => setError(errorText(cause)))
  useEffect(() => { if (!isLocalDbConfigured) void load() }, [])

  if (isLocalDbConfigured) return <p role="status" className="rounded-xl border border-sky-200 bg-sky-50 p-4 text-sm text-sky-900">En mode local, chaque rôle garde ses permissions par défaut. La modification des permissions se fait avec la base en ligne.</p>
  const roles = [...(matrix?.roles ?? [])].sort((a, b) => (ROLE_ORDER.indexOf(a.code) + 99) % 99 - (ROLE_ORDER.indexOf(b.code) + 99) % 99)
  const changed = roles.filter((role) => !sameSet(draft[role.id], matrix?.granted[role.id]))
  const toggle = (roleId: string, code: string) => setDraft((current) => {
    const codes = current[roleId] ?? []
    return { ...current, [roleId]: codes.includes(code) ? codes.filter((item) => item !== code) : [...codes, code] }
  })
  const save = async () => {
    setSaving(true); setError(null); setNotice(null)
    try {
      for (const role of changed) await userService.setRolePermissions(role.id, role.code === 'administrator' ? [...new Set([...(draft[role.id] ?? []), 'roles.manage'])] : draft[role.id] ?? [])
      setNotice(`Permissions enregistrées : ${changed.map((role) => role.name).join(', ')}. Elles s’appliquent dès la prochaine action des utilisateurs concernés.`)
      await load()
      await refreshProfile()
    } catch (cause) { setError(errorText(cause)) } finally { setSaving(false) }
  }
  const modules = [...new Set((matrix?.permissions ?? []).map((permission) => permission.module))]

  return <div className="space-y-4">
    <p className="text-sm text-slate-600">Cochez ce que chaque rôle peut faire. Les règles sont vérifiées par la base de données ; l’écran masque simplement ce qui n’est pas permis. Le rôle Administrateur garde toujours la gestion des permissions.</p>
    {notice && <p role="status" className="ui-alert-success">{notice}</p>}
    {error && <p role="alert" className="ui-alert-error">{error}</p>}
    <div className="ui-card overflow-x-auto">
      <table className="ui-table text-sm">
        <thead><tr><th>Permission</th>{roles.map((role) => <th key={role.id} className="text-center">{role.name}</th>)}</tr></thead>
        <tbody>
          {!matrix ? <TableRowsSkeleton cols={6} /> : modules.map((module) => <Fragment key={module}>
            <tr><th colSpan={roles.length + 1} className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">{module}</th></tr>
            {matrix.permissions.filter((permission) => permission.module === module).map((permission) => <tr key={permission.code}>
              <td>{permission.label}<span className="block font-mono text-[11px] text-slate-400">{permission.code}</span></td>
              {roles.map((role) => {
                const locked = role.code === 'administrator' && permission.code === 'roles.manage'
                return <td key={role.id} className="text-center">
                  <input type="checkbox" aria-label={`${permission.label} — ${role.name}`} checked={locked || (draft[role.id] ?? []).includes(permission.code)} disabled={locked || saving} onChange={() => toggle(role.id, permission.code)} className="h-4 w-4" />
                </td>
              })}
            </tr>)}
          </Fragment>)}
        </tbody>
      </table>
    </div>
    <div className="flex flex-wrap justify-end gap-2">
      <button type="button" disabled={changed.length === 0 || saving} onClick={() => setDraft(matrix?.granted ?? {})} className="ui-button-secondary"><RotateCcw className="h-4 w-4" aria-hidden="true" />Annuler les changements</button>
      <button type="button" disabled={changed.length === 0 || saving} onClick={() => void save()} className="ui-button-primary"><Save className="h-4 w-4" aria-hidden="true" />{saving ? 'Enregistrement…' : `Enregistrer${changed.length ? ` (${changed.length} rôle${changed.length > 1 ? 's' : ''})` : ''}`}</button>
    </div>
  </div>
}
