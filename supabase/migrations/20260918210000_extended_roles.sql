-- Migration 1: Extension des rôles pour POS Makèt Peyizan
-- Ajout des 4 rôles requis: directeur, comptable, caissière, gestionnaire stock

-- Mise à jour des rôles existants
UPDATE public.roles 
SET name = 'ADMINISTRATEUR', 
    description = 'Accès complet au système (rôle temporaire pour transition)'
WHERE code = 'administrator';

UPDATE public.roles 
SET name = 'CAISSIÈRE', 
    description = 'Caisse, clients, produits, proformas et ses ventes'
WHERE code = 'cashier';

-- Insertion des nouveaux rôles
INSERT INTO public.roles (code, name, description) VALUES
  ('director', 'DIRECTEUR', 'Accès complet et supervision de toutes les opérations'),
  ('accountant', 'COMPTABLE', 'Comptabilité, finance, rapports et écritures'),
  ('stock_manager', 'GESTIONNAIRE STOCK', 'Gestion complète du stock et des inventaires')
ON CONFLICT (code) DO UPDATE SET 
  name = EXCLUDED.name, 
  description = EXCLUDED.description;

-- Création d'une séquence pour numérotation des écritures de régularisation
CREATE SEQUENCE IF NOT EXISTS public.adjustment_number_seq START WITH 1 INCREMENT BY 1;
