# Procédure de test Supabase — POS

Prérequis : la migration `20260918180000_pos_foundation.sql` est appliquée et `.env.local` contient l’URL et la clé anon du même projet.

1. Dans **Authentication > Users**, créez un utilisateur avec e-mail + mot de passe. Le trigger crée automatiquement son profil avec le rôle `cashier`.
2. Dans **SQL Editor**, exécutez `select p.email, r.code from public.profiles p join public.roles r on r.id = p.role_id;` et vérifiez le rôle.
3. Promouvez l’utilisateur de test administrateur :

```sql
update public.profiles set role_id = (select id from public.roles where code = 'administrator')
where email = 'admin-test@example.com';
```

4. Lancez `npm run dev`, connectez-vous avec cet utilisateur et ouvrez `/parametres` : la session est persistée après actualisation.
5. Créez un utilisateur caissier. Avec celui-ci, `/stock`, `/fournisseurs`, `/rapports`, `/utilisateurs` et `/parametres` redirigent vers `/`; les policies RLS bloquent aussi toute requête SQL non autorisée.
6. Connecté en administrateur, vérifiez une lecture :

```ts
const { data, error } = await supabase.from('customers').select('*')
```

7. Vérifiez insertion, mise à jour et désactivation (pas de suppression destructive) :

```ts
const { data: customer, error } = await supabase.from('customers').insert({ full_name: 'Client test RLS', phone: '50900000000' }).select().single()
await supabase.from('customers').update({ phone: '50911111111' }).eq('id', customer!.id)
await supabase.from('customers').update({ active: false }).eq('id', customer!.id)
```

8. Vérifiez que les compteurs sont concurrents et uniques en créant plusieurs lignes `customers`, `proformas` et `sales`; les numéros suivent `CL-`, `PF-`, `VTE-` et proviennent de séquences PostgreSQL atomiques.
9. Vérifiez l’intégrité du stock : créez un produit avec stock `0`, puis tentez un `stock_movements` de type `out` quantité `1`. La requête doit échouer avec `Stock insuffisant ou produit introuvable`.

Ne mettez jamais de `service_role` dans `.env.local` côté Vite. Les tests d’administration sont effectués avec un utilisateur Auth administrateur, donc RLS est réellement exercée.
