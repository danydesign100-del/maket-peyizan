# Plan de Migration - POS Makèt Peyizan

## 1. Nouvelle Architecture de Base de Données

### 1.1 Tables Comptables (Nouvelles)

#### accounts - Plan comptable
```sql
CREATE TABLE public.accounts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code TEXT NOT NULL UNIQUE CHECK (code ~ '^[0-9]{4,6}$'),
  name TEXT NOT NULL CHECK (char_length(trim(name)) BETWEEN 1 AND 180),
  account_type TEXT NOT NULL CHECK (account_type IN (
    'asset', 'liability', 'equity', 'revenue', 'expense'
  )),
  parent_id UUID REFERENCES public.accounts(id) ON DELETE SET NULL,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  description TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Index pour recherche rapide
CREATE INDEX accounts_code_idx ON public.accounts(code);
CREATE INDEX accounts_type_idx ON public.accounts(account_type);
CREATE INDEX accounts_parent_idx ON public.accounts(parent_id);
```

#### accounting_periods - Périodes comptables
```sql
CREATE TABLE public.accounting_periods (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL CHECK (char_length(trim(name)) BETWEEN 1 AND 100),
  start_date DATE NOT NULL,
  end_date DATE NOT NULL,
  is_closed BOOLEAN NOT NULL DEFAULT FALSE,
  closed_at TIMESTAMPTZ,
  closed_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (end_date >= start_date),
  CHECK (NOT is_closed OR closed_at IS NOT NULL)
);

CREATE UNIQUE INDEX accounting_periods_name_idx ON public.accounting_periods(name);
CREATE INDEX accounting_periods_dates_idx ON public.accounting_periods(start_date, end_date);
```

#### journal_entries - Écritures comptables
```sql
CREATE TABLE public.journal_entries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  entry_number TEXT NOT NULL UNIQUE,
  period_id UUID NOT NULL REFERENCES public.accounting_periods(id) ON DELETE RESTRICT,
  entry_date DATE NOT NULL,
  description TEXT NOT NULL CHECK (char_length(trim(description)) BETWEEN 1 AND 500),
  reference_type TEXT, -- 'sale', 'payment', 'expense', 'stock_movement', 'adjustment'
  reference_id UUID,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'posted', 'voided')),
  total_debit NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK (total_debit >= 0),
  total_credit NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK (total_credit >= 0),
  created_by UUID NOT NULL DEFAULT auth.uid() REFERENCES public.profiles(id) ON DELETE RESTRICT,
  posted_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  posted_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (status = 'draft' OR posted_at IS NOT NULL)
);

CREATE INDEX journal_entries_number_idx ON public.journal_entries(entry_number);
CREATE INDEX journal_entries_period_idx ON public.journal_entries(period_id);
CREATE INDEX journal_entries_date_idx ON public.journal_entries(entry_date);
CREATE INDEX journal_entries_reference_idx ON public.journal_entries(reference_type, reference_id);
CREATE INDEX journal_entries_status_idx ON public.journal_entries(status);
```

#### journal_entry_lines - Lignes d'écritures
```sql
CREATE TABLE public.journal_entry_lines (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  journal_entry_id UUID NOT NULL REFERENCES public.journal_entries(id) ON DELETE CASCADE,
  account_id UUID NOT NULL REFERENCES public.accounts(id) ON DELETE RESTRICT,
  description TEXT,
  debit_amount NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK (debit_amount >= 0),
  credit_amount NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK (credit_amount >= 0),
  line_number INTEGER NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (debit_amount > 0 OR credit_amount > 0),
  CHECK (NOT (debit_amount > 0 AND credit_amount > 0))
);

CREATE INDEX journal_entry_lines_entry_idx ON public.journal_entry_lines(journal_entry_id);
CREATE INDEX journal_entry_lines_account_idx ON public.journal_entry_lines(account_id);
```

