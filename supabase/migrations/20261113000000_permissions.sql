-- Étape F3 : permissions par rôle, modifiables sans changer le code.
-- The defaults reproduce the rules in force; the database and the screens read
-- permissions instead of role names. Reading rules (who sees which rows) stay
-- by role. The administrator role always keeps « roles.manage ».

create table if not exists public.permissions (
  code text primary key,
  module text not null,
  label text not null,
  sort integer not null default 0
);
create table if not exists public.role_permissions (
  role_id uuid not null references public.roles(id) on delete cascade,
  permission_code text not null references public.permissions(code) on delete cascade,
  primary key (role_id, permission_code)
);
alter table public.permissions enable row level security;
alter table public.role_permissions enable row level security;
drop policy if exists "permissions read" on public.permissions;
create policy "permissions read" on public.permissions for select to authenticated using (true);
drop policy if exists "role permissions read" on public.role_permissions;
create policy "role permissions read" on public.role_permissions for select to authenticated using (true);

insert into public.permissions (code, module, label, sort) values
  ('pos.sell', 'Caisse', 'Vendre, ouvrir et fermer sa caisse', 0),
  ('pos.discount', 'Caisse', 'Accorder une remise à la caisse', 10),
  ('cash.count', 'Caisse', 'Enregistrer un comptage de caisse', 20),
  ('cash.movements', 'Caisse', 'Enregistrer des mouvements de la caisse principale', 30),
  ('cash.other_accounts', 'Caisse', 'Petite caisse, paiements par banque ou MonCash', 40),
  ('cash.approve', 'Caisse', 'Autoriser ou refuser les sorties au-delà du seuil', 50),
  ('cash.validate_difference', 'Caisse', 'Valider un écart de caisse', 60),
  ('sales.cancel', 'Ventes', 'Annuler ou rembourser une vente', 70),
  ('customers.manage', 'Ventes', 'Créer et modifier les clients', 80),
  ('proformas.manage', 'Ventes', 'Créer, modifier et encaisser les proformas', 90),
  ('proformas.price', 'Ventes', 'Fixer un prix différent du catalogue sur une proforma', 100),
  ('proformas.view_all', 'Ventes', 'Voir les proformas de tous les utilisateurs', 110),
  ('catalog.manage', 'Stock', 'Gérer produits, catégories, fournisseurs et unités', 120),
  ('stock.movements', 'Stock', 'Enregistrer des entrées, sorties et ajustements de stock', 130),
  ('expenses.manage', 'Comptabilité', 'Enregistrer et annuler les dépenses', 140),
  ('accounting.manage', 'Comptabilité', 'Plan comptable, écritures, rapports financiers', 150),
  ('accounting.validate', 'Comptabilité', 'Valider les régularisations', 160),
  ('audit.view', 'Administration', 'Consulter le journal d’audit', 170),
  ('users.manage', 'Administration', 'Créer et gérer les comptes utilisateurs', 180),
  ('settings.manage', 'Administration', 'Modifier les paramètres de l’application', 190),
  ('roles.manage', 'Administration', 'Modifier les permissions des rôles', 200)
