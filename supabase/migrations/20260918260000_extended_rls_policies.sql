-- Migration 6: Politiques RLS étendues par rôle
-- Implémentation de la matrice des permissions

-- Suppression des anciennes politiques trop permissives
DROP POLICY IF EXISTS "profiles self or administrator read" ON public.profiles;
DROP POLICY IF EXISTS "profiles administrator manage" ON public.profiles;
DROP POLICY IF EXISTS "categories administrator manage" ON public.categories;
DROP POLICY IF EXISTS "products administrator manage" ON public.products;
DROP POLICY IF EXISTS "suppliers administrator manage" ON public.suppliers;
DROP POLICY IF EXISTS "customers update by staff" ON public.customers;
DROP POLICY IF EXISTS "stock managed by administrators" ON public.stock_movements;
DROP POLICY IF EXISTS "sales administrator update" ON public.sales;
DROP POLICY IF EXISTS "sale items administrator manage" ON public.sale_items;
DROP POLICY IF EXISTS "payments administrator update" ON public.payments;
DROP POLICY IF EXISTS "expenses administrator manage" ON public.expenses;
DROP POLICY IF EXISTS "cash sessions administrator delete" ON public.cash_sessions;
DROP POLICY IF EXISTS "settings administrator manage" ON public.settings;

-- ============================================
-- TABLE: roles
-- ============================================
DROP POLICY IF EXISTS "roles readable by authenticated" ON public.roles;
DROP POLICY IF EXISTS "roles director manage" ON public.roles;

CREATE POLICY "roles readable by authenticated" 
  ON public.roles FOR SELECT TO authenticated USING (true);

CREATE POLICY "roles director manage" 
  ON public.roles FOR ALL TO authenticated 
  USING (public.has_role('director')) 
  WITH CHECK (public.has_role('director'));

-- ============================================
-- TABLE: profiles
-- ============================================
CREATE POLICY "profiles self read" 
  ON public.profiles FOR SELECT TO authenticated 
  USING (id = auth.uid());

CREATE POLICY "profiles director read all" 
  ON public.profiles FOR SELECT TO authenticated 
  USING (public.has_role('director'));

CREATE POLICY "profiles director manage" 
  ON public.profiles FOR ALL TO authenticated 
  USING (public.has_role('director')) 
  WITH CHECK (public.has_role('director'));

-- ============================================
-- TABLE: categories
-- ============================================
CREATE POLICY "categories read by all" 
  ON public.categories FOR SELECT TO authenticated USING (true);

CREATE POLICY "categories manage by director and stock_manager" 
  ON public.categories FOR ALL TO authenticated 
  USING (public.has_role('director') OR public.has_role('stock_manager'))
  WITH CHECK (public.has_role('director') OR public.has_role('stock_manager'));

-- ============================================
-- TABLE: products
-- ============================================
CREATE POLICY "products read by all" 
  ON public.products FOR SELECT TO authenticated USING (true);

CREATE POLICY "products manage by director and stock_manager" 
  ON public.products FOR INSERT TO authenticated 
  WITH CHECK (public.has_role('director') OR public.has_role('stock_manager'));

CREATE POLICY "products update by director and stock_manager" 
  ON public.products FOR UPDATE TO authenticated 
  USING (public.has_role('director') OR public.has_role('stock_manager'))
  WITH CHECK (public.has_role('director') OR public.has_role('stock_manager'));

CREATE POLICY "products deactivate by director" 
  ON public.products FOR UPDATE TO authenticated 
  USING (public.has_role('director'))
  WITH CHECK (public.has_role('director'));

-- ============================================
-- TABLE: suppliers
-- ============================================
CREATE POLICY "suppliers read by all" 
  ON public.suppliers FOR SELECT TO authenticated USING (true);

CREATE POLICY "suppliers manage by director and stock_manager" 
  ON public.suppliers FOR ALL TO authenticated 
  USING (public.has_role('director') OR public.has_role('stock_manager'))
  WITH CHECK (public.has_role('director') OR public.has_role('stock_manager'));

-- ============================================
-- TABLE: customers
-- ============================================
CREATE POLICY "customers read by all" 
  ON public.customers FOR SELECT TO authenticated USING (true);

CREATE POLICY "customers insert by cashier and director" 
  ON public.customers FOR INSERT TO authenticated 
  WITH CHECK (public.has_role('cashier') OR public.has_role('director'));

CREATE POLICY "customers update by cashier and director" 
  ON public.customers FOR UPDATE TO authenticated 
  USING (public.has_role('cashier') OR public.has_role('director'))
  WITH CHECK (public.has_role('cashier') OR public.has_role('director'));

CREATE POLICY "customers delete by director" 
  ON public.customers FOR DELETE TO authenticated 
  USING (public.has_role('director'));

-- ============================================
-- TABLE: stock_movements
-- ============================================
DROP POLICY IF EXISTS "stock movements readable by authenticated" ON public.stock_movements;
DROP POLICY IF EXISTS "stock movements direct writes denied" ON public.stock_movements;
DROP POLICY IF EXISTS "stock movements direct updates denied" ON public.stock_movements;
DROP POLICY IF EXISTS "stock movements direct deletes denied" ON public.stock_movements;

