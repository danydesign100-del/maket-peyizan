// Permissions by role (étape F3). The database holds the matrix (role_permissions);
// these defaults mirror its seed and are used in local mode, and offline before
// the user's permissions were ever loaded.

export type PermissionCode =
  | 'pos.sell' | 'pos.discount' | 'cash.count' | 'cash.movements' | 'cash.other_accounts' | 'cash.approve' | 'cash.validate_difference'
  | 'sales.cancel' | 'customers.manage' | 'proformas.manage' | 'proformas.price' | 'proformas.view_all'
  | 'catalog.manage' | 'stock.movements'
  | 'expenses.manage' | 'accounting.manage' | 'accounting.validate'
  | 'audit.view' | 'users.manage' | 'settings.manage' | 'roles.manage'

const MANAGERS = ['director', 'administrator']
const DEFAULTS: Record<PermissionCode, string[]> = {
  'pos.sell': ['cashier', ...MANAGERS],
  'pos.discount': MANAGERS,
  'cash.count': ['cashier', ...MANAGERS],
  'cash.movements': ['cashier', ...MANAGERS, 'accountant'],
  'cash.other_accounts': [...MANAGERS, 'accountant'],
  'cash.approve': MANAGERS,
  'cash.validate_difference': MANAGERS,
  'sales.cancel': MANAGERS,
  'customers.manage': ['cashier', ...MANAGERS],
  'proformas.manage': ['cashier', ...MANAGERS],
  'proformas.price': MANAGERS,
  'proformas.view_all': [...MANAGERS, 'accountant'],
  'catalog.manage': [...MANAGERS, 'stock_manager'],
  'stock.movements': [...MANAGERS, 'stock_manager'],
  'expenses.manage': [...MANAGERS, 'accountant'],
  'accounting.manage': [...MANAGERS, 'accountant'],
  'accounting.validate': MANAGERS,
  'audit.view': MANAGERS,
  'users.manage': MANAGERS,
  'settings.manage': MANAGERS,
  'roles.manage': ['administrator'],
}

export function defaultPermissions(role: string | null | undefined): PermissionCode[] {
  return (Object.keys(DEFAULTS) as PermissionCode[]).filter((code) => DEFAULTS[code].includes(role ?? ''))
}

const KEY = 'mp:permissions'
export function cachedPermissions(userId: string): PermissionCode[] | null {
  try { const saved = JSON.parse(localStorage.getItem(KEY) ?? 'null') as { userId: string; codes: PermissionCode[] } | null; return saved?.userId === userId ? saved.codes : null } catch { return null }
}
export function savePermissions(userId: string, codes: PermissionCode[]) {
  try { localStorage.setItem(KEY, JSON.stringify({ userId, codes })) } catch { /* storage unavailable */ }
}
export function clearPermissions() {
  try { localStorage.removeItem(KEY) } catch { /* storage unavailable */ }
}

/** Pages reserved to some permissions (any of them opens the page); the others are open to every user. */
export const PAGE_ACCESS: Record<string, PermissionCode[]> = {
  '/caisse': ['pos.sell'],
  '/recettes-journalieres': ['pos.sell'],
  '/comptage-caisse': ['cash.count', 'cash.movements'],
  '/caisse/mouvements': ['cash.movements', 'cash.other_accounts'],
  '/proformas': ['proformas.manage', 'proformas.view_all'],
  '/categories': ['catalog.manage'],
  '/stock/mouvements': ['stock.movements'],
  '/fournisseurs': ['catalog.manage'],
  '/depenses': ['expenses.manage'],
  '/rapports': ['accounting.manage'],
  '/comptabilite': ['accounting.manage'],
  '/utilisateurs': ['users.manage', 'roles.manage'],
  '/parametres': ['settings.manage'],
}
export const canOpen = (path: string, permissions: readonly PermissionCode[]) => !PAGE_ACCESS[path] || PAGE_ACCESS[path].some((code) => permissions.includes(code))
