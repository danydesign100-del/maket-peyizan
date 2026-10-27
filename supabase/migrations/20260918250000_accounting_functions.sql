-- Migration 5: Fonctions comptables et triggers

-- Fonction de validation de l'équilibre d'une écriture comptable
CREATE OR REPLACE FUNCTION public.validate_journal_entry_balance()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  total_debit NUMERIC(14,2);
  total_credit NUMERIC(14,2);
  tolerance NUMERIC(14,2) := 0.01;
BEGIN
  IF TG_OP = 'INSERT' OR TG_OP = 'UPDATE' THEN
    -- Calculer les totaux depuis les lignes
    SELECT COALESCE(SUM(debit_amount), 0), COALESCE(SUM(credit_amount), 0)
    INTO total_debit, total_credit
    FROM public.journal_entry_lines
    WHERE journal_entry_id = COALESCE(NEW.id, OLD.id);
    
    -- Vérifier l'équilibre
    IF ABS(total_debit - total_credit) > tolerance THEN
      RAISE EXCEPTION 'Écriture déséquilibrée: Débit=%, Crédit=% (écart=%)', 
        total_debit, total_credit, ABS(total_debit - total_credit);
    END IF;
    
    -- Mettre à jour les totaux dans l'écriture
    NEW.total_debit := total_debit;
    NEW.total_credit := total_credit;
  END IF;
  
  RETURN NEW;
END;
$$;

-- Trigger pour validation de l'équilibre
DROP TRIGGER IF EXISTS journal_entries_validate_balance ON public.journal_entries;
CREATE TRIGGER journal_entries_validate_balance
  BEFORE INSERT OR UPDATE ON public.journal_entries
  FOR EACH ROW EXECUTE FUNCTION public.validate_journal_entry_balance();

-- Fonction pour mettre à jour le coût moyen pondéré lors d'un mouvement de stock
CREATE OR REPLACE FUNCTION public.update_average_cost()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  current_stock NUMERIC(14,3);
  current_avg_cost NUMERIC(14,2);
  new_quantity NUMERIC(14,3);
  new_cost NUMERIC(14,2);
  total_value NUMERIC(14,2);
  new_avg_cost NUMERIC(14,2);
  valuation_method TEXT;
BEGIN
  -- Récupérer la méthode de valorisation
  SELECT value::TEXT INTO valuation_method
  FROM public.settings
  WHERE key = 'stock.valuation_method';
  
  valuation_method := COALESCE(valuation_method, 'weighted_average');
  
  IF valuation_method = 'weighted_average' AND NEW.movement_type = 'entry' AND NEW.purchase_price IS NOT NULL THEN
    -- Récupérer l'état actuel
    SELECT stock_quantity, average_cost
    INTO current_stock, current_avg_cost
    FROM public.products
    WHERE id = NEW.product_id;
    
    new_quantity := NEW.quantity;
    new_cost := NEW.purchase_price;
    
    -- Calculer le nouveau coût moyen
    total_value := (current_stock * current_avg_cost) + (new_quantity * new_cost);
    new_avg_cost := total_value / (current_stock + new_quantity);
    
    -- Mettre à jour le produit (via le trigger existant qui utilise le config)
    PERFORM set_config('pos.stock_movement', 'true', true);
    UPDATE public.products 
    SET average_cost = new_avg_cost
    WHERE id = NEW.product_id;
  END IF;
  
  RETURN NEW;
END;
$$;

-- Trigger pour mise à jour du coût moyen
DROP TRIGGER IF EXISTS stock_movements_update_average_cost ON public.stock_movements;
CREATE TRIGGER stock_movements_update_average_cost
  AFTER INSERT ON public.stock_movements
  FOR EACH ROW EXECUTE FUNCTION public.update_average_cost();

-- Fonction pour générer automatiquement l'écriture comptable d'une vente
CREATE OR REPLACE FUNCTION public.generate_sale_journal_entry(p_sale_id UUID)
RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_sale RECORD;
  v_journal_entry_id UUID;
  v_period_id UUID;
  v_cash_account_id UUID;
  v_revenue_account_id UUID;
  v_tax_account_id UUID;
  v_cogs_account_id UUID;
  v_inventory_account_id UUID;
  v_line_number INTEGER := 0;
  v_total_cogs NUMERIC(14,2) := 0;
  v_item RECORD;
