-- Étape F1 : nom d'utilisateur (connexion par nom d'utilisateur ou par e-mail).
-- Accounts are created by the `users` Edge Function (it holds the secret key);
-- the browser never creates accounts directly.
alter table public.profiles add column if not exists username text;
alter table public.profiles drop constraint if exists profiles_username_format;
alter table public.profiles add constraint profiles_username_format
  check (username is null or username ~ '^[a-z0-9][a-z0-9._-]{2,31}$');
create unique index if not exists profiles_username_key on public.profiles (lower(username)) where username is not null;
comment on column public.profiles.username is 'Login name (lowercase letters, digits, dot, dash, underscore; 3 to 32 characters).';