#### audit_log - Journal d'audit
```sql
CREATE TABLE public.audit_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  profile_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  action TEXT NOT NULL CHECK (char_length(trim(action)) BETWEEN 1 AND 100),
  entity_type TEXT NOT NULL CHECK (char_length(trim(entity_type)) BETWEEN 1 AND 50),
  entity_id UUID,
  old_values JSONB,
  new_values JSONB,
  ip_address TEXT,
  user_agent TEXT,
  success BOOLEAN NOT NULL DEFAULT TRUE,
  error_message TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX audit_log_user_idx ON public.audit_log(user_id);
CREATE INDEX audit_log_entity_idx ON public.audit_log(entity_type, entity_id);
CREATE INDEX audit_log_action_idx ON public.audit_log(action);
CREATE INDEX audit_log_created_idx ON public.audit_log(created_at DESC);
```

#### adjustments - Écritures de régularisation
```sql
CREATE TABLE public.adjustments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  adjustment_number TEXT NOT NULL UNIQUE,
  period_id UUID NOT NULL REFERENCES public.accounting_periods(id) ON DELETE RESTRICT,
  adjustment_date DATE NOT NULL,
  description TEXT NOT NULL CHECK (char_length(trim(description)) BETWEEN 1 AND 888),
  adjustment_type TEXT NOT NULL CHECK (adjustment_type IN (
    'accrual', 'deferral', 'depreciation', 'provision', 
    'error_correction', 'reconciliation', 'stock_impact'
  )),
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN (
    'draft', 'pending_approval', 'approved', 'posted', 'voided'
  )),
  journal_entry_id UUID UNIQUE REFERENCES public.journal_entries(id) ON DELETE SET NULL,
  prepared_by UUID NOT NULL DEFAULT auth.uid() REFERENCES public.profiles(id) ON DELETE RESTRICT,
  approved_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  approved_at TIMESTAMPTZ,
  supporting_document_url TEXT,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX adjustments_number_idx ON public.adjustments(adjustment_number);
CREATE INDEX adjustments_period_idx ON public.adjustments(period_id);
CREATE INDEX adjustments_status_idx ON public.adjustments(status);
```

### 1.2 Modifications Tables Existantes

#### roles - Extension pour 4 rôles
```sql
-- Ajout des rôles manquants
INSERT INTO public.roles (code, name, description) VALUES
  ('director', 'DIRECTEUR', 'Accès complet et supervision'),
  ('accountant', 'COMPTABLE', 'Comptabilité et finance'),
  ('cashier', 'CAISSIÈRE', 'Caisse et ventes'),
  ('stock_manager', 'GESTIONNAIRE STOCK', 'Gestion du stock')
ON CONFLICT (code) DO UPDATE SET 
  name = EXCLUDED.name, 
  description = EXCLUDED.description;
```

#### sales - Ajout lien comptabilité
```sql
ALTER TABLE public.sales
  ADD COLUMN journal_entry_id UUID UNIQUE REFERENCES public.journal_entries(id) ON DELETE SET NULL,
  ADD COLUMN accounting_synced BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN accounting_synced_at TIMESTAMPTZ,
  ADD COLUMN accounting_error TEXT;

CREATE INDEX sales_journal_entry_idx ON public.sales(journal_entry_id);
CREATE INDEX sales_accounting_synced_idx ON public.sales(accounting_synced) WHERE NOT accounting_synced;
```

#### stock_movements - Ajout lien comptabilité
```sql
ALTER TABLE public.stock_movements
  ADD COLUMN journal_entry_id UUID UNIQUE REFERENCES public.journal_entries(id) ON DELETE SET NULL,
  ADD COLUMN accounting_synced BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN accounting_synced_at TIMESTAMPTZ,
  ADD COLUMN accounting_error TEXT;

CREATE INDEX stock_movements_journal_entry_idx ON public.stock_movements(journal_entry_id);
```

#### payments - Ajout champ référence
```sql
ALTER TABLE public.payments
  ADD COLUMN payment_reference TEXT UNIQUE,
  ADD COLUMN journal_entry_id UUID UNIQUE REFERENCES public.journal_entries(id) ON DELETE SET NULL;
```

