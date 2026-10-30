import type { Importer, ImportRow } from '../components/ImportDialog'
import { normalizeHeader } from '../lib/spreadsheet'
import { getSnapshot, refreshSnapshots, type SnapshotName } from '../lib/offline/snapshot'
import { isOnline } from '../lib/offline/status'
import type { Category, Customer, Product } from '../types/catalog'
import type { Supplier } from '../types/stock'
import { categoryService } from './categoryService'
import { customerService } from './customerService'
import { expenseService } from './expenseService'
import { productService } from './productService'
import { stockService } from './stockService'
import { supplierService } from './supplierService'

// Rows are written through the regular services, so imports also work offline
// (queued) and follow the same validation as the forms.

const key = (value: unknown) => normalizeHeader(String(value ?? ''))
const digits = (value: unknown) => String(value ?? '').replace(/\D/g, '')
const text = (row: ImportRow, field: string) => (row[field] === null || row[field] === undefined ? null : String(row[field]))
const num = (row: ImportRow, field: string) => (typeof row[field] === 'number' ? (row[field] as number) : null)

function ensure<T>(result: { data?: unknown; error?: unknown } | null | undefined): T {
  if (result?.error) throw result.error instanceof Error ? result.error : new Error(String((result.error as { message?: unknown }).message ?? 'Enregistrement refusé'))
  return result?.data as T
}

/** Latest reference data: refreshed from the server when online, local copy otherwise. */
let refreshed: Promise<void> | null = null
async function reference<T>(name: SnapshotName): Promise<T[]> {
  if (isOnline()) { refreshed ??= refreshSnapshots().finally(() => { refreshed = null }); await refreshed }
  return (await getSnapshot<T>(name)) ?? []
}

/** Marks `id` as used in this file; returns true when it already was. */
const seenBefore = (seen: Set<string>, id: string) => { if (seen.has(id)) return true; seen.add(id); return false }

type ProductCtx = { categories: Map<string, string>; suppliers: Map<string, string>; barcodes: Set<string>; names: Set<string> }

export const productImporter: Importer<ProductCtx> = {
  title: 'Importer des produits',
  entity: 'produits',
  templateName: 'modele-import-produits.xlsx',
  fields: [
    { key: 'name', label: 'Nom', required: true, aliases: ['produit', 'nom du produit', 'designation', 'article', 'libelle', 'product', 'name', 'pwodwi'], example: 'Riz Tchako 5 lb' },
    { key: 'barcode', label: 'Code-barres', aliases: ['code barre', 'code barres', 'barcode', 'code', 'reference', 'ref', 'sku', 'ean'], example: '7460001234567' },
    { key: 'brand', label: 'Marque', aliases: ['brand', 'fabricant', 'mak'], example: 'Tchako' },
    { key: 'category', label: 'Catégorie', aliases: ['category', 'famille', 'rayon', 'kategori'], example: 'Épicerie' },
    { key: 'supplier', label: 'Fournisseur', aliases: ['supplier', 'vendor', 'founise'], example: 'Distribution Nord' },
    { key: 'purchase_price', label: 'Prix d’achat', type: 'number', aliases: ['prix achat', 'cout', 'cout unitaire', 'prix de revient', 'purchase price', 'cost', 'pri acha'], example: 300 },
    { key: 'selling_price', label: 'Prix de vente', required: true, type: 'number', aliases: ['prix', 'prix vente', 'prix unitaire', 'selling price', 'price', 'pri vann'], example: 450 },
    { key: 'proforma_price', label: 'Prix proforma', type: 'number', aliases: ['proforma', 'prix devis'], example: 440 },
    { key: 'stock_quantity', label: 'Stock initial', type: 'number', aliases: ['stock', 'quantite', 'qte', 'qty', 'quantity', 'kantite'], example: 25 },
    { key: 'minimum_stock', label: 'Stock minimum', type: 'number', aliases: ['seuil', 'minimum', 'stock min', 'seuil alerte', 'min stock', 'reorder level'], example: 5 },
    { key: 'unit', label: 'Unité', aliases: ['unit', 'uom', 'unite de mesure', 'inite'], example: 'sac' },
    { key: 'expiration_date', label: 'Date d’expiration', type: 'date', aliases: ['expiration', 'peremption', 'date peremption', 'expiry', 'expiry date'], example: '2027-06-30' },
    { key: 'description', label: 'Description', aliases: ['details', 'detail', 'notes'], example: '' },
  ],
  prepare: async () => {
    const [products, categories, suppliers] = await Promise.all([reference<Product>('products'), reference<Category>('categories'), reference<Supplier>('suppliers')])
    return {
      categories: new Map(categories.map((category) => [key(category.name), category.id])),
      suppliers: new Map(suppliers.map((supplier) => [key(supplier.name), supplier.id])),
      barcodes: new Set(products.map((product) => product.barcode?.trim()).filter((code): code is string => Boolean(code))),
      names: new Set(products.map((product) => key(product.name))),
    }
  },
  check: (row, ctx, seen) => {
    const barcode = text(row, 'barcode')
    if (barcode && (ctx.barcodes.has(barcode) || seenBefore(seen, `barcode:${barcode}`))) return `Code-barres ${barcode} déjà utilisé`
    if (!barcode && (ctx.names.has(key(row.name)) || seenBefore(seen, `name:${key(row.name)}`))) return 'Produit déjà existant'
    return null
  },
  save: async (row, ctx) => {
    const categoryName = text(row, 'category')
    let categoryId = categoryName ? ctx.categories.get(key(categoryName)) ?? null : null
    if (categoryName && !categoryId) {
      categoryId = ensure<Category>(await categoryService.createCategory({ name: categoryName, description: null })).id
      ctx.categories.set(key(categoryName), categoryId)
    }
    const supplierName = text(row, 'supplier')
    let supplierId = supplierName ? ctx.suppliers.get(key(supplierName)) ?? null : null
    if (supplierName && !supplierId) {
      supplierId = ensure<Supplier>(await supplierService.createSupplier({ name: supplierName, company_name: null, phone: null, email: null, address: null, tax_id: null, notes: null })).id
      ctx.suppliers.set(key(supplierName), supplierId)
    }
    const sellingPrice = num(row, 'selling_price') ?? 0
    const purchasePrice = num(row, 'purchase_price') ?? 0
    const product = ensure<Product>(await productService.createProduct({
      name: text(row, 'name')!, barcode: text(row, 'barcode'), brand: text(row, 'brand'), description: text(row, 'description'),
      category_id: categoryId, supplier_id: supplierId,
      purchase_price: purchasePrice, selling_price: sellingPrice, proforma_price: num(row, 'proforma_price') ?? sellingPrice,
      stock_quantity: 0, minimum_stock: num(row, 'minimum_stock') ?? 0, unit: text(row, 'unit') ?? 'unité',
      expiration_date: text(row, 'expiration_date'), active: true,
    }))
    if (text(row, 'barcode')) ctx.barcodes.add(text(row, 'barcode')!)
    ctx.names.add(key(row.name))
    // Initial stock goes through a stock movement, exactly like the product form.
    const initialStock = num(row, 'stock_quantity') ?? 0
    if (initialStock > 0) ensure(await stockService.createMovement({ product_id: product.id, movement_type: 'entry', quantity: initialStock, reason: 'Stock initial (import)', purchase_price: purchasePrice }))
  },
}