on conflict (code) do update set module = excluded.module, label = excluded.label, sort = excluded.sort;
-- Defaults (applied once: later changes made in the app are kept).
do $$ begin
  if not exists (select 1 from public.role_permissions) then
    insert into public.role_permissions (role_id, permission_code) select id, 'pos.sell' from public.roles where code in ('cashier', 'director', 'administrator') on conflict do nothing;
    insert into public.role_permissions (role_id, permission_code) select id, 'pos.discount' from public.roles where code in ('director', 'administrator') on conflict do nothing;
    insert into public.role_permissions (role_id, permission_code) select id, 'cash.count' from public.roles where code in ('cashier', 'director', 'administrator') on conflict do nothing;
    insert into public.role_permissions (role_id, permission_code) select id, 'cash.movements' from public.roles where code in ('cashier', 'director', 'administrator', 'accountant') on conflict do nothing;
    insert into public.role_permissions (role_id, permission_code) select id, 'cash.other_accounts' from public.roles where code in ('director', 'administrator', 'accountant') on conflict do nothing;
    insert into public.role_permissions (role_id, permission_code) select id, 'cash.approve' from public.roles where code in ('director', 'administrator') on conflict do nothing;
    insert into public.role_permissions (role_id, permission_code) select id, 'cash.validate_difference' from public.roles where code in ('director', 'administrator') on conflict do nothing;
    insert into public.role_permissions (role_id, permission_code) select id, 'sales.cancel' from public.roles where code in ('director', 'administrator') on conflict do nothing;
    insert into public.role_permissions (role_id, permission_code) select id, 'customers.manage' from public.roles where code in ('cashier', 'director', 'administrator') on conflict do nothing;
    insert into public.role_permissions (role_id, permission_code) select id, 'proformas.manage' from public.roles where code in ('cashier', 'director', 'administrator') on conflict do nothing;
    insert into public.role_permissions (role_id, permission_code) select id, 'proformas.price' from public.roles where code in ('director', 'administrator') on conflict do nothing;
    insert into public.role_permissions (role_id, permission_code) select id, 'proformas.view_all' from public.roles where code in ('director', 'administrator', 'accountant') on conflict do nothing;
    insert into public.role_permissions (role_id, permission_code) select id, 'catalog.manage' from public.roles where code in ('director', 'administrator', 'stock_manager') on conflict do nothing;
    insert into public.role_permissions (role_id, permission_code) select id, 'stock.movements' from public.roles where code in ('director', 'administrator', 'stock_manager') on conflict do nothing;
    insert into public.role_permissions (role_id, permission_code) select id, 'expenses.manage' from public.roles where code in ('director', 'administrator', 'accountant') on conflict do nothing;
    insert into public.role_permissions (role_id, permission_code) select id, 'accounting.manage' from public.roles where code in ('director', 'administrator', 'accountant') on conflict do nothing;
    insert into public.role_permissions (role_id, permission_code) select id, 'accounting.validate' from public.roles where code in ('director', 'administrator') on conflict do nothing;
    insert into public.role_permissions (role_id, permission_code) select id, 'audit.view' from public.roles where code in ('director', 'administrator') on conflict do nothing;
    insert into public.role_permissions (role_id, permission_code) select id, 'users.manage' from public.roles where code in ('director', 'administrator') on conflict do nothing;
    insert into public.role_permissions (role_id, permission_code) select id, 'settings.manage' from public.roles where code in ('director', 'administrator') on conflict do nothing;
    insert into public.role_permissions (role_id, permission_code) select id, 'roles.manage' from public.roles where code in ('administrator') on conflict do nothing;
  end if;
end $$;

create or replace function public.user_has_permission(p_user_id uuid, p_permission text) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.profiles p join public.role_permissions rp on rp.role_id = p.role_id
                 where p.id = p_user_id and p.active and rp.permission_code = p_permission);
$$;
revoke all on function public.user_has_permission(uuid, text) from public, anon, authenticated;
grant execute on function public.user_has_permission(uuid, text) to service_role;

create or replace function public.has_permission(p_permission text) returns boolean
language sql stable security definer set search_path = public as $$
  select auth.uid() is not null and public.user_has_permission(auth.uid(), p_permission);
$$;
revoke all on function public.has_permission(text) from public, anon;
grant execute on function public.has_permission(text) to authenticated;

/** Permissions of the signed-in user (for the screens). */
create or replace function public.my_permissions() returns text[]
language sql stable security definer set search_path = public as $$
  select coalesce(array_agg(rp.permission_code order by rp.permission_code), '{}') from public.profiles p join public.role_permissions rp on rp.role_id = p.role_id
  where p.id = auth.uid() and p.active;
$$;
revoke all on function public.my_permissions() from public, anon;
grant execute on function public.my_permissions() to authenticated;

/** Replaces the permissions of a role (roles.manage); the administrator keeps roles.manage. */
create or replace function public.set_role_permissions(p_role_id uuid, p_permissions text[]) returns setof public.role_permissions
language plpgsql security definer set search_path = public as $$
declare v_role public.roles; v_before text[];
begin
  if not public.has_permission('roles.manage') then raise exception 'Seuls les responsables autorisés modifient les permissions'; end if;
  select * into v_role from public.roles where id = p_role_id;
  if not found then raise exception 'Rôle inconnu'; end if;
  if exists (select 1 from unnest(coalesce(p_permissions, '{}')) code where code not in (select code from public.permissions)) then raise exception 'Permission inconnue'; end if;
  if v_role.code = 'administrator' and not ('roles.manage' = any(coalesce(p_permissions, '{}'))) then
    raise exception 'Le rôle Administrateur garde toujours la gestion des permissions';
  end if;
  select coalesce(array_agg(permission_code order by permission_code), '{}') into v_before from public.role_permissions where role_id = p_role_id;
  delete from public.role_permissions where role_id = p_role_id;
  insert into public.role_permissions (role_id, permission_code) select p_role_id, code from unnest(coalesce(p_permissions, '{}')) code group by code;
  perform public.log_audit('role_permissions_updated', 'roles', p_role_id, jsonb_build_object('permissions', v_before), jsonb_build_object('permissions', p_permissions), true);
  return query select * from public.role_permissions where role_id = p_role_id;
