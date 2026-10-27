# Guide d'Utilisation - Comptable

## Vue d'ensemble
En tant que Comptable, vous êtes responsable de la gestion comptable du système POS Makèt Peyizan. Ce guide vous explique comment gérer les écritures comptables, les rapports financiers et l'intégration avec les ventes.

## Accès au Module Comptabilité

### Navigation
1. Connectez-vous avec vos identifiants
2. Cliquez sur "Comptabilité" dans le menu de navigation
3. Le module comptable s'ouvre avec trois onglets:
   - Plan comptable
   - Écritures
   - Balance

## Plan Comptable

### Consulter le plan comptable
1. Onglet "Plan comptable"
2. Liste des comptes avec:
   - Code comptable
   - Nom du compte
   - Type (Actif, Passif, Capitaux propres, Revenus, Charges)
   - Statut actif/inactif

### Structure du plan comptable
Le système utilise un plan comptable adapté aux normes haïtiennes:
- **Classe 1**: Capitaux (10-19)
- **Classe 2**: Immobilisations (20-29)
- **Classe 3**: Stocks (30-39)
- **Classe 4**: Tiers (40-49)
- **Classe 5**: Trésorerie (50-59)
- **Classe 6**: Charges (60-69)
- **Classe 7**: Revenus (70-79)

### Comptes principaux
- **411**: Caisse
- **412**: Banque
- **445**: TVA collectée/deductible
- **701**: Ventes de marchandises
- **603**: Achats de marchandises
- **606**: Achats de fournitures

## Écritures Comptables

### Créer une écriture manuelle
1. Onglet "Écritures"
2. Cliquez sur "Nouvelle écriture" (si disponible)
3. Remplissez les informations:
   - Date de l'écriture
   - Description
   - Période comptable
4. Ajoutez les lignes:
   - Sélectionnez le compte
   - Entrez le montant au débit OU au crédit
   - Répétez pour chaque ligne
5. Vérifiez que débit = crédit
6. Sauvegardez en brouillon

### Valider une écriture
1. Dans la liste des écritures en brouillon
2. Vérifiez les détails de l'écriture
3. Cliquez sur "Valider"
4. L'écriture est maintenant postée et ne peut plus être modifiée

### Écritures automatiques
Le système génère automatiquement des écritures pour:
- **Ventes**: Débit 411 (Caisse) / Crédit 701 (Ventes) + 445 (TVA)
- **Achats**: Débit 603 (Achats) / Crédit 411 (Caisse)
- **Mouvements de stock**: Ajustement des comptes de stock

### Annuler une écriture
1. Sélectionnez l'écriture à annuler
2. Cliquez sur "Annuler"
3. Une écriture d'extinction est créée automatiquement

## Balance de Vérification

### Consulter la balance
1. Onglet "Balance"
2. La balance affiche:
   - Code et nom du compte
   - Type de compte
   - Total débit
   - Total crédit
   - Solde

### Vérifier l'équilibre
- Les totaux débit et crédit doivent être égaux
- Si ce n'est pas le cas, il y a une erreur dans les écritures
- Vérifiez les écritures en brouillon

### Interprétation des soldes
- **Actif**: Solde débiteur normal
- **Passif**: Solde créditeur normal
- **Capitaux propres**: Solde créditeur normal
- **Revenus**: Solde créditeur normal
- **Charges**: Solde débiteur normal

## Rapports Financiers

### Accéder aux rapports
1. Cliquez sur "Rapports" dans le menu
2. Sélectionnez l'onglet souhaité

### Balance
- Vue détaillée de la balance de vérification
- Export possible pour analyse

### Grand livre
- Historique chronologique de toutes les écritures
- Détail par compte
- Utile pour l'audit et la traçabilité

### Périodes comptables
- Gestion des périodes (mensuelles, trimestrielles, annuelles)
- Clôture des périodes
- Archivage des données

## Synchronisation Ventes → Comptabilité

### Vérifier les ventes non synchronisées
1. Cliquez sur "Ventes" dans le menu
2. Regardez la colonne "Comptabilité"
3. "En attente" indique une vente non synchronisée

### Synchroniser une vente
1. Cliquez sur "Synchroniser" pour la vente concernée
2. Le système génère l'écriture comptable automatiquement
3. Le statut passe à "Synchronisé"

### Vérification
- Après synchronisation, vérifiez l'écriture dans "Comptabilité > Écritures"
- Confirmez que les montants sont corrects

## Régularisations

### Types de régularisations
- **Accruals**: Charges ou produits à rattacher
- **Deferrals**: Charges ou produits constatés d'avance
- **Depreciation**: Amortissements
- **Provisions**: Provisions pour risques
- **Error correction**: Correction d'erreurs
- **Reconciliation**: Lettrage de comptes

### Processus de régularisation
1. Créez une écriture de régularisation
2. Sélectionnez le type
3. Ajoutez une description détaillée
4. Joignez les justificatifs si nécessaire
5. Soumettez pour validation (si requis)

## Bonnes Pratiques

### Gestion quotidienne
- Synchronisez les ventes quotidiennement
- Vérifiez la balance chaque jour
- Validez les écritures en brouillon rapidement

### Gestion mensuelle
- Clôturez la période comptable mensuelle
- Générez les rapports financiers
- Faites les régularisations nécessaires

### Gestion annuelle
- Clôture de l'exercice
- Bilan et compte de résultat
- Archivage des données

### Documentation
- Conservez les justificatifs pour toutes les écritures
- Notez les raisons des régularisations
- Archivez les rapports mensuels

## Dépannage

### Problème: La balance n'est pas équilibrée
**Solution**:
1. Vérifiez les écritures en brouillon
2. Cherchez les écritures avec débit ≠ crédit
3. Corrigez ou annulez l'écriture problématique

### Problème: Une vente ne se synchronise pas
**Solution**:
1. Vérifiez que la vente est en statut "completed"
2. Vérifiez que la période comptable est ouverte
3. Contactez le support technique

### Problème: Impossible de valider une écriture
**Solution**:
1. Vérifiez que débit = crédit
2. Vérifiez que la période comptable est ouverte
3. Vérifiez que vous avez les permissions nécessaires

## Sécurité

### Protection des données
- Ne partagez jamais vos identifiants
- Verrouillez votre session quand vous quittez
- Signalez toute activité suspecte

### Intégrité comptable
- Ne modifiez jamais directement la base de données
- Utilisez toujours l'interface pour les modifications
- Conservez une trace de toutes les régularisations

## Support
Pour toute question technique ou problème complexe, contactez le directeur ou le support informatique.
