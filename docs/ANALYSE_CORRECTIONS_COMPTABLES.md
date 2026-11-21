# Analyse des corrections demandées - Makèt Peyizan

Réponse au document de spécifications (section 8, points 1 à 3) : pour chaque
demande, ce qui existe déjà, ce qui doit être corrigé et ce qui doit être
ajouté, avec la modification technique prévue.

Légende : ✅ existe et fonctionne · 🟠 existe mais à corriger · ❌ à ajouter

## Constat général

- La comptabilité repose sur les tables `accounts`, `journal_entries`,
  `journal_entry_lines`, `accounting_periods`, `adjustments` et `audit_log`.
- Tous les rapports lisent une seule vue, `trial_balance`, **calculée sur toute
  l'historique, sans filtre de date**. Aucun rapport ne peut donc être limité à
  une période. Cette vue sera remplacée par une fonction unique
  `account_balances(du, au)` utilisée par **tous** les rapports, ce qui répond
  à l'exigence « mêmes écritures validées partout ».
- La génération automatique des écritures de vente contient des erreurs
  (codes de comptes lus comme identifiants, clés de paramètres inexistantes).
  La synchronisation ventes → comptabilité ne fonctionne pas aujourd'hui.
- Le plan comptable (43 comptes, classes 1 à 5) n'indique ni la nature
  débitrice/créditrice, ni le caractère court terme/long terme. Le compte
  150000 « Amortissements cumulés » est un compte d'actif de nature créditrice :
  la nature doit donc être une propriété du compte et non déduite de son type.

## 1. Comptabilité : plan comptable, écritures, petite caisse, régularisation

| Demande | État | Modification prévue |
|---|---|---|
| Plan comptable consultable (actifs et inactifs) | 🟠 | Liste filtrable (actifs/inactifs/tous, par classe), recherche |
| Créer / modifier un compte, nature, compte parent | ❌ | Formulaire de compte ; colonnes `nature` (débitrice/créditrice) et `term` (court/long terme) ajoutées à `accounts` |
| Onglet Écritures | 🟠 | Aujourd'hui : affiche seulement les brouillons, aucune saisie possible. Ajout : liste de toutes les écritures avec filtres, saisie multi-lignes équilibrée, détail des lignes, validation, annulation tracée |
| Liste déroulante des comptes avec détail et actions | ❌ | Sélecteur de compte : solde, mouvements de la période, raccourcis (nouvelle écriture sur ce compte, désactiver…) |
| Colonne « Nature du compte » | ❌ | Ajoutée au tableau des écritures et au plan comptable |
| Petite caisse | ❌ | Fonds dédié (compte 104000), approvisionnement, pièces de dépense, réapprovisionnement, solde ; écritures générées automatiquement |
| Fenêtre de régularisation | 🟠 | La table `adjustments` existe sans écran. Ajout : saisie (date, période, référence, libellé, justification, lignes équilibrées), brouillon → validation par une personne autorisée, historique des modifications |

## 2. Rapports comptables et états financiers

