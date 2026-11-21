-- Partners (associés) for the partners' equity statement (step 4).
-- Each partner gets two equity accounts: capital (3011NN) and current account
-- (3021NN). Contributions, withdrawals and adjustments are ordinary journal
-- entries on these accounts; the statement classifies them.

-- Parent account for the partners' current accounts.
insert into public.accounts (code, name, account_type, nature, description)
values ('302000', 'Comptes courants des associés', 'equity', 'credit', 'Apports en compte courant et prélèvements des associés')
on conflict (code) do nothing;

create table if not exists public.partners (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(trim(name)) between 1 and 120),
  share_percent numeric(5,2) check (share_percent is null or (share_percent >= 0 and share_percent <= 100)),
  capital_account_id uuid not null unique references public.accounts(id) on delete restrict,
  current_account_id uuid not null unique references public.accounts(id) on delete restrict,
  is_active boolean not null default true,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
comment on column public.partners.share_percent is 'Share of profits and losses (%); null when the result is not split.';
drop trigger if exists partners_set_updated_at on public.partners;
create trigger partners_set_updated_at before update on public.partners for each row execute function public.set_updated_at();

alter table public.partners enable row level security;
drop policy if exists "accounting read partners" on public.partners;
create policy "accounting read partners" on public.partners for select to authenticated using (public.can_manage_accounting());
revoke insert, update, delete, truncate on public.partners from anon, authenticated;

-- Next free code under a 4-digit prefix, e.g. 3011 → 301101, 301102…
create or replace function public.next_account_code(p_prefix text) returns text
language sql stable security definer set search_path = public as $$
  select p_prefix || lpad((coalesce(max(right(code, 2)::integer), 0) + 1)::text, 2, '0')
  from public.accounts where code ~ ('^' || p_prefix || '[0-9]{2}$');
$$;

create or replace function public.save_partner(p_id uuid, p_name text, p_share_percent numeric default null, p_notes text default null)
returns public.partners language plpgsql security definer set search_path = public as $$
declare v_partner public.partners; v_capital uuid; v_current uuid; v_total numeric;
begin
  if not public.can_manage_accounting() then raise exception 'Permission refusée'; end if;
  if nullif(trim(p_name), '') is null then raise exception 'Le nom de l''associé est obligatoire'; end if;
  if p_share_percent is not null and (p_share_percent < 0 or p_share_percent > 100) then raise exception 'La part doit être comprise entre 0 et 100 %%'; end if;
  select coalesce(sum(share_percent), 0) into v_total from public.partners where is_active and id is distinct from p_id;
  if v_total + coalesce(p_share_percent, 0) > 100 then
    raise exception 'Le total des parts dépasserait 100 %% (déjà attribué : % %%)', replace(rtrim(rtrim(v_total::text, '0'), '.'), '.', ',');
  end if;

  if p_id is null then
    if public.next_account_code('3011') > '301199' then raise exception 'Nombre maximal d''associés atteint'; end if;
    insert into public.accounts (code, name, account_type, nature, parent_id, description)
    values (public.next_account_code('3011'), 'Capital - ' || trim(p_name), 'equity', 'credit', (select id from public.accounts where code = '301000'), 'Capital de l''associé')
    returning id into v_capital;
    insert into public.accounts (code, name, account_type, nature, parent_id, description)
    values (public.next_account_code('3021'), 'Compte courant - ' || trim(p_name), 'equity', 'credit', (select id from public.accounts where code = '302000'), 'Apports et prélèvements de l''associé')
    returning id into v_current;
    insert into public.partners (name, share_percent, capital_account_id, current_account_id, notes)
    values (trim(p_name), p_share_percent, v_capital, v_current, nullif(trim(p_notes), ''))
    returning * into v_partner;
    perform public.log_audit('partner_created', 'partners', v_partner.id, null, to_jsonb(v_partner), true);
  else
    update public.partners set name = trim(p_name), share_percent = p_share_percent, notes = nullif(trim(p_notes), '')
     where id = p_id returning * into v_partner;
    if not found then raise exception 'Associé introuvable'; end if;
    update public.accounts set name = 'Capital - ' || trim(p_name) where id = v_partner.capital_account_id;
    update public.accounts set name = 'Compte courant - ' || trim(p_name) where id = v_partner.current_account_id;
    perform public.log_audit('partner_updated', 'partners', v_partner.id, null, to_jsonb(v_partner), true);
  end if;
  return v_partner;
end;
$$;

-- Leaving partners keep their history; their accounts stay usable for the final settlement.
create or replace function public.set_partner_active(p_id uuid, p_active boolean) returns public.partners
language plpgsql security definer set search_path = public as $$
declare v_partner public.partners; v_total numeric;
begin
  if not public.can_manage_accounting() then raise exception 'Permission refusée'; end if;
  select * into v_partner from public.partners where id = p_id for update;
  if not found then raise exception 'Associé introuvable'; end if;
  if p_active then
    select coalesce(sum(share_percent), 0) into v_total from public.partners where is_active and id <> p_id;
    if v_total + coalesce(v_partner.share_percent, 0) > 100 then raise exception 'Le total des parts dépasserait 100 %%'; end if;
  end if;
  update public.partners set is_active = p_active where id = p_id returning * into v_partner;
  perform public.log_audit(case when p_active then 'partner_activated' else 'partner_deactivated' end, 'partners', p_id, null, null, true);
  return v_partner;
end;
$$;

-- Supabase grants new functions to anon by default: name it explicitly.
revoke all on function public.next_account_code(text) from public, anon, authenticated;
revoke all on function public.save_partner(uuid, text, numeric, text) from public, anon;
revoke all on function public.set_partner_active(uuid, boolean) from public, anon;
grant execute on function public.save_partner(uuid, text, numeric, text) to authenticated;
grant execute on function public.set_partner_active(uuid, boolean) to authenticated;

notify pgrst, 'reload schema';
