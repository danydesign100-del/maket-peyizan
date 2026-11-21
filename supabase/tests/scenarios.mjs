// End-to-end scenarios, run after run.mjs by `npm run test:db`:
//  1. Upgrade rehearsal: a database at step 6 (what production had) with data
//     saved the way the previous website saved it, then the newer migrations.
//  2. A week in the shop, through the same functions the screens call, as each
//     role; every report must agree with the others.
import { applyMigration, asUser, buildDatabase, createUser, migrationFiles } from './harness.mjs'

const statements = await import('../../src/lib/statements.ts')
const results = []
let failures = 0
async function test(name, fn) {
  try { await fn(); results.push(`  ✓ ${name}`) } catch (error) { failures += 1; results.push(`  ✗ ${name}\n      ${error.message}`) }
}
const expect = (condition, message) => { if (!condition) throw new Error(message) }
const rejects = async (promise, pattern) => {
  try { await promise } catch (error) { if (pattern.test(error.message)) return; throw new Error(`unexpected error: ${error.message}`) }
  throw new Error(`expected an error matching ${pattern}`)
}
const num = (value) => Number(value)
const near = (a, b) => Math.abs(num(a) - num(b)) < 0.05

// ---------------------------------------------------------------------------
results.push('Upgrade rehearsal (production at step 6 → current migrations)')
const LAST_DEPLOYED = '20261105010000_cash_management.sql'
const pending = migrationFiles().filter((file) => file > LAST_DEPLOYED)
const old = await buildDatabase({ until: LAST_DEPLOYED })
const boss = await createUser(old, { email: 'patron@shop.ht', name: 'Patron', role: 'director' })
const till = await createUser(old, { email: 'caisse@shop.ht', name: 'Caissière', role: 'cashier' })
const asBoss = (sql, params) => asUser(old, boss, sql, params)
// Data shaped like the old website left it: free-text units, near-duplicate names,
// mobile money stored as 'mobile_money' with the network in the reference.
const legacy = {}
for (const [key, name, unit] of [['rice', 'Riz Bongu 5 lb', 'Sac'], ['riceDup', 'RIZ BONGU 5 LB ', 'sac'], ['oil', 'Huile 1 L', 'u'], ['soap', 'Savon', 'pièces']]) {
  legacy[key] = (await asBoss(`insert into products (name, selling_price, unit) values ($1, 100, $2) returning id`, [name, unit])).rows[0].id
}
await asBoss(`insert into suppliers (name) values ('Coop Kenscoff'), ('coop kenscoff')`)
for (const key of ['rice', 'oil', 'soap']) await asBoss(`select public.record_stock_movement($1, 'entry', 50, 'Livraison', null, 60)`, [legacy[key]])
await asUser(old, till, 'select public.open_cash_session(1000, null)')
const oldSale = (payments) => asUser(old, till, 'select * from public.complete_offline_sale(gen_random_uuid(), null, $1::jsonb, $2::jsonb, null)', [JSON.stringify([{ product_id: legacy.rice, quantity: 1, discount_amount: 0, tax_amount: 0 }]), JSON.stringify(payments)])
await oldSale([{ method: 'mobile_money', amount: 100, reference: 'moncash:MC-1001' }])
await oldSale([{ method: 'mobile_money', amount: 100, reference: 'natcash:NC-77' }])
await oldSale([{ method: 'other', amount: 100, reference: 'check:CHQ 12' }])
await oldSale([{ method: 'mobile_money', amount: 100, reference: 'moncash:' }])
await oldSale([{ method: 'cash', amount: 150 }])
const before = {
  entries: (await old.query(`select count(*)::int n, sum(l.debit_amount)::float d, sum(l.credit_amount)::float c from journal_entries je join journal_entry_lines l on l.journal_entry_id = je.id where je.status = 'posted'`)).rows[0],
  stock: (await old.query('select id, stock_quantity::float q, average_cost::float c from products order by id')).rows,
}

