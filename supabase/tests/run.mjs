// Database tests: replays every migration on a Supabase replica, then exercises
// the main workflows as real users with row-level security active.
//   npm run test:db
import { asUser, buildDatabase, createUser } from './harness.mjs'

let failures = 0
const results = []
async function test(name, fn) {
  try { await fn(); results.push(`  ✓ ${name}`) } catch (error) { failures += 1; results.push(`  ✗ ${name}\n      ${error.message}`) }
}
const expect = (condition, message) => { if (!condition) throw new Error(message) }
async function rejects(promise, pattern) {
  try { await promise } catch (error) { expect(!pattern || pattern.test(error.message), `unexpected error: ${error.message}`); return }
  throw new Error('expected an error, the operation succeeded')
}
const num = (value) => Number(value)

const db = await buildDatabase()
console.log('All migrations applied.')

const owner = await createUser(db, { email: 'owner@shop.ht', name: 'Marie Owner' })
const accountant = await createUser(db, { email: 'compta@shop.ht', name: 'Paul Compta', role: 'accountant' })
const cashier = await createUser(db, { email: 'cash@shop.ht', name: 'Jean Caisse' })
const as = (user, sql, params) => asUser(db, user, sql, params)
const one = async (user, sql, params) => (await as(user, sql, params)).rows[0]

results.push('\nSetup and point of sale')
let product
await test('first owner becomes director, a second bootstrap is refused', async () => {
  expect((await one(null, 'select public.is_initial_setup_complete() v')).v === false, 'setup should be incomplete')
  await as(owner, 'select public.create_first_admin_user($1)', [owner])
  expect((await one(null, 'select public.is_initial_setup_complete() v')).v === true, 'setup should be complete')
  await rejects(as(cashier, 'select public.create_first_admin_user($1)', [cashier]), /already exists/)
})
await test('director creates a product and records its initial stock', async () => {
  const category = (await one(owner, `insert into categories (name) values ('Épicerie') returning id`)).id
  product = (await one(owner, `insert into products (name, barcode, category_id, selling_price, purchase_price, unit) values ('Riz 5 lb', 'RIZ5', $1, 450, 300, 'sac') returning id`, [category])).id
  expect(num((await one(owner, `select new_stock from public.record_stock_movement($1, 'entry', 10, 'Stock initial')`, [product])).new_stock) === 10, 'stock should be 10')
})
await test('cash session, offline sale (idempotent) and close', async () => {
  await as(owner, 'select public.open_cash_session(500, null)')
  const args = ['33333333-3333-3333-3333-333333333331', JSON.stringify([{ product_id: product, quantity: 2, discount_amount: 0, tax_amount: 0 }]), JSON.stringify([{ method: 'cash', amount: 900 }])]
  const first = await one(owner, 'select sale_number, total_amount from public.complete_offline_sale($1, null, $2::jsonb, $3::jsonb, null)', args)
  const retry = await one(owner, 'select sale_number from public.complete_offline_sale($1, null, $2::jsonb, $3::jsonb, null)', args)
  expect(first.sale_number === retry.sale_number && num(first.total_amount) === 900, 'retry must return the same sale')
  expect(num((await db.query('select stock_quantity from products')).rows[0].stock_quantity) === 8, 'stock should be 8')
  await as(owner, `select public.close_cash_session(1400, 'fin')`)
})
await test('cash count totals are recomputed by the database', async () => {
  const row = await one(owner, `insert into cash_counts (shift, direction, htg, htg_total) values ('AM', 'out', '{"counts":{"500":2},"bank_till":500}', 999) returning htg_total, htg_over_short`)
  expect(num(row.htg_total) === 1000 && num(row.htg_over_short) === 500, `got ${JSON.stringify(row)}`)
})
await test('cashier cannot create products', async () => {
  await rejects(as(cashier, `insert into products (name, selling_price) values ('x', 1)`), /row-level security/)
})

results.push('\nAccounting: chart of accounts')
const accountId = async (code) => (await db.query('select id from accounts where code = $1', [code])).rows[0].id
await test('accounts carry nature and term (contra-asset is credit)', async () => {
  const rows = Object.fromEntries((await db.query(`select code, nature, term from accounts where code in ('101000','130000','150000','201000','220000','301000','401000','501000')`)).rows.map((r) => [r.code, `${r.nature}/${r.term ?? '-'}`]))
  expect(JSON.stringify(rows) === JSON.stringify({ 101000: 'debit/short', 130000: 'debit/long', 150000: 'credit/long', 201000: 'credit/short', 220000: 'credit/long', 301000: 'credit/-', 401000: 'credit/-', 501000: 'debit/-' }), JSON.stringify(rows))
})
await test('income statement groups, with discount and return accounts', async () => {
  const groups = Object.fromEntries((await db.query(`select code, statement_group, nature from accounts where code in ('401000','403000','408000','409000','501000','505000','101000')`)).rows.map((r) => [r.code, `${r.statement_group ?? '-'}/${r.nature}`]))
  expect(JSON.stringify(groups) === JSON.stringify({ 101000: '-/debit', 401000: 'sales/credit', 403000: 'other_income/credit', 408000: 'sales_deduction/debit', 409000: 'sales_deduction/debit', 501000: 'cogs/debit', 505000: 'expense/debit' }), JSON.stringify(groups))
  await rejects(db.query(`update accounts set statement_group = 'cogs' where code = '401000'`), /statement_group/)
})
let pettyCash
await test('accountant creates and edits an account; duplicate codes are refused', async () => {
  pettyCash = (await one(accountant, `select id from public.save_account(null, '106000', 'Caisse secondaire', 'asset', null, 'short', null, null)`)).id
  const parent = await accountId('101000')
  const edited = await one(accountant, `select name, parent_id, nature from public.save_account($1, '106000', 'Caisse secondaire HTG', 'asset', null, 'short', $2, 'Caisse du dépôt')`, [pettyCash, parent])
  expect(edited.name === 'Caisse secondaire HTG' && edited.parent_id === parent && edited.nature === 'debit', JSON.stringify(edited))
  await rejects(as(accountant, `select public.save_account(null, '106000', 'Doublon', 'asset')`), /déjà utilisé/)
  await rejects(as(accountant, `select public.save_account(null, '199000', 'Revenu à terme', 'revenue', null, 'short')`), /terme/)
})
await test('cashier can read the chart of accounts (to choose counterparts) but not change it', async () => {
  expect((await as(cashier, 'select count(*)::int n from accounts')).rows[0].n > 40, 'cashier should see the chart of accounts')
  expect((await as(cashier, 'select count(*)::int n from journal_entries')).rows[0].n === 0, 'but no entries')
  await rejects(as(cashier, `select public.save_account(null, '105000', 'X', 'asset')`), /Permission/)
})

