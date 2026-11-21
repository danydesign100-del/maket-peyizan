-- Stock purchases, returns, losses and inventory adjustments are posted
-- automatically (perpetual inventory). Until now only sales touched 120000
-- Stock (cost of goods sold), so the stock account went negative unless every
-- purchase was booked by hand.
--
--   entry with a purchase price   D 120000 / C 201000 (on credit), 102000 (bank) or 304000 (opening stock)
--   supplier return               D 201000 or 102000 / C 120000   (purchase price, else average cost)
--   exit (loss, breakage, use)    D 501100 / C 120000             (average cost)
--   adjustment / manual return    120000 against 501100, either way (average cost)
--
-- A purchase paid from the till is recorded on credit, then paid with the cash
-- movement « Paiement fournisseur » (D 201000 / C 101000), so that the cash
-- report and the cash account stay in step.

insert into public.accounts (code, name, account_type, nature, statement_group, description) values
  ('501100', 'Écarts d''inventaire et pertes sur stock', 'expense', 'debit', 'cogs', 'Casse, pertes, consommation et écarts d''inventaire, au coût moyen')
on conflict (code) do nothing;

alter table public.journal_entries drop constraint if exists journal_entries_entry_type_check;
alter table public.journal_entries add constraint journal_entries_entry_type_check
  check (entry_type in ('standard', 'regularisation', 'opening', 'sale', 'expense', 'petty_cash', 'cash', 'stock'));

drop index if exists public.journal_entries_source_uidx;
create unique index journal_entries_source_uidx on public.journal_entries (reference_type, reference_id)
  where status <> 'voided' and reference_type in ('sale', 'sale_reversal', 'expense', 'cash_movement', 'cash_difference', 'stock_movement');

-- Adjustments are signed (an inventory count can lower the stock), as the stock
-- trigger and the app expect; the original table only allowed positive quantities.
alter table public.stock_movements drop constraint if exists stock_movements_quantity_check;
alter table public.stock_movements add constraint stock_movements_quantity_check
  check (quantity <> 0 and (movement_type = 'adjustment' or quantity > 0));

alter table public.stock_movements add column if not exists settlement text check (settlement is null or settlement in ('supplier', 'bank', 'opening'));
alter table public.stock_movements add column if not exists journal_entry_id uuid references public.journal_entries(id) on delete set null;
alter table public.stock_movements add column if not exists unit_value numeric(14,2);
comment on column public.stock_movements.settlement is 'Counterpart of a stock entry or supplier return: supplier (201000), bank (102000) or opening stock (304000).';
comment on column public.stock_movements.unit_value is 'Unit value used for the accounting entry (purchase price or average cost).';

drop function if exists public.record_stock_movement(uuid, text, numeric, text, uuid, numeric, text, uuid, timestamptz);
create or replace function public.record_stock_movement(
  p_product_id uuid, p_movement_type text, p_quantity numeric, p_reason text,
  p_supplier_id uuid default null, p_purchase_price numeric default null,
  p_reference_type text default null, p_reference_id uuid default null, p_movement_at timestamptz default now(),
  p_settlement text default null
) returns public.stock_movements language plpgsql security definer set search_path = public as $$
declare
  result public.stock_movements;
  v_product public.products;
  v_unit numeric(14,2);
  v_amount numeric(14,2);
  v_settlement text;
  v_counter uuid;
  v_stock uuid := public.account_id_by_code('120000');
  v_losses uuid := public.account_id_by_code('501100');
  v_lines jsonb;
  v_label text;
  v_entry uuid;
  v_new_average numeric;
