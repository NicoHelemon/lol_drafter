# Draftroom

Application de draft League of Legends pour une équipe de cinq joueurs. React + TypeScript + Vite, frontend Netlify et salles partagées sur Supabase.

## Installation existante

Exécuter [202611110004_ephemeral_rooms.sql](supabase/migrations/202611110004_ephemeral_rooms.sql) dans **Supabase → SQL Editor → New query → Run**, après les migrations précédentes.

**Cette migration supprime les salles temporaires existantes**, leurs invitations et demandes d’échange. Les salles sont éphémères ; aucun chemin de compatibilité avec les anciennes versions n’est maintenu. Aucune variable Netlify supplémentaire n’est nécessaire.

## Fonctionnement

- L’interface est en anglais. Une salle porte le nom de son créateur, par exemple **Nico’s room**, avec une URL `/rooms/nicos-room/setup`. Les doublons de noms reçoivent un suffixe numérique ; le UUID reste une clé interne.
- Un badge **HOST** identifie l’hôte, y compris avant qu’il ait choisi un rôle. L’hôte peut démarrer immédiatement, sans Ready ni obligation de remplir les rôles ou pools.
- **Join** réserve un rôle libre. Les pools commencent vides. Ajouter un portrait avec [+] ou le retirer avec × enregistre directement la modification.
- Survoler le panneau d’un autre joueur fait apparaître les flèches d’échange ; le bouton reste accessible au clavier et visible sur écran tactile.
- Le destinataire reçoit un popup qui expire après **cinq secondes**. Sans réponse, la demande est refusée. Le serveur vérifie aussi l’expiration : un clic tardif ne change aucun rôle. Le demandeur voit un message d’attente.
- Les pools restent liés à leur joueur lors d’un échange. L’hôte peut démarrer pendant une demande : le passage en draft la supprime.
- **Quit** libère le siège. Si l’hôte part, le premier participant restant devient hôte. La dernière sortie supprime la salle, ses membres, son invitation et ses demandes d’échange. Fermer un onglet conserve le siège pour permettre la reconnexion ; il faut utiliser Quit pour partir.
- La préparation et la draft sont deux pages distinctes. La base est la source de vérité ; Realtime déclenche une relecture canonique, avec reprise après reconnexion.

## Développer

Node 24 et npm 11. Utiliser le checkout existant ; chaque tâche cloud est isolée, sans nécessité de créer un worktree.

```sh
npm ci
npm run dev
npm test
npm run build
npx playwright install chromium
npm run test:e2e
# Si Chromium est installé sur le système :
PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/usr/bin/chromium npm run test:e2e
```

Sans variables Supabase, le site fonctionne en démo locale sur un seul navigateur. Cette démo ne synchronise pas plusieurs appareils. Les tests SQL utilisent PGlite (PostgreSQL WASM) avec plusieurs identités Auth ; ils ne constituent pas une validation du service Realtime hébergé.

## Créer Supabase et déployer sur Netlify

1. Créer un projet Supabase neuf. Exécuter les quatre fichiers de `supabase/migrations` dans l’ordre, de `202611110001` à `202611110004`.
2. Activer **Authentication → Sign In / Providers → Anonymous Sign-Ins**.
3. Vérifier que `rooms` appartient à la publication `supabase_realtime` dans **Database → Replication**.
4. Copier `.env.example` vers `.env.local` pour le développement. Renseigner `VITE_SUPABASE_URL` et la clé publique `VITE_SUPABASE_ANON_KEY` (anon ou publishable). Ne jamais utiliser de clé `service_role` ou secrète dans une variable `VITE_*`.
5. Dans Netlify, importer le dépôt GitHub sur `main`. `netlify.toml` définit le build `npm run build`, la publication `dist`, Node 24, le fallback SPA et les en-têtes de sécurité.
6. Ajouter les deux variables publiques dans Netlify, puis déployer. Si les visiteurs doivent accéder sans compte Netlify, régler **Production visibility** sur **Public**.
7. Créer une salle et tester l’invitation dans un autre profil de navigateur. Une identité anonyme est conservée entre les rechargements dans ce profil.

Le token d’invitation est un secret de salle, placé dans le fragment URL, qui n’est pas envoyé à Netlify. Son SHA-256 est conservé dans une table inaccessible aux clients. Les membres lisent via RLS ; les écritures passent par des RPC validées et transactionnelles. Une mutation de draft obsolète est refusée explicitement. Quit n’exige pas de version exacte pour ne pas bloquer une sortie sur une modification concurrente.

## Champions et portraits

Le site embarque **173 champions et leurs portraits**, issus de **Riot Data Dragon 16.22.1** via le miroir public `InFinity54/LoL_DDragon`, commit `dc04342110a9e0d7f76ffc844475070317015216`. Les portraits sont des PNG locaux : aucune requête tierce n’est requise pour les afficher. Le numéro de catalogue n’est pas affiché dans l’interface.

Pour actualiser le catalogue depuis le miroir et télécharger les images :

```sh
npm run catalogue:update
# Ou reproduire exactement la version livrée :
npm run catalogue:update -- dc04342110a9e0d7f76ffc844475070317015216
npm test
npm run build
```

Le script valide les IDs, noms de fichiers et images PNG carrées avant de remplacer le catalogue. Revoir puis committer les JSON et `public/champions`. Provenance des assets : [docs/ASSETS.md](docs/ASSETS.md).

## Statistiques et score

Le score conserve la moyenne pondérée des deltas normalisés définie dans `src/domain/scoring.ts`, avec les coefficients centralisés dans `weights.ts`. Top et Support suivent les coefficients choisis ; Jungle, Mid et Bottom utilisent provisoirement `2/9` par paire. Il ne s’agit pas d’une probabilité de victoire. Les paires manquantes restent manquantes, sans faux zéro ; aucune paire connue donne N/A. Aucun winrate global, prior ou heuristique de composition n’est ajouté.

Les **statistiques de démonstration restent fictives**. Le nouveau catalogue de portraits n’ajoute aucune vraie statistique. Aucun scraping ni appel à l’API privée Lolalytics n’est intégré.

L’hôte peut importer des données autorisées JSON ou CSV en préparation : [exemple JSON](public/examples/dataset.json), [exemple CSV](public/examples/pairs.csv). Métadonnées requises : `id`, `patch`, `tier`, `source`, `importedAt` (ISO), `fictional` (booléen). Chaque paire contient `relation`, `candidateChampionId`, `candidateRole`, `otherChampionId`, `otherRole`, `delta2` et éventuellement `games`. Les IDs Riot sont des chaînes ; les clés de rôles dans les données sont `Top`, `Jungle`, `Mid`, `ADC`, `Support` (ADC est affiché Bottom).

Le dataset est stocké une fois par salle et figé quand la draft démarre. Les scores sont calculés en mémoire, sans requête statistique après chaque pick. Les imports sont limités à 12 Mo et 100 000 paires, avec validation des doublons, IDs, rôles et nombres.

## Structure

- `src/pages` : préparation et draft ; `src/components` : portraits, icônes et popup de demande.
- `src/domain` : types, invariants, poids et score.
- `src/lib/rooms.ts` : Auth anonyme, RPC, Realtime et reprise canonique.
- `src/data` : catalogue, fixture synthétique et validation des imports.
- `supabase/migrations` : schéma, RLS et fonctions serveur.
- `tests` : domaine, assets, base multi-identités et parcours navigateur.

Projet communautaire non affilié à Riot Games. Les assets League of Legends appartiennent à Riot Games.
