# Guide d'Utilisation - Directeur

## Vue d'ensemble
En tant que Directeur, vous avez un accès complet à toutes les fonctionnalités du système POS Makèt Peyizan. Ce guide vous explique comment utiliser les principales fonctionnalités de gestion et de supervision.

## Tableau de bord
Le tableau de bord vous donne une vue d'ensemble de l'activité:
- **Nombre de produits**: Total des produits en catalogue
- **Produits en rupture de stock**: Produits avec stock = 0
- **Stock faible**: Produits sous le seuil d'alerte
- **Valeur du stock**: Valeur totale du stock actuel

## Gestion des Utilisateurs

### Accéder à la gestion des utilisateurs
1. Cliquez sur "Utilisateurs" dans le menu de navigation
2. Vous verrez la liste de tous les utilisateurs avec leurs rôles

### Modifier le rôle d'un utilisateur
1. Dans la liste des utilisateurs, utilisez le menu déroulant "Rôle"
2. Sélectionnez le nouveau rôle
3. Le changement est appliqué automatiquement

### Activer/Désactiver un utilisateur
1. Cliquez sur le bouton "Actif/Inactif" à côté de l'utilisateur
2. L'utilisateur ne pourra plus se connecter si désactivé
3. **Note**: Vous ne pouvez pas désactiver votre propre compte

### Rôles disponibles
- **DIRECTEUR**: Accès complet et supervision
- **COMPTABLE**: Comptabilité, finance, rapports
- **CAISSIER**: Caisse et ventes
- **GESTIONNAIRE STOCK**: Gestion du stock et inventaires

## Paramètres du Système

### Accéder aux paramètres
1. Cliquez sur "Paramètres" dans le menu
2. Les paramètres sont organisés par catégories

### Informations entreprise
- **Nom de l'entreprise**: Nom affiché sur les documents
- **Devise**: Devise utilisée (défaut: HTG)
- **Taux de TVA**: Pourcentage de TVA appliqué (défaut: 18.5%)

### Numérotation des documents
- **Préfixe reçus**: Préfixe pour les numéros de reçus (défaut: REC)
- **Préfixe factures**: Préfixe pour les numéros de factures (défaut: FAC)

### Options de caisse
- **Autoriser les stocks négatifs**: Permet de vendre même sans stock (non recommandé)
- **Client obligatoire**: Oblige à sélectionner un client pour chaque vente

### Comptabilité
- **Méthode de valorisation du stock**:
  - Coût moyen pondéré: Moyenne des coûts d'achat
  - FIFO: Premier entré, premier sorti

## Rapports Financiers

### Accéder aux rapports
1. Cliquez sur "Rapports" dans le menu
2. Sélectionnez l'onglet souhaité

### Balance
- Affiche le solde de chaque compte comptable
- Totaux débit/crédit pour vérification
- Utilisé pour vérifier l'équilibre comptable

### Grand livre
- Historique de toutes les écritures comptables
- Détail par compte et par écriture
- Utile pour l'audit et la traçabilité

### Journal d'audit (réservé au directeur)
- Historique de toutes les actions dans le système
- Qui a fait quoi et quand
- Indique si l'action a réussi ou échoué

## Comptabilité

### Plan comptable
1. Cliquez sur "Comptabilité" dans le menu
2. Onglet "Plan comptable"
3. Liste des comptes avec codes et types

### Écritures comptables
1. Onglet "Écritures"
2. Liste des écritures en brouillon
3. Cliquez sur "Valider" pour poster une écriture

### Balance de vérification
1. Onglet "Balance"
2. Affiche les totaux débit/crédit par compte
3. Vérifiez que les totaux sont équilibrés

## Supervision des Ventes

### Historique des ventes
1. Cliquez sur "Ventes" dans le menu
2. Liste de toutes les ventes avec:
   - Numéro de vente
   - Date et client
   - Montant
   - Statut de synchronisation comptable

### Synchronisation comptable
- Si une vente n'est pas synchronisée, cliquez sur "Synchroniser"
- Le système générera automatiquement l'écriture comptable

## Bonnes Pratiques

### Sécurité
- Changez régulièrement votre mot de passe
- Révoquez l'accès des employés qui quittent
- Surveillez le journal d'audit régulièrement

### Gestion
- Faites des sauvegardes avant les migrations
- Vérifiez la balance comptable mensuellement
- Surveillez les stocks en rupture

### Rapports
- Consultez les rapports financiers mensuellement
- Générez des rapports pour les périodes de fin d'exercice
- Archivez les rapports pour référence future

## Dépannage

### Problème: Un utilisateur ne peut pas se connecter
**Solution**: Vérifiez que son compte est actif dans "Utilisateurs"

### Problème: La balance n'est pas équilibrée
**Solution**: Vérifiez les écritures en brouillon dans "Comptabilité > Écritures"

### Problème: Une vente n'apparaît pas en comptabilité
**Solution**: Dans "Ventes", cliquez sur "Synchroniser" pour la vente concernée

## Support
Pour toute question technique ou problème, contactez l'équipe de support informatique.