begin
  if auth.uid() is null or not (public.is_admin() or public.has_role('director') or public.has_role('stock_manager')) then
    raise exception 'Permission refusée';
  end if;
  if p_movement_type not in ('entry', 'exit', 'adjustment', 'customer_return', 'supplier_return') then raise exception 'Type de mouvement invalide'; end if;
  if p_quantity = 0 then raise exception 'La quantité ne peut pas être nulle'; end if;
  if p_movement_type <> 'adjustment' and p_quantity < 0 then raise exception 'La quantité doit être positive'; end if;
  if p_purchase_price is not null and p_purchase_price < 0 then raise exception 'Le prix d''achat ne peut pas être négatif'; end if;
  if p_settlement is not null and p_settlement not in ('supplier', 'bank', 'opening') then raise exception 'Règlement inconnu'; end if;
  if p_settlement = 'opening' and p_movement_type <> 'entry' then raise exception 'Le stock d''ouverture ne concerne que les entrées'; end if;
  select * into v_product from public.products where id = p_product_id;
  if not found then raise exception 'Produit introuvable'; end if;

  -- Value of the movement: purchase price for purchases, average cost otherwise (read before the
  -- movement). The average is kept such that 120000 always equals quantity × average cost:
  --   an entry without a price counts at zero cost and lowers the average;
  --   a supplier return at its invoice price recomputes the average of what remains.
  v_unit := case when p_movement_type = 'entry' then p_purchase_price else v_product.average_cost end;
  if p_movement_type = 'entry' and p_purchase_price is null and v_product.stock_quantity + p_quantity > 0 then
    v_new_average := v_product.stock_quantity * v_product.average_cost / (v_product.stock_quantity + p_quantity);
  end if;
  if p_movement_type = 'supplier_return' and p_purchase_price is not null and v_product.stock_quantity - p_quantity > 0
     and v_product.stock_quantity * v_product.average_cost - p_quantity * p_purchase_price >= 0 then
    v_unit := p_purchase_price;
    v_new_average := (v_product.stock_quantity * v_product.average_cost - p_quantity * p_purchase_price) / (v_product.stock_quantity - p_quantity);
  end if;
  v_amount := round(abs(p_quantity) * coalesce(v_unit, 0), 2);
  v_settlement := case when p_movement_type in ('entry', 'supplier_return') then coalesce(p_settlement, 'supplier') end;

  insert into public.stock_movements (product_id, movement_type, quantity, reason, supplier_id, purchase_price, reference_type, reference_id, movement_at, created_by, settlement, unit_value)
  values (p_product_id, p_movement_type, p_quantity, nullif(trim(p_reason), ''), p_supplier_id, p_purchase_price, p_reference_type, p_reference_id, p_movement_at, auth.uid(), v_settlement, v_unit)
  returning * into result;
  if v_new_average is not null then
    perform set_config('pos.stock_movement', 'true', true);
    update public.products set average_cost = round(v_new_average, 2) where id = p_product_id;
  end if;

  -- Movements created by sales and returns are already in the sale entries (cost of goods sold).
  if v_amount > 0 and coalesce(p_reference_type, '') not in ('sale', 'sale_reversal') then
    v_counter := public.account_id_by_code(case v_settlement when 'bank' then '102000' when 'opening' then '304000' else '201000' end);
    v_label := case p_movement_type
      when 'entry' then case v_settlement when 'opening' then 'Stock d''ouverture' else 'Achat' end
      when 'supplier_return' then 'Retour fournisseur'
      when 'exit' then 'Sortie de stock'
      else 'Ajustement de stock' end || ' : ' || v_product.name || ' (' || abs(p_quantity) || ' ' || v_product.unit || ')';
    v_lines := case
      when p_movement_type = 'entry' then jsonb_build_array(
        jsonb_build_object('account_id', v_stock, 'debit', v_amount, 'description', v_label),
        jsonb_build_object('account_id', v_counter, 'credit', v_amount, 'description', v_label))
      when p_movement_type = 'supplier_return' then jsonb_build_array(
        jsonb_build_object('account_id', v_counter, 'debit', v_amount, 'description', v_label),
        jsonb_build_object('account_id', v_stock, 'credit', v_amount, 'description', v_label))
      when p_movement_type = 'exit' or (p_movement_type = 'adjustment' and p_quantity < 0) then jsonb_build_array(
        jsonb_build_object('account_id', v_losses, 'debit', v_amount, 'description', v_label),
        jsonb_build_object('account_id', v_stock, 'credit', v_amount, 'description', v_label))
      else jsonb_build_array(
        jsonb_build_object('account_id', v_stock, 'debit', v_amount, 'description', v_label),
        jsonb_build_object('account_id', v_losses, 'credit', v_amount, 'description', v_label)) end;
    v_entry := public.post_automatic_entry(public.local_day(p_movement_at), v_label, nullif(trim(p_reason), ''),
      case when v_settlement = 'opening' then 'opening' else 'stock' end, 'stock_movement', result.id, auth.uid(), v_lines);
    update public.stock_movements set journal_entry_id = v_entry where id = result.id returning * into result;
  end if;
  return result;
end;
$$;
revoke all on function public.record_stock_movement(uuid, text, numeric, text, uuid, numeric, text, uuid, timestamptz, text) from public, anon;
grant execute on function public.record_stock_movement(uuid, text, numeric, text, uuid, numeric, text, uuid, timestamptz, text) to authenticated;

-- Cash movement « Paiement fournisseur »: D 201000 Fournisseurs / C caisse.
alter table public.cash_movements drop constraint if exists cash_movements_movement_type_check;
alter table public.cash_movements add constraint cash_movements_movement_type_check
  check (movement_type in ('deposit', 'bank_withdrawal', 'other_in', 'expense', 'withdrawal', 'bank_deposit', 'petty_cash_funding', 'supplier_payment'));

create or replace function public.record_cash_movement(
  p_type text, p_amount numeric, p_label text, p_reference text default null,
  p_counter_account_id uuid default null, p_cash_account_code text default '101000', p_occurred_at timestamptz default now()
) returns public.cash_movements language plpgsql security definer set search_path = public as $$
declare
  v_cash uuid; v_counter uuid := p_counter_account_id; v_direction text; v_counter_account public.accounts;
  v_movement public.cash_movements; v_balance numeric; v_expense uuid; v_session uuid; v_entry uuid; v_lines jsonb;