type CustomerCtx = { phones: Set<string>; emails: Set<string> }

export const customerImporter: Importer<CustomerCtx> = {
  title: 'Importer des clients',
  entity: 'clients',
  templateName: 'modele-import-clients.xlsx',
  fields: [
    { key: 'full_name', label: 'Nom complet', required: true, aliases: ['nom', 'client', 'nom du client', 'name', 'full name', 'non'], example: 'Marie Joseph' },
    { key: 'phone', label: 'Téléphone', aliases: ['tel', 'telephone', 'phone', 'mobile', 'cellulaire', 'whatsapp', 'telefon'], example: '+509 3712 3456' },
    { key: 'email', label: 'E-mail', type: 'email', aliases: ['email', 'courriel', 'mail', 'adresse email'], example: 'marie@example.com' },
    { key: 'company_name', label: 'Entreprise', aliases: ['societe', 'company', 'raison sociale', 'antrepriz'], example: '' },
    { key: 'tax_id', label: 'NIF', aliases: ['nif', 'tax id', 'numero fiscal', 'matricule fiscal'], example: '' },
    { key: 'address', label: 'Adresse', aliases: ['address', 'adres', 'ville'], example: 'Delmas 33, Port-au-Prince' },
    { key: 'customer_type', label: 'Type', type: 'choice', aliases: ['type de client', 'customer type', 'kategori kliyan'], example: 'Particulier',
      choices: { particulier: 'individual', individuel: 'individual', individual: 'individual', personne: 'individual', moun: 'individual', entreprise: 'business', societe: 'business', business: 'business', company: 'business', biznis: 'business', antrepriz: 'business' } },
    { key: 'notes', label: 'Notes', aliases: ['remarques', 'commentaire', 'note'], example: '' },
  ],
  prepare: async () => {
    const customers = await reference<Customer>('customers')
    return { phones: new Set(customers.map((customer) => digits(customer.phone)).filter((phone) => phone.length >= 6)), emails: new Set(customers.map((customer) => key(customer.email)).filter(Boolean)) }
  },
  check: (row, ctx, seen) => {
    const phone = digits(row.phone)
    if (phone.length >= 6 && (ctx.phones.has(phone) || seenBefore(seen, `phone:${phone}`))) return 'Téléphone déjà enregistré'
    const email = key(row.email)
    if (email && (ctx.emails.has(email) || seenBefore(seen, `email:${email}`))) return 'E-mail déjà enregistré'
    return null
  },
  save: async (row, ctx) => {
    ensure(await customerService.createCustomer({
      full_name: text(row, 'full_name')!, phone: text(row, 'phone'), email: text(row, 'email'), company_name: text(row, 'company_name'),
      tax_id: text(row, 'tax_id'), address: text(row, 'address'), notes: text(row, 'notes'),
      customer_type: (text(row, 'customer_type') as Customer['customer_type'] | null) ?? (text(row, 'company_name') ? 'business' : 'individual'),
    }))
    if (digits(row.phone)) ctx.phones.add(digits(row.phone))
    if (key(row.email)) ctx.emails.add(key(row.email))
  },
}

