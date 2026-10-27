export type RoleCode = 'administrator' | 'director' | 'accountant' | 'cashier' | 'stock_manager'
export type Profile = { id: string; full_name: string; email: string; active: boolean; role_id: string; role: { code: RoleCode; name: string } | null }
