# Draftroom · League Draft Assistant

Assistant de draft manuel pour une équipe de cinq joueurs : pools par poste, picks et bans des deux côtés, swaps, rôles indéterminés et classement contextuel Delta 2. React 19 + TypeScript + Vite, frontend statique Netlify, backend Supabase optionnel pour le mode partagé.

**État de livraison :** démo locale opérationnelle ; backend SQL testé sur Postgres embarqué ; connexion Supabase et publication Netlify à effectuer. Aucune statistique Lolalytics réelle n'est intégrée. Aucun déploiement ou test du service Realtime hébergé n'est implicitement acquis.

## Mise à jour d’une installation existante

L’interface est en anglais. La préparation (`/rooms/:id/setup`) et la draft (`/rooms/:id/draft`) sont séparées ; tous les joueurs passent à la draft quand l’hôte la lance après préparation. Les anciens liens d’invitation restent valides.

Pour activer **Leave room** et **End room**, exécuter uniquement la nouvelle migration [202611110002_room_lifecycle.sql](supabase/migrations/202611110002_room_lifecycle.sql) dans **Supabase → SQL Editor → New query → Run**. Elle préserve les salles et datasets existants ; ne pas rejouer la migration initiale. Aucun secret ni changement de variable Netlify n’est nécessaire.

Pour activer **Swap role**, exécuter ensuite [202611110003_role_swaps.sql](supabase/migrations/202611110003_role_swaps.sql). Chaque demande doit être acceptée par le joueur ciblé. Refus et annulation ne modifient aucun rôle ; une acceptation conserve les pools de chacun et annule leur état prêt. Changer de rôle, quitter ou terminer la salle invalide les demandes concernées. Les droits de l’hôte ne permettent pas de forcer un échange via `save_room`.

**Leave room** libère le siège et révoque l’accès du joueur. Si l’hôte part, le premier joueur restant devient hôte. Une salle vide est supprimée. **End room**, réservé à l’hôte, ferme la salle depuis la préparation ou la draft : elle reste visible en lecture seule, et chacun peut ensuite la quitter. Fermer simplement l’onglet conserve le siège pour la reconnexion.

## Démarrer

Node 24 et npm 11. Utiliser le checkout existant : chaque tâche cloud est isolée, aucun worktree supplémentaire n'est nécessaire.

```sh
npm ci
npm run dev
```

Sans variables, le bouton ouvre une **démo locale** persistée dans ce navigateur. Ce mode ne partage pas la salle avec d'autres personnes. Choisir un rôle dans sa case, ajouter des champions avec **[+]** puis cliquer **Ready** pour démarrer. Les nouveaux joueurs n’ont aucun rôle ni champion présélectionné. Ajout et retrait du pool sont enregistrés immédiatement ; les anciennes sélections restent conservées. Le mode local permet de tester seul ; les propositions d’échange nécessitent une salle partagée avec un autre joueur.

```sh
npm test                 # scoring, imports, invariants, SQL/RLS à cinq identités
npm run build            # vérification TypeScript + production
npx playwright install chromium
npm run test:e2e         # navigateur : Jhin/Caitlyn, ban, reload, desktop/mobile
# Si Chromium est déjà installé :
PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/usr/bin/chromium npm run test:e2e
```

Le test SQL utilise PGlite (vrai moteur PostgreSQL WASM) et cinq identités Auth simulées. Il vérifie les RPC, droits RLS, invitations, reconnexion, capacité, doublons, conflits de versions et gel du dataset. Il ne remplace pas une validation Supabase Realtime sur cinq navigateurs ; voir [la procédure de recette](docs/ACCEPTANCE.md).

## Créer Supabase (mode cinq joueurs)