begin
  if p_cash_account_code not in ('101000', '104000') then raise exception 'Caisse inconnue'; end if;
  -- Main cash: cash register staff and accounting; petty cash: accounting only.
  if p_cash_account_code = '101000' and not (public.has_role('cashier') or public.can_manage_accounting()) then raise exception 'Permission refusée'; end if;
  if p_cash_account_code = '104000' and not public.can_manage_accounting() then raise exception 'Seuls les directeurs, administrateurs et comptables gèrent la petite caisse'; end if;
  if p_amount is null or p_amount <= 0 then raise exception 'Le montant doit être positif'; end if;
  if nullif(trim(p_label), '') is null then raise exception 'Le libellé est obligatoire'; end if;
  if p_occurred_at > now() + interval '5 minutes' then raise exception 'La date ne peut pas être dans le futur'; end if;
  v_cash := public.account_id_by_code(p_cash_account_code);
  v_direction := case when p_type in ('deposit', 'bank_withdrawal', 'other_in') then 'in'
                      when p_type in ('expense', 'withdrawal', 'bank_deposit', 'petty_cash_funding', 'supplier_payment') then 'out' end;
  if v_direction is null then raise exception 'Type de mouvement inconnu'; end if;

  -- Counterpart: fixed for bank and petty cash transfers, chosen otherwise.
  if p_type in ('bank_withdrawal', 'bank_deposit') then v_counter := coalesce(v_counter, public.account_id_by_code('102000')); end if;
  if p_type = 'supplier_payment' then v_counter := public.account_id_by_code('201000'); end if;
  if p_type = 'petty_cash_funding' then
    if p_cash_account_code = '104000' then raise exception 'La petite caisse s''approvisionne depuis la caisse principale ou la banque'; end if;
    v_counter := public.account_id_by_code('104000');
  end if;
  if v_counter is null then raise exception 'Choisissez le compte de contrepartie'; end if;
  select * into v_counter_account from public.accounts where id = v_counter;
  if not found or not v_counter_account.is_active then raise exception 'Compte de contrepartie inactif ou introuvable'; end if;
  if v_counter = v_cash then raise exception 'La contrepartie doit être un autre compte que la caisse'; end if;
  if p_type = 'expense' and v_counter_account.account_type <> 'expense' then raise exception 'Une dépense doit être imputée à un compte de charges'; end if;

  -- The petty cash cannot pay more than it holds.
  if p_cash_account_code = '104000' and v_direction = 'out' then
    select coalesce(sum(l.debit_amount - l.credit_amount), 0) into v_balance
    from public.journal_entry_lines l join public.journal_entries je on je.id = l.journal_entry_id
    where l.account_id = v_cash and je.status = 'posted';
    if v_balance < p_amount then raise exception 'Solde de la petite caisse insuffisant (disponible : % HTG)', v_balance; end if;
  end if;

  if p_cash_account_code = '101000' then
    select id into v_session from public.cash_sessions where opened_by = auth.uid() and closed_at is null order by opened_at desc limit 1;
  end if;

  insert into public.cash_movements (occurred_at, movement_type, direction, cash_account_id, counter_account_id, amount, label, reference, cash_session_id, created_by)
  values (p_occurred_at, p_type, v_direction, v_cash, v_counter, round(p_amount, 2), trim(p_label), nullif(trim(p_reference), ''), v_session, auth.uid())
  returning * into v_movement;

  if p_type = 'expense' then
    -- A cash expense is a real expense: it appears in Dépenses and posts its own entry at commit.
    insert into public.expenses (label, amount, expense_date, notes, created_by, expense_account_id, payment_account_id)
    values (trim(p_label), round(p_amount, 2), public.local_day(p_occurred_at), nullif(trim(p_reference), ''), auth.uid(), v_counter, v_cash)
    returning id into v_expense;
    update public.cash_movements set expense_id = v_expense where id = v_movement.id returning * into v_movement;
  else
    v_lines := case when v_direction = 'in'
      then jsonb_build_array(jsonb_build_object('account_id', v_cash, 'debit', p_amount, 'description', trim(p_label)), jsonb_build_object('account_id', v_counter, 'credit', p_amount, 'description', trim(p_label)))
      else jsonb_build_array(jsonb_build_object('account_id', v_counter, 'debit', p_amount, 'description', trim(p_label)), jsonb_build_object('account_id', v_cash, 'credit', p_amount, 'description', trim(p_label))) end;
    v_entry := public.post_automatic_entry(public.local_day(p_occurred_at), trim(p_label), nullif(trim(p_reference), ''),
      case when p_cash_account_code = '104000' or p_type = 'petty_cash_funding' then 'petty_cash' else 'cash' end, 'cash_movement', v_movement.id, auth.uid(), v_lines);
    update public.cash_movements set journal_entry_id = v_entry where id = v_movement.id returning * into v_movement;
  end if;
  perform public.log_audit('cash_movement_' || p_type, 'cash_movements', v_movement.id, null, to_jsonb(v_movement), true);
  return v_movement;
end;
$$;