### 1.3 Fonctions Comptables

#### Génération numéro séquentiel écritures
```sql
CREATE SEQUENCE public.journal_entry_number_seq START WITH 1 INCREMENT BY 1;

CREATE OR REPLACE FUNCTION public.generate_journal_entry_number()
RETURNS TEXT LANGUAGE SQL AS $$
  SELECT 'ECR-' || LPAD(NEXTVAL('public.journal_entry_number_seq')::TEXT, 6, '0');
$$;
```

#### Validation équilibre écriture
```sql
CREATE OR REPLACE FUNCTION public.validate_journal_entry_balance()
RETURNS TRIGGER LANGUAGE PLPGSQL AS $$
DECLARE
  total_debit NUMERIC(14,2);
  total_credit NUMERIC(14,2);
  tolerance NUMERIC(14,2) := 0.01;
BEGIN
  IF TG_OP = 'INSERT' OR TG_OP = 'UPDATE' THEN
    SELECT COALESCE(SUM(debit_amount), 0), COALESCE(SUM(credit_amount), 0)
    INTO total_debit, total_credit
    FROM public.journal_entry_lines
    WHERE journal_entry_id = NEW.id;
    
    IF ABS(total_debit - total_credit) > tolerance THEN
      RAISE EXCEPTION 'Écriture déséquilibrée: Débit=%, Crédit=%', total_debit, total_credit;
    END IF;
    
    NEW.total_debit := total_debit;
    NEW.total_credit := total_credit;
  END IF;
  RETURN NEW;
END;
$$;
```

#### Trigger validation
```sql
CREATE TRIGGER journal_entries_validate_balance
  BEFORE INSERT OR UPDATE ON public.journal_entries
  FOR EACH ROW EXECUTE FUNCTION public.validate_journal_entry_balance();
```

#### Génération automatique écriture vente
```sql
CREATE OR REPLACE FUNCTION public.generate_sale_journal_entry(
  p_sale_id UUID
)
RETURNS UUID LANGUAGE PLPGSQL SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_sale RECORD;
  v_journal_entry_id UUID;
  v_period_id UUID;
  v_cash_account_id UUID;
  v_revenue_account_id UUID;
  v_cogs_account_id UUID;
  v_inventory_account_id UUID;
  v_line_number INTEGER := 0;
BEGIN
  -- Récupérer la vente
  SELECT * INTO v_sale
  FROM public.sales
  WHERE id = p_sale_id;
  
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Vente introuvable';
  END IF;
  
  -- Trouver la période comptable
  SELECT id INTO v_period_id
  FROM public.accounting_periods
  WHERE start_date <= v_sale.sold_at::DATE
    AND end_date >= v_sale.sold_at::DATE
    AND NOT is_closed
  LIMIT 1;
  
  IF v_period_id IS NULL THEN
    RAISE EXCEPTION 'Aucune période comptable ouverte pour cette date';
  END IF;
  
  -- Récupérer les comptes configurés
  SELECT value->>'cash' INTO v_cash_account_id FROM public.settings WHERE key = 'accounting.accounts';
  SELECT value->>'revenue' INTO v_revenue_account_id FROM public.settings WHERE key = 'accounting.accounts';
  SELECT value->>'cogs' INTO v_cogs_account_id FROM public.settings WHERE key = 'accounting.accounts';
  SELECT value->>'inventory' INTO v_inventory_account_id FROM public.settings WHERE key = 'accounting.accounts';
  
  -- Créer l'écriture
  INSERT INTO public.journal_entries (
    entry_number, period_id, entry_date, description,
    reference_type, reference_id, status, created_by
  ) VALUES (
    public.generate_journal_entry_number(),
    v_period_id,
    v_sale.sold_at::DATE,
    'Vente ' || v_sale.sale_number,
    'sale',
    p_sale_id,
    'draft',
    auth.uid()
  ) RETURNING id INTO v_journal_entry_id;
  
  -- Ligne: Débit Caisse
  v_line_number := v_line_number + 1;
  INSERT INTO public.journal_entry_lines (
    journal_entry_id, account_id, description,
    debit_amount, credit_amount, line_number
  ) VALUES (
    v_journal_entry_id,
    v_cash_account_id,
    'Encaissement vente ' || v_sale.sale_number,
    v_sale.total_amount,
    0,
    v_line_number
  );
  
  -- Ligne: Crédit Ventes
  v_line_number := v_line_number + 1;
  INSERT INTO public.journal_entry_lines (
    journal_entry_id, account_id, description,
    debit_amount, credit_amount, line_number
  ) VALUES (
    v_journal_entry_id,
    v_revenue_account_id,
    'Vente ' || v_sale.sale_number,
    0,
    v_sale.subtotal - v_sale.discount_amount,
    v_line_number
  );
  
  -- Ligne: Crédit TVA (si applicable)
  IF v_sale.tax_amount > 0 THEN
    v_line_number := v_line_number + 1;
    INSERT INTO public.journal_entry_lines (
      journal_entry_id, account_id, description,
      debit_amount, credit_amount, line_number
    ) VALUES (
      v_journal_entry_id,
      (SELECT value->>'tax' FROM public.settings WHERE key = 'accounting.accounts'),
      'TVA vente ' || v_sale.sale_number,
      0,
      v_sale.tax_amount,
      v_line_number
    );
  END IF;
  
  -- Ligne: Débit COGS (coût des marchandises vendues)
  -- À calculer depuis les items de vente
  -- TODO: Implémenter calcul COGS selon méthode (FIFO/weighted average)
  
  -- Ligne: Crédit Stock
  -- TODO: Implémenter sortie stock comptable
  
  -- Mettre à jour la vente
  UPDATE public.sales
  SET journal_entry_id = v_journal_entry_id,
      accounting_synced = TRUE,
      accounting_synced = NOW()
  WHERE id = p_sale_id;
  
  RETURN v_journal_entry_id;
END;
$$;
```