CREATE POLICY "stock_movements read by director and stock_manager" 
  ON public.stock_movements FOR SELECT TO authenticated 
  USING (public.has_role('director') OR public.has_role('stock_manager'));

CREATE POLICY "stock_movements direct writes denied" 
  ON public.stock_movements FOR INSERT TO authenticated 
  WITH CHECK (false);

CREATE POLICY "stock_movements direct updates denied" 
  ON public.stock_movements FOR UPDATE TO authenticated 
  USING (false);

CREATE POLICY "stock_movements direct deletes denied" 
  ON public.stock_movements FOR DELETE TO authenticated 
  USING (false);

-- ============================================
-- TABLE: sales
-- ============================================
CREATE POLICY "sales read own by cashier" 
  ON public.sales FOR SELECT TO authenticated 
  USING (created_by = auth.uid());

CREATE POLICY "sales read all by director and accountant" 
  ON public.sales FOR SELECT TO authenticated 
  USING (public.has_role('director') OR public.has_role('accountant'));

CREATE POLICY "sales insert by cashier and director" 
  ON public.sales FOR INSERT TO authenticated 
  WITH CHECK (public.has_role('cashier') OR public.has_role('director'));

CREATE POLICY "sales update by director only" 
  ON public.sales FOR UPDATE TO authenticated 
  USING (public.has_role('director'))
  WITH CHECK (public.has_role('director'));

CREATE POLICY "sales delete by director only" 
  ON public.sales FOR DELETE TO authenticated 
  USING (public.has_role('director'));

-- ============================================
-- TABLE: sale_items
-- ============================================
CREATE POLICY "sale_items read own by cashier" 
  ON public.sale_items FOR SELECT TO authenticated 
  USING (EXISTS (
    SELECT 1 FROM public.sales s 
    WHERE s.id = sale_items.sale_id AND s.created_by = auth.uid()
  ));

CREATE POLICY "sale_items read all by director and accountant" 
  ON public.sale_items FOR SELECT TO authenticated 
  USING (public.has_role('director') OR public.has_role('accountant'));

CREATE POLICY "sale_items insert by cashier and director" 
  ON public.sale_items FOR INSERT TO authenticated 
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.sales s 
    WHERE s.id = sale_items.sale_id AND (s.created_by = auth.uid() OR public.has_role('director'))
  ));

CREATE POLICY "sale_items update by director only" 
  ON public.sale_items FOR UPDATE TO authenticated 
  USING (public.has_role('director'))
  WITH CHECK (public.has_role('director'));

CREATE POLICY "sale_items delete by director only" 
  ON public.sale_items FOR DELETE TO authenticated 
  USING (public.has_role('director'));

-- ============================================
-- TABLE: payments
-- ============================================
CREATE POLICY "payments read own by cashier" 
  ON public.payments FOR SELECT TO authenticated 
  USING (EXISTS (
    SELECT 1 FROM public.sales s 
    WHERE s.id = payments.sale_id AND s.created_by = auth.uid()
  ));

CREATE POLICY "payments read all by director and accountant" 
  ON public.payments FOR SELECT TO authenticated 
  USING (public.has_role('director') OR public.has_role('accountant'));

CREATE POLICY "payments insert by cashier and director" 
  ON public.payments FOR INSERT TO authenticated 
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.sales s 
    WHERE s.id = payments.sale_id AND (s.created_by = auth.uid() OR public.has_role('director'))
  ));

CREATE POLICY "payments update by director only" 
  ON public.payments FOR UPDATE TO authenticated 
  USING (public.has_role('director'))
  WITH CHECK (public.has_role('director'));

CREATE POLICY "payments delete by director only" 
  ON public.payments FOR DELETE TO authenticated 
  USING (public.has_role('director'));

-- ============================================
-- TABLE: expenses
-- ============================================
CREATE POLICY "expenses read by director and accountant" 
  ON public.expenses FOR SELECT TO authenticated 
  USING (public.has_role('director') OR public.has_role('accountant'));

CREATE POLICY "expenses insert by director and accountant" 
  ON public.expenses FOR INSERT TO authenticated 
  WITH CHECK (public.has_role('director') OR public.has_role('accountant'));

CREATE POLICY "expenses update by director and accountant" 
  ON public.expenses FOR UPDATE TO authenticated 
  USING (public.has_role('director') OR public.has_role('accountant'))
  WITH CHECK (public.has_role('director') OR public.has_role('accountant'));

CREATE POLICY "expenses delete by director only" 
  ON public.expenses FOR DELETE TO authenticated 
  USING (public.has_role('director'));

-- ============================================
-- TABLE: cash_sessions
-- ============================================
CREATE POLICY "cash_sessions read own by cashier" 
  ON public.cash_sessions FOR SELECT TO authenticated 
  USING (opened_by = auth.uid());

CREATE POLICY "cash_sessions read all by director and accountant" 
  ON public.cash_sessions FOR SELECT TO authenticated 
  USING (public.has_role('director') OR public.has_role('accountant'));