results.push('\nAccounting: journal entries')
const lines = (...items) => JSON.stringify(items.map(([account, debit, credit, description]) => ({ account_id: account, debit, credit, description })))
let entry
await test('an unbalanced draft can be saved but not posted', async () => {
  const [cash, capital] = [await accountId('101000'), await accountId('301000')]
  entry = await one(accountant, `select * from public.save_journal_entry(null, '2026-01-15', 'Apport en capital', 'PV-001', 'standard', null, $1::jsonb)`, [lines([cash, 10000, 0], [capital, 0, 9000])])
  expect(entry.status === 'draft' && num(entry.total_debit) === 10000 && num(entry.total_credit) === 9000, JSON.stringify(entry))
  await rejects(as(accountant, 'select public.post_journal_entry($1)', [entry.id]), /déséquilibrée/)
})
await test('the corrected draft is posted, then its lines are frozen', async () => {
  const [cash, capital] = [await accountId('101000'), await accountId('301000')]
  await as(accountant, `select public.save_journal_entry($1, '2026-01-15', 'Apport en capital', 'PV-001', 'standard', null, $2::jsonb)`, [entry.id, lines([cash, 10000, 0], [capital, 0, 10000])])
  await as(accountant, 'select public.post_journal_entry($1)', [entry.id])
  await rejects(as(accountant, `select public.save_journal_entry($1, '2026-01-15', 'Modif', null, 'standard', null, $2::jsonb)`, [entry.id, lines([cash, 1, 0], [capital, 0, 1])]), /brouillon/)
  await rejects(db.query('update journal_entry_lines set debit_amount = 1 where journal_entry_id = $1', [entry.id]), /ne peuvent plus être modifiées/)
})
await test('history records creation, update and posting with snapshots', async () => {
  const history = (await as(accountant, 'select action, snapshot from journal_entry_history where journal_entry_id = $1 order by changed_at, action', [entry.id])).rows
  expect(history.map((h) => h.action).sort().join(',') === 'created,posted,updated', history.map((h) => h.action).join(','))
  expect(history.find((h) => h.action === 'created').snapshot.lines.length === 2, 'snapshot should include the lines')
})
await test('validation rules: inactive account, one side per line, regularisation needs a justification', async () => {
  const [cash, capital] = [await accountId('101000'), await accountId('301000')]
  await as(accountant, 'select public.set_account_active($1, false)', [pettyCash])
  await rejects(as(accountant, `select public.save_journal_entry(null, '2026-01-20', 'X', null, 'standard', null, $1::jsonb)`, [lines([pettyCash, 5, 0], [cash, 0, 5])]), /inactif/)
  await as(accountant, 'select public.set_account_active($1, true)', [pettyCash])
  await rejects(as(accountant, `select public.save_journal_entry(null, '2026-01-20', 'X', null, 'standard', null, $1::jsonb)`, [lines([cash, 5, 5], [capital, 0, 0])]), /soit un débit, soit un crédit/)
  await rejects(as(accountant, `select public.save_journal_entry(null, '2026-01-31', 'Régul', null, 'regularisation', null, $1::jsonb)`, [lines([cash, 5, 0], [capital, 0, 5])]), /justifiée/)
})
await test('balances: opening, period and regularisation movements are separated', async () => {
  const [cash, rent, supplier] = [await accountId('101000'), await accountId('505000'), await accountId('201000')]
  const feb = await one(accountant, `select id from public.save_journal_entry(null, '2026-02-05', 'Loyer février', 'F-12', 'standard', null, $1::jsonb)`, [lines([rent, 3000, 0], [cash, 0, 3000])])
  await as(accountant, 'select public.post_journal_entry($1)', [feb.id])
  const reg = await one(accountant, `select id from public.save_journal_entry(null, '2026-02-28', 'Loyer à payer', 'REG-1', 'regularisation', 'Facture reçue en mars pour février', $1::jsonb)`, [lines([rent, 500, 0], [supplier, 0, 500])])
  await as(accountant, 'select public.submit_journal_entry($1)', [reg.id])
  await as(owner, 'select public.post_journal_entry($1)', [reg.id])
  const rows = Object.fromEntries((await as(accountant, `select code, opening_debit, period_credit, regularisation_debit, balance from public.account_balances('2026-02-01', '2026-02-28')`)).rows.map((r) => [r.code, r]))
  expect(num(rows['101000'].opening_debit) === 10000 && num(rows['101000'].period_credit) === 3000 && num(rows['101000'].balance) === 7000, JSON.stringify(rows['101000']))
  expect(num(rows['505000'].regularisation_debit) === 500 && num(rows['505000'].balance) === 3500, JSON.stringify(rows['505000']))
  const totals = (await as(accountant, `select sum(closing_debit) d, sum(closing_credit) c from public.account_balances('2026-02-01', '2026-02-28')`)).rows[0]
  expect(num(totals.d) === num(totals.c), `trial balance unbalanced: ${totals.d} / ${totals.c}`)
  await rejects(as(accountant, `select * from public.account_balances('2026-03-01', '2026-02-01')`), /postérieure/)
})
await test('void needs a reason, keeps the trace and leaves the balances', async () => {
  await rejects(as(accountant, `select public.void_journal_entry($1, '')`, [entry.id]), /motif/)
  const cashBalance = async () => num((await as(accountant, `select balance from public.account_balances(null, '2026-12-31') where code = '101000'`)).rows[0].balance)
  const before = await cashBalance()
  const voided = await one(accountant, `select status, void_reason, voided_by from public.void_journal_entry($1, 'Saisie en double')`, [entry.id])
  expect(voided.status === 'voided' && voided.void_reason === 'Saisie en double' && voided.voided_by === accountant, JSON.stringify(voided))
  // The voided 10 000 capital contribution no longer counts in the cash balance.
  expect(before - await cashBalance() === 10000, `cash went from ${before} to ${await cashBalance()}`)
})
results.push('\nAccounting: regularisation workflow')
await test('preparer submits, validator returns with a reason, edit withdraws, then validation', async () => {
  const [electricity, supplier] = [await accountId('506000'), await accountId('201000')]
  const draft = await one(accountant, `select * from public.save_journal_entry(null, '2026-02-28', 'Électricité février à payer', 'REG-2', 'regularisation', 'Facture EDH de février reçue le 5 mars', $1::jsonb, 'accrued_expense')`, [lines([electricity, 1200, 0], [supplier, 0, 1200])])
  expect(draft.regularisation_kind === 'accrued_expense' && draft.status === 'draft', JSON.stringify(draft))
  await rejects(as(accountant, 'select public.post_journal_entry($1)', [draft.id]), /directeur ou un administrateur/)
  await rejects(as(owner, 'select public.post_journal_entry($1)', [draft.id]), /soumise/)
  const submitted = await one(accountant, 'select submitted_by, submitted_at from public.submit_journal_entry($1)', [draft.id])
  expect(submitted.submitted_by === accountant && submitted.submitted_at, 'submission must be recorded')
  await rejects(as(accountant, `select public.return_journal_entry($1, 'Montant à vérifier')`, [draft.id]), /directeur ou un administrateur/)
  await rejects(as(owner, `select public.return_journal_entry($1, '')`, [draft.id]), /motif/)
  await as(owner, `select public.return_journal_entry($1, 'Joindre la facture et corriger le montant')`, [draft.id])
  await as(accountant, `select public.save_journal_entry($1, '2026-02-28', 'Électricité février à payer', 'REG-2', 'regularisation', 'Facture EDH n°4521 du 5 mars', $2::jsonb, 'accrued_expense')`, [draft.id, lines([electricity, 1250, 0], [supplier, 0, 1250])])
  await as(accountant, 'select public.submit_journal_entry($1)', [draft.id])
  // An edit after submission withdraws it: the validator must see the final version.
  await as(accountant, `select public.save_journal_entry($1, '2026-02-28', 'Électricité février à payer', 'REG-2', 'regularisation', 'Facture EDH n°4521 du 5 mars', $2::jsonb, 'accrued_expense')`, [draft.id, lines([electricity, 1250, 0], [supplier, 0, 1250])])
  await rejects(as(owner, 'select public.post_journal_entry($1)', [draft.id]), /soumise/)
  await as(accountant, 'select public.submit_journal_entry($1)', [draft.id])
  await as(owner, 'select public.post_journal_entry($1)', [draft.id])
  const history = (await as(accountant, 'select action, reason from journal_entry_history where journal_entry_id = $1 order by changed_at, id', [draft.id])).rows
  const actions = history.map((h) => h.action).join(',')
  expect(actions === 'created,submitted,returned,updated,submitted,updated,submitted,posted', actions)
  expect(history.find((h) => h.action === 'returned').reason === 'Joindre la facture et corriger le montant', 'return reason must be kept')
})
await test('unbalanced regularisations cannot be submitted; standard entries need no validation', async () => {
  const [cash, capital] = [await accountId('101000'), await accountId('301000')]
  const draft = await one(accountant, `select id from public.save_journal_entry(null, '2026-02-27', 'Régul déséquilibrée', null, 'regularisation', 'Test', $1::jsonb, 'other')`, [lines([cash, 100, 0], [capital, 0, 90])])
  await rejects(as(accountant, 'select public.submit_journal_entry($1)', [draft.id]), /équilibrée/)
  const standard = await one(accountant, `select id from public.save_journal_entry(null, '2026-02-27', 'Apport', null, 'standard', null, $1::jsonb)`, [lines([cash, 100, 0], [capital, 0, 100])])
  await rejects(as(accountant, 'select public.submit_journal_entry($1)', [standard.id]), /Seules les régularisations/)
  await as(accountant, 'select public.post_journal_entry($1)', [standard.id])
})
await test('regularisation balance: before, movements and after are consistent', async () => {
  const rows = (await as(accountant, `select code, opening_debit, opening_credit, period_debit, period_credit, regularisation_debit, regularisation_credit, closing_debit, closing_credit from public.account_balances('2026-02-01', '2026-02-28')`)).rows
  const sum = (field) => rows.reduce((total, row) => total + num(row[field]), 0)
  expect(sum('regularisation_debit') === sum('regularisation_credit'), 'regularisation movements must balance')
  expect(sum('closing_debit') === sum('closing_credit'), 'balance after regularisation must balance')
  const electricity = rows.find((row) => row.code === '506000')
  expect(num(electricity.regularisation_debit) === 1250 && num(electricity.closing_debit) === 1250, JSON.stringify(electricity))
})
await test('closed periods refuse new entries', async () => {
  await db.query(`update accounting_periods set is_closed = true, closed_at = now() where name = '2026-01'`)
  const [cash, capital] = [await accountId('101000'), await accountId('301000')]
  await rejects(as(accountant, `select public.save_journal_entry(null, '2026-01-25', 'Tardive', null, 'standard', null, $1::jsonb)`, [lines([cash, 1, 0], [capital, 0, 1])]), /clôturée/)
})
await test('cashier and anonymous visitors are kept out', async () => {
  await rejects(as(cashier, `select * from public.account_balances()`), /Permission/)
  expect((await as(cashier, 'select count(*)::int n from journal_entries')).rows[0].n === 0, 'cashier should see no entries')
  await rejects(as(null, 'select public.journal_entry_snapshot($1)', [entry.id]), /permission denied/)
  await rejects(as(cashier, `insert into journal_entries (entry_date, description) values ('2026-02-01', 'direct')`), /row-level security/)
})

