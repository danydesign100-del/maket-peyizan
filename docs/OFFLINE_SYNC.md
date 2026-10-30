# Mode hors ligne et synchronisation

Le navigateur enregistre désormais chaque vente Supabase dans IndexedDB avant
toute requête réseau. La vente est placée dans une file persistante avec un
identifiant UUID stable et l'état `pending_sync`, puis synchronisée discrètement
au démarrage, au retour en ligne, au focus et lors du retour de visibilité.

La migration `20261021000000_offline_sale_sync.sql` est obligatoire avant
d'activer ce flux. Elle ajoute une clé d'idempotence et la RPC
`complete_offline_sale`, qui sérialise les tentatives pour une même vente.

## Application de la migration

1. Sauvegarder la base Supabase et appliquer les migrations existantes dans
   l'ordre de leur nom.
2. Exécuter cette migration dans Supabase SQL Editor ou avec `supabase db push`
   sur un environnement de test.
3. Vérifier qu'un utilisateur `cashier` peut appeler la RPC et qu'un utilisateur
   non autorisé reçoit un refus.

## Mode hors ligne de toute l'application

Au-delà des ventes, toute l'application fonctionne sans connexion
(`src/lib/offline/`), avec Supabase comme avec le serveur local :

- **Lectures** : chaque lecture passe d'abord par le réseau (délai maximal de
  12 s), puis la réponse est copiée dans IndexedDB. Hors ligne, la dernière
  copie est affichée avec un bandeau « Mode hors ligne ».
- **Données de référence** : produits, clients, fournisseurs et catégories sont
  copiés intégralement à chaque synchronisation. Recherche, filtres et
  pagination restent donc disponibles hors ligne.
- **Écritures** : clients, produits, catégories, fournisseurs, mouvements de
  stock, dépenses, proformas, comptages de caisse, ouverture et fermeture de caisse sont placés dans
  une file (`outbox`) et rejoués dans l'ordre au retour de la connexion. Les
  identifiants temporaires (`local-…`) sont remplacés par les identifiants du
  serveur. Une fermeture de caisse envoie d'abord les ventes faites avant elle.
- **En ligne uniquement** : comptabilité (écritures, validation, ajustements),
  utilisateurs, paramètres et téléversement d'images.
- **Bouton de synchronisation** (barre latérale et en-tête mobile) : envoie les
  modifications puis télécharge les dernières données. La synchronisation est
  aussi automatique au retour de la connexion, au retour sur l'onglet et toutes
  les 10 minutes. Le détail liste les opérations en échec, qui peuvent être
  abandonnées manuellement.
- **Application** : `public/sw.js` garde l'interface disponible hors ligne. Il
  n'est actif qu'en production (`npm run build` puis `npm run preview` pour le
  tester).

Les comptages de caisse conservent l'heure du comptage sur l'appareil (`counted_at`).

Les données locales sont séparées par utilisateur. Une opération rejouée prend
l'heure du serveur au moment de la synchronisation, et non l'heure à laquelle
elle a été faite hors ligne.

## Limites opérationnelles

Un appareil hors ligne valide la vente avec son catalogue local affiché, mais ne
peut pas connaître les ventes faites simultanément sur les autres appareils. Une
erreur de stock ou de permission détectée par le serveur laisse la vente dans la
file avec `sync_error`; elle n'est jamais supprimée automatiquement. Une
interface de supervision dédiée reste à ajouter pour la reprise manuelle des
conflits.

Les transactions du serveur SQLite local suivent son propre stockage durable et
ne sont pas automatiquement répliquées vers Supabase : les deux modes sont des
déploiements alternatifs, pas deux répliques d'une même base.

## Vérification locale sans risque

Le serveur accepte `LOCAL_DB_PATH` pour démarrer sur une copie de base SQLite.
Utiliser cette variable uniquement pour les tests : la base opérateur par défaut
reste `server/maket-peyizan.db`. Exemple PowerShell : créer une copie temporaire,
définir `LOCAL_DB_PATH` et `PORT`, démarrer `node server.js`, puis appeler
`/health`. Cette procédure ne doit pas modifier la base locale active.
