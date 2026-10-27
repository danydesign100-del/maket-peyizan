import express from 'express';
import cors from 'cors';
import initSqlJs from 'sql.js';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcrypt';
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3001;
const isProduction = process.env.NODE_ENV === 'production';

// SQLite connection with sql.js
// A separate path makes isolated QA possible without ever modifying the
// operator's local database. The default remains the existing local database.
const dbPath = process.env.LOCAL_DB_PATH || path.join(__dirname, 'maket-peyizan.db');
let db;
let SQL;

async function initDatabase() {
  SQL = await initSqlJs();
  
  let dbBuffer;
  if (fs.existsSync(dbPath)) {
    dbBuffer = fs.readFileSync(dbPath);
    db = new SQL.Database(dbBuffer);
  } else {
    db = new SQL.Database();
  }
  
  db.run('PRAGMA foreign_keys = ON');

  // Older local databases were created before the administrator role existed.
  // Keep the role catalogue compatible without rewriting any operator data.
  try {
    db.run(
      'INSERT OR IGNORE INTO roles (id, code, name, description) VALUES (?, ?, ?, ?)',
      [crypto.randomUUID(), 'administrator', 'ADMINISTRATEUR', 'Administration du système']
    );
  } catch {
    // A database that has not been initialized yet is handled by init-db.js.
  }
}

await initDatabase();

// Save database to file periodically
function saveDatabase() {
  const data = db.export();
  const buffer = Buffer.from(data);
  fs.writeFileSync(dbPath, buffer);
}

// Auto-save every 30 seconds
setInterval(saveDatabase, 30000);

// Middleware
// Allow all origins for development (browser preview uses dynamic ports)
app.use(cors({ origin: true }));
app.use(express.json());

// JWT Secret
const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key-change-in-production';
if (isProduction && JWT_SECRET === 'your-secret-key-change-in-production') {
  throw new Error('JWT_SECRET must be configured in production');
}

const loginAttempts = new Map();
const LOGIN_WINDOW_MS = 15 * 60 * 1000;
const MAX_LOGIN_ATTEMPTS = 8;
function loginKey(req) { return `${req.ip}:${String(req.body?.email || '').toLowerCase()}`; }
function isLoginLimited(req) {
  const attempt = loginAttempts.get(loginKey(req));
  return attempt && attempt.count >= MAX_LOGIN_ATTEMPTS && Date.now() - attempt.startedAt < LOGIN_WINDOW_MS;
}
function registerLoginFailure(req) {
  const key = loginKey(req); const current = loginAttempts.get(key);
  if (!current || Date.now() - current.startedAt >= LOGIN_WINDOW_MS) loginAttempts.set(key, { count: 1, startedAt: Date.now() });
  else current.count += 1;
}

// Middleware to verify JWT token
const authenticateToken = (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) {
    return res.status(401).json({ error: 'Access token required' });
  }

  jwt.verify(token, JWT_SECRET, (err, user) => {
    if (err) {
      return res.status(403).json({ error: 'Invalid or expired token' });
    }
    req.user = user;
    next();
  });
};

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Helper function to run queries
function query(sql, params = []) {
  const stmt = db.prepare(sql);
  stmt.bind(params);
  const rows = [];
  while (stmt.step()) rows.push(stmt.getAsObject());
  stmt.free();
  return rows;
}

// Helper function to run a single query
function queryOne(sql, params = []) {
  return query(sql, params)[0] ?? null;
}

// Helper function to execute (INSERT, UPDATE, DELETE)
function execute(sql, params = []) {
  db.run(sql, params);
  if (!transactionActive) saveDatabase();
}

let transactionActive = false;

const hasAnyRole = (user, allowedRoles) => allowedRoles.includes(user.role_code);
const canUseCashRegister = (user) => hasAnyRole(user, ['cashier', 'director', 'administrator']);
const canManageCatalog = (user) => hasAnyRole(user, ['director', 'administrator', 'stock_manager']);
const canManageExpenses = (user) => hasAnyRole(user, ['director', 'administrator', 'accountant']);
const canReadAccounting = (user) => hasAnyRole(user, ['director', 'administrator', 'accountant']);
const canManageAdministration = (user) => hasAnyRole(user, ['director', 'administrator']);