results.push('\nAutomatic entries (sales, returns, expenses)')
const entryLines = async (entryId) => Object.fromEntries((await db.query(`select a.code, sum(l.debit_amount) - sum(l.credit_amount) net from journal_entry_lines l join accounts a on a.id = l.account_id where l.journal_entry_id = $1 group by a.code order by a.code`, [entryId])).rows.map((r) => [r.code, num(r.net)]))
let autoSale, autoProduct
await test('a completed sale is journalized at once: payments, discount, VAT and cost of goods sold', async () => {
  autoProduct = (await one(owner, `insert into products (name, barcode, selling_price, purchase_price, unit) values ('Huile 1 L', 'HUI-AUTO', 450, 0, 'bouteille') returning id`)).id
  await as(owner, `select public.record_stock_movement($1, 'entry', 10, 'Achat', null, 300)`, [autoProduct])
  await as(owner, 'select public.open_cash_session(0, null)')
  const items = JSON.stringify([{ product_id: autoProduct, quantity: 2, discount_amount: 50, tax_amount: 74 }])
  const payments = JSON.stringify([{ method: 'cash', amount: 524 }, { method: 'mobile_money', amount: 400, reference: 'MC-889' }])
  autoSale = await one(owner, 'select * from public.complete_sale(null, $1::jsonb, $2::jsonb, null)', [items, payments])
  const sale = (await db.query('select journal_entry_id, accounting_synced, accounting_error from sales where id = $1', [autoSale.id])).rows[0]
  expect(sale.journal_entry_id && sale.accounting_synced && !sale.accounting_error, JSON.stringify(sale))
  const entry = (await db.query('select status, entry_type, reference, total_debit, total_credit from journal_entries where id = $1', [sale.journal_entry_id])).rows[0]
  expect(entry.status === 'posted' && entry.entry_type === 'sale' && entry.reference === autoSale.sale_number && num(entry.total_debit) === 1574, JSON.stringify(entry))
  const net = await entryLines(sale.journal_entry_id)
  expect(JSON.stringify(net) === JSON.stringify({ 101000: 524, 105000: 400, 120000: -600, 210000: -74, 401000: -900, 409000: 50, 501000: 600 }), JSON.stringify(net))
})
await test('cash tendered above the total is accepted; only the cash kept is recorded', async () => {
  const items = JSON.stringify([{ product_id: autoProduct, quantity: 1, discount_amount: 0, tax_amount: 0 }])
  const sale = await one(owner, 'select * from public.complete_sale(null, $1::jsonb, $2::jsonb, null)', [items, JSON.stringify([{ method: 'cash', amount: 500 }])])
  const paid = (await db.query('select sum(amount) s from payments where sale_id = $1', [sale.id])).rows[0].s
  expect(num(sale.total_amount) === 450 && num(paid) === 450, `total ${sale.total_amount}, payments ${paid}`)
  await rejects(as(owner, 'select public.complete_sale(null, $1::jsonb, $2::jsonb, null)', [items, JSON.stringify([{ method: 'card', amount: 500 }])]), /does not match/)
  await rejects(as(owner, 'select public.complete_sale(null, $1::jsonb, $2::jsonb, null)', [items, JSON.stringify([{ method: 'cash', amount: 400 }])]), /does not match/)
})
await test('journalizing again never creates a duplicate', async () => {
  const again = await one(owner, 'select public.sync_sale_to_accounting($1) r', [autoSale.id])
  const count = (await db.query(`select count(*)::int n from journal_entries where reference_type = 'sale' and reference_id = $1`, [autoSale.id])).rows[0].n
  expect(count === 1 && again.r.success, `entries for the sale: ${count}`)
  await rejects(db.query(`insert into journal_entries (period_id, entry_date, description, entry_type, reference_type, reference_id, status, created_by) values ((select id from accounting_periods limit 1), current_date, 'doublon', 'sale', 'sale', $1, 'draft', $2)`, [autoSale.id, owner]), /duplicate key|unique/)
})
await test('a return restocks the goods and posts the reversing entry; cashiers cannot cancel', async () => {
  await rejects(as(cashier, `select public.cancel_sale($1, 'refunded', 'Client mécontent')`, [autoSale.id]), /directeur ou un administrateur/)
  await rejects(as(owner, `select public.cancel_sale($1, 'refunded', '')`, [autoSale.id]), /motif/)
  const stockBefore = num((await db.query('select stock_quantity from products where id = $1', [autoProduct])).rows[0].stock_quantity)
  const sale = await one(owner, `select status, cancel_reason, reversal_entry_id from public.cancel_sale($1, 'refunded', 'Bouteilles abîmées')`, [autoSale.id])
  expect(sale.status === 'refunded' && sale.cancel_reason === 'Bouteilles abîmées' && sale.reversal_entry_id, JSON.stringify(sale))
  expect(num((await db.query('select stock_quantity from products where id = $1', [autoProduct])).rows[0].stock_quantity) === stockBefore + 2, 'stock must come back')
  const net = await entryLines(sale.reversal_entry_id)
  expect(JSON.stringify(net) === JSON.stringify({ 101000: -524, 105000: -400, 120000: 600, 210000: 74, 408000: 850, 501000: -600 }), JSON.stringify(net))
  await rejects(as(owner, `select public.cancel_sale($1, 'cancelled', 'Encore')`, [autoSale.id]), /terminée/)
})
await test('an expense posts to its accounts; it is never deleted, cancelling voids the entry with the reason', async () => {
  const [electricity, bank] = [await accountId('506000'), await accountId('102000')]
  const expense = await one(owner, `insert into expenses (label, amount, expense_date, created_by, expense_account_id, payment_account_id) values ('Facture EDH', 2450, '2026-11-05', $1, $2, $3) returning id`, [owner, electricity, bank])
  const row = (await db.query('select journal_entry_id from expenses where id = $1', [expense.id])).rows[0]
  expect(JSON.stringify(await entryLines(row.journal_entry_id)) === JSON.stringify({ 102000: -2450, 506000: 2450 }), 'expense entry')
  await as(owner, 'delete from expenses where id = $1', [expense.id])
  expect((await db.query('select count(*)::int n from expenses where id = $1', [expense.id])).rows[0].n === 1, 'a delete has no effect')
  await rejects(db.query('delete from expenses where id = $1', [expense.id]), /ne se supprime pas/)
  await rejects(as(cashier, `select public.cancel_expense($1, 'Erreur')`, [expense.id]), /directeurs, administrateurs et comptables/)
  const cancelled = await one(owner, `select status, cancel_reason from public.cancel_expense($1, 'Facture en double')`, [expense.id])
  const voided = (await db.query('select status, void_reason from journal_entries where id = $1', [row.journal_entry_id])).rows[0]
  expect(cancelled.status === 'cancelled' && voided.status === 'voided' && voided.void_reason === 'Dépense annulée : Facture en double', JSON.stringify({ cancelled, voided }))
  await rejects(as(owner, `select public.cancel_expense($1, 'Encore')`, [expense.id]), /déjà annulée/)
})
await test('a closed period never blocks a sale: the error is kept and the entry is generated later', async () => {
  const name = (await db.query(`select name from accounting_periods where current_date between start_date and end_date`)).rows[0].name
  await db.query(`update accounting_periods set is_closed = true, closed_at = now() where name = $1`, [name])
  const items = JSON.stringify([{ product_id: autoProduct, quantity: 1, discount_amount: 0, tax_amount: 0 }])
  const sale = await one(owner, 'select * from public.complete_sale(null, $1::jsonb, $2::jsonb, null)', [items, JSON.stringify([{ method: 'cash', amount: 450 }])])
  const pending = (await db.query('select journal_entry_id, accounting_error from sales where id = $1', [sale.id])).rows[0]
  expect(sale.status === 'completed' && !pending.journal_entry_id && /clôturée/.test(pending.accounting_error), JSON.stringify(pending))
  await db.query(`update accounting_periods set is_closed = false where name = $1`, [name])
  const result = (await one(accountant, 'select public.journalize_pending() r')).r
  expect(result.journalized >= 1 && result.failed === 0, JSON.stringify(result))
  expect((await db.query('select journal_entry_id from sales where id = $1', [sale.id])).rows[0].journal_entry_id, 'the pending sale must now be journalized')
  await as(owner, 'select public.close_cash_session(0, null)')
})

