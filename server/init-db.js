import initSqlJs from 'sql.js';
import bcrypt from 'bcrypt';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Keeping this configurable makes it possible to validate a fresh installation
// without touching the database used by the local application.
const dbPath = process.env.LOCAL_DB_PATH || path.join(__dirname, 'maket-peyizan.db');
const SQL = await initSqlJs();

let db;

// Load existing database or create new
if (fs.existsSync(dbPath)) {
  const dbBuffer = fs.readFileSync(dbPath);
  db = new SQL.Database(dbBuffer);
} else {
  db = new SQL.Database();
}

console.log('Creating SQLite database at:', dbPath);

// Enable foreign keys
db.run('PRAGMA foreign_keys = ON');

// ============================================
// LOCAL USERS
// ============================================
db.exec(`
  CREATE TABLE IF NOT EXISTS local_users (
    id TEXT PRIMARY KEY,
    email TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    full_name TEXT NOT NULL,
    is_active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  )
`);

// ============================================
// ROLES
// ============================================
db.exec(`
  CREATE TABLE IF NOT EXISTS roles (
    id TEXT PRIMARY KEY,
    code TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL UNIQUE,
    description TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  )
`);

// Insert roles
const roles = [
  { id: crypto.randomUUID(), code: 'administrator', name: 'ADMINISTRATEUR', description: 'Administration du systeme et configuration' },
  { id: crypto.randomUUID(), code: 'director', name: 'DIRECTEUR', description: 'Accès complet et supervision de toutes les opérations' },
  { id: crypto.randomUUID(), code: 'accountant', name: 'COMPTABLE', description: 'Comptabilité, finance, rapports et écritures' },
  { id: crypto.randomUUID(), code: 'cashier', name: 'CAISSIÈRE', description: 'Caisse, clients, produits, proformas et ses ventes' },
  { id: crypto.randomUUID(), code: 'stock_manager', name: 'GESTIONNAIRE STOCK', description: 'Gestion complète du stock et des inventaires' },
];

for (const role of roles) {
  db.run('INSERT OR IGNORE INTO roles (id, code, name, description) VALUES (?, ?, ?, ?)', [role.id, role.code, role.name, role.description]);
}

// ============================================
// PROFILES
// ============================================
db.exec(`
  CREATE TABLE IF NOT EXISTS profiles (
    id TEXT PRIMARY KEY,
    full_name TEXT NOT NULL DEFAULT '',
    email TEXT NOT NULL UNIQUE,
    role_id TEXT NOT NULL,
    active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (id) REFERENCES local_users(id) ON DELETE CASCADE,
    FOREIGN KEY (role_id) REFERENCES roles(id) ON DELETE RESTRICT
  )
`);

// ============================================
// CATEGORIES
// ============================================
db.exec(`
  CREATE TABLE IF NOT EXISTS categories (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL UNIQUE,
    description TEXT,
    active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  )
`);

// ============================================
// SUPPLIERS
// ============================================
db.exec(`
  CREATE TABLE IF NOT EXISTS suppliers (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL UNIQUE,
    email TEXT,
    phone TEXT,
    address TEXT,
    company_name TEXT,
    tax_id TEXT,
    notes TEXT,
    active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  )
`);

// ============================================
// CUSTOMERS
// ============================================
db.exec(`
  CREATE TABLE IF NOT EXISTS customers (
    id TEXT PRIMARY KEY,
    customer_number TEXT NOT NULL UNIQUE,
    full_name TEXT NOT NULL,
    email TEXT,
    phone TEXT,
    address TEXT,
    company_name TEXT,
    tax_id TEXT,
    customer_type TEXT NOT NULL DEFAULT 'individual',
    notes TEXT,
    active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  )
`);

// ============================================
// PRODUCTS
// ============================================
db.exec(`
  CREATE TABLE IF NOT EXISTS products (
    id TEXT PRIMARY KEY,
    category_id TEXT,
    supplier_id TEXT,
    name TEXT NOT NULL,
    description TEXT,
    barcode TEXT UNIQUE,
    purchase_price REAL NOT NULL DEFAULT 0,
    selling_price REAL NOT NULL,
    proforma_price REAL NOT NULL DEFAULT 0,
    stock_quantity REAL NOT NULL DEFAULT 0,
    minimum_stock REAL NOT NULL DEFAULT 0,
    average_cost REAL NOT NULL DEFAULT 0,
    brand TEXT,
    unit TEXT NOT NULL DEFAULT 'unité',
    image_url TEXT,
    expiration_date TEXT,
    active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (category_id) REFERENCES categories(id) ON DELETE SET NULL,
    FOREIGN KEY (supplier_id) REFERENCES suppliers(id) ON DELETE SET NULL
  )
`);