await test(`the ${pending.length} new migrations apply on top of existing data`, async () => {
  for (const file of pending) await applyMigration(old, file)
})
await test('posted entries, stock and average costs are unchanged by the upgrade', async () => {
  const entries = (await old.query(`select count(*)::int n, sum(l.debit_amount)::float d, sum(l.credit_amount)::float c from journal_entries je join journal_entry_lines l on l.journal_entry_id = je.id where je.status = 'posted'`)).rows[0]
  expect(JSON.stringify(entries) === JSON.stringify(before.entries), `${JSON.stringify(before.entries)} → ${JSON.stringify(entries)}`)
  const stock = (await old.query('select id, stock_quantity::float q, average_cost::float c from products order by id')).rows
  expect(JSON.stringify(stock) === JSON.stringify(before.stock), 'stock or average cost changed')
})
await test('old mobile money and cheque payments get their real method back', async () => {
  const rows = (await old.query(`select method, reference from payments order by created_at`)).rows.map((row) => `${row.method}:${row.reference ?? '∅'}`)
  expect(JSON.stringify(rows) === JSON.stringify(['moncash:MC-1001', 'natcash:NC-77', 'check:CHQ 12', 'moncash:∅', 'cash:∅']), rows.join(', '))
})
await test('every unit already used stays valid; legacy duplicates can still be edited', async () => {
  const units = (await old.query('select name from units')).rows.map((row) => row.name)
  expect(['u', 'pièces'].every((unit) => units.includes(unit)) && units.some((unit) => unit.toLowerCase() === 'sac'), units.join(','))
  await asBoss(`update products set selling_price = 120, name = name, unit = unit where id = $1`, [legacy.riceDup])
  await rejects(asBoss(`insert into products (name, selling_price, unit) values ('riz bongu 5 lb', 100, 'sac')`), /existe déjà/)
})
await test('the previous website keeps working until the new one is deployed', async () => {
  // Database first, website second: old payment format and old stock call still accepted.
  await oldSale([{ method: 'mobile_money', amount: 100, reference: 'moncash:MC-2002' }])
  const movement = (await asBoss(`select * from public.record_stock_movement($1, 'entry', 10, 'Livraison', null, 70)`, [legacy.oil])).rows[0]
  expect(movement.journal_entry_id && movement.settlement === 'supplier', 'old stock call posts a purchase on credit')
})
await test('a MonCash ID used before the upgrade cannot be reused', async () => {
  await rejects(oldSale([{ method: 'moncash', amount: 100, reference: 'mc-1001' }]), /déjà utilisée pour la vente VTE-/)
})

// ---------------------------------------------------------------------------
results.push('\nA week in the shop (every report must agree)')
const db = await buildDatabase()
const director = await createUser(db, { email: 'dir@shop.ht', name: 'Marie Directrice', role: 'director' })
const accountant = await createUser(db, { email: 'compta@shop.ht', name: 'Paul Compta', role: 'accountant' })
const keeper = await createUser(db, { email: 'stock@shop.ht', name: 'Sam Stock', role: 'stock_manager' })
const cashier = await createUser(db, { email: 'rose@shop.ht', name: 'Rose Caisse', role: 'cashier' })
const as = (user, sql, params) => asUser(db, user, sql, params)
const one = async (user, sql, params) => (await as(user, sql, params)).rows[0]
const account = async (code) => (await db.query('select id from accounts where code = $1', [code])).rows[0].id
const today = (await db.query(`select public.local_day(now()) d`)).rows[0].d
const day = typeof today === 'string' ? today : today.toISOString().slice(0, 10)

