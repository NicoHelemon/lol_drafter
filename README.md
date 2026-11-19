# Draftroom

Application de draft League of Legends pour une équipe de cinq joueurs. React + TypeScript + Vite, frontend Netlify et salles partagées sur Supabase.

## Base de données

Le schéma courant comprend les migrations `202611110001` à `202611190025` dans `supabase/migrations`. Les mises à jour peuvent être appliquées directement via l’API d’administration Supabase avec un jeton d’environnement autorisé ; le jeton ne doit jamais être placé dans le dépôt ou dans le frontend.

La migration **005** interdit les picks sans rôle. La migration **006** ajoute une opération transactionnelle pour enrichir les candidats pendant la draft sans modifier le pick. Ces deux migrations ne suppriment aucune donnée. Sur une installation existante, appliquer uniquement les nouvelles migrations. **Ne pas rejouer 004** : elle réinitialise les salles temporaires.

Les migrations **008**, **009** et **010** ajoutent respectivement la rétention, les échanges de champions consentis et les modèles de shrinkage immuables. La maintenance est indépendante du refresh.

Les migrations **011** et **012** ajoutent les échanges de rôles pendant la draft et les catalogues de popularité immuables, supprimés avec leur snapshot par la rétention existante. La migration **013** ajoute les listes de candidats des dix rôles et la priorité du pool personnel lors de la prise de rôle. Aucune de ces migrations ne réinitialise les données.

La migration **007** déporte les statistiques dans un cache partagé et immuable, par champion/rôle. Les salles gardent une référence à leur instantané ; leurs données ne sont pas supprimées.

La migration **014** ajoute les modes ranked/tournament et la progression manuelle. Les salles temporaires sont remises à zéro lors de cette livraison selon la nouvelle autorisation utilisateur ; les données statistiques sont conservées. Voir [la séquence et les validations](docs/ui/GUIDED_DRAFT.md).

La migration **015** permet de terminer une étape dans la transaction du dernier choix (y compris par un invité) et ajoute **Clear**, réservé à l’hôte. Les rôles, joueurs, listes explicites et référence statistique restent identiques après Clear. Les bans ranked se sélectionnent en série dans un même menu, puis la draft avance au dixième ban ; **Skip remaining bans** permet de laisser des cases vides. En tournoi, **No ban** laisse passer un tour sans bannir. Voir [les règles et la validation](docs/ui/STREAMLINED_DRAFT.md).