// ============================================
// PROFORMAS
// ============================================
db.exec(`
  CREATE TABLE IF NOT EXISTS proformas (
    id TEXT PRIMARY KEY,
    proforma_number TEXT NOT NULL UNIQUE,
    customer_id TEXT,
    status TEXT NOT NULL DEFAULT 'draft',
    issue_date TEXT NOT NULL DEFAULT (date('now')),
    valid_until TEXT,
    notes TEXT,
    subtotal REAL NOT NULL DEFAULT 0,
    discount_amount REAL NOT NULL DEFAULT 0,
    tax_amount REAL NOT NULL DEFAULT 0,
    total_amount REAL NOT NULL DEFAULT 0,
    created_by TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (customer_id) REFERENCES customers(id) ON DELETE SET NULL,
    FOREIGN KEY (created_by) REFERENCES profiles(id) ON DELETE RESTRICT
  )
`);

// ============================================
// PROFORMA ITEMS
// ============================================
db.exec(`
  CREATE TABLE IF NOT EXISTS proforma_items (
    id TEXT PRIMARY KEY,
    proforma_id TEXT NOT NULL,
    product_id TEXT,
    description TEXT NOT NULL,
    quantity REAL NOT NULL,
    unit_price REAL NOT NULL,
    discount_amount REAL NOT NULL DEFAULT 0,
    tax_amount REAL NOT NULL DEFAULT 0,
    line_total REAL NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (proforma_id) REFERENCES proformas(id) ON DELETE CASCADE,
    FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE RESTRICT
  )
`);

// ============================================
// SALES
// ============================================
db.exec(`
  CREATE TABLE IF NOT EXISTS sales (
    id TEXT PRIMARY KEY,
    sale_number TEXT NOT NULL UNIQUE,
    customer_id TEXT,
    proforma_id TEXT UNIQUE,
    status TEXT NOT NULL DEFAULT 'completed',
    sold_at TEXT NOT NULL DEFAULT (datetime('now')),
    subtotal REAL NOT NULL DEFAULT 0,
    discount_amount REAL NOT NULL DEFAULT 0,
    tax_amount REAL NOT NULL DEFAULT 0,
    total_amount REAL NOT NULL DEFAULT 0,
    journal_entry_id TEXT UNIQUE,
    accounting_synced INTEGER NOT NULL DEFAULT 0,
    accounting_synced_at TEXT,
    accounting_error TEXT,
    notes TEXT,
    created_by TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (customer_id) REFERENCES customers(id) ON DELETE SET NULL,
    FOREIGN KEY (proforma_id) REFERENCES proformas(id) ON DELETE SET NULL,
    FOREIGN KEY (created_by) REFERENCES profiles(id) ON DELETE RESTRICT
  )
`);

// ============================================
// SALE ITEMS
// ============================================
db.exec(`
  CREATE TABLE IF NOT EXISTS sale_items (
    id TEXT PRIMARY KEY,
    sale_id TEXT NOT NULL,
    product_id TEXT,
    description TEXT NOT NULL,
    quantity REAL NOT NULL,
    unit_price REAL NOT NULL,
    discount_amount REAL NOT NULL DEFAULT 0,
    tax_amount REAL NOT NULL DEFAULT 0,
    line_total REAL NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (sale_id) REFERENCES sales(id) ON DELETE CASCADE,
    FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE RESTRICT
  )
`);

// ============================================
// PAYMENTS
// ============================================
db.exec(`
  CREATE TABLE IF NOT EXISTS payments (
    id TEXT PRIMARY KEY,
    sale_id TEXT NOT NULL,
    method TEXT NOT NULL,
    amount REAL NOT NULL,
    reference TEXT,
    payment_reference TEXT UNIQUE,
    journal_entry_id TEXT UNIQUE,
    received_by TEXT NOT NULL,
    paid_at TEXT NOT NULL DEFAULT (datetime('now')),
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (sale_id) REFERENCES sales(id) ON DELETE RESTRICT,
    FOREIGN KEY (received_by) REFERENCES profiles(id) ON DELETE RESTRICT
  )
`);

// ============================================
// STOCK MOVEMENTS
// ============================================
db.exec(`
  CREATE TABLE IF NOT EXISTS stock_movements (
    id TEXT PRIMARY KEY,
    product_id TEXT NOT NULL,
    movement_type TEXT NOT NULL,
    quantity REAL NOT NULL,
    reason TEXT,
    old_stock REAL,
    new_stock REAL,
    supplier_id TEXT,
    purchase_price REAL,
    reference_type TEXT,
    reference_id TEXT,
    movement_at TEXT NOT NULL DEFAULT (datetime('now')),
    journal_entry_id TEXT UNIQUE,
    accounting_synced INTEGER NOT NULL DEFAULT 0,
    accounting_synced_at TEXT,
    accounting_error TEXT,
    created_by TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE RESTRICT,
    FOREIGN KEY (supplier_id) REFERENCES suppliers(id) ON DELETE SET NULL,
    FOREIGN KEY (created_by) REFERENCES profiles(id) ON DELETE RESTRICT
  )
`);

