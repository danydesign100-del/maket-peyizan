-- Pre-deployment corrections: accounting configuration, RPC exposure and direct-write bypasses.

-- nextval() is volatile and the wrapper must declare the same behavior.
create or replace function public.generate_journal_entry_number()
returns text language sql volatile as $$
  select 'ECR-' || lpad(nextval('public.journal_entry_number_seq')::text, 6, '0');
$$;

-- The accounting function expects UUID values. Resolve the seeded account codes now.
insert into public.settings (key, value, description)
select
  'accounting.accounts',
  jsonb_build_object(
    'cash', (select id::text from public.accounts where code = '101000'),
    'revenue', (select id::text from public.accounts where code = '401000'),
    'tax', (select id::text from public.accounts where code = '210000'),
    'cogs', (select id::text from public.accounts where code = '501000'),
    'inventory', (select id::text from public.accounts where code = '120000')
  ),
  'System account identifiers used by automatic sale journal entries'
on conflict (key) do update set
  value = excluded.value,
  description = excluded.description;

-- Sales must only be created by complete_sale(), which validates all values in one transaction.
drop policy if exists "sales admin or owner insert" on public.sales;
drop policy if exists "sales insert by cashier and director" on public.sales;
drop policy if exists "sale items admin or owner insert" on public.sale_items;
drop policy if exists "sale_items insert by cashier and director" on public.sale_items;
drop policy if exists "payments admin or owner insert" on public.payments;
drop policy if exists "payments insert by cashier and director" on public.payments;

-- Audit rows are append-only system records, never client-provided data.
drop policy if exists "audit_log insert by system" on public.audit_log;
revoke all on function public.log_audit(text, text, uuid, jsonb, jsonb, boolean, text) from public;
revoke all on function public.log_audit(text, text, uuid, jsonb, jsonb, boolean, text) from authenticated;

-- These functions retain explicit in-function role checks. Security definer is required because
-- posting changes a draft to posted, which intentionally has no direct RLS update policy for accountants.
create or replace function public.sync_sale_to_accounting(p_sale_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_journal_entry_id uuid;
begin
  if not (public.has_role('director') or public.has_role('accountant')) then raise exception 'Permission denied'; end if;
  v_journal_entry_id := public.generate_sale_journal_entry(p_sale_id);
  return jsonb_build_object('success', true, 'journal_entry_id', v_journal_entry_id);
end;
$$;

create or replace function public.post_journal_entry(p_entry_id uuid)
returns boolean language plpgsql security definer set search_path = public as $$
begin
  if not (public.has_role('director') or public.has_role('accountant')) then raise exception 'Permission denied'; end if;
  if not exists (select 1 from public.journal_entries where id = p_entry_id and status = 'draft') then raise exception 'Only draft entries can be posted'; end if;
  if exists (select 1 from public.journal_entries je join public.accounting_periods ap on ap.id = je.period_id where je.id = p_entry_id and ap.is_closed) then raise exception 'Accounting period is closed'; end if;
  update public.journal_entries set status = 'posted', posted_by = auth.uid(), posted_at = now() where id = p_entry_id;
  perform public.log_audit('journal_entry_posted', 'journal_entries', p_entry_id, '{"status":"draft"}'::jsonb, '{"status":"posted"}'::jsonb, true);
  return true;
end;
$$;

revoke all on function public.generate_sale_journal_entry(uuid) from public;
revoke all on function public.generate_sale_journal_entry(uuid) from authenticated;
revoke all on function public.sync_sale_to_accounting(uuid) from public;
grant execute on function public.sync_sale_to_accounting(uuid) to authenticated;
revoke all on function public.post_journal_entry(uuid) from public;
grant execute on function public.post_journal_entry(uuid) to authenticated;

-- Only posted journal entries contribute to reports.
create or replace view public.general_ledger as
select je.id as entry_id, je.entry_number, je.entry_date, je.description as entry_description,
  je.status, a.code as account_code, a.name as account_name, a.account_type,
  jel.description as line_description, jel.debit_amount, jel.credit_amount, jel.line_number,
  p.full_name as created_by_name, je.created_at
from public.journal_entries je
join public.journal_entry_lines jel on jel.journal_entry_id = je.id
join public.accounts a on a.id = jel.account_id
left join public.profiles p on p.id = je.created_by
where je.status = 'posted';

create or replace view public.trial_balance as
select a.id as account_id, a.code, a.name, a.account_type, a.parent_id,
  coalesce(sum(jel.debit_amount) filter (where je.id is not null), 0) as total_debit,
  coalesce(sum(jel.credit_amount) filter (where je.id is not null), 0) as total_credit,
  case when a.account_type in ('asset', 'expense') then coalesce(sum(jel.debit_amount) filter (where je.id is not null), 0) - coalesce(sum(jel.credit_amount) filter (where je.id is not null), 0)
       else coalesce(sum(jel.credit_amount) filter (where je.id is not null), 0) - coalesce(sum(jel.debit_amount) filter (where je.id is not null), 0) end as balance
from public.accounts a
left join public.journal_entry_lines jel on jel.account_id = a.id
left join public.journal_entries je on je.id = jel.journal_entry_id and je.status = 'posted'
where a.is_active = true
group by a.id, a.code, a.name, a.account_type, a.parent_id
order by a.code;

grant select on public.general_ledger, public.trial_balance to authenticated;
