-- Initial data for local Maket Peyizan database

-- ============================================
-- ACCOUNTING CHART OF ACCOUNTS (Haiti)
-- ============================================

insert into public.accounts (code, name, account_type) values
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
on conflict (code) do nothing;

-- ============================================
-- COMPANY SETTINGS
-- ============================================

insert into public.settings (key, value, description) values
('company.name', '"Maket Peyizan"'::jsonb, 'Nom de l''entreprise'),
('company.currency', '"HTG"'::jsonb, 'Devise utilisée (HTG = Gourde haïtienne)'),
('company.tax_rate', '18.5'::jsonb, 'Taux de TVA par défaut en %'),
('company.locale', '"fr-HT"'::jsonb, 'Locale pour formatage dates et nombres'),
('pos.receipt_prefix', '"REC"'::jsonb, 'Préfixe pour numéros de reçus'),
('pos.invoice_prefix', '"FAC"'::jsonb, 'Préfixe pour numéros de factures'),
('pos.allow_negative_stock', 'false'::jsonb, 'Autoriser les stocks négatifs (non recommandé)'),
('pos.require_customer', 'false'::jsonb, 'Client obligatoire pour les ventes'),
('stock.valuation_method', '"weighted_average"'::jsonb, 'Méthode de valorisation du stock: weighted_average ou fifo')
on conflict (key) do update set value = excluded.value, description = excluded.description;

-- ============================================
-- ACCOUNTING ACCOUNTS CONFIGURATION
-- ============================================

insert into public.settings (key, value, description)
select
  'accounting.accounts',
  jsonb_build_object(
    'cash', (select id::text from public.accounts where code = '101000'),
    'revenue', (select id::text from public.accounts where code = '401000'),
    'tax', (select id::text from public.accounts where code = '210000'),
    'cogs', (select id::text from public.accounts where code = '501000'),
    'inventory', (select id::text from public.accounts where code = '120000')
  ),
  'System account identifiers used by automatic sale journal entries'
on conflict (key) do update set value = excluded.value, description = excluded.description;

-- ============================================
-- INITIAL ACCOUNTING PERIOD
-- ============================================

insert into public.accounting_periods (name, start_date, end_date) values
('Période initiale ' || to_char(current_date, 'YYYY-MM'),
 date_trunc('month', current_date),
 (date_trunc('month', current_date) + interval '1 month' - interval '1 day'))
on conflict (name) do nothing;

-- ============================================
-- DEFAULT ADMIN USER (password: admin123)
-- ============================================

-- Note: In production, change this password immediately
insert into public.local_users (email, password_hash, full_name, is_active) values
('admin@maketpeyizan.com', '$2b$10$rKZqYJZxYJxYJxYJxYJxYuKZqYJZxYJxYJxYJxYJxYJxYJxYJxYJxY', 'Administrateur', true)
on conflict (email) do nothing;

-- Create profile for admin user
insert into public.profiles (id, full_name, email, role_id)
select 
  lu.id,
  lu.full_name,
  lu.email,
  (select id from public.roles where code = 'director')
from public.local_users lu
where lu.email = 'admin@maketpeyizan.com'
on conflict (id) do nothing;
