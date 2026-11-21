-- Automatic journal entries for sales, cancellations/returns and expenses (step 5).
-- Rules (to be confirmed by the client):
--   sale:   D cash/bank/mobile money (by payment) + D 409000 discounts
--           = C 401000 gross sales + C 210000 VAT collected;
--           D 501000 cost of goods sold / C 120000 stock, at weighted average cost
--   cancellation or return: D 408000 net sales + D 210000 VAT = C payment accounts;
--           cost reversed (goods back in stock)
--   expense: D chosen expense account / C chosen payment account
-- Every entry is linked to its source (reference_type, reference_id) and cannot be
-- duplicated. A failing generation never blocks the sale: the error is stored and
-- the entry can be generated later (journalize_pending).

-- Accounts used by the rules.
insert into public.accounts (code, name, account_type, nature, term, description) values
  ('105000', 'Monnaie électronique (MonCash, NatCash)', 'asset', 'debit', 'short', 'Encaissements par portefeuille mobile')
on conflict (code) do nothing;
insert into public.accounts (code, name, account_type, nature, statement_group, description) values
  ('518000', 'Autres charges d''exploitation', 'expense', 'debit', 'expense', 'Dépenses courantes sans compte plus précis')
on conflict (code) do nothing;

create or replace function public.account_id_by_code(p_code text) returns uuid
language plpgsql stable security definer set search_path = public as $$
declare v_id uuid;
begin
  select id into v_id from public.accounts where code = p_code;
  if v_id is null then raise exception 'Compte % introuvable dans le plan comptable', p_code; end if;
  return v_id;
end;
$$;

create or replace function public.payment_account_id(p_method text) returns uuid
language sql stable security definer set search_path = public as $$
  select public.account_id_by_code(case p_method
    when 'cash' then '101000'
    when 'card' then '102000'
    when 'bank_transfer' then '102000'
    when 'mobile_money' then '105000'
    else '103000' end);
$$;

-- ---------------------------------------------------------------------------
-- Sale cost snapshot and cancellation trace
-- ---------------------------------------------------------------------------
alter table public.sale_items add column if not exists unit_cost numeric(14,2);
comment on column public.sale_items.unit_cost is 'Weighted average cost of the product when sold (cost of goods sold).';

create or replace function public.snapshot_sale_item_cost() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.unit_cost is null and new.product_id is not null then
    select coalesce(nullif(average_cost, 0), purchase_price, 0) into new.unit_cost from public.products where id = new.product_id;
  end if;
  return new;
end;
$$;
drop trigger if exists sale_items_snapshot_cost on public.sale_items;
create trigger sale_items_snapshot_cost before insert on public.sale_items for each row execute function public.snapshot_sale_item_cost();

alter table public.sales add column if not exists cancelled_at timestamptz;
alter table public.sales add column if not exists cancelled_by uuid references public.profiles(id) on delete restrict;
alter table public.sales add column if not exists cancel_reason text;
alter table public.sales add column if not exists reversal_entry_id uuid references public.journal_entries(id) on delete set null;

alter table public.expenses add column if not exists expense_account_id uuid references public.accounts(id) on delete restrict;
alter table public.expenses add column if not exists payment_account_id uuid references public.accounts(id) on delete restrict;
alter table public.expenses add column if not exists accounting_error text;

-- One live entry per source operation.
create unique index if not exists journal_entries_source_uidx on public.journal_entries (reference_type, reference_id)
  where status <> 'voided' and reference_type in ('sale', 'sale_reversal', 'expense');

-- Haiti calendar day of a timestamp (entries are dated in local time).
create or replace function public.local_day(p_at timestamptz) returns date
language sql immutable as $$ select (p_at at time zone 'America/Port-au-Prince')::date $$;

-- Creates a posted automatic entry from [{account_id, debit, credit, description}], with history.
create or replace function public.post_automatic_entry(
  p_date date, p_description text, p_reference text, p_entry_type text, p_reference_type text, p_reference_id uuid, p_author uuid, p_lines jsonb
) returns uuid language plpgsql security definer set search_path = public as $$
declare v_entry uuid; v_line record; v_number integer := 0;
begin
  insert into public.journal_entries (period_id, entry_date, description, reference, entry_type, reference_type, reference_id, status, created_by)
  values (public.accounting_period_for(p_date), p_date, p_description, p_reference, p_entry_type, p_reference_type, p_reference_id, 'draft', coalesce(p_author, auth.uid()))
  returning id into v_entry;
  for v_line in select * from jsonb_to_recordset(p_lines) as x(account_id uuid, debit numeric, credit numeric, description text) loop
    if round(coalesce(v_line.debit, 0), 2) = 0 and round(coalesce(v_line.credit, 0), 2) = 0 then continue; end if;
    v_number := v_number + 1;
    insert into public.journal_entry_lines (journal_entry_id, account_id, description, debit_amount, credit_amount, line_number)
    values (v_entry, v_line.account_id, v_line.description, round(coalesce(v_line.debit, 0), 2), round(coalesce(v_line.credit, 0), 2), v_number);
  end loop;
  perform public.record_journal_history(v_entry, 'created');
  update public.journal_entries set status = 'posted', posted_by = coalesce(p_author, auth.uid()), posted_at = now() where id = v_entry;
  perform public.record_journal_history(v_entry, 'posted');
  return v_entry;
