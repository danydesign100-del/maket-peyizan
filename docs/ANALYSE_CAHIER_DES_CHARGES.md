# Analyse du cahier des charges fonctionnel et plan de correction

Analyse du document « Cahier des charges fonctionnel - Corrections, améliorations et nouvelles
fonctionnalités », point par point, à partir du code et de la base de production (vérifiée le
10/11/2026 avec un compte Directeur, en lecture seule).

**Légende :** ✅ fait et fonctionnel · 🟠 partiel · ❌ absent · 🐞 présent mais défectueux

## Synthèse

Les causes réelles des messages cités dans le document sont identifiées :

| Message ou constat | Cause réelle |
|---|---|
| « Mode hors ligne » alors qu'Internet fonctionne | Une seule requête lente ou coupée faisait basculer toute l'application hors ligne, puis l'application ne revérifiait qu'au bout de 30 à 60 s. **Corrigé (en attente de déploiement)** : la connexion est vérifiée avant de basculer, et revérifiée au retour sur l'onglet. |
| Caisse : « Ouvrez votre session » alors qu'une session est ouverte | Depuis l'étape 6, la requête qui lit la session ouverte était refusée par Supabase (jointure ambiguë, code 300) : la caisse ne voyait plus la session. **Corrigé (en attente de déploiement)**, et un test empêche que cela se reproduise. |
| « Ouverture de caisse : A cash session is already open » | Conséquence des deux points ci-dessus : l'application, croyant être hors ligne et sans session, a mis en file une ouverture de caisse ; le serveur la refuse à chaque synchronisation car une session existe déjà. Rien ne réconcilie la session locale avec celle du serveur. |
| « Vente du … : Erreur réseau » | **Ce n'est pas une erreur réseau.** Quand le serveur refuse une vente (stock insuffisant, pas de session ouverte, ID MonCash déjà utilisé…), le message réel est perdu et remplacé par « Erreur réseau ». |
| « Les ventes ne semblent pas affecter le stock » | La caisse ne vérifie pas le stock avant d'enregistrer : une vente d'un produit à 0 est acceptée sur l'appareil (reçu imprimé), puis refusée par le serveur. Elle reste en attente sur l'appareil et ne déduit donc jamais le stock du serveur. Une vente acceptée par le serveur, elle, déduit bien le stock. |
| « Données non disponibles hors ligne » (Recettes journalières) | La page n'a aucune version hors ligne : elle n'affiche que la dernière réponse du serveur pour la même date, et ignore les ventes en attente sur l'appareil. |
| « La caisse ne comporte aucune sortie » | Les sorties existent depuis l'étape 6 (menu **Mouvements de caisse** : dépenses, versements, retraits, paiement fournisseur, petite caisse, rapport de caisse). Elles ne sont pas accessibles depuis l'écran de vente, et l'autorisation par un responsable n'existe pas. |

Autres défauts trouvés pendant l'analyse :

- 🐞 **Création d'utilisateur impossible en ligne** : la page appelle une fonction `create_user_with_invitation` qui n'existe pas dans la base de production. En mode local, la création échoue aussi.
- 🐞 **Une vente faite hors ligne prend l'heure de sa synchronisation**, pas l'heure réelle de la vente : elle peut tomber sur le mauvais jour ou la mauvaise session dans les rapports.
- 🐞 **Paramètres sans effet** : « Autoriser le stock négatif », « Client obligatoire », préfixes de reçu/facture, devise et taux de TVA s'enregistrent mais aucun module ne les lit.
- 🐞 **Suppression d'une dépense** : la ligne disparaît (l'écriture est annulée et tracée, mais la dépense n'est plus visible).
- 🐞 **Création d'une proforma en deux écritures séparées** : un échec entre les deux laisse une proforma sans lignes.

## Analyse détaillée

### Module 01 - Synchronisation et mode hors ligne (P0)