// ============================================
// EXPENSES
// ============================================
db.exec(`
  CREATE TABLE IF NOT EXISTS expenses (
    id TEXT PRIMARY KEY,
    label TEXT NOT NULL,
    amount REAL NOT NULL,
    expense_date TEXT NOT NULL DEFAULT (date('now')),
    notes TEXT,
    journal_entry_id TEXT UNIQUE,
    accounting_synced INTEGER NOT NULL DEFAULT 0,
    accounting_synced_at TEXT,
    created_by TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (created_by) REFERENCES profiles(id) ON DELETE RESTRICT
  )
`);

// ============================================
// CASH SESSIONS
// ============================================
db.exec(`
  CREATE TABLE IF NOT EXISTS cash_sessions (
    id TEXT PRIMARY KEY,
    opened_by TEXT NOT NULL,
    opened_at TEXT NOT NULL DEFAULT (datetime('now')),
    opening_amount REAL NOT NULL DEFAULT 0,
    closed_at TEXT,
    closing_amount REAL,
    notes TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (opened_by) REFERENCES profiles(id) ON DELETE RESTRICT
  )
`);

// ============================================
// SETTINGS
// ============================================
db.exec(`
  CREATE TABLE IF NOT EXISTS settings (
    id TEXT PRIMARY KEY,
    key TEXT NOT NULL UNIQUE,
    value TEXT NOT NULL DEFAULT '{}',
    description TEXT,
    updated_by TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (updated_by) REFERENCES profiles(id) ON DELETE SET NULL
  )
`);

// ============================================
// ACCOUNTING TABLES
// ============================================
db.exec(`
  CREATE TABLE IF NOT EXISTS accounts (
    id TEXT PRIMARY KEY,
    code TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    account_type TEXT NOT NULL,
    parent_id TEXT,
    is_active INTEGER NOT NULL DEFAULT 1,
    description TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (parent_id) REFERENCES accounts(id) ON DELETE SET NULL
  )
`);

db.exec(`
  CREATE TABLE IF NOT EXISTS accounting_periods (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL UNIQUE,
    start_date TEXT NOT NULL,
    end_date TEXT NOT NULL,
    is_closed INTEGER NOT NULL DEFAULT 0,
    closed_at TEXT,
    closed_by TEXT,
    notes TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (closed_by) REFERENCES profiles(id) ON DELETE SET NULL
  )
`);

db.exec(`
  CREATE TABLE IF NOT EXISTS journal_entries (
    id TEXT PRIMARY KEY,
    entry_number TEXT NOT NULL UNIQUE,
    period_id TEXT NOT NULL,
    entry_date TEXT NOT NULL,
    description TEXT NOT NULL,
    reference_type TEXT,
    reference_id TEXT,
    status TEXT NOT NULL DEFAULT 'draft',
    total_debit REAL NOT NULL DEFAULT 0,
    total_credit REAL NOT NULL DEFAULT 0,
    created_by TEXT NOT NULL,
    posted_by TEXT,
    posted_at TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (period_id) REFERENCES accounting_periods(id) ON DELETE RESTRICT,
    FOREIGN KEY (created_by) REFERENCES profiles(id) ON DELETE RESTRICT,
    FOREIGN KEY (posted_by) REFERENCES profiles(id) ON DELETE SET NULL
  )
`);

db.exec(`
  CREATE TABLE IF NOT EXISTS journal_entry_lines (
    id TEXT PRIMARY KEY,
    journal_entry_id TEXT NOT NULL,
    account_id TEXT NOT NULL,
    description TEXT,
    debit_amount REAL NOT NULL DEFAULT 0,
    credit_amount REAL NOT NULL DEFAULT 0,
    line_number INTEGER NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (journal_entry_id) REFERENCES journal_entries(id) ON DELETE CASCADE,
    FOREIGN KEY (account_id) REFERENCES accounts(id) ON DELETE RESTRICT
  )
`);

// ============================================
// AUDIT LOG
// ============================================
db.exec(`
  CREATE TABLE IF NOT EXISTS audit_log (
    id TEXT PRIMARY KEY,
    user_id TEXT,
    profile_id TEXT,
    action TEXT NOT NULL,
    entity_type TEXT NOT NULL,
    entity_id TEXT,
    old_values TEXT,
    new_values TEXT,
    ip_address TEXT,
    user_agent TEXT,
    success INTEGER NOT NULL DEFAULT 1,
    error_message TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (user_id) REFERENCES local_users(id) ON DELETE SET NULL,
    FOREIGN KEY (profile_id) REFERENCES profiles(id) ON DELETE SET NULL
  )
`);

