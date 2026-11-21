-- Étape 7 : unités de mesure, catégories de fournisseurs, contrôle des doublons
-- et droits de l'administrateur sur le catalogue.

-- Same rule as the local server: director, administrator and stock manager.
create or replace function public.can_manage_catalog() returns boolean language sql stable security definer set search_path = public as $$
  select public.has_role('director') or public.has_role('administrator') or public.has_role('stock_manager');
$$;
revoke all on function public.can_manage_catalog() from public, anon;
grant execute on function public.can_manage_catalog() to authenticated;

-- Comparison key for duplicates: case and repeated spaces are ignored.
create or replace function public.catalog_key(p_value text) returns text language sql immutable set search_path = public as $$
  select lower(regexp_replace(trim(coalesce(p_value, '')), '\s+', ' ', 'g'));
$$;
grant execute on function public.catalog_key(text) to authenticated;

create or replace function public.clean_catalog_name(p_value text) returns text language sql immutable set search_path = public as $$
  select regexp_replace(trim(coalesce(p_value, '')), '\s+', ' ', 'g');
$$;
grant execute on function public.clean_catalog_name(text) to authenticated;

-- ============================================
-- Unités de mesure
-- ============================================
create table if not exists public.units (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(trim(name)) between 1 and 40),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists units_name_key on public.units (public.catalog_key(name));
drop trigger if exists units_set_updated_at on public.units;
create trigger units_set_updated_at before update on public.units for each row execute function public.set_updated_at();
alter table public.units enable row level security;
drop policy if exists "units read" on public.units;
create policy "units read" on public.units for select to authenticated using (true);
drop policy if exists "units manage" on public.units;
create policy "units manage" on public.units for all to authenticated using (public.can_manage_catalog()) with check (public.can_manage_catalog());

insert into public.units (name)
select name from unnest(array['unité', 'pièce', 'sac', 'kg', 'lb', 'litre', 'gallon', 'marmite', 'boîte', 'paquet', 'douzaine', 'bouteille', 'mètre']) as name
on conflict do nothing;
-- Units already used by products stay valid.
insert into public.units (name)
select distinct public.clean_catalog_name(unit) from public.products where public.clean_catalog_name(unit) <> ''
on conflict do nothing;

-- ============================================
-- Catégories de fournisseurs
-- ============================================
create table if not exists public.supplier_categories (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(trim(name)) between 1 and 80),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists supplier_categories_name_key on public.supplier_categories (public.catalog_key(name));
drop trigger if exists supplier_categories_set_updated_at on public.supplier_categories;
create trigger supplier_categories_set_updated_at before update on public.supplier_categories for each row execute function public.set_updated_at();
alter table public.supplier_categories enable row level security;
drop policy if exists "supplier categories read" on public.supplier_categories;
create policy "supplier categories read" on public.supplier_categories for select to authenticated using (true);
drop policy if exists "supplier categories manage" on public.supplier_categories;
create policy "supplier categories manage" on public.supplier_categories for all to authenticated using (public.can_manage_catalog()) with check (public.can_manage_catalog());

insert into public.supplier_categories (name)
select name from unnest(array['Producteurs locaux', 'Grossistes', 'Importateurs', 'Transport et services']) as name
on conflict do nothing;

alter table public.suppliers add column if not exists category_id uuid references public.supplier_categories(id) on delete set null;
create index if not exists suppliers_category_idx on public.suppliers(category_id);

-- Simple lists: names are cleaned before the unique index compares them.
create or replace function public.clean_list_name() returns trigger language plpgsql set search_path = public as $$
begin
  new.name := public.clean_catalog_name(new.name);
  return new;
end $$;
drop trigger if exists units_clean_name on public.units;
create trigger units_clean_name before insert or update of name on public.units for each row execute function public.clean_list_name();
drop trigger if exists supplier_categories_clean_name on public.supplier_categories;
create trigger supplier_categories_clean_name before insert or update of name on public.supplier_categories for each row execute function public.clean_list_name();

