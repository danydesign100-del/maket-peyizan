-- Maket Peyizan POS: Local PostgreSQL Schema (without Supabase dependencies)
-- This script creates a local database schema with a simple authentication system

create extension if not exists pgcrypto;
create extension if not exists pg_trgm;

-- ============================================
-- LOCAL AUTHENTICATION SYSTEM
-- ============================================

create table public.local_users (
  id uuid primary key default gen_random_uuid(),
  email text not null unique check (email ~* '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'),
  password_hash text not null,
  full_name text not null check (char_length(full_name) <= 160),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ============================================
-- SEQUENCES
-- ============================================

create sequence if not exists public.customer_number_seq start with 1 increment by 1;
create sequence if not exists public.proforma_number_seq start with 1 increment by 1;
create sequence if not exists public.sale_number_seq start with 1 increment by 1;
create sequence if not exists public.journal_entry_number_seq start with 1 increment by 1;
create sequence if not exists public.adjustment_number_seq start with 1 increment by 1;

-- ============================================
-- ROLES
-- ============================================

create table public.roles (
  id uuid primary key default gen_random_uuid(),
  code text not null unique check (code ~ '^[a-z_]+$'),
  name text not null unique,
  description text,
  created_at timestamptz not null default now()
);

insert into public.roles (code, name, description) values
  ('director', 'DIRECTEUR', 'Accès complet et supervision de toutes les opérations'),
  ('accountant', 'COMPTABLE', 'Comptabilité, finance, rapports et écritures'),
  ('cashier', 'CAISSIÈRE', 'Caisse, clients, produits, proformas et ses ventes'),
  ('stock_manager', 'GESTIONNAIRE STOCK', 'Gestion complète du stock et des inventaires')
on conflict (code) do update set name = excluded.name, description = excluded.description;

-- ============================================
-- PROFILES (linked to local_users instead of auth.users)
-- ============================================

create table public.profiles (
  id uuid primary key references public.local_users(id) on delete cascade,
  full_name text not null default '' check (char_length(full_name) <= 160),
  email text not null unique check (email ~* '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'),
  role_id uuid not null references public.roles(id) on delete restrict,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ============================================
-- CATEGORIES
-- ============================================

create table public.categories (
  id uuid primary key default gen_random_uuid(),
  name text not null unique check (char_length(trim(name)) between 1 and 120),
  description text,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ============================================
-- SUPPLIERS
-- ============================================

create table public.suppliers (
  id uuid primary key default gen_random_uuid(),
  name text not null unique check (char_length(trim(name)) between 1 and 160),
  email text check (email is null or email ~* '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'),
  phone text,
  address text,
  company_name text,
  tax_id text,
  notes text,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ============================================
-- CUSTOMERS
-- ============================================

create table public.customers (
  id uuid primary key default gen_random_uuid(),
  customer_number text not null unique default ('CL-' || lpad(nextval('public.customer_number_seq')::text, 6, '0')),
  full_name text not null check (char_length(trim(full_name)) between 1 and 160),
  email text check (email is null or email ~* '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'),
  phone text,
  address text,
  company_name text,
  tax_id text,
  customer_type text not null default 'individual' check (customer_type in ('individual', 'business')),
  notes text,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ============================================
-- PRODUCTS
-- ============================================

create table public.products (
  id uuid primary key default gen_random_uuid(),
  category_id uuid references public.categories(id) on delete set null,
  supplier_id uuid references public.suppliers(id) on delete set null,
  name text not null check (char_length(trim(name)) between 1 and 180),
  description text,
  barcode text unique check (barcode is null or char_length(trim(barcode)) between 1 and 80),
  purchase_price numeric(14,2) not null default 0 check (purchase_price >= 0),
  selling_price numeric(14,2) not null check (selling_price >= 0),
  proforma_price numeric(14,2) not null default 0 check (proforma_price >= 0),
  stock_quantity numeric(14,3) not null default 0 check (stock_quantity >= 0),
  minimum_stock numeric(14,3) not null default 0 check (minimum_stock >= 0),
  average_cost numeric(14,2) not null default 0 check (average_cost >= 0),
  brand text,
  unit text not null default 'unité' check (char_length(trim(unit)) between 1 and 40),
  image_url text,
  expiration_date date,
  is_low_stock boolean generated always as (stock_quantity > 0 and stock_quantity <= minimum_stock) stored,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (category_id, name)
);

-- ============================================
-- PROFORMAS
-- ============================================

create table public.proformas (
  id uuid primary key default gen_random_uuid(),
  proforma_number text not null unique default ('PF-' || lpad(nextval('public.proforma_number_seq')::text, 6, '0')),
  customer_id uuid references public.customers(id) on delete set null,
  status text not null default 'draft' check (status in ('draft', 'sent', 'accepted', 'cancelled', 'expired')),
  issue_date date not null default current_date,
  valid_until date,
  notes text,
  subtotal numeric(14,2) not null default 0 check (subtotal >= 0),
  discount_amount numeric(14,2) not null default 0 check (discount_amount >= 0),
  tax_amount numeric(14,2) not null default 0 check (tax_amount >= 0),
  total_amount numeric(14,2) not null default 0 check (total_amount >= 0),
  created_by uuid not null references public.profiles(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (valid_until is null or valid_until >= issue_date)
);

-- ============================================
-- PROFORMA ITEMS
-- ============================================

create table public.proforma_items (
  id uuid primary key default gen_random_uuid(),
  proforma_id uuid not null references public.proformas(id) on delete cascade,
  product_id uuid references public.products(id) on delete restrict,
  description text not null check (char_length(trim(description)) between 1 and 240),
  quantity numeric(14,3) not null check (quantity > 0),
  unit_price numeric(14,2) not null check (unit_price >= 0),
  discount_amount numeric(14,2) not null default 0 check (discount_amount >= 0),
  tax_amount numeric(14,2) not null default 0 check (tax_amount >= 0),
  line_total numeric(14,2) not null check (line_total >= 0),
  created_at timestamptz not null default now(),
  check (discount_amount <= quantity * unit_price)
);

-- ============================================
-- SALES
-- ============================================

create table public.sales (
  id uuid primary key default gen_random_uuid(),
  sale_number text not null unique default ('VTE-' || lpad(nextval('public.sale_number_seq')::text, 6, '0')),
  customer_id uuid references public.customers(id) on delete set null,
  proforma_id uuid unique references public.proformas(id) on delete set null,
  status text not null default 'completed' check (status in ('draft', 'completed', 'cancelled', 'refunded')),
  sold_at timestamptz not null default now(),
  subtotal numeric(14,2) not null default 0 check (subtotal >= 0),
  discount_amount numeric(14,2) not null default 0 check (discount_amount >= 0),
  tax_amount numeric(14,2) not null default 0 check (tax_amount >= 0),
  total_amount numeric(14,2) not null default 0 check (total_amount >= 0),
  journal_entry_id uuid unique,
  accounting_synced boolean not null default false,
  accounting_synced_at timestamptz,
  accounting_error text,
  notes text,
  created_by uuid not null references public.profiles(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ============================================
-- SALE ITEMS
-- ============================================

create table public.sale_items (
  id uuid primary key default gen_random_uuid(),
  sale_id uuid not null references public.sales(id) on delete cascade,
  product_id uuid references public.products(id) on delete restrict,
  description text not null check (char_length(trim(description)) between 1 and 240),
  quantity numeric(14,3) not null check (quantity > 0),
  unit_price numeric(14,2) not null check (unit_price >= 0),
  discount_amount numeric(14,2) not null default 0 check (discount_amount >= 0),
  tax_amount numeric(14,2) not null default 0 check (tax_amount >= 0),
  line_total numeric(14,2) not null check (line_total >= 0),
  created_at timestamptz not null default now(),
  check (discount_amount <= quantity * unit_price)
);

-- ============================================
-- PAYMENTS
-- ============================================

create table public.payments (
  id uuid primary key default gen_random_uuid(),
  sale_id uuid not null references public.sales(id) on delete restrict,
  method text not null check (method in ('cash', 'card', 'mobile_money', 'bank_transfer', 'other')),
  amount numeric(14,2) not null check (amount > 0),
  reference text,
  payment_reference text unique,
  journal_entry_id uuid unique,
  received_by uuid not null references public.profiles(id) on delete restrict,
  paid_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

-- ============================================
-- STOCK MOVEMENTS
-- ============================================

create table public.stock_movements (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.products(id) on delete restrict,
  movement_type text not null check (movement_type in ('entry', 'exit', 'adjustment', 'customer_return', 'supplier_return')),
  quantity numeric(14,3) not null check (quantity > 0),
  reason text,
  old_stock numeric(14,3),
  new_stock numeric(14,3),
  supplier_id uuid references public.suppliers(id) on delete set null,
  purchase_price numeric(14,2) check (purchase_price is null or purchase_price >= 0),
  reference_type text,
  reference_id uuid,
  movement_at timestamptz not null default now(),
  journal_entry_id uuid unique,
  accounting_synced boolean not null default false,
  accounting_synced_at timestamptz,
  accounting_error text,
  created_by uuid not null references public.profiles(id) on delete restrict,
  created_at timestamptz not null default now()
);

-- ============================================
-- EXPENSES
-- ============================================

create table public.expenses (
  id uuid primary key default gen_random_uuid(),
  label text not null check (char_length(trim(label)) between 1 and 180),
  amount numeric(14,2) not null check (amount > 0),
  expense_date date not null default current_date,
  notes text,
  journal_entry_id uuid unique,
  accounting_synced boolean not null default false,
  accounting_synced_at timestamptz,
  created_by uuid not null references public.profiles(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ============================================
-- CASH SESSIONS
-- ============================================

create table public.cash_sessions (
  id uuid primary key default gen_random_uuid(),
  opened_by uuid not null references public.profiles(id) on delete restrict,
  opened_at timestamptz not null default now(),
  opening_amount numeric(14,2) not null default 0 check (opening_amount >= 0),
  closed_at timestamptz,
  closing_amount numeric(14,2) check (closing_amount is null or closing_amount >= 0),
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (closed_at is null or closed_at >= opened_at)
);
create unique index cash_sessions_one_open_per_user on public.cash_sessions(opened_by) where closed_at is null;

-- ============================================
-- SETTINGS
-- ============================================

create table public.settings (
  id uuid primary key default gen_random_uuid(),
  key text not null unique check (key ~ '^[a-z0-9_.-]+$'),
  value jsonb not null default '{}'::jsonb,
  description text,
  updated_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ============================================
-- ACCOUNTING TABLES
-- ============================================

create table public.accounts (
  id uuid primary key default gen_random_uuid(),
  code text not null unique check (code ~ '^[0-9]{4,6}$'),
  name text not null check (char_length(trim(name)) between 1 and 180),
  account_type text not null check (account_type in ('asset', 'liability', 'equity', 'revenue', 'expense')),
  parent_id uuid references public.accounts(id) on delete set null,
  is_active boolean not null default true,
  description text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.accounting_periods (
  id uuid primary key default gen_random_uuid(),
  name text not null unique check (char_length(trim(name)) between 1 and 100),
  start_date date not null,
  end_date date not null,
  is_closed boolean not null default false,
  closed_at timestamptz,
  closed_by uuid references public.profiles(id) on delete set null,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (end_date >= start_date),
  check (not is_closed or closed_at is not null)
);

create table public.journal_entries (
  id uuid primary key default gen_random_uuid(),
  entry_number text not null unique default ('ECR-' || lpad(nextval('public.journal_entry_number_seq')::text, 6, '0')),
  period_id uuid not null references public.accounting_periods(id) on delete restrict,
  entry_date date not null,
  description text not null check (char_length(trim(description)) between 1 and 500),
  reference_type text,
  reference_id uuid,
  status text not null default 'draft' check (status in ('draft', 'posted', 'voided')),
  total_debit numeric(14,2) not null default 0 check (total_debit >= 0),
  total_credit numeric(14,2) not null default 0 check (total_credit >= 0),
  created_by uuid not null references public.profiles(id) on delete restrict,
  posted_by uuid references public.profiles(id) on delete set null,
  posted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (status = 'draft' or posted_at is not null)
);

create table public.journal_entry_lines (
  id uuid primary key default gen_random_uuid(),
  journal_entry_id uuid not null references public.journal_entries(id) on delete cascade,
  account_id uuid not null references public.accounts(id) on delete restrict,
  description text,
  debit_amount numeric(14,2) not null default 0 check (debit_amount >= 0),
  credit_amount numeric(14,2) not null default 0 check (credit_amount >= 0),
  line_number integer not null,
  created_at timestamptz not null default now(),
  check (debit_amount > 0 or credit_amount > 0),
  check (not (debit_amount > 0 and credit_amount > 0))
);

-- ============================================
-- AUDIT LOG
-- ============================================

create table public.audit_log (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references public.local_users(id) on delete set null,
  profile_id uuid references public.profiles(id) on delete set null,
  action text not null check (char_length(trim(action)) between 1 and 100),
  entity_type text not null check (char_length(trim(entity_type)) between 1 and 50),
  entity_id uuid,
  old_values jsonb,
  new_values jsonb,
  ip_address text,
  user_agent text,
  success boolean not null default true,
  error_message text,
  created_at timestamptz not null default now()
);

-- ============================================
-- ADJUSTMENTS
-- ============================================

create table public.adjustments (
  id uuid primary key default gen_random_uuid(),
  adjustment_number text not null unique default ('AJT-' || lpad(nextval('public.adjustment_number_seq')::text, 6, '0')),
  period_id uuid not null references public.accounting_periods(id) on delete restrict,
  adjustment_date date not null,
  description text not null check (char_length(trim(description)) between 1 and 888),
  adjustment_type text not null check (adjustment_type in ('accrual', 'deferral', 'depreciation', 'provision', 'error_correction', 'reconciliation', 'stock_impact')),
  status text not null default 'draft' check (status in ('draft', 'pending_approval', 'approved', 'posted', 'voided')),
  journal_entry_id uuid unique references public.journal_entries(id) on delete set null,
  prepared_by uuid not null references public.profiles(id) on delete restrict,
  approved_by uuid references public.profiles(id) on delete set null,
  approved_at timestamptz,
  supporting_document_url text,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ============================================
-- INDEXES
-- ============================================

create index customers_full_name_idx on public.customers using gin (full_name gin_trgm_ops);
create index customers_phone_idx on public.customers(phone) where phone is not null;
create index customers_email_idx on public.customers(email) where email is not null;
create unique index products_barcode_idx on public.products(barcode) where barcode is not null;
create index products_name_idx on public.products using gin (name gin_trgm_ops);
create index products_brand_idx on public.products using gin (brand gin_trgm_ops) where brand is not null;
create index products_low_stock_idx on public.products(is_low_stock) where is_low_stock;
create index proformas_number_idx on public.proformas(proforma_number);
create index sales_number_idx on public.sales(sale_number);
create index stock_movements_product_created_idx on public.stock_movements(product_id, created_at desc);
create index stock_movements_supplier_idx on public.stock_movements(supplier_id);
create index stock_movements_type_created_idx on public.stock_movements(movement_type, movement_at desc);
create index sales_created_by_idx on public.sales(created_by, sold_at desc);
create index proformas_created_by_idx on public.proformas(created_by, created_at desc);
create index accounts_code_idx on public.accounts(code);
create index accounts_type_idx on public.accounts(account_type);
create index accounts_parent_idx on public.accounts(parent_id);
create index accounts_active_idx on public.accounts(is_active) where is_active;
create index accounting_periods_name_idx on public.accounting_periods(name);
create index accounting_periods_dates_idx on public.accounting_periods(start_date, end_date);
create index accounting_periods_closed_idx on public.accounting_periods(is_closed);
create index journal_entries_number_idx on public.journal_entries(entry_number);
create index journal_entries_period_idx on public.journal_entries(period_id);
create index journal_entries_date_idx on public.journal_entries(entry_date);
create index journal_entries_reference_idx on public.journal_entries(reference_type, reference_id);
create index journal_entries_status_idx on public.journal_entries(status);
create index journal_entries_created_by_idx on public.journal_entries(created_by);
create index journal_entry_lines_entry_idx on public.journal_entry_lines(journal_entry_id);
create index journal_entry_lines_account_idx on public.journal_entry_lines(account_id);
create index journal_entry_lines_line_number_idx on public.journal_entry_lines(journal_entry_id, line_number);
create index audit_log_user_idx on public.audit_log(user_id);
create index audit_log_profile_idx on public.audit_log(profile_id);
create index audit_log_entity_idx on public.audit_log(entity_type, entity_id);
create index audit_log_action_idx on public.audit_log(action);
create index audit_log_created_idx on public.audit_log(created_at desc);
create index audit_log_success_idx on public.audit_log(success) where not success;
create index adjustments_number_idx on public.adjustments(adjustment_number);
create index adjustments_period_idx on public.adjustments(period_id);
create index adjustments_status_idx on public.adjustments(status);
create index adjustments_type_idx on public.adjustments(adjustment_type);
create index adjustments_prepared_by_idx on public.adjustments(prepared_by);
create index sales_journal_entry_idx on public.sales(journal_entry_id);
create index sales_accounting_synced_idx on public.sales(accounting_synced) where not accounting_synced;
create index stock_movements_journal_entry_idx on public.stock_movements(journal_entry_id);
create index stock_movements_accounting_synced_idx on public.stock_movements(accounting_synced) where not accounting_synced;
create index payments_payment_reference_idx on public.payments(payment_reference) where payment_reference is not null;
create index payments_journal_entry_idx on public.payments(journal_entry_id);
create index expenses_journal_entry_idx on public.expenses(journal_entry_id);
create index accounts_type_active_idx on public.accounts(account_type, is_active) where is_active;
create index journal_entries_period_status_idx on public.journal_entries(period_id, status);
create index journal_entry_lines_account_debit_idx on public.journal_entry_lines(account_id) where debit_amount > 0;
create index journal_entry_lines_account_credit_idx on public.journal_entry_lines(account_id) where credit_amount > 0;

-- ============================================
-- TRIGGERS AND FUNCTIONS
-- ============================================

create or replace function public.set_updated_at() returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end; $$;

create trigger profiles_set_updated_at before update on public.profiles for each row execute function public.set_updated_at();
create trigger categories_set_updated_at before update on public.categories for each row execute function public.set_updated_at();
create trigger suppliers_set_updated_at before update on public.suppliers for each row execute function public.set_updated_at();
create trigger customers_set_updated_at before update on public.customers for each row execute function public.set_updated_at();
create trigger products_set_updated_at before update on public.products for each row execute function public.set_updated_at();
create trigger proformas_set_updated_at before update on public.proformas for each row execute function public.set_updated_at();
create trigger sales_set_updated_at before update on public.sales for each row execute function public.set_updated_at();
create trigger expenses_set_updated_at before update on public.expenses for each row execute function public.set_updated_at();
create trigger cash_sessions_set_updated_at before update on public.cash_sessions for each row execute function public.set_updated_at();
create trigger settings_set_updated_at before update on public.settings for each row execute function public.set_updated_at();
create trigger accounts_set_updated_at before update on public.accounts for each row execute function public.set_updated_at();
create trigger accounting_periods_set_updated_at before update on public.accounting_periods for each row execute function public.set_updated_at();
create trigger journal_entries_set_updated_at before update on public.journal_entries for each row execute function public.set_updated_at();
create trigger adjustments_set_updated_at before update on public.adjustments for each row execute function public.set_updated_at();
create trigger local_users_set_updated_at before update on public.local_users for each row execute function public.set_updated_at();

-- Stock movement trigger
create or replace function public.apply_stock_movement() returns trigger language plpgsql security definer set search_path = public as $$
declare current_stock numeric(14,3); delta numeric(14,3);
begin
  select stock_quantity into current_stock from public.products where id = new.product_id for update;
  if current_stock is null then raise exception 'Product not found'; end if;
  delta := case
    when new.movement_type in ('entry', 'customer_return') then new.quantity
    when new.movement_type in ('exit', 'supplier_return') then -new.quantity
    when new.movement_type = 'adjustment' then new.quantity
    else raise exception 'Invalid movement type'
  end;
  if new.movement_type <> 'adjustment' and new.quantity <= 0 then raise exception 'Quantity must be positive'; end if;
  if new.movement_type = 'adjustment' and new.quantity = 0 then raise exception 'Adjustment cannot be zero'; end if;
  if current_stock + delta < 0 then raise exception 'Insufficient stock'; end if;
  new.old_stock := current_stock;
  new.new_stock := current_stock + delta;
  perform set_config('pos.stock_movement', 'true', true);
  update public.products set stock_quantity = new.new_stock where id = new.product_id;
  return new;
end; $$;

create trigger stock_movements_apply_stock before insert on public.stock_movements for each row execute function public.apply_stock_movement();

-- Prevent direct stock change
create or replace function public.prevent_direct_stock_change() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' and new.stock_quantity <> 0 then raise exception 'The stock initial must be created by a movement'; end if;
  if tg_op = 'UPDATE' and new.stock_quantity is distinct from old.stock_quantity and coalesce(current_setting('pos.stock_movement', true), '') <> 'true' then
    raise exception 'The stock can only be modified by a movement';
  end if;
  return new;
end; $$;

create trigger products_prevent_direct_stock_change before insert or update of stock_quantity on public.products for each row execute function public.prevent_direct_stock_change();

-- Average cost update
create or replace function public.update_average_cost() returns trigger language plpgsql security definer set search_path = public as $$
declare new_avg_cost numeric(14,2); valuation_method text;
begin
  select trim(both '"' from value::text) into valuation_method from public.settings where key = 'stock.valuation_method';
  if coalesce(valuation_method, 'weighted_average') = 'weighted_average'
    and new.movement_type = 'entry' and new.purchase_price is not null then
    new_avg_cost := ((new.old_stock * coalesce((select average_cost from public.products where id = new.product_id), 0)) + (new.quantity * new.purchase_price))
      / nullif(new.old_stock + new.quantity, 0);
    update public.products set average_cost = new_avg_cost where id = new.product_id;
  end if;
  return new;
end; $$;

create trigger stock_movements_update_average_cost after insert on public.stock_movements for each row execute function public.update_average_cost();

-- Journal entry balance validation
create or replace function public.validate_journal_entry_balance() returns trigger language plpgsql security definer set search_path = public as $$
declare total_debit numeric(14,2); total_credit numeric(14,2); tolerance numeric(14,2) := 0.01;
begin
  if tg_op = 'INSERT' or tg_op = 'UPDATE' then
    select coalesce(sum(debit_amount), 0), coalesce(sum(credit_amount), 0)
    into total_debit, total_credit
    from public.journal_entry_lines
    where journal_entry_id = coalesce(new.id, old.id);
    
    if abs(total_debit - total_credit) > tolerance then
      raise exception 'Unbalanced entry: Debit=%, Credit=% (diff=%)', total_debit, total_credit, abs(total_debit - total_credit);
    end if;
    
    new.total_debit := total_debit;
    new.total_credit := total_credit;
  end if;
  return new;
end; $$;

create trigger journal_entries_validate_balance before insert or update on public.journal_entries for each row execute function public.validate_journal_entry_balance();

-- ============================================
-- VIEWS
-- ============================================

create or replace view public.general_ledger as
select je.id as entry_id, je.entry_number, je.entry_date, je.description as entry_description,
  je.status, a.code as account_code, a.name as account_name, a.account_type,
  jel.description as line_description, jel.debit_amount, jel.credit_amount, jel.line_number,
  p.full_name as created_by_name, je.created_at
from public.journal_entries je
join public.journal_entry_lines jel on jel.journal_entry_id = je.id
join public.accounts a on jel.account_id = a.id
left join public.profiles p on p.id = je.created_by
where je.status = 'posted';

create or replace view public.trial_balance as
select a.id as account_id, a.code, a.name, a.account_type, a.parent_id,
  coalesce(sum(jel.debit_amount) filter (where je.id is not null), 0) as total_debit,
  coalesce(sum(jel.credit_amount) filter (where je.id is not null), 0) as total_credit,
  case when a.account_type in ('asset', 'expense') then coalesce(sum(jel.debit_amount) filter (where je.id is not null), 0) - coalesce(sum(jel.credit_amount) filter (where je.id is not null), 0)
       else coalesce(sum(jel.credit_amount) filter (where je.id is not null), 0) - coalesce(sum(jel.debit_amount) filter (where je.id is not null), 0) end as balance
from public.accounts a
left join public.journal_entry_lines jel on jel.account_id = a.id
left join public.journal_entries je on je.id = jel.journal_entry_id and je.status = 'posted'
where a.is_active = true
group by a.id, a.code, a.name, a.account_type, a.parent_id
order by a.code;

create or replace view public.unsynced_sales as
select s.id, s.sale_number, s.sold_at, s.total_amount, s.status, s.accounting_error, p.full_name as cashier_name
from public.sales s
left join public.profiles p on p.id = s.created_by
where not s.accounting_synced and s.status = 'completed'
order by s.sold_at desc;

grant select on public.general_ledger, public.trial_balance, public.unsynced_sales to public;
