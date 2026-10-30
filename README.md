# Makèt Peyizan POS

Application de caisse, stock et comptabilité construite avec React, TypeScript,
Vite et Supabase. Un serveur local SQLite est disponible uniquement pour la
démonstration et les tests hors ligne.

## Prérequis

- Node.js 20 ou plus récent
- npm
- Pour le mode hébergé : un projet Supabase et les migrations du dossier
  `supabase/migrations`

## Démarrage

1. Copier `.env.example` vers `.env.local` et renseigner les variables
   Supabase, **ou** activer `VITE_USE_LOCAL_DB=true` pour la démonstration.
2. Installer les dépendances : `npm install`.
3. En mode local, dans un second terminal : `cd server; npm install; npm run start`.
4. Démarrer le client : `npm run dev`.

Le secret JWT du serveur local doit être défini dans l'environnement. Il est
obligatoire en production. Ne jamais placer une clé `service_role` Supabase
dans le navigateur.

## Installer l'application (ordinateur, téléphone, tablette)

Une fois le site publié en HTTPS, l'application s'installe comme un logiciel et
fonctionne hors ligne :

- **Chrome / Edge (Windows, Mac, Android)** : bouton « Installer l'application »
  dans le menu latéral ou sur la page de connexion (ou l'icône d'installation de
  la barre d'adresse). L'application apparaît dans le menu Démarrer, le Dock ou
  l'écran d'accueil.
- **iPhone / iPad (Safari)** : Partager → « Sur l'écran d'accueil ». Le bouton de
  l'application affiche ces étapes.
- **Safari sur Mac** : Fichier → « Ajouter au Dock ».

À l'installation, toute l'application est téléchargée (`sw/service-worker.js`,
complété au build par `vite.config.ts`). Se connecter une première fois avec
Internet enregistre aussi les données sur l'appareil. Quand une nouvelle version
est publiée, un message « Nouvelle version disponible » propose la mise à jour
sans interrompre une vente. Le service worker n'est actif qu'en production
(`npm run build`, puis `npm run preview` pour tester).

## Qualité

- Vérification : `npm run lint`
- Build production : `npm run build`
- Migrations Supabase : appliquer les fichiers dans leur ordre de nommage avec
  la CLI Supabase sur une base de test avant toute production.

## Données et sauvegarde

- Supabase : utiliser les sauvegardes/exports PostgreSQL fournis par Supabase,
  et tester une restauration sur un projet distinct.
- Mode local : arrêter le serveur puis copier `server/maket-peyizan.db` vers un
  emplacement chiffré et contrôlé. Pour restaurer, arrêter le serveur, mettre
  la copie de sauvegarde à la place du fichier puis redémarrer. Ne pas écraser
  une base active.

Le script `server/init-db.js` crée une base de démonstration : ne jamais
l'utiliser sur une base contenant des données à préserver.

## Décisions métier à confirmer avant production

- Seuil, rôles et circuit d'approbation des remises.
- Plan comptable, fiscalité et règles de génération des écritures.
- Méthode de valorisation du stock et traitement du CMV.
- Politique de clôture de caisse et des périodes comptables.

Les paiements MonCash et NatCash sont enregistrés manuellement avec une
référence facultative ; ils ne sont pas vérifiés auprès de ces services.