// Login endpoint
app.post('/auth/login', async (req, res) => {
  try {
    if (isLoginLimited(req)) return res.status(429).json({ error: 'Too many login attempts. Try again later.' });
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password are required' });
    }

    // Get user from database
    const user = queryOne('SELECT * FROM local_users WHERE email = ? AND is_active = 1', [email]);

    if (!user) {
      registerLoginFailure(req);
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    // Verify password with bcrypt
    const passwordMatch = await bcrypt.compare(password, user.password_hash);

    if (!passwordMatch) {
      registerLoginFailure(req);
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    // Get profile and role
    const profile = queryOne(`
      SELECT p.*, r.code as role_code, r.name as role_name 
      FROM profiles p 
      JOIN roles r ON r.id = p.role_id 
      WHERE p.id = ?
    `, [user.id]);

    if (!profile) {
      return res.status(500).json({ error: 'Profile not found' });
    }

    // Generate JWT token
    const token = jwt.sign(
      {
        id: user.id,
        email: user.email,
        full_name: user.full_name,
        role_code: profile.role_code,
        role_name: profile.role_name,
      },
      JWT_SECRET,
      { expiresIn: '24h' }
    );

    loginAttempts.delete(loginKey(req));
    res.json({
      token,
      user: {
        id: user.id,
        email: user.email,
        full_name: user.full_name,
        role: {
          code: profile.role_code,
          name: profile.role_name,
        },
      },
    });
  } catch (err) {
    console.error('Login error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get current user profile
app.get('/auth/me', authenticateToken, (req, res) => {
  try {
    const profile = queryOne(`
      SELECT p.*, r.code as role_code, r.name as role_name 
      FROM profiles p 
      JOIN roles r ON r.id = p.role_id 
      WHERE p.id = ?
    `, [req.user.id]);

    if (!profile) {
      return res.status(404).json({ error: 'Profile not found' });
    }

    res.json(profile);
  } catch (err) {
    console.error('Get profile error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Local-mode administration endpoints. They are deliberately separate from
// /query so that employee accounts and company settings never become available
// through arbitrary browser SQL.
app.get('/admin/users', authenticateToken, (req, res) => {
  try {
    if (!canManageAdministration(req.user)) return res.status(403).json({ error: 'Permission denied' });
    const users = query(`
      select p.id, p.full_name, p.email, p.active, p.role_id,
             r.code as role_code, r.name as role_name
      from profiles p
      join roles r on r.id = p.role_id
      order by p.full_name
    `).map((row) => ({
      id: row.id,
      full_name: row.full_name,
      email: row.email,
      active: Boolean(row.active),
      role_id: row.role_id,
      role: { code: row.role_code, name: row.role_name },
    }));
    const roles = query('select id, code, name, description from roles order by name');
    res.json({ users, roles });
  } catch (err) {
    console.error('List local users error:', err);
    res.status(500).json({ error: 'Unable to load users' });
  }
});

app.patch('/admin/users/:id', authenticateToken, (req, res) => {
  transactionActive = true;
  try {
    if (!canManageAdministration(req.user)) return res.status(403).json({ error: 'Permission denied' });
    const userId = req.params.id;
    if (!userId || userId === req.user.id) return res.status(400).json({ error: 'You cannot modify your own access' });

    const existing = queryOne(`
      select p.id, p.active, p.role_id, r.code as role_code
      from profiles p join roles r on r.id = p.role_id
      where p.id = ?
    `, [userId]);
    if (!existing) return res.status(404).json({ error: 'User not found' });

    const patch = req.body && typeof req.body === 'object' ? req.body : {};
    const updates = [];
    const values = [];
    let nextActive = Boolean(existing.active);
    let nextRoleId = existing.role_id;
    if (Object.prototype.hasOwnProperty.call(patch, 'active')) {
      if (typeof patch.active !== 'boolean') return res.status(400).json({ error: 'Invalid active value' });
      nextActive = patch.active;
      updates.push('active = ?');
      values.push(nextActive ? 1 : 0);
    }
    if (Object.prototype.hasOwnProperty.call(patch, 'role_id')) {
      if (typeof patch.role_id !== 'string' || !queryOne('select id from roles where id = ?', [patch.role_id])) {
        return res.status(400).json({ error: 'Invalid role' });
      }
      nextRoleId = patch.role_id;
      updates.push('role_id = ?');
      values.push(nextRoleId);
    }
    if (!updates.length) return res.status(400).json({ error: 'No valid changes provided' });

    const nextRole = queryOne('select code from roles where id = ?', [nextRoleId]);
    if (existing.role_code === 'director' && (!nextActive || nextRole?.code !== 'director')) {
      const directors = queryOne(`
        select count(*) as total from profiles p
        join roles r on r.id = p.role_id
        where p.active = 1 and r.code = 'director'
      `);
      if (Number(directors?.total || 0) <= 1) return res.status(400).json({ error: 'At least one active director is required' });
    }

    db.run('BEGIN');
    execute(`update profiles set ${updates.join(', ')}, updated_at = datetime('now') where id = ?`, [...values, userId]);
    if (Object.prototype.hasOwnProperty.call(patch, 'active')) {
      execute('update local_users set is_active = ?, updated_at = datetime(\'now\') where id = ?', [nextActive ? 1 : 0, userId]);
    }
    db.run('COMMIT');
    transactionActive = false;
    saveDatabase();

    const user = queryOne(`
      select p.id, p.full_name, p.email, p.active, p.role_id,
             r.code as role_code, r.name as role_name
      from profiles p join roles r on r.id = p.role_id
      where p.id = ?
    `, [userId]);
    res.json({
      id: user.id,
      full_name: user.full_name,
      email: user.email,
      active: Boolean(user.active),
      role_id: user.role_id,
      role: { code: user.role_code, name: user.role_name },
    });
  } catch (err) {
    try { db.run('ROLLBACK'); } catch { /* no transaction to roll back */ }
    console.error('Update local user error:', err);
    res.status(400).json({ error: err.message || 'Unable to update user' });
  } finally {
    transactionActive = false;
  }
});

function parseSettingValue(value) {
  try { return JSON.parse(value); } catch { return value; }
}

app.get('/admin/settings', authenticateToken, (req, res) => {
  try {
    if (!canManageAdministration(req.user)) return res.status(403).json({ error: 'Permission denied' });
    res.json(query('select id, key, value, description from settings order by key').map((setting) => ({
      ...setting,
      value: parseSettingValue(setting.value),
    })));
  } catch (err) {
    console.error('List local settings error:', err);
    res.status(500).json({ error: 'Unable to load settings' });
  }
});

app.put('/admin/settings/:key', authenticateToken, (req, res) => {
  try {
    if (!canManageAdministration(req.user)) return res.status(403).json({ error: 'Permission denied' });
    const key = req.params.key;
    if (!/^[a-z0-9_.-]+$/.test(key) || !Object.prototype.hasOwnProperty.call(req.body ?? {}, 'value')) {
      return res.status(400).json({ error: 'Invalid setting' });
    }
    const value = JSON.stringify(req.body.value);
    execute(`
      insert into settings (id, key, value, updated_by)
      values (?, ?, ?, ?)
      on conflict(key) do update set value = excluded.value, updated_by = excluded.updated_by, updated_at = datetime('now')
    `, [crypto.randomUUID(), key, value, req.user.id]);
    const setting = queryOne('select id, key, value, description from settings where key = ?', [key]);
    res.json({ ...setting, value: parseSettingValue(setting.value) });
  } catch (err) {
    console.error('Update local setting error:', err);
    res.status(400).json({ error: err.message || 'Unable to update setting' });
  }
});

// Read-only compatibility bridge for the local preview. Table names are
// allow-listed and permissions are applied before the SQL is executed. This
// keeps the convenient local-mode queries while never exposing local_users,
// SQLite internals, or administration data through the generic endpoint.
const operationalReadableTables = new Set([
  'products', 'categories', 'suppliers', 'customers', 'cash_sessions', 'sales',
  'sale_items', 'payments', 'stock_movements', 'proformas', 'proforma_items',
  'profiles',
]);
const accountingReadableTables = new Set([
  'accounts', 'accounting_periods', 'journal_entries', 'journal_entry_lines',
  'adjustments', 'expenses', 'audit_log',
]);
const readableTables = new Set([...operationalReadableTables, ...accountingReadableTables]);
app.post('/query', authenticateToken, (req, res) => {
  try {
    const { query: sql, params = [] } = req.body;
    // The application uses multiline template literals. Accept one optional
    // *terminal* semicolon, but reject statement chaining before executing
    // anything. This keeps the read-only endpoint safe while supporting valid
    // SQL copied from a console or editor.
    const statement = typeof sql === 'string' ? sql.trim().replace(/;\s*$/, '') : '';
    const normalized = statement.toLowerCase();
    if (!normalized.startsWith('select') || normalized.includes(';') || /\b(pragma|attach|detach|sqlite_|local_users)\b/.test(normalized)) {
      return res.status(400).json({ error: 'Only SELECT queries are allowed' });
    }
    if (!Array.isArray(params)) return res.status(400).json({ error: 'Query parameters must be an array' });
    const tables = [...normalized.matchAll(/\b(?:from|join)\s+([a-z_]+)/g)].map((match) => match[1]);
    if (!tables.length || tables.some((table) => !readableTables.has(table))) return res.status(403).json({ error: 'Query not allowed' });
    if (tables.some((table) => accountingReadableTables.has(table)) && !canReadAccounting(req.user)) {
      return res.status(403).json({ error: 'Accounting access is required' });
    }
    if (tables.includes('audit_log') && !canManageAdministration(req.user)) {
      return res.status(403).json({ error: 'Audit access is required' });
    }
    if (req.user.role_code === 'cashier' && tables.some((table) => ['sales', 'sale_items', 'payments', 'cash_sessions'].includes(table))) {
      if (!normalized.includes('created_by = ?') && !normalized.includes('opened_by = ?')) return res.status(403).json({ error: 'Query not allowed for this role' });
      if (!params.includes(req.user.id)) return res.status(403).json({ error: 'Query scope is invalid' });
    }

    const result = query(statement, params);
    res.json(result);
  } catch (err) {
    console.error('Query error:', err);
    res.status(500).json({ error: err.message });
  }
});

// Restricted CRUD bridge for the local preview. Table and column names are allow-listed;
// values are still bound parameters, never concatenated SQL values.
const editableTables = new Set(['categories', 'customers', 'suppliers', 'products', 'cash_sessions', 'expenses']);
const writableColumns = {
  categories: new Set(['name', 'description', 'active']),
  customers: new Set(['customer_number', 'full_name', 'phone', 'email', 'address', 'company_name', 'tax_id', 'customer_type', 'notes', 'active']),
  suppliers: new Set(['name', 'company_name', 'phone', 'email', 'address', 'tax_id', 'notes', 'active']),
  products: new Set(['barcode', 'name', 'brand', 'category_id', 'supplier_id', 'unit', 'purchase_price', 'selling_price', 'proforma_price', 'minimum_stock', 'image_url', 'expiration_date', 'description', 'active']),
  cash_sessions: new Set(['opened_by', 'opening_amount', 'notes', 'closed_at', 'closing_amount']),
  expenses: new Set(['label', 'amount', 'expense_date', 'notes', 'created_by']),
};
app.post('/data', authenticateToken, (req, res) => {
  try {
    const { action, table, values, id } = req.body;
    if (!editableTables.has(table) || !['insert', 'update'].includes(action) || !values || typeof values !== 'object') return res.status(400).json({ error: 'Invalid local data request' });
    const allowed = table === 'customers' ? hasAnyRole(req.user, ['cashier', 'director', 'administrator'])
      : table === 'cash_sessions' ? canUseCashRegister(req.user)
      : table === 'expenses' ? canManageExpenses(req.user)
      : canManageCatalog(req.user);
    if (!allowed) return res.status(403).json({ error: 'Permission denied' });
    const columns = Object.keys(values).filter((key) => /^[a-z_]+$/.test(key));
    if (!columns.length) return res.status(400).json({ error: 'No values provided' });
    if (columns.some((column) => !writableColumns[table].has(column))) return res.status(400).json({ error: 'Invalid or protected column' });
    if (table === 'cash_sessions') {
      if (action === 'insert' && (values.opened_by !== req.user.id || !Number.isFinite(Number(values.opening_amount)) || Number(values.opening_amount) < 0)) return res.status(400).json({ error: 'Invalid cash session' });
      if (action === 'update') {
        const current = queryOne('select * from cash_sessions where id = ? and opened_by = ? and closed_at is null', [id, req.user.id]);
        if (!current || columns.some((column) => !['closed_at', 'closing_amount', 'notes'].includes(column)) || !Number.isFinite(Number(values.closing_amount)) || Number(values.closing_amount) < 0) return res.status(403).json({ error: 'Invalid cash session closure' });
      }
    }
    if (table === 'expenses') {
      if (action !== 'insert' || values.created_by !== req.user.id || !String(values.label || '').trim() || !Number.isFinite(Number(values.amount)) || Number(values.amount) <= 0) {
        return res.status(400).json({ error: 'Invalid expense' });
      }
    }
    if (table === 'products') {
      const existingProduct = action === 'update' ? queryOne('select category_id, supplier_id from products where id = ?', [id]) : null;
      for (const field of ['purchase_price', 'selling_price', 'proforma_price', 'minimum_stock']) {
        if (Object.prototype.hasOwnProperty.call(values, field) && (!Number.isFinite(Number(values[field])) || Number(values[field]) < 0)) {
          return res.status(400).json({ error: `Invalid ${field}` });
        }
      }
      if (!String(values.name ?? '').trim() && action === 'insert') return res.status(400).json({ error: 'Product name is required' });
      if (values.category_id && values.category_id !== existingProduct?.category_id && !queryOne('select id from categories where id = ? and active = 1', [values.category_id])) {
        return res.status(400).json({ error: 'Selected category is unavailable' });
      }
      if (values.supplier_id && values.supplier_id !== existingProduct?.supplier_id && !queryOne('select id from suppliers where id = ? and active = 1', [values.supplier_id])) {
        return res.status(400).json({ error: 'Selected supplier is unavailable' });
      }
    }
    const normalized = columns.map((column) => values[column] ?? null);
    let recordId = id;
    if (action === 'insert') {
      recordId = crypto.randomUUID();
      execute(`insert into ${table} (id, ${columns.join(', ')}) values (?, ${columns.map(() => '?').join(', ')})`, [recordId, ...normalized]);
    } else {
      if (!recordId) return res.status(400).json({ error: 'Record ID required' });
      execute(`update ${table} set ${columns.map((column) => `${column} = ?`).join(', ')}, updated_at = datetime('now') where id = ?`, [...normalized, recordId]);
    }
    const record = queryOne(`select * from ${table} where id = ?`, [recordId]);
    res.json(record);
  } catch (err) {
    console.error('Local data mutation error:', err);
    res.status(400).json({ error: err.message || 'Unable to save record' });
  }
});

// RPC-like function handlers
app.post('/rpc/create_proforma', authenticateToken, (req, res) => {
  transactionActive = true;
  try {
    if (!canUseCashRegister(req.user)) return res.status(403).json({ error: 'Permission denied' });
    const { customer_id, valid_until, notes, items } = req.body;
    if (!Array.isArray(items) || items.length === 0) return res.status(400).json({ error: 'At least one item is required' });
    if (customer_id && !queryOne('select id from customers where id = ? and active = 1', [customer_id])) return res.status(400).json({ error: 'Customer unavailable' });

    let subtotal = 0;
    let discount = 0;
    let tax = 0;
    const validatedItems = items.map((item) => {
      const product = queryOne('select id, name, proforma_price, selling_price from products where id = ? and active = 1', [item.product_id]);
      const quantity = Number(item.quantity);
      const unitPrice = Number(item.unit_price);
      const discountAmount = Number(item.discount_amount || 0);
      const taxAmount = Number(item.tax_amount || 0);
      if (!product || !Number.isFinite(quantity) || quantity <= 0 || !Number.isFinite(unitPrice) || unitPrice < 0 || discountAmount < 0 || taxAmount < 0 || discountAmount > quantity * unitPrice) throw new Error('Invalid proforma item');
      subtotal += quantity * unitPrice;
      discount += discountAmount;
      tax += taxAmount;
      return { product, quantity, unitPrice, discountAmount, taxAmount, description: String(item.description || product.name).trim() || product.name };
    });
    const id = crypto.randomUUID();
    const proformaNumber = `PF-${String(Math.floor(Math.random() * 999999)).padStart(6, '0')}`;
    db.run('BEGIN');
    execute(`insert into proformas (id, proforma_number, customer_id, valid_until, notes, subtotal, discount_amount, tax_amount, total_amount, created_by)
      values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, [id, proformaNumber, customer_id || null, valid_until || null, notes?.trim() || null, subtotal, discount, tax, subtotal - discount + tax, req.user.id]);
    for (const item of validatedItems) {
      execute(`insert into proforma_items (id, proforma_id, product_id, description, quantity, unit_price, discount_amount, tax_amount, line_total)
        values (?, ?, ?, ?, ?, ?, ?, ?, ?)`, [crypto.randomUUID(), id, item.product.id, item.description, item.quantity, item.unitPrice, item.discountAmount, item.taxAmount, item.quantity * item.unitPrice - item.discountAmount + item.taxAmount]);
    }
    db.run('COMMIT');
    transactionActive = false;
    saveDatabase();
    res.json(queryOne('select * from proformas where id = ?', [id]));
  } catch (err) {
    try { db.run('ROLLBACK'); } catch { /* no transaction to roll back */ }
    res.status(400).json({ error: err.message || 'Unable to create proforma' });
  } finally { transactionActive = false; }
});

app.post('/rpc/update_proforma_status', authenticateToken, (req, res) => {
  try {
    if (!canUseCashRegister(req.user)) return res.status(403).json({ error: 'Permission denied' });
    const { id, status } = req.body;
    if (!id || !['draft', 'sent', 'accepted', 'cancelled', 'expired'].includes(status)) return res.status(400).json({ error: 'Invalid proforma status' });
    const existing = queryOne('select id from proformas where id = ?', [id]);
    if (!existing) return res.status(404).json({ error: 'Proforma not found' });
    execute("update proformas set status = ?, updated_at = datetime('now') where id = ?", [status, id]);
    res.json(queryOne('select * from proformas where id = ?', [id]));
  } catch (err) { res.status(400).json({ error: err.message || 'Unable to update proforma' }); }
});

app.post('/rpc/record_stock_movement', authenticateToken, (req, res) => {
  transactionActive = true;
  try {
    if (!canManageCatalog(req.user)) return res.status(403).json({ error: 'Permission denied' });
    const { product_id, movement_type, quantity, reason, supplier_id, purchase_price } = req.body;
    if (!['entry', 'exit', 'adjustment', 'customer_return', 'supplier_return'].includes(movement_type) || !reason?.trim()) return res.status(400).json({ error: 'Invalid stock movement' });
    const product = queryOne('select * from products where id = ? and active = 1', [product_id]);
    const amount = Number(quantity);
    if (!product || !Number.isFinite(amount) || amount === 0 || (movement_type !== 'adjustment' && amount < 0)) return res.status(400).json({ error: 'Invalid product or quantity' });
    const signedAmount = ['exit', 'supplier_return'].includes(movement_type) ? -amount : amount;
    const newStock = Number(product.stock_quantity) + signedAmount;
    if (newStock < 0) return res.status(400).json({ error: 'Insufficient stock' });
    db.run('BEGIN');
    execute('update products set stock_quantity = ?, updated_at = datetime(\'now\') where id = ?', [newStock, product_id]);
    const id = crypto.randomUUID();
    execute(`insert into stock_movements (id, product_id, movement_type, quantity, reason, old_stock, new_stock, supplier_id, purchase_price, created_by)
      values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, [id, product_id, movement_type, Math.abs(amount), reason.trim(), product.stock_quantity, newStock, supplier_id || null, purchase_price ?? null, req.user.id]);
    db.run('COMMIT'); transactionActive = false; saveDatabase();
    res.json(queryOne('select * from stock_movements where id = ?', [id]));
  } catch (err) { try { db.run('ROLLBACK'); } catch { /* no transaction */ } res.status(400).json({ error: err.message || 'Unable to record movement' }); } finally { transactionActive = false; }
});

app.post('/rpc/complete_sale', authenticateToken, (req, res) => {
  transactionActive = true;
  try {
    const { customer_id, items, payments, notes } = req.body;

    // Validate input
    if (!Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ error: 'Items required' });
    }
    if (!Array.isArray(payments) || payments.length === 0) {
      return res.status(400).json({ error: 'Payments required' });
    }

    // Generate sale number and IDs. The UUID prevents collisions even if the
    // human-readable sequence is reused after a local restore.
    const saleNumber = `VTE-${Date.now().toString().slice(-8)}-${Math.floor(Math.random() * 1000).toString().padStart(3, '0')}`;
    const saleId = crypto.randomUUID();
    const userId = req.user.id;
    if (!canUseCashRegister(req.user)) {
      return res.status(403).json({ error: 'Permission denied' });
    }
    if (!queryOne('select id from cash_sessions where opened_by = ? and closed_at is null', [userId])) {
      return res.status(400).json({ error: 'Open a cash session before recording a sale' });
    }
    if (customer_id && !queryOne('select id from customers where id = ? and active = 1', [customer_id])) {
      return res.status(400).json({ error: 'Customer unavailable' });
    }

    // Calculate totals
    let subtotal = 0;
    let discount = 0;
    let tax = 0;

    const consolidatedItems = new Map();
    for (const item of items) {
      const quantity = Number(item.quantity);
      const discountAmount = Number(item.discount_amount || 0);
      const taxAmount = Number(item.tax_amount || 0);
      if (!item.product_id || !Number.isFinite(quantity) || quantity <= 0 || !Number.isFinite(discountAmount) || discountAmount < 0 || !Number.isFinite(taxAmount) || taxAmount < 0) {
        return res.status(400).json({ error: 'Invalid sale item' });
      }
      const existing = consolidatedItems.get(item.product_id) || { product_id: item.product_id, quantity: 0, discount_amount: 0, tax_amount: 0 };
      existing.quantity += quantity; existing.discount_amount += discountAmount; existing.tax_amount += taxAmount;
      consolidatedItems.set(item.product_id, existing);
    }
    const validItems = [...consolidatedItems.values()];
    for (const item of validItems) {
      const product = queryOne('SELECT * FROM products WHERE id = ? AND active = 1', [item.product_id]);
      if (!product) {
        return res.status(400).json({ error: 'Product not found' });
      }
      if (product.stock_quantity < item.quantity) {
        return res.status(400).json({ error: 'Insufficient stock' });
      }
      if (item.discount_amount > item.quantity * Number(product.selling_price)) {
        return res.status(400).json({ error: 'Invalid discount' });
      }
      subtotal += item.quantity * product.selling_price;
      discount += item.discount_amount;
      tax += item.tax_amount;
    }

    const total = subtotal - discount + tax;

    const paymentMethods = new Set(['cash', 'card', 'moncash', 'natcash', 'bank_transfer', 'check']);
    let paidTotal = 0; let cashTendered = 0;
    for (const payment of payments) {
      const amount = Number(payment.amount);
      if (!paymentMethods.has(payment.method) || !Number.isFinite(amount) || amount <= 0) return res.status(400).json({ error: 'Invalid payment' });
      paidTotal += amount;
      if (payment.method === 'cash') cashTendered += amount;
    }
    const changeAmount = Number((paidTotal - total).toFixed(2));
    if (paidTotal + 0.01 < total || changeAmount > cashTendered + 0.01) {
      return res.status(400).json({ error: 'Payment total mismatch' });
    }

    db.run('BEGIN');
    // Insert sale
    execute(`
      INSERT INTO sales (id, sale_number, customer_id, subtotal, discount_amount, tax_amount, total_amount, notes, status, created_by)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'completed', ?)
    `, [saleId, saleNumber, customer_id || null, subtotal, discount, tax, total, notes || null, userId]);

    // Insert sale items and update stock
    for (const item of validItems) {
      const product = queryOne('SELECT * FROM products WHERE id = ?', [item.product_id]);
      const lineTotal = item.quantity * product.selling_price - (item.discount_amount || 0) + (item.tax_amount || 0);

      execute(`
        INSERT INTO sale_items (id, sale_id, product_id, description, quantity, unit_price, discount_amount, tax_amount, line_total)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `, [crypto.randomUUID(), saleId, item.product_id, product.name, item.quantity, product.selling_price, item.discount_amount || 0, item.tax_amount || 0, lineTotal]);

      // Update stock
      const newStock = product.stock_quantity - item.quantity;
      execute('UPDATE products SET stock_quantity = ? WHERE id = ?', [newStock, item.product_id]);

      // Record stock movement
      execute(`
        INSERT INTO stock_movements (id, product_id, movement_type, quantity, reason, reference_type, reference_id, old_stock, new_stock, created_by)
        VALUES (?, ?, 'exit', ?, ?, 'sale', ?, ?, ?, ?)
      `, [crypto.randomUUID(), item.product_id, item.quantity, `Sale ${saleNumber}`, saleId, product.stock_quantity, newStock, userId]);
    }

    // Insert payments
    let remainingChange = changeAmount;
    for (const payment of payments) {
      // Keep the cash physically retained, not the tendered amount, in reports.
      const cashChange = payment.method === 'cash' ? Math.min(Number(payment.amount), remainingChange) : 0;
      remainingChange = Number((remainingChange - cashChange).toFixed(2));
      const appliedAmount = Number((Number(payment.amount) - cashChange).toFixed(2));
      execute(`
        INSERT INTO payments (id, sale_id, method, amount, reference, received_by)
        VALUES (?, ?, ?, ?, ?, ?)
      `, [crypto.randomUUID(), saleId, payment.method, appliedAmount, payment.reference || null, userId]);
    }

    db.run('COMMIT');
    transactionActive = false;
    saveDatabase();
    const sale = queryOne('SELECT * FROM sales WHERE id = ?', [saleId]);
    res.json({ ...sale, change_amount: changeAmount });
  } catch (err) {
    try { db.run('ROLLBACK'); } catch { /* no transaction to roll back */ }
    console.error('Complete sale error:', err);
    res.status(500).json({ error: err.message });
  } finally {
    transactionActive = false;
  }
});

// Local accounting is intentionally explicit rather than relying on browser
// writes. A sale produces one balanced, posted journal entry when an authorized
// user asks to synchronize it.
app.post('/rpc/sync_sale_to_accounting', authenticateToken, (req, res) => {
  transactionActive = true;
  try {
    if (!canReadAccounting(req.user)) return res.status(403).json({ error: 'Permission denied' });
    const saleId = req.body?.p_sale_id ?? req.body?.sale_id;
    if (typeof saleId !== 'string' || !saleId) return res.status(400).json({ error: 'Sale ID is required' });

    const sale = queryOne('select * from sales where id = ?', [saleId]);
    if (!sale) return res.status(404).json({ error: 'Sale not found' });
    if (sale.status !== 'completed') return res.status(400).json({ error: 'Only completed sales can be synchronized' });
    if (Number(sale.accounting_synced)) {
      transactionActive = false;
      return res.json({ sale_id: sale.id, journal_entry_id: sale.journal_entry_id, already_synced: true });
    }

    const entryDate = String(sale.sold_at || new Date().toISOString()).slice(0, 10);
    const period = queryOne(`
      select * from accounting_periods
      where is_closed = 0 and start_date <= ? and end_date >= ?
      order by start_date desc limit 1
    `, [entryDate, entryDate]);
    if (!period) return res.status(400).json({ error: 'No open accounting period for this sale date' });

    const accounts = {};
    for (const code of ['101000', '120000', '401000', '501000']) {
      const account = queryOne('select id from accounts where code = ? and is_active = 1', [code]);
      if (!account) return res.status(400).json({ error: `Required account ${code} is unavailable` });
      accounts[code] = account.id;
    }

    const revenue = Number(sale.total_amount);
    if (!Number.isFinite(revenue) || revenue < 0) return res.status(400).json({ error: 'Invalid sale total' });
    const costRow = queryOne(`
      select coalesce(sum(si.quantity * coalesce(nullif(p.average_cost, 0), p.purchase_price, 0)), 0) as total_cost
      from sale_items si
      left join products p on p.id = si.product_id
      where si.sale_id = ?
    `, [saleId]);
    const cost = Number(costRow?.total_cost || 0);
    if (!Number.isFinite(cost) || cost < 0) return res.status(400).json({ error: 'Invalid inventory cost' });

    const entryId = crypto.randomUUID();
    const entryNumber = `JNL-${Date.now().toString().slice(-10)}-${Math.floor(Math.random() * 1000).toString().padStart(3, '0')}`;
    const total = Number((revenue + cost).toFixed(2));
    const lines = [
      { account_id: accounts['101000'], description: `Vente ${sale.sale_number}`, debit: revenue, credit: 0 },
      { account_id: accounts['401000'], description: `Vente ${sale.sale_number}`, debit: 0, credit: revenue },
    ];
    if (cost > 0) {
      lines.push(
        { account_id: accounts['501000'], description: `Coût vente ${sale.sale_number}`, debit: cost, credit: 0 },
        { account_id: accounts['120000'], description: `Coût vente ${sale.sale_number}`, debit: 0, credit: cost },
      );
    }

    db.run('BEGIN');
    execute(`
      insert into journal_entries (id, entry_number, period_id, entry_date, description, reference_type, reference_id, status, total_debit, total_credit, created_by, posted_by, posted_at)
      values (?, ?, ?, ?, ?, 'sale', ?, 'posted', ?, ?, ?, ?, datetime('now'))
    `, [entryId, entryNumber, period.id, entryDate, `Vente ${sale.sale_number}`, saleId, total, total, req.user.id, req.user.id]);
    for (const [index, line] of lines.entries()) {
      execute(`
        insert into journal_entry_lines (id, journal_entry_id, account_id, description, debit_amount, credit_amount, line_number)
        values (?, ?, ?, ?, ?, ?, ?)
      `, [crypto.randomUUID(), entryId, line.account_id, line.description, line.debit, line.credit, index + 1]);
    }
    execute(`
      update sales
      set accounting_synced = 1, accounting_synced_at = datetime('now'), accounting_error = null, journal_entry_id = ?, updated_at = datetime('now')
      where id = ?
    `, [entryId, saleId]);
    execute(`
      update stock_movements
      set accounting_synced = 1, accounting_synced_at = datetime('now'), accounting_error = null
      where reference_type = 'sale' and reference_id = ?
    `, [saleId]);
    db.run('COMMIT');
    transactionActive = false;
    saveDatabase();

    res.json({ sale_id: saleId, journal_entry_id: entryId, entry_number: entryNumber, already_synced: false });
  } catch (err) {
    try { db.run('ROLLBACK'); } catch { /* no transaction to roll back */ }
    console.error('Sync sale to accounting error:', err);
    res.status(400).json({ error: err.message || 'Unable to synchronize sale' });
  } finally {
    transactionActive = false;
  }
});

app.post('/rpc/post_journal_entry', authenticateToken, (req, res) => {
  transactionActive = true;
  try {
    if (!canReadAccounting(req.user)) return res.status(403).json({ error: 'Permission denied' });
    const entryId = req.body?.p_entry_id ?? req.body?.id;
    if (typeof entryId !== 'string' || !entryId) return res.status(400).json({ error: 'Journal entry ID is required' });
    const entry = queryOne('select * from journal_entries where id = ?', [entryId]);
    if (!entry) return res.status(404).json({ error: 'Journal entry not found' });
    if (entry.status !== 'draft') return res.status(400).json({ error: 'Only draft entries can be posted' });
    const totals = queryOne(`
      select coalesce(sum(debit_amount), 0) as debit, coalesce(sum(credit_amount), 0) as credit
      from journal_entry_lines where journal_entry_id = ?
    `, [entryId]);
    const debit = Number(totals?.debit || 0);
    const credit = Number(totals?.credit || 0);
    if (debit <= 0 || Math.abs(debit - credit) > 0.01) return res.status(400).json({ error: 'A journal entry must be balanced and non-zero' });

    execute(`
      update journal_entries
      set status = 'posted', total_debit = ?, total_credit = ?, posted_by = ?, posted_at = datetime('now'), updated_at = datetime('now')
      where id = ?
    `, [debit, credit, req.user.id, entryId]);
    transactionActive = false;
    saveDatabase();
    res.json(queryOne('select * from journal_entries where id = ?', [entryId]));
  } catch (err) {
    console.error('Post journal entry error:', err);
    res.status(400).json({ error: err.message || 'Unable to post journal entry' });
  } finally {
    transactionActive = false;
  }
});

// RPC: Delete expense
app.post('/rpc/delete_expense', authenticateToken, (req, res) => {
  try {
    if (!canManageExpenses(req.user)) return res.status(403).json({ error: 'Permission denied' });
    const { id } = req.body;
    if (!id) return res.status(400).json({ error: 'Expense ID is required' });
    
    const expense = queryOne('SELECT * FROM expenses WHERE id = ?', [id]);
    if (!expense) return res.status(404).json({ error: 'Expense not found' });
    
    execute('DELETE FROM expenses WHERE id = ?', [id]);
    res.json({ success: true });
  } catch (err) {
    console.error('Delete expense error:', err);
    res.status(500).json({ error: err.message });
  }
});

// Start server
app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
  console.log(`Database: ${dbPath}`);
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('SIGTERM signal received: closing HTTP server');
  saveDatabase();
  db.close();
  process.exit(0);
});
