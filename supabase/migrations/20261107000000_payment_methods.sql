-- Étape 8 : modes de paiement MonCash, NatCash et chèque.
-- Until now the app sent MonCash/NatCash as 'mobile_money' and cheques as
-- 'other', keeping the real method as a prefix of the reference
-- ('moncash:MC-5555'). The methods are now stored as such, so that reports
-- separate MonCash from NatCash and a transaction ID can be checked for reuse.
-- Accounts are unchanged (105000 and 103000), so posted entries stay valid.

alter table public.payments drop constraint if exists payments_method_check;
alter table public.payments add constraint payments_method_check
  check (method in ('cash', 'card', 'moncash', 'natcash', 'mobile_money', 'bank_transfer', 'check', 'other'));
-- Existing payments: restore the method kept in the reference prefix.
update public.payments
set method = split_part(reference, ':', 1),
    reference = nullif(trim(substr(reference, length(split_part(reference, ':', 1)) + 2)), '')
where method in ('mobile_money', 'other') and reference ~ '^(moncash|natcash|check):';

create index if not exists payments_method_reference_idx on public.payments (method, lower(trim(reference))) where reference is not null;

create or replace function public.payment_account_id(p_method text) returns uuid
language sql stable security definer set search_path = public as $$
  select public.account_id_by_code(case p_method
    when 'cash' then '101000'
    when 'card' then '102000'
    when 'bank_transfer' then '102000'
    when 'moncash' then '105000'
    when 'natcash' then '105000'
    when 'mobile_money' then '105000'
    when 'check' then '103000'
    else '103000' end);
$$;

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
  v_cash numeric(14,2) := 0;
  v_change numeric(14,2);
  v_kept numeric(14,2);
  v_used text;
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
    if v_payment.method not in ('cash', 'card', 'moncash', 'natcash', 'mobile_money', 'bank_transfer', 'check', 'other') or v_payment.amount is null or v_payment.amount <= 0 then raise exception 'Invalid payment'; end if;
    -- Mobile money is entered by hand: the transaction ID is required and can be used only once.
    if v_payment.method in ('moncash', 'natcash') then
      if nullif(trim(coalesce(v_payment.reference, '')), '') is null then
        raise exception 'Référence de transaction % obligatoire', case v_payment.method when 'moncash' then 'MonCash' else 'NatCash' end;
      end if;
      select s.sale_number into v_used from public.payments p join public.sales s on s.id = p.sale_id
      where p.method = v_payment.method and lower(trim(p.reference)) = lower(trim(v_payment.reference)) limit 1;
      if found then
        raise exception 'Référence % % déjà utilisée pour la vente %', case v_payment.method when 'moncash' then 'MonCash' else 'NatCash' end, trim(v_payment.reference), v_used;
      end if;
    end if;
    v_paid := v_paid + v_payment.amount;
    if v_payment.method = 'cash' then v_cash := v_cash + v_payment.amount; end if;
  end loop;
  -- Cash may exceed the total: the difference is change handed back, at most the cash tendered.
  v_change := round(v_paid - v_total, 2);
  if v_change < -0.01 or v_change > v_cash + 0.01 then raise exception 'Payment total does not match sale total'; end if;
  v_change := greatest(v_change, 0);

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
    -- Record the cash actually kept, not the amount tendered.
    v_kept := v_payment.amount;
    if v_payment.method = 'cash' and v_change > 0 then v_kept := v_payment.amount - least(v_payment.amount, v_change); v_change := v_change - (v_payment.amount - v_kept); end if;
    if v_kept > 0 then
      insert into public.payments (sale_id, method, amount, reference, received_by)
      values (v_sale.id, v_payment.method, v_kept, nullif(trim(v_payment.reference), ''), auth.uid());
    end if;
  end loop;
  return v_sale;
end; $$;

revoke all on function public.complete_sale(uuid, jsonb, jsonb, text) from public, anon;
grant execute on function public.complete_sale(uuid, jsonb, jsonb, text) to authenticated;

-- Lets the cash register warn at once (before the sale is queued) when a mobile
-- money ID was already used; only the sale number is returned.
create or replace function public.payment_reference_used(p_method text, p_reference text) returns text
language sql stable security definer set search_path = public as $$
  select s.sale_number from public.payments p join public.sales s on s.id = p.sale_id
  where auth.uid() is not null and p.method = p_method and nullif(trim(coalesce(p_reference, '')), '') is not null
    and lower(trim(p.reference)) = lower(trim(p_reference))
  limit 1;
$$;
revoke all on function public.payment_reference_used(text, text) from public, anon;
grant execute on function public.payment_reference_used(text, text) to authenticated;
