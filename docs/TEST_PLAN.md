# Plan de Tests et Vérification - POS Makèt Peyizan

## Vue d'ensemble
Ce document définit le plan de tests pour vérifier le bon fonctionnement du système POS Makèt Peyizan avant mise en production.

## 1. Tests de Migration de Base de Données

### 1.1 Application des migrations
- [ ] Appliquer toutes les migrations dans l'ordre chronologique
- [ ] Vérifier que chaque migration s'exécute sans erreur
- [ ] Confirmer que toutes les tables sont créées
- [ ] Vérifier les indexes et contraintes

### 1.2 Vérification des données
- [ ] Vérifier que les données existantes sont intactes
- [ ] Confirmer que les rôles étendus sont présents
- [ ] Vérifier le plan comptable initial
- [ ] Confirmer les paramètres par défaut

### 1.3 Rollback
- [ ] Tester le rollback d'une migration
- [ ] Vérifier que les données sont restaurées
- [ ] Confirmer que le système fonctionne après rollback

## 2. Tests d'Authentification et Autorisation

### 2.1 Authentification
- [ ] Connexion avec identifiants valides
- [ ] Connexion avec identifiants invalides
- [ ] Déconnexion
- [ ] Session persistante après rechargement
- [ ] Expiration de session

### 2.2 Rôles et Permissions
- [ ] **Directeur**: Accès à tous les menus
- [ ] **Comptable**: Accès comptabilité et rapports uniquement
- [ ] **Caissier**: Accès caisse et ventes uniquement
- [ ] **Gestionnaire Stock**: Accès stock et produits uniquement
- [ ] **Administrateur**: Accès complet (héritage)

### 2.3 RLS (Row Level Security)
- [ ] Vérifier que chaque rôle ne voit que ses données
- [ ] Tester l'accès interdit aux tables non autorisées
- [ ] Vérifier les politiques de modification par rôle

## 3. Tests du Module Caisse (POS)

### 3.1 Session de caisse
- [ ] Ouverture de session avec montant
- [ ] Ouverture de session sans montant
- [ ] Tentative d'ouverture avec session déjà ouverte
- [ ] Fermeture de session avec montant
- [ ] Calcul correct de l'écart

### 3.2 Scan de produits
- [ ] Scan par code-barres valide
- [ ] Scan par code-barres invalide
- [ ] Ajout manuel de produit
- [ ] Ajout de produit en rupture de stock (si autorisé)

### 3.3 Panier
- [ ] Ajout d'un article
- [ ] Modification de la quantité
- [ ] Modification du prix unitaire
- [ ] Suppression d'un article
- [ ] Calcul correct des totaux
- [ ] Application de remise
- [ ] Calcul de la TVA

### 3.4 Paiement
- [ ] Paiement en espèces
- [ ] Paiement par carte
- [ ] Paiement par Mobile Money
- [ ] Paiement avec montant partiel
- [ ] Paiement avec montant excédentaire
- [ ] Validation du montant reçu

### 3.5 Création de vente
- [ ] Vente avec panier vide (doit échouer)
- [ ] Vente avec panier valide
- [ ] Génération du numéro de vente
- [ ] Création des lignes de vente
- [ ] Création des paiements
- [ ] Mise à jour du stock

## 4. Tests du Module Stock

### 4.1 Gestion des produits
- [ ] Création d'un nouveau produit
- [ ] Modification d'un produit existant
- [ ] Désactivation d'un produit
- [ ] Upload d'image de produit
- [ ] Recherche de produit par code-barres

### 4.2 Mouvements de stock
- [ ] Création d'un mouvement d'entrée
- [ ] Création d'un mouvement de sortie
- [ ] Création d'un mouvement d'inventaire
- [ ] Vérification de la mise à jour du stock
- [ ] Vérification du coût moyen pondéré

### 4.3 Alertes de stock
- [ ] Détection de rupture de stock
- [ ] Détection de stock faible
- [ ] Affichage dans le dashboard

## 5. Tests du Module Comptabilité

### 5.1 Plan comptable
- [ ] Affichage de tous les comptes
- [ ] Filtrage par type de compte
- [ ] Affichage des comptes actifs uniquement

### 5.2 Écritures comptables
- [ ] Création d'une écriture manuelle
- [ ] Validation de l'équilibrage débit/crédit
- [ ] Validation d'une écriture en brouillon
- [ ] Annulation d'une écriture
- [ ] Génération du numéro d'écriture

### 5.3 Synchronisation ventes → comptabilité
- [ ] Synchronisation d'une vente
- [ ] Vérification de l'écriture générée
- [ ] Prévention des doublons
- [ ] Gestion des erreurs de synchronisation

### 5.4 Balance de vérification
- [ ] Affichage de la balance
- [ ] Vérification de l'équilibre débit/crédit
- [ ] Calcul correct des soldes

## 6. Tests du Module Rapports

### 6.1 Balance
- [ ] Affichage de la balance
- [ ] Export des données
- [ ] Filtrage par période

### 6.2 Grand livre
- [ ] Affichage du grand livre
- [ ] Filtrage par compte
- [ ] Filtrage par date

### 6.3 Journal d'audit
- [ ] Affichage du journal
- [ ] Filtrage par utilisateur
- [ ] Filtrage par action
- [ ] Filtrage par date

## 7. Tests du Module Utilisateurs

