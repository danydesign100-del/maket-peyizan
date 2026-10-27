# Instructions d'Application des Migrations

## Prérequis

1. **Sauvegarde obligatoire**
   ```bash
   # Via Supabase CLI
   supabase db dump -f backup_before_migration_$(date +%Y%m%d_%H%M%S).sql
   
   # Ou via pg_dump
   pg_dump -h db.xxx.supabase.co -U postgres -d postgres > backup.sql
   ```

2. **Vérifier l'environnement**
   - Assurez-vous que Supabase est accessible
   - Vérifiez que les migrations existantes sont appliquées
   - Confirmez qu'aucune vente n'est en cours pendant la migration

## Ordre d'Application des Migrations

Les migrations doivent être appliquées dans l'ordre chronologique:

1. `20260918180000_pos_foundation.sql` (déjà appliquée)
2. `20260918190000_catalog_and_customers.sql` (déjà appliquée)
3. `20260918200000_suppliers_and_atomic_stock.sql` (déjà appliquée)
4. `20260918210000_extended_roles.sql` ⭐ NOUVELLE
5. `20260918220000_accounting_tables.sql` ⭐ NOUVELLE
6. `20260918230000_audit_and_adjustments.sql` ⭐ NOUVELLE
7. `20260918240000_modify_existing_tables.sql` ⭐ NOUVELLE
8. `20260918250000_accounting_functions.sql` ⭐ NOUVELLE
9. `20260918260000_extended_rls_policies.sql` ⭐ NOUVELLE
10. `20260918270000_initial_accounting_data.sql` ⭐ NOUVELLE

## Application via Supabase CLI

```bash
# Appliquer toutes les nouvelles migrations
supabase db push

# Ou appliquer une migration spécifique
supabase migration up 20260918210000_extended_roles.sql
```

## Vérification Après Chaque Migration

### Après migration 1 (rôles étendus)
```sql
-- Vérifier les 4 rôles
SELECT code, name, description FROM public.roles;
-- Résultat attendu: administrator, director, accountant, cashier, stock_manager
```

### Après migration 2 (tables comptables)
```sql
-- Vérifier les tables
SELECT table_name FROM information_schema.tables 
WHERE table_schema = 'public' 
AND table_name IN ('accounts', 'accounting_periods', 'journal_entries', 'journal_entry_lines');
```

### Après migration 3 (audit et ajustements)
```sql
-- Vérifier les tables
SELECT table_name FROM information_schema.tables 
WHERE table_schema = 'public' 
AND table_name IN ('audit_log', 'adjustments');
```

### Après migration 4 (modifications tables existantes)
```sql
-- Vérifier les nouvelles colonnes
SELECT column_name, data_type FROM information_schema.columns 
WHERE table_name = 'sales' AND column_name LIKE 'accounting%';
```

### Après migration 5 (fonctions comptables)
```sql
-- Vérifier les fonctions
SELECT routine_name FROM information_schema.routines 
WHERE routine_schema = 'public' 
AND routine_name IN ('generate_sale_journal_entry', 'sync_sale_to_accounting', 'post_journal_entry');
```

### Après migration 6 (RLS étendu)
```sql
-- Tester les permissions avec différents rôles
-- (nécessite de créer des utilisateurs de test)
```

### Après migration 7 (données initiales)
```sql
-- Vérifier le plan comptable
SELECT COUNT(*) FROM public.accounts; -- Doit retourner ~50 comptes

-- Vérifier la période comptable
SELECT * FROM public.accounting_periods;

-- Vérifier les settings
SELECT key, value FROM public.settings WHERE key LIKE 'accounting.%';
```

## Points de Contrôle

### ✅ Contrôle 1: Authentification
- Créer un utilisateur avec le rôle `director`
- Se connecter et vérifier l'accès à toutes les tables
- Créer un utilisateur avec le rôle `cashier`
- Vérifier que l'accès est limité

### ✅ Contrôle 2: Données existantes
- Vérifier que les produits existants sont toujours accessibles
- Vérifier que les clients existants sont toujours accessibles
- Vérifier que les fournisseurs existants sont toujours accessibles

### ✅ Contrôle 3: Fonctions comptables
- Tester la fonction `generate_journal_entry_number()`
- Vérifier que la vue `general_ledger` est accessible
- Vérifier que la vue `trial_balance` est accessible

### ✅ Contrôle 4: Intégration
- Créer une vente de test
- Appeler `sync_sale_to_accounting()`
- Vérifier qu'une écriture comptable a été créée
- Vérifier que la vente est marquée comme synchronisée

## En Cas d'Erreur

### Erreur de contrainte
```sql
-- Identifier la contrainte en conflit
SELECT conname, conrelid::regclass FROM pg_constraint 
WHERE conrelid::regclass::text IN ('sales', 'stock_movements', 'payments');
```

### Erreur RLS
```sql
-- Désactiver temporairement RLS pour diagnostic
ALTER TABLE public.nom_table DISABLE ROW LEVEL SECURITY;
-- Réactiver après diagnostic
ALTER TABLE public.nom_table ENABLE ROW LEVEL SECURITY;
```

### Erreur de fonction
```sql
-- Vérifier le code de la fonction
SELECT pg_get_functiondef(oid) FROM pg_proc WHERE proname = 'nom_fonction';
```

## Rollback (Retour en Arrière)

### Rollback complet
```bash
# Restaurer depuis la sauvegarde
psql -h db.xxx.supabase.co -U postgres -d postgres < backup.sql
```

### Rollback partiel (migration spécifique)
```bash
# Supprimer les migrations dans l'ordre inverse
supabase migration down 20260918270000_initial_accounting_data.sql
supabase migration down 20260918260000_extended_rls_policies.sql
# ... etc
```

## Après Migration Réussie

1. **Générer les types TypeScript**
   ```bash
   supabase gen types typescript --local > src/types/database.ts
   ```

2. **Mettre à jour les services frontend**
   - Ajouter les services pour la comptabilité
   - Mettre à jour les types existants

3. **Tester l'application**
   - Lancer le serveur de développement
   - Tester l'authentification avec chaque rôle
   - Tester les nouvelles fonctionnalités

## Support

En cas de problème:
1. Consulter les logs Supabase
2. Vérifier le journal d'audit (`audit_log`)
3. Consulter le plan de migration (`MIGRATION_PLAN.md`)
