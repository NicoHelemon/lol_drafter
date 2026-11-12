# Draftroom

Application de draft League of Legends pour une équipe de cinq joueurs. React + TypeScript + Vite, frontend Netlify et salles partagées sur Supabase.

## Base de données

Le schéma courant comprend les migrations `202611110001` à `202611120007` dans `supabase/migrations`. Les mises à jour peuvent être appliquées directement via l’API d’administration Supabase avec un jeton d’environnement autorisé ; le jeton ne doit jamais être placé dans le dépôt ou dans le frontend.

La migration **005** interdit les picks sans rôle. La migration **006** ajoute une opération transactionnelle pour enrichir les candidats pendant la draft sans modifier le pick. Ces deux migrations ne suppriment aucune donnée. Sur une installation existante, appliquer uniquement les nouvelles migrations. **Ne pas rejouer 004** : elle réinitialise les salles temporaires.

La migration **007** déporte les statistiques dans un cache partagé et immuable, par champion/rôle. Les salles gardent une référence à leur instantané ; leurs données ne sont pas supprimées.

## Fonctionnement

- L’interface est en anglais. Une salle porte le nom de son créateur, par exemple **Nico’s room**, avec une URL `/rooms/nicos-room/setup`. Les doublons de noms reçoivent un suffixe numérique ; le UUID reste une clé interne.
- Le panneau des participants indique le nombre de joueurs (`2/5`) et leurs noms, sans leurs rôles. Un badge **HOST** identifie l’hôte, y compris avant qu’il ait choisi un rôle. L’hôte peut démarrer immédiatement, sans Ready ni obligation de remplir les rôles ou pools.
- **Join** réserve un rôle libre. Les pools commencent vides. Ajouter un portrait avec [+] ou le retirer avec × enregistre directement la modification.
- Survoler le panneau d’un autre joueur fait apparaître les flèches d’échange ; le bouton reste accessible au clavier et visible sur écran tactile.
- Les deux joueurs voient un popup pendant la demande, avec une barre de temps qui se vide. Le destinataire dispose de Accept / Decline, le demandeur de Cancel. La demande expire après **cinq secondes**. Sans réponse, elle est refusée ; le serveur rejette aussi les acceptations tardives.
- Les pools restent liés à leur joueur lors d’un échange. L’hôte peut démarrer pendant une demande : le passage en draft la supprime.
- **Quit** libère le siège. Si l’hôte part, le premier participant restant devient hôte. La dernière sortie supprime la salle, ses membres, son invitation et ses demandes d’échange. Fermer un onglet conserve le siège pour permettre la reconnexion ; il faut utiliser Quit pour partir.
- La préparation et la draft sont deux pages distinctes. Le draft board occupe toute la largeur, avec les bans en haut. Les postes ennemis et les postes alliés sans joueur associé affichent [+] tant qu’ils sont vides ; un premier pick remplace [+], puis un clic sur le portrait ouvre son remplacement. Pour un poste allié associé à un joueur, [+] ajoute uniquement des candidats depuis le catalogue, sans sélectionner de pick. Un clic sur un candidat le sélectionne ou, s’il est déjà sélectionné, le désélectionne. Cliquer un autre candidat remplace le pick. Le candidat sélectionné reste toujours en première position, quel que soit son score. Le nom du joueur est affiché sous son rôle. Les champions pris ailleurs ou bannis restent visibles en gris. Chaque portrait porte son score en surimpression ; cliquer le score ouvre les contributions détaillées. Chaque pick doit avoir un rôle ; les menus permettent toujours de déplacer ou échanger des picks. La base est la source de vérité ; Realtime déclenche une relecture canonique, avec reprise après reconnexion.

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

1. Créer un projet Supabase neuf. Appliquer les sept fichiers de `supabase/migrations` dans l’ordre, de `202611110001` à `202611120007`.
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

Les statistiques sont stockées dans un cache partagé, découpé par champion/rôle. Chaque salle conserve uniquement une référence figée à son instantané ; le navigateur charge les fragments de ses pools et des picks affichés, puis calcule les scores en mémoire. Un nouveau candidat ou rôle peut charger un fragment supplémentaire du cache, sans appeler la source statistique. Les imports de l’interface sont limités à 12 Mo et 100 000 paires, avec validation des doublons, IDs, rôles et nombres.

Un pipeline Python séparé valide les exports autorisés, produit des fichiers gzip versionnés et les publie dans le cache Supabase. Le workflow quotidien reste désactivé tant qu’une source réelle n’est pas vérifiée et configurée. **L’extraction des vrais Delta 2 Lolalytics reste à démontrer** : le proxy de l’environnement bloque actuellement l’accès au domaine. Essais, mesures, commandes et étapes restantes : [rapport d’acquisition](docs/statistics/REPORT.md).

## Structure

- `src/pages` : préparation et draft ; `src/components` : portraits, icônes et popup de demande.
- `src/domain` : types, invariants, poids, score et actions distinctes d’ajout de candidat / sélection de pick.
- `src/lib/rooms.ts` : Auth anonyme, RPC, Realtime et reprise canonique.
- `src/data` : catalogue, fixture synthétique et validation des imports.
- `supabase/migrations` : schéma, RLS et fonctions serveur.
- `tests` : domaine, assets, base multi-identités et parcours navigateur.

Projet communautaire non affilié à Riot Games. Les assets League of Legends appartiennent à Riot Games.

Pour les scores des picks adverses, le contexte est orienté depuis le candidat adverse (ses coéquipiers et ses adversaires). Aucune symétrie ou inversion artificielle d’un score allié n’est supposée. Le candidat lui-même est exclu des paires.

Pendant la draft, tous les membres peuvent ajouter un candidat à un poste incarné via `add_draft_candidate`. Cette RPC ne modifie que le pool ciblé et vérifie la version de la salle ; les permissions générales de suppression/remplacement des pools ne sont pas élargies.
