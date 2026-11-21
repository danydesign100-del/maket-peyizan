# Test version

A copy of the application where the client can try everything (sales, returns,
cash counts, accounting entries, printouts) without touching the real shop.

| | Production | Test version |
|---|---|---|
| Website | https://maket-peyizan.pages.dev | https://test.maket-peyizan.pages.dev |
| Database | Supabase project `maket-peyizan` | Separate Supabase project, e.g. `maket-peyizan-test` |
| Settings | `.env.production.local` | `.env.test.local` |
| On screen | — | Amber "VERSION DE TEST" banner on every page, `[TEST]` in the tab title |
| Printouts | Company header | Same header plus "VERSION DE TEST" |
| Installed app | "Makèt Peyizan" | "Makèt Peyizan (TEST)", installed separately |

The two never share data: the test build reads only `.env.test.local`
(Vite's `test` mode ignores `.env.local` and `.env.production.local`), and
every script below refuses to run if the test settings point to the production
project.

## One-time setup

1. **Create the test database.** On supabase.com, *New project*, name it
   `maket-peyizan-test` (the free plan allows two projects). Keep the database
   password.
2. **Fill in the settings.** Copy `.env.test.example` to `.env.test.local` and set:
   - `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY`: *Project Settings > API*
     of the **test** project (publishable key only, never the secret key);
   - `SUPABASE_TEST_DB_URL`: *Connect > Session pooler* connection string, with
     the database password.

   `.env.test.local` is ignored by git; it never leaves your computer.
3. **Check:** `npm run test-version:check` prints both project references and
   stops if they are the same.
4. **Create the tables:** `npm run test-version:db` applies every migration to
   the test database (the linked production project is not touched).
5. **Create its first administrator:** `node scripts/create-first-admin.mjs --test`.
6. **Authentication URL:** in the test project, *Authentication > URL
   Configuration*, set the Site URL to `https://test.maket-peyizan.pages.dev`
   (password-reset emails then point to the test site).
7. **Demo data (optional):** `npm run test-version:seed` signs in with the
   administrator's e-mail and password and adds 10 products with stock (one out
   of stock on purpose), 3 suppliers by category and 3 customers. Running it
   again adds nothing twice. Users for the other roles (cashier, accountant…)
   are created from the *Utilisateurs* page, as in production.

## Publishing the test version

```
npm run test-version:db       # when new migrations exist
npm run test-version:deploy   # builds in test mode and publishes to the "test" branch
```

`dist/` then holds the test build: always rebuild before a production deploy
(the usual production command already does: `npm run build -- --mode production`).

## Order for each release

1. Apply the new migrations to the test database, publish the test version.
2. The client checks the changes there, including the printouts.
3. Then apply the migrations to production (`npx supabase db push --remote`) and
   publish production.

Apply the database changes **before** the website, in both environments:
the previous website keeps working with the new database, not the reverse.
