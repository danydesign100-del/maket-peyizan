-- Accounting foundations (step 1 of the accounting corrections):
--   * accounts carry their nature (debit/credit) and term (short/long),
--   * entries are saved as drafts, posted only when balanced, voided with a reason,
--   * every change to an entry is kept in journal_entry_history,
--   * account_balances(from, to) is the single source of balances for all reports.
-- Writes go through the functions below; direct table writes are no longer allowed,
-- so the checks and the history cannot be bypassed.

-- Who keeps the books. Administrators are included, as in the application menus.
create or replace function public.can_manage_accounting() returns boolean
language sql stable security definer set search_path = public as $$
  select public.has_role('director') or public.has_role('accountant') or public.has_role('administrator');
$$;

-- ---------------------------------------------------------------------------
-- Accounts: nature and term
-- ---------------------------------------------------------------------------
alter table public.accounts add column if not exists nature text;
alter table public.accounts add column if not exists term text;

update public.accounts set nature = case when account_type in ('asset', 'expense') then 'debit' else 'credit' end where nature is null;
-- Accumulated depreciation is an asset account with a credit balance (contra-asset).
update public.accounts set nature = 'credit' where code = '150000';
-- Default chart: 10-12 current assets, 13-15 fixed assets; 22 long-term loans.
update public.accounts set term = case
    when account_type = 'asset' and left(code, 2) in ('10', '11', '12') then 'short'
    when account_type = 'asset' then 'long'
    when account_type = 'liability' and left(code, 2) = '22' then 'long'
    when account_type = 'liability' then 'short'
  end
where term is null;

alter table public.accounts alter column nature set not null;
alter table public.accounts drop constraint if exists accounts_nature_check;
alter table public.accounts add constraint accounts_nature_check check (nature in ('debit', 'credit'));
alter table public.accounts drop constraint if exists accounts_term_check;
alter table public.accounts add constraint accounts_term_check check (term is null or (term in ('short', 'long') and account_type in ('asset', 'liability')));

comment on column public.accounts.nature is 'Normal balance side: debit (débitrice) or credit (créditrice).';
comment on column public.accounts.term is 'Assets and liabilities only: short (court terme) or long (long terme).';

-- ---------------------------------------------------------------------------
-- Journal entries: type, reference, justification, void trace
-- ---------------------------------------------------------------------------
alter table public.journal_entries add column if not exists entry_type text not null default 'standard';
alter table public.journal_entries add column if not exists reference text;
alter table public.journal_entries add column if not exists justification text;
alter table public.journal_entries add column if not exists voided_by uuid references public.profiles(id) on delete restrict;
alter table public.journal_entries add column if not exists voided_at timestamptz;
alter table public.journal_entries add column if not exists void_reason text;

update public.journal_entries set entry_type = 'sale' where reference_type = 'sale' and entry_type = 'standard';
update public.journal_entries set entry_type = 'expense' where reference_type = 'expense' and entry_type = 'standard';

alter table public.journal_entries drop constraint if exists journal_entries_entry_type_check;
alter table public.journal_entries add constraint journal_entries_entry_type_check
  check (entry_type in ('standard', 'regularisation', 'opening', 'sale', 'expense', 'petty_cash', 'cash'));
alter table public.journal_entries drop constraint if exists journal_entries_void_trace;
-- NOT VALID: older voided entries without a reason are kept as they are.
alter table public.journal_entries add constraint journal_entries_void_trace
  check (status <> 'voided' or (voided_at is not null and nullif(trim(void_reason), '') is not null)) not valid;

create index if not exists journal_entries_date_status_idx on public.journal_entries (entry_date, status);
create index if not exists journal_entry_lines_account_idx on public.journal_entry_lines (account_id);

-- Totals are always recomputed from the lines. Drafts may be unbalanced while
-- they are being prepared; an entry can only be posted balanced, with at least
-- two lines and a non-zero amount.
create or replace function public.validate_journal_entry_balance() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_debit numeric(14,2); v_credit numeric(14,2); v_lines integer;
begin
  select coalesce(sum(debit_amount), 0), coalesce(sum(credit_amount), 0), count(*)
    into v_debit, v_credit, v_lines
  from public.journal_entry_lines where journal_entry_id = new.id;
  new.total_debit := v_debit;
  new.total_credit := v_credit;
  if new.status = 'posted' and (tg_op = 'INSERT' or old.status is distinct from 'posted') then
    if v_lines < 2 then raise exception 'Une écriture doit comporter au moins deux lignes'; end if;
    if v_debit = 0 then raise exception 'Une écriture ne peut pas être nulle'; end if;
    if abs(v_debit - v_credit) > 0.005 then
      raise exception 'Écriture déséquilibrée : débit %, crédit % (écart %)', v_debit, v_credit, abs(v_debit - v_credit);
    end if;
  end if;
  return new;
