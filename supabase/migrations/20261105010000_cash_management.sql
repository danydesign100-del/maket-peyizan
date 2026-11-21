-- Cash management (step 6): typed cash movements, petty cash and the cash report.
-- Rules (to be confirmed by the client):
--   * every movement has a date, type, amount, label, reference, user and, when
--     needed, the counterpart account; none is revenue automatically;
--   * the petty cash is an imprest fund (account 104000, fixed amount in settings);
--   * a cash session's theoretical balance = opening + cash sales − cash refunds
--     + cash inflows − cash outflows; the difference with the counted amount is
--     never corrected automatically: a director validates it, which posts it to
--     519100 (shortage) or 407000 (surplus).

insert into public.accounts (code, name, account_type, nature, term, description) values
  ('104000', 'Petite caisse', 'asset', 'debit', 'short', 'Fonds fixe de menues dépenses')
on conflict (code) do nothing;
insert into public.accounts (code, name, account_type, nature, statement_group, description) values
  ('407000', 'Excédents de caisse', 'revenue', 'credit', 'other_income', 'Écarts de caisse positifs validés'),
  ('519100', 'Manquants de caisse', 'expense', 'debit', 'expense', 'Écarts de caisse négatifs validés')
on conflict (code) do nothing;
insert into public.settings (key, value, description) values
  ('petty_cash.float', '5000'::jsonb, 'Montant du fonds fixe de la petite caisse (HTG)')
on conflict (key) do nothing;

alter table public.cash_sessions add column if not exists difference_amount numeric(14,2);
alter table public.cash_sessions add column if not exists difference_validated_at timestamptz;
alter table public.cash_sessions add column if not exists difference_validated_by uuid references public.profiles(id) on delete restrict;
alter table public.cash_sessions add column if not exists difference_reason text;
alter table public.cash_sessions add column if not exists difference_entry_id uuid references public.journal_entries(id) on delete set null;

create table if not exists public.cash_movements (
  id uuid primary key default gen_random_uuid(),
  occurred_at timestamptz not null default now(),
  movement_type text not null check (movement_type in ('deposit', 'bank_withdrawal', 'other_in', 'expense', 'withdrawal', 'bank_deposit', 'petty_cash_funding')),
  direction text not null check (direction in ('in', 'out')),
  cash_account_id uuid not null references public.accounts(id) on delete restrict,
  counter_account_id uuid not null references public.accounts(id) on delete restrict,
  amount numeric(14,2) not null check (amount > 0),
  label text not null check (char_length(trim(label)) between 1 and 200),
  reference text,
  cash_session_id uuid references public.cash_sessions(id) on delete set null,
  expense_id uuid references public.expenses(id) on delete set null,
  journal_entry_id uuid references public.journal_entries(id) on delete set null,
  created_by uuid not null default auth.uid() references public.profiles(id) on delete restrict,
  status text not null default 'posted' check (status in ('posted', 'voided')),
  voided_by uuid references public.profiles(id) on delete restrict,
  voided_at timestamptz,
  void_reason text,
  created_at timestamptz not null default now(),
  check (counter_account_id <> cash_account_id),
  check (status <> 'voided' or (voided_at is not null and nullif(trim(void_reason), '') is not null))
);
create index if not exists cash_movements_occurred_idx on public.cash_movements (occurred_at);
create index if not exists cash_movements_session_idx on public.cash_movements (cash_session_id);

alter table public.cash_movements enable row level security;
drop policy if exists "cash movements read" on public.cash_movements;
create policy "cash movements read" on public.cash_movements for select to authenticated
  using (public.can_manage_accounting() or created_by = auth.uid());
revoke insert, update, delete, truncate on public.cash_movements from anon, authenticated;

drop index if exists public.journal_entries_source_uidx;
create unique index journal_entries_source_uidx on public.journal_entries (reference_type, reference_id)
  where status <> 'voided' and reference_type in ('sale', 'sale_reversal', 'expense', 'cash_movement', 'cash_difference');

-- Cashiers choose counterpart accounts (expense paid from the till…): they may read
-- the chart of accounts. Entries and balances stay restricted to accounting.
drop policy if exists "accounts read by cash staff" on public.accounts;
create policy "accounts read by cash staff" on public.accounts for select to authenticated using (public.has_role('cashier'));

-- Accounting reviews who recorded each operation: it may read staff names.
drop policy if exists "profiles accounting read" on public.profiles;
create policy "profiles accounting read" on public.profiles for select to authenticated using (public.can_manage_accounting());

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
                      when p_type in ('expense', 'withdrawal', 'bank_deposit', 'petty_cash_funding') then 'out' end;
  if v_direction is null then raise exception 'Type de mouvement inconnu'; end if;

  -- Counterpart: fixed for bank and petty cash transfers, chosen otherwise.
  if p_type in ('bank_withdrawal', 'bank_deposit') then v_counter := coalesce(v_counter, public.account_id_by_code('102000')); end if;
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