### 1.4 Configuration Comptable Initiale

#### Insertion comptes par défaut (plan comptable simplifié Haïti)
```sql
INSERT INTO public.accounts (code, name, account_type) VALUES
-- Actifs
('101000', 'Caisse', 'asset'),
('102000', 'Banque', 'asset'),
('110000', 'Clients', 'asset'),
('120000', 'Stock de marchandises', 'asset'),
('130000', 'Matériel et équipement', 'asset'),
-- Passifs
('201000', 'Fournisseurs', 'liability'),
('202000', 'Dettes fiscales', 'liability'),
-- Capitaux propres
('301000', 'Capital', 'equity'),
('302000', 'Résultat de l''exercice', 'equity'),
-- Revenus
('401000', 'Ventes de marchandises', 'revenue'),
('402000', 'Autres revenus', 'revenue'),
-- Charges
('501000', 'Coût des marchandises vendues', 'expense'),
('502000', 'Salaires et charges sociales', 'expense'),
('503000', 'Loyer et charges locatives', 'expense'),
('504000', 'Services et fournitures', 'expense'),
('505000', 'Déplacements', 'expense'),
('506000', 'Taxes et impôts', 'expense'),
('507000', 'Dotations aux amortissements', 'expense'),
('508000', 'Autres charges', 'expense');
```

#### Configuration dans settings
```sql
INSERT INTO public.settings (key, value, description) VALUES
('accounting.accounts', '{
  "cash": "101000",
  "bank": "102000",
  "customers": "110000",
  "inventory": "120000",
  "suppliers": "201000",
  "tax": "202000",
  "capital": "301000",
  "revenue": "401000",
  "cogs": "501000"
}'::jsonb, 'Mapping des comptes comptables par défaut');
```

## 2. Rôles et Permissions Étendus

### 2.1 Matrice des Permissions