end;
$$;
revoke all on function public.set_role_permissions(uuid, text[]) from public, anon;
grant execute on function public.set_role_permissions(uuid, text[]) to authenticated;

-- ---------------------------------------------------------------------------
-- Helpers used by the rules and functions: now permissions.
-- ---------------------------------------------------------------------------
create or replace function public.can_manage_catalog() returns boolean language sql stable security definer set search_path = public as $$ select public.has_permission('catalog.manage'); $$;
create or replace function public.can_manage_accounting() returns boolean language sql stable security definer set search_path = public as $$ select public.has_permission('accounting.manage'); $$;
create or replace function public.can_validate_regularisation() returns boolean language sql stable security definer set search_path = public as $$ select public.has_permission('accounting.validate'); $$;
create or replace function public.can_handle_proformas() returns boolean language sql stable security definer set search_path = public as $$ select public.has_permission('proformas.manage'); $$;
create or replace function public.can_see_all_proformas() returns boolean language sql stable security definer set search_path = public as $$ select public.has_permission('proformas.view_all'); $$;
create or replace function public.can_price_proformas() returns boolean language sql stable security definer set search_path = public as $$ select public.has_permission('proformas.price'); $$;

-- ---------------------------------------------------------------------------
-- Functions that checked role names (bodies unchanged otherwise).
-- ---------------------------------------------------------------------------
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
  if auth.uid() is null or not public.has_permission('pos.sell') then raise exception 'Permission denied'; end if;
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
  if auth.uid() is null or not public.has_permission('pos.sell') then raise exception 'Permission denied'; end if;
  -- Retries of the same sale are serialised and return the sale already recorded.
  perform pg_advisory_xact_lock(hashtextextended(p_client_sale_id::text, 0));
  select * into v_sale from public.sales where client_sale_id = p_client_sale_id;
  if found then return v_sale; end if;
  select * into v_sale from public.complete_sale(p_customer_id, p_items, p_payments, p_notes, p_sold_at);
  update public.sales set client_sale_id = p_client_sale_id where id = v_sale.id returning * into v_sale;
  return v_sale;
end;
$$;

create or replace function public.open_cash_session(
  p_opening_amount numeric,
  p_notes text default null
) returns public.cash_sessions language plpgsql security definer set search_path = public as $$
declare v_session public.cash_sessions;
begin
  if auth.uid() is null or not public.has_permission('pos.sell') then
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

create or replace function public.close_cash_session(
  p_closing_amount numeric,
  p_notes text default null
) returns public.cash_sessions language plpgsql security definer set search_path = public as $$
declare v_session public.cash_sessions;
begin
  if auth.uid() is null or not public.has_permission('pos.sell') then
    raise exception 'Permission denied';
  end if;
  if p_closing_amount is null or p_closing_amount < 0 then
    raise exception 'Closing amount must be zero or greater';
  end if;
  update public.cash_sessions
     set closed_at = now(), closing_amount = p_closing_amount,
         notes = coalesce(nullif(trim(p_notes), ''), notes)
   where opened_by = auth.uid() and closed_at is null
   returning * into v_session;
  if v_session.id is null then raise exception 'No open cash session found'; end if;
  return v_session;
end;
$$;

create or replace function public.record_cash_movement(
  p_type text, p_amount numeric, p_label text, p_reference text default null,
  p_counter_account_id uuid default null, p_cash_account_code text default '101000', p_occurred_at timestamptz default now()
) returns public.cash_movements language plpgsql security definer set search_path = public as $$
declare
  v_cash uuid; v_counter uuid := p_counter_account_id; v_direction text; v_counter_account public.accounts;
  v_movement public.cash_movements; v_session uuid; v_threshold numeric; v_pending boolean := false;
  v_validator boolean := public.has_permission('cash.approve');