await test('the week runs without a refusal', async () => {
  // Monday: catalogue, opening stock, a delivery on credit.
  const category = (await one(keeper, `insert into categories (name) values ('Épicerie') returning id`)).id
  const supplier = (await one(keeper, `insert into suppliers (name, category_id) values ('Minoterie d''Haïti', (select id from supplier_categories where name = 'Grossistes')) returning id`)).id
  const product = async (name, unit, price) => (await one(keeper, `insert into products (name, selling_price, unit, category_id, supplier_id) values ($1, $2, $3, $4, $5) returning id`, [name, price, unit, category, supplier])).id
  const flour = await product('Farine 25 lb', 'sac', 900)
  const rice = await product('Riz local', 'marmite', 250)
  const move = (type, item, qty, price, settlement, reason = 'Semaine') => as(keeper, `select * from public.record_stock_movement($1, $2, $3, $4, $5, $6, null, null, now(), $7)`, [item, type, qty, reason, type === 'entry' ? supplier : null, price, settlement])
  await move('entry', flour, 10, 600, 'opening', 'Stock initial')
  await move('entry', rice, 100, 150, 'opening', 'Stock initial')
  await move('entry', flour, 20, 630, 'supplier', 'Facture MH-204')       // 12 600 on credit
  // The cash register: sales of every kind.
  await as(cashier, 'select public.open_cash_session(2000, null)')
  const sell = (items, payments) => one(cashier, 'select * from public.complete_offline_sale(gen_random_uuid(), null, $1::jsonb, $2::jsonb, null)', [JSON.stringify(items), JSON.stringify(payments)])
  await sell([{ product_id: flour, quantity: 2, discount_amount: 0, tax_amount: 0 }], [{ method: 'cash', amount: 2000 }])                 // 1 800, change 200
  await sell([{ product_id: rice, quantity: 4, discount_amount: 50, tax_amount: 0 }], [{ method: 'moncash', amount: 950, reference: 'MC-9001' }])
  await sell([{ product_id: flour, quantity: 1, discount_amount: 0, tax_amount: 0 }, { product_id: rice, quantity: 2, discount_amount: 0, tax_amount: 0 }], [{ method: 'cash', amount: 400 }, { method: 'natcash', amount: 1000, reference: 'NC-31' }])
  const returned = await sell([{ product_id: rice, quantity: 3, discount_amount: 0, tax_amount: 0 }], [{ method: 'check', amount: 750, reference: 'CHQ 88' }])
  await one(director, `select * from public.cancel_sale($1, 'refunded', 'Riz humide')`, [returned.id])
  // Wednesday: breakage, an inventory count, a return to the supplier.
  await move('exit', flour, 1, null, null, 'Sac déchiré')
  await move('adjustment', rice, -2, null, null, 'Inventaire')
  await move('supplier_return', flour, 2, 630, 'supplier', 'Sacs mouillés')
  // Thursday: the till pays part of the supplier, banks the takings, pays an expense.
  await as(cashier, `select public.record_cash_movement('supplier_payment', 1500, 'Acompte Minoterie', 'MH-204')`)
  await as(cashier, `select public.record_cash_movement('expense', 300, 'Sachets', 'T-5', $1)`, [await account('508000')])
  await as(cashier, `select public.record_cash_movement('bank_deposit', 1000, 'Versement', 'BORD-9')`)
  await as(cashier, `select public.close_cash_session(1380, 'fin de semaine')`)
  // Friday: the accountant books rent; the director validates the cash difference and a depreciation.
  await one(accountant, `insert into expenses (label, amount, expense_date, created_by, expense_account_id, payment_account_id) values ('Loyer', 5000, $1, $2, $3, $4) returning id`, [day, accountant, await account('505000'), await account('102000')])
  const session = await one(director, `select session_id from public.cash_session_report($1, $1)`, [day])
  await one(director, `select * from public.validate_cash_difference($1, 'Erreur de monnaie')`, [session.session_id])
  const lines = JSON.stringify([{ account_id: await account('515000'), debit: 400 }, { account_id: await account('150000'), credit: 400 }])
  const reg = await one(accountant, `select id from public.save_journal_entry(null, $1, 'Amortissement', null, 'regularisation', 'Dotation du mois', $2::jsonb, 'depreciation')`, [day, lines])
  await as(accountant, 'select public.submit_journal_entry($1)', [reg.id])
  await as(director, 'select public.post_journal_entry($1)', [reg.id])
})