results.push('\nCash management (movements, petty cash, cash report)')
const cashier2 = await createUser(db, { email: 'caisse2@shop.ht', name: 'Rose Caisse', role: 'cashier' })
let cashSession
await test('a cashier day: sales, typed movements, theoretical balance and difference', async () => {
  const product = (await one(owner, `insert into products (name, barcode, selling_price, purchase_price, unit) values ('Savon', 'SAV-CASH', 450, 0, 'unité') returning id`)).id
  await as(owner, `select public.record_stock_movement($1, 'entry', 20, 'Achat', null, 200)`, [product])
  await as(cashier2, 'select public.open_cash_session(1000, null)')
  await as(cashier2, 'select public.complete_sale(null, $1::jsonb, $2::jsonb, null)', [JSON.stringify([{ product_id: product, quantity: 1, discount_amount: 0, tax_amount: 0 }]), JSON.stringify([{ method: 'cash', amount: 500 }])])
  await as(cashier2, 'select public.complete_sale(null, $1::jsonb, $2::jsonb, null)', [JSON.stringify([{ product_id: product, quantity: 2, discount_amount: 0, tax_amount: 0 }]), JSON.stringify([{ method: 'card', amount: 900 }])])
  const capitalCurrent = await accountId('302000')
  const deposit = await one(cashier2, `select * from public.record_cash_movement('deposit', 2000, 'Apport du gérant', 'BON-1', $1)`, [capitalCurrent])
  expect(deposit.direction === 'in' && deposit.cash_session_id && deposit.journal_entry_id, JSON.stringify(deposit))
  await as(cashier2, `select public.record_cash_movement('bank_deposit', 1500, 'Versement banque', 'BORD-77')`)
  const expense = await one(cashier2, `select * from public.record_cash_movement('expense', 300, 'Achat de sacs', 'TICKET-5', $1)`, [await accountId('508000')])
  expect(expense.expense_id && !expense.journal_entry_id, 'a cash expense becomes an expense')
  expect((await db.query('select journal_entry_id from expenses where id = $1', [expense.expense_id])).rows[0].journal_entry_id, 'the expense is posted')
  await rejects(as(cashier2, `select public.record_cash_movement('other_in', 50, 'Sans contrepartie')`), /contrepartie/)
  await rejects(as(cashier2, `select public.record_cash_movement('expense', 50, 'Mauvais compte', null, $1)`, [await accountId('401000')]), /compte de charges/)
  await as(cashier2, `select public.close_cash_session(1600, 'fin')`)
  cashSession = (await one(cashier2, `select * from public.cash_session_report(public.local_day(now()), public.local_day(now()))`))
  // 1000 opening + 450 cash sale − 0 refunds + 2000 in − (1500 + 300) out = 1650; counted 1600 → −50.
  const got = { opening: num(cashSession.opening_amount), sales: num(cashSession.cash_sales), in: num(cashSession.cash_in), out: num(cashSession.cash_out), theoretical: num(cashSession.theoretical), counted: num(cashSession.counted), difference: num(cashSession.difference) }
  expect(JSON.stringify(got) === JSON.stringify({ opening: 1000, sales: 450, in: 2000, out: 1800, theoretical: 1650, counted: 1600, difference: -50 }), JSON.stringify(got))
  expect(cashSession.cashier_name === 'Rose Caisse', 'cashier name')
})
await test('the difference is posted only once a director validates it', async () => {
  expect(!(await db.query(`select 1 from journal_entries where reference_type = 'cash_difference' and reference_id = $1`, [cashSession.session_id])).rows.length, 'nothing posted before validation')
  await rejects(as(cashier2, `select public.validate_cash_difference($1, 'Erreur de rendu')`, [cashSession.session_id]), /directeur ou un administrateur/)
  await rejects(as(owner, `select public.validate_cash_difference($1, '')`, [cashSession.session_id]), /justification/)
  const validated = await one(owner, `select difference_amount, difference_entry_id from public.validate_cash_difference($1, 'Erreur de rendu de monnaie')`, [cashSession.session_id])
  expect(num(validated.difference_amount) === -50, JSON.stringify(validated))
  expect(JSON.stringify(await entryLines(validated.difference_entry_id)) === JSON.stringify({ 101000: -50, 519100: 50 }), 'shortage posted to 519100')
  await rejects(as(owner, `select public.validate_cash_difference($1, 'Encore')`, [cashSession.session_id]), /déjà validé/)
})
await test('petty cash: funded from the main cash, cannot overspend, cashiers stay out', async () => {
  await rejects(as(cashier2, `select public.record_cash_movement('expense', 100, 'Café', null, $1, '104000')`, [await accountId('508000')]), /petite caisse/)
  await as(owner, `select public.record_cash_movement('petty_cash_funding', 5000, 'Fonds de petite caisse', 'PC-1')`)
  await as(accountant, `select public.record_cash_movement('expense', 1200, 'Fournitures', 'PC-B1', $1, '104000')`, [await accountId('508000')])
  await rejects(as(accountant, `select public.record_cash_movement('expense', 4000, 'Trop cher', null, $1, '104000')`, [await accountId('508000')]), /insuffisant/)
  const balance = num((await as(accountant, `select balance from public.account_balances(null, null) where code = '104000'`)).rows[0].balance)
  expect(balance === 3800, `petty cash balance ${balance}`)
})
await test('voiding a movement keeps it visible and voids its entry', async () => {
  const movement = await one(owner, `select * from public.record_cash_movement('bank_withdrawal', 700, 'Retrait banque', 'CHQ-9')`)
  await rejects(as(cashier, `select public.void_cash_movement($1, 'Erreur')`, [movement.id]), /directeurs/)
  const voided = await one(accountant, `select status, void_reason from public.void_cash_movement($1, 'Saisie en double')`, [movement.id])
  expect(voided.status === 'voided' && (await db.query('select status from journal_entries where id = $1', [movement.journal_entry_id])).rows[0].status === 'voided', JSON.stringify(voided))
  expect((await as(cashier, 'select count(*)::int n from cash_movements')).rows[0].n === 0, "a cashier only sees their own movements")
  expect((await as(accountant, `select count(*)::int n from profiles where full_name = 'Rose Caisse'`)).rows[0].n === 1, 'accounting can see who recorded an operation')
  expect((await as(cashier, `select count(*)::int n from profiles where full_name = 'Rose Caisse'`)).rows[0].n === 0, 'a cashier cannot list other staff')
})

results.push('\nPayments (MonCash, NatCash, cheque)')
await test('MonCash, NatCash and cheque sales are accepted and posted to their accounts', async () => {
  const product = (await one(owner, `insert into products (name, barcode, selling_price, purchase_price, unit) values ('Café moulu', 'CAF-PAY', 200, 0, 'paquet') returning id`)).id
  await as(owner, `select public.record_stock_movement($1, 'entry', 20, 'Achat', null, 120)`, [product])
  const seller = await createUser(db, { email: 'caisse-pay@shop.ht', name: 'Lucie Caisse', role: 'cashier' })
  await as(seller, 'select public.open_cash_session(0, null)')
  const sell = (payments) => one(seller, 'select * from public.complete_sale(null, $1::jsonb, $2::jsonb, null)', [JSON.stringify([{ product_id: product, quantity: 1, discount_amount: 0, tax_amount: 0 }]), JSON.stringify(payments)])
  const debited = async (sale) => (await db.query(`select a.code from journal_entry_lines l join accounts a on a.id = l.account_id where l.journal_entry_id = (select journal_entry_id from sales where id = $1) and l.debit_amount > 0 and a.code like '10%' order by a.code`, [sale.id])).rows.map((r) => r.code).join(',')
  const moncash = await sell([{ method: 'moncash', amount: 200, reference: ' MC-7781 ' }])
  const natcash = await sell([{ method: 'natcash', amount: 200, reference: 'NC-12' }])
  const cheque = await sell([{ method: 'check', amount: 200, reference: 'CHQ 0042' }])
  const split = await sell([{ method: 'cash', amount: 100 }, { method: 'moncash', amount: 100, reference: 'MC-7782' }])
  expect(await debited(moncash) === '105000' && await debited(natcash) === '105000', 'mobile money posted to 105000')
  expect(await debited(cheque) === '103000', 'cheque posted to 103000')
  expect(await debited(split) === '101000,105000', `split payment ${await debited(split)}`)
  expect((await db.query('select method, reference from payments where sale_id = $1', [moncash.id])).rows[0].method === 'moncash', 'method kept as moncash')
})
await test('a MonCash or NatCash payment needs a transaction ID that was never used', async () => {
  const product = (await db.query(`select id from products where barcode = 'CAF-PAY'`)).rows[0].id
  const seller = (await db.query(`select id from profiles where full_name = 'Lucie Caisse'`)).rows[0].id
  const sell = (payments) => as(seller, 'select * from public.complete_sale(null, $1::jsonb, $2::jsonb, null)', [JSON.stringify([{ product_id: product, quantity: 1, discount_amount: 0, tax_amount: 0 }]), JSON.stringify(payments)])
  await rejects(sell([{ method: 'moncash', amount: 200 }]), /Référence de transaction MonCash obligatoire/)
  await rejects(sell([{ method: 'natcash', amount: 200, reference: '  ' }]), /Référence de transaction NatCash obligatoire/)
  await rejects(sell([{ method: 'moncash', amount: 200, reference: 'mc-7781' }]), /Référence MonCash mc-7781 déjà utilisée pour la vente/)
  // The same number on the other network is a different transaction.
  await sell([{ method: 'natcash', amount: 200, reference: 'MC-7781' }])
  await rejects(sell([{ method: 'paypal', amount: 200 }]), /Invalid payment/)
  // The cash register asks before queuing a sale; only the sale number comes back.
  const used = await one(cashier, `select public.payment_reference_used('moncash', ' MC-7781') as sale`)
  expect(/^VTE-/.test(used.sale ?? ''), `lookup ${JSON.stringify(used)}`)
  expect((await one(cashier, `select public.payment_reference_used('moncash', 'MC-0000') as sale`)).sale === null, 'unused ID')
  await rejects(asUser(db, null, `select public.payment_reference_used('moncash', 'MC-7781')`), /permission denied/)
})