| Exigence | État | Constat |
|---|---|---|
| 1.1-1 Détecter le retour de la connexion | 🟠 | Événement `online` du navigateur + vérification toutes les 30 s ; ralenti en arrière-plan. **Corrigé en local** : vérification immédiate au retour sur l'onglet, toutes les 15 s hors ligne. |
| 1.1-2 Envoyer toutes les opérations en attente | ✅ | Ventes, puis autres opérations dans l'ordre ; une fermeture de caisse envoie d'abord les ventes faites avant elle. |
| 1.1-3 Vérifier que chaque opération est enregistrée | 🟠 | Chaque vente a un identifiant unique (pas de doublon) et attend la réponse du serveur ; mais les refus du serveur sont mal affichés (« Erreur réseau »). |
| 1.1-4 Actualiser les données locales | ✅ | Produits, clients, fournisseurs et vues par défaut rechargés après synchronisation. |
| 1.1-5 Afficher le statut réel | 🐞 | Faux « Mode hors ligne » (corrigé en local) ; « copie locale du … » reste affiché tant qu'une page sert une copie. |
| 1.1-6 Informer des opérations synchronisées et des erreurs | 🟠 | La liste des opérations en attente existe (menu de synchronisation) ; aucun message « 3 ventes envoyées, 1 refusée » ; erreurs illisibles. |
| 1.2 Une seule session de caisse par utilisateur | 🟠 | Garanti par la base (index unique) : aucun doublon possible. Mais une ouverture faite hors ligne n'est jamais réconciliée avec la session du serveur : elle reste en erreur, et la caisse locale peut croire à une autre session. |
| 1.2 Session restée ouverte après déconnexion | 🟠 | La session reste ouverte sur le serveur (normal) ; la caisse ne la voyait plus à cause du défaut de jointure (corrigé en local). |
| 1.3 Ne perdre aucune vente | ✅ | Ventes gardées sur l'appareil jusqu'à confirmation du serveur. |
| 1.3 Ne pas envoyer deux fois | ✅ | Identifiant client unique côté serveur : une relance ne crée jamais une deuxième vente. |
| 1.3 Statuts en attente / synchronisé / erreur | 🟠 | Les statuts existent ; l'erreur réelle n'est pas affichée. |
| 1.3 Nouvelle tentative | 🟠 | Relance automatique avec délai croissant ; pas de bouton « Réessayer » par opération. |
| 1.3 Dates et heures réelles | 🐞 | Une vente hors ligne est datée de sa synchronisation. |
| 1.3 Conflits local / serveur | 🟠 | Le serveur fait foi (prix, stock, droits) ; mais un refus (stock épuisé entre-temps) n'est pas expliqué à la caisse. |
| Point technique : données locales vs base centrale | ✅ | En ligne, les pages lisent la base centrale ; la copie locale ne sert qu'hors ligne. Une vente synchronisée met réellement à jour la base centrale (vérifié par les tests : vente, stock, écriture, caisse). |

### Module 02 - Produits et stock (P0)

| Exigence | État | Constat |
|---|---|---|
| 2.1 Bloquer la vente si stock = 0 ou insuffisant | 🐞 | Bloqué **par le serveur** (et stock négatif impossible en base), mais **pas à la caisse** : la vente est acceptée sur l'appareil puis refusée à la synchronisation. |
| 2.1 Message « Stock insuffisant » | ❌ | Message serveur en anglais (« Insufficient stock for … »), affiché « Erreur réseau ». |
| 2.1 Stock négatif seulement sur autorisation de la direction | 🐞 | Le paramètre existe mais n'a aucun effet (la base l'interdit toujours). |
| 2.2 Déduction automatique après une vente | ✅ | Dans une seule transaction : vente, lignes, mouvement de stock, coût moyen, écriture comptable. Exemple 10 − 3 = 7 vérifié par les tests. |
| 2.2 Mouvement dans l'historique du produit | ✅ | Chaque vente crée un mouvement « Sale VTE-… ». |
| 2.2 Annulation / retour | ✅ | Le retour remet en stock et passe l'écriture inverse ; un paiement non finalisé ne crée rien. |
| 2.3 « + Ajouter » à côté de Catégorie | ❌ | |
| 2.3 « + Ajouter » à côté de Fournisseur | ❌ | |
| 2.3 « + Ajouter » à côté de Unité | 🟠 | Lien « Gérer les unités » ; la nouvelle unité n'est pas sélectionnée automatiquement. |