end;
$$;

-- Lines of a posted or voided entry are frozen. Automatic entries (sales,
-- expenses) set pos.journal_system so they can write their own lines.
create or replace function public.guard_journal_entry_lines() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_status text;
begin
  select status into v_status from public.journal_entries where id = coalesce(new.journal_entry_id, old.journal_entry_id);
  if v_status is distinct from 'draft' and coalesce(current_setting('pos.journal_system', true), '') <> 'true' then
    raise exception 'Écriture validée ou annulée : ses lignes ne peuvent plus être modifiées';
  end if;
  return coalesce(new, old);
end;
$$;
drop trigger if exists journal_entry_lines_guard on public.journal_entry_lines;
create trigger journal_entry_lines_guard before insert or update or delete on public.journal_entry_lines
  for each row execute function public.guard_journal_entry_lines();

-- ---------------------------------------------------------------------------
-- History of every change to an entry
-- ---------------------------------------------------------------------------
create table if not exists public.journal_entry_history (
  id uuid primary key default gen_random_uuid(),
  journal_entry_id uuid not null references public.journal_entries(id) on delete cascade,
  action text not null check (action in ('created', 'updated', 'posted', 'voided')),
  changed_by uuid references public.profiles(id) on delete set null default auth.uid(),
  changed_at timestamptz not null default now(),
  reason text,
  snapshot jsonb not null
);
create index if not exists journal_entry_history_entry_idx on public.journal_entry_history (journal_entry_id, changed_at);
alter table public.journal_entry_history enable row level security;
revoke insert, update, delete, truncate on public.journal_entry_history from anon, authenticated;

create or replace function public.journal_entry_snapshot(p_entry_id uuid) returns jsonb
language sql stable security definer set search_path = public as $$
  select to_jsonb(je) || jsonb_build_object('lines', coalesce((
    select jsonb_agg(jsonb_build_object('account_id', l.account_id, 'code', a.code, 'name', a.name, 'description', l.description,
      'debit_amount', l.debit_amount, 'credit_amount', l.credit_amount, 'line_number', l.line_number) order by l.line_number)
    from public.journal_entry_lines l join public.accounts a on a.id = l.account_id where l.journal_entry_id = je.id), '[]'::jsonb))
  from public.journal_entries je where je.id = p_entry_id;
$$;

create or replace function public.record_journal_history(p_entry_id uuid, p_action text, p_reason text default null) returns void
language sql security definer set search_path = public as $$
  insert into public.journal_entry_history (journal_entry_id, action, reason, snapshot)
  values (p_entry_id, p_action, p_reason, public.journal_entry_snapshot(p_entry_id));
$$;

-- ---------------------------------------------------------------------------
-- Read access for the accounting roles; writes only through the functions
-- ---------------------------------------------------------------------------
do $$
declare r record;
begin
  for r in select policyname, tablename from pg_policies
    where schemaname = 'public' and tablename in ('accounts', 'journal_entries', 'journal_entry_lines', 'accounting_periods', 'journal_entry_history')
  loop
    execute format('drop policy %I on public.%I', r.policyname, r.tablename);
  end loop;
end $$;

create policy "accounting read accounts" on public.accounts for select to authenticated using (public.can_manage_accounting());
create policy "accounting read entries" on public.journal_entries for select to authenticated using (public.can_manage_accounting());
create policy "accounting read lines" on public.journal_entry_lines for select to authenticated using (public.can_manage_accounting());
create policy "accounting read periods" on public.accounting_periods for select to authenticated using (public.can_manage_accounting());
create policy "accounting read history" on public.journal_entry_history for select to authenticated using (public.can_manage_accounting());

-- ---------------------------------------------------------------------------
-- Periods: entries are attached to the period covering their date
-- ---------------------------------------------------------------------------
create or replace function public.accounting_period_for(p_date date) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_period public.accounting_periods;
begin
  select * into v_period from public.accounting_periods where p_date between start_date and end_date order by start_date desc limit 1;
  if not found then
    insert into public.accounting_periods (name, start_date, end_date)
    values (to_char(p_date, 'YYYY-MM'), date_trunc('month', p_date)::date, (date_trunc('month', p_date) + interval '1 month - 1 day')::date)
    on conflict (name) do nothing;
    select * into v_period from public.accounting_periods where p_date between start_date and end_date order by start_date desc limit 1;
    if not found then raise exception 'Aucune période comptable ne couvre le %', p_date; end if;
  end if;
  if v_period.is_closed then raise exception 'La période % est clôturée', v_period.name; end if;
  return v_period.id;
