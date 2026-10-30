-- Stock movements for the roles that manage the catalogue.
-- record_stock_movement only accepted administrators, while directors and stock
-- managers are the ones allowed to manage products (see the catalogue policies).
-- It also ran as the caller, whom the "direct writes denied" policy blocks from
-- inserting into stock_movements. It now checks the role itself and runs as
-- definer, so this function stays the only path that changes stock.
--
-- complete_sale() also stores the cashier's note on the sale, but no migration
-- created sales.notes, so every sale failed.

alter table public.sales add column if not exists notes text;

create or replace function public.record_stock_movement(
  p_product_id uuid, p_movement_type text, p_quantity numeric, p_reason text,
  p_supplier_id uuid default null, p_purchase_price numeric default null,
  p_reference_type text default null, p_reference_id uuid default null, p_movement_at timestamptz default now()
) returns public.stock_movements language plpgsql security definer set search_path = public as $$
declare result public.stock_movements;
begin
  if auth.uid() is null or not (public.is_admin() or public.has_role('director') or public.has_role('stock_manager')) then
    raise exception 'Permission refusée';
  end if;
  if p_movement_type not in ('entry', 'exit', 'adjustment', 'customer_return', 'supplier_return') then raise exception 'Type de mouvement invalide'; end if;
  if p_quantity = 0 then raise exception 'La quantité ne peut pas être nulle'; end if;
  if p_movement_type <> 'adjustment' and p_quantity < 0 then raise exception 'La quantité doit être positive'; end if;
  insert into public.stock_movements (product_id, movement_type, quantity, reason, supplier_id, purchase_price, reference_type, reference_id, movement_at, created_by)
  values (p_product_id, p_movement_type, p_quantity, nullif(trim(p_reason), ''), p_supplier_id, p_purchase_price, p_reference_type, p_reference_id, p_movement_at, auth.uid())
  returning * into result;
  return result;
end;
$$;

revoke all on function public.record_stock_movement(uuid, text, numeric, text, uuid, numeric, text, uuid, timestamptz) from public;
grant execute on function public.record_stock_movement(uuid, text, numeric, text, uuid, numeric, text, uuid, timestamptz) to authenticated;