end;
$$;

-- ---------------------------------------------------------------------------
-- Sales
-- ---------------------------------------------------------------------------
-- complete_sale: a cash payment may exceed the total, the excess being change
-- handed back (as the local server already does). Previously the cash register
-- sent the amount tendered and every sale with change was refused at sync.
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

create or replace function public.journalize_sale(p_sale_id uuid) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_sale public.sales; v_lines jsonb := '[]'::jsonb; v_payment record; v_cost numeric(14,2); v_entry uuid;
begin
  select * into v_sale from public.sales where id = p_sale_id for update;
  if not found then raise exception 'Vente introuvable'; end if;
  if v_sale.journal_entry_id is not null then return v_sale.journal_entry_id; end if;
  if v_sale.status = 'draft' then raise exception 'Une vente en brouillon ne se comptabilise pas'; end if;

  for v_payment in select method, sum(amount) amount from public.payments where sale_id = p_sale_id group by method loop
    v_lines := v_lines || jsonb_build_object('account_id', public.payment_account_id(v_payment.method), 'debit', v_payment.amount, 'description', 'Encaissement ' || v_payment.method);
  end loop;
  if jsonb_array_length(v_lines) = 0 then raise exception 'Vente sans paiement enregistré'; end if;
  v_lines := v_lines
    || jsonb_build_object('account_id', public.account_id_by_code('409000'), 'debit', v_sale.discount_amount, 'description', 'Remises accordées')
    || jsonb_build_object('account_id', public.account_id_by_code('401000'), 'credit', v_sale.subtotal, 'description', 'Ventes brutes')
    || jsonb_build_object('account_id', public.account_id_by_code('210000'), 'credit', v_sale.tax_amount, 'description', 'TVA collectée');
  select coalesce(sum(quantity * coalesce(unit_cost, 0)), 0) into v_cost from public.sale_items where sale_id = p_sale_id;
  if v_cost > 0 then
    v_lines := v_lines
      || jsonb_build_object('account_id', public.account_id_by_code('501000'), 'debit', v_cost, 'description', 'Coût des marchandises vendues')
      || jsonb_build_object('account_id', public.account_id_by_code('120000'), 'credit', v_cost, 'description', 'Sortie de stock');
  end if;

  v_entry := public.post_automatic_entry(public.local_day(v_sale.sold_at), 'Vente ' || v_sale.sale_number, v_sale.sale_number, 'sale', 'sale', v_sale.id, v_sale.created_by, v_lines);
  update public.sales set journal_entry_id = v_entry, accounting_synced = true, accounting_synced_at = now(), accounting_error = null where id = p_sale_id;
  return v_entry;
end;
$$;

-- Reverses a journalized sale that was cancelled or refunded.
create or replace function public.journalize_sale_reversal(p_sale_id uuid) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_sale public.sales; v_lines jsonb := '[]'::jsonb; v_payment record; v_cost numeric(14,2); v_entry uuid; v_label text;
begin
  select * into v_sale from public.sales where id = p_sale_id for update;
  if v_sale.status not in ('cancelled', 'refunded') then raise exception 'La vente n''est ni annulée ni remboursée'; end if;
  if v_sale.reversal_entry_id is not null then return v_sale.reversal_entry_id; end if;
  -- Never journalized: nothing to reverse.
  if v_sale.journal_entry_id is null then return null; end if;
  v_label := case when v_sale.status = 'refunded' then 'Retour' else 'Annulation' end;
  v_lines := jsonb_build_array(
    jsonb_build_object('account_id', public.account_id_by_code('408000'), 'debit', v_sale.subtotal - v_sale.discount_amount, 'description', v_label || ' - ventes nettes'),
    jsonb_build_object('account_id', public.account_id_by_code('210000'), 'debit', v_sale.tax_amount, 'description', v_label || ' - TVA'));
  for v_payment in select method, sum(amount) amount from public.payments where sale_id = p_sale_id group by method loop
    v_lines := v_lines || jsonb_build_object('account_id', public.payment_account_id(v_payment.method), 'credit', v_payment.amount, 'description', 'Remboursement ' || v_payment.method);
  end loop;
  select coalesce(sum(quantity * coalesce(unit_cost, 0)), 0) into v_cost from public.sale_items where sale_id = p_sale_id;
  if v_cost > 0 then
    v_lines := v_lines
      || jsonb_build_object('account_id', public.account_id_by_code('120000'), 'debit', v_cost, 'description', 'Retour en stock')
      || jsonb_build_object('account_id', public.account_id_by_code('501000'), 'credit', v_cost, 'description', 'Annulation du coût des ventes');
  end if;
  v_entry := public.post_automatic_entry(public.local_day(coalesce(v_sale.cancelled_at, now())), v_label || ' de la vente ' || v_sale.sale_number, v_sale.sale_number, 'sale', 'sale_reversal', v_sale.id, coalesce(v_sale.cancelled_by, auth.uid()), v_lines);
  update public.sales set reversal_entry_id = v_entry where id = p_sale_id;
  return v_entry;
