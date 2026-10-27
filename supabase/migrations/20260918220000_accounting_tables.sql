-- Migration 2: Tables comptables fondamentales
-- Plan comptable, périodes comptables, écritures et lignes d'écritures

-- Table: accounts (Plan comptable)
CREATE TABLE IF NOT EXISTS public.accounts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code TEXT NOT NULL UNIQUE CHECK (code ~ '^[0-9]{4,6}$'),
  name TEXT NOT NULL CHECK (char_length(trim(name)) BETWEEN 1 AND 180),
  account_type TEXT NOT NULL CHECK (account_type IN (
    'asset', 'liability', 'equity', 'revenue', 'expense'
  )),
  parent_id UUID REFERENCES public.accounts(id) ON DELETE SET NULL,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  description TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Index pour recherche rapide
CREATE INDEX IF NOT EXISTS accounts_code_idx ON public.accounts(code);
CREATE INDEX IF NOT EXISTS accounts_type_idx ON public.accounts(account_type);
CREATE INDEX IF NOT EXISTS accounts_parent_idx ON public.accounts(parent_id);
CREATE INDEX IF NOT EXISTS accounts_active_idx ON public.accounts(is_active) WHERE is_active;

-- Trigger updated_at pour accounts
CREATE TRIGGER accounts_set_updated_at 
  BEFORE UPDATE ON public.accounts 
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- Table: accounting_periods (Périodes comptables)
CREATE TABLE IF NOT EXISTS public.accounting_periods (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL UNIQUE CHECK (char_length(trim(name)) BETWEEN 1 AND 100),
  start_date DATE NOT NULL,
  end_date DATE NOT NULL,
  is_closed BOOLEAN NOT NULL DEFAULT FALSE,
  closed_at TIMESTAMPTZ,
  closed_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (end_date >= start_date),
  CHECK (NOT is_closed OR closed_at IS NOT NULL)
);

CREATE UNIQUE INDEX IF NOT EXISTS accounting_periods_name_idx ON public.accounting_periods(name);
CREATE INDEX IF NOT EXISTS accounting_periods_dates_idx ON public.accounting_periods(start_date, end_date);
CREATE INDEX IF NOT EXISTS accounting_periods_closed_idx ON public.accounting_periods(is_closed);

CREATE TRIGGER accounting_periods_set_updated_at 
  BEFORE UPDATE ON public.accounting_periods 
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- Séquence pour numérotation des écritures
CREATE SEQUENCE IF NOT EXISTS public.journal_entry_number_seq START WITH 1 INCREMENT BY 1;

-- Fonction de génération de numéro d'écriture
CREATE OR REPLACE FUNCTION public.generate_journal_entry_number()
RETURNS TEXT LANGUAGE sql STABLE AS $$
  SELECT 'ECR-' || lpad(nextval('public.journal_entry_number_seq')::text, 6, '0');
$$;

-- Table: journal_entries (Écritures comptables)
CREATE TABLE IF NOT EXISTS public.journal_entries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  entry_number TEXT NOT NULL UNIQUE DEFAULT public.generate_journal_entry_number(),
  period_id UUID NOT NULL REFERENCES public.accounting_periods(id) ON DELETE RESTRICT,
  entry_date DATE NOT NULL,
  description TEXT NOT NULL CHECK (char_length(trim(description)) BETWEEN 1 AND 500),
  reference_type TEXT,
  reference_id UUID,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'posted', 'voided')),
  total_debit NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK (total_debit >= 0),
  total_credit NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK (total_credit >= 0),
  created_by UUID NOT NULL DEFAULT auth.uid() REFERENCES public.profiles(id) ON DELETE RESTRICT,
  posted_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  posted_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (status = 'draft' OR posted_at IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS journal_entries_number_idx ON public.journal_entries(entry_number);
CREATE INDEX IF NOT EXISTS journal_entries_period_idx ON public.journal_entries(period_id);
CREATE INDEX IF NOT EXISTS journal_entries_date_idx ON public.journal_entries(entry_date);
CREATE INDEX IF NOT EXISTS journal_entries_reference_idx ON public.journal_entries(reference_type, reference_id);
CREATE INDEX IF NOT EXISTS journal_entries_status_idx ON public.journal_entries(status);
CREATE INDEX IF NOT EXISTS journal_entries_created_by_idx ON public.journal_entries(created_by);

CREATE TRIGGER journal_entries_set_updated_at 
  BEFORE UPDATE ON public.journal_entries 
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- Table: journal_entry_lines (Lignes d'écritures)
CREATE TABLE IF NOT EXISTS public.journal_entry_lines (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  journal_entry_id UUID NOT NULL REFERENCES public.journal_entries(id) ON DELETE CASCADE,
  account_id UUID NOT NULL REFERENCES public.accounts(id) ON DELETE RESTRICT,
  description TEXT,
  debit_amount NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK (debit_amount >= 0),
  credit_amount NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK (credit_amount >= 0),
  line_number INTEGER NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (debit_amount > 0 OR credit_amount > 0),
  CHECK (NOT (debit_amount > 0 AND credit_amount > 0))
);

CREATE INDEX IF NOT EXISTS journal_entry_lines_entry_idx ON public.journal_entry_lines(journal_entry_id);
CREATE INDEX IF NOT EXISTS journal_entry_lines_account_idx ON public.journal_entry_lines(account_id);
CREATE INDEX IF NOT EXISTS journal_entry_lines_line_number_idx ON public.journal_entry_lines(journal_entry_id, line_number);

-- RLS sur les tables comptables
ALTER TABLE public.accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.accounting_periods ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.journal_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.journal_entry_lines ENABLE ROW LEVEL SECURITY;

-- Politiques RLS initiales (seront affinées dans migration 6)
CREATE POLICY "accounts readable by authenticated" 
  ON public.accounts FOR SELECT TO authenticated USING (true);

CREATE POLICY "accounting_periods readable by authenticated" 
  ON public.accounting_periods FOR SELECT TO authenticated USING (true);

CREATE POLICY "journal_entries readable by authenticated" 
  ON public.journal_entries FOR SELECT TO authenticated USING (true);

CREATE POLICY "journal_entry_lines readable by authenticated" 
  ON public.journal_entry_lines FOR SELECT TO authenticated USING (true);