results.push('\nSynchronisation and cash controls (cahier des charges A, B)')
await test('opening a register twice returns the open session (a replayed offline opening)', async () => {
  const seller = await createUser(db, { email: 'caisse-sync@shop.ht', name: 'Nina Caisse', role: 'cashier' })
  const first = await one(seller, 'select * from public.open_cash_session(500, null)')
  const again = await one(seller, 'select * from public.open_cash_session(800, null)')
  expect(first.id === again.id && num(again.opening_amount) === 500, JSON.stringify({ first: first.id, again: again.id }))
})
await test('an offline sale keeps its real time, in the session open at that time', async () => {
  const seller = (await db.query(`select id from profiles where full_name = 'Nina Caisse'`)).rows[0].id
  const product = (await one(owner, `insert into products (name, barcode, selling_price, purchase_price, unit) values ('Thé', 'THE-SYNC', 100, 0, 'paquet') returning id`)).id
  await as(owner, `select public.record_stock_movement($1, 'entry', 10, 'Achat', null, 60)`, [product])
  // The session was opened yesterday morning and closed in the evening; the sale is synced today.
  await db.query(`update cash_sessions set opened_at = now() - interval '1 day 4 hours' where opened_by = $1 and closed_at is null`, [seller])
  const soldAt = new Date(Date.now() - 26 * 3600e3).toISOString()
  await db.query(`update cash_sessions set closed_at = now() - interval '20 hours', closing_amount = 600 where opened_by = $1 and closed_at is null`, [seller])
  const items = JSON.stringify([{ product_id: product, quantity: 1, discount_amount: 0, tax_amount: 0 }])
  const sale = await one(seller, 'select * from public.complete_offline_sale(gen_random_uuid(), null, $1::jsonb, $2::jsonb, null, $3)', [items, JSON.stringify([{ method: 'cash', amount: 100 }]), soldAt])
  expect(Math.abs(new Date(sale.sold_at) - new Date(soldAt)) < 1000, `sold_at ${sale.sold_at}`)
  const movement = (await db.query(`select movement_at from stock_movements where reference_id = $1`, [sale.id])).rows[0]
  expect(Math.abs(new Date(movement.movement_at) - new Date(soldAt)) < 1000, 'stock movement at the sale time')
  const entry = (await db.query(`select entry_date from journal_entries where id = (select journal_entry_id from sales where id = $1)`, [sale.id])).rows[0]
  expect(entry && String(entry.entry_date.toISOString?.() ?? entry.entry_date).slice(0, 10) === (await db.query(`select public.local_day($1::timestamptz)::text d`, [soldAt])).rows[0].d, 'entry dated the day of the sale')
  const report = (await as(seller, `select cash_sales from public.cash_session_report(public.local_day(now() - interval '2 days'), public.local_day(now()))`)).rows
  expect(report.some((row) => num(row.cash_sales) === 100), `counted in yesterday's session ${JSON.stringify(report)}`)
  await rejects(as(seller, 'select public.complete_sale(null, $1::jsonb, $2::jsonb, null, $3)', [items, JSON.stringify([{ method: 'cash', amount: 100 }]), new Date(Date.now() + 3600e3).toISOString()]), /dans le futur/)
  await rejects(as(seller, 'select public.complete_sale(null, $1::jsonb, $2::jsonb, null, $3)', [items, JSON.stringify([{ method: 'cash', amount: 100 }]), new Date(Date.now() - 9 * 86400e3).toISOString()]), /trop ancienne \(plus de 7 jours\)/)
  // Outside any session (no session open now, none at that time): refused.
  await rejects(as(seller, 'select public.complete_sale(null, $1::jsonb, $2::jsonb, null, $3)', [items, JSON.stringify([{ method: 'cash', amount: 100 }]), new Date(Date.now() - 3 * 86400e3).toISOString()]), /Open a cash session first/)
})
await test('cash outflows above the threshold wait for a director; nothing is posted before', async () => {
  const seller = (await db.query(`select id from profiles where full_name = 'Nina Caisse'`)).rows[0].id
  const session = await one(seller, 'select * from public.open_cash_session(10000, null)')
  const supplies = await accountId('508000')
  const small = await one(seller, `select * from public.record_cash_movement('expense', 800, 'Sachets', 'T-1', $1)`, [supplies])
  expect(small.status === 'posted' && small.expense_id, 'below the threshold: posted at once')
  const big = await one(seller, `select * from public.record_cash_movement('expense', 6000, 'Réparation congélateur', 'DEVIS-4', $1)`, [supplies])
  expect(big.status === 'pending' && !big.expense_id && !big.journal_entry_id, JSON.stringify(big))
  const out = async () => num((await one(seller, `select cash_out from public.cash_session_report(public.local_day(now()), public.local_day(now())) where session_id = $1`, [session.id])).cash_out)
  expect(await out() === 800, 'a pending outflow is not in the cash report')
  await rejects(as(seller, `select public.approve_cash_movement($1)`, [big.id]), /directeur ou un administrateur/)
  const approved = await one(owner, `select * from public.approve_cash_movement($1, 'Devis accepté')`, [big.id])
  expect(approved.status === 'posted' && approved.expense_id && approved.approved_by === owner, JSON.stringify(approved))
  expect(await out() === 6800, 'counted once approved')
  const refused = await one(seller, `select * from public.record_cash_movement('withdrawal', 7000, 'Avance', null, $1)`, [await accountId('302000')])
  const rejected = await one(owner, `select * from public.reject_cash_movement($1, 'Non prévu')`, [refused.id])
  expect(rejected.status === 'rejected' && !rejected.journal_entry_id && await out() === 6800, 'a rejected outflow posts nothing')
  const own = await one(owner, `select * from public.record_cash_movement('supplier_payment', 9000, 'Minoterie', 'MH-9')`)
  expect(own.status === 'posted' && own.approved_by === owner, 'a director authorises their own outflow')
  // Voiding a cash expense cancels it (kept), it no longer deletes it.
  await one(owner, `select * from public.void_cash_movement($1, 'Ticket perdu')`, [small.id])
  expect((await db.query('select status from expenses where id = $1', [small.expense_id])).rows[0].status === 'cancelled', 'cash expense cancelled, still there')
})
await test('outflows from the bank or MonCash: accounting roles, expenses and supplier payments only', async () => {
  const seller = (await db.query(`select id from profiles where full_name = 'Nina Caisse'`)).rows[0].id
  await rejects(as(seller, `select public.record_cash_movement('supplier_payment', 100, 'Fournisseur', null, null, '102000')`), /banque ou MonCash/)
  const paid = await one(accountant, `select * from public.record_cash_movement('supplier_payment', 2500, 'Minoterie', 'VIR-3', null, '102000')`)
  expect(JSON.stringify(await entryLines(paid.journal_entry_id)) === JSON.stringify({ 102000: -2500, 201000: 2500 }) && !paid.cash_session_id, JSON.stringify(await entryLines(paid.journal_entry_id)))
  await rejects(as(accountant, `select public.record_cash_movement('deposit', 100, 'Apport', null, $1, '105000')`, [await accountId('302000')]), /dépenses et paiements fournisseurs seulement/)
})