end;
$$;

-- Every completed sale is journalized at commit (after its items and payments
-- exist). Any accounting failure is recorded on the sale instead of blocking it.
create or replace function public.sales_journalize_trigger() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.status <> 'completed' then return null; end if;
  begin
    perform public.journalize_sale(new.id);
  exception when others then
    update public.sales set accounting_synced = false, accounting_error = left(sqlerrm, 300) where id = new.id;
  end;
  return null;
end;
$$;
drop trigger if exists sales_journalize on public.sales;
create constraint trigger sales_journalize after insert on public.sales
  deferrable initially deferred for each row execute function public.sales_journalize_trigger();

-- Cancellation (sale not handed over) or return (goods brought back), whole sale.
create or replace function public.cancel_sale(p_sale_id uuid, p_status text, p_reason text) returns public.sales
language plpgsql security definer set search_path = public as $$
declare v_sale public.sales; v_item record;
begin
  if not (public.has_role('director') or public.has_role('administrator')) then raise exception 'Seul un directeur ou un administrateur peut annuler une vente'; end if;
  if p_status not in ('cancelled', 'refunded') then raise exception 'Statut invalide'; end if;
  if char_length(coalesce(trim(p_reason), '')) < 3 then raise exception 'Indiquez le motif'; end if;
  select * into v_sale from public.sales where id = p_sale_id for update;
  if not found then raise exception 'Vente introuvable'; end if;
  if v_sale.status <> 'completed' then raise exception 'Seule une vente terminée peut être annulée ou retournée'; end if;
  -- The goods go back into stock.
  for v_item in select product_id, quantity from public.sale_items where sale_id = p_sale_id and product_id is not null loop
    insert into public.stock_movements (product_id, movement_type, quantity, reason, reference_type, reference_id, created_by)
    values (v_item.product_id, 'customer_return', v_item.quantity, (case when p_status = 'refunded' then 'Retour ' else 'Annulation ' end) || v_sale.sale_number, 'sale', p_sale_id, auth.uid());
  end loop;
  update public.sales set status = p_status, cancelled_at = now(), cancelled_by = auth.uid(), cancel_reason = trim(p_reason) where id = p_sale_id returning * into v_sale;
  begin
    perform public.journalize_sale_reversal(p_sale_id);
  exception when others then
    update public.sales set accounting_error = left(sqlerrm, 300) where id = p_sale_id;
  end;
  perform public.log_audit('sale_' || p_status, 'sales', p_sale_id, null, jsonb_build_object('reason', trim(p_reason)), true);
  select * into v_sale from public.sales where id = p_sale_id;
  return v_sale;
end;
$$;

-- ---------------------------------------------------------------------------
-- Expenses
-- ---------------------------------------------------------------------------
update public.expenses set expense_account_id = public.account_id_by_code('518000') where expense_account_id is null;
update public.expenses set payment_account_id = public.account_id_by_code('101000') where payment_account_id is null;

create or replace function public.journalize_expense(p_expense_id uuid) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_expense public.expenses; v_entry uuid;
begin
  select * into v_expense from public.expenses where id = p_expense_id for update;
  if not found then raise exception 'Dépense introuvable'; end if;
  if v_expense.journal_entry_id is not null then return v_expense.journal_entry_id; end if;
  v_entry := public.post_automatic_entry(v_expense.expense_date, 'Dépense : ' || v_expense.label, null, 'expense', 'expense', v_expense.id, v_expense.created_by, jsonb_build_array(
    jsonb_build_object('account_id', coalesce(v_expense.expense_account_id, public.account_id_by_code('518000')), 'debit', v_expense.amount, 'description', v_expense.label),
    jsonb_build_object('account_id', coalesce(v_expense.payment_account_id, public.account_id_by_code('101000')), 'credit', v_expense.amount, 'description', 'Paiement de la dépense')));
  update public.expenses set journal_entry_id = v_entry, accounting_synced = true, accounting_synced_at = now(), accounting_error = null where id = p_expense_id;
  return v_entry;
