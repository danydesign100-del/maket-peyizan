# Documentation Technique - POS Makèt Peyizan

## Architecture du Système

### Stack Technique
- **Frontend**: React 19.2.8 + TypeScript + Vite
- **Backend**: Supabase (PostgreSQL + Auth + Storage)
- **Styling**: TailwindCSS
- **Linting**: Oxlint

### Structure du Projet

```
c:/Maket Peyizan/
├── src/
│   ├── components/          # Composants réutilisables
│   │   ├── PageHeader.tsx
│   │   ├── ProtectedRoute.tsx
│   │   └── ModulePlaceholder.tsx
│   ├── contexts/            # Contextes React
│   │   └── AuthContext.tsx
│   ├── layouts/             # Layouts d'application
│   │   └── AppLayout.tsx
│   ├── lib/                 # Utilitaires
│   │   └── supabase.ts      # Client Supabase
│   ├── pages/               # Pages de l'application
│   │   ├── AccountingPage.tsx
│   │   ├── CashRegisterPage.tsx
│   │   ├── DashboardPage.tsx
│   │   ├── InventoryPage.tsx
│   │   ├── ProductsPage.tsx
│   │   ├── ReportsPage.tsx
│   │   ├── SalesPage.tsx
│   │   ├── SettingsPage.tsx
│   │   └── UsersPage.tsx
│   ├── services/            # Services d'API
│   │   ├── accountingService.ts
│   │   ├── authService.ts
│   │   ├── dashboardService.ts
│   │   ├── posService.ts
│   │   ├── productService.ts
│   │   ├── salesService.ts
│   │   └── stockService.ts
│   ├── types/               # Types TypeScript
│   │   ├── accounting.ts
│   │   ├── auth.ts
│   │   ├── catalog.ts
│   │   └── pos.ts
│   ├── App.tsx              # Routage principal
│   └── main.tsx             # Point d'entrée
├── supabase/
│   └── migrations/          # Migrations SQL
│       ├── 20260918180000_pos_foundation.sql
│       ├── 20260918190000_catalog_and_customers.sql
│       ├── 20260918200000_suppliers_and_atomic_stock.sql
│       ├── 20260918210000_extended_roles.sql
│       ├── 20260918220000_accounting_tables.sql
│       ├── 20260918230000_audit_and_adjustments.sql
│       ├── 20260918240000_modify_existing_tables.sql
│       ├── 20260918250000_accounting_functions.sql
│       ├── 20260918260000_extended_rls_policies.sql
│       └── 20260918270000_initial_accounting_data.sql
├── docs/                    # Documentation
│   ├── MIGRATION_PLAN.md
│   ├── MIGRATION_INSTRUCTIONS.md
│   └── TECHNICAL_DOCUMENTATION.md
├── .env.example             # Variables d'environnement exemple
├── package.json             # Dépendances
└── README.md                # Description du projet
```

## Base de Données

### Tables Principales

#### Tables de Fondation
- `profiles`: Profils utilisateurs avec rôles
- `roles`: Rôles et permissions
- `products`: Catalogue produits
- `categories`: Catégories de produits
- `customers`: Clients
- `suppliers`: Fournisseurs
- `sales`: Ventes
- `sale_items`: Lignes de vente
- `payments`: Paiements
- `stock_movements`: Mouvements de stock
- `cash_sessions`: Sessions de caisse
- `settings`: Paramètres système

#### Tables Comptables
- `accounts`: Plan comptable
- `accounting_periods`: Périodes comptables
- `journal_entries`: Écritures comptables
- `journal_entry_lines`: Lignes d'écritures
- `adjustments`: Écritures de régularisation
- `audit_log`: Journal d'audit

### Sécurité (RLS)

Toutes les tables sont protégées par Row Level Security (RLS) avec des politiques basées sur les rôles:
- `director`: Accès complet
- `accountant`: Accès comptabilité et lecture
- `cashier`: Accès caisse et ventes
- `stock_manager`: Accès stock et inventaires
- `administrator`: Accès complet (héritage)

### Fonctions et Triggers

#### Fonctions Comptables
- `generate_journal_entry_number()`: Génération de numéros d'écritures
- `validate_journal_entry_balance()`: Validation équilibrage débit/crédit
- `sync_sale_to_accounting()`: Synchronisation vente → comptabilité
- `post_journal_entry()`: Validation d'écriture comptable
- `log_audit()`: Journalisation des actions

#### Triggers
- `update_average_cost_on_movement`: Mise à jour coût moyen stock
- `generate_sale_journal_entry`: Génération automatique écriture vente

