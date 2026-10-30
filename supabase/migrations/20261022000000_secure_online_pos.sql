-- Setup state for the login page: true once an active director or
-- administrator exists. Readable without signing in (it only returns a boolean).
--
-- Earlier revisions of this file also redefined complete_offline_sale against a
-- legacy schema (user_profiles, sales.local_uuid, sale_items snapshots). That
-- version would have replaced the correct one from
-- 20261021000000_offline_sale_sync.sql and failed at the first sale, so it is gone.

create or replace function public.is_initial_setup_complete()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.profiles p join public.roles r on r.id = p.role_id
    where p.active and r.code in ('director', 'administrator')
  );
$$;

revoke all on function public.is_initial_setup_complete() from public;
grant execute on function public.is_initial_setup_complete() to anon, authenticated;