// ============================================
// ADJUSTMENTS
// ============================================
db.exec(`
  CREATE TABLE IF NOT EXISTS adjustments (
    id TEXT PRIMARY KEY,
    adjustment_number TEXT NOT NULL UNIQUE,
    period_id TEXT NOT NULL,
    adjustment_date TEXT NOT NULL,
    description TEXT NOT NULL,
    adjustment_type TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'draft',
    journal_entry_id TEXT UNIQUE,
    prepared_by TEXT NOT NULL,
    approved_by TEXT,
    approved_at TEXT,
    supporting_document_url TEXT,
    notes TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (period_id) REFERENCES accounting_periods(id) ON DELETE RESTRICT,
    FOREIGN KEY (journal_entry_id) REFERENCES journal_entries(id) ON DELETE SET NULL,
    FOREIGN KEY (prepared_by) REFERENCES profiles(id) ON DELETE RESTRICT,
    FOREIGN KEY (approved_by) REFERENCES profiles(id) ON DELETE SET NULL
  )
`);

// ============================================
// INITIAL DATA
// ============================================

// Insert the starter director only once. This keeps `npm run init-db` safe to
// re-run when the schema evolves, instead of failing on the unique e-mail.
const existingAdmin = db.prepare('SELECT id FROM local_users WHERE email = ?').get('admin@maketpeyizan.com');
const adminId = existingAdmin?.id || crypto.randomUUID();
const directorRole = db.prepare('SELECT id FROM roles WHERE code = ?').get('director');

if (!existingAdmin) {
  const hashedPassword = await bcrypt.hash('admin123', 10);
  db.prepare('INSERT INTO local_users (id, email, password_hash, full_name, is_active) VALUES (?, ?, ?, ?, 1)').run(
    adminId,
    'admin@maketpeyizan.com',
    hashedPassword,
    'Administrateur'
  );
}

db.prepare('INSERT OR IGNORE INTO profiles (id, full_name, email, role_id, active) VALUES (?, ?, ?, ?, 1)').run(
  adminId,
  'Administrateur',
  'admin@maketpeyizan.com',
  directorRole.id,
  1
);

// Insert chart of accounts
const accounts = [
  { code: '101000', name: 'Caisse', type: 'asset' },
  { code: '102000', name: 'Banque', type: 'asset' },
  { code: '110000', name: 'Clients', type: 'asset' },
  { code: '120000', name: 'Stock de marchandises', type: 'asset' },
  { code: '201000', name: 'Fournisseurs', type: 'liability' },
  { code: '210000', name: 'Dettes fiscales - TVA', type: 'liability' },
  { code: '301000', name: 'Capital social', type: 'equity' },
  { code: '401000', name: 'Ventes de marchandises', type: 'revenue' },
  { code: '501000', name: 'Coût des marchandises vendues', type: 'expense' },
  { code: '502000', name: 'Achats de marchandises', type: 'expense' },
];

const insertAccount = db.prepare('INSERT OR IGNORE INTO accounts (id, code, name, account_type) VALUES (?, ?, ?, ?)');
for (const account of accounts) {
  insertAccount.run(crypto.randomUUID(), account.code, account.name, account.type);
}

// Insert initial accounting period
db.prepare(`
  INSERT OR IGNORE INTO accounting_periods (id, name, start_date, end_date)
  VALUES (?, ?, ?, ?)
`).run(
  crypto.randomUUID(),
  `Période initiale ${new Date().toISOString().slice(0, 7)}`,
  new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString().slice(0, 10),
  new Date(new Date().getFullYear(), new Date().getMonth() + 1, 0).toISOString().slice(0, 10)
);

// Insert settings
const settings = [
  { key: 'company.name', value: '"Maket Peyizan"', description: 'Nom de l\'entreprise' },
  { key: 'company.currency', value: '"HTG"', description: 'Devise utilisée' },
  { key: 'company.tax_rate', value: '18.5', description: 'Taux de TVA par défaut en %' },
  { key: 'stock.valuation_method', value: '"weighted_average"', description: 'Méthode de valorisation du stock' },
];

const insertSetting = db.prepare('INSERT OR IGNORE INTO settings (id, key, value, description) VALUES (?, ?, ?, ?)');
for (const setting of settings) {
  insertSetting.run(crypto.randomUUID(), setting.key, setting.value, setting.description);
}

db.close();
console.log('Database initialized successfully!');
console.log('Create or rotate the initial administrator credentials through the secured setup procedure before use.');
