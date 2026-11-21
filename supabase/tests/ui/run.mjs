// Browser tests (`npm run test:ui`): every page for each role, then the
// scenarios of the cahier des charges (steps A, B, C). Requires Google Chrome.
import { asUser, buildDatabase, createUser } from '../harness.mjs'
import { openAs, openPages, sleep, startApp, text, ROOT } from './helpers.mjs'
import { fakeSupabase } from '../fake-supabase.mjs'
import { canOpen, defaultPermissions, PAGE_ACCESS } from '../../../src/lib/permissions.ts'
import { mkdirSync } from 'node:fs'

const results = []
let failures = 0
async function test(name, fn) {
  openPages.length = 0
  try { await fn(); results.push(`  ✓ ${name}`) } catch (error) {
    failures += 1
    let detail = ''
    const page = openPages.at(-1)
    if (page && !page.isClosed()) {
      // What the screen showed when the test failed.
      if (process.env.UI_SHOTS) await page.screenshot({ path: `${process.env.UI_SHOTS}/failed-${results.length}.png` }).catch(() => {})
      detail = `\n      screen: ${(await page.locator('main').innerText().catch(() => '')).replace(/\s+/g, ' ').slice(0, 300)}`
    }
    results.push(`  ✗ ${name}\n      ${String(error.message).split('\n')[0].slice(0, 400)}${detail}`)
  }
}
const expect = (condition, message) => { if (!condition) throw new Error(message) }
const noErrors = (page) => expect(page.errors.length === 0, `page errors: ${page.errors.join(' | ')}`)

const db = await buildDatabase()
const users = {
  director: { name: 'Marie Directrice', role: 'director' },
  cashier: { name: 'Rose Caisse', role: 'cashier' },
  cashier2: { name: 'Lina Caisse', role: 'cashier' },
  accountant: { name: 'Paul Compta', role: 'accountant' },
  stock_manager: { name: 'Sam Stock', role: 'stock_manager' },
  admin: { name: 'Alex Admin', role: 'administrator' },
}
for (const [key, user] of Object.entries(users)) user.userId = await createUser(db, { email: `${key}@shop.ht`, name: user.name, role: user.role })
const as = (user, sql, params) => asUser(db, users[user].userId, sql, params)
const one = async (user, sql, params) => (await as(user, sql, params)).rows[0]
const accountId = async (code) => (await db.query('select id from accounts where code = $1', [code])).rows[0].id
const category = (await one('director', `insert into categories (name) values ('Épicerie') returning id`)).id
const product = async (name, barcode, stock, price = 450) => {
  const id = (await one('director', `insert into products (name, barcode, selling_price, purchase_price, unit, category_id) values ($1, $2, $3, 0, 'sac', $4) returning id`, [name, barcode, price, category])).id
  if (stock) await as('director', `select public.record_stock_movement($1, 'entry', $2, 'Stock initial', null, 300, null, null, now(), 'opening')`, [id, stock])
  return id
}

