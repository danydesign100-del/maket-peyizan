-- First-administrator bootstrap.
-- The earlier body of this migration wrote to public.user_profiles, a table that
-- only existed on the very first hosted project and is not created by any
-- migration. The function is defined against public.profiles and public.roles
-- in 20261022020000_auth_roles_and_cash_sessions.sql; nothing is needed here.
select 1;