const balances = async () => (await as(accountant, `select * from public.account_balances(null, $1)`, [day])).rows
const balanceOf = async (code) => num((await balances()).find((row) => row.code === code)?.balance ?? 0)
await test('trial balance: total debits = total credits, before and after regularisation', async () => {
  const rows = await balances()
  for (const includeRegularisation of [false, true]) {
    const { totals } = statements.trialBalance(rows, { includeRegularisation })
    expect(statements.isBalanced(totals.closingDebit, totals.closingCredit), `${includeRegularisation ? 'after' : 'before'}: ${totals.closingDebit} vs ${totals.closingCredit}`)
  }
})
await test('balance sheet: assets = liabilities + equity', async () => {
  const sheet = statements.balanceSheet(await balances())
  expect(Math.abs(sheet.difference) < 0.01, `difference ${sheet.difference}`)
})
let stockGap = 0
await test('120000 Stock = quantity × average cost of every product (to the rounding of the average cost)', async () => {
  // The average cost is kept to the cent, so a few cents can separate the two after many movements.
  const value = num((await db.query('select coalesce(sum(round(stock_quantity * average_cost, 2)), 0) v from products')).rows[0].v)
  stockGap = Math.round((value - await balanceOf('120000')) * 100) / 100
  expect(Math.abs(stockGap) < 1, `ledger ${await balanceOf('120000')} vs stock ${value}`)
})
await test('201000 Fournisseurs = what is still owed (purchase − return − payment)', async () => {
  // 12 600 on credit − 1 260 returned − 1 500 paid from the till = 9 840 owed (balances are in the account's nature).
  expect(near(await balanceOf('201000'), 9840), `201000 ${await balanceOf('201000')}`)
})
await test('sales report and income statement agree on net sales', async () => {
  const sales = (await db.query(`select s.*, coalesce((select jsonb_agg(jsonb_build_object('method', p.method, 'amount', p.amount)) from payments p where p.sale_id = s.id), '[]') payments from sales s`)).rows
  const summary = statements.salesSummary(sales)
  const income = statements.incomeStatement(await balances())
  expect(summary.pending.length === 0, `${summary.pending.length} sale(s) not posted`)
  expect(near(summary.netSales, income.netSales) && income.consistent, `report ${summary.netSales} vs accounts ${income.netSales}`)
  const methods = Object.fromEntries(summary.byMethod.map((row) => [row.method, row.amount]))
  expect(methods.cash === 2200 && methods.moncash === 950 && methods.natcash === 1000 && !methods.check, JSON.stringify(methods))
})
await test('mobile money in the ledger = MonCash + NatCash collected', async () => {
  expect(near(await balanceOf('105000'), 1950), `105000 ${await balanceOf('105000')}`)
})
await test('cash report: expected cash = opening + cash sales − refunds ± movements; difference posted once validated', async () => {
  const row = await one(director, `select * from public.cash_session_report($1, $1)`, [day])
  // 2 000 + 2 200 cash sales − 1 500 − 300 − 1 000 = 1 400 expected; 1 380 counted.
  expect(near(row.theoretical, 1400) && near(row.difference, -20) && row.difference_validated_at, JSON.stringify({ theoretical: row.theoretical, difference: row.difference }))
  expect(near(await balanceOf('519100'), 20), 'shortage in 519100')
})
await test('101000 Caisse = opening float + every cash flow of the week', async () => {
  // The opening float was never booked as an entry: the ledger holds the week's flows only.
  expect(near(await balanceOf('101000'), 1400 - 20 - 2000), `101000 ${await balanceOf('101000')}`)
})
await test('income statement: losses and inventory differences sit in the cost of sales', async () => {
  const income = statements.incomeStatement(await balances())
  expect(near(await balanceOf('501100'), (await balanceOf('501100'))) && num(await balanceOf('501100')) > 0, '501100 has the losses')
  expect(near(income.totalCogs, (await balanceOf('501000')) + (await balanceOf('501100'))), `COGS ${income.totalCogs}`)
})