end;
$$;

-- ---------------------------------------------------------------------------
-- Chart of accounts
-- ---------------------------------------------------------------------------
create or replace function public.save_account(
  p_id uuid, p_code text, p_name text, p_account_type text,
  p_nature text default null, p_term text default null, p_parent_id uuid default null, p_description text default null
) returns public.accounts language plpgsql security definer set search_path = public as $$
declare v_account public.accounts; v_parent uuid := p_parent_id; v_depth integer := 0;
begin
  if not public.can_manage_accounting() then raise exception 'Permission refusée'; end if;
  if p_account_type not in ('asset', 'liability', 'equity', 'revenue', 'expense') then raise exception 'Type de compte invalide'; end if;
  if p_account_type not in ('asset', 'liability') and p_term is not null then raise exception 'Le terme ne concerne que les comptes d''actif et de passif'; end if;
  -- The parent chain must not loop back to this account.
  while v_parent is not null loop
    if v_parent = p_id then raise exception 'Un compte ne peut pas être son propre parent'; end if;
    v_depth := v_depth + 1;
    if v_depth > 20 then raise exception 'Hiérarchie de comptes trop profonde'; end if;
    select parent_id into v_parent from public.accounts where id = v_parent;
    if not found and v_depth = 1 then raise exception 'Compte parent introuvable'; end if;
  end loop;

  if p_id is null then
    insert into public.accounts (code, name, account_type, nature, term, parent_id, description)
    values (trim(p_code), trim(p_name), p_account_type,
      coalesce(p_nature, case when p_account_type in ('asset', 'expense') then 'debit' else 'credit' end),
      p_term, p_parent_id, nullif(trim(p_description), ''))
    returning * into v_account;
    perform public.log_audit('account_created', 'accounts', v_account.id, null, to_jsonb(v_account), true);
  else
    select * into v_account from public.accounts where id = p_id for update;
    if not found then raise exception 'Compte introuvable'; end if;
    -- Changing the type of a used account would silently move it between statements.
    if v_account.account_type <> p_account_type and exists (select 1 from public.journal_entry_lines where account_id = p_id) then
      raise exception 'Ce compte a déjà des écritures : son type ne peut plus être changé';
    end if;
    update public.accounts set code = trim(p_code), name = trim(p_name), account_type = p_account_type,
      nature = coalesce(p_nature, nature), term = p_term, parent_id = p_parent_id, description = nullif(trim(p_description), '')
    where id = p_id returning * into v_account;
    perform public.log_audit('account_updated', 'accounts', v_account.id, null, to_jsonb(v_account), true);
  end if;
  return v_account;
exception when unique_violation then
  raise exception 'Le code % est déjà utilisé', trim(p_code);
end;
$$;

create or replace function public.set_account_active(p_id uuid, p_active boolean) returns public.accounts
language plpgsql security definer set search_path = public as $$
declare v_account public.accounts;
begin
  if not public.can_manage_accounting() then raise exception 'Permission refusée'; end if;
  update public.accounts set is_active = p_active where id = p_id returning * into v_account;
  if not found then raise exception 'Compte introuvable'; end if;
  perform public.log_audit(case when p_active then 'account_activated' else 'account_deactivated' end, 'accounts', p_id, null, null, true);
  return v_account;
end;
$$;

