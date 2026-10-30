-- One application identity model for Maket Peyizan.
-- This migration repairs older installations where user_profiles and profiles
-- could disagree, and moves sensitive cash-register writes into RPCs.

-- Copy profiles from the legacy user_profiles table, when it exists.
do $$
begin
  if to_regclass('public.user_profiles') is not null then
    execute $sql$insert into public.profiles (id, full_name, email, role_id, active)
select
  up.id,
  coalesce(up.full_name, u.email, ''),
  coalesce(u.email, ''),
  (select id from public.roles where code = case
    when up.role in ('owner', 'responsable') then 'director'
    when up.role = 'admin' then 'administrator'
    when up.role = 'accountant' then 'accountant'
    when up.role = 'stock_manager' then 'stock_manager'
    else 'cashier'
  end),
  up.is_active
from public.user_profiles up
join auth.users u on u.id = up.id
on conflict (id) do update set
  full_name = excluded.full_name,
  email = excluded.email,
  role_id = excluded.role_id,
  active = excluded.active$sql$;
  end if;
end $$;

create or replace function public.create_first_admin_user(user_uuid uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_name text;
begin
  if auth.uid() is null or auth.uid() <> user_uuid then
    raise exception 'You can only initialize your own account';
  end if;
  if public.is_initial_setup_complete() then
    raise exception 'Initial owner already exists';
  end if;
  select coalesce(raw_user_meta_data ->> 'full_name', email, 'Administrateur')
    into v_name from auth.users where id = user_uuid;
  if v_name is null then raise exception 'User not found'; end if;

  -- handle_new_user() normally created the profile at sign-up; create it if not.
  insert into public.profiles (id, full_name, email, role_id, active)
  select user_uuid, v_name, coalesce(u.email, ''), (select id from public.roles where code = 'director'), true
  from auth.users u where u.id = user_uuid
  on conflict (id) do update
    set full_name = excluded.full_name, active = true, role_id = excluded.role_id;
  return jsonb_build_object('success', true, 'message', 'Owner initialized');
end;
$$;

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
  if exists (select 1 from public.cash_sessions where opened_by = auth.uid() and closed_at is null) then
    raise exception 'A cash session is already open';
  end if;
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
  if auth.uid() is null or not (public.has_role('cashier') or public.has_role('director') or public.has_role('administrator')) then
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

revoke all on function public.open_cash_session(numeric, text) from public;
revoke all on function public.close_cash_session(numeric, text) from public;
grant execute on function public.open_cash_session(numeric, text) to authenticated;
grant execute on function public.close_cash_session(numeric, text) to authenticated;

-- Directors are the business owners in this application. They can manage staff
-- and settings; cashiers, stock managers and accountants retain limited access.
drop policy if exists "profiles self or administrator read" on public.profiles;
drop policy if exists "profiles administrator manage" on public.profiles;
drop policy if exists "profiles staff read" on public.profiles;
create policy "profiles staff read" on public.profiles for select to authenticated
  using (id = auth.uid() or public.has_role('director') or public.has_role('administrator'));
drop policy if exists "profiles director manage" on public.profiles;
create policy "profiles director manage" on public.profiles for update to authenticated
  using ((public.has_role('director') or public.has_role('administrator')) and id <> auth.uid())
  with check ((public.has_role('director') or public.has_role('administrator')) and id <> auth.uid());

drop policy if exists "settings administrator manage" on public.settings;
drop policy if exists "settings director manage" on public.settings;
create policy "settings director manage" on public.settings for all to authenticated
  using (public.has_role('director') or public.has_role('administrator'))
  with check (public.has_role('director') or public.has_role('administrator'));

notify pgrst, 'reload schema';
