# Recette finale - Cahier des charges fonctionnel

Makèt Peyizan · gestion commerciale · recette du 10/11/2026

Ce document répond au chapitre 6 du cahier des charges (« Livrables attendus du développeur ») :
résultats des tests, anomalies corrigées, fonctionnalités ajoutées, corrections de la base de
données, déroulé de la démonstration et instructions de mise en production. L'analyse détaillée,
module par module, se trouve dans `ANALYSE_CAHIER_DES_CHARGES.md`.

## 1. Critères de validation (chapitre 5)

| # | Critère | Résultat | Preuve |
|---|---|---|---|
| 1 | La synchronisation fonctionne automatiquement au retour de la connexion | ✅ | Tests « plusieurs opérations hors ligne », « recettes hors ligne », « caisse ouverte hors ligne » |
| 2 | Les opérations hors ligne sont conservées et synchronisées sans doublons | ✅ | Test « connexion perdue pendant l'envoi d'une vente » : envoyée deux fois, enregistrée une fois |
| 3 | Pas de vente avec un stock insuffisant | ✅ | Contrôle à la caisse, puis par le serveur ; test « deux caissières, dernière unité » |
| 4 | Chaque vente validée met à jour le stock | ✅ | Tous les tests de vente vérifient le stock du serveur ; scénario « semaine en magasin » |
| 5 | Catégories, fournisseurs et unités créés depuis le formulaire produit | ✅ | Test « + Ajouter » catégorie, fournisseur, unité |
| 6 | Nouveau client depuis l'écran de vente | ✅ | Tests vente avec nouveau client, en ligne et hors ligne |
| 7 | Recettes journalières consultables hors ligne | ✅ | Test « recettes hors ligne avec la vente en attente » |
| 8 | Documents présentés pour l'impression 80 mm | ✅ à confirmer sur l'imprimante | Largeur mesurée ≤ 72 mm, aperçus PDF dans `docs/recette/` ; essai sur l'imprimante réelle (§ 6) |
| 9 | Proformas ouvertes, modifiées, imprimées | ✅ | Test proforma : création, modification avec historique, ticket 80 mm, encaissement |
| 10 | Sorties de caisse enregistrées et prises en compte dans le solde | ✅ | Tests sortie autorisée / refusée ; rapport de caisse (solde = initial + entrées − sorties) |
| 11 | Comptes utilisateurs et permissions | ✅ | Tests création de compte, connexion par nom d'utilisateur, matrice des permissions, accès de chaque rôle |
| 12 | Paramètres compatibles avec les rôles et les comptes | ✅ | Paramètres réservés à la permission « Modifier les paramètres », vérifiée par la base |
| 13 | Tests fonctionnels effectués, anomalies corrigées | ✅ | § 2 ; anomalies trouvées pendant la recette corrigées (§ 3, dernières lignes) |

## 2. Tests obligatoires (§ 3.4)

Deux séries de tests automatiques, relancées après chaque correction :

- **Base de données** (`npm run test:db`) : règles, droits, écritures comptables, et des scénarios
  complets (une semaine en magasin, mise à jour sur des données existantes).
- **Application dans Chrome** (`npm run test:ui`) : l'application réelle, utilisée comme par une
  caissière, avec coupures de connexion simulées.

| Situation demandée | Comment elle est testée | Résultat |
|---|---|---|
| Avec connexion Internet | Toutes les pages et tous les onglets, pour chaque rôle ; ventes, sorties, proformas, comptes | ✅ |
| Sans connexion Internet | Ouverture de caisse, ventes, nouveau client et recettes journalières hors ligne | ✅ |
| Perte de connexion pendant une vente | Le serveur enregistre la vente mais la réponse est perdue : l'appareil la renvoie, le serveur la reconnaît, **une seule vente** et un seul mouvement de stock | ✅ |
| Retour de la connexion | Envoi automatique, puis actualisation des données affichées | ✅ |
| Synchronisation de plusieurs opérations en attente | Hors ligne : un nouveau client et deux ventes (dont une pour ce client) ; tout arrive au serveur, dans l'ordre, client compris | ✅ |
| Deux utilisateurs simultanément | Deux caissières valident la dernière bonbonne de gaz à la même seconde : une vente, l'autre voit « Stock insuffisant » avant de remettre un reçu, stock jamais négatif | ✅ |
| Vente d'un produit en rupture | Refusée à la caisse avec « Stock insuffisant : seulement 2 sac disponible(s) » | ✅ |
| Sortie de caisse | Au-delà du seuil : en attente, autorisée par la directrice avec un motif, puis comptabilisée ; une autre refusée, rien n'est comptabilisé | ✅ |
| Modification d'une proforma | Ajout de quantité avec motif : version 2, total recalculé, historique, stock inchangé jusqu'à la vente | ✅ |
| Impression thermique 80 mm | Reçu de vente et ticket de proforma : aucune ligne plus large que 72 mm, aucun autre document sur le ticket, numéro de vente du serveur | ✅ en test · **à faire sur l'imprimante réelle** |
| Permissions de chaque rôle | Pour les 5 rôles, chaque page réservée s'ouvre ou est refusée exactement selon les permissions ; une permission retirée est refusée par l'écran **et** par la base | ✅ |