| Module | Directeur | Comptable | Caissière | Gestionnaire Stock |
|--------|-----------|-----------|-----------|-------------------|
| Tableau de bord | ✅ Lecture | ✅ Lecture | ❌ | ❌ |
| Caisse/POS | ✅ Supervision | ❌ | ✅ Opérations | ❌ |
| Produits (lecture) | ✅ | ✅ | ✅ | ✅ |
| Produits (CRUD) | ✅ | ❌ | ❌ | ✅ |
| Catégories | ✅ | ❌ | ❌ | ✅ |
| Clients (lecture) | ✅ | ✅ | ✅ | ❌ |
| Clients (CRUD) | ✅ | ❌ | ✅ | ❌ |
| Fournisseurs | ✅ | ✅ | ❌ | ✅ |
| Stock (lecture) | ✅ | ✅ | ❌ | ✅ |
| Stock (mouvements) | ✅ | ❌ | ❌ | ✅ |
| Stock (inventaire) | ✅ | ❌ | ❌ | ✅ |
| Ventes (lecture) | ✅ | ✅ | ✅ propres | ❌ |
| Ventes (modification) | ✅ | ❌ | ❌ | ❌ |
| Paiements | ✅ | ✅ | ✅ propres | ❌ |
| Sessions caisse | ✅ | ✅ lecture | ✅ propres | ❌ |
| Plan comptable | ✅ | ✅ lecture/écriture | ❌ | ❌ |
| Écritures comptables | ✅ | ✅ | ❌ | ❌ |
| Clôtures périodes | ✅ | ✅ | ❌ | ❌ |
| Rapports financiers | ✅ | ✅ | ❌ | ❌ |
| Écritures régularisation | ✅ | ✅ préparation | ❌ | ❌ |
| Validation régularisation | ✅ | ❌ | ❌ | ❌ |
| Utilisateurs | ✅ | ❌ | ❌ | ❌ |
| Paramètres | ✅ | ❌ | ❌ | ❌ |
| Journal d'audit | ✅ | ❌ | ❌ | ❌ |
| Sauvegardes | ✅ | ❌ | ❌ | ❌ |

### 2.2 Implémentation RLS par Rôle

```sql
-- Suppression anciennes politiques
DROP POLICY IF EXISTS "roles readable by authenticated" ON public.roles;
DROP POLICY IF EXISTS "roles managed by administrators" ON public.roles;

-- Nouvelles politiques par rôle
CREATE POLICY "roles readable by all_authenticated" 
  ON public.roles FOR SELECT TO authenticated USING (true);

CREATE POLICY "roles director manage" 
  ON public.roles FOR ALL TO authenticated 
  USING (public.has_role('director')) 
  WITH CHECK (public.has_role('director'));

-- Exemple: Écritures comptables
CREATE POLICY "journal_entries director read" 
  ON public.journal_entries FOR SELECT TO authenticated 
  USING (public.has_role('director'));

CREATE POLICY "journal_entries accountant read" 
  ON public.journal_entries FOR SELECT TO authenticated 
  USING (public.has_role('accountant'));

CREATE POLICY "journal_entries accountant insert" 
  ON public.journal_entries FOR INSERT TO authenticated 
  WITH CHECK (public.has_role('accountant'));

CREATE POLICY "journal_entries accountant update_draft" 
  ON public.journal_entries FOR UPDATE TO authenticated 
  USING (public.has_role('accountant') AND status = 'draft')
  WITH CHECK (public.has_role('accountant') AND status = 'draft');

-- Stock movements
CREATE POLICY "stock_movements stock_manager read" 
  ON public.stock_movements FOR SELECT TO authenticated 
  USING (public.has_role('stock_manager') OR public.has_role('director'));

-- Audit log
CREATE POLICY "audit_log director read" 
  ON public.audit_log FOR SELECT TO authenticated 
  USING (public.has_role('director'));
```

## 3. Stratégie de Migration des Données

### 3.1 Données à Conserver Sans Modification
- ✅ products (toutes les colonnes existantes)
- ✅ categories
- ✅ customers
- ✅ suppliers
- ✅ profiles (avec mise à jour role_id si nécessaire)
- ✅ settings