BEGIN
  -- Récupérer la vente avec ses items
  SELECT s.*, si.product_id, si.quantity, si.unit_price
  INTO v_sale
  FROM public.sales s
  LEFT JOIN public.sale_items si ON s.id = si.sale_id
  WHERE s.id = p_sale_id
  LIMIT 1;
  
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Vente introuvable';
  END IF;
  
  -- Vérifier si déjà synchronisée
  IF v_sale.accounting_synced THEN
    RAISE EXCEPTION 'Vente déjà synchronisée avec la comptabilité';
  END IF;
  
  -- Trouver la période comptable ouverte
  SELECT id INTO v_period_id
  FROM public.accounting_periods
  WHERE start_date <= v_sale.sold_at::DATE
    AND end_date >= v_sale.sold_at::DATE
    AND NOT is_closed
  LIMIT 1;
  
  IF v_period_id IS NULL THEN
    -- Créer une période par défaut si aucune n'existe
    INSERT INTO public.accounting_periods (name, start_date, end_date)
    VALUES (
      'Période ' || to_char(v_sale.sold_at::DATE, 'YYYY-MM'),
      date_trunc('month', v_sale.sold_at::DATE),
      (date_trunc('month', v_sale.sold_at::DATE) + interval '1 month' - interval '1 day')
    )
    RETURNING id INTO v_period_id;
  END IF;
  
  -- Récupérer les comptes configurés
  SELECT (value->>'cash')::UUID INTO v_cash_account_id 
  FROM public.settings WHERE key = 'accounting.accounts';
  
  SELECT (value->>'revenue')::UUID INTO v_revenue_account_id 
  FROM public.settings WHERE key = 'accounting.accounts';
  
  SELECT (value->>'tax')::UUID INTO v_tax_account_id 
  FROM public.settings WHERE key = 'accounting.accounts';
  
  SELECT (value->>'cogs')::UUID INTO v_cogs_account_id 
  FROM public.settings WHERE key = 'accounting.accounts';
  
  SELECT (value->>'inventory')::UUID INTO v_inventory_account_id 
  FROM public.settings WHERE key = 'accounting.accounts';
  
  -- Si les comptes ne sont pas configurés, utiliser des IDs par défaut (à configurer)
  IF v_cash_account_id IS NULL THEN
    RAISE EXCEPTION 'Comptes comptables non configurés. Configurez-les dans settings.accounting.accounts';
  END IF;
  
  -- Créer l'écriture comptable
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
  
  -- Ligne 1: Débit Caisse (encaissement)
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
  
  -- Ligne 2: Crédit Ventes (chiffre d'affaires)
  v_line_number := v_line_number + 1;
  INSERT INTO public.journal_entry_lines (
    journal_entry_id, account_id, description,
    debit_amount, credit_amount, line_number
  ) VALUES (
    v_journal_entry_id,
    v_revenue_account_id,
    'Vente de marchandises ' || v_sale.sale_number,
    0,
    v_sale.subtotal - v_sale.discount_amount,
    v_line_number
  );
  
  -- Ligne 3: Crédit TVA (si applicable)
  IF v_sale.tax_amount > 0 AND v_tax_account_id IS NOT NULL THEN
    v_line_number := v_line_number + 1;
    INSERT INTO public.journal_entry_lines (
      journal_entry_id, account_id, description,
      debit_amount, credit_amount, line_number
    ) VALUES (
      v_journal_entry_id,
      v_tax_account_id,
      'TVA collectée sur vente ' || v_sale.sale_number,
      0,
      v_sale.tax_amount,
      v_line_number
    );
  END IF;
  
  -- Calculer le COGS (Coût des Marchandises Vendues)
  -- Pour chaque item de vente
  FOR v_item IN 
    SELECT si.product_id, si.quantity, p.average_cost
    FROM public.sale_items si
    JOIN public.products p ON si.product_id = p.id
    WHERE si.sale_id = p_sale_id
  LOOP
    v_total_cogs := v_total_cogs + (v_item.quantity * COALESCE(v_item.average_cost, 0));
  END LOOP;
  
  -- Ligne 4: Débit COGS
  IF v_total_cogs > 0 AND v_cogs_account_id IS NOT NULL THEN
    v_line_number := v_line_number + 1;
    INSERT INTO public.journal_entry_lines (
      journal_entry_id, account_id, description,
      debit_amount, credit_amount, line_number
    ) VALUES (
      v_journal_entry_id,
      v_cogs_account_id,
      'Coût des marchandises vendues ' || v_sale.sale_number,
      v_total_cogs,
      0,
      v_line_number
    );
    
    -- Ligne 5: Crédit Stock (sortie de stock)
    IF v_inventory_account_id IS NOT NULL THEN
      v_line_number := v_line_number + 1;
      INSERT INTO public.journal_entry_lines (
        journal_entry_id, account_id, description,
        debit_amount, credit_amount, line_number
      ) VALUES (
        v_journal_entry_id,
        v_inventory_account_id,
        'Sortie de stock pour vente ' || v_sale.sale_number,
        0,
        v_total_cogs,
        v_line_number
      );
    END IF;
  END IF;
  
  -- Mettre à jour la vente
  UPDATE public.sales
  SET journal_entry_id = v_journal_entry_id,
      accounting_synced = TRUE,
      accounting_synced_at = NOW()
  WHERE id = p_sale_id;
  
  -- Logger dans l'audit
  PERFORM public.log_audit(
    'accounting_sync',
    'sales',
    p_sale_id,
    NULL,
    '{"journal_entry_id": "' || v_journal_entry_id || '"}'::jsonb,
    TRUE
  );
  
  RETURN v_journal_entry_id;
EXCEPTION
  WHEN OTHERS THEN
    -- Enregistrer l'erreur
    UPDATE public.sales
    SET accounting_error = SQLERRM
    WHERE id = p_sale_id;
    
    PERFORM public.log_audit(
      'accounting_sync_failed',
      'sales',
      p_sale_id,
      NULL,
      NULL,
      FALSE,
      SQLERRM
    );
    
    RAISE;
END;
$$;

-- Fonction RPC pour synchroniser une vente (accessible depuis le frontend)
CREATE OR REPLACE FUNCTION public.sync_sale_to_accounting(p_sale_id UUID)
RETURNS JSONB LANGUAGE plpgsql SECURITY INVOKER SET search_path = public AS $$
DECLARE
  v_journal_entry_id UUID;
  v_result JSONB;
BEGIN
  -- Vérifier les permissions
  IF NOT (public.has_role('director') OR public.has_role('accountant')) THEN
    RAISE EXCEPTION 'Permission refusée: rôle directeur ou comptable requis';
  END IF;
  
  -- Générer l'écriture
  v_journal_entry_id := public.generate_sale_journal_entry(p_sale_id);
  
  -- Retourner le résultat
  v_result := jsonb_build_object(
    'success', TRUE,
    'journal_entry_id', v_journal_entry_id
  );
  
  RETURN v_result;
END;
$$;

-- Accorder l'exécution de la fonction
REVOKE ALL ON FUNCTION public.sync_sale_to_accounting(UUID) FROM public;
GRANT EXECUTE ON FUNCTION public.sync_sale_to_accounting(UUID) TO authenticated;

-- Fonction pour valider (poster) une écriture comptable
CREATE OR REPLACE FUNCTION public.post_journal_entry(p_entry_id UUID)
RETURNS BOOLEAN LANGUAGE plpgsql SECURITY INVOKER SET search_path = public AS $$
BEGIN
  -- Vérifier les permissions
  IF NOT (public.has_role('director') OR public.has_role('accountant')) THEN
    RAISE EXCEPTION 'Permission refusée';
  END IF;
  
  -- Vérifier que l'écriture est en brouillon
  IF NOT EXISTS (SELECT 1 FROM public.journal_entries WHERE id = p_entry_id AND status = 'draft') THEN
    RAISE EXCEPTION 'Seules les écritures en brouillon peuvent être validées';
  END IF;
  
  -- Vérifier que la période n'est pas clôturée
  IF EXISTS (
    SELECT 1 FROM public.journal_entries je
    JOIN public.accounting_periods ap ON je.period_id = ap.id
    WHERE je.id = p_entry_id AND ap.is_closed
  ) THEN
    RAISE EXCEPTION 'La période comptable est clôturée';
  END IF;
  
  -- Valider l'écriture
  UPDATE public.journal_entries
  SET status = 'posted',
      posted_by = auth.uid(),
      posted_at = NOW()
  WHERE id = p_entry_id;
  
  -- Logger
  PERFORM public.log_audit(
    'journal_entry_posted',
    'journal_entries',
    p_entry_id,
    '{"status": "draft"}'::jsonb,
    '{"status": "posted"}'::jsonb,
    TRUE
  );
  
  RETURN TRUE;
END;
$$;

REVOKE ALL ON FUNCTION public.post_journal_entry(UUID) FROM public;
GRANT EXECUTE ON FUNCTION public.post_journal_entry(UUID) TO authenticated;
