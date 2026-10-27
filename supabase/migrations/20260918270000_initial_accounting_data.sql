-- Migration 7: Données initiales comptables
-- Plan comptable, période initiale, configuration

-- ============================================
-- Insertion du plan comptable (adapté Haïti)
-- ============================================
INSERT INTO public.accounts (code, name, account_type) VALUES
-- Classe 1: Actifs
('101000', 'Caisse', 'asset'),
('102000', 'Banque', 'asset'),
('103000', 'Chèques à encaisser', 'asset'),
('110000', 'Clients', 'asset'),
('111000', 'Clients - Effets à recevoir', 'asset'),
('120000', 'Stock de marchandises', 'asset'),
('121000', 'Stock de matières premières', 'asset'),
('130000', 'Matériel et équipement', 'asset'),
('131000', 'Matériel de bureau', 'asset'),
('140000', 'Bâtiments', 'asset'),
('150000', 'Amortissements cumulés', 'asset'),
-- Classe 2: Passifs
('201000', 'Fournisseurs', 'liability'),
('202000', 'Fournisseurs - Effets à payer', 'liability'),
('210000', 'Dettes fiscales - TVA', 'liability'),
('211000', 'Dettes fiscales - Impôts', 'liability'),
('220000', 'Emprunts bancaires', 'liability'),
('230000', 'Salaires et charges sociales à payer', 'liability'),
-- Classe 3: Capitaux propres
('301000', 'Capital social', 'equity'),
('302000', 'Résultat de l''exercice', 'equity'),
('303000', 'Réserves', 'equity'),
('304000', 'Report à nouveau', 'equity'),
-- Classe 4: Revenus
('401000', 'Ventes de marchandises', 'revenue'),
('402000', 'Ventes de services', 'revenue'),
('403000', 'Revenus de location', 'revenue'),
('404000', 'Autres revenus d''exploitation', 'revenue'),
('405000', 'Produits financiers', 'revenue'),
('406000', 'Gains de change', 'revenue'),
-- Classe 5: Charges
('501000', 'Coût des marchandises vendues', 'expense'),
('502000', 'Achats de marchandises', 'expense'),
('503000', 'Salaires et traitements', 'expense'),
('504000', 'Charges sociales', 'expense'),
('505000', 'Loyer et charges locatives', 'expense'),
('506000', 'Électricité et eau', 'expense'),
('507000', 'Carburant et transport', 'expense'),
('508000', 'Fournitures de bureau', 'expense'),
('509000', 'Services et sous-traitance', 'expense'),
('510000', 'Publicité et marketing', 'expense'),
('511000', 'Assurances', 'expense'),
('512000', 'Déplacements et représentation', 'expense'),
('513000', 'Taxes et impôts', 'expense'),
('514000', 'Intérêts bancaires', 'expense'),
('515000', 'Dotations aux amortissements', 'expense'),
('516000', 'Provisions pour dépréciation', 'expense'),
('517000', 'Pertes de change', 'expense'),
('518000', 'Autres charges d''exploitation', 'expense'),
('519000', 'Charges exceptionnelles', 'expense')
ON CONFLICT (code) DO NOTHING;

-- ============================================
-- Configuration des comptes par défaut
-- ============================================
INSERT INTO public.settings (key, value, description) VALUES
('accounting.accounts', '{
  "cash": "101000",
  "bank": "102000",
  "checks": "103000",
  "customers": "110000",
  "inventory": "120000",
  "suppliers": "201000",
  "tax_vat": "210000",
  "tax_other": "211000",
  "loans": "220000",
  "payroll": "230000",
  "capital": "301000",
  "revenue_merchandise": "401000",
  "revenue_services": "402000",
  "cogs": "501000",
  "purchases": "502000",
  "salaries": "503000",
  "social_charges": "504000",
  "rent": "505000",
  "utilities": "506000",
  "transport": "507000",
  "office_supplies": "508000",
  "services": "509000",
  "marketing": "510000",
  "insurance": "511000",
  "travel": "512000",
  "taxes": "513000",
  "interest": "514000",
  "depreciation": "515000",
  "provisions": "516000"
}'::jsonb, 'Mapping des comptes comptables par défaut')
ON CONFLICT (key) DO UPDATE SET 
  value = EXCLUDED.value,
  description = EXCLUDED.description;

-- ============================================
-- Configuration de l'entreprise
-- ============================================
INSERT INTO public.settings (key, value, description) VALUES
('company.name', '"Maket Peyizan"'::jsonb, 'Nom de l''entreprise'),
('company.currency', '"HTG"'::jsonb, 'Devise utilisée (HTG = Gourde haïtienne)'),
('company.tax_rate', '18.5'::jsonb, 'Taux de TVA par défaut en %'),
('company.locale', '"fr-HT"'::jsonb, 'Locale pour formatage dates et nombres'),
('pos.receipt_prefix', '"REC"'::jsonb, 'Préfixe pour numéros de reçus'),
('pos.invoice_prefix', '"FAC"'::jsonb, 'Préfixe pour numéros de factures'),
('pos.allow_negative_stock', 'false'::jsonb, 'Autoriser les stocks négatifs (non recommandé)'),
('pos.require_customer', 'false'::jsonb, 'Client obligatoire pour les ventes')
ON CONFLICT (key) DO UPDATE SET 
  value = EXCLUDED.value,
  description = EXCLUDED.description;

-- ============================================
-- Création de la période comptable initiale
-- ============================================
INSERT INTO public.accounting_periods (name, start_date, end_date) VALUES
('Période initiale ' || to_char(CURRENT_DATE, 'YYYY-MM'),
 date_trunc('month', CURRENT_DATE),
 (date_trunc('month', CURRENT_DATE) + interval '1 month' - interval '1 day'))