-- ---------------------------------------------------------------------------
-- Journal entries
-- ---------------------------------------------------------------------------
-- Creates (p_entry_id null) or replaces a draft with its lines, atomically.
-- p_lines: [{ "account_id": uuid, "description": text, "debit": number, "credit": number }, ...]
create or replace function public.save_journal_entry(
  p_entry_id uuid, p_entry_date date, p_description text, p_reference text default null,
  p_entry_type text default 'standard', p_justification text default null, p_lines jsonb default '[]'::jsonb
) returns public.journal_entries language plpgsql security definer set search_path = public as $$
declare v_entry public.journal_entries; v_line record; v_period uuid; v_number integer := 0;
begin
  if not public.can_manage_accounting() then raise exception 'Permission refusée'; end if;
  if p_entry_type not in ('standard', 'regularisation', 'opening') then raise exception 'Type d''écriture invalide'; end if;
  if p_entry_date is null then raise exception 'La date est obligatoire'; end if;
  if nullif(trim(p_description), '') is null then raise exception 'Le libellé est obligatoire'; end if;
  if p_entry_type = 'regularisation' and nullif(trim(p_justification), '') is null then raise exception 'Une régularisation doit être justifiée'; end if;
  if jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) < 2 then raise exception 'Une écriture doit comporter au moins deux lignes'; end if;
  v_period := public.accounting_period_for(p_entry_date);

  if p_entry_id is null then
    insert into public.journal_entries (period_id, entry_date, description, reference, entry_type, justification, status, created_by)
    values (v_period, p_entry_date, trim(p_description), nullif(trim(p_reference), ''), p_entry_type, nullif(trim(p_justification), ''), 'draft', auth.uid())
    returning * into v_entry;
  else
    select * into v_entry from public.journal_entries where id = p_entry_id for update;
    if not found then raise exception 'Écriture introuvable'; end if;
    if v_entry.status <> 'draft' then raise exception 'Seules les écritures en brouillon peuvent être modifiées'; end if;
    if v_entry.entry_type not in ('standard', 'regularisation', 'opening') then raise exception 'Les écritures automatiques ne se modifient pas manuellement'; end if;
    delete from public.journal_entry_lines where journal_entry_id = p_entry_id;
  end if;

  for v_line in select * from jsonb_to_recordset(p_lines) as x(account_id uuid, description text, debit numeric, credit numeric) loop
    v_number := v_number + 1;
    if v_line.account_id is null then raise exception 'Ligne % : compte manquant', v_number; end if;
    if not exists (select 1 from public.accounts where id = v_line.account_id and is_active) then raise exception 'Ligne % : compte inactif ou introuvable', v_number; end if;
    if coalesce(v_line.debit, 0) < 0 or coalesce(v_line.credit, 0) < 0 then raise exception 'Ligne % : montant négatif', v_number; end if;
    if (coalesce(v_line.debit, 0) > 0) = (coalesce(v_line.credit, 0) > 0) then raise exception 'Ligne % : saisir soit un débit, soit un crédit', v_number; end if;
    insert into public.journal_entry_lines (journal_entry_id, account_id, description, debit_amount, credit_amount, line_number)
    values (v_entry.id, v_line.account_id, nullif(trim(v_line.description), ''), round(coalesce(v_line.debit, 0), 2), round(coalesce(v_line.credit, 0), 2), v_number);
  end loop;

  update public.journal_entries
     set period_id = v_period, entry_date = p_entry_date, description = trim(p_description), reference = nullif(trim(p_reference), ''),
         entry_type = p_entry_type, justification = nullif(trim(p_justification), '')
   where id = v_entry.id returning * into v_entry;
  perform public.record_journal_history(v_entry.id, case when p_entry_id is null then 'created' else 'updated' end);
  return v_entry;
end;
$$;

create or replace function public.post_journal_entry(p_entry_id uuid) returns boolean
language plpgsql security definer set search_path = public as $$
declare v_entry public.journal_entries;
begin
  if not public.can_manage_accounting() then raise exception 'Permission refusée'; end if;
  select * into v_entry from public.journal_entries where id = p_entry_id for update;
  if not found or v_entry.status <> 'draft' then raise exception 'Seules les écritures en brouillon peuvent être validées'; end if;
  perform public.accounting_period_for(v_entry.entry_date);
  -- The balance trigger refuses the change if the entry is not balanced.
  update public.journal_entries set status = 'posted', posted_by = auth.uid(), posted_at = now() where id = p_entry_id;
  perform public.record_journal_history(p_entry_id, 'posted');
  perform public.log_audit('journal_entry_posted', 'journal_entries', p_entry_id, jsonb_build_object('status', 'draft'), jsonb_build_object('status', 'posted'), true);
  return true;
end;
$$;

-- A voided entry stays visible with who, when and why; it no longer counts in balances.
create or replace function public.void_journal_entry(p_entry_id uuid, p_reason text) returns public.journal_entries
language plpgsql security definer set search_path = public as $$
declare v_entry public.journal_entries;
begin
  if not public.can_manage_accounting() then raise exception 'Permission refusée'; end if;
  if char_length(coalesce(trim(p_reason), '')) < 3 then raise exception 'Indiquez le motif de l''annulation'; end if;
  select * into v_entry from public.journal_entries where id = p_entry_id for update;
  if not found then raise exception 'Écriture introuvable'; end if;
  if v_entry.status = 'voided' then raise exception 'Cette écriture est déjà annulée'; end if;
  if v_entry.status = 'posted' then perform public.accounting_period_for(v_entry.entry_date); end if;
  update public.journal_entries set status = 'voided', voided_by = auth.uid(), voided_at = now(), void_reason = trim(p_reason)
   where id = p_entry_id returning * into v_entry;
  perform public.record_journal_history(p_entry_id, 'voided', trim(p_reason));
  perform public.log_audit('journal_entry_voided', 'journal_entries', p_entry_id, null, jsonb_build_object('reason', trim(p_reason)), true);
  return v_entry;