end;
$$;

create or replace function public.expenses_journalize_trigger() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  begin
    perform public.journalize_expense(new.id);
  exception when others then
    update public.expenses set accounting_synced = false, accounting_error = left(sqlerrm, 300) where id = new.id;
  end;
  return null;
end;
$$;
drop trigger if exists expenses_journalize on public.expenses;
create constraint trigger expenses_journalize after insert on public.expenses
  deferrable initially deferred for each row execute function public.expenses_journalize_trigger();

-- A deleted expense keeps its entry, voided with the reason.
create or replace function public.expenses_void_entry_trigger() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if old.journal_entry_id is not null then
    update public.journal_entries set status = 'voided', voided_by = auth.uid(), voided_at = now(), void_reason = 'Dépense supprimée : ' || old.label
     where id = old.journal_entry_id and status <> 'voided';
    perform public.record_journal_history(old.journal_entry_id, 'voided', 'Dépense supprimée : ' || old.label);
  end if;
  return old;
end;
$$;
drop trigger if exists expenses_void_entry on public.expenses;
create trigger expenses_void_entry before delete on public.expenses for each row execute function public.expenses_void_entry_trigger();

-- ---------------------------------------------------------------------------
-- Backlog: operations that are not journalized yet (older data, earlier errors)
-- ---------------------------------------------------------------------------
create or replace function public.journalize_pending(p_from date default null, p_to date default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_row record; v_done integer := 0; v_failed integer := 0; v_errors jsonb := '[]'::jsonb;
begin
  if not public.can_manage_accounting() then raise exception 'Permission refusée'; end if;
  for v_row in select id, sale_number label from public.sales where journal_entry_id is null and status in ('completed', 'cancelled', 'refunded')
      and (p_from is null or public.local_day(sold_at) >= p_from) and (p_to is null or public.local_day(sold_at) <= p_to) order by sold_at loop
    begin
      perform public.journalize_sale(v_row.id);
      if (select status from public.sales where id = v_row.id) <> 'completed' then perform public.journalize_sale_reversal(v_row.id); end if;
      v_done := v_done + 1;
    exception when others then
      v_failed := v_failed + 1; v_errors := v_errors || jsonb_build_object('operation', 'Vente ' || v_row.label, 'error', sqlerrm);
      update public.sales set accounting_error = left(sqlerrm, 300) where id = v_row.id;
    end;
  end loop;
  for v_row in select id, label from public.expenses where journal_entry_id is null
      and (p_from is null or expense_date >= p_from) and (p_to is null or expense_date <= p_to) order by expense_date loop
    begin
      perform public.journalize_expense(v_row.id); v_done := v_done + 1;
    exception when others then
      v_failed := v_failed + 1; v_errors := v_errors || jsonb_build_object('operation', 'Dépense ' || v_row.label, 'error', sqlerrm);
      update public.expenses set accounting_error = left(sqlerrm, 300) where id = v_row.id;
    end;
  end loop;
  return jsonb_build_object('journalized', v_done, 'failed', v_failed, 'errors', v_errors);
end;
$$;

-- The Sales page's "Synchroniser" button keeps working, on the new rules.
create or replace function public.sync_sale_to_accounting(p_sale_id uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_entry uuid;
begin
  if not public.can_manage_accounting() then raise exception 'Permission refusée'; end if;
  v_entry := public.journalize_sale(p_sale_id);
  if (select status from public.sales where id = p_sale_id) in ('cancelled', 'refunded') then perform public.journalize_sale_reversal(p_sale_id); end if;
  return jsonb_build_object('success', true, 'journal_entry_id', v_entry);
end;
$$;

-- Supabase grants new functions to anon by default: name it explicitly.
revoke all on function public.account_id_by_code(text) from public, anon, authenticated;
revoke all on function public.payment_account_id(text) from public, anon, authenticated;
revoke all on function public.post_automatic_entry(date, text, text, text, text, uuid, uuid, jsonb) from public, anon, authenticated;
revoke all on function public.journalize_sale(uuid) from public, anon, authenticated;
revoke all on function public.journalize_sale_reversal(uuid) from public, anon, authenticated;
revoke all on function public.journalize_expense(uuid) from public, anon, authenticated;
revoke all on function public.cancel_sale(uuid, text, text) from public, anon;
revoke all on function public.journalize_pending(date, date) from public, anon;
revoke all on function public.sync_sale_to_accounting(uuid) from public, anon;
grant execute on function public.cancel_sale(uuid, text, text) to authenticated;
grant execute on function public.journalize_pending(date, date) to authenticated;
grant execute on function public.sync_sale_to_accounting(uuid) to authenticated;

notify pgrst, 'reload schema';