ON CONFLICT (name) DO NOTHING;

-- ============================================
-- Séquences pour numérotation (réinitialisation si nécessaire)
-- ============================================
-- Note: Les séquences existantes sont conservées pour éviter les conflits
-- journal_entry_number_seq a été créée dans la migration 2
-- adjustment_number_seq a été créée dans la migration 1

-- ============================================
-- Index supplémentaires pour performance
-- ============================================
-- Index pour recherche rapide de comptes par type
CREATE INDEX IF NOT EXISTS accounts_type_active_idx 
  ON public.accounts(account_type, is_active) 
  WHERE is_active;

-- Index pour recherche d'écritures par période et statut
CREATE INDEX IF NOT EXISTS journal_entries_period_status_idx 
  ON public.journal_entries(period_id, status);

-- Index pour recherche de lignes par compte
CREATE INDEX IF NOT EXISTS journal_entry_lines_account_debit_idx 
  ON public.journal_entry_lines(account_id) 
  WHERE debit_amount > 0;

CREATE INDEX IF NOT EXISTS journal_entry_lines_account_credit_idx 
  ON public.journal_entry_lines(account_id) 
  WHERE credit_amount > 0;

-- ============================================
-- Vue pour le grand livre simplifié
-- ============================================
CREATE OR REPLACE VIEW public.general_ledger AS
SELECT
  je.id as entry_id,
  je.entry_number,
  je.entry_date,
  je.description as entry_description,
  je.status,
  a.code as account_code,
  a.name as account_name,
  a.account_type,
  jel.description as line_description,
  jel.debit_amount,
  jel.credit_amount,
  jel.line_number,
  p.full_name as created_by_name,
  je.created_at
FROM public.journal_entries je
JOIN public.journal_entry_lines jel ON je.id = jel.journal_entry_id
JOIN public.accounts a ON jel.account_id = a.id
LEFT JOIN public.profiles p ON je.created_by = p.id;

GRANT SELECT ON public.general_ledger TO authenticated;

-- ============================================
-- Vue pour la balance des comptes
-- ============================================
CREATE OR REPLACE VIEW public.trial_balance AS
SELECT
  a.id as account_id,
  a.code,
  a.name,
  a.account_type,
  a.parent_id,
  COALESCE(SUM(jel.debit_amount), 0) as total_debit,
  COALESCE(SUM(jel.credit_amount), 0) as total_credit,
  CASE 
    WHEN a.account_type IN ('asset', 'expense') THEN
      COALESCE(SUM(jel.debit_amount), 0) - COALESCE(SUM(jel.credit_amount), 0)
    ELSE
      COALESCE(SUM(jel.credit_amount), 0) - COALESCE(SUM(jel.debit_amount), 0)
  END as balance
FROM public.accounts a
LEFT JOIN public.journal_entry_lines jel ON a.id = jel.account_id
LEFT JOIN public.journal_entries je ON jel.journal_entry_id = je.id AND je.status = 'posted'
WHERE a.is_active = true
GROUP BY a.id, a.code, a.name, a.account_type, a.parent_id
ORDER BY a.code;

GRANT SELECT ON public.trial_balance TO authenticated;

-- ============================================
-- Vue pour les ventes non synchronisées
-- ============================================
CREATE OR REPLACE VIEW public.unsynced_sales AS
SELECT
  s.id,
  s.sale_number,
  s.sold_at,
  s.total_amount,
  s.status,
  s.accounting_error,
  p.full_name as cashier_name
FROM public.sales s
LEFT JOIN public.profiles p ON s.created_by = p.id
WHERE NOT s.accounting_synced
  AND s.status = 'completed'
ORDER BY s.sold_at DESC;

GRANT SELECT ON public.unsynced_sales TO authenticated;

-- ============================================
-- Commentaires de documentation
-- ============================================
COMMENT ON TABLE public.accounts IS 'Plan comptable - Structure des comptes selon les normes comptables';
COMMENT ON TABLE public.accounting_periods IS 'Périodes comptables - Définition des exercices et périodes de reporting';
COMMENT ON TABLE public.journal_entries IS 'Écritures comptables - En-tête des écritures en partie double';
COMMENT ON TABLE public.journal_entry_lines IS 'Lignes d''écritures - Détail débit/crédit de chaque écriture';
COMMENT ON TABLE public.audit_log IS 'Journal d''audit - Traçabilité complète des actions sensibles';
COMMENT ON TABLE public.adjustments IS 'Écritures de régularisation - Corrections et ajustements comptables';

COMMENT ON FUNCTION public.generate_journal_entry_number() IS 'Génère un numéro séquentiel unique pour les écritures comptables';
COMMENT ON FUNCTION public.validate_journal_entry_balance() IS 'Trigger qui vérifie l''égalité débit/crédit avant validation';
COMMENT ON FUNCTION public.generate_sale_journal_entry(UUID) IS 'Génère automatiquement l''écriture comptable pour une vente';
COMMENT ON FUNCTION public.sync_sale_to_accounting(UUID) IS 'RPC accessible depuis frontend pour synchroniser une vente';
COMMENT ON FUNCTION public.post_journal_entry(UUID) IS 'Valide (poste) une écriture comptable en brouillon';
COMMENT ON FUNCTION public.log_audit() IS 'Enregistre une action dans le journal d''audit';

COMMENT ON VIEW public.general_ledger IS 'Grand livre - Vue consolidée de toutes les écritures comptables';
COMMENT ON VIEW public.trial_balance IS 'Balance des comptes - Soldes débiteurs et créditeurs par compte';
COMMENT ON VIEW public.unsynced_sales IS 'Ventes en attente de synchronisation comptable';
