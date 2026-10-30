-- Atomic POS sale: the browser never determines persisted prices or totals.

create or replace function public.apply_stock_movement() returns trigger language plpgsql security definer set search_path = public as $$
declare current_stock numeric(14,3); delta numeric(14,3);
begin
  select stock_quantity into current_stock from public.products where id = new.product_id for update;
  if current_stock is null then raise exception 'Product not found'; end if;
  -- RAISE is a statement, not an expression, so it cannot sit inside CASE.
  if new.movement_type in ('entry', 'customer_return', 'adjustment') then delta := new.quantity;
  elsif new.movement_type in ('exit', 'supplier_return') then delta := -new.quantity;
  else raise exception 'Invalid movement type';
  end if;
  if new.movement_type <> 'adjustment' and new.quantity <= 0 then raise exception 'Quantity must be positive'; end if;
  if new.movement_type = 'adjustment' and new.quantity = 0 then raise exception 'Adjustment cannot be zero'; end if;
  if current_stock + delta < 0 then raise exception 'Insufficient stock'; end if;
  new.old_stock := current_stock;
  new.new_stock := current_stock + delta;
  perform set_config('pos.stock_movement', 'true', true);
  update public.products set stock_quantity = new.new_stock where id = new.product_id;
  return new;
end; $$;

-- The former implementation used post-movement stock and counted the receipt twice.
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

create or replace function public.complete_sale(
  p_customer_id uuid,
  p_items jsonb,
  p_payments jsonb,
  p_notes text default null
) returns public.sales language plpgsql security definer set search_path = public as $$
declare
  v_sale public.sales;
  v_product public.products;
  v_item record;
  v_payment record;
  v_subtotal numeric(14,2) := 0;
  v_discount numeric(14,2) := 0;
  v_tax numeric(14,2) := 0;
  v_total numeric(14,2);
  v_paid numeric(14,2) := 0;
begin
  if auth.uid() is null or not (public.has_role('cashier') or public.has_role('director')) then raise exception 'Permission denied'; end if;
  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then raise exception 'Cart is empty'; end if;
  if jsonb_typeof(p_payments) <> 'array' or jsonb_array_length(p_payments) = 0 then raise exception 'Payment required'; end if;
  if not exists (select 1 from public.cash_sessions where opened_by = auth.uid() and closed_at is null) then raise exception 'Open a cash session first'; end if;
  if p_customer_id is not null and not exists (select 1 from public.customers where id = p_customer_id and active) then raise exception 'Customer unavailable'; end if;

  for v_item in
    select product_id, sum(quantity) quantity, sum(discount_amount) discount_amount, sum(tax_amount) tax_amount
    from jsonb_to_recordset(p_items) as x(product_id uuid, quantity numeric, discount_amount numeric, tax_amount numeric)
    group by product_id order by product_id
  loop
    if v_item.product_id is null or v_item.quantity is null or v_item.quantity <= 0 or coalesce(v_item.discount_amount, 0) < 0 or coalesce(v_item.tax_amount, 0) < 0 then raise exception 'Invalid sale item'; end if;
    select * into v_product from public.products where id = v_item.product_id and active for update;
    if not found then raise exception 'Product unavailable'; end if;
    if v_item.discount_amount > v_item.quantity * v_product.selling_price then raise exception 'Invalid discount'; end if;
    if v_product.stock_quantity < v_item.quantity then raise exception 'Insufficient stock for %', v_product.name; end if;
    v_subtotal := v_subtotal + v_item.quantity * v_product.selling_price;
    v_discount := v_discount + coalesce(v_item.discount_amount, 0);
    v_tax := v_tax + coalesce(v_item.tax_amount, 0);
  end loop;
  v_total := v_subtotal - v_discount + v_tax;

  for v_payment in select * from jsonb_to_recordset(p_payments) as x(method text, amount numeric, reference text) loop
    if v_payment.method not in ('cash', 'card', 'mobile_money', 'bank_transfer', 'other') or v_payment.amount is null or v_payment.amount <= 0 then raise exception 'Invalid payment'; end if;
    v_paid := v_paid + v_payment.amount;
  end loop;
  if abs(v_paid - v_total) > 0.01 then raise exception 'Payment total does not match sale total'; end if;

  insert into public.sales (customer_id, subtotal, discount_amount, tax_amount, total_amount, notes, status, created_by)
  values (p_customer_id, v_subtotal, v_discount, v_tax, v_total, nullif(trim(p_notes), ''), 'completed', auth.uid()) returning * into v_sale;
  for v_item in
    select product_id, sum(quantity) quantity, sum(discount_amount) discount_amount, sum(tax_amount) tax_amount
    from jsonb_to_recordset(p_items) as x(product_id uuid, quantity numeric, discount_amount numeric, tax_amount numeric)
    group by product_id order by product_id
  loop
    select * into v_product from public.products where id = v_item.product_id for update;
    insert into public.sale_items (sale_id, product_id, description, quantity, unit_price, discount_amount, tax_amount, line_total)
    values (v_sale.id, v_product.id, v_product.name, v_item.quantity, v_product.selling_price, coalesce(v_item.discount_amount, 0), coalesce(v_item.tax_amount, 0), v_item.quantity * v_product.selling_price - coalesce(v_item.discount_amount, 0) + coalesce(v_item.tax_amount, 0));
    insert into public.stock_movements (product_id, movement_type, quantity, reason, reference_type, reference_id, created_by)
    values (v_product.id, 'exit', v_item.quantity, 'Sale ' || v_sale.sale_number, 'sale', v_sale.id, auth.uid());
  end loop;
  for v_payment in select * from jsonb_to_recordset(p_payments) as x(method text, amount numeric, reference text) loop
    insert into public.payments (sale_id, method, amount, reference, received_by)
    values (v_sale.id, v_payment.method, v_payment.amount, nullif(trim(v_payment.reference), ''), auth.uid());
  end loop;
  return v_sale;
end; $$;

revoke all on function public.complete_sale(uuid, jsonb, jsonb, text) from public;
grant execute on function public.complete_sale(uuid, jsonb, jsonb, text) to authenticated;