const app = await startApp(5310)
try {
  // -------------------------------------------------------------------------
  results.push('Every page, for each role')
  for (const role of ['director', 'cashier', 'accountant', 'stock_manager', 'admin']) {
    await test(`${users[role].name} (${role}): every page and tab opens without error`, async () => {
      const page = await openAs(app, db, users[role], '/')
      await page.waitForSelector('aside nav a'); await sleep(800)
      const links = await page.locator('aside nav a').evaluateAll((items) => items.map((item) => item.getAttribute('href')))
      const refused = []
      for (const href of links) {
        await page.click(`aside nav a[href="${href}"]`); await sleep(1200)
        if (await page.locator('text=Accès refusé').count()) refused.push(href)
        for (const tab of await page.locator('main [role="tab"]').allInnerTexts()) { await page.click(`main [role="tab"]:has-text("${tab.trim()}")`); await sleep(600) }
      }
      expect(refused.length === 0, `menu shows pages the role cannot open: ${refused.join(', ')}`)
      noErrors(page)
      await page.context().close()
    })
  }

  // -------------------------------------------------------------------------
  results.push('\nPoint of sale (A5, C2, C3)')
  const rice = await product('Riz Bongu 5 lb', 'RIZ5', 2)
  await as('cashier', 'select public.open_cash_session(1000, null)')
  await test('stock is checked at the point of sale; new customer; recap before validation', async () => {
    const page = await openAs(app, db, users.cashier, '/caisse')
    const scan = async (code) => { await page.fill('input[placeholder="Scanner un code-barres..."]', code); await page.press('input[placeholder="Scanner un code-barres..."]', 'Enter'); await sleep(700) }
    await page.waitForSelector('input[placeholder="Scanner un code-barres..."]')
    await scan('RIZ5'); await scan('RIZ5')
    expect(await page.locator('button[aria-label="Augmenter Riz Bongu 5 lb"]').isDisabled(), '+ disabled at the stock limit')
    await scan('RIZ5')
    expect(/Stock insuffisant : seulement 2 sac disponible\(s\)/.test(await text(page.locator('main [role="alert"]'))), await text(page.locator('main')))
    expect(await page.locator('input[aria-label="Remise sur Riz Bongu 5 lb"]').count() === 0, 'no discount for a cashier')
    // Search while typing shows the stock.
    await page.fill('input[aria-label="Rechercher un produit"]', 'Riz'); await sleep(900)
    expect(/2 sac disponible/.test(await text(page.locator('aside:has-text("Recherche produit")'))), 'stock in search results')
    // « + Nouveau client », selected for the sale.
    await page.click('button:has-text("Nouveau client")')
    const dialog = page.locator('[role="dialog"]')
    await dialog.locator('label:has-text("Nom complet") input').fill('Jean Client')
    await dialog.locator('label:has-text("Téléphone") input').fill('+509 3700 1111')
    await dialog.locator('button:has-text("Enregistrer")').click(); await sleep(900)
    expect(/Jean Client/.test(await text(page.locator('main'))), 'new customer selected')
    // Recap, mobile money ID, cash change.
    await page.click('button:has-text("Encaisser")'); await sleep(400)
    const recap = await text(dialog)
    expect(/2 × Riz Bongu 5 lb/.test(recap) && /Total à payer 900\.00 HTG/.test(recap) && /Client : Jean Client/.test(recap), recap)
    await dialog.locator('select').selectOption('moncash')
    await dialog.locator('button:has-text("Valider la vente")').click(); await sleep(300)
    expect(/Saisissez l’ID de transaction MonCash/.test(await text(dialog)), 'MonCash ID required')
    await dialog.locator('select').selectOption('cash')
    await dialog.locator('label:has-text("Montant reçu") input').fill('1000'); await sleep(200)
    expect(/Monnaie à rendre : 100\.00 HTG/.test(await text(dialog)), 'change shown')
    await dialog.locator('button:has-text("Valider la vente")').click()
    await page.waitForSelector('text=/Vente enregistrée. Monnaie à rendre : 100.00 HTG/'); await sleep(2500)
    const sale = (await db.query(`select s.total_amount::float total, c.full_name, (select stock_quantity::float from products where id = $1) stock from sales s left join customers c on c.id = s.customer_id order by s.created_at desc limit 1`, [rice])).rows[0]
    expect(sale?.total === 900 && sale.full_name === 'Jean Client' && sale.stock === 0, JSON.stringify(sale))
    noErrors(page)
    await page.context().close()
  })

  // -------------------------------------------------------------------------
  results.push('\nSynchronisation (A1, A2, A3, A4)')
  const oil = await product('Huile Mazola 1 L', 'HM1', 1, 600)
  await test('a sale refused at sync shows the real reason; retry and abandon', async () => {
    const page = await openAs(app, db, users.cashier, '/caisse')
    page.on('dialog', (dialog) => void dialog.accept())
    await page.waitForSelector('input[placeholder="Scanner un code-barres..."]')
    await page.fill('input[placeholder="Scanner un code-barres..."]', 'HM1'); await page.press('input[placeholder="Scanner un code-barres..."]', 'Enter'); await sleep(700)
    page.network.mode = 'offline'
    await page.click('button:has-text("Encaisser")'); await sleep(300)
    await page.locator('[role="dialog"] button:has-text("Valider la vente")').click(); await sleep(2500)
    // Meanwhile another cashier sells the last bottle on the server.
    await as('director', 'select public.open_cash_session(0, null)')
    await as('director', 'select public.complete_sale(null, $1::jsonb, $2::jsonb, null)', [JSON.stringify([{ product_id: oil, quantity: 1, discount_amount: 0, tax_amount: 0 }]), JSON.stringify([{ method: 'cash', amount: 600 }])])
    page.network.mode = 'ok'
    await page.click('aside button[title="Envoyer et recevoir les dernières données"]')
    await page.waitForSelector('text=/1 refusée/', { timeout: 20000 })
    const toast = await text(page.locator('[role="status"]:has-text("refusée")'))
    expect(/Stock insuffisant pour Huile Mazola 1 L/.test(toast) && !/Erreur réseau/.test(toast), toast)
    await page.click('aside button[aria-label="Détails de la synchronisation"]'); await sleep(500)
    const panel = page.locator('aside li:has-text("Vente du")')
    expect(/refusée/.test(await text(panel)) && /Stock insuffisant pour Huile Mazola 1 L/.test(await text(panel)), await text(panel))
    await panel.locator('button:has-text("Réessayer")').click(); await sleep(2500)
    expect(/Stock insuffisant/.test(await text(panel)), 'still refused after retry')
    await panel.locator('button:has-text("Abandonner")').click(); await sleep(800)
    expect(await panel.count() === 0, 'abandoned sale removed')
    noErrors(page)
    await page.context().close()
  })

  await test('register opened offline while a session exists on the server; sale keeps its real time', async () => {
    const soapId = await product('Savon Lave-Tout', 'SAV1', 5, 50)
    // The device was online earlier: profile, products and « no open session » are saved on it.
    const page = await openAs(app, db, users.cashier2, '/caisse')
    await page.waitForSelector('button:has-text("Ouvrir la caisse")')
    await page.click('aside button[title="Envoyer et recevoir les dernières données"]'); await sleep(3000)
    // The connection drops; meanwhile a session is opened for the same cashier on another device.
    page.network.mode = 'offline'
    await as('cashier2', 'select public.open_cash_session(300, null)')
    await page.click('button:has-text("Ouvrir la caisse")')
    await page.waitForSelector('input[placeholder="Scanner un code-barres..."]', { timeout: 15000 })
    await page.fill('input[placeholder="Scanner un code-barres..."]', 'SAV1'); await page.press('input[placeholder="Scanner un code-barres..."]', 'Enter'); await sleep(900)
    const soldAt = Date.now()
    await page.click('button:has-text("Encaisser")'); await sleep(300)
    await page.locator('[role="dialog"] button:has-text("Valider la vente")').click(); await page.waitForSelector('text=/Vente enregistrée/')
    await sleep(5000) // the sale waits a few seconds on the device
    page.network.mode = 'ok'
    await page.click('aside button[title="Envoyer et recevoir les dernières données"]'); await sleep(5000)
    await page.click('aside button[aria-label="Détails de la synchronisation"]'); await sleep(500)
    const pendingRows = await page.locator('aside li:has-text("Ouverture de caisse"), aside li:has-text("Vente du")').count()
    const sale = (await db.query(`select s.sold_at, s.created_at from sales s join sale_items i on i.sale_id = s.id where i.product_id = $1`, [soapId])).rows[0]
    const sessions = (await db.query(`select count(*)::int n from cash_sessions where opened_by = $1`, [users.cashier2.userId])).rows[0].n
    expect(pendingRows === 0 && sessions === 1, `nothing left to sync (${pendingRows} line(s)), one session (${sessions})`)
    expect(sale && Math.abs(new Date(sale.sold_at) - soldAt) < 3000 && new Date(sale.created_at) - new Date(sale.sold_at) > 3000, `sold_at ${sale?.sold_at} vs click ${new Date(soldAt).toISOString()}, synced ${sale?.created_at}`)
    noErrors(page)
    await page.context().close()
  })

  // -------------------------------------------------------------------------
  results.push('\nCash outflows and expenses (B1, B2, B3, B4)')
  await test('outflow from the point of sale above the threshold: pending, then authorised by the director', async () => {
    const page = await openAs(app, db, users.cashier, '/caisse')
    await page.waitForSelector('button:has-text("Sortie de caisse")')
    await page.click('button:has-text("Sortie de caisse")'); await sleep(800)
    const dialog = page.locator('[role="dialog"]')
    expect(/Sortie de caisse/.test(await text(dialog.locator('#modal-title'))) && await dialog.locator('optgroup[label="Entrées"]').count() === 0, 'outflows only')
    await dialog.locator('input[inputmode="decimal"]').fill('6000')
    await dialog.locator('input[placeholder^="Ex. : versement"]').fill('Réparation congélateur')
    await dialog.locator('select').nth(2).selectOption(await accountId('508000'))
    await dialog.locator('button:has-text("Enregistrer")').click()
    await page.waitForSelector('text=/en attente de validation par un directeur/')
    await page.context().close()
    const boss = await openAs(app, db, users.director, '/caisse/mouvements')
    await boss.waitForSelector('text=/1 sortie\\(s\\) en attente de validation/')
    await boss.click('tr:has-text("Réparation congélateur") button:has-text("Autoriser")')
    await boss.fill('[role="dialog"] textarea', 'Devis accepté')
    await boss.click('[role="dialog"] button:has-text("Autoriser")')
    await boss.waitForSelector('text=/autorisée et comptabilisée/'); await sleep(800)
    expect(/Autorisé par Marie Directrice : Devis accepté/.test(await text(boss.locator('tr:has-text("Réparation congélateur")'))), await text(boss.locator('tr:has-text("Réparation congélateur")')))
    const row = (await db.query(`select status, expense_id from cash_movements where label = 'Réparation congélateur'`)).rows[0]
    expect(row.status === 'posted' && row.expense_id, JSON.stringify(row))
    // A second one, refused.
    await as('cashier', `select public.record_cash_movement('withdrawal', 7000, 'Avance personnelle', null, $1)`, [await accountId('302000')])
    await boss.reload(); await boss.waitForSelector('tr:has-text("Avance personnelle")')
    await boss.click('tr:has-text("Avance personnelle") button:has-text("Refuser")')
    await boss.fill('[role="dialog"] textarea', 'Non prévu')
    await boss.click('[role="dialog"] button:has-text("Refuser")')
    await boss.waitForSelector('text=/refusée : rien n’est comptabilisé/'); await sleep(600)
    expect(/Refusée/.test(await text(boss.locator('tr:has-text("Avance personnelle")'))), 'rejected label')
    noErrors(boss)
    await boss.context().close()
  })

  await test('an expense is cancelled with a reason and stays visible', async () => {
    await one('director', `insert into expenses (label, amount, expense_date, created_by, expense_account_id, payment_account_id) values ('Facture EDH', 2450, current_date, $1, $2, $3) returning id`, [users.director.userId, await accountId('506000'), await accountId('102000')])
    const page = await openAs(app, db, users.director, '/depenses')
    await page.waitForSelector('tr:has-text("Facture EDH")')
    await page.click('tr:has-text("Facture EDH") button:has-text("Annuler")')
    await page.fill('[role="dialog"] textarea', 'Facture en double')
    await page.click('[role="dialog"] button:has-text("Annuler la dépense")')
    await page.waitForSelector('text=/annulée : son écriture est annulée/'); await sleep(800)
    expect(/Annulée : Facture en double/.test(await text(page.locator('tr:has-text("Facture EDH")'))), 'reason shown on the row')
    const row = (await db.query(`select e.status, je.status entry from expenses e left join journal_entries je on je.id = e.journal_entry_id where e.label = 'Facture EDH'`)).rows[0]
    expect(row.status === 'cancelled' && row.entry === 'voided', JSON.stringify(row))
    noErrors(page)
    await page.context().close()
  })

  // -------------------------------------------------------------------------
  results.push('\nQuick creation (C1)')
  await test('product form: « + Ajouter » category, supplier and unit, each selected at once', async () => {
    const page = await openAs(app, db, users.stock_manager, '/produits')
    await page.waitForSelector('button:has-text("Ajouter un produit")')
    await page.click('button:has-text("Ajouter un produit")'); await sleep(600)
    const form = page.locator('[role="dialog"]:has-text("Nouveau produit")')
    const quick = page.locator('[role="dialog"]:has(#quick-create-form)')
    await form.locator('button:has-text("Ajouter une catégorie")').click()
    await quick.locator('input').first().fill('Boissons'); await quick.locator('button:has-text("Enregistrer")').click(); await sleep(800)
    await form.locator('button:has-text("Ajouter un fournisseur")').click()
    await quick.locator('input').first().fill('Brasserie Nationale'); await quick.locator('button:has-text("Enregistrer")').click(); await sleep(800)
    await form.locator('button:has-text("Ajouter une unité")').click()
    await quick.locator('input').first().fill('caisse de 24'); await quick.locator('button:has-text("Enregistrer")').click(); await sleep(800)
    const selected = await form.locator('select').evaluateAll((items) => items.slice(0, 3).map((item) => item.options[item.selectedIndex]?.text))
    expect(JSON.stringify(selected) === JSON.stringify(['Boissons', 'Brasserie Nationale', 'caisse de 24']), JSON.stringify(selected))
    await form.locator('label:has-text("Nom du produit") input').fill('Prestige 12 oz')
    await form.locator('label:has-text("Prix de vente") input').fill('1800'); await sleep(700)
    await form.locator('button:has-text("Créer le produit")').click()
    await page.waitForSelector('text=/Prestige 12 oz » créé/')
    const row = (await db.query(`select c.name category, s.name supplier, p.unit from products p join categories c on c.id = p.category_id join suppliers s on s.id = p.supplier_id where p.name = 'Prestige 12 oz'`)).rows[0]
    expect(row?.category === 'Boissons' && row.supplier === 'Brasserie Nationale' && row.unit === 'caisse de 24', JSON.stringify(row))
    noErrors(page)
    await page.context().close()
  })

  // -------------------------------------------------------------------------
  results.push('\nUsers, roles and permissions (F1, F3)')
  const roleName = async (code) => (await db.query('select name from roles where code = $1', [code])).rows[0].name
  await test('director creates an account with a user name; it is listed with its role', async () => {
    const page = await openAs(app, db, users.director, '/utilisateurs')
    await page.waitForSelector('button:has-text("Ajouter un utilisateur")'); await sleep(500)
    expect(await page.locator('[role="tab"]:has-text("Rôles et permissions")').count() === 0, 'a director does not manage permissions by default')
    await page.click('button:has-text("Ajouter un utilisateur")'); await sleep(400)
    const dialog = page.locator('[role="dialog"]')
    await dialog.locator('label:has-text("Nom complet") input').fill('Nadia Caisse')
    expect(await dialog.locator('label:has-text("Nom d’utilisateur") input').inputValue() === 'nadia.caisse', 'user name suggested from the name')
    await dialog.locator('button[type="submit"]').click()
    await page.waitForSelector('text=/Compte de Nadia Caisse créé. Identifiant : nadia.caisse/')
    await sleep(800)
    expect(/Nadia Caisse/.test(await text(page.locator('main table'))), 'new account listed')
    const row = (await db.query(`select p.username, r.code from profiles p join roles r on r.id = p.role_id where p.full_name = 'Nadia Caisse'`)).rows[0]
    expect(row?.username === 'nadia.caisse' && row.code === 'cashier', JSON.stringify(row))
    noErrors(page)
    await page.context().close()
  })

  await test('administrator removes « Dépenses » from accountants: menu, page and database follow', async () => {
    const [accountantName, adminName] = [await roleName('accountant'), await roleName('administrator')]
    const page = await openAs(app, db, users.admin, '/utilisateurs')
    await page.click('[role="tab"]:has-text("Rôles et permissions")')
    const box = page.locator(`input[aria-label="Enregistrer et annuler les dépenses — ${accountantName}"]`)
    await box.waitFor()
    const lock = page.locator(`input[aria-label="Modifier les permissions des rôles — ${adminName}"]`)
    expect(await lock.isChecked() && await lock.isDisabled(), 'the administrator always keeps the permission management')
    expect(await box.isChecked(), 'accountants manage expenses by default')
    await box.uncheck()
    await page.click('button:has-text("Enregistrer (1 rôle)")')
    await page.waitForSelector(`text=/Permissions enregistrées : ${accountantName}/`, { timeout: 8000 }).catch(async () => { throw new Error(`not saved: ${await text(page.locator('main [role="alert"]')).catch(() => 'no alert')}`) })
    const accountant = await openAs(app, db, users.accountant, '/')
    await accountant.waitForSelector('aside nav a'); await sleep(1000)
    expect(await accountant.locator('aside nav a[href="/depenses"]').count() === 0, 'menu hides Dépenses')
    expect(await accountant.locator('aside nav a[href="/comptabilite"]').count() === 1, 'other pages stay')
    await accountant.goto(`${app.base}/depenses`); await sleep(1200)
    expect(new URL(accountant.url()).pathname === '/', `page refused, at ${accountant.url()}`)
    expect((await one('accountant', `select public.has_permission('expenses.manage') ok`)).ok === false, 'database refuses too')
    const audit = (await db.query(`select count(*)::int n from audit_log where action = 'role_permissions_updated'`)).rows[0].n
    expect(audit >= 1, 'change audited')
    await db.query(`insert into role_permissions (role_id, permission_code) select id, 'expenses.manage' from roles where code = 'accountant' on conflict do nothing`)
    noErrors(page); noErrors(accountant)
    await accountant.context().close(); await page.context().close()
  })

  // -------------------------------------------------------------------------
  results.push('\nProformas (E2, E3)')
  const beans = await product('Pois noirs 1 lb', 'PN1', 10, 250)
  await test('cashier creates, edits (with history), prints and cashes a proforma; stock moves only at the sale', async () => {
    const page = await openAs(app, db, users.cashier, '/proformas')
    await page.click('button:has-text("Nouvelle proforma")')
    const editor = page.locator('[role="dialog"]')
    await editor.locator('input[aria-label="Ajouter un produit"]').fill('Pois'); await sleep(1200)
    await editor.locator('ul button:has-text("Pois noirs 1 lb")').click()
    await editor.locator('input[aria-label="Quantité de Pois noirs 1 lb"]').fill('3')
    expect(await editor.locator('input[aria-label="Prix de Pois noirs 1 lb"]').count() === 0, 'a cashier keeps catalogue prices')
    await editor.locator('button[type="submit"]').click()
    await page.waitForSelector('text=Proforma créée.'); await sleep(800)
    await page.locator('main tbody button.font-mono').first().click(); await sleep(800)
    let detail = page.locator('[role="dialog"]')
    expect(/750,00 HTG/.test(await text(detail)) && /version 1/.test(await text(detail)), await text(detail))
    await detail.locator('button:has-text("Ticket 80 mm")').click(); await sleep(600)
    expect(await page.evaluate(() => window.__printed) === 1, 'ticket printed')
    await detail.locator('button:has-text("Modifier")').click(); await sleep(600)
    await editor.locator('input[aria-label="Quantité de Pois noirs 1 lb"]').fill('4')
    await editor.locator('textarea[placeholder="Ex. : ajout d’un produit oublié"]').fill('Le client en veut une de plus')
    await editor.locator('button[type="submit"]').click()
    await page.waitForSelector('text=/modifiée \\(version 2\\)/'); await sleep(800)
    await page.locator('main tbody button.font-mono').first().click(); await sleep(1200)
    detail = page.locator('[role="dialog"]')
    const shown = (await text(detail)).replace(/[\u202f\u00a0]/g, ' ')
    expect(/1 000,00 HTG/.test(shown) && /version 2/.test(shown) && /Le client en veut une de plus/.test(shown), shown)
    expect((await db.query('select stock_quantity::float q from products where id = $1', [beans])).rows[0].q === 10, 'a proforma does not move stock')
    await detail.locator('button:has-text("Encaisser à la caisse")').click()
    await page.waitForURL('**/caisse'); await sleep(1500)
    expect(await page.locator('button[aria-label="Augmenter Pois noirs 1 lb"]').count() === 1, 'proforma lines loaded at the point of sale')
    await page.click('button:has-text("Encaisser")'); await sleep(300)
    const pay = page.locator('[role="dialog"]')
    await pay.locator('label:has-text("Montant reçu") input').fill('1000')
    await pay.locator('button:has-text("Valider la vente")').click()
    await page.waitForSelector('text=/Vente enregistrée/'); await sleep(3000)
    const row = (await db.query(`select pf.status, s.proforma_id = pf.id linked, (select stock_quantity::float from products where id = $1) stock from proformas pf left join sales s on s.id = pf.converted_sale_id order by pf.created_at desc limit 1`, [beans])).rows[0]
    expect(row?.status === 'converted' && row.linked && row.stock === 6, JSON.stringify(row))
    noErrors(page)
    await page.context().close()
  })

  // -------------------------------------------------------------------------
  results.push('\nDaily receipts offline (D)')
  const salt = await product('Sel fin 1 lb', 'SEL1', 5, 100)
  await test('offline, the daily receipts say so and include the sales waiting on this device', async () => {
    const page = await openAs(app, db, users.cashier, '/recettes-journalieres')
    await page.waitForSelector('text=/Données du serveur/', { timeout: 15000 })
    await page.click('aside nav a[href="/caisse"]')
    await page.waitForSelector('input[placeholder="Scanner un code-barres..."]'); await sleep(800)
    await page.fill('input[placeholder="Scanner un code-barres..."]', 'SEL1'); await page.press('input[placeholder="Scanner un code-barres..."]', 'Enter'); await sleep(700)
    page.network.mode = 'offline'
    await page.click('button:has-text("Encaisser")'); await sleep(300)
    await page.locator('[role="dialog"] label:has-text("Montant reçu") input').fill('500')
    await page.locator('[role="dialog"] button:has-text("Valider la vente")').click(); await sleep(2500)
    await page.click('aside nav a[href="/recettes-journalieres"]'); await sleep(2500)
    const banner = await text(page.locator('main [role="status"]:has-text("en attente de synchronisation")'))
    expect(/Hors ligne/.test(banner) && /1 vente\(s\) de cet appareil en attente de synchronisation \(100,00/.test(banner.replace(/ | /g, ' ')), banner)
    page.network.mode = 'ok'
    await page.click('aside button[title="Envoyer et recevoir les dernières données"]'); await sleep(4000)
    expect((await db.query('select stock_quantity::float q from products where id = $1', [salt])).rows[0].q === 4, 'sale synchronised')
    await page.waitForSelector('text=/Données du serveur/', { timeout: 15000 })
    noErrors(page)
    await page.context().close()
  })

  // -------------------------------------------------------------------------
  results.push('\nFinal acceptance: the situations of § 3.4 (G)')
  const scanIn = async (page, code) => { await page.fill('input[placeholder="Scanner un code-barres..."]', code); await page.press('input[placeholder="Scanner un code-barres..."]', 'Enter'); await sleep(700) }
  const payCash = async (page, amount) => {
    await page.click('button:has-text("Encaisser")'); await sleep(300)
    if (amount) await page.locator('[role="dialog"] label:has-text("Montant reçu") input').fill(String(amount))
    await page.locator('[role="dialog"] button:has-text("Valider la vente")').click()
    await page.waitForSelector('text=/Vente enregistrée/')
  }
  const waitFor = async (check, ms = 30000) => { const end = Date.now() + ms; while (Date.now() < end) { if (await check()) return true; await sleep(500) } return false }

  await test('connection lost while a sale is sent (saved by the server, answer lost): sent again, recorded once', async () => {
    const flour = await product('Farine 5 lb', 'FAR5', 5, 300)
    const page = await openAs(app, db, users.cashier, '/caisse')
    // The first send reaches the server, which records the sale, then the line drops before the answer.
    const server = fakeSupabase({ db, userId: users.cashier.userId, profile: { id: users.cashier.userId, full_name: users.cashier.name, email: 'cashier@shop.ht', active: true, role_id: null, role: { code: 'cashier', name: 'CASHIER' } } })
    let cut = 0
    await page.context().route('**/rest/v1/rpc/complete_offline_sale', async (route) => {
      if (cut > 0) return route.fallback()
      cut += 1
      await server({ request: () => route.request(), fulfill: async () => {} })
      await route.abort('connectionreset')
    })
    await page.waitForSelector('input[placeholder="Scanner un code-barres..."]')
    await scanIn(page, 'FAR5'); await scanIn(page, 'FAR5')
    await payCash(page)
    // The device does not know the sale arrived: it sends it again (same sale number), the server keeps one.
    await sleep(2000)
    await page.click('aside button[title="Envoyer et recevoir les dernières données"]'); await sleep(3000)
    const synced = await waitFor(async () => (await page.evaluate(() => document.querySelector('aside')?.innerText ?? '')).includes('Synchro'))
    const sales = (await db.query(`select count(*)::int n, (select stock_quantity::float from products where id = $1) stock from sales s join sale_items i on i.sale_id = s.id where i.product_id = $1`, [flour])).rows[0]
    expect(cut === 1, 'the connection was cut during the send')
    expect(synced && sales.n === 1 && sales.stock === 3, `one sale, stock 5 − 2 = 3: ${JSON.stringify(sales)}`)
    await page.click('aside button[aria-label="Détails de la synchronisation"]'); await sleep(500)
    expect(await page.locator('aside li:has-text("Vente du")').count() === 0, 'nothing left pending on the device')
    noErrors(page)
    await page.context().close()
  })

  await test('two cashiers sell the last unit at the same moment: one sale, the other refused with the reason, never negative stock', async () => {
    const gas = await product('Gaz propane 25 lb', 'GAZ25', 1, 2500)
    await as('cashier2', 'select public.open_cash_session(0, null)')
    const [rose, lina] = [await openAs(app, db, users.cashier, '/caisse'), await openAs(app, db, users.cashier2, '/caisse')]
    for (const page of [rose, lina]) { await page.waitForSelector('input[placeholder="Scanner un code-barres..."]'); await scanIn(page, 'GAZ25') }
    // Both validate at the same moment; the server takes one sale, the other till shows why before any receipt.
    for (const page of [rose, lina]) { await page.click('button:has-text("Encaisser")'); await sleep(300); await page.locator('[role="dialog"] label:has-text("Montant reçu") input').fill('2500') }
    await Promise.all([rose, lina].map((page) => page.locator('[role="dialog"] button:has-text("Valider la vente")').click()))
    await sleep(8000)
    const row = (await db.query(`select (select count(*)::int from sale_items where product_id = $1) sold, stock_quantity::float stock from products where id = $1`, [gas])).rows[0]
    expect(row.sold === 1 && row.stock === 0, JSON.stringify(row))
    const outcomes = []
    for (const page of [rose, lina]) outcomes.push(await text(page.locator('body')))
    const won = outcomes.filter((screen) => /Vente enregistrée\./.test(screen)).length
    const lost = outcomes.filter((screen) => /Stock insuffisant pour Gaz propane 25 lb/.test(screen)).length
    expect(won === 1 && lost === 1, `one recorded, one refused with the reason: ${outcomes.map((screen) => screen.slice(0, 160)).join(' || ')}`)
    for (const page of [rose, lina]) {
      if (await page.locator('[role="dialog"] button:has-text("Retour au panier")').count()) await page.click('[role="dialog"] button:has-text("Retour au panier")')
      await page.click('aside button[aria-label="Détails de la synchronisation"]'); await sleep(500)
      expect(await page.locator('aside li:has-text("Vente du")').count() === 0, 'the refused sale is not left waiting on the device')
    }
    noErrors(rose); noErrors(lina)
    await rose.context().close(); await lina.context().close()
  })

  await test('several operations made offline (new customer, two sales, one for that customer) are all sent when the connection returns', async () => {
    const milk = await product('Lait Carnation', 'LC1', 6, 175)
    const page = await openAs(app, db, users.cashier, '/caisse')
    await page.waitForSelector('input[placeholder="Scanner un code-barres..."]')
    await page.click('aside button[title="Envoyer et recevoir les dernières données"]'); await sleep(2500)
    page.network.mode = 'offline'
    await page.click('button:has-text("Nouveau client")')
    const dialog = page.locator('[role="dialog"]')
    await dialog.locator('label:has-text("Nom complet") input').fill('Claudette Hors Ligne')
    await dialog.locator('button:has-text("Enregistrer")').click(); await sleep(900)
    await scanIn(page, 'LC1'); await scanIn(page, 'LC1')
    await payCash(page, 350); await sleep(1500)
    await scanIn(page, 'LC1')
    await payCash(page, 175); await sleep(1500)
    expect((await db.query('select stock_quantity::float q from products where id = $1', [milk])).rows[0].q === 6, 'nothing reached the server while offline')
    page.network.mode = 'ok'
    await page.click('aside button[title="Envoyer et recevoir les dernières données"]')
    await page.waitForSelector('text=/envoyée/', { timeout: 20000 }); await sleep(1500)
    const rows = (await db.query(`select c.full_name, sum(i.quantity)::float qty from sales s join sale_items i on i.sale_id = s.id left join customers c on c.id = s.customer_id where i.product_id = $1 group by c.full_name order by 1`, [milk])).rows
    const stock = (await db.query('select stock_quantity::float q from products where id = $1', [milk])).rows[0].q
    const customers = (await db.query(`select count(*)::int n from customers where full_name = 'Claudette Hors Ligne'`)).rows[0].n
    expect(customers === 1 && stock === 3 && rows.reduce((total, row) => total + row.qty, 0) === 3 && rows.some((row) => row.full_name === 'Claudette Hors Ligne'), JSON.stringify({ customers, stock, rows }))
    noErrors(page)
    await page.context().close()
  })

  for (const role of ['director', 'cashier', 'accountant', 'stock_manager', 'admin']) {
    await test(`${users[role].name} (${role}): every reserved page opens or is refused exactly as the permissions say`, async () => {
      const allowed = defaultPermissions(users[role].role)
      const page = await openAs(app, db, users[role], '/')
      await page.waitForSelector('aside nav a'); await sleep(800)
      const wrong = []
      for (const path of Object.keys(PAGE_ACCESS)) {
        await page.goto(`${app.base}${path}`); await page.waitForSelector('aside nav a'); await sleep(500)
        const opened = new URL(page.url()).pathname === path
        if (opened !== canOpen(path, allowed)) wrong.push(`${path} ${opened ? 'opened' : 'refused'}`)
      }
      expect(wrong.length === 0, wrong.join(', '))
      noErrors(page)
      await page.context().close()
    })
  }

  await test('80 mm tickets: nothing wider than the 72 mm printable width (sale receipt, proforma); PDF samples saved', async () => {
    await db.query(`insert into settings (key, value) values ('company.address', '"Route de Delmas 33, Port-au-Prince"'), ('company.phone', '"+509 2222 3333"'), ('company.tax_id', '"000-111-222-3"'), ('company.receipt_footer', '"Mèsi, n ap tann ou ankò !"') on conflict (key) do update set value = excluded.value`)
    const out = `${ROOT}docs/recette`
    mkdirSync(out, { recursive: true })
    // The app's own printing (printSection) is used; the print dialog is held open while the page is measured and saved as PDF.
    const check = async (page, trigger, file) => {
      await page.evaluate(() => { window.__held = 0; window.print = () => { window.__held += 1 } })
      await trigger(); await page.waitForFunction(() => window.__held > 0, null, { timeout: 15000 })
      await page.emulateMedia({ media: 'print' })
      const size = await page.evaluate(() => {
        const ticket = [...document.querySelectorAll('section.ticket')].find((element) => !element.closest('.print-hidden'))
        const box = ticket.getBoundingClientRect()
        const overflow = [...ticket.querySelectorAll('*')].filter((element) => element.getBoundingClientRect().right > box.right + 0.5).map((element) => element.textContent.slice(0, 30))
        const others = [...document.body.querySelectorAll('section, main > *')].filter((element) => !ticket.contains(element) && !element.contains(ticket) && element.getBoundingClientRect().height > 0).map((element) => `${element.tagName}.${element.className}`.slice(0, 80))
        return { width: box.width, scroll: ticket.scrollWidth, overflow, others, text: ticket.innerText }
      })
      await page.pdf({ path: `${out}/${file}`, preferCSSPageSize: true, printBackground: true })
      await page.emulateMedia({ media: 'screen' })
      await page.evaluate(() => window.dispatchEvent(new Event('afterprint')))
      return size
    }
    const mmToPx = 96 / 25.4
    const page = await openAs(app, db, users.cashier, '/caisse')
    await page.waitForSelector('input[placeholder="Scanner un code-barres..."]')
    await scanIn(page, 'LC1'); await scanIn(page, 'PN1')
    const receipt = await check(page, () => payCash(page, 500), 'ticket-vente-80mm.pdf')
    expect(receipt.width <= 72 * mmToPx + 1 && receipt.scroll <= Math.ceil(receipt.width) + 1 && receipt.overflow.length === 0 && receipt.others.length === 0, JSON.stringify({ ...receipt, text: undefined }))
    const number = (await db.query(`select s.sale_number from sales s join sale_items i on i.sale_id = s.id join products p on p.id = i.product_id where p.barcode = 'PN1' order by s.created_at desc limit 1`)).rows[0]?.sale_number
    expect(number && receipt.text.includes(number) && !/LOCAL-/.test(receipt.text), `receipt shows the server number ${number}: ${receipt.text.slice(0, 200)}`)
    expect((receipt.text.match(/Merci pour votre visite/g) ?? []).length === 0, 'the message of Paramètres replaces the default thanks')
    expect(['Route de Delmas 33', 'NIF : 000-111-222-3', 'Lait Carnation', 'Pois noirs 1 lb', 'Mèsi, n ap tann ou ankò'].every((part) => receipt.text.includes(part)) && /Espèces|espèces/.test(receipt.text), receipt.text)
    await page.goto(`${app.base}/proformas`)
    await page.waitForSelector('main tbody button.font-mono')
    await page.locator('main tbody button.font-mono').first().click(); await sleep(1000)
    const proforma = await check(page, () => page.click('[role="dialog"] button:has-text("Ticket 80 mm")'), 'ticket-proforma-80mm.pdf')
    expect(proforma.width <= 72 * mmToPx + 1 && proforma.overflow.length === 0 && proforma.others.length === 0 && /PROFORMA|Proforma/.test(proforma.text), JSON.stringify({ ...proforma, text: undefined }))
    noErrors(page)
    await page.context().close()
  })
} finally {
  await app.stop()
}

console.log(results.join('\n'))
if (failures) { console.log(`\n${failures} browser test(s) failed`); process.exit(1) }
console.log('\nAll browser tests passed')