La migration **016** ajoute l'historique partagé Undo/Redo (Ctrl Z / Ctrl Y, réservé à l'hôte, 60 actions) et **Open draft**, irréversible. Le mode libre repart avec un historique vide et autorise les picks/bans hors séquence ; Clear ne rétablit jamais le mode guidé. Les échanges par glisser-déposer et les consentements restent obligatoires. Les cases de draft se classent désormais uniquement par score ajusté. Voir [les règles de l'historique](docs/ui/OPEN_DRAFT_HISTORY.md).

La migration **017** permet le retour confirmé d'Open draft vers la draft guidée (repart de zéro), le retour partagé au lobby et cinq places de joueurs plus trois d'observateurs. Quit room quitte personnellement la salle. Les observateurs peuvent rejoindre en cours de draft et suivent sans éditer, avec contrôle serveur. Cette évolution remplace l'irréversibilité de la livraison 016. Voir [les retours et observateurs](docs/ui/LOBBY_OBSERVERS.md).

La migration **018** ajoute les comptes optionnels par code email, les profils privés et cinq pools personnels, ainsi que dix participants sans catégorie fixe. Un rôle libre peut être pris ou libéré ; seuls les cinq rôles peuvent être incarnés. L’hôte peut observer et transmettre sa fonction. Les profils sont persistants, protégés par RLS, et ne sont jamais nettoyés avec les salles. Voir [les comptes et participants](docs/ui/ACCOUNTS_MEMBERS.md).

La migration **019** sépare le pseudo de connexion privé du nom affiché dans les salles. Les nouvelles inscriptions utilisent email, pseudo de connexion unique et mot de passe (10 caractères minimum), puis confirment leur email. Une petite fonction Supabase `account-password-login` résout le pseudo côté serveur sans exposer les emails. Les comptes existants définissent leurs identifiants sans perdre leurs profils. Voir [les comptes classiques](docs/ui/PASSWORD_ACCOUNTS.md).

La migration **020** ajoute la première configuration des pools aux nouvelles inscriptions, sans réinitialiser les comptes existants, et vide les candidats d’un rôle libéré. La connexion habituelle ramène directement à l’accueil, **My profile** ouvre volontairement les réglages, et la salle utilise le nom du profil pour les comptes connectés. La zone **Observers** du panneau des participants remplace le bouton Observe en haut. Voir [l’accueil et les rôles libérés](docs/ui/PROFILE_ENTRY_OBSERVERS.md).

La migration **025** actualise les données automatiquement dans le lobby et à son retour. Pendant une draft, les données restent stables ; **New data available** propose **Update data** à l’hôte. La bascule est partagée et conserve picks, bans, rôles, candidats et Undo/Redo. La date de collecte est affichée séparément de la calibration. Une nouvelle publication n’expire plus les salles ; leurs snapshots restent protégés jusqu’à l’expiration ordinaire des salles.

**Politique permanente de livraison : aucune rétrocompatibilité des salles n’est requise. Les salles et leurs participants/invitations/demandes temporaires peuvent être supprimés à chaque mise à jour, avec vérification préalable. Cette autorisation ne concerne pas les statistiques, snapshots, modèles, catalogues, comptes ou profils personnels.** Ne pas rejouer une ancienne migration pour ce nettoyage.

## Fonctionnement

- La création choisit Ranked draft ou Tournament draft. Le lobby choisit le camp allié sur une carte bleu/rouge ; ranked masque les listes ennemies. Le déroulement est manuel, sans timer : chaque choix termine automatiquement son étape, avec Undo/Redo pour l’hôte. Les listes courtes sont complétées par popularité jusqu’à cinq choix disponibles.
- L’interface est en anglais. Une salle porte le nom de son créateur, par exemple **Nico’s room**, avec une URL `/rooms/nicos-room/setup`. Les doublons de noms reçoivent un suffixe numérique ; le UUID reste une clé interne.
- Le panneau des participants indique le nombre de participants (`2/10`) et leurs noms, sans leurs rôles. Un badge **HOST** identifie l’hôte, y compris avant qu’il ait choisi un rôle. L’hôte peut démarrer immédiatement, sans Ready ni obligation de remplir les rôles ou pools.
- **Join** réserve un rôle libre. Les pools commencent vides. Ajouter un portrait avec [+] ou le retirer avec × enregistre directement la modification.
- Survoler le panneau d’un autre joueur fait apparaître les flèches d’échange ; le bouton reste accessible au clavier et visible sur écran tactile.
- Les deux joueurs voient un popup pendant la demande, avec une barre de temps qui se vide. Le destinataire dispose de Accept / Decline, le demandeur de Cancel. La demande expire après **cinq secondes**. Sans réponse, elle est refusée ; le serveur rejette aussi les acceptations tardives.
- Les invités conservent leur pool lors d’un échange. Les comptes chargent leur liste personnelle du nouveau rôle. L’hôte peut démarrer pendant une demande : le passage en draft la supprime.
- Pendant la draft, glisser son panneau de rôle complet (icône, rôle et pseudo) vers un autre panneau ou une case alliée déplace le joueur et son champion sélectionné ; un compte charge son pool personnel du rôle cible. Si le poste est occupé, l’autre joueur doit accepter sous cinq secondes. Clic/toucher puis cible et clavier sont aussi disponibles. Glisser un portrait continue de déplacer uniquement les champions.
- Les sélecteurs de champions du lobby et de la draft proposent cinq icônes de rôle et deux icônes de tri (A–Z et popularité), sur une seule ligne. À chaque ouverture, le rôle associé est préfiltré et le tri par popularité est actif ; les bans restent tous rôles par défaut. Recliquez le rôle actif pour afficher tous les rôles. Le seuil est de 5 % des parties du champion dans le rôle ; les sélections existantes restent visibles. Sans statistiques de rôles, le repli reste tous rôles et alphabétique. Voir [les règles et la provenance](docs/ui/LIVE_ROLES_FILTERS.md).
- **Quit room** libère la participation. Si l’hôte part, le premier participant restant devient hôte. La dernière sortie supprime la salle, ses membres, son invitation et ses demandes d’échange. Fermer un onglet conserve le siège pour permettre la reconnexion ; il faut utiliser Quit pour partir.
- Le lobby et la draft permettent de préparer des candidats pour les cinq rôles alliés et les cinq adverses. Prendre un rôle remplace la liste préparée par le pool personnel du joueur, même vide. Libérer un rôle vide sa liste explicite ; le profil personnel reste intact. [+] ajoute uniquement des candidats ; dans la draft, cliquer un candidat le sélectionne, un autre le remplace et recliquer le pick le désélectionne. Les candidats restent visibles après sélection et les picks restent présents si leur candidat est retiré. Les champions pris ailleurs ou bannis sont grisés. Les invités gardent leur pool lors des échanges consentis ; les comptes chargent celui du nouveau rôle. Les dix listes survivent au passage en draft et au rechargement ; les salles temporaires peuvent être supprimées aux mises à jour. Voir [les règles et validations](docs/ui/ALL_ROLE_CANDIDATES.md).

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

1. Créer un projet Supabase neuf. Appliquer les vingt fichiers de `supabase/migrations` dans l’ordre, de `202611110001` à `202611190025`.
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

Sur la branche de scoring bidirectionnel, chaque direction conserve son atténuation `delta2 × n / (n + k)`, avec la calibration existante. Les deux directions sont ensuite consolidées par moyenne pour les synergies et demi-différence pour les matchups. Une direction manquante contribue zéro avant consolidation, sans être signalée comme une observation neutre. Le fit individuel utilise un diviseur fixe de 9 et le score d’équipe un diviseur fixe de 5. Maximiser le fit d’un candidat revient ainsi à maximiser son gain d’avantage pour son équipe, même dans une draft partielle. Best Fit accepte une direction disponible par interaction ; les seuils des picks exceptionnels sont adaptés à cette échelle fixe. Les Delta 2 et les nombres de parties bruts restent intacts. Voir [le modèle et ses propriétés](docs/statistics/BIDIRECTIONAL_SCORING.md). Ce travail local attend l’accord explicite avant tout push ou déploiement.

Les **statistiques de démonstration restent fictives**. Le catalogue de portraits n’ajoute aucune statistique. La collecte réelle tourne dans les scripts backend ; le navigateur et le moteur de scoring ne contactent jamais Lolalytics.

L’hôte peut importer des données autorisées JSON ou CSV en préparation : [exemple JSON](public/examples/dataset.json), [exemple CSV](public/examples/pairs.csv). Métadonnées requises : `id`, `patch`, `tier`, `source`, `importedAt` (ISO), `fictional` (booléen). Chaque paire contient `relation`, `candidateChampionId`, `candidateRole`, `otherChampionId`, `otherRole`, `delta2` et éventuellement `games`. Les IDs Riot sont des chaînes ; les clés de rôles dans les données sont `Top`, `Jungle`, `Mid`, `ADC`, `Support` (ADC est affiché Bottom).

Les statistiques sont stockées dans un cache partagé, découpé par champion/rôle. Chaque salle conserve uniquement une référence figée à son instantané ; le navigateur charge les fragments de ses pools et des picks affichés, puis calcule les scores en mémoire. Un nouveau candidat ou rôle peut charger un fragment supplémentaire du cache, sans appeler la source statistique. Les imports de l’interface sont limités à 12 Mo et 100 000 paires, avec validation des doublons, IDs, rôles et nombres.

Le collecteur Python extrait désormais les vrais **Delta 2 Against et Synergy**, avec les deux rôles et le nombre de parties, sans seuil de volume/popularité. Il utilise les données Qwik des pages Build et le chargement Synergy de l’interface Lolalytics. L’accès est non officiel ; les conditions restrictives de la source restent documentées. La démo synthétique reste le repli tant qu’un snapshot réel n’a pas été publié sur le cache distant.

```sh
python3 scripts/statistics/collect_lolalytics.py --all --output statistics-cache/run-2026-11-12
python3 -m unittest discover -s tests/statistics -v
```

Le pipeline produit des fragments gzip vérifiés, puis le publisher existant permet leur promotion atomique dans Supabase. La collecte est réutilisable et reprend après interruption ; aucune requête Lolalytics n’est déclenchée par un pick ou une salle. Le workflow quotidien supporte `STATISTICS_SOURCE=lolalytics` ; son activation distante reste conditionnée à `STATISTICS_REFRESH_ENABLED=true`. Le départ cible est 06:07 Europe/Zurich, avec contrôles de secours à 09:17 et 15:17. Un démarrage tardif peut rattraper la collecte ; les contrôles suivants évitent une nouvelle collecte si le snapshot couvre déjà la cible quotidienne de 06:00. Une vérification finale de fraîcheur rend les échecs visibles. [Diagnostic et correction du 17 novembre](docs/statistics/DAILY_REFRESH_RECOVERY.md). k est réévalué après 30 jours au prochain refresh réussi. Commandes, preuves et volumes réels : [pipeline réel](docs/statistics/LIVE_PIPELINE.md), [scoring et planification actuels](docs/statistics/SHRINKAGE_TEAM_SCORES.md).

## Structure

- `src/pages` : préparation et draft ; `src/components` : portraits, icônes et popup de demande.
- `src/domain` : types, invariants, poids, score et actions distinctes d’ajout de candidat / sélection de pick.
- `src/lib/rooms.ts` : Auth anonyme, RPC, Realtime et reprise canonique.
- `src/data` : catalogue, fixture synthétique et validation des imports.
- `supabase/migrations` : schéma, RLS et fonctions serveur.
- `tests` : domaine, assets, base multi-identités et parcours navigateur.

Projet communautaire non affilié à Riot Games. Les assets League of Legends appartiennent à Riot Games.

Pour les scores des picks adverses, le contexte est orienté depuis le candidat adverse (ses coéquipiers et ses adversaires). Les synergies consolidées sont symétriques et les matchups antisymétriques ; les scores des deux équipes restent calculés dans leur propre contexte. Le candidat lui-même est exclu des paires.

Pendant la draft, tous les membres peuvent modifier les candidats des dix cases via `set_role_candidates`, sans changer leurs picks. Cette RPC ne modifie que la liste ciblée et vérifie la version de la salle. En préparation, les pools incarnés restent réservés au propriétaire ou à l’hôte. L’ancienne RPC `add_draft_candidate` reste compatible avec les anciens clients.

Le lot de navigation et de consentement est décrit dans [docs/ui/DRAFT_INTERACTIONS.md](docs/ui/DRAFT_INTERACTIONS.md), avec captures et statut de livraison.
