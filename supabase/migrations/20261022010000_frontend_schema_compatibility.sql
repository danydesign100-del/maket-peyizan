-- Compatibility layer for the existing React POS. Additive only.
create table if not exists public.roles (id uuid primary key default gen_random_uuid(), code text unique not null, name text not null, description text);
insert into public.roles(code,name,description) values
 ('director','DIRECTEUR','Propriétaire ou superviseur'),('accountant','COMPTABLE','Comptabilité'),('cashier','CAISSIÈRE','Caisse'),('stock_manager','GESTIONNAIRE STOCK','Stock'),('administrator','ADMINISTRATEUR','Administration')
on conflict (code) do nothing;
create table if not exists public.profiles (id uuid primary key references auth.users(id) on delete cascade, full_name text not null default '', email text not null default '', role_id uuid references public.roles(id), active boolean not null default true, created_at timestamptz not null default now(), updated_at timestamptz not null default now());
insert into public.profiles(id,full_name,email,role_id,active)
select up.id, up.full_name, coalesce(u.email,''), (select id from public.roles where code = case when up.role in ('owner','admin','responsable') then 'director' when up.role = 'accountant' then 'accountant' when up.role = 'stock_manager' then 'stock_manager' else 'cashier' end), up.is_active
from public.user_profiles up join auth.users u on u.id=up.id on conflict (id) do update set full_name=excluded.full_name, email=excluded.email, role_id=excluded.role_id, active=excluded.active;

create table if not exists public.suppliers (id uuid primary key default gen_random_uuid(), name text not null, active boolean not null default true, phone text, email text, address text, created_at timestamptz not null default now(), updated_at timestamptz not null default now());
alter table public.categories add column if not exists active boolean not null default true;
alter table public.products add column if not exists active boolean not null default true;
alter table public.products add column if not exists minimum_stock numeric(14,3) not null default 0;
alter table public.products add column if not exists purchase_price numeric(14,2) not null default 0;
alter table public.products add column if not exists brand text;
alter table public.products add column if not exists supplier_id uuid references public.suppliers(id) on delete set null;
alter table public.products add column if not exists proforma_price numeric(14,2) not null default 0;
alter table public.products add column if not exists image_url text;
update public.products set active=is_active, minimum_stock=min_stock_quantity, purchase_price=cost_price where active is distinct from is_active or minimum_stock is distinct from min_stock_quantity or purchase_price is distinct from cost_price;
alter table public.customers add column if not exists active boolean not null default true;
alter table public.customers add column if not exists customer_number text;
update public.customers set customer_number=coalesce(customer_number, 'CL-' || substr(id::text,1,8)) where customer_number is null;
create unique index if not exists customers_customer_number_key on public.customers(customer_number) where customer_number is not null;

alter table public.sales add column if not exists sold_at timestamptz not null default now();
alter table public.sales add column if not exists sale_number text;
alter table public.sales add column if not exists created_by uuid references public.profiles(id) on delete set null;
update public.sales set sold_at=occurred_at where sold_at is null;
update public.sales set created_by=cashier_id where created_by is null;
update public.sales set sale_number=coalesce(receipt_number, 'VTE-' || substr(id::text,1,8)) where sale_number is null;
create unique index if not exists sales_sale_number_key on public.sales(sale_number) where sale_number is not null;

alter table public.cash_sessions add column if not exists created_at timestamptz not null default now();
alter table public.cash_sessions add column if not exists updated_at timestamptz not null default now();

create table if not exists public.proformas (id uuid primary key default gen_random_uuid(), proforma_number text not null unique default ('PF-' || substr(gen_random_uuid()::text,1,8)), customer_id uuid references public.customers(id) on delete set null, valid_until date, notes text, subtotal numeric(14,2) not null default 0, discount_amount numeric(14,2) not null default 0, tax_amount numeric(14,2) not null default 0, total_amount numeric(14,2) not null default 0, status text not null default 'draft', created_by uuid references public.profiles(id), created_at timestamptz not null default now(), updated_at timestamptz not null default now());
create table if not exists public.proforma_items (id uuid primary key default gen_random_uuid(), proforma_id uuid not null references public.proformas(id) on delete cascade, product_id uuid references public.products(id), description text not null, quantity numeric(14,3) not null, unit_price numeric(14,2) not null, discount_amount numeric(14,2) not null default 0, tax_amount numeric(14,2) not null default 0, line_total numeric(14,2) not null, created_at timestamptz not null default now());

notify pgrst, 'reload schema';