type NameCtx = { names: Set<string> }

export const supplierImporter: Importer<NameCtx> = {
  title: 'Importer des fournisseurs',
  entity: 'fournisseurs',
  templateName: 'modele-import-fournisseurs.xlsx',
  fields: [
    { key: 'name', label: 'Nom', required: true, aliases: ['fournisseur', 'supplier', 'name', 'nom du fournisseur', 'founise'], example: 'Distribution Nord' },
    { key: 'company_name', label: 'Entreprise', aliases: ['societe', 'company', 'raison sociale'], example: 'Distribution Nord SA' },
    { key: 'phone', label: 'Téléphone', aliases: ['tel', 'telephone', 'phone', 'mobile', 'telefon'], example: '+509 2810 0000' },
    { key: 'email', label: 'E-mail', type: 'email', aliases: ['email', 'courriel', 'mail'], example: 'contact@example.com' },
    { key: 'address', label: 'Adresse', aliases: ['address', 'adres', 'ville'], example: 'Cap-Haïtien' },
    { key: 'tax_id', label: 'NIF', aliases: ['nif', 'tax id', 'numero fiscal'], example: '' },
    { key: 'notes', label: 'Notes', aliases: ['remarques', 'commentaire', 'note'], example: '' },
  ],
  prepare: async () => ({ names: new Set((await reference<Supplier>('suppliers')).map((supplier) => key(supplier.name))) }),
  check: (row, ctx, seen) => ctx.names.has(key(row.name)) || seenBefore(seen, key(row.name)) ? 'Fournisseur déjà existant' : null,
  save: async (row, ctx) => {
    ensure(await supplierService.createSupplier({ name: text(row, 'name')!, company_name: text(row, 'company_name'), phone: text(row, 'phone'), email: text(row, 'email'), address: text(row, 'address'), tax_id: text(row, 'tax_id'), notes: text(row, 'notes') }))
    ctx.names.add(key(row.name))
  },
}

export const categoryImporter: Importer<NameCtx> = {
  title: 'Importer des catégories',
  entity: 'catégories',
  templateName: 'modele-import-categories.xlsx',
  fields: [
    { key: 'name', label: 'Nom', required: true, aliases: ['categorie', 'category', 'famille', 'rayon', 'name', 'kategori'], example: 'Épicerie' },
    { key: 'description', label: 'Description', aliases: ['details', 'notes'], example: 'Produits alimentaires secs' },
  ],
  prepare: async () => ({ names: new Set((await reference<Category>('categories')).map((category) => key(category.name))) }),
  check: (row, ctx, seen) => ctx.names.has(key(row.name)) || seenBefore(seen, key(row.name)) ? 'Catégorie déjà existante' : null,
  save: async (row, ctx) => {
    ensure(await categoryService.createCategory({ name: text(row, 'name')!, description: text(row, 'description') }))
    ctx.names.add(key(row.name))
  },
}

export const expenseImporter: Importer<null> = {
  title: 'Importer des dépenses',
  entity: 'dépenses',
  templateName: 'modele-import-depenses.xlsx',
  fields: [
    { key: 'label', label: 'Libellé', required: true, aliases: ['description', 'depense', 'motif', 'objet', 'label', 'depans'], example: 'Électricité EDH' },
    { key: 'amount', label: 'Montant', required: true, type: 'number', aliases: ['amount', 'total', 'valeur', 'montant htg', 'kob'], example: 2500 },
    { key: 'expense_date', label: 'Date', type: 'date', aliases: ['date de la depense', 'expense date', 'dat'], example: '2026-10-15' },
    { key: 'notes', label: 'Notes', aliases: ['remarques', 'commentaire', 'note'], example: '' },
  ],
  prepare: async () => null,
  check: (row) => num(row, 'amount') === 0 ? 'Montant nul' : null,
  save: async (row) => {
    ensure(await expenseService.createExpense({ label: text(row, 'label')!, amount: num(row, 'amount')!, expense_date: text(row, 'expense_date') ?? undefined, notes: text(row, 'notes') ?? undefined }))
  },
}