-- A voided movement stays visible; its entry is voided (or its expense removed, which voids it).
create or replace function public.void_cash_movement(p_id uuid, p_reason text) returns public.cash_movements
language plpgsql security definer set search_path = public as $$
declare v_movement public.cash_movements;
begin
  if not public.can_manage_accounting() then raise exception 'Seuls les directeurs, administrateurs et comptables annulent un mouvement de caisse'; end if;
  if char_length(coalesce(trim(p_reason), '')) < 3 then raise exception 'Indiquez le motif de l''annulation'; end if;
  select * into v_movement from public.cash_movements where id = p_id for update;
  if not found then raise exception 'Mouvement introuvable'; end if;
  if v_movement.status = 'voided' then raise exception 'Ce mouvement est déjà annulé'; end if;
  if v_movement.expense_id is not null then
    delete from public.expenses where id = v_movement.expense_id;
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

-- Cash report: one row per cash session opened in the period (Haiti calendar days).
-- Cashiers see their own sessions; accounting roles see all, optionally one cashier.
create or replace function public.cash_session_report(p_from date, p_to date, p_cashier uuid default null)
returns table (
  session_id uuid, cashier_id uuid, cashier_name text, opened_at timestamptz, closed_at timestamptz,
  opening_amount numeric, cash_sales numeric, refunds numeric, cash_in numeric, cash_out numeric,
  theoretical numeric, counted numeric, difference numeric,
  difference_validated_at timestamptz, difference_validated_by_name text, difference_reason text
) language plpgsql stable security definer set search_path = public as $$
begin
  if not (public.can_manage_accounting() or public.has_role('cashier')) then raise exception 'Permission refusée'; end if;
  if p_from > p_to then raise exception 'La date de début ne peut pas être postérieure à la date de fin'; end if;
  return query
  with sessions as (
    select cs.* from public.cash_sessions cs
    where public.local_day(cs.opened_at) between p_from and p_to
      and (p_cashier is null or cs.opened_by = p_cashier)
      and (public.can_manage_accounting() or cs.opened_by = auth.uid())
  ), figures as (
    select s.id,
      coalesce((select sum(p.amount) from public.payments p join public.sales sa on sa.id = p.sale_id
        where p.method = 'cash' and sa.created_by = s.opened_by and sa.status <> 'draft'
          and sa.sold_at >= s.opened_at and sa.sold_at < coalesce(s.closed_at, now())), 0) sales_cash,
      coalesce((select sum(p.amount) from public.payments p join public.sales sa on sa.id = p.sale_id
        where p.method = 'cash' and sa.status in ('refunded', 'cancelled') and sa.cancelled_by = s.opened_by
          and sa.cancelled_at >= s.opened_at and sa.cancelled_at < coalesce(s.closed_at, now())), 0) refunded_cash,
      coalesce((select sum(m.amount) from public.cash_movements m where m.cash_session_id = s.id and m.status = 'posted' and m.direction = 'in'), 0) moved_in,
      coalesce((select sum(m.amount) from public.cash_movements m where m.cash_session_id = s.id and m.status = 'posted' and m.direction = 'out'), 0) moved_out
    from sessions s
  )
  select s.id, s.opened_by, p.full_name, s.opened_at, s.closed_at,
    s.opening_amount, f.sales_cash, f.refunded_cash, f.moved_in, f.moved_out,
    s.opening_amount + f.sales_cash - f.refunded_cash + f.moved_in - f.moved_out,
    s.closing_amount,
    case when s.closed_at is null then null else s.closing_amount - (s.opening_amount + f.sales_cash - f.refunded_cash + f.moved_in - f.moved_out) end,
    s.difference_validated_at, v.full_name, s.difference_reason
  from sessions s join figures f on f.id = s.id
  left join public.profiles p on p.id = s.opened_by
  left join public.profiles v on v.id = s.difference_validated_by
  order by s.opened_at;
end;
$$;

-- A director (or administrator) validates the difference of a closed session; it is
-- then posted to 519100 or 407000. Nothing is posted before this validation.
create or replace function public.validate_cash_difference(p_session_id uuid, p_reason text) returns public.cash_sessions
language plpgsql security definer set search_path = public as $$
declare v_session public.cash_sessions; v_difference numeric; v_entry uuid; v_cash uuid;
begin
  if not (public.has_role('director') or public.has_role('administrator')) then raise exception 'Seul un directeur ou un administrateur valide un écart de caisse'; end if;
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

-- Supabase grants new functions to anon by default: name it explicitly.
revoke all on function public.record_cash_movement(text, numeric, text, text, uuid, text, timestamptz) from public, anon;
revoke all on function public.void_cash_movement(uuid, text) from public, anon;
revoke all on function public.cash_session_report(date, date, uuid) from public, anon;
revoke all on function public.validate_cash_difference(uuid, text) from public, anon;
grant execute on function public.record_cash_movement(text, numeric, text, text, uuid, text, timestamptz) to authenticated;
grant execute on function public.void_cash_movement(uuid, text) to authenticated;
grant execute on function public.cash_session_report(date, date, uuid) to authenticated;
grant execute on function public.validate_cash_difference(uuid, text) to authenticated;

notify pgrst, 'reload schema';
