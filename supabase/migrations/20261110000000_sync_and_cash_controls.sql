-- Étapes A et B du cahier des charges : synchronisation, ventes hors ligne,
-- sorties de caisse autorisées, dépenses annulées au lieu d'être supprimées.

insert into public.settings (key, value, description) values
  ('pos.offline_sale_max_days', '7'::jsonb, 'Âge maximum (jours) d''une vente faite hors ligne acceptée à la synchronisation'),
  ('cash.outflow_approval_threshold', '5000'::jsonb, 'Sorties de caisse au-delà de ce montant (HTG) à faire valider par la direction ; 0 = aucune validation')
on conflict (key) do nothing;

-- ---------------------------------------------------------------------------
-- A3. Opening a register is idempotent: an opening queued offline, replayed
-- while a session is already open, gets that session instead of an error.
-- ---------------------------------------------------------------------------
create or replace function public.open_cash_session(
  p_opening_amount numeric,
  p_notes text default null
) returns public.cash_sessions language plpgsql security definer set search_path = public as $$
declare v_session public.cash_sessions;
begin
  if auth.uid() is null or not (public.has_role('cashier') or public.has_role('director') or public.has_role('administrator')) then
    raise exception 'Permission denied';
  end if;
  if p_opening_amount is null or p_opening_amount < 0 then
    raise exception 'Opening amount must be zero or greater';
  end if;
  select * into v_session from public.cash_sessions where opened_by = auth.uid() and closed_at is null;
  if found then return v_session; end if;
  insert into public.cash_sessions (opened_by, opening_amount, notes)
  values (auth.uid(), p_opening_amount, nullif(trim(p_notes), ''))
  returning * into v_session;
  return v_session;
end;
$$;

-- ---------------------------------------------------------------------------
-- A4. Sales keep their real time (made offline, synced later).
-- ---------------------------------------------------------------------------
drop function if exists public.complete_offline_sale(uuid, uuid, jsonb, jsonb, text);
drop function if exists public.complete_sale(uuid, jsonb, jsonb, text);