1. Créer un projet sur Supabase et ouvrir **SQL Editor**. Exécuter les fichiers de `supabase/migrations` dans l’ordre, `202611110001_draftroom.sql`, `202611110002_room_lifecycle.sql` puis `202611110003_role_swaps.sql`, sur un projet neuf. Le schéma `auth` et les rôles sont fournis par Supabase.
2. Dans **Authentication → Providers**, activer les connexions anonymes. Les utilisateurs n'ont pas de compte à créer. Conserver les limites Auth du projet ; configurer la protection contre l'abus avant une large diffusion publique.
3. La migration ajoute `rooms` à la publication `supabase_realtime` si elle existe. Vérifier **Database → Replication** : `rooms` doit être activée.
4. Copier `.env.example` vers `.env.local`, renseigner l'URL du projet et la clé **publique anon / publishable**. Ne jamais utiliser `service_role`, une clé secrète ou un mot de passe dans une variable `VITE_*`.
5. Relancer `npm run dev`. Créer la salle, copier l'invitation, l'ouvrir dans quatre autres profils/navigateurs. Chaque participant choisit son poste puis son pool. Un profil de navigateur conserve son identité anonyme et son siège au rechargement.

Le lien d'invitation est un secret de salle ; ne le publier qu'aux participants. Son token aléatoire est dans le fragment URL, qui n'est pas envoyé à l'hébergeur. La base conserve uniquement son SHA-256 dans une table inaccessible aux clients. Les membres lisent la salle via RLS ; les écritures passent exclusivement par des RPC `security definer` avec `search_path` fixe et validation serveur. La salle est verrouillée pendant la mutation : version obsolète = conflit explicite et rafraîchissement, jamais écrasement silencieux. L’hôte configure, démarre et termine la salle ; tous les membres éditent picks et bans.

Le Realtime déclenche une relecture canonique. Une relecture de secours et un heartbeat toutes les 20 secondes permettent de récupérer les mises à jour après reconnexion. L'indicateur de présence est approximatif (heartbeat expiré après 65 s). Les joueurs sans rôle ont déjà réservé l'un des cinq sièges participants.

## Déployer sur Netlify

1. Importer le dépôt GitHub dans **Netlify → Add new project → Import an existing project**. Choisir la branche `main`.
2. `netlify.toml` définit `npm run build`, `dist`, Node 24, le fallback SPA et les en-têtes de sécurité. Aucun serveur WebSocket Netlify n'est requis.
3. Pour le mode partagé, ajouter `VITE_SUPABASE_URL` et `VITE_SUPABASE_ANON_KEY` dans les variables Netlify **avant** le build. Ces valeurs publiques sont incorporées au bundle. Déclencher un nouveau déploiement après modification.
4. Sans ces variables, le site déployé reste en démo locale clairement identifiée.
5. Vérifier création/join, partage à cinq et reconnexion selon `docs/ACCEPTANCE.md`.

Alternative CLI après authentification de votre compte : `npx netlify-cli login`, `npx netlify-cli init`, puis `npm run build` et `npx netlify-cli deploy --prod --dir=dist`. Le dépôt ne contient ni token Netlify ni identifiant de site préexistant.

## Interface

Les rôles affichés sont Top, Jungle, Mid, **Bottom**, Support. La clé persistée `ADC` reste conservée dans les salles, imports et coefficients pour compatibilité ; l’interface la présente comme Bottom. Le résultat est nommé **Score** ; la formule mathématique reste identique.

Les icônes de rôles PNG sont téléchargées et embarquées dans `public/icons`. Leur provenance et la référence à l’icône d’échange du client League sont documentées dans [docs/ASSETS.md](docs/ASSETS.md).

## Données et scoring

