#!/usr/bin/env node
// Test version of Makèt Peyizan: its own Supabase project and the Cloudflare
// Pages "test" branch (https://test.maket-peyizan.pages.dev). Settings live in
// .env.test.local (never committed); see docs/TEST_VERSION.md.
//
//   node scripts/test-version.mjs check    show both projects, refuse if they are the same
//   node scripts/test-version.mjs db       apply the migrations to the TEST database
//   node scripts/test-version.mjs seed     add demo products, suppliers and customers (signs in as you)
//   node scripts/test-version.mjs deploy   build in test mode and publish to the test branch
//
// Every command first checks that the test project is not the production one.
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { createInterface } from 'node:readline'

const root = new URL('..', import.meta.url)
const command = process.argv[2]

function readEnv(name) {
  const file = new URL(name, root)
  if (!existsSync(file)) return null
  const values = {}
  for (const line of readFileSync(file, 'utf8').split('\n')) {
    const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/)
    if (match) values[match[1]] = match[2].replace(/^["']|["']$/g, '')
  }
  return values
}
const refOf = (url) => { try { return new URL(url).hostname.split('.')[0] } catch { return null } }
const dbRefOf = (url) => url?.match(/postgres\.([a-z0-9]{20})[:@]/)?.[1] ?? url?.match(/db\.([a-z0-9]{20})\.supabase\.co/)?.[1] ?? null
const fail = (message) => { console.error(`✗ ${message}`); process.exit(1) }

function settings() {
  const test = readEnv('.env.test.local')
  if (!test) fail('.env.test.local is missing: copy .env.test.example to .env.test.local and fill it in (docs/TEST_VERSION.md).')
  const production = readEnv('.env.production.local')
  const testRef = refOf(test.VITE_SUPABASE_URL)
  const productionRef = production && refOf(production.VITE_SUPABASE_URL)
  if (!testRef || !test.VITE_SUPABASE_PUBLISHABLE_KEY) fail('VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY are required in .env.test.local.')
  if (test.VITE_USE_LOCAL_DB === 'true') fail('VITE_USE_LOCAL_DB must be false in .env.test.local.')
  if (testRef === productionRef) fail(`.env.test.local points to the PRODUCTION project (${testRef}). Use the separate test project.`)
  return { test, testRef, productionRef }
}

const run = (program, args, options = {}) => execFileSync(program, args, { stdio: 'inherit', cwd: root, ...options })

const rl = () => createInterface({ input: process.stdin, output: process.stdout, terminal: true })
const ask = (reader, question) => new Promise((resolve) => reader.question(question, (answer) => resolve(answer.trim())))
const askHidden = (reader, question) => new Promise((resolve) => {
  process.stdout.write(question)
  const original = reader._writeToOutput
  reader._writeToOutput = () => {}
  reader.question('', (answer) => { reader._writeToOutput = original; process.stdout.write('\n'); resolve(answer) })
})

// ---------------------------------------------------------------------------
async function seed({ test }) {
  const { createClient } = await import('@supabase/supabase-js')
  const client = createClient(test.VITE_SUPABASE_URL, test.VITE_SUPABASE_PUBLISHABLE_KEY, { auth: { persistSession: false } })
  const reader = rl()
  const email = await ask(reader, 'E-mail of a director or administrator of the TEST project: ')
  const password = await askHidden(reader, 'Password (not shown): ')
  reader.close()
  const { error: signInError } = await client.auth.signInWithPassword({ email, password })
  if (signInError) fail(`Sign-in refused: ${signInError.message}`)

  const must = async (label, promise) => { const { data, error } = await promise; if (error) fail(`${label}: ${error.message}`); return data }
  const findOrCreate = async (table, name, values = {}) => {
    const [existing] = await must(table, client.from(table).select('id').ilike('name', name).limit(1))
    return existing?.id ?? (await must(table, client.from(table).insert({ name, ...values }).select('id').single())).id
  }
  const supplierCategory = async (name) => (await must('supplier_categories', client.from('supplier_categories').select('id').eq('name', name).single())).id

  const categories = Object.fromEntries(await Promise.all(['Épicerie', 'Boissons', 'Produits locaux', 'Hygiène'].map(async (name) => [name, await findOrCreate('categories', name)])))
  const suppliers = {
    coop: await findOrCreate('suppliers', 'Coopérative Kenscoff (test)', { category_id: await supplierCategory('Producteurs locaux'), phone: '+509 3700 0000' }),
    nord: await findOrCreate('suppliers', 'Distribution Nord (test)', { category_id: await supplierCategory('Grossistes'), phone: '+509 2810 0000' }),
    import: await findOrCreate('suppliers', 'Import Caraïbes (test)', { category_id: await supplierCategory('Importateurs') }),
  }
  const products = [
    ['Riz Bongu 5 lb', 'TEST-001', 'Épicerie', 'nord', 'sac', 300, 450, 40],
    ['Riz local Artibonite', 'TEST-002', 'Produits locaux', 'coop', 'marmite', 180, 250, 60],
    ['Pois noirs', 'TEST-003', 'Produits locaux', 'coop', 'marmite', 220, 300, 50],
    ['Huile Mazola 1 L', 'TEST-004', 'Épicerie', 'import', 'bouteille', 420, 600, 24],
    ['Sucre brun', 'TEST-005', 'Épicerie', 'nord', 'lb', 55, 80, 100],
    ['Café Rebo 1 lb', 'TEST-006', 'Produits locaux', 'coop', 'paquet', 350, 500, 30],
    ['Eau Culligan 5 gallons', 'TEST-007', 'Boissons', 'nord', 'gallon', 90, 150, 20],
    ['Jus Tampico', 'TEST-008', 'Boissons', 'import', 'bouteille', 60, 100, 48],
    ['Savon Lave-Tout', 'TEST-009', 'Hygiène', 'nord', 'pièce', 35, 60, 80],
    ['Spaghetti Gran Mèt', 'TEST-010', 'Épicerie', 'import', 'paquet', 45, 75, 0],
  ]
  let created = 0
  for (const [name, barcode, category, supplier, unit, cost, price, stock] of products) {
    const [existing] = await must('products', client.from('products').select('id').eq('barcode', barcode).limit(1))
    if (existing) continue
    const product = await must(name, client.from('products').insert({ name, barcode, unit, category_id: categories[category], supplier_id: suppliers[supplier], purchase_price: cost, selling_price: price, proforma_price: price, minimum_stock: 5 }).select('id').single())
    if (stock > 0) await must(`${name} (stock)`, client.rpc('record_stock_movement', { p_product_id: product.id, p_movement_type: 'entry', p_quantity: stock, p_reason: 'Stock de démonstration', p_supplier_id: suppliers[supplier], p_purchase_price: cost, p_reference_type: null, p_reference_id: null, p_movement_at: new Date().toISOString() }))
    created += 1
  }
  for (const [full_name, phone] of [['Client de passage (test)', null], ['Marie Joseph (test)', '+509 3456 7890'], ['Restaurant Lakou (test)', '+509 2222 3333']]) {
    const [existing] = await must('customers', client.from('customers').select('id').eq('full_name', full_name).limit(1))
    if (!existing) await must(full_name, client.from('customers').insert({ full_name, phone, customer_type: full_name.startsWith('Restaurant') ? 'business' : 'individual' }))
  }
  console.log(`✓ Demo data ready: ${created} new product(s), 3 suppliers, 4 categories, 3 customers. "Spaghetti" is out of stock on purpose.`)
}

// ---------------------------------------------------------------------------
const config = settings()
console.log(`Test project:       ${config.testRef}`)
console.log(`Production project: ${config.productionRef ?? '(no .env.production.local)'}`)

if (command === 'check') {
  console.log('✓ The test version uses its own project.')
} else if (command === 'db') {
  const url = config.test.SUPABASE_TEST_DB_URL
  if (!url) fail('SUPABASE_TEST_DB_URL is missing from .env.test.local (Supabase > Connect > Session pooler).')
  if (dbRefOf(url) !== config.testRef) fail(`SUPABASE_TEST_DB_URL belongs to project ${dbRefOf(url) ?? '?'}, not to the test project ${config.testRef}.`)
  run('npx', ['supabase', 'db', 'push', '--db-url', url])
} else if (command === 'seed') {
  await seed(config)
} else if (command === 'deploy') {
  run('npm', ['run', 'build', '--', '--mode', 'test'])
  run('npx', ['wrangler', 'pages', 'deploy', 'dist', '--project-name', config.test.CLOUDFLARE_PROJECT || 'maket-peyizan', '--branch', 'test'])
  console.log('✓ Test version published on the "test" branch. Rebuild before the next production deploy (dist/ now holds the test build).')
} else {
  console.log('Usage: node scripts/test-version.mjs check | db | seed | deploy')
  process.exit(command ? 1 : 0)
}