## 3. Anomalies corrigées

| Anomalie constatée | Cause réelle | Correction |
|---|---|---|
| « Mode hors ligne » alors qu'Internet fonctionne | Une seule requête lente faisait basculer toute l'application hors ligne | La connexion est vérifiée avant de basculer, puis revérifiée régulièrement |
| La caisse ne voyait plus la session ouverte | Requête refusée par le serveur (lien ambigu entre tables) | Liens nommés dans toute l'application ; test qui empêche le retour du défaut |
| « A cash session is already open » | Conséquence des deux points ci-dessus | L'ouverture faite hors ligne est rattachée à la session du serveur |
| « Erreur réseau » à chaque refus | Le vrai motif du serveur était remplacé | Motif réel en français (stock, session, ID MonCash…) avec « Réessayer » / « Abandonner » |
| Les ventes ne déduisaient pas le stock | Ventes acceptées sur l'appareil sans stock, puis refusées par le serveur et bloquées | Contrôle du stock à la caisse ; en ligne, le serveur confirme avant le reçu |
| Vente hors ligne datée de sa synchronisation | L'heure d'envoi remplaçait l'heure de vente | La vente garde son heure réelle partout (stock, comptabilité, caisse) |
| Recettes journalières indisponibles hors ligne | Aucune version hors ligne | Copie locale + ventes en attente, origine des chiffres affichée |
| Aucune sortie dans la caisse | Sorties présentes mais hors de l'écran de vente, sans autorisation | Bouton « Sortie de caisse », autorisation au-delà d'un seuil |
| Création d'utilisateur impossible | Fonction inexistante sur le serveur | Fonction serveur sécurisée `users` |
| Proformas non modifiables, créées en deux temps | — | Enregistrement en une transaction, modification avec historique |
| Dépense supprimée sans trace | — | Annulation avec motif, la dépense reste visible |
| Paramètres sans effet (stock négatif, client obligatoire, préfixes, TVA, devise) | Aucun module ne les lisait | Appliqués, ou remplacés par la règle réellement appliquée |
| *Trouvé pendant la recette :* reçu avec un numéro provisoire « LOCAL-… » même en ligne | Le reçu était imprimé avant la réponse du serveur | En ligne, le reçu porte le numéro de vente du serveur |
| *Trouvé pendant la recette :* « Merci pour votre visite » imprimé deux fois | Message par défaut ajouté au message des Paramètres | Le message des Paramètres remplace le message par défaut |
| *Trouvé pendant la recette :* le ticket 80 mm d'une proforma imprimait aussi la version A4 | Règle d'impression qui affichait tous les documents imprimables | Seul le document demandé s'imprime |
| *Trouvé pendant la recette :* écran rétréci à 72 mm après un ticket sur certains navigateurs | Largeur du ticket appliquée aussi à l'écran | Largeur limitée à l'impression |
| *Trouvé pendant la recette :* proforma pas marquée « transformée » si le lien échouait, sans message | Erreur ignorée | Signalée dans le compte rendu de synchronisation |

## 4. Fonctionnalités ajoutées

- **Synchronisation** : détail de chaque opération en attente ou refusée avec son motif, « Réessayer », « Abandonner », compte rendu après chaque envoi.
- **Caisse** : recherche pendant la saisie avec stock disponible, boutons + / −, remises par ligne (selon les droits), sous-total / remises / taxes / total, récapitulatif avant validation, « + Nouveau client », « Sortie de caisse ».
- **Sorties de caisse** : motif, catégorie, mode de décaissement (caisse, petite caisse, banque, MonCash), pièce justificative, auteur ; autorisation par un responsable au-delà d'un seuil ; bon de sortie imprimable.
- **Produits** : « + Ajouter une catégorie », « + Ajouter un fournisseur », « + Ajouter une unité ».
- **Recettes journalières** hors ligne, avec les ventes en attente.
- **Impression 80 mm** commune : reçu, clôture de caisse, bon de sortie, comptage, proforma ; choix 80 mm / A4.
- **Proformas** : fiche détaillée, modification avec historique, statuts, impression A4 et 80 mm, encaissement à la caisse.
- **Utilisateurs** : nom d'utilisateur, connexion par nom ou e-mail, mot de passe défini par un responsable, activation, rôle, historique des activités.
- **Rôles et permissions** : 21 permissions modifiables par rôle sans changer le code, appliquées par la base, tracées.
- **Paramètres** : Entreprise (nom, logo, adresse, téléphone, e-mail, NIF, message de reçu), Impression, Caisse, Stock.

## 5. Corrections de la base de données

