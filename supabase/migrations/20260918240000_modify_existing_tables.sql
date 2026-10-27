-- Migration 4: Modification des tables existantes pour intégration comptable

-- Modification de la table sales
ALTER TABLE public.sales
  ADD COLUMN IF NOT EXISTS journal_entry_id UUID UNIQUE REFERENCES public.journal_entries(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS accounting_synced BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS accounting_synced_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS accounting_error TEXT;

CREATE INDEX IF NOT EXISTS sales_journal_entry_idx ON public.sales(journal_entry_id);
CREATE INDEX IF NOT EXISTS sales_accounting_synced_idx ON public.sales(accounting_synced) WHERE NOT accounting_synced;

-- Modification de la table stock_movements
ALTER TABLE public.stock_movements
  ADD COLUMN IF NOT EXISTS journal_entry_id UUID UNIQUE REFERENCES public.journal_entries(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS accounting_synced BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS accounting_synced_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS accounting_error TEXT;

CREATE INDEX IF NOT EXISTS stock_movements_journal_entry_idx ON public.stock_movements(journal_entry_id);
CREATE INDEX IF NOT EXISTS stock_movements_accounting_synced_idx ON public.stock_movements(accounting_synced) WHERE NOT accounting_synced;

-- Modification de la table payments
ALTER TABLE public.payments
  ADD COLUMN IF NOT EXISTS payment_reference TEXT UNIQUE,
  ADD COLUMN IF NOT EXISTS journal_entry_id UUID UNIQUE REFERENCES public.journal_entries(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS payments_payment_reference_idx ON public.payments(payment_reference) WHERE payment_reference IS NOT NULL;
CREATE INDEX IF NOT EXISTS payments_journal_entry_idx ON public.payments(journal_entry_id);

-- Modification de la table expenses pour lien comptable
ALTER TABLE public.expenses
  ADD COLUMN IF NOT EXISTS journal_entry_id UUID UNIQUE REFERENCES public.journal_entries(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS accounting_synced BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS accounting_synced_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS expenses_journal_entry_idx ON public.expenses(journal_entry_id);

-- Ajout d'une colonne pour le coût moyen pondéré dans products
ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS average_cost NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK (average_cost >= 0);

-- Ajout d'une colonne pour la méthode de valorisation du stock dans settings
-- Cette valeur sera utilisée pour calculer le COGS
INSERT INTO public.settings (key, value, description) VALUES
  ('stock.valuation_method', '"weighted_average"'::jsonb, 'Méthode de valorisation du stock: weighted_average ou fifo')
ON CONFLICT (key) DO NOTHING;
