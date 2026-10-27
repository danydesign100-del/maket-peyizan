-- Baseline compatibility for the existing Maket Peyizan Supabase schema.
-- Additive only: it protects first-owner setup and supplies the atomic,
-- idempotent sale RPC used by the browser's offline queue.

create unique index if not exists sales_local_uuid_key
  on public.sales(local_uuid) where local_uuid is not null;

create or replace function public.is_initial_setup_complete()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.user_profiles where role in ('owner', 'admin') and is_active);
$$;

create or replace function public.create_first_admin_user(user_uuid uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null or auth.uid() <> user_uuid then
    raise exception 'You can only initialize your own account';
  end if;
  if public.is_initial_setup_complete() then
    raise exception 'Initial owner already exists';
  end if;
  if not exists (select 1 from auth.users where id = user_uuid) then
    raise exception 'User not found';
  end if;
  insert into public.user_profiles (id, full_name, role, is_active)
  select id, coalesce(raw_user_meta_data ->> 'full_name', email, 'Administrateur'), 'owner', true
  from auth.users where id = user_uuid
  on conflict (id) do update set role = 'owner', is_active = true;
  return jsonb_build_object('success', true, 'message', 'Owner initialized');
end;
$$;

create or replace function public.complete_offline_sale(
  p_client_sale_id uuid,
  p_customer_id uuid,
  p_items jsonb,
  p_payments jsonb,
  p_notes text default null
) returns public.sales language plpgsql security definer set search_path = public as $$
declare
  v_sale public.sales; v_product public.products; v_item record; v_payment record;
  v_subtotal numeric(14,2) := 0; v_discount numeric(14,2) := 0; v_tax numeric(14,2) := 0;
  v_total numeric(14,2); v_paid numeric(14,2) := 0; v_role text;
begin
  select role into v_role from public.user_profiles where id = auth.uid() and is_active;
  if auth.uid() is null or v_role not in ('owner', 'admin', 'responsable', 'cashier') then raise exception 'Permission denied'; end if;
  if p_client_sale_id is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then raise exception 'Invalid sale'; end if;
  if jsonb_typeof(p_payments) <> 'array' or jsonb_array_length(p_payments) = 0 then raise exception 'Payment required'; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_client_sale_id::text, 0));
  select * into v_sale from public.sales where local_uuid = p_client_sale_id;
  if found then return v_sale; end if;
  if p_customer_id is not null and not exists (select 1 from public.customers where id = p_customer_id) then raise exception 'Customer unavailable'; end if;

  for v_item in select product_id, sum(quantity) quantity, sum(discount_amount) discount_amount, sum(tax_amount) tax_amount
    from jsonb_to_recordset(p_items) as x(product_id uuid, quantity numeric, discount_amount numeric, tax_amount numeric)
    group by product_id order by product_id loop
    if v_item.product_id is null or v_item.quantity <= 0 or coalesce(v_item.discount_amount, 0) < 0 or coalesce(v_item.tax_amount, 0) < 0 then raise exception 'Invalid sale item'; end if;
    select * into v_product from public.products where id = v_item.product_id and is_active for update;
    if not found then raise exception 'Product unavailable'; end if;
    if v_product.stock_quantity < v_item.quantity then raise exception 'Insufficient stock for %', v_product.name; end if;
    if v_item.discount_amount > v_item.quantity * v_product.selling_price then raise exception 'Invalid discount'; end if;
    v_subtotal := v_subtotal + v_item.quantity * v_product.selling_price;
    v_discount := v_discount + coalesce(v_item.discount_amount, 0); v_tax := v_tax + coalesce(v_item.tax_amount, 0);
  end loop;
  v_total := v_subtotal - v_discount + v_tax;
  for v_payment in select * from jsonb_to_recordset(p_payments) as x(method text, amount numeric, reference text) loop
    if v_payment.method not in ('cash', 'card', 'mobile_money', 'bank_transfer', 'other') or v_payment.amount is null or v_payment.amount <= 0 then raise exception 'Invalid payment'; end if;
    v_paid := v_paid + v_payment.amount;
  end loop;
  if abs(v_paid - v_total) > 0.01 then raise exception 'Payment total does not match sale total'; end if;
  insert into public.sales(local_uuid, customer_id, cashier_id, notes, subtotal, discount_amount, tax_amount, total_amount, status, synced_at)
  values (p_client_sale_id, p_customer_id, auth.uid(), nullif(trim(p_notes), ''), v_subtotal, v_discount, v_tax, v_total, 'completed', now()) returning * into v_sale;
  for v_item in select product_id, sum(quantity) quantity, sum(discount_amount) discount_amount, sum(tax_amount) tax_amount
    from jsonb_to_recordset(p_items) as x(product_id uuid, quantity numeric, discount_amount numeric, tax_amount numeric)
    group by product_id order by product_id loop
    select * into v_product from public.products where id = v_item.product_id for update;
    update public.products set stock_quantity = stock_quantity - v_item.quantity, updated_at = now() where id = v_product.id and stock_quantity >= v_item.quantity;
    if not found then raise exception 'Stock changed while processing sale'; end if;
    insert into public.sale_items(local_uuid, sale_id, product_id, product_name_snapshot, sku_snapshot, quantity, unit_price, unit_cost, discount_amount, line_total)
    values (gen_random_uuid(), v_sale.id, v_product.id, v_product.name, v_product.sku, v_item.quantity, v_product.selling_price, v_product.cost_price, coalesce(v_item.discount_amount, 0), v_item.quantity * v_product.selling_price - coalesce(v_item.discount_amount, 0) + coalesce(v_item.tax_amount, 0));
    insert into public.stock_movements(local_uuid, product_id, movement_type, quantity_change, note, reference_type, reference_id, created_by)
    values (gen_random_uuid(), v_product.id, 'sale', -v_item.quantity, 'Sale', 'sale', v_sale.id, auth.uid());
  end loop;
  for v_payment in select * from jsonb_to_recordset(p_payments) as x(method text, amount numeric, reference text) loop
    insert into public.payments(local_uuid, sale_id, method, amount, reference, received_by, status)
    values (gen_random_uuid(), v_sale.id, v_payment.method, v_payment.amount, nullif(trim(v_payment.reference), ''), auth.uid(), 'recorded');
  end loop;
  return v_sale;
end;
$$;

revoke all on function public.create_first_admin_user(uuid) from public;
grant execute on function public.create_first_admin_user(uuid) to authenticated;
revoke all on function public.complete_offline_sale(uuid, uuid, jsonb, jsonb, text) from public;
grant execute on function public.complete_offline_sale(uuid, uuid, jsonb, jsonb, text) to authenticated;
grant execute on function public.is_initial_setup_complete() to anon, authenticated;
