-- Financial statements (step 3 of the accounting corrections).
-- Each revenue and expense account states which income statement line it feeds,
-- so the statement can show gross sales, deductions, net sales, cost of goods
-- sold and gross margin explicitly. Balance sheet accounts use `term` (step 1).

alter table public.accounts add column if not exists statement_group text;

-- Default chart: 401-402 sales, 403-406 other income, 501 cost of goods sold.
update public.accounts set statement_group = case
    when account_type = 'revenue' and nature = 'debit' then 'sales_deduction'
    when account_type = 'revenue' and code in ('401000', '402000') then 'sales'
    when account_type = 'revenue' then 'other_income'
    when account_type = 'expense' and code = '501000' then 'cogs'
    when account_type = 'expense' then 'expense'
  end
where statement_group is null and account_type in ('revenue', 'expense');

-- Discounts and returns are recorded as reductions of sales (contra-revenue).
insert into public.accounts (code, name, account_type, nature, statement_group, description) values
  ('408000', 'Retours et annulations sur ventes', 'revenue', 'debit', 'sales_deduction', 'Réduction des ventes : marchandises retournées, ventes annulées'),
  ('409000', 'Remises et rabais accordés', 'revenue', 'debit', 'sales_deduction', 'Réduction des ventes : remises accordées aux clients')
on conflict (code) do nothing;

alter table public.accounts drop constraint if exists accounts_statement_group_check;
alter table public.accounts add constraint accounts_statement_group_check check (
  (account_type = 'revenue' and statement_group in ('sales', 'sales_deduction', 'other_income'))
  or (account_type = 'expense' and statement_group in ('cogs', 'expense'))
  or (account_type in ('asset', 'liability', 'equity') and statement_group is null)
);
comment on column public.accounts.statement_group is 'Income statement line: sales, sales_deduction, other_income, cogs or expense.';

-- save_account gains the statement group; the previous signature is replaced.
drop function if exists public.save_account(uuid, text, text, text, text, text, uuid, text);
create or replace function public.save_account(
  p_id uuid, p_code text, p_name text, p_account_type text,
  p_nature text default null, p_term text default null, p_parent_id uuid default null, p_description text default null,
  p_statement_group text default null
) returns public.accounts language plpgsql security definer set search_path = public as $$
declare v_account public.accounts; v_parent uuid := p_parent_id; v_depth integer := 0; v_nature text; v_group text;
begin
  if not public.can_manage_accounting() then raise exception 'Permission refusée'; end if;
  if p_account_type not in ('asset', 'liability', 'equity', 'revenue', 'expense') then raise exception 'Type de compte invalide'; end if;
  if p_account_type not in ('asset', 'liability') and p_term is not null then raise exception 'Le terme ne concerne que les comptes d''actif et de passif'; end if;
  while v_parent is not null loop
    if v_parent = p_id then raise exception 'Un compte ne peut pas être son propre parent'; end if;
    v_depth := v_depth + 1;
    if v_depth > 20 then raise exception 'Hiérarchie de comptes trop profonde'; end if;
    select parent_id into v_parent from public.accounts where id = v_parent;
    if not found and v_depth = 1 then raise exception 'Compte parent introuvable'; end if;
  end loop;
  v_nature := coalesce(p_nature, case when p_account_type in ('asset', 'expense') then 'debit' else 'credit' end);
  v_group := case
    when p_account_type = 'revenue' then coalesce(p_statement_group, case when v_nature = 'debit' then 'sales_deduction' else 'sales' end)
    when p_account_type = 'expense' then coalesce(p_statement_group, 'expense')
  end;

  if p_id is null then
    insert into public.accounts (code, name, account_type, nature, term, parent_id, description, statement_group)
    values (trim(p_code), trim(p_name), p_account_type, v_nature, p_term, p_parent_id, nullif(trim(p_description), ''), v_group)
    returning * into v_account;
    perform public.log_audit('account_created', 'accounts', v_account.id, null, to_jsonb(v_account), true);
  else
    select * into v_account from public.accounts where id = p_id for update;
    if not found then raise exception 'Compte introuvable'; end if;
    if v_account.account_type <> p_account_type and exists (select 1 from public.journal_entry_lines where account_id = p_id) then
      raise exception 'Ce compte a déjà des écritures : son type ne peut plus être changé';
    end if;
    update public.accounts set code = trim(p_code), name = trim(p_name), account_type = p_account_type,
      nature = v_nature, term = p_term, parent_id = p_parent_id, description = nullif(trim(p_description), ''), statement_group = v_group
    where id = p_id returning * into v_account;
    perform public.log_audit('account_updated', 'accounts', v_account.id, null, to_jsonb(v_account), true);
  end if;
  return v_account;
exception when unique_violation then
  raise exception 'Le code % est déjà utilisé', trim(p_code);
end;
$$;

-- account_balances also returns the statement group (return type change: drop first).
drop function if exists public.account_balances(date, date);
create or replace function public.account_balances(p_from date default null, p_to date default null)
returns table (
  account_id uuid, code text, name text, account_type text, nature text, term text, statement_group text, parent_id uuid, is_active boolean,
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
  select a.id, a.code, a.name, a.account_type, a.nature, a.term, a.statement_group, a.parent_id, a.is_active,
    s.od, s.oc, s.pd, s.pc, s.rd, s.rc, s.od + s.pd + s.rd, s.oc + s.pc + s.rc,
    case when a.nature = 'debit' then (s.od + s.pd + s.rd) - (s.oc + s.pc + s.rc) else (s.oc + s.pc + s.rc) - (s.od + s.pd + s.rd) end
  from public.accounts a join sums s on s.id = a.id
  order by a.code;
end;
$$;

revoke all on function public.save_account(uuid, text, text, text, text, text, uuid, text, text) from public, anon;
revoke all on function public.account_balances(date, date) from public, anon;
grant execute on function public.save_account(uuid, text, text, text, text, text, uuid, text, text) to authenticated;
grant execute on function public.account_balances(date, date) to authenticated;

notify pgrst, 'reload schema';