Quatre mises à jour, testées sur une copie de la base existante (les écritures, le stock et les
coûts moyens existants ne changent pas) :

| Mise à jour | Contenu |
|---|---|
| `20261110000000_sync_and_cash_controls` | Ouverture de caisse sans doublon, heure réelle des ventes hors ligne, sorties à autoriser, annulation des dépenses |
| `20261111000000_usernames` | Noms d'utilisateur |
| `20261112000000_proformas` | Proformas en une transaction, historique, transformation en vente |
| `20261113000000_permissions` | Table des permissions par rôle, utilisée par toutes les règles |

Et une fonction serveur : `users` (création des comptes, mots de passe, connexion par nom d'utilisateur).

## 6. À vérifier sur place : imprimante thermique 80 mm

Les tickets ont été mesurés automatiquement (largeur imprimable 72 mm) et des aperçus sont dans
`docs/recette/ticket-vente-80mm.pdf` et `docs/recette/ticket-proforma-80mm.pdf`. L'essai sur
l'imprimante du magasin reste nécessaire :

1. Paramètres › Impression : choisir **Imprimante thermique 80 mm** ; Paramètres › Entreprise : renseigner les coordonnées et importer le logo.
2. Faire une vente de test ; dans la fenêtre d'impression : imprimante thermique, papier **80 mm** (ou « 80 × 297 »), marges **aucune** ou par défaut, échelle **100 %**, **en-têtes et pieds de page désactivés**.
3. Vérifier : rien n'est coupé à droite, le logo est net, les montants sont alignés, le papier est coupé après le ticket.
4. Refaire l'essai avec une clôture de caisse, un bon de sortie et une proforma (bouton « Ticket 80 mm »).

Si l'imprimante n'imprime que 58 mm ou coupe les bords, noter le modèle : la largeur se règle en une ligne.

## 7. Démonstration (sur la version de test)

Durée : environ 30 minutes, avec un compte par rôle.

1. **Caissière** : ouvrir la caisse, vendre un produit (stock affiché), essayer d'en vendre plus que le stock → « Stock insuffisant ».
2. Créer un client depuis la vente, encaisser en espèces → récapitulatif, monnaie, reçu 80 mm.
3. Couper le Wi-Fi : vendre deux articles, créer un client → « en attente » ; ouvrir Recettes journalières → copie locale + ventes en attente.
4. Rétablir le Wi-Fi → envoi automatique, compte rendu, stock du serveur mis à jour.
5. Sortie de caisse de 6 000 HTG → en attente ; **Directrice** : autoriser avec un motif.
6. Proforma : créer, modifier (motif), imprimer A4 et 80 mm, encaisser → « Transformée en vente ».
7. **Gestionnaire de stock** : nouveau produit avec « + Ajouter » catégorie, fournisseur, unité.
8. **Directrice** : créer un compte caissière avec un nom d'utilisateur ; se connecter avec.
9. **Administrateur** : Rôles et permissions, retirer une permission au Comptable → le menu et la base la refusent ; la remettre.
10. Paramètres : coordonnées et logo → visibles sur le ticket suivant.

## 8. Mise en production

Ordre à respecter (le site a besoin de la base à jour) :

1. **Version de test d'abord** : `npm run test-version:db`, puis `npm run test-version:deploy` ; démonstration et essai d'impression.
2. **Base de production** : `npx supabase db push --remote` (les 4 mises à jour du § 5).
3. **Fonction serveur** : `npx supabase functions deploy users` (ajouter `--use-api` si Docker est demandé).
4. **Site** : `npm run build -- --mode production && npx wrangler pages deploy dist --project-name maket-peyizan --branch main`.
5. **Après le déploiement** : se connecter en Directeur, vérifier la caisse (session visible, pas de « Mode hors ligne »), faire une vente puis l'annuler, renseigner Paramètres › Entreprise.
6. Sur chaque poste de caisse : recharger la page (ou rouvrir l'application installée) pour prendre la nouvelle version, après avoir laissé partir les ventes en attente.

Entre les étapes 2 et 4, l'ancien site continue de vendre et de gérer le stock (vérifié par test),
mais la création de proformas et la suppression de dépenses ne marchent qu'avec le nouveau site :
publier le site juste après la base, en dehors des heures d'ouverture si possible. En cas de
problème sur le site, un déploiement précédent peut être republié depuis Cloudflare Pages, avec
les mêmes limites.

## 9. Points à confirmer par la direction

| Point | Réglage actuel |
|---|---|
| Stock négatif | Interdit |
| Seuil d'autorisation des sorties | 5 000 HTG (Paramètres) |
| Âge maximum d'une vente hors ligne | 7 jours (Paramètres) |
| Remises à la caisse | Directeur et administrateur, sans plafond ; contrôlées par l'écran |
| Prix des proformas | Directeur et administrateur |
| Administrateur à la caisse | Autorisé (modifiable dans Rôles et permissions) |
| Logo officiel et modèle de l'imprimante | À fournir |
