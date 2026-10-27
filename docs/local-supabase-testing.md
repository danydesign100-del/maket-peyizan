# Test local Supabase

## Prerequisites

Install Docker Desktop, start it, then install the Supabase CLI. The current machine has neither Docker, PostgreSQL client nor Supabase CLI, so no local database can be started here yet.

## Start an isolated stack

From the repository root, run:

```powershell
npx supabase start
```

The command starts an isolated Supabase stack and applies every SQL file in `supabase/migrations` in filename order. It does not use or modify the remote Supabase project.

Copy the local API URL and anon key reported by the command into `.env.local`:

```dotenv
VITE_SUPABASE_URL=http://127.0.0.1:54321
VITE_SUPABASE_ANON_KEY=<local-anon-key-output-by-supabase-start>
```

Then run `npm.cmd run dev` and open the local URL printed by Vite.

## Repeatable migration test

```powershell
npx supabase db reset
```

This resets only the local Docker database. Never use this command against the linked remote project.

## Required smoke tests

1. Create a test cashier and a stock manager in local Supabase Studio.
2. Create a product and an initial stock movement.
3. Open a cashier session and complete a sale.
4. Confirm the product quantity decreases, and that a sale, sale items, payment and stock movement exist together.
5. Attempt an oversized sale: it must fail and leave no partial records.
6. As accountant, synchronize and post the sale; confirm the trial balance uses only posted entries.

## Before remote deployment

Run `npx supabase db reset`, complete the smoke tests, back up the remote database, then apply the migrations through the Supabase CLI or dashboard in a maintenance window.