### 3.2 Données à Transformer
- **roles**: Ajouter director, accountant, stock_manager
- **sales**: Ajouter colonnes comptabilité (NULL initialement)
- **stock_movements**: Ajouter colonnes comptabilité (NULL initialement)
- **payments**: Ajouter colonnes comptabilité (NULL initialement)

### 3.3 Données à Exclure/Recréer
- ❌ Aucune donnée à supprimer
- ✅ accounting_periods: créer période initiale
- ✅ accounts: insérer plan comptable par défaut
- ✅ audit_log: vide au départ

### 3.4 Ordre des Migrations

1. **Migration 1**: Rôles étendus
2. **Migration 2**: Tables comptables (accounts, accounting_periods, journal_entries, journal_entry_lines)
3. **Migration 3**: Tables audit et ajustements
4. **Migration 4**: Modification tables existantes (sales, stock_movements, payments)
5. **Migration 5**: Fonctions comptables et triggers
6. **Migration 6**: RLS par rôle étendu
7. **Migration 7**: Données initiales (plan comptable, période initiale, settings)

## 4. Sauvegarde et Plan de Retour

### 4.1 Procédure de Sauvegarde

```bash
# Via Supabase CLI
supabase db dump -f backup_before_migration_$(date +%Y%m%d_%H%M%S).sql

# Ou via pg_dump
pg_dump -h db.xxx.supabase.co -U postgres -d postgres > backup.sql
```

### 4.2 Points de Vérification

Après chaque migration:
1. ✅ Vérifier que les tables existent
2. ✅ Vérifier les contraintes
3. ✅ Tester l'authentification avec chaque rôle
4. ✅ Vérifier que les données existantes sont accessibles
5. ✅ Tester une insertion dans chaque nouvelle table

### 4.3 Plan de Retour

Si une migration échoue:
1. Arrêter l'application
2. Restaurer depuis la sauvegarde
3. Identifier la cause de l'échec
4. Corriger la migration
5. Recommencer

## 5. Risques et Atténuations

### 5.1 Risques Identifiés

| Risque | Probabilité | Impact | Atténuation |
|--------|-------------|--------|-------------|
| Perte de données existantes | Faible | Critique | Sauvegarde avant chaque migration |
| RLS trop restrictif | Moyen | Moyen | Tests avec chaque rôle |
| Performance dégradée | Faible | Moyen | Index ajoutés, tests de charge |
| Écritures comptables incorrectes | Moyen | Critique | Validation automatique, tests |
| Synchronisation vente → comptabilité échoue | Moyen | Critique | File d'attente, retry automatique |

### 5.2 Tests Obligatoires Avant Mise en Production

1. ✅ Créer un utilisateur pour chaque rôle
2. ✅ Tester l'accès à chaque module avec chaque rôle
3. ✅ Créer une vente complète et vérifier l'écriture comptable
4. ✅ Créer un mouvement de stock et vérifier l'impact
5. ✅ Tester la validation d'une écriture comptable
6. ✅ Tester une écriture de régularisation
7. ✅ Vérifier les rapports financiers
8. ✅ Tester le journal d'audit
9. ✅ Tester la clôture d'une période comptable
10. ✅ Restaurer une sauvegarde avec succès

## 6. Timeline Estimée

- **Jour 1**: Implémentation migrations 1-3 (tables comptables)
- **Jour 2**: Implémentation migrations 4-5 (modifications existantes, fonctions)
- **Jour 3**: Implémentation migration 6-7 (RLS, données initiales)
- **Jour 4**: Tests et validation
- **Jour 5**: Développement frontend modules comptables
- **Jour 6-7**: Intégration caisse → comptabilité
- **Jour 8**: Tests E2E et sécurité
- **Jour 9**: Documentation
- **Jour 10**: Livraison

## 7. Livrables de l'Étape 2

1. ✅ Fichier de migration SQL complet
2. ✅ Schéma de base de données documenté
3. ✅ Matrice des permissions par rôle
4. ✅ Plan de sauvegarde et retour
5. ✅ Liste des tests de validation
