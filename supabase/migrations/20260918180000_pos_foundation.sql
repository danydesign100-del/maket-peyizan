-- Maket Peyizan POS: fondation PostgreSQL / Supabase Auth.
-- Cette migration est idempotente uniquement pour les donnÃƒÂ©es de rÃƒÂ©fÃƒÂ©rence.

create extension if not exists pgcrypto;
create extension if not exists pg_trgm;

create sequence if not exists public.customer_number_seq start with 1 increment by 1;
create sequence if not exists public.proforma_number_seq start with 1 increment by 1;
create sequence if not exists public.sale_number_seq start with 1 increment by 1;

create table public.roles (
  id uuid primary key default gen_random_uuid(),
  code text not null unique check (code ~ '^[a-z_]+$'),
  name text not null unique,
  description text,
  created_at timestamptz not null default now()
);

insert into public.roles (code, name, description) values
  ('administrator', 'ADMINISTRATEUR', 'Acces complet au systeme'),
  ('cashier', 'CAISSIER', 'Caisse, clients, produits, proformas et ses ventes')
on conflict (code) do update set name = excluded.name, description = excluded.description;

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text not null default '' check (char_length(full_name) <= 160),
  email text not null unique check (email ~* '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'),
  role_id uuid not null references public.roles(id) on delete restrict,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.categories (
  id uuid primary key default gen_random_uuid(),
  name text not null unique check (char_length(trim(name)) between 1 and 120),
  description text,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.suppliers (
  id uuid primary key default gen_random_uuid(),
  name text not null unique check (char_length(trim(name)) between 1 and 160),
  email text check (email is null or email ~* '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'),
  phone text,
  address text,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.customers (
  id uuid primary key default gen_random_uuid(),
  customer_number text not null unique default ('CL-' || lpad(nextval('public.customer_number_seq')::text, 6, '0')),
  full_name text not null check (char_length(trim(full_name)) between 1 and 160),
  email text check (email is null or email ~* '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'),
  phone text,
  address text,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.products (
  id uuid primary key default gen_random_uuid(),
  category_id uuid references public.categories(id) on delete set null,
  supplier_id uuid references public.suppliers(id) on delete set null,
  name text not null check (char_length(trim(name)) between 1 and 180),
  description text,
  barcode text unique check (barcode is null or char_length(trim(barcode)) between 1 and 80),
  cost_price numeric(14,2) not null default 0 check (cost_price >= 0),
  sale_price numeric(14,2) not null check (sale_price >= 0),
  stock_quantity numeric(14,3) not null default 0 check (stock_quantity >= 0),
  min_stock_quantity numeric(14,3) not null default 0 check (min_stock_quantity >= 0),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (category_id, name)
);

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
  created_by uuid not null default auth.uid() references public.profiles(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (valid_until is null or valid_until >= issue_date)
);

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
  created_by uuid not null default auth.uid() references public.profiles(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

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

create table public.payments (
  id uuid primary key default gen_random_uuid(),
  sale_id uuid not null references public.sales(id) on delete restrict,
  method text not null check (method in ('cash', 'card', 'mobile_money', 'bank_transfer', 'other')),
  amount numeric(14,2) not null check (amount > 0),
  reference text,
  received_by uuid not null default auth.uid() references public.profiles(id) on delete restrict,
  paid_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create table public.stock_movements (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.products(id) on delete restrict,
  movement_type text not null check (movement_type in ('in', 'out', 'adjustment_in', 'adjustment_out', 'return_in', 'return_out')),
  quantity numeric(14,3) not null check (quantity > 0),
  reference_type text,
  reference_id uuid,
  notes text,
  created_by uuid not null default auth.uid() references public.profiles(id) on delete restrict,
  created_at timestamptz not null default now()
);

create table public.expenses (
  id uuid primary key default gen_random_uuid(),
  label text not null check (char_length(trim(label)) between 1 and 180),
  amount numeric(14,2) not null check (amount > 0),
  expense_date date not null default current_date,
  notes text,
  created_by uuid not null default auth.uid() references public.profiles(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.cash_sessions (
  id uuid primary key default gen_random_uuid(),
  opened_by uuid not null default auth.uid() references public.profiles(id) on delete restrict,
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

create table public.settings (
  id uuid primary key default gen_random_uuid(),
  key text not null unique check (key ~ '^[a-z0-9_.-]+$'),
  value jsonb not null default '{}'::jsonb,
  description text,
  updated_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index customers_full_name_idx on public.customers using gin (full_name gin_trgm_ops);
create index customers_phone_idx on public.customers(phone) where phone is not null;
create unique index products_barcode_idx on public.products(barcode) where barcode is not null;
create index products_name_idx on public.products using gin (name gin_trgm_ops);
create index proformas_number_idx on public.proformas(proforma_number);
create index sales_number_idx on public.sales(sale_number);
create index stock_movements_product_created_idx on public.stock_movements(product_id, created_at desc);
create index sales_created_by_idx on public.sales(created_by, sold_at desc);
create index proformas_created_by_idx on public.proformas(created_by, created_at desc);

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

create or replace function public.handle_new_user() returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, full_name, email, role_id)
  values (new.id, coalesce(new.raw_user_meta_data ->> 'full_name', ''), new.email,
    (select id from public.roles where code = 'cashier'));
  return new;
end; $$;
create trigger on_auth_user_created after insert on auth.users for each row execute function public.handle_new_user();

create or replace function public.has_role(required_code text) returns boolean language sql stable security definer set search_path = public as $$
  select exists(select 1 from public.profiles p join public.roles r on r.id = p.role_id where p.id = auth.uid() and p.active and r.code = required_code);
$$;
create or replace function public.is_admin() returns boolean language sql stable security definer set search_path = public as $$ select public.has_role('administrator'); $$;

create or replace function public.apply_stock_movement() returns trigger language plpgsql security definer set search_path = public as $$
declare delta numeric(14,3);
begin
  delta := case when new.movement_type in ('in','adjustment_in','return_in') then new.quantity else -new.quantity end;
  update public.products set stock_quantity = stock_quantity + delta where id = new.product_id and stock_quantity + delta >= 0;
  if not found then raise exception 'Stock insuffisant ou produit introuvable'; end if;
  return new;
end; $$;
create trigger stock_movements_apply_stock before insert on public.stock_movements for each row execute function public.apply_stock_movement();

alter table public.roles enable row level security;
alter table public.profiles enable row level security;
alter table public.categories enable row level security;
alter table public.products enable row level security;
alter table public.suppliers enable row level security;
alter table public.customers enable row level security;
alter table public.stock_movements enable row level security;
alter table public.proformas enable row level security;
alter table public.proforma_items enable row level security;
alter table public.sales enable row level security;
alter table public.sale_items enable row level security;
alter table public.payments enable row level security;
alter table public.expenses enable row level security;
alter table public.cash_sessions enable row level security;
alter table public.settings enable row level security;

create policy "roles readable by authenticated" on public.roles for select to authenticated using (true);
create policy "roles managed by administrators" on public.roles for all to authenticated using (public.is_admin()) with check (public.is_admin());
create policy "profiles self or administrator read" on public.profiles for select to authenticated using (id = auth.uid() or public.is_admin());
create policy "profiles administrator manage" on public.profiles for all to authenticated using (public.is_admin()) with check (public.is_admin());
create policy "catalog read" on public.categories for select to authenticated using (true);
create policy "categories administrator manage" on public.categories for all to authenticated using (public.is_admin()) with check (public.is_admin());
create policy "products read" on public.products for select to authenticated using (true);
create policy "products administrator manage" on public.products for all to authenticated using (public.is_admin()) with check (public.is_admin());
create policy "suppliers administrator manage" on public.suppliers for all to authenticated using (public.is_admin()) with check (public.is_admin());
create policy "customers read by staff" on public.customers for select to authenticated using (true);
create policy "customers insert by staff" on public.customers for insert to authenticated with check (true);
create policy "customers update by staff" on public.customers for update to authenticated using (true) with check (true);
create policy "customers delete by administrators" on public.customers for delete to authenticated using (public.is_admin());
create policy "stock managed by administrators" on public.stock_movements for all to authenticated using (public.is_admin()) with check (public.is_admin());
create policy "proformas admin or owner read" on public.proformas for select to authenticated using (public.is_admin() or created_by = auth.uid());
create policy "proformas admin or owner insert" on public.proformas for insert to authenticated with check (public.is_admin() or created_by = auth.uid());
create policy "proformas admin or owner update" on public.proformas for update to authenticated using (public.is_admin() or created_by = auth.uid()) with check (public.is_admin() or created_by = auth.uid());
create policy "proformas administrator delete" on public.proformas for delete to authenticated using (public.is_admin());
create policy "proforma items by accessible proforma" on public.proforma_items for all to authenticated using (exists(select 1 from public.proformas p where p.id = proforma_id and (public.is_admin() or p.created_by = auth.uid()))) with check (exists(select 1 from public.proformas p where p.id = proforma_id and (public.is_admin() or p.created_by = auth.uid())));
create policy "sales admin or owner read" on public.sales for select to authenticated using (public.is_admin() or created_by = auth.uid());
create policy "sales admin or owner insert" on public.sales for insert to authenticated with check (public.is_admin() or created_by = auth.uid());
create policy "sales administrator update" on public.sales for update to authenticated using (public.is_admin()) with check (public.is_admin());
create policy "sales administrator delete" on public.sales for delete to authenticated using (public.is_admin());
create policy "sale items admin or owner read" on public.sale_items for select to authenticated using (exists(select 1 from public.sales s where s.id = sale_id and (public.is_admin() or s.created_by = auth.uid())));
create policy "sale items admin or owner insert" on public.sale_items for insert to authenticated with check (exists(select 1 from public.sales s where s.id = sale_id and (public.is_admin() or s.created_by = auth.uid())));
create policy "sale items administrator manage" on public.sale_items for update to authenticated using (public.is_admin()) with check (public.is_admin());
create policy "sale items administrator delete" on public.sale_items for delete to authenticated using (public.is_admin());
create policy "payments admin or owner read" on public.payments for select to authenticated using (exists(select 1 from public.sales s where s.id = sale_id and (public.is_admin() or s.created_by = auth.uid())));
create policy "payments admin or owner insert" on public.payments for insert to authenticated with check (exists(select 1 from public.sales s where s.id = sale_id and (public.is_admin() or s.created_by = auth.uid())));
create policy "payments administrator update" on public.payments for update to authenticated using (public.is_admin()) with check (public.is_admin());
create policy "payments administrator delete" on public.payments for delete to authenticated using (public.is_admin());
create policy "expenses administrator manage" on public.expenses for all to authenticated using (public.is_admin()) with check (public.is_admin());
create policy "cash sessions admin or owner read" on public.cash_sessions for select to authenticated using (public.is_admin() or opened_by = auth.uid());
create policy "cash sessions admin or owner insert" on public.cash_sessions for insert to authenticated with check (public.is_admin() or opened_by = auth.uid());
create policy "cash sessions admin or owner update" on public.cash_sessions for update to authenticated using (public.is_admin() or opened_by = auth.uid()) with check (public.is_admin() or opened_by = auth.uid());
create policy "cash sessions administrator delete" on public.cash_sessions for delete to authenticated using (public.is_admin());
create policy "settings administrator manage" on public.settings for all to authenticated using (public.is_admin()) with check (public.is_admin());