### 7.1 Gestion des utilisateurs
- [ ] Affichage de la liste des utilisateurs
- [ ] Modification du rôle d'un utilisateur
- [ ] Activation/désactivation d'un utilisateur
- [ ] Prévention de l'auto-désactivation

### 7.2 Rôles
- [ ] Affichage des rôles disponibles
- [ ] Affichage des descriptions des rôles

## 8. Tests du Module Paramètres

### 8.1 Modification des paramètres
- [ ] Modification du nom de l'entreprise
- [ ] Modification de la devise
- [ ] Modification du taux de TVA
- [ ] Modification des préfixes de numérotation
- [ ] Modification des options de caisse
- [ ] Modification de la méthode de valorisation

### 8.2 Persistance
- [ ] Vérification que les modifications sont sauvegardées
- [ ] Vérification que les modifications sont appliquées

## 9. Tests d'Intégration

### 9.1 Flux vente complète
1. Ouvrir session de caisse
2. Scanner des produits
3. Encaisser la vente
4. Vérifier la mise à jour du stock
5. Synchroniser avec la comptabilité
6. Vérifier l'écriture comptable
7. Fermer la session de caisse

### 9.2 Flux réception de stock
1. Créer un fournisseur
2. Créer un produit
3. Créer un mouvement d'entrée
4. Vérifier la mise à jour du stock
5. Vérifier le coût moyen

### 9.3 Flux régularisation comptable
1. Créer une écriture de régularisation
2. Valider l'écriture
3. Vérifier la balance
4. Vérifier le grand livre

## 10. Tests de Sécurité

### 10.1 Authentification
- [ ] Tentative de connexion avec mot de passe incorrect
- [ ] Tentative de connexion avec email inexistant
- [ ] Vérification du timeout de session

### 10.2 Autorisation
- [ ] Accès refusé aux pages non autorisées
- [ ] Accès refusé aux actions non autorisées
- [ ] Vérification des permissions par rôle

### 10.3 Audit
- [ ] Journalisation des actions critiques
- [ ] Enregistrement des erreurs
- [ ] Traçabilité des modifications

## 11. Tests de Performance

### 11.1 Temps de réponse
- [ ] Chargement du dashboard < 2 secondes
- [ ] Scan de produit < 1 seconde
- [ ] Création de vente < 3 secondes
- [ ] Chargement des rapports < 5 secondes

### 11.2 Charge
- [ ] 10 utilisateurs simultanés
- [ ] 100 produits dans le catalogue
- [ ] 1000 ventes dans l'historique

## 12. Tests d'Interface Utilisateur

### 12.1 Responsivité
- [ ] Affichage sur desktop (1920x1080)
- [ ] Affichage sur laptop (1366x768)
- [ ] Affichage sur tablette (768x1024)

### 12.2 Accessibilité
- [ ] Navigation au clavier
- [ ] Contraste des couleurs
- [ ] Taille des polices

### 12.3 Expérience utilisateur
- [ ] Messages d'erreur clairs
- [ ] Confirmation des actions critiques
- [ ] Indicateurs de chargement

## 13. Scénarios de Test

### Scénario 1: Vente simple
1. Caissier ouvre sa session
2. Scan 3 produits
3. Paiement en espèces
4. Vérification: vente créée, stock mis à jour

### Scénario 2: Vente avec synchronisation comptable
1. Caissier effectue une vente
2. Comptable synchronise la vente
3. Vérification: écriture comptable créée

### Scénario 3: Réception de marchandise
1. Gestionnaire stock crée un mouvement d'entrée
2. Vérification: stock mis à jour, coût moyen calculé

### Scénario 4: Inventaire
1. Gestionnaire stock fait un inventaire
2. Crée des mouvements d'inventaire
3. Vérification: stock ajusté

### Scénario 5: Régularisation comptable
1. Comptable crée une écriture de régularisation
2. Valide l'écriture
3. Vérification: balance équilibrée

### Scénario 6: Changement de rôle
1. Directeur change le rôle d'un utilisateur
2. Utilisateur se reconnecte
3. Vérification: accès mis à jour

## 14. Critères d'Acceptation

Le système est considéré prêt pour la production lorsque:
- [ ] Tous les tests de migration réussissent
- [ ] Tous les tests d'authentification réussissent
- [ ] Tous les tests d'autorisation réussissent
- [ ] Tous les tests du module caisse réussissent
- [ ] Tous les tests du module stock réussissent
- [ ] Tous les tests du module comptabilité réussissent
- [ ] Tous les tests du module rapports réussissent
- [ ] Tous les tests d'intégration réussissent
- [ ] Tous les tests de sécurité réussissent
- [ ] Les critères de performance sont respectés
- [ ] Les scénarios de test sont validés

## 15. Plan de Remédiation

Si un test échoue:
1. Documenter l'erreur
2. Identifier la cause racine
3. Corriger le problème
4. Re-tester
5. Vérifier que la correction n'introduit pas de nouveaux problèmes

## 16. Rapport de Test

Après exécution des tests, générer un rapport incluant:
- Date et heure des tests
- Environnement de test
- Résultats de chaque test
- Problèmes identifiés
- Recommandations

## Conclusion

Ce plan de tests doit être exécuté avant toute mise en production. Les résultats doivent être documentés et les problèmes résolus avant le déploiement.