-- ============================================
-- Doublons : produits et fournisseurs
-- ============================================
-- Checked when a name or barcode is created or changed, so duplicates that
-- may already exist do not block this migration or unrelated updates.
create index if not exists products_catalog_key_idx on public.products (public.catalog_key(name));
create index if not exists suppliers_catalog_key_idx on public.suppliers (public.catalog_key(name));

create or replace function public.check_product_catalog() returns trigger language plpgsql set search_path = public as $$
declare
  v_other record;
  v_unit text;
begin
  new.name := public.clean_catalog_name(new.name);
  new.barcode := nullif(trim(coalesce(new.barcode, '')), '');
  if tg_op = 'INSERT' or public.catalog_key(new.name) is distinct from public.catalog_key(old.name) then
    select name, active into v_other from public.products where public.catalog_key(name) = public.catalog_key(new.name) and id <> new.id limit 1;
    if found then
      raise exception 'Un produit nommé « % » existe déjà%.', v_other.name, case when v_other.active then '' else ' (inactif : réactivez-le plutôt)' end using errcode = '23505';
    end if;
  end if;
  if new.barcode is not null and (tg_op = 'INSERT' or new.barcode is distinct from old.barcode) then
    select name into v_other from public.products where barcode = new.barcode and id <> new.id limit 1;
    if found then raise exception 'Le code-barres % est déjà utilisé par « % ».', new.barcode, v_other.name using errcode = '23505'; end if;
  end if;
  if tg_op = 'INSERT' or new.unit is distinct from old.unit then
    select name into v_unit from public.units where public.catalog_key(name) = public.catalog_key(new.unit) and active;
    if not found then raise exception 'Unité « % » inconnue : ajoutez-la d’abord à la liste des unités.', new.unit; end if;
    new.unit := v_unit;
  end if;
  return new;
end $$;
drop trigger if exists products_check_catalog on public.products;
create trigger products_check_catalog before insert or update of name, barcode, unit on public.products for each row execute function public.check_product_catalog();

create or replace function public.check_supplier_catalog() returns trigger language plpgsql set search_path = public as $$
declare v_other record;
begin
  new.name := public.clean_catalog_name(new.name);
  if tg_op = 'INSERT' or public.catalog_key(new.name) is distinct from public.catalog_key(old.name) then
    select name, active into v_other from public.suppliers where public.catalog_key(name) = public.catalog_key(new.name) and id <> new.id limit 1;
    if found then
      raise exception 'Un fournisseur nommé « % » existe déjà%.', v_other.name, case when v_other.active then '' else ' (inactif : réactivez-le plutôt)' end using errcode = '23505';
    end if;
  end if;
  return new;
end $$;
drop trigger if exists suppliers_check_catalog on public.suppliers;
create trigger suppliers_check_catalog before insert or update of name on public.suppliers for each row execute function public.check_supplier_catalog();

-- ============================================
-- Droits : l'administrateur gère aussi le catalogue
-- ============================================
drop policy if exists "categories manage by director and stock_manager" on public.categories;
drop policy if exists "categories manage by catalog staff" on public.categories;
create policy "categories manage by catalog staff" on public.categories for all to authenticated using (public.can_manage_catalog()) with check (public.can_manage_catalog());

drop policy if exists "products manage by director and stock_manager" on public.products;
drop policy if exists "products update by director and stock_manager" on public.products;
drop policy if exists "products deactivate by director" on public.products;
drop policy if exists "products insert by catalog staff" on public.products;
drop policy if exists "products update by catalog staff" on public.products;
create policy "products insert by catalog staff" on public.products for insert to authenticated with check (public.can_manage_catalog());
create policy "products update by catalog staff" on public.products for update to authenticated using (public.can_manage_catalog()) with check (public.can_manage_catalog());

drop policy if exists "suppliers manage by director and stock_manager" on public.suppliers;
drop policy if exists "suppliers manage by catalog staff" on public.suppliers;
create policy "suppliers manage by catalog staff" on public.suppliers for all to authenticated using (public.can_manage_catalog()) with check (public.can_manage_catalog());

drop policy if exists "stock_movements read by director and stock_manager" on public.stock_movements;
drop policy if exists "stock movements read by catalog staff" on public.stock_movements;
create policy "stock movements read by catalog staff" on public.stock_movements for select to authenticated using (public.can_manage_catalog());
