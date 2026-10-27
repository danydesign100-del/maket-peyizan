# Guide d'Utilisation - Gestionnaire de Stock

## Vue d'ensemble
En tant que Gestionnaire de Stock, vous êtes responsable de la gestion des produits, des fournisseurs et des mouvements de stock du système POS Makèt Peyizan. Ce guide vous explique comment gérer efficacement le stock.

## Gestion des Produits

### Accéder aux produits
1. Cliquez sur "Produits" dans le menu de navigation
2. Liste de tous les produits avec:
   - Code-barres
   - Nom
   - Catégorie
   - Prix de vente
   - Stock actuel
   - Statut (actif/inactif)

### Ajouter un nouveau produit
1. Cliquez sur "Nouveau produit"
2. Remplissez les informations:
   - **Code-barres**: Scannez ou entrez le code-barres
   - **Nom**: Nom du produit
   - **Catégorie**: Sélectionnez la catégorie appropriée
   - **Unité**: Unité de mesure (pièce, kg, litre, etc.)
   - **Prix d'achat**: Coût d'achat unitaire
   - **Prix de vente**: Prix de vente unitaire
   - **Stock initial**: Quantité en stock
   - **Seuil d'alerte**: Niveau minimum de stock
3. Cliquez sur "Enregistrer"
4. Un mouvement de stock initial est créé automatiquement

### Modifier un produit
1. Cliquez sur le produit à modifier
2. Modifiez les informations nécessaires
3. Cliquez sur "Enregistrer"

### Désactiver un produit
1. Sélectionnez le produit
2. Changez le statut en "Inactif"
3. Le produit n'apparaîtra plus dans la caisse

### Gestion des images
- Téléchargez une image pour chaque produit
- L'image s'affiche dans la caisse pour identification
- Utilisez des images claires et bien éclairées

## Gestion du Stock

### Consulter le stock
1. Cliquez sur "Stock" dans le menu
2. Vue d'ensemble du stock avec:
   - Liste des produits
   - Quantité actuelle
   - Valeur du stock
   - Filtres par catégorie et statut

### Créer un mouvement de stock
1. Cliquez sur "Nouveau mouvement"
2. Sélectionnez le type de mouvement:
   - **Entrée**: Réception de marchandise
   - **Sortie**: Sortie de marchandise (non-vente)
   - **Inventaire**: Ajustement d'inventaire
   - **Transfert**: Transfert entre emplacements
3. Sélectionnez le produit
4. Entrez la quantité
5. Ajoutez une description/motif
6. Cliquez sur "Enregistrer"

### Types de mouvements
- **Entrée (entry)**: Réception de fournisseurs, retour client
- **Sortie (exit)**: Ventes, pertes, dons
- **Inventaire (inventory)**: Ajustement après comptage
- **Transfert (transfer)**: Déplacement entre magasins

### Historique des mouvements
1. Cliquez sur "Mouvements" dans le menu
2. Liste chronologique de tous les mouvements
3. Filtres par type, produit, date
4. Détails de chaque mouvement

## Inventaire

### Préparer un inventaire
1. Planifiez la date de l'inventaire
2. Imprimez la liste des produits
3. Comptez physiquement le stock
4. Notez les écarts

### Enregistrer les résultats d'inventaire
1. Pour chaque produit avec écart:
   - Créez un mouvement de type "Inventaire"
   - Entrez la quantité comptée
   - Ajoutez "Inventaire [date]" comme motif
2. Le système ajustera le stock automatiquement

### Fréquence recommandée
- **Inventaire tournant**: Mensuel pour les produits à rotation rapide
- **Inventaire complet**: Trimestriel ou semestriel
- **Inventaire annuel**: Obligatoire pour clôture comptable

## Gestion des Fournisseurs

### Ajouter un fournisseur
1. Cliquez sur "Fournisseurs" dans le menu
2. Cliquez sur "Nouveau fournisseur"
3. Remplissez les informations:
   - Nom de l'entreprise
   - Contact
   - Téléphone
   - Email
   - Adresse
4. Cliquez sur "Enregistrer"

### Modifier un fournisseur
1. Sélectionnez le fournisseur
2. Modifiez les informations
3. Cliquez sur "Enregistrer"

### Associer un produit à un fournisseur
1. Dans la fiche produit
2. Sélectionnez le fournisseur principal
3. Le fournisseur apparaîtra dans les rapports d'achat

## Alertes de Stock

### Produits en rupture de stock
- Stock = 0
- Apparaissent en rouge dans le dashboard
- Priorité de réapprovisionnement immédiate

### Stock faible
- Stock < seuil d'alerte
- Apparaissent en orange dans le dashboard
- Planifiez le réapprovisionnement

### Gestion des alertes
1. Consultez régulièrement le dashboard
2. Générez des commandes pour les produits en alerte
3. Suivez les délais de livraison

## Bonnes Pratiques

### Réception des marchandises
1. Vérifiez la quantité reçue
2. Vérifiez la qualité des produits
3. Créez un mouvement d'entrée immédiatement
4. Stockez les produits correctement

### Organisation du stock
- Utilisez un système de rangement logique
- Étiquetez clairement les emplacements
- Séparez les produits par catégorie
- Respectez les conditions de conservation

### Rotation des stocks
- Appliquez la règle FIFO (Premier entré, premier sorti)
- Placez les nouveaux produits derrière les anciens
- Surveillez les dates de péremption

### Documentation
- Conservez les bons de livraison
- Notez les retours et litiges
- Archivez les documents d'inventaire

## Rapports

### État du stock
- Quantité totale par produit
- Valeur du stock
- Produits en rupture
- Produits en alerte

### Mouvements de stock
- Historique des entrées/sorties
- Analyse par période
- Identification des anomalies

### Fournisseurs
- Liste des fournisseurs
- Historique des achats
- Évaluation des performances

## Dépannage

### Problème: Le stock affiché ne correspond pas à la réalité
**Solution**:
1. Faites un inventaire physique
2. Créez des mouvements d'inventaire pour corriger
3. Enquêtez sur la cause de l'écart

### Problème: Impossible de créer un mouvement de stock
**Solution**:
1. Vérifiez que vous avez les permissions
2. Vérifiez que le produit existe
3. Contactez le directeur si le problème persiste

### Problème: Un produit apparaît en rupture mais est disponible
**Solution**:
1. Vérifiez les mouvements récents
2. Corrigez si erreur de saisie
3. Faites un inventaire si nécessaire

## Sécurité

### Protection des données
- Ne partagez jamais vos identifiants
- Verrouillez votre session quand vous quittez
- Signalez toute activité suspecte

### Prévention des pertes
- Surveillez les zones de stock
- Limitez l'accès aux zones sensibles
- Signalez les disparitions immédiatement

## Collaboration

### Avec les caissiers
- Informez-les des ruptures de stock
- Répondez à leurs questions sur les produits
- Coordonnez les réapprovisionnements

### Avec le comptable
- Fournissez les documents de réception
- Signalez les écarts d'inventaire
- Participez aux clôtures comptables

### Avec le directeur
- Rapportez les problèmes de stock
- Proposez des améliorations
- Suivez les objectifs de rotation

## Support
Pour toute question ou problème, contactez le directeur ou le support informatique.