create or replace function public.complete_sale(
  p_customer_id uuid,
  p_items jsonb,
  p_payments jsonb,
  p_notes text default null,
  p_sold_at timestamptz default null
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
  v_at timestamptz := coalesce(p_sold_at, now());
  v_max_days integer := coalesce((select (value #>> '{}')::integer from public.settings where key = 'pos.offline_sale_max_days'), 7);
begin
  if auth.uid() is null or not (public.has_role('cashier') or public.has_role('director')) then raise exception 'Permission denied'; end if;
  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then raise exception 'Cart is empty'; end if;
  if jsonb_typeof(p_payments) <> 'array' or jsonb_array_length(p_payments) = 0 then raise exception 'Payment required'; end if;
  -- A sale made offline keeps its real time; it belongs to the session open at that time, or to the one open now.
  if v_at > now() + interval '5 minutes' then raise exception 'Date de vente dans le futur'; end if;
  if v_at < now() - make_interval(days => v_max_days) then raise exception 'Vente hors ligne trop ancienne (plus de % jours) : à faire valider par un responsable', v_max_days; end if;
  if not exists (select 1 from public.cash_sessions where opened_by = auth.uid()
                 and (closed_at is null or (opened_at <= v_at and closed_at >= v_at))) then raise exception 'Open a cash session first'; end if;
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

  insert into public.sales (customer_id, subtotal, discount_amount, tax_amount, total_amount, notes, status, created_by, sold_at)
  values (p_customer_id, v_subtotal, v_discount, v_tax, v_total, nullif(trim(p_notes), ''), 'completed', auth.uid(), v_at) returning * into v_sale;
  for v_item in
    select product_id, sum(quantity) quantity, sum(discount_amount) discount_amount, sum(tax_amount) tax_amount
    from jsonb_to_recordset(p_items) as x(product_id uuid, quantity numeric, discount_amount numeric, tax_amount numeric)
    group by product_id order by product_id
  loop
    select * into v_product from public.products where id = v_item.product_id for update;
    insert into public.sale_items (sale_id, product_id, description, quantity, unit_price, discount_amount, tax_amount, line_total)
    values (v_sale.id, v_product.id, v_product.name, v_item.quantity, v_product.selling_price, coalesce(v_item.discount_amount, 0), coalesce(v_item.tax_amount, 0), v_item.quantity * v_product.selling_price - coalesce(v_item.discount_amount, 0) + coalesce(v_item.tax_amount, 0));
    insert into public.stock_movements (product_id, movement_type, quantity, reason, reference_type, reference_id, created_by, movement_at)
    values (v_product.id, 'exit', v_item.quantity, 'Sale ' || v_sale.sale_number, 'sale', v_sale.id, auth.uid(), v_at);
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
revoke all on function public.complete_sale(uuid, jsonb, jsonb, text, timestamptz) from public, anon;
grant execute on function public.complete_sale(uuid, jsonb, jsonb, text, timestamptz) to authenticated;

create or replace function public.complete_offline_sale(
  p_client_sale_id uuid,
  p_customer_id uuid,
  p_items jsonb,
  p_payments jsonb,
  p_notes text default null,
  p_sold_at timestamptz default null
) returns public.sales language plpgsql security definer set search_path = public as $$
declare v_sale public.sales;
begin
  if p_client_sale_id is null then raise exception 'Client sale id is required'; end if;
  if auth.uid() is null or not (public.has_role('cashier') or public.has_role('director')) then raise exception 'Permission denied'; end if;
  -- Retries of the same sale are serialised and return the sale already recorded.
  perform pg_advisory_xact_lock(hashtextextended(p_client_sale_id::text, 0));
  select * into v_sale from public.sales where client_sale_id = p_client_sale_id;
  if found then return v_sale; end if;
  select * into v_sale from public.complete_sale(p_customer_id, p_items, p_payments, p_notes, p_sold_at);
  update public.sales set client_sale_id = p_client_sale_id where id = v_sale.id returning * into v_sale;
  return v_sale;
end;
$$;
revoke all on function public.complete_offline_sale(uuid, uuid, jsonb, jsonb, text, timestamptz) from public, anon;
grant execute on function public.complete_offline_sale(uuid, uuid, jsonb, jsonb, text, timestamptz) to authenticated;

-- ---------------------------------------------------------------------------
-- B4. Expenses are cancelled with a reason, never deleted.
-- ---------------------------------------------------------------------------
alter table public.expenses add column if not exists status text not null default 'active' check (status in ('active', 'cancelled'));
alter table public.expenses add column if not exists cancelled_at timestamptz;
alter table public.expenses add column if not exists cancelled_by uuid references public.profiles(id) on delete restrict;
alter table public.expenses add column if not exists cancel_reason text;
drop policy if exists "expenses delete by director only" on public.expenses;

create or replace function public.prevent_expense_delete() returns trigger language plpgsql set search_path = public as $$
begin
  raise exception 'Une dépense ne se supprime pas : annulez-la avec un motif';
end;
$$;
drop trigger if exists expenses_prevent_delete on public.expenses;
create trigger expenses_prevent_delete before delete on public.expenses for each row execute function public.prevent_expense_delete();

create or replace function public.journalize_expense(p_expense_id uuid) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_expense public.expenses; v_entry uuid;
begin
  select * into v_expense from public.expenses where id = p_expense_id for update;
  if not found then raise exception 'Dépense introuvable'; end if;
  -- A cancelled expense is never posted (journalize_pending skips it too).
  if v_expense.status = 'cancelled' then return null; end if;
  if v_expense.journal_entry_id is not null then return v_expense.journal_entry_id; end if;
  v_entry := public.post_automatic_entry(v_expense.expense_date, 'Dépense : ' || v_expense.label, null, 'expense', 'expense', v_expense.id, v_expense.created_by, jsonb_build_array(
    jsonb_build_object('account_id', coalesce(v_expense.expense_account_id, public.account_id_by_code('518000')), 'debit', v_expense.amount, 'description', v_expense.label),
    jsonb_build_object('account_id', coalesce(v_expense.payment_account_id, public.account_id_by_code('101000')), 'credit', v_expense.amount, 'description', 'Paiement de la dépense')));
  update public.expenses set journal_entry_id = v_entry, accounting_synced = true, accounting_synced_at = now(), accounting_error = null where id = p_expense_id;
  return v_entry;
end;
$$;

create or replace function public.cancel_expense(p_id uuid, p_reason text) returns public.expenses
language plpgsql security definer set search_path = public as $$
declare v_expense public.expenses;
begin
  if not public.can_manage_accounting() then raise exception 'Seuls les directeurs, administrateurs et comptables annulent une dépense'; end if;
  if char_length(coalesce(trim(p_reason), '')) < 3 then raise exception 'Indiquez le motif de l''annulation'; end if;
  select * into v_expense from public.expenses where id = p_id for update;
  if not found then raise exception 'Dépense introuvable'; end if;
  if v_expense.status = 'cancelled' then raise exception 'Cette dépense est déjà annulée'; end if;
  if v_expense.journal_entry_id is not null then
    update public.journal_entries set status = 'voided', voided_by = auth.uid(), voided_at = now(), void_reason = 'Dépense annulée : ' || trim(p_reason)
     where id = v_expense.journal_entry_id and status <> 'voided';
    perform public.record_journal_history(v_expense.journal_entry_id, 'voided', trim(p_reason));
  end if;
  update public.expenses set status = 'cancelled', cancelled_at = now(), cancelled_by = auth.uid(), cancel_reason = trim(p_reason)
   where id = p_id returning * into v_expense;
  -- A cash expense: its movement is voided too, so the cash report stays right.
  update public.cash_movements set status = 'voided', voided_by = auth.uid(), voided_at = now(), void_reason = trim(p_reason)
   where expense_id = p_id and status = 'posted';
  perform public.log_audit('expense_cancelled', 'expenses', p_id, null, to_jsonb(v_expense), true);
  return v_expense;
end;
$$;
revoke all on function public.cancel_expense(uuid, text) from public, anon;
grant execute on function public.cancel_expense(uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
-- B2 / B3. Cash outflows: approval above a threshold, more payment sources.
-- ---------------------------------------------------------------------------
alter table public.cash_movements drop constraint if exists cash_movements_status_check;
alter table public.cash_movements add constraint cash_movements_status_check check (status in ('pending', 'posted', 'rejected', 'voided'));
alter table public.cash_movements add column if not exists approved_by uuid references public.profiles(id) on delete restrict;
alter table public.cash_movements add column if not exists approved_at timestamptz;
alter table public.cash_movements add column if not exists approval_note text;

/** Posts a recorded movement: an expense (posted at commit) or its own entry. Internal. */
create or replace function public.post_cash_movement(p_id uuid) returns public.cash_movements
language plpgsql security definer set search_path = public as $$
declare v_movement public.cash_movements; v_cash public.accounts; v_balance numeric; v_expense uuid; v_entry uuid; v_lines jsonb;
begin
  select * into v_movement from public.cash_movements where id = p_id for update;
  select * into v_cash from public.accounts where id = v_movement.cash_account_id;
  -- The petty cash cannot pay more than it holds (checked when the money leaves).
  if v_cash.code = '104000' and v_movement.direction = 'out' then
    select coalesce(sum(l.debit_amount - l.credit_amount), 0) into v_balance
    from public.journal_entry_lines l join public.journal_entries je on je.id = l.journal_entry_id
    where l.account_id = v_cash.id and je.status = 'posted';
    if v_balance < v_movement.amount then raise exception 'Solde de la petite caisse insuffisant (disponible : % HTG)', v_balance; end if;
  end if;
  if v_movement.movement_type = 'expense' then
    insert into public.expenses (label, amount, expense_date, notes, created_by, expense_account_id, payment_account_id)
    values (v_movement.label, v_movement.amount, public.local_day(v_movement.occurred_at), v_movement.reference, v_movement.created_by, v_movement.counter_account_id, v_movement.cash_account_id)
    returning id into v_expense;
    update public.cash_movements set expense_id = v_expense, status = 'posted' where id = p_id returning * into v_movement;
  else
    v_lines := case when v_movement.direction = 'in'
      then jsonb_build_array(jsonb_build_object('account_id', v_movement.cash_account_id, 'debit', v_movement.amount, 'description', v_movement.label), jsonb_build_object('account_id', v_movement.counter_account_id, 'credit', v_movement.amount, 'description', v_movement.label))
      else jsonb_build_array(jsonb_build_object('account_id', v_movement.counter_account_id, 'debit', v_movement.amount, 'description', v_movement.label), jsonb_build_object('account_id', v_movement.cash_account_id, 'credit', v_movement.amount, 'description', v_movement.label)) end;
    v_entry := public.post_automatic_entry(public.local_day(v_movement.occurred_at), v_movement.label, v_movement.reference,
      case when v_cash.code = '104000' or v_movement.movement_type = 'petty_cash_funding' then 'petty_cash' else 'cash' end, 'cash_movement', v_movement.id, v_movement.created_by, v_lines);
    update public.cash_movements set journal_entry_id = v_entry, status = 'posted' where id = p_id returning * into v_movement;
  end if;
  return v_movement;
end;
$$;
revoke all on function public.post_cash_movement(uuid) from public, anon, authenticated;

create or replace function public.record_cash_movement(
  p_type text, p_amount numeric, p_label text, p_reference text default null,
  p_counter_account_id uuid default null, p_cash_account_code text default '101000', p_occurred_at timestamptz default now()
) returns public.cash_movements language plpgsql security definer set search_path = public as $$
declare
  v_cash uuid; v_counter uuid := p_counter_account_id; v_direction text; v_counter_account public.accounts;
  v_movement public.cash_movements; v_session uuid; v_threshold numeric; v_pending boolean := false;
  v_validator boolean := public.has_role('director') or public.has_role('administrator');
begin
  if p_cash_account_code not in ('101000', '104000', '102000', '105000') then raise exception 'Caisse inconnue'; end if;
  -- Main cash: cash register staff and accounting; petty cash, bank and MonCash: accounting only.
  if p_cash_account_code = '101000' and not (public.has_role('cashier') or public.can_manage_accounting()) then raise exception 'Permission refusée'; end if;
  if p_cash_account_code = '104000' and not public.can_manage_accounting() then raise exception 'Seuls les directeurs, administrateurs et comptables gèrent la petite caisse'; end if;
  if p_cash_account_code in ('102000', '105000') then
    if not public.can_manage_accounting() then raise exception 'Seuls les directeurs, administrateurs et comptables paient par banque ou MonCash'; end if;
    if p_type not in ('expense', 'supplier_payment') then raise exception 'Par banque ou MonCash : dépenses et paiements fournisseurs seulement'; end if;
  end if;
  if p_amount is null or p_amount <= 0 then raise exception 'Le montant doit être positif'; end if;
  if nullif(trim(p_label), '') is null then raise exception 'Le libellé est obligatoire'; end if;
  if p_occurred_at > now() + interval '5 minutes' then raise exception 'La date ne peut pas être dans le futur'; end if;
  v_cash := public.account_id_by_code(p_cash_account_code);
  v_direction := case when p_type in ('deposit', 'bank_withdrawal', 'other_in') then 'in'
                      when p_type in ('expense', 'withdrawal', 'bank_deposit', 'petty_cash_funding', 'supplier_payment') then 'out' end;
  if v_direction is null then raise exception 'Type de mouvement inconnu'; end if;

  -- Counterpart: fixed for bank, petty cash and supplier transfers, chosen otherwise.
  if p_type in ('bank_withdrawal', 'bank_deposit') then v_counter := coalesce(v_counter, public.account_id_by_code('102000')); end if;
  if p_type = 'supplier_payment' then v_counter := public.account_id_by_code('201000'); end if;
  if p_type = 'petty_cash_funding' then
    if p_cash_account_code <> '101000' then raise exception 'La petite caisse s''approvisionne depuis la caisse principale ou la banque'; end if;
    v_counter := public.account_id_by_code('104000');
  end if;
  if v_counter is null then raise exception 'Choisissez le compte de contrepartie'; end if;
  select * into v_counter_account from public.accounts where id = v_counter;
  if not found or not v_counter_account.is_active then raise exception 'Compte de contrepartie inactif ou introuvable'; end if;
  if v_counter = v_cash then raise exception 'La contrepartie doit être un autre compte que la caisse'; end if;
  if p_type = 'expense' and v_counter_account.account_type <> 'expense' then raise exception 'Une dépense doit être imputée à un compte de charges'; end if;

  -- Outflows above the threshold wait for a director or administrator.
  v_threshold := coalesce((select (value #>> '{}')::numeric from public.settings where key = 'cash.outflow_approval_threshold'), 0);
  v_pending := v_direction = 'out' and v_threshold > 0 and p_amount > v_threshold and not v_validator;

  if p_cash_account_code = '101000' then
    select id into v_session from public.cash_sessions where opened_by = auth.uid() and closed_at is null order by opened_at desc limit 1;
  end if;
  insert into public.cash_movements (occurred_at, movement_type, direction, cash_account_id, counter_account_id, amount, label, reference, cash_session_id, created_by, status, approved_by, approved_at)
  values (p_occurred_at, p_type, v_direction, v_cash, v_counter, round(p_amount, 2), trim(p_label), nullif(trim(p_reference), ''), v_session, auth.uid(),
          case when v_pending then 'pending' else 'posted' end,
          case when v_direction = 'out' and v_validator then auth.uid() end, case when v_direction = 'out' and v_validator then now() end)
  returning * into v_movement;
  if not v_pending then v_movement := public.post_cash_movement(v_movement.id); end if;
  perform public.log_audit('cash_movement_' || p_type, 'cash_movements', v_movement.id, null, to_jsonb(v_movement), true);
  return v_movement;
end;
$$;

create or replace function public.approve_cash_movement(p_id uuid, p_note text default null) returns public.cash_movements
language plpgsql security definer set search_path = public as $$
declare v_movement public.cash_movements;
begin
  if not (public.has_role('director') or public.has_role('administrator')) then raise exception 'Seuls un directeur ou un administrateur autorisent une sortie de caisse'; end if;
  select * into v_movement from public.cash_movements where id = p_id for update;
  if not found then raise exception 'Mouvement introuvable'; end if;
  if v_movement.status <> 'pending' then raise exception 'Ce mouvement n''attend pas de validation'; end if;
  update public.cash_movements set approved_by = auth.uid(), approved_at = now(), approval_note = nullif(trim(p_note), '') where id = p_id;
  v_movement := public.post_cash_movement(p_id);
  perform public.log_audit('cash_movement_approved', 'cash_movements', p_id, null, to_jsonb(v_movement), true);
  return v_movement;
end;
$$;
revoke all on function public.approve_cash_movement(uuid, text) from public, anon;
grant execute on function public.approve_cash_movement(uuid, text) to authenticated;

create or replace function public.reject_cash_movement(p_id uuid, p_reason text) returns public.cash_movements
language plpgsql security definer set search_path = public as $$
declare v_movement public.cash_movements;
begin
  if not (public.has_role('director') or public.has_role('administrator')) then raise exception 'Seuls un directeur ou un administrateur refusent une sortie de caisse'; end if;
  if char_length(coalesce(trim(p_reason), '')) < 3 then raise exception 'Indiquez le motif du refus'; end if;
  select * into v_movement from public.cash_movements where id = p_id for update;
  if not found then raise exception 'Mouvement introuvable'; end if;
  if v_movement.status <> 'pending' then raise exception 'Ce mouvement n''attend pas de validation'; end if;
  update public.cash_movements set status = 'rejected', approved_by = auth.uid(), approved_at = now(), approval_note = trim(p_reason)
   where id = p_id returning * into v_movement;
  perform public.log_audit('cash_movement_rejected', 'cash_movements', p_id, null, to_jsonb(v_movement), true);
  return v_movement;
end;
$$;
revoke all on function public.reject_cash_movement(uuid, text) from public, anon;
grant execute on function public.reject_cash_movement(uuid, text) to authenticated;

-- A voided cash expense is cancelled (kept), no longer deleted.
create or replace function public.void_cash_movement(p_id uuid, p_reason text) returns public.cash_movements
language plpgsql security definer set search_path = public as $$
declare v_movement public.cash_movements;
begin
  if not public.can_manage_accounting() then raise exception 'Seuls les directeurs, administrateurs et comptables annulent un mouvement de caisse'; end if;
  if char_length(coalesce(trim(p_reason), '')) < 3 then raise exception 'Indiquez le motif de l''annulation'; end if;
  select * into v_movement from public.cash_movements where id = p_id for update;
  if not found then raise exception 'Mouvement introuvable'; end if;
  if v_movement.status in ('voided', 'rejected') then raise exception 'Ce mouvement est déjà annulé'; end if;
  if v_movement.expense_id is not null then
    perform public.cancel_expense(v_movement.expense_id, 'Mouvement de caisse annulé : ' || trim(p_reason));
  elsif v_movement.journal_entry_id is not null then
    update public.journal_entries set status = 'voided', voided_by = auth.uid(), voided_at = now(), void_reason = 'Mouvement de caisse annulé : ' || trim(p_reason)
     where id = v_movement.journal_entry_id and status <> 'voided';
    perform public.record_journal_history(v_movement.journal_entry_id, 'voided', trim(p_reason));
  end if;
  update public.cash_movements set status = 'voided', voided_by = auth.uid(), voided_at = now(), void_reason = trim(p_reason)
   where id = p_id returning * into v_movement;
  return v_movement;
end;
$$;