end;
$$;

-- ---------------------------------------------------------------------------
-- Balances: the one source for the account selector and every report
-- ---------------------------------------------------------------------------
-- Posted entries only. Opening = before p_from; movements between p_from and
-- p_to, with regularisation entries reported separately; closing = all three.
-- balance is the closing amount on the account's own side (positive = normal).
create or replace function public.account_balances(p_from date default null, p_to date default null)
returns table (
  account_id uuid, code text, name text, account_type text, nature text, term text, parent_id uuid, is_active boolean,
  opening_debit numeric, opening_credit numeric, period_debit numeric, period_credit numeric,
  regularisation_debit numeric, regularisation_credit numeric, closing_debit numeric, closing_credit numeric, balance numeric
) language plpgsql stable security definer set search_path = public as $$
begin
  if not public.can_manage_accounting() then raise exception 'Permission refusée'; end if;
  if p_from is not null and p_to is not null and p_from > p_to then raise exception 'La date de début ne peut pas être postérieure à la date de fin'; end if;
  return query
  with lines as (
    select l.account_id, l.debit_amount d, l.credit_amount c, je.entry_date, je.entry_type
    from public.journal_entry_lines l join public.journal_entries je on je.id = l.journal_entry_id
    where je.status = 'posted' and (p_to is null or je.entry_date <= p_to)
  ), sums as (
    select a.id,
      coalesce(sum(x.d) filter (where p_from is not null and x.entry_date < p_from), 0) od,
      coalesce(sum(x.c) filter (where p_from is not null and x.entry_date < p_from), 0) oc,
      coalesce(sum(x.d) filter (where (p_from is null or x.entry_date >= p_from) and x.entry_type <> 'regularisation'), 0) pd,
      coalesce(sum(x.c) filter (where (p_from is null or x.entry_date >= p_from) and x.entry_type <> 'regularisation'), 0) pc,
      coalesce(sum(x.d) filter (where (p_from is null or x.entry_date >= p_from) and x.entry_type = 'regularisation'), 0) rd,
      coalesce(sum(x.c) filter (where (p_from is null or x.entry_date >= p_from) and x.entry_type = 'regularisation'), 0) rc
    from public.accounts a left join lines x on x.account_id = a.id
    group by a.id
  )
  select a.id, a.code, a.name, a.account_type, a.nature, a.term, a.parent_id, a.is_active,
    s.od, s.oc, s.pd, s.pc, s.rd, s.rc, s.od + s.pd + s.rd, s.oc + s.pc + s.rc,
    case when a.nature = 'debit' then (s.od + s.pd + s.rd) - (s.oc + s.pc + s.rc) else (s.oc + s.pc + s.rc) - (s.od + s.pd + s.rd) end
  from public.accounts a join sums s on s.id = a.id
  order by a.code;
end;
$$;

revoke all on function public.save_account(uuid, text, text, text, text, text, uuid, text) from public, anon;
revoke all on function public.set_account_active(uuid, boolean) from public, anon;
revoke all on function public.save_journal_entry(uuid, date, text, text, text, text, jsonb) from public, anon;
revoke all on function public.post_journal_entry(uuid) from public, anon;
revoke all on function public.void_journal_entry(uuid, text) from public, anon;
revoke all on function public.account_balances(date, date) from public, anon;
-- Supabase grants new functions to anon and authenticated by default, so the
-- revokes name them explicitly. Internal helpers are not callable at all.
revoke all on function public.record_journal_history(uuid, text, text) from public, anon, authenticated;
revoke all on function public.accounting_period_for(date) from public, anon, authenticated;
revoke all on function public.journal_entry_snapshot(uuid) from public, anon, authenticated;
revoke all on function public.can_manage_accounting() from public, anon;
grant execute on function public.can_manage_accounting() to authenticated;
grant execute on function public.save_account(uuid, text, text, text, text, text, uuid, text) to authenticated;
grant execute on function public.set_account_active(uuid, boolean) to authenticated;
grant execute on function public.save_journal_entry(uuid, date, text, text, text, text, jsonb) to authenticated;
grant execute on function public.post_journal_entry(uuid) to authenticated;
grant execute on function public.void_journal_entry(uuid, text) to authenticated;
grant execute on function public.account_balances(date, date) to authenticated;

notify pgrst, 'reload schema';
