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
