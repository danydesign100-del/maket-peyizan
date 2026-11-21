// Answers the app's Supabase requests from the PGlite replica, for UI tests.
// It implements only what the accounting screens use: table reads with the
// filters they send, RPC calls (executed as the signed-in user, so RLS and the
// SQL functions are the real ones), and the auth endpoints a stored session needs.
import { asUser } from './harness.mjs'
import { makeUsersBackend } from './users-backend.mjs'

const json = (route, status, body, headers = {}) => route.fulfill({ status, contentType: 'application/json', headers: { 'access-control-allow-origin': '*', 'access-control-expose-headers': 'content-range', ...headers }, body: JSON.stringify(body) })

/** PostgREST filters used by the app: col=eq.x, gte., lte., and nested entry.col for !inner joins. */
function filters(url, allowed) {
  const where = []; const params = []
  for (const [key, raw] of url.searchParams) {
    if (['select', 'order', 'limit', 'offset', 'or'].includes(key)) continue
    const column = allowed[key]
    if (!column) continue
    const [op, ...rest] = raw.split('.'); const value = rest.join('.')
    if (op === 'in') { params.push(value.replace(/^\(|\)$/g, '').split(',').map((item) => item.replace(/^"|"$/g, ''))); where.push(`${column}::text = any($${params.length})`); continue }
    if (op === 'is' && value === 'null') { where.push(`${column} is null`); continue }
    const sqlOp = { eq: '=', neq: '<>', gte: '>=', lte: '<=', lt: '<', gt: '>' }[op]
    if (!sqlOp) continue
    params.push(value === 'true' || value === 'false' ? value === 'true' : value); where.push(`${column} ${sqlOp} $${params.length}`)
  }
  return { where: where.length ? `where ${where.join(' and ')}` : '', params }
}

const named = (table, key, columns = 'name') => `(select jsonb_build_object(${columns.split(',').map((column) => `'${column.trim()}', ${column.trim()}`).join(', ')}) from ${table} where id = ${key})`
const CATALOG = {
  units: { alias: 'u', columns: ['id', 'name', 'active'] },
  supplier_categories: { alias: 'c', columns: ['id', 'name', 'active'] },
  categories: { alias: 'c', columns: ['id', 'name', 'active'], embeds: { products: `jsonb_build_array(jsonb_build_object('count', (select count(*) from products where category_id = c.id)))` } },
  suppliers: { alias: 's', columns: ['id', 'name', 'active', 'category_id', 'company_name', 'phone', 'email'], embeds: { category: named('supplier_categories', 's.category_id') } },
  products: { alias: 'p', columns: ['id', 'name', 'barcode', 'brand', 'active', 'category_id', 'supplier_id', 'stock_quantity', 'is_low_stock'], embeds: { category: named('categories', 'p.category_id'), supplier: named('suppliers', 'p.supplier_id') } },
  customers: { alias: 'cu', columns: ['id', 'full_name', 'phone', 'email', 'customer_number', 'active'] },
  roles: { alias: 'r', columns: ['id', 'code', 'name'], order: 'name' },
  permissions: { alias: 'pm', columns: ['code', 'module'], order: 'sort' },
  role_permissions: { alias: 'rp', columns: ['role_id', 'permission_code'], order: 'role_id' },
  proformas: { alias: 'pf', columns: ['id', 'status', 'created_at'], order: 'created_at', embeds: {
    customer: `(select to_jsonb(c) from customers c where c.id = pf.customer_id)`,
    creator: named('profiles', 'pf.created_by', 'full_name'),
    items: `coalesce((select jsonb_agg(to_jsonb(i) order by i.created_at) from proforma_items i where i.proforma_id = pf.id), '[]'::jsonb)` } },
  proforma_history: { alias: 'ph', columns: ['id', 'proforma_id', 'changed_at'], order: 'changed_at', embeds: { author: named('profiles', 'ph.changed_by', 'full_name') } },
  cash_sessions: { alias: 'cs', columns: ['id', 'opened_by', 'closed_at'], embeds: { opener: named('profiles', 'cs.opened_by', 'full_name') } },
  stock_movements: { alias: 'm', columns: ['id', 'product_id', 'supplier_id', 'movement_type'], embeds: { product: named('products', 'm.product_id', 'name, unit') } },
}

const { handle: handleUsers } = await import('../functions/users/handler.ts')

