-- Étape 4 : fournisseurs et stock atomique.
alter table public.suppliers
  add column company_name text,
  add column tax_id text,
  add column notes text;

alter table public.stock_movements
  add column reason text,
  add column old_stock numeric(14,3),
  add column new_stock numeric(14,3),
  add column supplier_id uuid references public.suppliers(id) on delete set null,
  add column purchase_price numeric(14,2) check (purchase_price is null or purchase_price >= 0),
  add column movement_at timestamptz not null default now();

alter table public.stock_movements drop constraint stock_movements_movement_type_check;
alter table public.stock_movements add constraint stock_movements_movement_type_check check (movement_type in ('entry', 'exit', 'adjustment', 'customer_return', 'supplier_return'));
alter table public.stock_movements add constraint stock_movements_reason_required check (movement_type = 'entry' or nullif(trim(coalesce(reason, '')), '') is not null);
alter table public.stock_movements alter column created_by set default auth.uid();

create index if not exists stock_movements_supplier_idx on public.stock_movements(supplier_id);
create index if not exists stock_movements_type_created_idx on public.stock_movements(movement_type, movement_at desc);
create index if not exists stock_movements_product_created_idx2 on public.stock_movements(product_id, movement_at desc);

-- Une insertion de mouvement est le seul chemin qui modifie le stock.
create or replace function public.apply_stock_movement() returns trigger language plpgsql security definer set search_path = public as $$
declare current_stock numeric(14,3); delta numeric(14,3);
begin
  select stock_quantity into current_stock from public.products where id = new.product_id for update;
  if current_stock is null then raise exception 'Produit introuvable'; end if;
  delta := case when new.movement_type in ('entry','customer_return') then new.quantity when new.movement_type = 'supplier_return' then -new.quantity else new.quantity end;
  -- adjustment reçoit un delta signé depuis la RPC ; les autres quantités restent positives.
  if new.movement_type <> 'adjustment' and new.quantity <= 0 then raise exception 'La quantité doit être strictement positive'; end if;
  if new.movement_type = 'adjustment' and new.quantity = 0 then raise exception 'L’ajustement ne peut pas être nul'; end if;
  if current_stock + delta < 0 then raise exception 'Stock insuffisant'; end if;
  new.old_stock := current_stock; new.new_stock := current_stock + delta;
  perform set_config('pos.stock_movement', 'true', true);
  update public.products set stock_quantity = new.new_stock, purchase_price = coalesce(new.purchase_price, purchase_price) where id = new.product_id;
  return new;
end; $$;

create or replace function public.prevent_direct_stock_change() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' and new.stock_quantity <> 0 then raise exception 'Le stock initial doit être créé par un mouvement'; end if;
  if tg_op = 'UPDATE' and new.stock_quantity is distinct from old.stock_quantity and coalesce(current_setting('pos.stock_movement', true), '') <> 'true' then
    raise exception 'Le stock ne peut être modifié que par un mouvement';
  end if;
  return new;
end; $$;
create trigger products_prevent_direct_stock_change before insert or update of stock_quantity on public.products for each row execute function public.prevent_direct_stock_change();

create or replace function public.record_stock_movement(
  p_product_id uuid, p_movement_type text, p_quantity numeric, p_reason text,
  p_supplier_id uuid default null, p_purchase_price numeric default null,
  p_reference_type text default null, p_reference_id uuid default null, p_movement_at timestamptz default now()
) returns public.stock_movements language plpgsql security invoker set search_path = public as $$
declare result public.stock_movements;
begin
  if not public.is_admin() then raise exception 'Permission refusée'; end if;
  if p_movement_type not in ('entry','exit','adjustment','customer_return','supplier_return') then raise exception 'Type de mouvement invalide'; end if;
  if p_quantity = 0 then raise exception 'La quantité ne peut pas être nulle'; end if;
  if p_movement_type <> 'adjustment' and p_quantity < 0 then raise exception 'La quantité doit être positive'; end if;
  insert into public.stock_movements (product_id, movement_type, quantity, reason, supplier_id, purchase_price, reference_type, reference_id, movement_at, created_by)
  values (p_product_id, p_movement_type, p_quantity, nullif(trim(p_reason), ''), p_supplier_id, p_purchase_price, p_reference_type, p_reference_id, p_movement_at, auth.uid()) returning * into result;
  return result;
end; $$;
revoke all on function public.record_stock_movement(uuid, text, numeric, text, uuid, numeric, text, uuid, timestamptz) from public;
grant execute on function public.record_stock_movement(uuid, text, numeric, text, uuid, numeric, text, uuid, timestamptz) to authenticated;

-- RLS : lecture autorisée aux employés, toutes les écritures de mouvements passent par la RPC administrateur.
drop policy if exists "stock managed by administrators" on public.stock_movements;
create policy "stock movements readable by authenticated" on public.stock_movements for select to authenticated using (true);
create policy "stock movements direct writes denied" on public.stock_movements for insert to authenticated with check (false);
create policy "stock movements direct updates denied" on public.stock_movements for update to authenticated using (false);
create policy "stock movements direct deletes denied" on public.stock_movements for delete to authenticated using (false);

create policy "suppliers readable by authenticated" on public.suppliers for select to authenticated using (true);
-- Already created by the foundation migration: recreate it instead of failing.
drop policy if exists "suppliers administrator manage" on public.suppliers;
create policy "suppliers administrator manage" on public.suppliers for all to authenticated using (public.is_admin()) with check (public.is_admin());