results.push('\nProformas (E2, E3)')
await test('proformas: saved in one transaction, history of every change, prices by right, never any stock', async () => {
  const seller = await createUser(db, { email: 'caisse-pf@shop.ht', name: 'Mia Caisse', role: 'cashier' })
  const other = await createUser(db, { email: 'caisse-pf2@shop.ht', name: 'Léo Caisse', role: 'cashier' })
  const product = (await one(owner, `insert into products (name, barcode, selling_price, proforma_price, purchase_price, unit) values ('Ciment Gris', 'CIM-PF', 900, 850, 0, 'sac') returning id`)).id
  const sugar = (await one(owner, `insert into products (name, barcode, selling_price, purchase_price, unit) values ('Sucre PF', 'SUC-PF', 80, 0, 'lb') returning id`)).id
  await as(owner, `select public.record_stock_movement($1, 'entry', 10, 'Achat', null, 600)`, [product])
  const stock = async () => num((await db.query('select stock_quantity from products where id = $1', [product])).rows[0].stock_quantity)
  const pf = await one(seller, `select * from public.save_proforma(null, null, current_date + 15, 'Chantier', $1::jsonb)`, [JSON.stringify([{ product_id: product, quantity: 4 }])])
  expect(num(pf.total_amount) === 3400 && pf.status === 'draft' && pf.revision === 1, `default price is the proforma price ${JSON.stringify(pf)}`)
  expect((await as(owner, 'select count(*)::int n from proformas where id = $1', [pf.id])).rows[0].n === 1, 'the director sees it')
  expect((await as(other, 'select count(*)::int n from proformas where id = $1', [pf.id])).rows[0].n === 0, 'another cashier does not')
  await rejects(as(seller, `select public.save_proforma($1, null, null, null, $2::jsonb)`, [pf.id, JSON.stringify([{ product_id: product, quantity: 4, unit_price: 700 }])]), /réservé aux responsables autorisés/)
  const edited = await one(seller, `select * from public.save_proforma($1, null, current_date + 15, 'Chantier', $2::jsonb, 'Ajout du sucre')`, [pf.id, JSON.stringify([{ product_id: product, quantity: 4, unit_price: 900 }, { product_id: sugar, quantity: 10, discount_amount: 50 }])])
  expect(edited.revision === 2 && num(edited.total_amount) === 4350, `catalogue price accepted, totals by the server ${JSON.stringify(edited)}`)
  const priced = await one(owner, `select * from public.save_proforma($1, null, current_date + 15, 'Chantier', $2::jsonb)`, [pf.id, JSON.stringify([{ product_id: product, quantity: 4, unit_price: 820 }])])
  expect(num(priced.total_amount) === 3280, 'a director sets another price')
  const history = (await as(owner, 'select action, revision, note from proforma_history where proforma_id = $1 order by changed_at', [pf.id])).rows
  expect(history.map((row) => `${row.action}${row.revision}`).join(',') === 'created1,updated2,updated3' && history[1].note === 'Ajout du sucre', JSON.stringify(history))
  await one(seller, `select * from public.set_proforma_status($1, 'accepted')`, [pf.id])
  await rejects(as(seller, `select public.save_proforma($1, null, null, null, $2::jsonb)`, [pf.id, JSON.stringify([{ product_id: product, quantity: 1 }])]), /acceptée ne se modifie plus/)
  expect(await stock() === 10, 'a proforma never touches the stock')
  // The sale made from it deducts the stock; the proforma is linked to it.
  await as(seller, 'select public.open_cash_session(0, null)')
  const sale = await one(seller, 'select * from public.complete_sale(null, $1::jsonb, $2::jsonb, null)', [JSON.stringify([{ product_id: product, quantity: 4, discount_amount: 320, tax_amount: 0 }]), JSON.stringify([{ method: 'cash', amount: 3280 }])])
  const converted = await one(seller, 'select * from public.mark_proforma_converted($1, $2)', [pf.id, sale.id])
  expect(converted.status === 'converted' && converted.converted_sale_id === sale.id && await stock() === 6, JSON.stringify(converted))
  expect((await db.query('select proforma_id from sales where id = $1', [sale.id])).rows[0].proforma_id === pf.id, 'sale linked')
  await rejects(as(seller, `select public.set_proforma_status($1, 'draft')`, [pf.id]), /transformée en vente/)
  await rejects(as(seller, `insert into proformas (customer_id, subtotal, total_amount, status, created_by) values (null, 1, 1, 'draft', auth.uid())`), /row-level security/)
})