CREATE POLICY "cash_sessions insert by cashier and director" 
  ON public.cash_sessions FOR INSERT TO authenticated 
  WITH CHECK (public.has_role('cashier') OR public.has_role('director'));

CREATE POLICY "cash_sessions update own by cashier" 
  ON public.cash_sessions FOR UPDATE TO authenticated 
  USING (opened_by = auth.uid())
  WITH CHECK (opened_by = auth.uid());

CREATE POLICY "cash_sessions update all by director" 
  ON public.cash_sessions FOR UPDATE TO authenticated 
  USING (public.has_role('director'))
  WITH CHECK (public.has_role('director'));

CREATE POLICY "cash_sessions delete by director only" 
  ON public.cash_sessions FOR DELETE TO authenticated 
  USING (public.has_role('director'));

-- ============================================
-- TABLE: settings
-- ============================================
CREATE POLICY "settings read by all" 
  ON public.settings FOR SELECT TO authenticated USING (true);

CREATE POLICY "settings manage by director only" 
  ON public.settings FOR ALL TO authenticated 
  USING (public.has_role('director'))
  WITH CHECK (public.has_role('director'));

-- ============================================
-- TABLE: accounts (comptabilité)
-- ============================================
DROP POLICY IF EXISTS "accounts readable by authenticated" ON public.accounts;

CREATE POLICY "accounts read by director and accountant" 
  ON public.accounts FOR SELECT TO authenticated 
  USING (public.has_role('director') OR public.has_role('accountant'));

CREATE POLICY "manage accounts by director only" 
  ON public.accounts FOR ALL TO authenticated 
  USING (public.has_role('director'))
  WITH CHECK (public.has_role('director'));

-- ============================================
-- TABLE: accounting_periods
-- ============================================
DROP POLICY IF EXISTS "accounting_periods readable by authenticated" ON public.accounting_periods;

CREATE POLICY "accounting_periods read by director and accountant" 
  ON public.accounting_periods FOR SELECT TO authenticated 
  USING (public.has_role('director') OR public.has_role('accountant'));

CREATE POLICY "manage accounting_periods by director only" 
  ON public.accounting_periods FOR ALL TO authenticated 
  USING (public.has_role('director'))
  WITH CHECK (public.has_role('director'));

-- ============================================
-- TABLE: journal_entries
-- ============================================
DROP POLICY IF EXISTS "journal_entries readable by authenticated" ON public.journal_entries;

CREATE POLICY "journal_entries read by director and accountant" 
  ON public.journal_entries FOR SELECT TO authenticated 
  USING (public.has_role('director') OR public.has_role('accountant'));

CREATE POLICY "journal_entries insert by accountant" 
  ON public.journal_entries FOR INSERT TO authenticated 
  WITH CHECK (public.has_role('accountant'));

CREATE POLICY "journal_entries update draft by accountant" 
  ON public.journal_entries FOR UPDATE TO authenticated 
  USING (public.has_role('accountant') AND status = 'draft')
  WITH CHECK (public.has_role('accountant') AND status = 'draft');

CREATE POLICY "journal_entries update posted by director only" 
  ON public.journal_entries FOR UPDATE TO authenticated 
  USING (public.has_role('director'))
  WITH CHECK (public.has_role('director'));

CREATE POLICY "journal_entries delete by director only" 
  ON public.journal_entries FOR DELETE TO authenticated 
  USING (public.has_role('director'));

-- ============================================
-- TABLE: journal_entry_lines
-- ============================================
DROP POLICY IF EXISTS "journal_entry_lines readable by authenticated" ON public.journal_entry_lines;

CREATE POLICY "journal_entry_lines read by director and accountant" 
  ON public.journal_entry_lines FOR SELECT TO authenticated 
  USING (public.has_role('director') OR public.has_role('accountant'));

CREATE POLICY "journal_entry_lines insert by accountant" 
  ON public.journal_entry_lines FOR INSERT TO authenticated 
  WITH CHECK (public.has_role('accountant'));

CREATE POLICY "journal_entry_lines update by accountant" 
  ON public.journal_entry_lines FOR UPDATE TO authenticated 
  USING (public.has_role('accountant'))
  WITH CHECK (public.has_role('accountant'));

CREATE POLICY "journal_entry_lines delete by accountant" 
  ON public.journal_entry_lines FOR DELETE TO authenticated 
  USING (public.has_role('accountant'));

-- ============================================
-- Mise à jour des fonctions has_role pour les nouveaux rôles
-- ============================================
CREATE OR REPLACE FUNCTION public.is_director() 
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$ 
  SELECT public.has_role('director'); 
$$;

CREATE OR REPLACE FUNCTION public.is_accountant() 
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$ 
  SELECT public.has_role('accountant'); 
$$;

CREATE OR REPLACE FUNCTION public.is_stock_manager() 
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$ 
  SELECT public.has_role('stock_manager'); 
$$;

CREATE OR REPLACE FUNCTION public.is_cashier() 
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$ 
  SELECT public.has_role('cashier'); 
$$;