### Module 03 - Ventes (P0)

| Exigence | État | Constat |
|---|---|---|
| 3.1 Recherche de produits | 🟠 | Code-barres + recherche par bouton ; pas de recherche pendant la saisie. |
| 3.1 Quantités disponibles | 🟠 | Affichées dans les résultats de recherche, pas dans le panier. |
| 3.1 Ajouter / retirer / modifier les quantités | 🟠 | Quantité modifiable et suppression de ligne ; pas de boutons + / −, aucun contrôle par rapport au stock. |
| 3.1 Sous-total, réductions, taxes, total | 🟠 | Sous-total et total ; remises et taxes non affichées ni saisissables par ligne. |
| 3.1 Mode de paiement | ✅ | Espèces, carte, MonCash, NatCash, virement, chèque (ID obligatoire pour MonCash/NatCash). |
| 3.1 Validation claire avant enregistrement | 🟠 | Fenêtre d'encaissement ; pas de récapitulatif (articles, total, monnaie) avant validation. |
| 3.2 « + Nouveau client » depuis la vente | ❌ | Recherche seulement. |
| 3.3 Vente → historique, comptabilité, caisse, stock, rapports | ✅ | Vérifié par le scénario « semaine en magasin » (rapports cohérents entre eux). |
| 3.3 … et synchronisation | 🐞 | Les ventes refusées à la synchronisation restent invisibles pour tous les autres modules. |

### Module 04 - Recettes journalières (P1)

| Exigence | État | Constat |
|---|---|---|
| 4.1 Recettes déjà synchronisées hors ligne | 🟠 | Seulement si la même date a été consultée en ligne sur cet appareil. |
| 4.1 Recettes enregistrées localement | ❌ | Les ventes en attente ne sont pas comptées. |
| 4.1 Identifier les données en attente / copie locale | ❌ | |
| 4.1 Actualiser au retour de la connexion | 🟠 | À la prochaine ouverture de la page. |
| Total = ventes validées et paiements, sans doublon | ✅ | En ligne, calcul identique au rapport de caisse (étape 6). |

### Module 05 - Impression thermique 80 mm (P1)