begin
  if p_cash_account_code not in ('101000', '104000', '102000', '105000') then raise exception 'Caisse inconnue'; end if;
  -- Main cash: cash register staff and accounting; petty cash, bank and MonCash: accounting only.
  if p_cash_account_code = '101000' and not public.has_permission('cash.movements') then raise exception 'Permission refusée'; end if;
  if p_cash_account_code = '104000' and not public.has_permission('cash.other_accounts') then raise exception 'Seuls les directeurs, administrateurs et comptables gèrent la petite caisse'; end if;
  if p_cash_account_code in ('102000', '105000') then
    if not public.has_permission('cash.other_accounts') then raise exception 'Seuls les directeurs, administrateurs et comptables paient par banque ou MonCash'; end if;
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
  if not public.has_permission('cash.approve') then raise exception 'Seuls un directeur ou un administrateur autorisent une sortie de caisse'; end if;
  select * into v_movement from public.cash_movements where id = p_id for update;
  if not found then raise exception 'Mouvement introuvable'; end if;
  if v_movement.status <> 'pending' then raise exception 'Ce mouvement n''attend pas de validation'; end if;
  update public.cash_movements set approved_by = auth.uid(), approved_at = now(), approval_note = nullif(trim(p_note), '') where id = p_id;
  v_movement := public.post_cash_movement(p_id);
  perform public.log_audit('cash_movement_approved', 'cash_movements', p_id, null, to_jsonb(v_movement), true);
  return v_movement;
end;
$$;

create or replace function public.reject_cash_movement(p_id uuid, p_reason text) returns public.cash_movements
language plpgsql security definer set search_path = public as $$
declare v_movement public.cash_movements;
begin
  if not public.has_permission('cash.approve') then raise exception 'Seuls un directeur ou un administrateur refusent une sortie de caisse'; end if;
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

create or replace function public.validate_cash_difference(p_session_id uuid, p_reason text) returns public.cash_sessions
language plpgsql security definer set search_path = public as $$
declare v_session public.cash_sessions; v_difference numeric; v_entry uuid; v_cash uuid;
begin
  if not public.has_permission('cash.validate_difference') then raise exception 'Seul un directeur ou un administrateur valide un écart de caisse'; end if;
  if char_length(coalesce(trim(p_reason), '')) < 3 then raise exception 'Indiquez la justification de l''écart'; end if;
  select * into v_session from public.cash_sessions where id = p_session_id for update;
  if not found then raise exception 'Session introuvable'; end if;
  if v_session.closed_at is null then raise exception 'La session doit être clôturée'; end if;
  if v_session.difference_validated_at is not null then raise exception 'L''écart de cette session est déjà validé'; end if;
  select r.difference into v_difference from public.cash_session_report(public.local_day(v_session.opened_at), public.local_day(v_session.opened_at)) r where r.session_id = p_session_id;
  v_difference := round(coalesce(v_difference, 0), 2);
  if v_difference <> 0 then
    v_cash := public.account_id_by_code('101000');
    v_entry := public.post_automatic_entry(public.local_day(v_session.closed_at), case when v_difference < 0 then 'Manquant de caisse' else 'Excédent de caisse' end, null, 'cash', 'cash_difference', p_session_id, auth.uid(),
      case when v_difference < 0
        then jsonb_build_array(jsonb_build_object('account_id', public.account_id_by_code('519100'), 'debit', -v_difference, 'description', trim(p_reason)), jsonb_build_object('account_id', v_cash, 'credit', -v_difference, 'description', 'Écart de caisse'))
        else jsonb_build_array(jsonb_build_object('account_id', v_cash, 'debit', v_difference, 'description', 'Écart de caisse'), jsonb_build_object('account_id', public.account_id_by_code('407000'), 'credit', v_difference, 'description', trim(p_reason))) end);
  end if;
  update public.cash_sessions set difference_amount = v_difference, difference_validated_at = now(), difference_validated_by = auth.uid(), difference_reason = trim(p_reason), difference_entry_id = v_entry
   where id = p_session_id returning * into v_session;
  perform public.log_audit('cash_difference_validated', 'cash_sessions', p_session_id, null, jsonb_build_object('difference', v_difference, 'reason', trim(p_reason)), true);
  return v_session;
end;
$$;

create or replace function public.cancel_sale(p_sale_id uuid, p_status text, p_reason text) returns public.sales
language plpgsql security definer set search_path = public as $$
declare v_sale public.sales; v_item record;
begin
  if not public.has_permission('sales.cancel') then raise exception 'Seul un directeur ou un administrateur peut annuler une vente'; end if;
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
  if auth.uid() is null or not public.has_permission('stock.movements') then
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

