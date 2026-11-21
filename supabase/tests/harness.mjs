// Replays every migration on PGlite (Postgres in WebAssembly) with a minimal
// replica of what Supabase provides beforehand: auth/storage schemas, API roles
// and their default privileges. Used by `npm run test:db`.
import { PGlite } from '@electric-sql/pglite'
import { pg_trgm } from '@electric-sql/pglite/contrib/pg_trgm'
import { readdirSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const MIGRATIONS = fileURLToPath(new URL('../migrations/', import.meta.url))

const SUPABASE_BASELINE = `
  create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
  create schema auth; create schema storage; create schema extensions;
  create table auth.users (id uuid primary key default gen_random_uuid(), email text, raw_user_meta_data jsonb default '{}', raw_app_meta_data jsonb default '{}', created_at timestamptz default now(), updated_at timestamptz default now(), email_confirmed_at timestamptz, last_sign_in_at timestamptz);
  create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
  create function auth.role() returns text language sql stable as $$ select nullif(current_setting('request.jwt.claim.role', true), '') $$;
  create function auth.jwt() returns jsonb language sql stable as $$ select coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb $$;
  create table storage.buckets (id text primary key, name text not null, owner uuid, public boolean default false, avif_autodetection boolean default false, file_size_limit bigint, allowed_mime_types text[], created_at timestamptz default now(), updated_at timestamptz default now());
  create table storage.objects (id uuid primary key default gen_random_uuid(), bucket_id text references storage.buckets(id), name text, owner uuid, metadata jsonb, created_at timestamptz default now(), updated_at timestamptz default now());
  alter table storage.objects enable row level security;
  create function storage.foldername(name text) returns text[] language sql immutable as $$ select string_to_array(name, '/') $$;
  grant usage on schema public, auth, storage to anon, authenticated, service_role;
  alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
  alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
  alter default privileges in schema public grant execute on functions to anon, authenticated, service_role;
  grant execute on all functions in schema auth to anon, authenticated;
`

export const migrationFiles = () => readdirSync(MIGRATIONS).filter((file) => file.endsWith('.sql')).sort()

/** pgcrypto is preinstalled on Supabase but absent from PGlite; gen_random_uuid() is core Postgres. */
const readMigration = (file) => readFileSync(MIGRATIONS + file, 'utf8').replace(/create extension if not exists pgcrypto[^;]*;/gi, '')

/** Applies one migration in a transaction, as `supabase db push` does. */
export async function applyMigration(db, file) {
  try {
    await db.exec('begin'); await db.exec(readMigration(file)); await db.exec('commit')
  } catch (error) {
    await db.exec('rollback').catch(() => {})
    throw new Error(`${file}: ${error.message}`)
  }
}

/**
 * Builds a database with every migration applied (or those up to `until`,
 * inclusive, to rehearse an upgrade); throws on the first failing one.
 */
export async function buildDatabase({ log = () => {}, until = null } = {}) {
  const db = new PGlite({ extensions: { pg_trgm } })
  await db.exec(SUPABASE_BASELINE)
  for (const file of migrationFiles().filter((name) => !until || name <= until)) {
    await applyMigration(db, file)
    log(`ok   ${file}`)
  }
  return db
}

/** Runs `sql` as a signed-in user (RLS applies), or as anon when `userId` is null. */
export async function asUser(db, userId, sql, params) {
  await db.exec(`set request.jwt.claim.sub = '${userId ?? ''}'; set role ${userId ? 'authenticated' : 'anon'};`)
  try { return await db.query(sql, params) } finally { await db.exec('reset role') }
}

/** Creates an auth user (the sign-up trigger gives it a cashier profile) and optionally a role. */
export async function createUser(db, { email, name, role }) {
  const { rows: [user] } = await db.query(`insert into auth.users (email, raw_user_meta_data) values ($1, jsonb_build_object('full_name', $2::text)) returning id`, [email, name])
  if (role) await db.query(`update public.profiles set role_id = (select id from public.roles where code = $2) where id = $1`, [user.id, role])
  return user.id
}