- Le moteur pur dans `src/domain/scoring.ts` utilise uniquement la moyenne des Delta 2 pondérée par `src/domain/weights.ts`. Top et Support suivent les coefficients de la spec. Jungle, Mid et ADC utilisent provisoirement `2/9` par paire.
- Un Delta 2 est en points de pourcentage. Il ne s'agit pas d'une probabilité de victoire. Aucun winrate brut, prior, métagame ou heuristique n'est ajouté.
- Une paire manquante reste manquante, ne compte pas dans le dénominateur et réduit la couverture. Aucun contexte calculable = `N/A`. Les égalités sont triées par nom.
- Les relations sont directionnelles et conditionnées par les deux postes. Un pick sans poste bloque le champion mais ne contribue pas au score.
- `PairwiseDataProvider` sépare les données du moteur. La fixture synthétique contient uniquement un sous-ensemble de rôles et de champions : la couverture partielle est intentionnelle. Les cinq clients lisent le même snapshot durable en base ; le score est calculé en mémoire, sans aucune requête statistique après un pick.
- Le dataset complet, ses métadonnées et ses paires sont conservés une seule fois par salle dans `rooms.state`. Il est figé pendant la draft, y compris si l'on prépare d'autres salles. Pas de cache global qui remplace silencieusement les données. Cette V1 n'offre pas encore de déduplication inter-salles ou de gros entrepôt de statistiques.

### Import autorisé

L'hôte importe un JSON ou CSV en préparation. Exemples : [JSON](public/examples/dataset.json), [CSV](public/examples/pairs.csv). Pour CSV, fournir les métadonnées dans la fenêtre JSON demandée, par exemple :

```json
{"id":"mon-dataset-v1","patch":"16.1","tier":"diamond_plus","source":"Ma source autorisée","importedAt":"2026-11-11T00:00:00Z","fictional":false}
```

Ne marquer `fictional:false` que pour des données réelles dont vous avez les droits. Le JSON contient ces métadonnées et `pairs`. Chaque paire contient `relation`, `candidateChampionId`, `candidateRole`, `otherChampionId`, `otherRole`, `delta2` (nombre ou null), `games` optionnel. IDs numériques Riot **sous forme de chaînes**. Postes : `Top`, `Jungle`, `Mid`, `ADC`, `Support`. CSV UTF-8 à virgules, guillemets doubles supportés ; delta vide = manquant. Les doublons directionnels, postes/IDs inconnus et nombres invalides sont rejetés. Limites V1 : 12 Mo et 100 000 paires/import.

### Catalogue et portraits

Le catalogue embarqué de 152 champions provient de Riot Data Dragon **10.23.1**, via le miroir public `ngryman/lol-champions` ; les URLs de portraits viennent directement du catalogue et utilisent HTTPS. Il est ancien et n'inclut pas les sorties ultérieures. Les portraits sont servis par Riot ; initiales de secours en cas d'indisponibilité. La source récente était bloquée par la politique réseau de l'environnement lors du développement.

Pour le mettre à jour depuis **Riot officiel**, avec accès réseau à `ddragon.leagueoflegends.com` :

```sh
npm run catalogue:update -- 16.1.1  # exemple de version explicite ; choisir la version voulue
# ou npm run catalogue:update pour prendre la version courante annoncée par Riot
npm test
npm run build
```

Le script valide IDs/noms, conserve les chemins fournis par Riot et inscrit la version dans `catalogue-meta.json`. Revoir et committer les changements. Les classes de champions ne sont jamais utilisées comme restrictions de poste.

### Lolalytics

Aucun scraper ni appel à l'API privée n'est intégré. Le déploiement ne dépend pas de Lolalytics. L'accès programmatique complet aux Delta 2 `vs` **et** `with`, ainsi que les droits d'utilisation, restent à établir séparément avant tout collecteur. Un simple winrate n'est jamais converti en Delta 2.

## Structure

- `src/domain` : types, coefficients, score, invariants de draft.
- `src/data` : catalogue versionné, provider démo/import, validation JSON/CSV.
- `src/lib/rooms.ts` : Auth anonyme, RPC, Realtime et reprise canonique.
- `src/App.tsx` : entrée, suivi de salle et actions communes. `src/pages/SetupPage.tsx` : préparation. `src/pages/DraftPage.tsx` : board, bans, swaps et recommandations. `src/components` : sélecteur partagé de champions.
- `supabase/migrations` : schéma, permissions, fonctions atomiques et Realtime.
- `tests` : tests de domaine, SQL multi-identités et navigateur ; CI GitHub Actions.

Ce projet communautaire n'est pas affilié à Riot Games. Les assets League of Legends appartiennent à Riot Games.