results.push(`  (stock value − 120000 after the week: ${stockGap.toFixed(2)} HTG of rounding)`)
results.push('\nUser accounts (Edge Function `users`)')
const { handle, placeholderEmail } = await import('../functions/users/handler.ts')
const { makeUsersBackend } = await import('./users-backend.mjs')
const backend = makeUsersBackend(db)
const roleId = async (code) => (await db.query('select id from roles where code = $1', [code])).rows[0].id
const call = (body, token) => handle(body, token, backend)
const refusal = async (promise, status, pattern) => {
  try { await promise } catch (error) { if (error.status === status && pattern.test(error.message)) return; throw new Error(`unexpected ${error.status}: ${error.message}`) }
  throw new Error(`expected ${status} ${pattern}`)
}
await test('only directors and administrators manage accounts', async () => {
  await refusal(call({ action: 'create', full_name: 'X', username: 'xxx', password: '12345678', role_id: await roleId('cashier') }, null), 401, /reconnectez-vous/)
  await refusal(call({ action: 'create', full_name: 'X', username: 'xxx', password: '12345678', role_id: await roleId('cashier') }, cashier), 403, /responsables autorisés/)
})
await test('a director creates a cashier with a user name and no e-mail; she signs in with it', async () => {
  const created = await call({ action: 'create', full_name: 'Rose Caisse', username: 'Rose.Caisse', password: 'Caisse2026!', role_id: await roleId('cashier') }, director)
  const profile = (await db.query('select p.username, p.email, p.full_name, r.code from profiles p join roles r on r.id = p.role_id where p.id = $1', [created.user.id])).rows[0]
  expect(profile.username === 'rose.caisse' && profile.code === 'cashier' && profile.email === placeholderEmail('rose.caisse'), JSON.stringify(profile))
  const login = await call({ action: 'login', identifier: 'ROSE.caisse', password: 'Caisse2026!' }, null)
  expect(login.session?.access_token, 'session returned')
  await refusal(call({ action: 'login', identifier: 'rose.caisse', password: 'faux' }, null), 401, /Identifiant ou mot de passe incorrect/)
  await refusal(call({ action: 'login', identifier: 'inconnu', password: 'Caisse2026!' }, null), 401, /Identifiant ou mot de passe incorrect/)
  expect((await db.query(`select count(*)::int n from audit_log where action = 'user_created' and entity_id = $1`, [created.user.id])).rows[0].n === 1, 'creation audited')
})
await test('user names are unique and well formed; passwords have 8 characters', async () => {
  await refusal(call({ action: 'create', full_name: 'Autre Rose', username: 'rose.caisse', password: 'Caisse2026!', role_id: await roleId('cashier') }, director), 409, /déjà pris/)
  await refusal(call({ action: 'create', full_name: 'Bad', username: 'a b', password: 'Caisse2026!', role_id: await roleId('cashier') }, director), 400, /Nom d’utilisateur invalide/)
  await refusal(call({ action: 'create', full_name: 'Court', username: 'court', password: '123', role_id: await roleId('cashier') }, director), 400, /8 caractères/)
  await refusal(call({ action: 'create', full_name: 'Sans rôle', username: 'sansrole', password: 'Caisse2026!', role_id: '00000000-0000-0000-0000-000000000000' }, director), 400, /Rôle inconnu/)
})
await test('password reset by a manager; a deactivated account cannot sign in', async () => {
  const id = (await db.query(`select id from profiles where username = 'rose.caisse'`)).rows[0].id
  await call({ action: 'set_password', user_id: id, password: 'Nouveau2026!' }, director)
  expect((await call({ action: 'login', identifier: 'rose.caisse', password: 'Nouveau2026!' }, null)).session, 'new password works')
  await call({ action: 'update', user_id: id, username: 'rose.c' }, director)
  await call({ action: 'create', full_name: 'Lina Caisse', username: 'lina', password: 'Caisse2026!', role_id: await roleId('cashier') }, director)
  await refusal(call({ action: 'update', user_id: id, username: 'LINA' }, director), 409, /déjà pris/)
  await db.query('update profiles set active = false where id = $1', [id])
  await refusal(call({ action: 'login', identifier: 'rose.c', password: 'Nouveau2026!' }, null), 401, /incorrect/)
})