results.push('\nStock entries (purchases, returns, losses, adjustments)')
await test('stock movements post their entries; the stock account equals the stock value', async () => {
  const keeper = await createUser(db, { email: 'magasin@shop.ht', name: 'Max Magasin', role: 'stock_manager' })
  const product = (await one(owner, `insert into products (name, barcode, selling_price, purchase_price, unit) values ('Farine 25 lb', 'FAR-25', 900, 0, 'sac') returning id`)).id
  const move = (type, qty, price = null, settlement = null, reason = 'Test') => one(keeper, `select * from public.record_stock_movement($1, $2, $3, $4, null, $5, null, null, now(), $6)`, [product, type, qty, reason, price, settlement])
  const lines = async (movement) => entryLines(movement.journal_entry_id)
  const stockBalance = async () => num((await db.query(`select coalesce(sum(l.debit_amount - l.credit_amount), 0) b from journal_entry_lines l join journal_entries je on je.id = l.journal_entry_id join accounts a on a.id = l.account_id where a.code = '120000' and je.status = 'posted' and exists (select 1 from stock_movements m where m.journal_entry_id = je.id and m.product_id = $1 union all select 1 from sales s join sale_items i on i.sale_id = s.id where s.journal_entry_id = je.id and i.product_id = $1)`, [product])).rows[0].b)
  const opening = await move('entry', 4, 500, 'opening', 'Stock initial')
  expect(JSON.stringify(await lines(opening)) === JSON.stringify({ 120000: 2000, 304000: -2000 }), `opening ${JSON.stringify(await lines(opening))}`)
  expect((await db.query('select entry_type from journal_entries where id = $1', [opening.journal_entry_id])).rows[0].entry_type === 'opening', 'opening entry type')
  const credit = await move('entry', 6, 550)
  expect(credit.settlement === 'supplier' && JSON.stringify(await lines(credit)) === JSON.stringify({ 120000: 3300, 201000: -3300 }), `on credit ${JSON.stringify(await lines(credit))}`)
  const bank = await move('entry', 10, 520, 'bank')
  expect(JSON.stringify(await lines(bank)) === JSON.stringify({ 102000: -5200, 120000: 5200 }), 'paid by bank')
  // Average cost: (2000 + 3300 + 5200) / 20 = 525.
  expect(num((await db.query('select average_cost from products where id = $1', [product])).rows[0].average_cost) === 525, 'average cost 525')
  expect(!(await move('entry', 1)).journal_entry_id, 'an entry without a price posts nothing')
  // It counts at zero cost: 10 500 / 21 = 500.
  expect(num((await db.query('select average_cost from products where id = $1', [product])).rows[0].average_cost) === 500, 'free entry lowers the average')
  const broken = await move('exit', 2, null, null, 'Sacs déchirés')
  expect(JSON.stringify(await lines(broken)) === JSON.stringify({ 120000: -1000, 501100: 1000 }), `loss at average cost ${JSON.stringify(await lines(broken))}`)
  expect(JSON.stringify(await lines(await move('adjustment', -1, null, null, 'Inventaire'))) === JSON.stringify({ 120000: -500, 501100: 500 }), 'negative adjustment')
  expect(JSON.stringify(await lines(await move('adjustment', 1, null, null, 'Inventaire'))) === JSON.stringify({ 120000: 500, 501100: -500 }), 'positive adjustment')
  const back = await move('supplier_return', 2, 550, null, 'Sacs mouillés')
  expect(JSON.stringify(await lines(back)) === JSON.stringify({ 120000: -1100, 201000: 1100 }), 'supplier return at purchase price')
  // Remaining 17 bags: (9 500 − 1 100) / 17 = 494,12.
  expect(num((await db.query('select average_cost from products where id = $1', [product])).rows[0].average_cost) === 494.12, 'average recomputed after the return')
  await rejects(move('exit', 1, null, 'opening'), /stock d'ouverture ne concerne que les entrées/)
  await rejects(move('entry', 1, 10, 'cash'), /Règlement inconnu/)
  // A sale takes the cost out of 120000: the account always equals quantity × average cost.
  const seller = (await db.query(`select id from profiles where full_name = 'Lucie Caisse'`)).rows[0].id
  await as(seller, 'select public.complete_sale(null, $1::jsonb, $2::jsonb, null)', [JSON.stringify([{ product_id: product, quantity: 3, discount_amount: 0, tax_amount: 0 }]), JSON.stringify([{ method: 'cash', amount: 2700 }])])
  const state = (await db.query('select stock_quantity, average_cost from products where id = $1', [product])).rows[0]
  const value = Math.round(num(state.stock_quantity) * num(state.average_cost) * 100) / 100
  expect(Math.abs(await stockBalance() - value) < 0.05, `120000 for this product ${await stockBalance()} vs stock value ${value} (${num(state.stock_quantity)} × ${num(state.average_cost)})`)
})
await test('a supplier paid from the till: cash movement « Paiement fournisseur »', async () => {
  const seller = (await db.query(`select id from profiles where full_name = 'Lucie Caisse'`)).rows[0].id
  const payment = await one(seller, `select * from public.record_cash_movement('supplier_payment', 3300, 'Règlement Minoterie', 'FACT-88')`)
  expect(payment.direction === 'out' && JSON.stringify(await entryLines(payment.journal_entry_id)) === JSON.stringify({ 101000: -3300, 201000: 3300 }), JSON.stringify(await entryLines(payment.journal_entry_id)))
  const report = await one(seller, `select cash_out from public.cash_session_report(public.local_day(now()), public.local_day(now()))`)
  expect(num(report.cash_out) >= 3300, `cash report includes the payment (${report.cash_out})`)
})

results.push('\nCatalog (units, supplier categories, duplicates)')
const admin = await createUser(db, { email: 'admin@shop.ht', name: 'Ali Admin', role: 'administrator' })
const stockKeeper = await createUser(db, { email: 'stock@shop.ht', name: 'Sam Stock', role: 'stock_manager' })
const newProduct = (user, name, extra = {}) => one(user, `insert into products (name, selling_price, unit, barcode) values ($1, 100, $2, $3) returning *`, [name, extra.unit ?? 'unité', extra.barcode ?? null])
await test('units: seeded, cleaned, unique whatever the case; only catalog staff manage them', async () => {
  const names = (await as(cashier, 'select name from units order by name')).rows.map((r) => r.name)
  expect(['sac', 'kg', 'marmite', 'unité'].every((name) => names.includes(name)), names.join(','))
  const unit = await one(stockKeeper, `insert into units (name) values ('  Grand   sac ') returning name`)
  expect(unit.name === 'Grand sac', unit.name)
  await rejects(as(admin, `insert into units (name) values ('grand SAC')`), /duplicate|unique/)
  await rejects(as(cashier, `insert into units (name) values ('Seau')`), /row-level security/)
})
await test('products: unit must be in the list; names and barcodes cannot be duplicated', async () => {
  const product = await newProduct(admin, '  Huile   Mazola 1 L ', { unit: 'LITRE', barcode: ' HM1 ' })
  expect(product.name === 'Huile Mazola 1 L' && product.unit === 'litre' && product.barcode === 'HM1', JSON.stringify(product))
  await rejects(newProduct(stockKeeper, 'huile mazola 1 l'), /Un produit nommé « Huile Mazola 1 L » existe déjà/)
  await rejects(newProduct(stockKeeper, 'Huile Mazola 3 L', { barcode: 'HM1' }), /code-barres HM1 est déjà utilisé par « Huile Mazola 1 L »/)
  await rejects(newProduct(stockKeeper, 'Seau de maïs', { unit: 'seau' }), /Unité « seau » inconnue/)
  await as(owner, 'update products set active = false where id = $1', [product.id])
  await rejects(newProduct(owner, 'HUILE MAZOLA 1 L'), /inactif : réactivez-le/)
  // Updates that keep the name, or only touch prices, still work.
  await as(admin, `update products set name = 'Huile Mazola 1 L', selling_price = 150, unit = 'litre' where id = $1`, [product.id])
  await rejects(as(cashier, `insert into products (name, selling_price) values ('Pirate', 1)`), /row-level security/)
})
await test('existing duplicates do not block unrelated updates', async () => {
  await db.query(`alter table products disable trigger products_check_catalog`)
  const legacy = (await db.query(`insert into products (name, selling_price, unit) values ('Sucre', 80, 'lb'), ('SUCRE', 80, 'lb') returning id`)).rows
  await db.query(`alter table products enable trigger products_check_catalog`)
  await as(owner, 'update products set selling_price = 90, name = name where id = $1', [legacy[1].id])
  expect(num((await db.query('select selling_price from products where id = $1', [legacy[1].id])).rows[0].selling_price) === 90, 'price updated')
})
await test('suppliers: categories, duplicates, products and deliveries', async () => {
  const category = await one(admin, `select id from supplier_categories where name = 'Producteurs locaux'`)
  const supplier = await one(admin, `insert into suppliers (name, category_id) values (' Coopérative  Kenscoff ', $1) returning *`, [category.id])
  expect(supplier.name === 'Coopérative Kenscoff', supplier.name)
  await rejects(as(stockKeeper, `insert into suppliers (name) values ('coopérative kenscoff')`), /Un fournisseur nommé « Coopérative Kenscoff » existe déjà/)
  await rejects(as(cashier, `insert into supplier_categories (name) values ('Pirates')`), /row-level security/)
  const product = await newProduct(admin, 'Carottes', { unit: 'lb' })
  await as(admin, 'update products set supplier_id = $1 where id = $2', [supplier.id, product.id])
  await as(admin, `select public.record_stock_movement($1, 'entry', 40, 'Livraison', $2, 25)`, [product.id, supplier.id])
  const delivery = await one(admin, `select quantity, purchase_price from stock_movements where supplier_id = $1`, [supplier.id])
  expect(num(delivery.quantity) === 40 && num(delivery.purchase_price) === 25, JSON.stringify(delivery))
  expect((await as(cashier, 'select count(*)::int n from stock_movements')).rows[0].n === 0, 'cashiers do not read stock movements')
})

results.push('\nFinancial statements (worked example)')
// The statement formulas live in src/lib/statements.ts; Node strips its types (≥ 22.6).
let statements = null
try { statements = await import('../../src/lib/statements.ts') } catch { results.push('  – skipped: Node 22.6 or later is needed to load src/lib/statements.ts') }
if (statements) {
  const chief = await createUser(db, { email: 'chief@shop.ht', name: 'Chef Compta', role: 'director' })
  const code = async (c) => (await db.query('select id from accounts where code = $1', [c])).rows[0].id
  const book = async (date, label, items, type = 'standard') => {
    const lines = JSON.stringify(await Promise.all(items.map(async ([c, debit, credit]) => ({ account_id: await code(c), debit, credit }))))
    const entry = (await asUser(db, chief, `select id from public.save_journal_entry(null, $1, $2, null, $3, $4, $5::jsonb, $6)`, [date, label, type, type === 'regularisation' ? 'Amortissement mensuel' : null, lines, type === 'regularisation' ? 'depreciation' : null])).rows[0]
    if (type === 'regularisation') await asUser(db, chief, 'select public.submit_journal_entry($1)', [entry.id])
    await asUser(db, chief, 'select public.post_journal_entry($1)', [entry.id])
  }
  await test('sales report and income statement agree on net sales (returns included)', async () => {
    const sales = (await db.query(`select s.*, coalesce((select jsonb_agg(jsonb_build_object('method', p.method, 'amount', p.amount)) from payments p where p.sale_id = s.id), '[]') payments from sales s`)).rows
    const summary = statements.salesSummary(sales)
    const accounts = statements.incomeStatement((await asUser(db, chief, 'select * from public.account_balances(null, null)')).rows)
    expect(summary.pending.length === 0, `${summary.pending.length} sale(s) not journalized`)
    expect(summary.returns === 850 && summary.netSales === accounts.netSales, `report ${JSON.stringify({ gross: summary.grossSales, discounts: summary.discounts, returns: summary.returns, net: summary.netSales })} vs accounts ${accounts.netSales}`)
  })
  // Separate company books: the earlier tests' entries are voided first so the example stands alone.
  await db.query(`update journal_entries set status = 'voided', voided_at = now(), void_reason = 'reset for statements test' where status = 'posted'`)
  await db.query(`update accounting_periods set is_closed = false`)
  await book('2025-12-10', 'Achat de stock', [['120000', 20000, 0], ['201000', 0, 20000]])
  await book('2025-12-15', 'Apport en capital', [['101000', 100000, 0], ['301000', 0, 100000]])
  await book('2025-12-20', 'Ventes décembre', [['101000', 10000, 0], ['401000', 0, 10000]])
  await book('2025-12-20', 'Coût des ventes décembre', [['501000', 6000, 0], ['120000', 0, 6000]])
  await book('2026-11-02', 'Ventes', [['101000', 20000, 0], ['401000', 0, 20000]])
  await book('2026-11-02', 'Remise accordée', [['409000', 500, 0], ['101000', 0, 500]])
  await book('2026-11-03', 'Retour client', [['408000', 1000, 0], ['101000', 0, 1000]])
  await book('2026-11-03', 'Coût des ventes', [['501000', 11000, 0], ['120000', 0, 11000]])
  await book('2026-11-04', 'Loyer', [['505000', 3000, 0], ['101000', 0, 3000]])
  await book('2026-11-04', 'Emprunt bancaire', [['102000', 50000, 0], ['220000', 0, 50000]])
  await book('2026-11-05', 'Achat matériel', [['130000', 30000, 0], ['102000', 0, 30000]])
  await book('2026-11-06', 'Intérêts reçus', [['102000', 200, 0], ['405000', 0, 200]])
  await book('2026-11-30', 'Amortissement novembre', [['515000', 1000, 0], ['150000', 0, 1000]], 'regularisation')
  const balances = async (from, to) => (await asUser(db, chief, 'select * from public.account_balances($1, $2)', [from, to])).rows

  await test('income statement: net sales, gross margin and net result', async () => {
    const r = statements.incomeStatement(await balances('2026-11-01', '2026-11-30'))
    const got = { gross: r.grossSales, deductions: r.totalDeductions, net: r.netSales, cogs: r.totalCogs, margin: r.grossMargin, other: r.totalOtherIncome, expenses: r.totalExpenses, result: r.netResult }
    expect(JSON.stringify(got) === JSON.stringify({ gross: 20000, deductions: 1500, net: 18500, cogs: 11000, margin: 7500, other: 200, expenses: 4000, result: 3700 }), JSON.stringify(got))
    expect(r.consistent, 'direct revenue − expense check must match')
    expect(r.deductions.map((l) => l.account.code).sort().join() === '408000,409000', 'discounts and returns are listed separately')
  })
  await test('balance sheet: assets = liabilities + equity, with short/long term and results', async () => {
    const r = statements.balanceSheet(await balances(statements.financialYearStart('2026-11-30'), '2026-11-30'))
    const got = { short: r.assets[0].total, long: r.assets[1].total, assets: r.totalAssets, liabShort: r.liabilities[0].total, liabLong: r.liabilities[1].total, prior: r.priorResults, current: r.currentResult, equity: r.totalEquity, difference: r.difference }
    expect(JSON.stringify(got) === JSON.stringify({ short: 148700, long: 29000, assets: 177700, liabShort: 20000, liabLong: 50000, prior: 4000, current: 3700, equity: 107700, difference: 0 }), JSON.stringify(got))
    expect(r.assets[1].lines.find((l) => l.account.code === '150000').amount === -1000, 'accumulated depreciation reduces fixed assets')
  })
  await test('trial balance: before and after regularisation, both balanced', async () => {
    const rows = await balances('2026-11-01', '2026-11-30')
    const after = statements.trialBalance(rows)
    const before = statements.trialBalance(rows, { includeRegularisation: false })
    for (const [label, t] of [['after', after.totals], ['before', before.totals]]) {
      expect(statements.isBalanced(t.openingDebit, t.openingCredit) && statements.isBalanced(t.movementDebit, t.movementCredit) && statements.isBalanced(t.closingDebit, t.closingCredit), `${label}: ${JSON.stringify(t)}`)
    }
    expect(after.totals.movementDebit - before.totals.movementDebit === 1000, 'regularisation adds 1 000 of movements')
    expect(after.groups.map((g) => g.id).slice(0, 2).join() === 'asset_short,asset_long', after.groups.map((g) => g.id).join())
  })

  results.push('\nPartners (associés)')
  let partnerA, partnerB
  await test('partners get their capital and current accounts; shares cannot exceed 100 %', async () => {
    partnerA = (await asUser(db, chief, `select * from public.save_partner(null, 'Alice Joseph', 60, null)`)).rows[0]
    partnerB = (await asUser(db, chief, `select * from public.save_partner(null, 'Bruno Pierre', 40, null)`)).rows[0]
    const codes = (await db.query(`select a.code, a.name from accounts a where a.id = any($1) order by a.code`, [[partnerA.capital_account_id, partnerA.current_account_id, partnerB.capital_account_id, partnerB.current_account_id]])).rows.map((r) => `${r.code} ${r.name}`)
    expect(codes.join(' | ') === '301101 Capital - Alice Joseph | 301102 Capital - Bruno Pierre | 302101 Compte courant - Alice Joseph | 302102 Compte courant - Bruno Pierre', codes.join(' | '))
    await rejects(asUser(db, chief, `select public.save_partner(null, 'Carl', 1, null)`), /100 %/)
    await asUser(db, chief, `select public.save_partner($1, 'Alice Joseph-Louis', 60, 'Gérante')`, [partnerA.id])
    expect((await db.query('select name from accounts where id = $1', [partnerA.capital_account_id])).rows[0].name === 'Capital - Alice Joseph-Louis', 'renaming the partner renames the accounts')
    await rejects(asUser(db, cashier, `select public.save_partner(null, 'Intrus', 0, null)`), /Permission/)
    expect((await asUser(db, cashier, 'select count(*)::int n from partners')).rows[0].n === 0, 'cashier must not see partners')
  })
  await test('partners equity: opening, contributions, result share, withdrawals, adjustments; consistent with the balance sheet', async () => {
    const [capA, ccA, capB, ccB] = await Promise.all([partnerA.capital_account_id, partnerA.current_account_id, partnerB.capital_account_id, partnerB.current_account_id].map(async (id) => (await db.query('select code from accounts where id = $1', [id])).rows[0].code))
    await book('2026-11-10', 'Augmentation de capital A', [['101000', 10000, 0], [capA, 0, 10000]])
    await book('2026-11-11', 'Apport en compte courant B', [['101000', 5000, 0], [ccB, 0, 5000]])
    await book('2026-11-12', 'Retrait A', [[ccA, 2000, 0], ['101000', 0, 2000]])
    await book('2026-11-30', 'Correction apport B', [['304000', 300, 0], [capB, 0, 300]], 'regularisation')
    const period = await balances('2026-11-01', '2026-11-30')
    const ids = [partnerA.capital_account_id, partnerA.current_account_id, partnerB.capital_account_id, partnerB.current_account_id]
    const movements = (await asUser(db, chief, `select l.account_id, l.debit_amount, l.credit_amount, jsonb_build_object('entry_number', je.entry_number, 'entry_date', je.entry_date, 'description', je.description, 'reference', je.reference, 'entry_type', je.entry_type) entry
      from journal_entry_lines l join journal_entries je on je.id = l.journal_entry_id where je.status = 'posted' and je.entry_date between '2026-11-01' and '2026-11-30' and l.account_id = any($1)`, [ids])).rows
    const partners = (await asUser(db, chief, 'select * from partners order by name')).rows
    const r = statements.partnersEquity(partners, period, movements)
    const pick = (row) => ({ opening: row.opening, capital: row.capitalIncreases, contributions: row.contributions, result: row.resultShare, withdrawals: row.withdrawals, adjustments: row.adjustments, closing: row.closing })
    expect(JSON.stringify(pick(r.rows[0])) === JSON.stringify({ opening: 2400, capital: 10000, contributions: 0, result: 2220, withdrawals: 2000, adjustments: 0, closing: 12620 }), JSON.stringify(pick(r.rows[0])))
    expect(JSON.stringify(pick(r.rows[1])) === JSON.stringify({ opening: 1600, capital: 0, contributions: 5000, result: 1480, withdrawals: 0, adjustments: 300, closing: 8380 }), JSON.stringify(pick(r.rows[1])))
    expect(r.otherEquity === 99700 && r.unallocatedResult === 0 && r.totalEquity === 120700, JSON.stringify({ other: r.otherEquity, unallocated: r.unallocatedResult, total: r.totalEquity }))
    const sheet = statements.balanceSheet(await balances(statements.financialYearStart('2026-11-30'), '2026-11-30'))
    expect(sheet.totalEquity === r.totalEquity && sheet.difference === 0, `balance sheet equity ${sheet.totalEquity} vs partners ${r.totalEquity}`)
    expect(r.rows[1].details.find((d) => d.category === 'adjustment').description === 'Correction apport B', 'adjustments keep their description')
  })
}

console.log(results.join('\n'))
console.log(failures ? `\n${failures} test(s) failed` : '\nAll database tests passed')
process.exit(failures ? 1 : 0)