| Exigence | État | Constat |
|---|---|---|
| Format 80 mm (tickets, reçus, documents de caisse, proformas) | ❌ | Le reçu est centré sur une page Lettre ; aucun format 80 mm. |
| Logo, nom et coordonnées de l'entreprise | 🟠 | Les rapports A4 lisent nom/logo/adresse des paramètres, mais ces champs ne sont pas modifiables dans Paramètres ; le reçu affiche un nom fixe. |
| Date, numéro, articles, quantités, prix, total, mode de paiement | ✅ | Sur le reçu de vente (et ID MonCash depuis l'étape 8). |
| Mise en page uniforme | ❌ | Un seul document thermique existe (le reçu). |

### Module 06 - Proformas (P1)

| Exigence | État | Constat |
|---|---|---|
| 6.1 Retrouver et ouvrir une proforma en détail | 🟠 | Liste avec statut ; pas de vue détaillée. |
| 6.2 Modifier (produits, quantités, prix, client) avec recalcul et trace | ❌ | |
| 6.3 Imprimer (A4 et 80 mm), validité affichée | ❌ | |
| Pas de déduction de stock avant transformation en vente | ✅ | Aucune proforma ne touche le stock. La transformation en vente n'existe pas encore. |

### Module 07 - Caisse (P0)

| Exigence | État | Constat |
|---|---|---|
| 7.1 Sortie de caisse : date/heure, montant, motif, référence, utilisateur | ✅ | Menu Mouvements de caisse (étape 6). |
| 7.1 Catégorie de dépense | ✅ | Compte de charge choisi (ex. 508000 Fournitures). |
| 7.1 Mode de décaissement | 🟠 | Caisse principale ou petite caisse ; pas de choix banque/MonCash depuis cet écran. |
| 7.1 Responsable ayant autorisé | ❌ | |
| 7.2 Historique entrées / sorties | ✅ | Ventes en espèces, apports, retraits, dépenses, versements, remboursements dans le rapport de caisse. |
| 7.3 Solde = initial + entrées − sorties ; totaux ; rapport de clôture | ✅ | Rapport de caisse par session, écart validé par la direction. |
| 7.3 Historique conservé, pas de suppression silencieuse | 🟠 | Mouvements annulés avec motif et conservés ; **les dépenses, elles, se suppriment**. |
| Sorties soumises aux autorisations de la direction | ❌ | Tout caissier peut enregistrer une sortie sans validation. |
| Accès depuis l'écran de vente | ❌ | Seulement par le menu. |

### Module 08 - Utilisateurs et rôles (P1)

| Exigence | État | Constat |
|---|---|---|
| 8.1 Créer un utilisateur | 🐞 | Fonction absente de la base : échec en ligne et en local. |
| 8.1 Modifier, activer / désactiver, changer de rôle | ✅ | |
| 8.1 Nom d'utilisateur | ❌ | Connexion par e-mail uniquement. |
| 8.1 Définir ou réinitialiser un mot de passe (par l'administrateur) | ❌ | Seul l'utilisateur peut demander un e-mail de réinitialisation. |
| 8.1 Historique des activités | 🟠 | Journal d'audit (Rapports) ; pas de filtre par utilisateur depuis sa fiche. |
| 8.2 Rôles Directeur, Comptable, Caissière, Gestionnaire de stock | ✅ | Plus Administrateur. |
| 8.2 Permissions modifiables sans changer le code | ❌ | Les droits sont écrits dans le code et dans les règles de la base. |

### Module 09 - Paramètres (P1)

| Exigence | État | Constat |
|---|---|---|
| 9.1 Nom commercial, devise | 🟠 | Modifiables ; la devise n'est utilisée nulle part. |
| 9.1 Logo, adresse et coordonnées | ❌ | Non modifiables (utilisés par l'en-tête d'impression s'ils existaient). |
| 9.1 Facturation, impression, caisse, stock | 🐞 | Quelques paramètres affichés mais sans effet ; fonds de petite caisse modifiable ailleurs. |
| 9.1 Utilisateurs, rôles, synchronisation, comptes | ❌ | Rôles dans la page Utilisateurs ; rien pour la synchronisation ni les comptes par défaut. |
| 9.2 Respect des droits du compte connecté | ✅ | Modification réservée au Directeur et à l'Administrateur (règle de la base). |
| 9.2 Modifications appliquées dans les modules | 🐞 | Voir paramètres sans effet. |

### Exigences transversales

| Exigence | État | Constat |
|---|---|---|
| 3.1 Cohérence ventes, stock, caisse, comptabilité, recettes, rapports | ✅ en ligne / 🐞 hors ligne | Vérifié par le scénario « semaine en magasin » (balance, bilan, stock = compte 120000, fournisseurs, caisse, ventes = état des résultats). Hors ligne : ventes refusées non visibles, dates de synchronisation. |
| 3.2 Autorisations contrôlées avant chaque opération | ✅ | Par la base (règles de sécurité et fonctions). |
| 3.2 Utilisateur enregistré pour chaque action, historique | ✅ | Auteur sur chaque vente, mouvement, écriture ; journal d'audit ; historique des écritures. |
| 3.2 Empêcher les suppressions non autorisées | 🟠 | Écritures et mouvements : annulation tracée uniquement ; dépenses : suppression. |
| 3.3 Transaction unique pour une vente | ✅ | Vente, stock et paiement dans une seule transaction ; la vente est refusée entièrement en cas de problème. |
| 3.4 Tests | 🟠 | Tests automatiques existants : base de données, scénarios, écrans, impression, hors ligne. Manquent : perte de connexion pendant une vente, deux caissiers simultanés sur le même produit, imprimante 80 mm réelle, matrice des permissions. |

## Plan de correction

Même méthode que précédemment : une étape à la fois, livrée, testée avec des exemples chiffrés,
puis validée avant la suivante. Tailles : S (≤ 1 jour), M (2-3 jours), L (4-5 jours).

### Étape A - Fiabilité de la synchronisation et des ventes (P0)

| # | Correction | Taille |
|---|---|---|
| A0 | **Déployer** les deux corrections déjà prêtes (jointure de la caisse, détection hors ligne). | - |
| A1 | Afficher le vrai motif d'un refus du serveur, traduit en français (« Stock insuffisant pour Riz Bongu », « Aucune session de caisse ouverte »…) ; distinguer erreur réseau et refus. | S |
| A2 | Panneau de synchronisation : opérations en attente / envoyées / refusées, motif, boutons « Réessayer » et « Annuler la vente » ; message après chaque synchronisation (« 3 ventes envoyées, 1 refusée »). | M |
| A3 | Sessions de caisse : l'ouverture devient idempotente (si une session est déjà ouverte, le serveur la renvoie au lieu de refuser) ; la session locale est remplacée par celle du serveur à chaque synchronisation ; nettoyage des ouvertures en erreur déjà en file. | M |
| A4 | Heure réelle des ventes hors ligne : l'heure de la vente est envoyée et contrôlée (pas dans le futur, au plus N jours) ; la vente est rattachée à la session ouverte à ce moment. | M |
| A5 | Stock à la caisse : refus immédiat si la quantité dépasse le stock disponible (stock connu − panier − ventes en attente), message « Stock insuffisant » ; stock affiché dans le panier. | S |
| A6 | Règle du stock négatif : soit appliquée réellement (autorisation de la direction, par produit ou globale), soit le paramètre retiré. **À décider par la direction.** | S |

**Tests de l'étape A** : perte de connexion pendant une vente, retour de la connexion, plusieurs opérations en attente, deux caissiers vendant le dernier article en même temps, vente d'un produit en rupture, vente hors ligne la veille synchronisée le lendemain.

### Étape B - Caisse : sorties autorisées (P0)

| # | Correction | Taille |
|---|---|---|
| B1 | Bouton « Sortie de caisse » sur l'écran de vente (même formulaire que Mouvements de caisse). | S |
| B2 | Autorisation des sorties : au-delà d'un seuil fixé par la direction (paramètre), la sortie attend la validation d'un directeur ; champ « Autorisé par » enregistré. | M |
| B3 | Mode de décaissement : caisse, petite caisse, banque, MonCash. | S |
| B4 | Dépenses : plus de suppression ; annulation avec motif, la dépense reste visible (barrée). | S |

### Étape C - Saisie rapide (P1)

| # | Correction | Taille |
|---|---|---|
| C1 | Fiche produit : « + Ajouter » à côté de Catégorie, Fournisseur et Unité ; petite fenêtre, élément créé puis sélectionné automatiquement. | S |
| C2 | Caisse : « + Nouveau client », créé (y compris hors ligne) et sélectionné pour la vente en cours. | S |
| C3 | Écran de vente : recherche pendant la saisie, boutons + / −, remise et taxe par ligne, récapitulatif avant validation (articles, remises, taxes, total, paiement, monnaie). | M |

### Étape D - Recettes journalières hors ligne (P1)

| # | Correction | Taille |
|---|---|---|
| D1 | Calcul hors ligne à partir de la copie locale et des ventes en attente sur l'appareil ; mention claire « données du serveur », « copie locale du … », « en attente de synchronisation » ; actualisation automatique au retour de la connexion. | M |

### Étape E - Impression 80 mm et proformas (P1)

| # | Correction | Taille |
|---|---|---|
| E1 | Modèle thermique 80 mm commun (logo, nom, coordonnées, date et heure, numéro, articles, quantités, prix, total, paiement) : ticket de vente, reçu de paiement, clôture de caisse, comptage, bon de sortie, proforma. Choix A4 / 80 mm dans Paramètres. | M |
| E2 | Proformas : vue détaillée, modification (produits, quantités, prix selon droits, client) avec recalcul et historique des modifications, impression A4 et 80 mm avec durée de validité, création en une seule transaction. | L |
| E3 | Transformation d'une proforma en vente (c'est seulement là que le stock est déduit). | M |

Le logo officiel sera intégré dès qu'il sera fourni (E1 utilise le logo des Paramètres).

### Étape F - Utilisateurs, rôles et paramètres (P1)

| # | Correction | Taille |
|---|---|---|
| F1 | Création des comptes par une fonction serveur sécurisée (Supabase Edge Function, la clé secrète ne quitte jamais le serveur) : créer, définir ou réinitialiser un mot de passe, nom d'utilisateur ; connexion par nom d'utilisateur ou e-mail. | M |
| F2 | Historique des activités depuis la fiche d'un utilisateur (journal d'audit filtré). | S |
| F3 | Permissions modifiables sans code : table des permissions par rôle, utilisée par la base et par l'interface ; écran « Rôles et permissions » (matrice). | L |
| F4 | Paramètres réorganisés par section : Entreprise (nom, logo, adresse, téléphone, NIF), Facturation, Impression (A4 / 80 mm), Caisse (fonds de petite caisse, seuil d'autorisation des sorties), Stock (stock négatif), Synchronisation, Comptes par défaut ; chaque paramètre affiché est réellement appliqué, les autres sont retirés ; champs visibles selon le rôle. | M |

### Étape G - Recette finale

Tests automatiques et manuels de la liste 3.4 sur la **version de test** (données fictives),
puis démonstration, liste des anomalies corrigées et des fonctionnalités ajoutées, et instructions
de mise en production. L'impression 80 mm doit être vérifiée sur l'imprimante réelle du client.

## Points à confirmer avec la direction

1. **Stock négatif** : toujours interdit, ou autorisé par la direction (pour tous les produits, certains produits, ou au cas par cas) ?
2. **Sorties de caisse** : à partir de quel montant faut-il une autorisation, et par qui (directeur, administrateur, comptable) ?
3. **Ventes hors ligne anciennes** : au-delà de combien de jours une vente faite hors ligne doit-elle être refusée ou validée par un responsable ?
4. **Remises et taxes à la caisse** : qui peut accorder une remise, avec quel plafond ? La TVA s'applique-t-elle à tous les produits ?
5. **Noms d'utilisateur** : format souhaité (ex. « rose.caisse ») ; la connexion par e-mail doit-elle rester possible ?
6. **Imprimante thermique** : modèle exact (largeur imprimable 72 mm ou 80 mm, coupe automatique) et logo officiel.
7. **Proformas** : qui peut modifier les prix d'une proforma ?

## Réalisé - étapes A, B et C

### Anomalies corrigées

| Anomalie | Correction |
|---|---|
| Faux « Mode hors ligne » | La connexion est vérifiée avant de basculer hors ligne ; revérifiée au retour sur l'onglet et toutes les 15 s hors ligne. |
| La caisse ne voyait plus la session ouverte | Jointures nommées explicitement dans toute l'application ; test qui empêche le retour du défaut. |
| « Erreur réseau » à la place du vrai motif | Motif réel du serveur, en français (« Stock insuffisant pour … », « Aucune session de caisse ouverte… »). |
| « A cash session is already open » à chaque synchronisation | L'ouverture de caisse renvoie la session déjà ouverte au lieu de refuser ; une ouverture faite hors ligne est rattachée à la session du serveur. |
| Vente hors ligne datée de sa synchronisation | La vente garde son heure réelle (mouvement de stock, écriture et rapport de caisse compris) ; refusée si elle date de plus de 7 jours (paramètre). |
| Vente acceptée sur l'appareil puis refusée faute de stock | La caisse refuse immédiatement une quantité supérieure au stock disponible (stock du serveur moins les ventes en attente sur l'appareil). |
| Paramètre « stock négatif » sans effet | Remplacé par l'indication de la règle appliquée (interdit) en attendant la décision de la direction. |
| Paramètre « Client obligatoire » sans effet | Appliqué à la caisse. |
| Suppression des dépenses | Annulation avec motif ; la dépense reste visible, barrée ; son écriture est annulée ; une dépense de caisse annule aussi le mouvement. |

### Fonctionnalités ajoutées

- Menu de synchronisation : chaque opération en attente ou refusée avec son motif, boutons « Réessayer » et « Abandonner » ; message après chaque synchronisation (« 2 opération(s) envoyée(s), 1 refusée »).
- Caisse : recherche pendant la saisie avec le stock disponible, boutons + / −, stock affiché dans le panier, remise par ligne (directeur et administrateur), sous-total / remises / taxes / total, récapitulatif avant validation, « + Nouveau client » (aussi hors ligne), bouton « Sortie de caisse ».
- Sorties de caisse : au-delà d'un seuil (5 000 HTG par défaut, dans Paramètres), une sortie enregistrée par un caissier ou un comptable attend l'autorisation d'un directeur ou d'un administrateur ; rien n'est comptabilisé avant ; autorisation ou refus tracés (« Autorisé par … »).
- Mode de décaissement : caisse principale, petite caisse, banque ou MonCash (ces deux derniers pour les rôles comptables, dépenses et paiements fournisseurs).
- Fiche produit : « + Ajouter une catégorie », « + Ajouter un fournisseur », « + Ajouter une unité », l'élément créé est sélectionné aussitôt.

### Tests

- `npm run test:db` : base de données (règles, droits, écritures) et scénarios de bout en bout, dont : ouverture de caisse rejouée, vente hors ligne de la veille, sorties autorisées / refusées, annulation de dépense, paiement par banque.
- `npm run test:ui` (nouveau, dans le projet) : l'application réelle dans Chrome. Chaque page et chaque onglet pour les rôles Directeur, Caissière, Comptable et Gestionnaire de stock ; vente avec contrôle du stock, nouveau client et récapitulatif ; vente refusée à la synchronisation (motif, nouvelle tentative, abandon) ; caisse ouverte hors ligne alors qu'une session existe sur le serveur, vente qui garde son heure réelle ; sortie de caisse en attente puis autorisée, autre sortie refusée ; annulation d'une dépense ; création rapide catégorie / fournisseur / unité.

### Choix provisoires (à confirmer par la direction)

| Point | Choix appliqué en attendant |
|---|---|
| Stock négatif | Interdit. |
| Seuil d'autorisation des sorties | 5 000 HTG, modifiable dans Paramètres (0 = aucune autorisation). |
| Âge maximum d'une vente hors ligne | 7 jours, modifiable dans Paramètres. |
| Remises à la caisse | Directeur et administrateur seulement, sans plafond. |
| Taxes | Affichées (0 tant qu'aucune TVA n'est appliquée aux produits). |

## Réalisé - étapes D, E et F

### Anomalies corrigées

| Anomalie | Correction |
|---|---|
| Création d'utilisateur impossible en ligne (la clé secrète était demandée au navigateur) | Fonction serveur `users` (Supabase Edge Function) : création, mot de passe, nom d'utilisateur ; la clé secrète reste sur le serveur. |
| Recettes journalières vides ou fausses hors ligne | Calcul sur la copie locale et les ventes en attente sur l'appareil, avec l'origine des chiffres affichée ; actualisation au retour de la connexion. |
| Ventes en attente comptées au montant reçu (monnaie comprise) | Comptées à la valeur des articles. |
| Proformas : ni consultation détaillée, ni modification, ni historique | Fiche détaillée, modification avec recalcul par le serveur et historique des versions, changement de statut. |
| Ticket thermique : la page restait rétrécie à 72 mm sur certains navigateurs après impression | La largeur 72 mm ne s'applique plus qu'à l'impression. |
| Droits écrits en dur, différents entre l'écran et la base | Une seule table de permissions par rôle, lue par la base et par l'écran. |
| Paramètres sans effet (préfixes de numérotation, TVA, devise) | Retirés et remplacés par la règle réellement appliquée. |

### Fonctionnalités ajoutées

- **Impression 80 mm** : modèle commun (logo, nom, adresse, téléphone, NIF, numéro, date et heure, articles, total, paiement, message de bas de reçu) pour le reçu de vente, la clôture de caisse, le bon de sortie, le comptage et la proforma ; choix 80 mm / A4 dans Paramètres › Impression.
- **Proformas** : création et modification en une transaction ; un caissier garde les prix du catalogue, un responsable autorisé peut les changer ; impression A4 et ticket 80 mm avec validité ; « Encaisser à la caisse » charge la proforma, qui passe à « Transformée en vente » une fois la vente enregistrée. Le stock ne bouge qu'à la vente.
- **Utilisateurs** : création avec nom d'utilisateur proposé (ex. « rose.caisse »), e-mail facultatif, mot de passe généré ; nouveau mot de passe ; modification du nom, de l'identifiant et de l'e-mail ; historique des activités de chaque utilisateur. Connexion par nom d'utilisateur ou par e-mail.
- **Rôles et permissions** (Utilisateurs › Rôles et permissions, rôle Administrateur) : 21 permissions en 5 modules, cochées par rôle ; chaque changement est appliqué par la base et inscrit au journal d'audit. Les valeurs par défaut reprennent exactement les règles précédentes. L'Administrateur garde toujours la gestion des permissions.
- **Paramètres** réorganisés : Entreprise (nom, NIF, adresse, téléphone, e-mail, message de bas de reçu, logo importé depuis l'ordinateur), Impression, Caisse (client obligatoire, seuil d'autorisation des sorties, âge maximum des ventes hors ligne, fonds fixe de la petite caisse), Stock (règles appliquées).

### Tests

- `npm run test:db` : en plus des précédents, comptes utilisateurs (création, nom d'utilisateur, connexion, droits), proformas (création, modification, historique, prix, transformation), permissions (valeurs par défaut identiques aux règles précédentes, modification, refus, rôle Administrateur protégé). Tous passent.
- `npm run test:ui` : en plus des précédents, chaque page pour le rôle Administrateur ; création d'un compte par le directeur ; retrait d'une permission par l'administrateur (menu, page et base suivent) ; proforma créée, modifiée, imprimée en 80 mm et encaissée ; recettes journalières hors ligne avec la vente en attente. 17 tests, tous passent.

### Choix provisoires (à confirmer par la direction)

| Point | Choix appliqué en attendant |
|---|---|
| Administrateur à la caisse | Peut vendre (comme le directeur) ; modifiable dans Rôles et permissions. |
| Remises à la caisse | Contrôlées par l'écran (permission « Accorder une remise »), pas encore par la base. |
| Prix des proformas | Directeur et administrateur ; les caissiers gardent les prix du catalogue. |
| Gestion des permissions | Rôle Administrateur seulement. |
| Mode local (démonstration sans Internet) | Permissions par défaut, non modifiables ; modification des proformas réservée à la version en ligne. |