export function fakeSupabase({ db, userId, profile }) {
  const usersBackend = makeUsersBackend(db)
  const run = (sql, params) => asUser(db, userId, sql, params)
  const single = (request) => (request.headers()['accept'] ?? '').includes('vnd.pgrst.object')
  const range = (request, url) => {
    const header = request.headers()['range']
    if (header) { const [from, to] = header.split('-').map(Number); return { offset: from, limit: to - from + 1 } }
    return { offset: Number(url.searchParams.get('offset') ?? 0), limit: Number(url.searchParams.get('limit') ?? 1000) }
  }

  /** Catalog tables: eq/in filters, `or=(col.ilike.%x%,…)` search, inserts and updates (RLS and triggers apply). */
  async function catalogTable(route, request, url, table) {
    const { alias, columns, embeds = {}, order: defaultOrder = 'id' } = CATALOG[table]
    const allowed = Object.fromEntries(columns.map((column) => [column, `${alias}.${column}`]))
    const { where, params } = filters(url, allowed)
    const conditions = where ? [where.slice('where '.length)] : []
    const or = url.searchParams.get('or')
    if (or) {
      const parts = or.replace(/^\(|\)$/g, '').split(',').map((part) => part.split('.ilike.'))
      conditions.push(`(${parts.map(([column, pattern]) => { params.push(pattern.replace(/\*/g, '%')); return `${alias}.${column}::text ilike $${params.length}` }).join(' or ')})`)
    }
    const clause = conditions.length ? `where ${conditions.join(' and ')}` : ''
    const select = url.searchParams.get('select') ?? '*'
    const embed = `jsonb_build_object(${Object.entries(embeds).filter(([name]) => select.includes(name)).map(([name, sql]) => `'${name}', ${sql}`).join(', ') || `'_', null`})`
    if (request.method() === 'POST' || request.method() === 'PATCH') {
      const body = request.postDataJSON()
      const values = Array.isArray(body) ? body[0] : body
      const keys = Object.keys(values)
      const change = request.method() === 'POST'
        ? `insert into ${table} (${keys.join(', ')}) values (${keys.map((_, index) => `$${index + 1}`).join(', ')}) returning *`
        : `update ${table} ${alias} set ${keys.map((key, index) => `${key} = $${index + 1}`).join(', ')} ${clause.replace(/\$(\d+)/g, (_, n) => `$${Number(n) + keys.length}`)} returning ${alias}.*`
      const { rows } = await run(`with changed as (${change}) select to_jsonb(${alias}) || ${embed} row from changed ${alias}`,
        [...keys.map((key) => values[key] !== null && typeof values[key] === 'object' ? JSON.stringify(values[key]) : values[key]), ...(request.method() === 'PATCH' ? params : [])])
      const data = rows.map((r) => r.row)
      return json(route, request.method() === 'POST' ? 201 : 200, single(request) ? data[0] ?? null : data)
    }
    const { offset, limit } = range(request, url)
    const total = (await run(`select count(*)::int n from ${table} ${alias} ${clause}`, params)).rows[0].n
    const order = (url.searchParams.get('order') ?? defaultOrder).split(',').map((part) => { const [column, direction] = part.split('.'); return `${alias}.${column} ${direction === 'desc' ? 'desc' : 'asc'}` }).join(', ')
    const { rows } = await run(`select to_jsonb(${alias}) || ${embed} row from ${table} ${alias} ${clause} order by ${order} offset ${offset} limit ${limit}`, params)
    const data = rows.map((r) => r.row)
    return json(route, 200, single(request) ? data[0] ?? null : data, { 'content-range': `${offset}-${offset + data.length - 1}/${total}` })
  }

  return async (route) => {
    const request = route.request()
    const url = new URL(request.url())
    if (request.method() === 'OPTIONS') return route.fulfill({ status: 200, headers: { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' } })
    const path = url.pathname
    try {
      if (path.startsWith('/auth/v1/')) return json(route, 200, path.endsWith('/user') ? { id: userId, email: profile.email } : {})
      // Edge Function `users`, run with the test back end, as the signed-in user.
      if (path === '/functions/v1/users') {
        try { return json(route, 200, await handleUsers(request.postDataJSON() ?? {}, userId, usersBackend)) }
        catch (error) { return json(route, error.status ?? 500, { error: error.message }) }
      }

      if (path.startsWith('/rest/v1/rpc/')) {
        const fn = path.slice('/rest/v1/rpc/'.length)
        const body = request.postDataJSON() ?? {}
        const names = Object.keys(body)
        const call = `public.${fn}(${names.map((name, index) => `${name} => $${index + 1}`).join(', ')})`
        // Arrays go to text[] arguments as arrays, to jsonb arguments as JSON.
        const { rows: args } = await db.query(`select unnest(proargnames) name, unnest(proargtypes::regtype[])::text type, proretset from pg_proc where proname = $1 and pronamespace = 'public'::regnamespace`, [fn])
        const isArray = (name) => args.some((arg) => arg.name === name && arg.type.endsWith('[]'))
        const values = names.map((name) => body[name] !== null && typeof body[name] === 'object' && !(Array.isArray(body[name]) && isArray(name)) ? JSON.stringify(body[name]) : body[name])
        const { rows, fields } = await run(`select * from ${call}`, values)
        // Scalar functions come back as one column named after the function.
        const scalar = fields.length === 1 && fields[0].name === fn
        const data = scalar ? rows[0]?.[fn] ?? null : rows
        // Like PostgREST, a function returning one row (not a set) answers an object.
        const oneRow = args.length > 0 && !args[0].proretset
        return json(route, 200, (single(request) || oneRow) && !scalar ? rows[0] ?? null : data)
      }

      const table = path.slice('/rest/v1/'.length)
      // The users screen lists every account; other reads get the signed-in profile.
      if (table === 'profiles' && !single(request) && (url.searchParams.get('select') ?? '').includes('username')) {
        const { rows } = await run(`select to_jsonb(p) || jsonb_build_object('role', (select jsonb_build_object('code', code, 'name', name) from roles where id = p.role_id)) row from profiles p order by full_name`)
        return json(route, 200, rows.map((r) => r.row))
      }
      if (table === 'profiles') return json(route, 200, single(request) ? profile : [profile])
      if (table === 'accounts') {
        const { rows } = await run('select * from accounts order by code')
        return json(route, 200, rows)
      }
      if (table === 'journal_entries') {
        const { where, params } = filters(url, { entry_date: 'je.entry_date', status: 'je.status', entry_type: 'je.entry_type' })
        const { offset, limit } = range(request, url)
        const total = (await run(`select count(*)::int n from journal_entries je ${where}`, params)).rows[0].n
        const { rows } = await run(`
          select to_jsonb(je) || jsonb_build_object(
            'lines', coalesce((select jsonb_agg(to_jsonb(l) || jsonb_build_object('account', jsonb_build_object('id', a.id, 'code', a.code, 'name', a.name, 'nature', a.nature, 'account_type', a.account_type)) order by l.line_number)
                     from journal_entry_lines l join accounts a on a.id = l.account_id where l.journal_entry_id = je.id), '[]'::jsonb),
            'creator', (select jsonb_build_object('full_name', full_name) from profiles where id = je.created_by),
            'poster', (select jsonb_build_object('full_name', full_name) from profiles where id = je.posted_by),
            'voider', (select jsonb_build_object('full_name', full_name) from profiles where id = je.voided_by),
            'submitter', (select jsonb_build_object('full_name', full_name) from profiles where id = je.submitted_by)) row
          from journal_entries je ${where} order by je.entry_date desc, je.entry_number desc offset ${offset} limit ${limit}`, params)
        return json(route, 200, rows.map((r) => r.row), { 'content-range': `${offset}-${offset + rows.length - 1}/${total}` })
      }
      if (table === 'journal_entry_lines') {
        const { where, params } = filters(url, { account_id: 'l.account_id', 'entry.status': 'je.status', 'entry.entry_date': 'je.entry_date' })
        const { rows } = await run(`select jsonb_build_object('id', l.id, 'account_id', l.account_id, 'description', l.description, 'debit_amount', l.debit_amount, 'credit_amount', l.credit_amount,
            'entry', jsonb_build_object('id', je.id, 'entry_number', je.entry_number, 'entry_date', je.entry_date, 'description', je.description, 'reference', je.reference, 'entry_type', je.entry_type, 'status', je.status)) row
          from journal_entry_lines l join journal_entries je on je.id = l.journal_entry_id ${where}`, params)
        return json(route, 200, rows.map((r) => r.row))
      }
      if (table === 'sales') {
        const { where, params } = filters(url, { status: 's.status', sold_at: 's.sold_at' })
        const { rows } = await run(`select to_jsonb(s) || jsonb_build_object(
            'customer', (select jsonb_build_object('full_name', full_name) from customers where id = s.customer_id),
            'payments', coalesce((select jsonb_agg(jsonb_build_object('method', p.method, 'amount', p.amount)) from payments p where p.sale_id = s.id), '[]'::jsonb),
            'items', coalesce((select jsonb_agg(to_jsonb(i)) from sale_items i where i.sale_id = s.id), '[]'::jsonb)) row
          from sales s ${where} order by s.sold_at desc`, params)
        return json(route, 200, rows.map((r) => r.row))
      }
      if (table === 'expenses') {
        if (request.method() === 'POST') {
          const body = request.postDataJSON()
          const row = Array.isArray(body) ? body[0] : body
          const columns = Object.keys(row)
          const { rows } = await run(`insert into expenses (${columns.join(', ')}) values (${columns.map((_, index) => `$${index + 1}`).join(', ')}) returning *`, columns.map((column) => row[column]))
          return json(route, 201, single(request) ? rows[0] : rows)
        }
        if (request.method() === 'DELETE') {
          const id = url.searchParams.get('id')?.replace(/^eq\./, '')
          await run('delete from expenses where id = $1', [id])
          return route.fulfill({ status: 204, headers: { 'access-control-allow-origin': '*' } })
        }
        const total = (await run('select count(*)::int n from expenses')).rows[0].n
        const { rows } = await run(`select to_jsonb(e) || jsonb_build_object(
            'creator', (select jsonb_build_object('full_name', full_name) from profiles where id = e.created_by),
            'expense_account', (select jsonb_build_object('code', code, 'name', name) from accounts where id = e.expense_account_id),
            'journal', (select jsonb_build_object('entry_number', entry_number) from journal_entries where id = e.journal_entry_id)) row
          from expenses e order by e.expense_date desc`)
        return json(route, 200, rows.map((r) => r.row), { 'content-range': `0-${rows.length - 1}/${total}` })
      }
      if (CATALOG[table]) return await catalogTable(route, request, url, table)
      if (table === 'cash_movements') {
        const { where, params } = filters(url, { occurred_at: 'm.occurred_at' })
        const account = (column) => `(select jsonb_build_object('code', code, 'name', name) from accounts where id = m.${column})`
        const { rows } = await run(`select to_jsonb(m) || jsonb_build_object(
            'cash_account', ${account('cash_account_id')}, 'counter', ${account('counter_account_id')},
            'author', (select jsonb_build_object('full_name', full_name) from profiles where id = m.created_by),
            'approver', (select jsonb_build_object('full_name', full_name) from profiles where id = m.approved_by),
            'journal', (select jsonb_build_object('entry_number', entry_number) from journal_entries where id = m.journal_entry_id),
            'expense', (select jsonb_build_object('journal', (select jsonb_build_object('entry_number', entry_number) from journal_entries where id = e.journal_entry_id)) from expenses e where e.id = m.expense_id)) row
          from cash_movements m ${where} order by m.occurred_at desc`, params)
        return json(route, 200, rows.map((r) => r.row))
      }
      if (table === 'settings') {
        const { where, params } = filters(url, { key: 'key' })
        if (request.method() === 'PATCH') {
          const body = request.postDataJSON()
          await run(`update settings set value = $${params.length + 1}::jsonb ${where}`, [...params, JSON.stringify(body.value)])
          return route.fulfill({ status: 204, headers: { 'access-control-allow-origin': '*' } })
        }
        const { rows } = await run(`select * from settings ${where}`, params)
        return json(route, 200, single(request) ? rows[0] ?? null : rows)
      }
      if (table === 'partners') {
        const { rows } = await run('select * from partners order by name')
        return json(route, 200, rows)
      }
      if (table === 'journal_entry_history') {
        const id = url.searchParams.get('journal_entry_id')?.replace(/^eq\./, '')
        const { rows } = await run(`select to_jsonb(h) || jsonb_build_object('author', (select jsonb_build_object('full_name', full_name) from profiles where id = h.changed_by)) row
          from journal_entry_history h where journal_entry_id = $1 order by changed_at`, [id])
        return json(route, 200, rows.map((r) => r.row))
      }
      // Screens outside this test (dashboard, sync warm-up) get empty answers.
      return json(route, 200, single(request) ? null : [])
    } catch (error) {
      return json(route, 400, { message: error.message, code: error.code ?? 'P0001' })
    }
  }
}