## Architecture Frontend

### Gestion d'État
- `AuthContext`: Gestion de l'authentification et du profil utilisateur
- `useState`: Gestion d'état local par composant

### Routage
- React Router pour la navigation
- Routes protégées par `ProtectedRoute` avec vérification des rôles

### Services API
Tous les appels Supabase sont encapsulés dans des services dans `src/services/`:
- `accountingService`: Opérations comptables
- `posService`: Opérations de caisse
- `productService`: Gestion produits
- `salesService`: Gestion ventes
- `stockService`: Gestion stock

### Types TypeScript
Les types sont définis dans `src/types/` pour garantir la sécurité des types:
- `accounting.ts`: Types comptables
- `auth.ts`: Types d'authentification
- `catalog.ts`: Types catalogue
- `pos.ts`: Types POS

## Intégration Ventes → Comptabilité

### Flux de Synchronisation

1. **Création de vente** via `posService.createSale()`
2. **Mise à jour du stock** via `record_stock_movement()`
3. **Synchronisation comptable** via `sync_sale_to_accounting()`
4. **Génération écriture** automatique avec:
   - Débit: Compte de caisse (411)
   - Crédit: Compte de ventes (701)
   - TVA: Compte de TVA collectée (445)

### Prévention des Duplicates
- Chaque vente a un champ `accounting_synced`
- La fonction `sync_sale_to_accounting` vérifie ce champ avant synchronisation
- Les écritures sont liées par `reference_type='sale'` et `reference_id`

## Sécurité

### Authentification
- Supabase Auth pour l'authentification
- Tokens JWT avec expiration
- Session persistante via localStorage

### Autorisation
- RBAC (Role-Based Access Control)
- Vérification des rôles dans `ProtectedRoute`
- RLS au niveau base de données

### Audit
- Toutes les actions critiques sont journalisées dans `audit_log`
- Enregistrement: utilisateur, action, entité, anciennes/nouvelles valeurs, succès/échec

## Configuration

### Variables d'Environnement
```bash
VITE_SUPABASE_URL=votre_url_supabase
VITE_SUPABASE_ANON_KEY=votre_cle_anon
```

### Paramètres Système
Les paramètres sont stockés dans la table `settings`:
- `company.name`: Nom de l'entreprise
- `company.currency`: Devise (défaut: HTG)
- `company.tax_rate`: Taux de TVA (défaut: 18.5%)
- `pos.receipt_prefix`: Préfixe reçus (défaut: REC)
- `pos.invoice_prefix`: Préfixe factures (défaut: FAC)
- `pos.allow_negative_stock`: Autoriser stock négatif (défaut: false)
- `stock.valuation_method`: Méthode valorisation (défaut: weighted_average)

## Déploiement

### Pré-requis
- Node.js 18+
- Compte Supabase
- Git

### Installation
```bash
# Cloner le repository
git clone <repository_url>
cd Maket Peyizan

# Installer les dépendances
npm install

# Configurer l'environnement
cp .env.example .env.local
# Éditer .env.local avec vos credentials Supabase

# Démarrer le serveur de développement
npm run dev
```

### Application des Migrations
```bash
# Via Supabase CLI
supabase db push

# Ou via le dashboard Supabase
# Appliquer les fichiers dans supabase/migrations/ dans l'ordre chronologique
```

### Build de Production
```bash
npm run build
```

## Maintenance

### Sauvegardes
- Sauvegardes automatiques Supabase (quotidienne)
- Sauvegardes manuelles recommandées avant migrations
- Conserver les sauvegardes pendant 30 jours minimum

### Logs
- Logs Supabase disponibles dans le dashboard
- Journal d'audit dans la table `audit_log`
- Logs d'erreurs dans la console navigateur

### Mises à jour
1. Créer une nouvelle migration SQL
2. Tester en environnement de développement
3. Appliquer en production avec sauvegarde préalable
4. Vérifier les données après migration

## Performance

### Optimisations
- Pagination des listes (20 items par page)
- Indexes sur les colonnes fréquemment filtrées
- Lazy loading des données
- Mise en cache des sessions

### Monitoring
- Dashboard Supabase pour les métriques
- Monitoring des requêtes lentes
- Alertes sur les erreurs

## Support

Pour toute question technique, consulter:
- `docs/MIGRATION_PLAN.md` pour les migrations
- `docs/MIGRATION_INSTRUCTIONS.md` pour les instructions
- Le code source commenté pour les détails d'implémentation
