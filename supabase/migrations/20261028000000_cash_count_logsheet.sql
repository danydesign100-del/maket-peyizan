-- Cash count logsheet: counts of the drawer at the start and end of each shift,
-- in gourdes (HTG) and US dollars (USD). Entries are an audit trail: they can be
-- added but never changed or deleted; a correction is a new entry with a note.

create table if not exists public.cash_counts (
  id uuid primary key default gen_random_uuid(),
  shift text not null check (shift in ('AM', 'PM', 'NIGHT')),
  direction text not null check (direction in ('in', 'out')),
  -- Time of the count on the device, kept when an offline entry syncs later.
  counted_at timestamptz not null default now() check (counted_at <= now() + interval '5 minutes'),
  submitted_by uuid not null default auth.uid() references public.profiles(id) on delete restrict,
  htg jsonb not null default '{}'::jsonb,
  usd jsonb not null default '{}'::jsonb,
  htg_total numeric(14,2) not null default 0,
  usd_total numeric(14,2) not null default 0,
  htg_over_short numeric(14,2) not null default 0,
  usd_over_short numeric(14,2) not null default 0,
  notes text check (notes is null or char_length(notes) <= 1000),
  created_at timestamptz not null default now()
);

create index if not exists cash_counts_counted_at_idx on public.cash_counts (counted_at desc);

-- Validates one currency block and returns it cleaned, with its totals.
-- Same rules as src/lib/cashCount.ts:
--   total      = notes and coins counted + rolled coins + checks + paid outs
--   over_short = total - deposit/drop - bank till
create or replace function public.cash_count_currency(p_detail jsonb, p_allowed text[], out detail jsonb, out total numeric, out over_short numeric)
language plpgsql immutable set search_path = public as $$
declare
  v_key text;
  v_quantity numeric;
  v_cash numeric := 0;
  v_counts jsonb := '{}'::jsonb;
  v_field text;
  v_amount numeric;
begin
  if p_detail is null or jsonb_typeof(p_detail) <> 'object' then p_detail := '{}'::jsonb; end if;
  for v_key, v_quantity in select key, value::numeric from jsonb_each_text(coalesce(p_detail->'counts', '{}'::jsonb)) loop
    if not v_key = any(p_allowed) then raise exception 'Coupure invalide : %', v_key using errcode = '22023'; end if;
    if v_quantity < 0 or v_quantity <> trunc(v_quantity) then raise exception 'Quantité invalide pour %', v_key using errcode = '22023'; end if;
    if v_quantity > 0 then
      v_counts := v_counts || jsonb_build_object(v_key, v_quantity);
      v_cash := v_cash + v_key::numeric * v_quantity;
    end if;
  end loop;
  detail := jsonb_build_object('counts', v_counts);
  foreach v_field in array array['rolled_coins', 'checks', 'paid_outs', 'deposit', 'bank_till'] loop
    v_amount := round(coalesce((p_detail->>v_field)::numeric, 0), 2);
    if v_amount < 0 then raise exception 'Montant négatif : %', v_field using errcode = '22023'; end if;
    detail := detail || jsonb_build_object(v_field, v_amount);
  end loop;
  total := round(v_cash + (detail->>'rolled_coins')::numeric + (detail->>'checks')::numeric + (detail->>'paid_outs')::numeric, 2);
  over_short := round(total - (detail->>'deposit')::numeric - (detail->>'bank_till')::numeric, 2);
end;
$$;

-- Totals are never trusted from the browser, and the agent is always the caller.
create or replace function public.cash_counts_before_insert() returns trigger
language plpgsql security definer set search_path = public as $$
declare v record;
begin
  new.submitted_by := auth.uid();
  new.created_at := now();
  new.notes := nullif(trim(new.notes), '');
  select * into v from public.cash_count_currency(new.htg, array['5', '10', '25', '50', '100', '250', '500', '1000']);
  new.htg := v.detail; new.htg_total := v.total; new.htg_over_short := v.over_short;
  select * into v from public.cash_count_currency(new.usd, array['0.01', '0.05', '0.1', '0.25', '1', '5', '10', '20', '50', '100']);
  new.usd := v.detail; new.usd_total := v.total; new.usd_over_short := v.over_short;
  return new;
end;
$$;

drop trigger if exists cash_counts_before_insert on public.cash_counts;
create trigger cash_counts_before_insert before insert on public.cash_counts
  for each row execute function public.cash_counts_before_insert();

alter table public.cash_counts enable row level security;

drop policy if exists "cash counts staff read" on public.cash_counts;
create policy "cash counts staff read" on public.cash_counts for select to authenticated
  using (public.has_role('cashier') or public.has_role('director') or public.has_role('administrator') or public.has_role('accountant'));

drop policy if exists "cash counts register insert" on public.cash_counts;
create policy "cash counts register insert" on public.cash_counts for insert to authenticated
  with check (submitted_by = auth.uid() and (public.has_role('cashier') or public.has_role('director') or public.has_role('administrator')));

-- No update or delete policy: entries are immutable.
revoke update, delete, truncate on public.cash_counts from anon, authenticated;
