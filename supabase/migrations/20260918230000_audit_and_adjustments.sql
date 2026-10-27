-- Migration 3: Journal d'audit et écritures de régularisation

-- Table: audit_log (Journal d'audit)
CREATE TABLE IF NOT EXISTS public.audit_log (
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
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Index pour recherche efficace dans l'audit
CREATE INDEX IF NOT EXISTS audit_log_user_idx ON public.audit_log(user_id);
CREATE INDEX IF NOT EXISTS audit_log_profile_idx ON public.audit_log(profile_id);
CREATE INDEX IF NOT EXISTS audit_log_entity_idx ON public.audit_log(entity_type, entity_id);
CREATE INDEX IF NOT EXISTS audit_log_action_idx ON public.audit_log(action);
CREATE INDEX IF NOT EXISTS audit_log_created_idx ON public.audit_log(created_at DESC);
CREATE INDEX IF NOT EXISTS audit_log_success_idx ON public.audit_log(success) WHERE NOT success;

-- RLS sur audit_log
ALTER TABLE public.audit_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "audit_log readable by director" 
  ON public.audit_log FOR SELECT TO authenticated 
  USING (public.has_role('director'));

CREATE POLICY "audit_log insert by system" 
  ON public.audit_log FOR INSERT TO authenticated 
  WITH CHECK (true);

-- Fonction pour enregistrer dans l'audit
CREATE OR REPLACE FUNCTION public.log_audit(
  p_action TEXT,
  p_entity_type TEXT,
  p_entity_id UUID DEFAULT NULL,
  p_old_values JSONB DEFAULT NULL,
  p_new_values JSONB DEFAULT NULL,
  p_success BOOLEAN DEFAULT TRUE,
  p_error_message TEXT DEFAULT NULL
)
RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_result UUID;
BEGIN
  INSERT INTO public.audit_log (
    user_id, profile_id, action, entity_type, entity_id,
    old_values, new_values, ip_address, user_agent, success, error_message
  ) VALUES (
    auth.uid(),
    (SELECT id FROM public.profiles WHERE id = auth.uid()),
    p_action,
    p_entity_type,
    p_entity_id,
    p_old_values,
    p_new_values,
    NULL, -- IP address would need to be passed from client
    NULL, -- User agent would need to be passed from client
    p_success,
    p_error_message
  ) RETURNING id INTO v_result;
  
  RETURN v_result;
END;
$$;

-- Table: adjustments (Écritures de régularisation)
CREATE TABLE IF NOT EXISTS public.adjustments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  adjustment_number TEXT NOT NULL UNIQUE DEFAULT ('AJT-' || lpad(nextval('public.adjustment_number_seq')::text, 6, '0')),
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
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS adjustments_number_idx ON public.adjustments(adjustment_number);
CREATE INDEX IF NOT EXISTS adjustments_period_idx ON public.adjustments(period_id);
CREATE INDEX IF NOT EXISTS adjustments_status_idx ON public.adjustments(status);
CREATE INDEX IF NOT EXISTS adjustments_type_idx ON public.adjustments(adjustment_type);
CREATE INDEX IF NOT EXISTS adjustments_prepared_by_idx ON public.adjustments(prepared_by);

CREATE TRIGGER adjustments_set_updated_at 
  BEFORE UPDATE ON public.adjustments 
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- RLS sur adjustments
ALTER TABLE public.adjustments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "adjustments readable by director and accountant" 
  ON public.adjustments FOR SELECT TO authenticated 
  USING (public.has_role('director') OR public.has_role('accountant'));

CREATE POLICY "adjustments insert by accountant" 
  ON public.adjustments FOR INSERT TO authenticated 
  WITH CHECK (public.has_role('accountant') OR public.has_role('director'));

CREATE POLICY "adjustments update draft by accountant" 
  ON public.adjustments FOR UPDATE TO authenticated 
  USING ((public.has_role('accountant') OR public.has_role('director')) AND status = 'draft')
  WITH CHECK ((public.has_role('accountant') OR public.has_role('director')) AND status = 'draft');

CREATE POLICY "adjustments approve by director" 
  ON public.adjustments FOR UPDATE TO authenticated 
  USING (public.has_role('director') AND status = 'pending_approval')
  WITH CHECK (public.has_role('director'));