results.push('\nRoles and permissions (F3)')
const roleIdOf = async (code) => (await db.query('select id from roles where code = $1', [code])).rows[0].id
const permissionsOf = async (code) => (await db.query('select array_agg(rp.permission_code order by rp.permission_code) p from role_permissions rp join roles r on r.id = rp.role_id where r.code = $1', [code])).rows[0].p ?? []
const setPermissions = (user, code, list) => asUser(db, user, 'select * from public.set_role_permissions($1, $2)', [code, list])
const admin = await createUser(db, { email: 'admin-perm@shop.ht', name: 'Ali Admin', role: 'administrator' })
await test('defaults match the former rules; each user reads their permissions', async () => {
  const cashierPerms = (await asUser(db, cashier, 'select public.my_permissions() p')).rows[0].p
  expect(['pos.sell', 'cash.count', 'cash.movements', 'customers.manage', 'proformas.manage'].every((code) => cashierPerms.includes(code)) && !cashierPerms.includes('sales.cancel'), cashierPerms.join(','))
  expect((await permissionsOf('administrator')).includes('roles.manage') && !(await permissionsOf('director')).includes('roles.manage'), 'only the administrator manages permissions')
})
await test('a change in the matrix applies at once, in the database and in the users function', async () => {
  const directorRole = await roleIdOf('director')
  const before = await permissionsOf('director')
  await rejects(setPermissions(director, directorRole, before.filter((code) => code !== 'sales.cancel')), /responsables autorisés modifient les permissions/)
  await setPermissions(admin, directorRole, before.filter((code) => code !== 'sales.cancel' && code !== 'users.manage'))
  // Without sales.cancel the director cannot cancel; without users.manage no account creation.
  const anySale = (await db.query('select id from sales where status = $1 limit 1', ['completed'])).rows[0]
  await rejects(asUser(db, director, `select public.cancel_sale($1, 'refunded', 'Test droits')`, [anySale.id]), /annuler une vente/)
  await (async () => { try { await call({ action: 'create', full_name: 'Test Droits', username: 'test.droits', password: 'Caisse2026!', role_id: await roleId('cashier') }, director); throw new Error('created') } catch (error) { expect(error.status === 403, error.message) } })()
  await setPermissions(admin, directorRole, before)
  expect(JSON.stringify(await permissionsOf('director')) === JSON.stringify(before), 'restored')
  // An accountant allowed to authorise outflows can do it.
  const accountantRole = await roleIdOf('accountant')
  await setPermissions(admin, accountantRole, [...await permissionsOf('accountant'), 'cash.approve'])
  const accountantUser = (await db.query(`select id from profiles where full_name = 'Paul Compta'`)).rows[0]?.id ?? await createUser(db, { email: 'compta-perm@shop.ht', name: 'Paul Compta', role: 'accountant' })
  expect((await asUser(db, accountantUser, `select public.has_permission('cash.approve') ok`)).rows[0].ok === true, 'accountant may approve')
  expect((await db.query('select count(*)::int n from audit_log where action = $1', ['role_permissions_updated'])).rows[0].n >= 3, 'changes audited')
})
await test('the administrator always keeps the management of permissions; unknown permissions refused', async () => {
  const adminRole = await roleIdOf('administrator')
  await rejects(setPermissions(admin, adminRole, (await permissionsOf('administrator')).filter((code) => code !== 'roles.manage')), /garde toujours la gestion des permissions/)
  await rejects(setPermissions(admin, adminRole, [...await permissionsOf('administrator'), 'pirate.everything']), /Permission inconnue/)
})
await test('sales, payments and cash sessions cannot be edited or deleted directly', async () => {
  const sale = (await db.query(`select id, total_amount from sales limit 1`)).rows[0]
  await asUser(db, director, 'delete from payments where sale_id = $1', [sale.id])
  await asUser(db, director, 'delete from sales where id = $1', [sale.id])
  await asUser(db, director, 'update sales set total_amount = 1 where id = $1', [sale.id])
  const after = (await db.query('select total_amount, (select count(*)::int from payments where sale_id = $1) payments from sales where id = $1', [sale.id])).rows[0]
  expect(after && Number(after.total_amount) === Number(sale.total_amount) && after.payments > 0, JSON.stringify(after))
  const session = (await db.query('select id, opening_amount from cash_sessions limit 1')).rows[0]
  await asUser(db, director, 'update cash_sessions set opening_amount = 999999 where id = $1', [session.id])
  expect(Number((await db.query('select opening_amount from cash_sessions where id = $1', [session.id])).rows[0].opening_amount) === Number(session.opening_amount), 'session unchanged')
})

results.push('\nQueries sent by the app')
await test('every join to a table reachable through two links names its link (else Supabase answers 300)', async () => {
  // Pairs (from, to) with two or more foreign keys: an embed of `to` from `from` is ambiguous without !fkey.
  const pairs = (await db.query(`select conrelid::regclass::text src, confrelid::regclass::text dst from pg_constraint where contype = 'f' and connamespace = 'public'::regnamespace group by 1, 2 having count(*) > 1`)).rows
  const ambiguous = new Set(pairs.map((row) => row.dst))
  const { readdirSync, readFileSync, statSync } = await import('node:fs')
  const files = (dir) => readdirSync(dir).flatMap((name) => { const path = `${dir}/${name}`; return statSync(path).isDirectory() ? files(path) : /\.(ts|tsx)$/.test(name) ? [path] : [] })
  const root = new URL('../../src', import.meta.url).pathname
  const offenders = files(root).flatMap((file) => [...readFileSync(file, 'utf8').matchAll(/(\w+):(\w+)\(/g)]
    .filter((match) => ambiguous.has(match[2])).map((match) => `${file.slice(root.length + 1)}: ${match[0]}`))
  expect(offenders.length === 0, `${offenders.length} ambiguous join(s): ${offenders.slice(0, 6).join(' | ')} (tables: ${[...ambiguous].join(', ')})`)
})

console.log(results.join('\n'))
if (failures) { console.log(`\n${failures} scenario test(s) failed`); process.exit(1) }
console.log('\nAll scenario tests passed')