-- ---------------------------------------------------------------------------
-- Write rules by permission. Sales, their lines, payments and cash sessions are
-- only changed by the functions above (sale, return, closing): no direct edit
-- or deletion, which would break stock, cash and accounting without a trace.
-- ---------------------------------------------------------------------------
drop policy if exists "sales update by director only" on public.sales;
drop policy if exists "sales delete by director only" on public.sales;
drop policy if exists "sales administrator delete" on public.sales;
drop policy if exists "sale_items update by director only" on public.sale_items;
drop policy if exists "sale_items delete by director only" on public.sale_items;
drop policy if exists "sale items administrator delete" on public.sale_items;
drop policy if exists "payments update by director only" on public.payments;
drop policy if exists "payments delete by director only" on public.payments;
drop policy if exists "payments administrator delete" on public.payments;
drop policy if exists "cash_sessions insert by cashier and director" on public.cash_sessions;
drop policy if exists "cash sessions admin or owner insert" on public.cash_sessions;
drop policy if exists "cash sessions admin or owner update" on public.cash_sessions;
drop policy if exists "cash_sessions update all by director" on public.cash_sessions;
drop policy if exists "cash_sessions delete by director only" on public.cash_sessions;
drop policy if exists "proformas administrator delete" on public.proformas;

drop policy if exists "customers insert by cashier and director" on public.customers;
drop policy if exists "customers update by cashier and director" on public.customers;
drop policy if exists "customers delete by administrators" on public.customers;
drop policy if exists "customers delete by director" on public.customers;
drop policy if exists "customers insert by permission" on public.customers;
drop policy if exists "customers update by permission" on public.customers;
create policy "customers insert by permission" on public.customers for insert to authenticated with check (public.has_permission('customers.manage'));
create policy "customers update by permission" on public.customers for update to authenticated using (public.has_permission('customers.manage')) with check (public.has_permission('customers.manage'));

drop policy if exists "expenses insert by director and accountant" on public.expenses;
drop policy if exists "expenses update by director and accountant" on public.expenses;
drop policy if exists "expenses read by director and accountant" on public.expenses;
drop policy if exists "expenses insert by permission" on public.expenses;
drop policy if exists "expenses update by permission" on public.expenses;
drop policy if exists "expenses read by permission" on public.expenses;
create policy "expenses read by permission" on public.expenses for select to authenticated using (public.has_permission('expenses.manage') or public.has_permission('accounting.manage'));
create policy "expenses insert by permission" on public.expenses for insert to authenticated with check (public.has_permission('expenses.manage'));
create policy "expenses update by permission" on public.expenses for update to authenticated using (public.has_permission('expenses.manage')) with check (public.has_permission('expenses.manage'));

drop policy if exists "settings director manage" on public.settings;
drop policy if exists "settings manage by director only" on public.settings;
drop policy if exists "settings manage by permission" on public.settings;
create policy "settings manage by permission" on public.settings for all to authenticated using (public.has_permission('settings.manage')) with check (public.has_permission('settings.manage'));

drop policy if exists "profiles director manage" on public.profiles;
drop policy if exists "profiles manage by permission" on public.profiles;
create policy "profiles manage by permission" on public.profiles for update to authenticated
  using (public.has_permission('users.manage') and id <> auth.uid()) with check (public.has_permission('users.manage') and id <> auth.uid());
drop policy if exists "profiles users read" on public.profiles;
create policy "profiles users read" on public.profiles for select to authenticated using (public.has_permission('users.manage'));

drop policy if exists "roles managed by administrators" on public.roles;
drop policy if exists "roles director manage" on public.roles;

drop policy if exists "audit_log readable by director" on public.audit_log;
drop policy if exists "audit log read by permission" on public.audit_log;
create policy "audit log read by permission" on public.audit_log for select to authenticated using (public.has_permission('audit.view'));

drop policy if exists "cash counts register insert" on public.cash_counts;
drop policy if exists "cash counts insert by permission" on public.cash_counts;
create policy "cash counts insert by permission" on public.cash_counts for insert to authenticated with check (submitted_by = auth.uid() and public.has_permission('cash.count'));

drop policy if exists "accounts read by cash staff" on public.accounts;
drop policy if exists "accounts read by cash permission" on public.accounts;
create policy "accounts read by cash permission" on public.accounts for select to authenticated using (public.has_permission('cash.movements'));

drop policy if exists "product images administrator insert" on storage.objects;
drop policy if exists "product images administrator update" on storage.objects;
drop policy if exists "product images administrator delete" on storage.objects;
drop policy if exists "product images catalog insert" on storage.objects;
drop policy if exists "product images catalog update" on storage.objects;
drop policy if exists "product images catalog delete" on storage.objects;
create policy "product images catalog insert" on storage.objects for insert to authenticated with check (bucket_id = 'product-images' and public.has_permission('catalog.manage'));
create policy "product images catalog update" on storage.objects for update to authenticated using (bucket_id = 'product-images' and public.has_permission('catalog.manage')) with check (bucket_id = 'product-images' and public.has_permission('catalog.manage'));
create policy "product images catalog delete" on storage.objects for delete to authenticated using (bucket_id = 'product-images' and public.has_permission('catalog.manage'));