| Demande | État | Modification prévue |
|---|---|---|
| Filtres « Du / Au », validation, période affichée et imprimée | ❌ | Barre de période commune à tous les rapports (Bilan : « À la date du ») |
| Retirer le Grand livre | 🟠 | Onglet supprimé (le détail par compte reste accessible depuis le sélecteur de compte) |
| Balance de vérification (actif CT/LT, équilibre) | 🟠 | Regroupement par classe et par terme, contrôle débit = crédit avec avertissement |
| Balance de régularisation | ❌ | Solde avant, mouvements de régularisation D/C, solde après, totaux et équilibre |
| État des résultats | 🟠 | Période choisie, écritures validées seulement ; ventes brutes, remises, retours, ventes nettes, CMV, marge brute, charges, résultat net |
| Bilan | 🟠 | À une date ; actif CT/LT, passif CT/LT, capitaux propres incluant le résultat ; contrôle Actif = Passif + Capitaux propres avec avertissement visible |
| État de l'avoir des associés | ❌ | Nécessite une liste des associés et leurs parts (voir points à confirmer) |
| Impression (entreprise, logo, titre, période, date d'impression, totaux, colonnes non coupées) | 🟠 | En-tête d'impression commun, mise en page paysage pour les tableaux larges |

## 3. Rapports de ventes et résultats

| Demande | État | Modification prévue |
|---|---|---|
| Ventes brutes, remises, retours/annulations, ventes nettes | 🟠 | Les données existent (sales, sale_items) ; rapport détaillé à ajouter, avec ouverture du détail |
| Commissions séparées | ❌ | L'application n'enregistre pas de commissions aujourd'hui : règle à confirmer |
| Dépenses de caisse ≠ charges comptables | 🟠 | Les dépenses seront liées à une écriture comptable et non additionnées deux fois |

## 4. Caisse : dépôts, sorties, rapport de caisse

| Demande | État | Modification prévue |
|---|---|---|
| Dépôts et sorties de caisse typés (date, type, montant, motif, utilisateur, référence) | 🟠 | Sessions de caisse et dépenses existent ; ajout d'un journal des mouvements de caisse (recette de vente, apport, transfert banque ↔ caisse, dépense, retrait) |
| Rapport de caisse (solde initial, entrées, sorties, solde théorique, compté, écart) | 🟠 | « Recettes journalières » existe mais : jour calculé en heure UTC, total « Encaissements » faux en mode local. Rapport refait par période et par caissier, imprimable ; l'écart n'est jamais corrigé automatiquement |

## 5. Stock, produits et fournisseurs

| Demande | État | Modification prévue |
|---|---|---|
| Fiche produit complète | ✅ | Code, nom, catégorie, fournisseur, unité, prix d'achat/vente, stock |
| Ajout d'un produit depuis l'écran de vente (selon les droits) | ❌ | Bouton dans la caisse, visible seulement pour les rôles autorisés |
| Pas de doublon dans les listes | 🟠 | Contrôle code-barres/nom à la création |
| Fournisseurs par catégorie, produits d'un fournisseur | 🟠 | Fournisseurs existent ; ajout catégorie et onglet « Produits » sur la fiche |
| Unités de mesure gérées | ❌ | Liste d'unités paramétrable au lieu d'un texte libre |
| Quantité et historique des mouvements | ✅ | Déjà en place (mouvements de stock atomiques) |
| Stock négatif | - | Actuellement refusé ; règle à confirmer avec le client |

## 6. Paiements

| Demande | État | Modification prévue |
|---|---|---|
| MonCash | 🟠 | Enregistré manuellement avec une référence ; pas de vérification. Intégration API seulement si le client la demande |
| Autre service de paiement | - | NatCash est déjà proposé en saisie manuelle ; à confirmer |

## Ordre de réalisation proposé

Chaque étape est livrée, testée avec des exemples chiffrés, puis validée avant la suivante.

1. **Fondations et Écritures** : colonnes nature/terme, fonction de soldes par période, plan comptable modifiable, onglet Écritures complet avec sélecteur de compte.
2. **Régularisation** : fenêtre de saisie/validation/historique et balance de régularisation.
3. **États financiers** : période, balance de vérification, état des résultats, bilan avec contrôle d'équilibre, impression commune ; retrait du Grand livre.
4. **Associés** : état de l'avoir des associés.
5. **Ventes et écritures automatiques** : rapport de ventes détaillé, correction de la génération des écritures (ventes, dépenses) sans doublon.
6. **Caisse** : petite caisse, mouvements de caisse typés, rapport de caisse.
7. **Stock et fournisseurs** : produit depuis la caisse, catégories de fournisseurs, unités.
8. **Version de test** : déploiement de test séparé et vérification écran = impression.

## Points à confirmer avant les étapes concernées

1. Associés : nombre, noms, parts (%) dans les bénéfices/pertes, solde d'ouverture de chacun (étape 4).
2. Méthode du coût des marchandises vendues : coût moyen pondéré (déjà prévu dans la base) ? (étape 5)
3. Commissions : existent-elles, et sont-elles une charge ou une réduction des ventes ? (étape 5)
4. Remises, retours et annulations : réduction des ventes, comme proposé ? (étape 5)
5. Écarts de caisse : compte « Écarts de caisse » et validation par qui ? (étape 6)
6. Stock négatif autorisé ou non (étape 7).
7. MonCash : simple référence ou vérification automatique ? Le second service est-il NatCash ? (étape 8)
