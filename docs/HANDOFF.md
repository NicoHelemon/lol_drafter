# Passation — Draftroom / lol_drafter

> **Affinement des filtres — 14 novembre 2026 :** version `0557439` constatée en production à 21:35 UTC. Les menus sont remplacés par cinq icônes de rôle et deux de tri (A–Z / popularité), sur une seule ligne jusqu'à 320 px ; recliquer le rôle actif revient à tous les champions. Noms accessibles, infobulles, état doré et clavier vérifiés sur le service hébergé. CI de branche et de main vertes ; aucun changement de schéma supplémentaire. Voir [les preuves](ui/evidence/champion-filter-icons-production.json).

> **Rôles en draft, filtres et comparaison — 14 novembre 2026 :** échanges de rôles via sa propre icône, avec consentement à cinq secondes et conservation du champion/pool de chaque joueur ; filtre de rôle à 5 % et tri par popularité dans les sélecteurs ; comparaison explicite du score actuel et après remplacement. Migrations additives 011–012, catalogue séparé, aucun changement du calcul de score ni filtrage du corpus Against/Synergy. Validation locale : 88 tests TypeScript/PostgreSQL, 50 Python et 22 parcours navigateur. Voir [LIVE_ROLES_FILTERS.md](ui/LIVE_ROLES_FILTERS.md) pour les règles, sources et le statut de livraison. Aucun import d'image ni compte ajouté.

> **Scores ajustés et équipes — 14 novembre 2026 :** dernière demande : shrinkage appris avec k commun Against/Synergy, moyenne des scores sélectionnés par équipe, aperçu de l'effet global d'un candidat et refresh à 06:00 Europe/Zurich avec fenêtre automatique 06:00–08:00. Aucun compte/preset persistant ajouté. Voir [SHRINKAGE_TEAM_SCORES.md](statistics/SHRINKAGE_TEAM_SCORES.md). Ces décisions remplacent les restrictions historiques sur les priors et le score brut ; les observations brutes restent intactes. Migration 010 additive.

> **Changements de draft — 13 novembre 2026, branche de travail :** nouvelle demande utilisateur : candidats alliés plus petits, déplacement des picks par glisser-déposer avec consentement entre joueurs, score moyen à poids égaux et détail brut au survol. Ces décisions remplacent les anciens poids et l'ancien popup décrits historiquement ci-dessous. Voir [DRAFT_INTERACTIONS.md](ui/DRAFT_INTERACTIONS.md). Migration 009 additive, livraison groupée après validation ; le collecteur et les données brutes restent inchangés.

> **Version officielle en production — 12 novembre 2026 :** cycle de vie intégré à `main`, révision Netlify constatée, migration 008 appliquée, maintenance cron activée et parcours hébergés validés. Le propriétaire a corrigé le secret GitHub : précontrôle réel `43308157993` vert, premier passage arrêté à 520/865 sur une réponse tronquée, reprise limitée corrigée (`fd172a7`), puis passage `43311641996` réussi : 865/865 cibles, 786 720 observations et snapshot `83a505…` promu. Conservation de l’ancienne référence et adoption de la nouvelle par les salles vérifiées dans le navigateur. Le renouvellement de présence est corrigé et constaté sur le service hébergé (`2729cb3`, heartbeat HTTP 204). Voir [PRODUCTION.md](statistics/PRODUCTION.md).

> **Reprise du cycle de vie — 12 novembre 2026 :** audit depuis `ea11097`, checkout propre ; les cinq modifications de rétention de la session interrompue étaient absentes. Elles sont reconstituées et sauvegardées sur `wip/statistics-lifecycle` : 38 tests Python, 57 tests applicatifs/PostgreSQL et 11 parcours navigateur réussis, build et actionlint réussis. Le run statistique en lecture seule (`43302888389`) a terminé vert mais son audit masquait un HTTP 401 via `tee` ; ce faux positif est corrigé. Voir le statut de production pour le contrôle réel des accès. Supabase contrôlé en lecture seule : 5 salles, 865 fragments et 786 704 observations dans le snapshot courant ; 008 et pg_cron absents. Archive locale complète préservée. Aucun changement distant appliqué. Voir [LIFECYCLE.md](statistics/LIFECYCLE.md). Les paragraphes historiques ci-dessous ne remplacent pas cet état ni les dernières instructions utilisateur.

> **Publication effectuée :** les 865 fragments réels sont promus dans Supabase et leurs contenus sont vérifiés ; le code est poussé sur `main`, CI verte. Le contrôle Netlify dans le navigateur et la configuration GitHub du quotidien attendent les domaines réseau manquants. Voir le [statut de production](statistics/PRODUCTION.md).

> **Livrable actuel complet :** 865/865 couples collectés, 433 233 Against + 353 471 Synergy réels, snapshot vérifié et archive locale de 7 Mo. Voir [LIVE_PIPELINE.md](statistics/LIVE_PIPELINE.md) et [le bilan machine](statistics/full-acquisition-summary.json). 30 tests Python, 44 tests applicatifs et neuf parcours navigateur passent. Aucun push ni publication distante.

> **État courant :** le [pipeline réel Against + Synergy](statistics/LIVE_PIPELINE.md) est implémenté et testé sur de vraies réponses, avec 228 cellules Synergy comparées au navigateur. Les anciens blocages techniques et résultats limités aux mocks ci-dessous sont historiques. Aucun seuil Lane/Games/Pick n’est appliqué aux nouveaux exports.

> **Dernière décision utilisateur :** suppression des seuils indicatifs Lane/Games/Pick pour la collecte. Voir la [comparaison testée des collecteurs](statistics/COLLECTOR_REVIEW.md) : 2 518 lignes Against conservées, Hextech contrôlé sur 278 paires, Synergy testée sur mocks uniquement. Les résultats avec seuils ci-dessous sont historiques.

> **Mise à jour de reprise — 12 novembre 2026 :** voir le [POC public](statistics/PUBLIC_POC.md). Accès réseau rétabli ; 285 lignes Against réelles comparées, inspecteur expérimental testé. Synergy non collectée : avis explicite d’API privée sur `a1.lolalytics.com`. Aucun dataset publié. Les résultats ci-dessous décrivent la session antérieure.

Date : **12 novembre 2026**. État du code relu : **`d38db00ef1784e38d6941fc042732a9fa17b7f42`**, présent sur `main` avant l'ajout de ce document.

## 1. Lire ceci avant de reprendre

Le produit est un assistant de draft League of Legends collaboratif, avec préparation des pools puis suivi manuel des picks/bans. L'interface et le moteur de score existent. Le cache statistique partagé et le pipeline d'import existent aussi. **Aucun vrai Delta 2 Lolalytics n'a encore été extrait ni comparé au site dans cette session. Les statistiques de démonstration sont fictives.**

La prochaine étape de fond est un **petit POC expérimental sur trois couples champion/rôle**, pour établir où les vrais Delta 2 Against et Synergy sont accessibles, avec quels filtres et combien de lignes/requêtes. Il faut résoudre cette inconnue avant une collecte exhaustive. Le dernier obstacle constaté venait du proxy de l'environnement Codex, pas d'une réponse du serveur Lolalytics.

La demande qui a produit cette passation était strictement documentaire : **créer uniquement `docs/HANDOFF.md`, puis commit et push ; aucune modification fonctionnelle**. Elle n'autorise pas à reprendre automatiquement des migrations, une collecte ou un déploiement de configuration pendant sa rédaction. Dans la prochaine tâche, appliquer la nouvelle demande de l'utilisateur en s'appuyant sur ce contexte.

### Sources et limites de mémoire

Cette passation repose sur les messages utilisateur encore accessibles, le contexte de continuité conservé, les résultats d'opérations encore visibles et une relecture du dépôt. Ce n'est pas un verbatim intégral de toutes les anciennes réponses et sorties d'outils : **une partie des échanges anciens n'est plus disponible mot pour mot**. Les résultats historiques sont identifiés comme tels ; ils ne sont pas présentés comme des tests rejoués pour cette modification documentaire.

Le fichier initial téléversé s'appelait `LOL_Draft_Assistant_Codex_Spec_V2.md`. La référence versionnée disponible est [SPEC_V2.md](SPEC_V2.md) ; l'identité exacte entre l'upload original et ce fichier n'a pas été réétablie lors de cette passation. Un texte collé ultérieur, fourni comme nouvelle demande, a réorienté l'acquisition statistique ; son intention et ses contraintes sont restituées ci-dessous. Le rapport antérieur que ce texte critiquait n'est pas disponible ici comme document autonome complet : ne pas en inventer les formulations ou conclusions.

Ordre de lecture recommandé :

1. Cette passation pour les décisions transversales et les limites de preuve.
2. [Rapport d'acquisition](statistics/REPORT.md) et [journal du premier probe](statistics/source-probe-2026-11-12.json).
3. [README](../README.md), [recette fonctionnelle](ACCEPTANCE.md), [provenance des assets](ASSETS.md).
4. [Spec V2](SPEC_V2.md) pour le modèle initial et la formule de score, en tenant compte des demandes ultérieures qui l'ont remplacée sur plusieurs points d'interface.

**Les dernières instructions explicites de l'utilisateur priment sur les passages devenus historiques de la spec.** Le fait qu'un comportement soit codé ne transforme pas un écart éventuel en décision utilisateur.

## 2. Projet, services et vocabulaire

| Élément | État / rôle connu |
| --- | --- |
| Dépôt | `NicoHelemon/lol_drafter`, branche de production `main` |
| Checkout de la session de rédaction | `/workspace/lol_drafter`, branche locale `work` ; ne pas supposer ce nom de branche dans une nouvelle machine |
| Application | **Draftroom**, interface en anglais, échanges avec l'utilisateur en français |
| URL utilisateur actuelle connue | `https://draftroom-lol.netlify.app` |
| Ancien nom Netlify | `lighthearted-nasturtium-522765` ; nom automatique initial, remplacé dans les captures suivantes |
| Livraison frontend | Netlify relié à GitHub, auto-publication de `main` observée dans les captures initiales |
| Projet Supabase vérifié antérieurement | Référence **`zsmpdkjfjqgtjinzoexv`**, nom **`NicoHelemon's Project`**, état `ACTIVE_HEALTHY` au contrôle précédent |
| URL publique Supabase correspondante | `https://zsmpdkjfjqgtjinzoexv.supabase.co` ; ce n'est pas une preuve d'accessibilité depuis une nouvelle session |
| Environnement de travail Codex | Configuration nommée **`lol_drafter`**, distincte des services hébergeant l'application |

Le dépôt contient le code. L'environnement Codex décrit les dépôts, logiciels, variables et règles réseau, ainsi que l'environnement préparé réutilisable. Son **brouillon**, sa **version publiée** et la **machine actuellement attachée au chat** sont des états distincts. Le chat porte la conversation ; une nouvelle session ne récupère pas nécessairement tout son historique. La publication Codex prépare les tâches cloud ; les changements de code du site suivent GitHub → Netlify. Les migrations Supabase modifient encore un autre service.

Le dernier push de code confirmé avant cette passation était `d38db00` sur `main`. **La réussite du build local et du push n'a pas été suivie d'une vérification indépendante du dernier déploiement Netlify.** Ne pas déclarer le dernier bundle en production sans le constater.

## 3. Décisions fonctionnelles à conserver

### Style et simplicité

- Toute l'interface doit être **en anglais**. L'utilisateur préfère une présentation sobre et compacte.
- Supprimer les slogans et formulations marketing du type « Seulement votre pool. Seulement le contexte. » ou « Le bon pick, dans le bon contexte ».
- Ne pas afficher « V1 » ni le vocabulaire « Delta 2 score » dans le produit : présenter simplement un **score**. Le nom technique `delta2` reste pertinent dans les données, les outils et la documentation.
- Ne pas réintroduire `My role`, `Available` pour un siège libre, les initiales de rôle T/J/M/A/S, le bouton `Pool · x champions`, `Save pool`, `Ready`, `End room`, `Unassigned role` ou un panneau latéral `Recommendations`.
- Les cinq postes sont **Top, Jungle, Mid, Bottom, Support**. Les données conservent la clé historique **`ADC`**, traduite en **Bottom** par `roleName` ; ne pas renommer aveuglément toutes les clés persistées.

### Préparation et démarrage

- Deux étapes et URL distinctes : `/rooms/:slug/setup`, puis `/rooms/:slug/draft`. `State.phase` vaut `setup` ou `live`.
- Choisir un rôle libre via **Join**, dans sa case. Un participant peut ne pas avoir encore choisi de rôle ; les **picks**, eux, doivent toujours en avoir un.
- Pools initialement **vides**. Les trois champions de démonstration utilisés pour générer des statistiques synthétiques ne sont pas des presets de pool proposés aux joueurs.
- Portraits de pool agrandis, bouton carré **[+]** de même taille pour ajouter, petite **×** en haut à droite pour retirer. Enregistrement direct, sans bouton de sauvegarde.
- **L'hôte démarre quand il le décide** : pas d'état Ready, pas d'obligation de remplir les cinq sièges, les pools ou des sélections. Ne pas recréer un verrou de préparation sous prétexte de chargement des données.
- Cadre doré du rôle personnel épaissi à **3 px**. Panneau de participants stylisé avec **N/5**, noms et badge **HOST**, sans répéter les postes dans ce panneau.
- La salle porte le nom du créateur, par exemple **Nico's room**, et un slug lisible, par exemple `nicos-room`. Les doublons reçoivent un suffixe numérique. UUID conservé comme identifiant interne. Le code actuel conserve le nom d'origine lors d'un transfert d'hôte.

### Rôles et échanges

- Proposer un échange en survolant le panneau occupé d'un autre participant : grandes doubles flèches, contenu du rôle visible en transparence derrière. Accès clavier et tactile aussi prévu.
- **Consentement obligatoire** : le demandeur voit un popup d'attente avec le pseudo cible et **Cancel** ; le destinataire voit **Accept / Decline**.
- Les deux popups montrent une barre de temps qui se vide. Délai **5 secondes** ; sans réponse, refus et disparition. Le serveur vérifie aussi l'expiration ; une page suspendue ou rechargée ne permet pas une acceptation tardive.
- Les pools appartiennent aux participants : ils restent avec leur propriétaire quand les rôles sont échangés.
- Un démarrage de draft annule les demandes en attente. Les rôles des participants sont ensuite verrouillés ; les déplacements de **picks** restent possibles.

### Draft : distinguer deux types de postes

| Poste | Comportement voulu et implémenté |
| --- | --- |
| Ennemi, ou allié sans participant associé | Un [+] tant qu'il est vide. Le premier choix devient le pick effectif et remplace le [+]. Cliquer le portrait ouvre son remplacement. Retirer le pick rétablit [+]. Pas de liste de candidats pour ce poste. |
| Allié associé à un participant | Afficher le pool comme candidats, plus [+]. [+] ajoute des candidats **sans effectuer ni modifier le pick**. Cliquer un candidat le sélectionne ; recliquer le même le désélectionne ; cliquer un autre remplace la sélection. Les candidats restent dans le pool. |

- **Le pick sélectionné reste toujours le premier**, quel que soit son score. Ce choix d'affichage prime sur le classement statistique.
- Le nom du participant associé apparaît sous le rôle, par exemple `Jungle` puis `Mathis`.
- Les champions bannis ou déjà sélectionnés ailleurs restent visibles dans les candidats mais grisés et désactivés. Le pick de la case reste utilisable pour sa propre désélection/remplacement.
- Tableau de draft sur toute la largeur. Bans immédiatement sous **Draft board**, avant les lignes. Recommandations intégrées aux cases de choix, sans sidebar dédiée.
- Score en surimpression sur les portraits, y compris les picks effectifs des deux équipes. Clic sur le score : contributions et couverture. Donnée insuffisante : **N/A**, jamais valeur inventée.
- Déplacements des picks entre rôles conservés. Si un rôle est déjà occupé dans la même équipe, déplacement/échange sans perdre l'autre pick. Un test important est **Jhin Bottom → Jungle, puis Caitlyn Bottom**.

### Salles temporaires et accès

- Bouton **Quit**, avec confirmation dans l'implémentation actuelle ; pas de commande End room.
- Quit libère la place. Si l'hôte part, le premier participant restant devient hôte. Le dernier Quit supprime la salle, ses membres, l'invitation et les demandes d'échange associées.
- Fermer un onglet ne vaut **pas** Quit : le siège reste pour la reconnexion. Il n'y a pas de preuve d'une purge automatique des salles abandonnées après fermeture de tous les onglets. Ne pas promettre ce comportement.
- Les instantanés statistiques partagés et les identités Auth ne sont pas des données propres à une salle ; ils ne sont pas effacés par son dernier Quit.
- L'utilisateur a explicitement demandé de **ne pas compliquer les évolutions pour préserver les anciennes versions de salles** : elles sont créées et détruites rapidement. Cela ne commande pas de supprimer systématiquement les salles existantes à chaque changement.
- Pseudonyme et identité Supabase anonyme, sans compte imposé aux visiteurs. Un ancien blocage « This site is private / Sign in to Netlify » venait de la protection d'accès Netlify : régler la visibilité de production sur **Public** pour cet usage. Vérifier le réglage réel si le problème revient ; ne pas développer un contournement dans l'application.

## 4. Raisonnement du score : stable, simple, explicable

Le classement utilise **uniquement les vrais deltas pairwise normalisés quand ils sont disponibles**, dans la direction du candidat et de son rôle. Il reste une moyenne pondérée contextuelle, **pas une probabilité absolue de victoire**.

```text
score = somme(poids de la relation × delta2 observé)
        / somme(poids des seules relations effectivement observées)
```

- Relations : candidat contre cinq rôles ennemis (`vs`), et avec quatre autres rôles alliés (`with`).
- Unité : **points de pourcentage**, par exemple `1.25`, pas `0.0125`.
- Absence de paire ou `delta2: null` : exclure du numérateur ET du dénominateur. Aucune paire observée → `null` / N/A. Un vrai zéro est une observation connue.
- Pas de symétrie ni d'inversion supposée entre deux champions, directions, équipes ou rôles. Les scores ennemis sont calculés depuis le candidat ennemi, avec ses propres alliés/adversaires, en excluant les auto-paires.
- Aucun winrate de base, prior, score AD/AP, heuristique de composition, méta, modèle génératif, ML, Monte Carlo, MCTS, minimax ou prédiction des prochains picks à ajouter.

Poids centralisés dans [weights.ts](../src/domain/weights.ts) :

| Rôle candidat | Pondération |
| --- | --- |
| Top | `vs Top = 0.4` ; chacune des huit autres relations = `0.2` |
| Support | `vs Support = 0.3`, `vs Bottom = 0.3`, `with Bottom = 0.3` ; chacune des six autres = `1.1 / 6` |
| Jungle, Mid, Bottom | Chacune des neuf relations = `2 / 9`, choix **provisoire** déjà présent |

Chaque somme théorique de poids vaut 2 en contexte complet ; le dénominateur réel dépend des observations disponibles. Les coefficients exacts sont conservés dans le code et la spec, mais le raisonnement initial qui a conduit à chacun n'est pas intégralement accessible : **ne pas présenter ces valeurs comme apprises, optimales ou statistiquement validées**. Le moteur et les poids n'ont pas été modifiés par la mise en place du cache statistique.

## 5. Architecture actuelle : où intervenir

React 19, TypeScript, Vite, Supabase JS. Frontend statique Netlify ; les scripts Python tournent hors du navigateur et du bundle frontend.

| Fichier / répertoire | Responsabilité |
| --- | --- |
| [App.tsx](../src/App.tsx) | Orchestration, URL de salle, état, sélecteurs, import, mutations, notifications d'échange |
| [SetupPage.tsx](../src/pages/SetupPage.tsx) | Postes, pools, Join, échange, réglages du dataset |
| [DraftPage.tsx](../src/pages/DraftPage.tsx) | Tableau intégré, bans, candidats/picks et détail des contributions |
| [domain/types.ts](../src/domain/types.ts) | `Role`, `Pair`, `Dataset`, `Player`, `Pick`, `State`, `Room` |
| [domain/scoring.ts](../src/domain/scoring.ts) | Score, clés directionnelles, couverture et classement de base |
| [domain/candidates.ts](../src/domain/candidates.ts) | Score orienté selon l'équipe, blocage des candidats, priorité du pick sélectionné |
| [domain/state.ts](../src/domain/state.ts) / [domain/draft.ts](../src/domain/draft.ts) | Invariants, déplacement des picks, ajout et sélection/désélection des candidats |
| [lib/rooms.ts](../src/lib/rooms.ts) | Auth anonyme, RPC, lecture canonique, Realtime, cache statistique et Quit |
| [data/provider.ts](../src/data/provider.ts) | Catalogue, `PairwiseDataProvider`, démo déterministe fictive et état initial |
| [data/import.ts](../src/data/import.ts) | Validation des imports JSON/CSV ; aucun calcul de delta depuis un winrate |
| [data/shared.ts](../src/data/shared.ts) | Hydratation des fragments, cache par instantané et retrait des paires avant sauvegarde |
| [scripts/statistics](../scripts/statistics) | Probe public, normalisation/validation, instantanés compressés, publication et rafraîchissement générique |
| [supabase/migrations](../supabase/migrations) | Schéma, droits, RPC et cache partagé ; lire avant toute intervention distante |

### Synchronisation et permissions

- Supabase est la source canonique. `save_room` reçoit `expected_version` et rejette les écritures obsolètes ; pas de fusion silencieuse d'états concurrents incompatibles.
- RLS limite les lectures des salles à leurs membres ; les écritures passent par des RPC validées. Invitation privée par jeton dans le fragment `#` de l'URL, dont le hash SHA-256 est conservé côté base. **Ne jamais copier un vrai lien d'invitation ou son jeton dans cette documentation.**
- Realtime déclenche une relecture canonique. Relecture/heartbeat de secours toutes les 20 s ; présence rafraîchie séparément, seuil de visibilité d'environ 65 s. Les échanges sont interrogés chaque seconde ; la barre du popup est mise à jour côté client.
- L'hôte seul démarre, change le côté et choisit un autre dataset en préparation. Le dataset est verrouillé après démarrage.
- Les membres peuvent entrer les picks/bans et ajouter des candidats pendant la draft via la RPC dédiée `add_draft_candidate`, sans toucher au pick. Ce droit n'élargit pas arbitrairement la modification générale des pools des autres joueurs.
- Nuance à conserver : l'UI de préparation édite le pool du joueur connecté ; les permissions serveur de l'hôte sont plus larges. Une interface d'édition des pools d'autrui par l'hôte n'est pas démontrée comme disponible dans cette vue.

### Démo locale

Sans `VITE_SUPABASE_URL` et `VITE_SUPABASE_ANON_KEY`, l'application utilise un mode local, identité `local-player`, salle dans `localStorage`. Ce mode ne synchronise pas plusieurs appareils. Il peut conserver son dataset complet dans le stockage du navigateur : **la suppression du dataset inline concerne les états de salle Supabase**, pas une refonte du mode démo local.

## 6. Cache partagé : implémenté, sans source réelle validée

La migration **007** a remplacé le stockage répétitif du dataset dans chaque salle par :

- `statistics_snapshots` : identité, métadonnées et indicateur `ready` ;
- `statistics_shards` : paires regroupées sous une clé telle que `58:Top` ;
- `statistics_current` : pointeur vers la source quotidienne à utiliser pour les **nouvelles** salles lorsqu'elle existe.

Un trigger déporte automatiquement les imports inline validés dans le cache partagé. La salle conserve les métadonnées, `snapshotId` et `pairs: []`. Les instantanés prêts sont immuables, y compris contre des modifications administratives accidentelles ; les incomplets sont cachés aux clients. Les lectures des statistiques partagées sont accessibles aux identités `authenticated`, y compris Auth anonyme ; ces statistiques ne sont pas des secrets propres à une salle.

Le client charge seulement les fragments nécessaires aux pools ayant un rôle et aux picks affichés, par lots d'au plus **40 clés**. Le cache en mémoire est indexé par **instantané + champion + rôle**, et ne mélange jamais deux instantanés. Avant sauvegarde d'un état, `persistedState` enlève les paires hydratées. Un rafraîchissement quotidien ne change pas le dataset d'une salle déjà créée.

Arbitrage important : un pick/ban réutilise les données chargées et le score est recalculé localement. Un candidat ou rôle nouveau, ou un pick anonyme nouvellement saisi, peut demander un fragment supplémentaire au **cache Supabase**. Cela ne doit jamais déclencher une requête vers Lolalytics. L'objectif économique porte sur la source, sans promettre zéro accès Supabase lors de toute action.

Le pipeline produit des fichiers **gzip** comme artefacts portables ; **l'intégration frontend actuelle lit des fragments JSONB via PostgREST**. Il n'existe pas de distribution gzip par CDN déployée et vérifiée dans ce travail. Les empreintes des imports SQL et celles du builder Python sont calculées à partir de représentations distinctes ; ne pas supposer qu'un export passant par les deux voies reçoit nécessairement la même identité. Chaque voie conserve l'immutabilité de ses références.

L'absence de `statistics_current` provoque le choix de la démo pour une nouvelle salle. L'existence d'un snapshot `ready` ne garantit pas que les données sont réelles : les imports/démos portent aussi un indicateur `fictional`. Ne pas confondre **cache prêt** et **source Lolalytics validée**.

## 7. État des migrations et services distants

| Migration | Fonction principale / particularité |
| --- | --- |
| `202611110001_draftroom.sql` | Tables initiales, Auth/RLS, validation et RPC |
| `202611110002_room_lifecycle.sql` | Ancienne évolution du cycle de vie |
| `202611110003_role_swaps.sql` | Infrastructure d'échange de rôles |
| `202611110004_ephemeral_rooms.sql` | Salles nommées/temporaires, expiration 5 s, suppression d'End room/Ready ; **contient `delete from public.rooms`** |
| `202611110005_assigned_picks.sql` | Obligation d'un rôle pour chaque pick |
| `202611110006_draft_candidates.sql` | Ajout transactionnel de candidat sans sélectionner de pick |
| `202611120007_shared_statistics.sql` | Cache partagé et déport des datasets, sans suppression des salles |

**Ne pas rejouer 004 ni l'ensemble des migrations sur le projet existant.** Sur un projet neuf seulement, appliquer les fichiers dans l'ordre. Sur l'existant, inspecter le schéma et appliquer uniquement de nouvelles migrations nécessaires. Le dossier de migrations n'est pas à lui seul la preuve d'un historique de déploiement suivi par un outil de migration distant.

Les migrations 005 et 006 ont été appliquées directement lors des travaux précédents. La migration **007 a été appliquée via l'API d'administration Supabase pendant la mise en place du cache**. Le contrôle distant alors enregistré dans le rapport indiquait : **4 salles conservées, 0 salle avec paires inline, 1 snapshot partagé prêt, 15 fragments, 0 pointeur vers une source réelle**, RLS actif sur les trois nouvelles tables. Ce sont des **mesures historiques du 12 novembre**, pas une garantie des comptes actuels.

L'utilisateur a demandé que Codex prenne en charge les changements Supabase autorisés plutôt que de lui faire copier des scripts SQL à chaque fois. Un jeton de gestion a été fourni par les paramètres de l'environnement sous **`SUPABASE_ACCESS_TOKEN`**. Vérifier sa disponibilité et sa portée sans afficher sa valeur, puis vérifier le **bon projet avant toute écriture**. Le fait qu'il ait fonctionné ici ne prouve pas qu'il sera injecté dans une nouvelle machine.

Configuration frontend : `VITE_SUPABASE_URL` et `VITE_SUPABASE_ANON_KEY` sont des valeurs publiques de projet ; la clé doit être anon/publishable, jamais `service_role` ou un jeton de gestion. Le problème initial « Anonymous sign-ins are disabled » nécessitait l'activation d'Auth anonyme dans Supabase. Ne pas redemander un compte utilisateur comme solution par défaut.

## 8. Acquisition Lolalytics : la demande précise et son raisonnement

L'utilisateur a d'abord demandé un **rapport sans modifier le projet**, pour discuter des difficultés avec un autre chat. Il a ensuite fourni un nouveau texte contenant explicitement une **demande de POC et de pipeline**. Ce texte a élargi le périmètre et remplacé le mode « rapport seulement » de cette étape antérieure. La présente demande, elle, revient à un périmètre documentaire uniquement.

Le changement d'approche voulu : **ne plus transformer des inconnues d'extraction en impossibilités supposées**. Démontrer sur quelques pages, mesurer, puis dimensionner. Le blocage de l'environnement n'a pas empêché de développer et tester le pipeline générique, mais cela **ne remplace pas** la preuve de lecture des vrais chiffres.

### Contexte fixe des données

| Paramètre | Valeur demandée |
| --- | --- |
| Rang | Emerald+ |
| Région | Global |
| File | Ranked Solo/Duo |
| Fenêtre | 14 derniers jours, glissante |
| Min Lane % | 2 |
| Min Games | 100 |
| Min Pick % | 0 |
| Indicateur | Delta 2 exclusivement, Against et Synergy, en points de pourcentage |

Ne pas reconstruire le Delta 2 à partir des winrates bruts. Le seuil de 100 parties est un point de départ retenu, **pas une garantie de fiabilité statistique**. Conserver les nombres de parties. Un instantané quotidien des 14 derniers jours est une fenêtre glissante ; il ne représente pas chaque jour un ensemble indépendant de nouvelles observations.

La déclaration de `context` dans un JSON ne démontre pas que le site appliquait réellement ces filtres. Les pourcentages de lane/pick ne peuvent pas être revérifiés depuis un export qui ne les contient pas : le futur adaptateur doit établir leur application à la source. Les noms des paramètres d'URL et la correspondance Emerald+/14 jours doivent être constatés, pas devinés. La version du catalogue de portraits n'est pas le contexte statistique.

### Volume des données ≠ nombre de requêtes

Pour 173 champions et cinq rôles, en excluant un même champion face à lui-même :

```text
173 × 5 × 172 × (5 rôles ennemis + 4 autres rôles alliés)
= 1 339 020 relations directionnelles potentielles
```

Ce nombre est une borne de **relations**, pas une prévision de requêtes HTTP. Si une page par champion/rôle contenait les deux matrices utiles, **173 × 5 = 865 pages** serait un scénario optimiste ; **cela n'a pas été démontré**. Groupes, sections, pagination et rôles effectivement joués peuvent changer le coût. Extraire toute une liste d'une page quand elle est disponible, dédupliquer, exclure les combinaisons marginales à partir de preuves source et mesurer le nombre réel de requêtes.

Les rôles/classements statiques Riot tels que mage/fighter ne correspondent pas aux postes Top/Jungle/Mid/Bottom/Support. Ils ne justifient pas d'interdire des picks ou swaps atypiques. Une donnée atypique manquante donne simplement une couverture incomplète.

## 9. Essais effectués, résultats et échecs

| Essai | Résultat constaté | Ce que cela ne prouve pas |
| --- | --- | --- |
| Lecture GitHub de `xPerSki/lolalytics-api` | Code accessible et lu, copie épinglée au commit `3f40f7f57491921a96c21b4bf51c0282f9709e56` | Que ses appels marchent sur le site actuel ou extraient les deux matrices |
| Accès public Lolalytics par curl | Refus du tunnel `CONNECT`, HTTP 403 du proxy de l'environnement | Une réponse anti-bot ou une interdiction du site |
| Accès public par Python `urllib` | `Tunnel connection failed: 403 Forbidden` sur `robots.txt`, arrêt avant pages statistiques | Que Python, requests ou un navigateur soient intrinsèquement inadaptés |
| Vérifications après annonces de changement/publication d'environnement | Même ancienne politique active et même refus ; dernier probe visible daté du **12 novembre à 12:25:59 UTC** | Que la publication déclarée par l'utilisateur ait échoué partout ou que la prochaine machine ait la même politique |
| Pipeline sur fixture de 3 couples | 9 lignes, 3 fragments, 6 valeurs connues dont 3 zéros, 3 nulles ; JSON 1 240 octets, gzip 506 octets hors manifeste | Une collecte réelle, sa couverture, son débit ou son taux de compression à grande échelle |
| Tests SQL locaux | Droits, conflits, expiration, déport des statistiques et publication atomique testés via PGlite | Un test Realtime hébergé à cinq navigateurs |
| Application de 007 à Supabase | Tables/trigger appliqués et contrôle distant des comptes/RLS | Un déploiement Netlify effectivement observé ou une source réelle disponible |

### Ce qu'apporte réellement le wrapper

Il utilise `requests.get` et `lxml.html`, avec des XPath absolus fragiles. `get_counters` lit des noms et winrates ; `matchup` lit winrate et nombre de parties ; `get_champion_data` expose entre autres un champ `wr_delta`. **Aucun de ces constats n'établit une extraction des Delta 2 Against et Synergy demandés**. Ne pas assimiler `wr_delta` à une paire Delta 2 sans vérification.

Le code est MIT, avis conservé dans [xPerSki-LICENSE.txt](statistics/xPerSki-LICENSE.txt). Le projet livré utilise ses pistes de méthode, pas un adaptateur Delta 2 validé dérivé de ses fonctions. Réutiliser du code substantiel implique de respecter la licence ; la licence du wrapper **n'accorde aucun droit sur les données Lolalytics**.

La spec historique et le texte transmis mentionnent des éléments textuels publics et un avis d'API privée sur `a3.lolalytics.com`. La présente session n'a pas pu les relire ni reproduire ces observations directement à cause du réseau. Le statut juridique et technique courant reste à établir. Ne pas appeler l'API privée en prétendant qu'elle est publique et ne pas extrapoler cette restriction à toute lecture publique sans vérifier les conditions applicables.

### Ce qui n'a jamais été établi ici

- Présence des nombres Against et Synergy dans le HTML initial, un JSON incorporé ou seulement un rendu dynamique.
- Structure actuelle des pages Build/Counter/Synergy et URL exacte d'une éventuelle vue Synergy indépendante.
- Besoin réel de Playwright, de requests ou d'un autre mécanisme autorisé.
- Table complète ou sous-ensemble, pagination, groupes par rôle et nombre de lignes récupérables par page.
- Correspondance de valeurs numériques source ↔ export pour les filtres imposés.
- Existence d'un accès officiel utilisable répondant à ce besoin et autorisation de collecte exhaustive quotidienne.

## 10. Scripts livrés : capacités et limites exactes

Tous utilisent la bibliothèque standard Python, hors frontend.

| Programme | Opérationnel | Limite importante |
| --- | --- | --- |
| [probe.py](../scripts/statistics/probe.py) | Petit essai HTTPS des deux domaines publics, robots, sauvegarde HTML, tailles/empreintes/durées et inventaire de tables/scripts JSON ; arrêt sur échec, pas de redirection automatique, cadence 1 s entre accès | **Ce n'est pas un extracteur numérique validé.** `verifiedObservations` reste volontairement à zéro. Au plus 9 URL supplémentaires ; ne pas les inventer. |
| [pipeline.py](../scripts/statistics/pipeline.py) | Validation d'un JSON, context exact, IDs/relations/rôles, doublons, nombres, min 100 parties ; shards gzip, manifeste SHA-256 et pointeur local atomique | Reçoit déjà des paires normalisées ; ne sait pas les tirer des pages. Limite 2 millions de lignes, sans benchmark à ce volume. |
| [publish.py](../scripts/statistics/publish.py) | Vérifie tout le snapshot local, écrit les fragments via l'API de gestion Supabase puis promeut dans une transaction finale vérifiant les comptes ; reprise d'un envoi interrompu | Refuse `fictional: true` et exige des observations des deux relations, mais ces vérifications ne prouvent pas la fidélité d'un adaptateur source. |
| [refresh.py](../scripts/statistics/refresh.py) | Télécharge un export JSON HTTPS autorisé, contrôle la date (48 h maximum, tolérance de 5 min dans le futur), construit/publie | **Refuse actuellement les URL Lolalytics** tant qu'adaptateur et droit de collecte ne sont pas vérifiés ; aucun collecteur Lolalytics quotidien n'est caché derrière ce script. |

Le builder maintient le dernier pointeur local valide en cas d'échec. La publication distante ne remplace `statistics_current` qu'après la transaction finale. Les salles existantes restent épinglées à leur référence. Ne pas effacer les snapshots encore référencés par des salles.

Le scénario synthétique documenté dans [synthetic-poc.json](statistics/synthetic-poc.json) couvre Renekton Top (`58`), Ahri Mid (`103`) et Jhin Bottom (`202`). **`0`, `-1.25` et `null` dans ces tests sont fabriqués.** Ne jamais changer leur provenance pour les présenter comme résultats réels ; le changement de flag effectué dans certains tests de publication concerne uniquement leur base/faux exécuteur isolés.

### Automatisation quotidienne

[statistics.yml](../.github/workflows/statistics.yml) propose **06:17 UTC**, avec concurrence limitée à un rafraîchissement. La planification est désactivée sauf `STATISTICS_REFRESH_ENABLED=true` dans les variables GitHub. Le lancement manuel existe aussi, mais nécessite des paramètres valides.

- Secret GitHub `STATISTICS_IMPORT_URL` : export autorisé, déjà dans le contrat attendu.
- Secret GitHub `SUPABASE_ACCESS_TOKEN` : jeton administratif, exclusivement backend/outils.
- Variable GitHub `SUPABASE_PROJECT_REF` : projet cible.
- Variable GitHub `STATISTICS_REFRESH_ENABLED` : activation explicite après validation de la source.

Ces paramètres GitHub ne sont pas automatiquement alimentés par ceux de la machine Codex ou de Netlify. **Ils n'ont pas été vérifiés comme configurés**, et aucune collecte quotidienne réelle réussie n'a été observée. L'activation ne doit pas précéder le POC et la vérification des conditions d'accès.

## 11. Réseau Codex et problème d'interface à ne pas réexpliquer comme un fait certain

L'utilisateur a finalement trouvé une vue avec **Modifier l'environnement / Enregistrer et publier** et a déclaré avoir ajouté les deux domaines puis publié. De notre côté, les outils avaient enregistré dans le brouillon :

```text
api.supabase.com
lolalytics.com
www.lolalytics.com
```

Les presets existants, notamment les gestionnaires de paquets et GitHub, étaient conservés. Le dernier contrôle de la machine de ce chat, y compris au début de cette passation, montrait encore : **réseau restreint, politique appliquée, observations courantes, seulement `api.supabase.com` dans la liste personnalisée**. GitHub restait disponible via le preset. L'instance rapportait toujours sa révision active antérieure.

Il faut conserver trois niveaux de preuve :

1. **Confirmé** : domaines présents dans le brouillon lié au chat.
2. **Déclaré par l'utilisateur** : publication effectuée dans l'interface.
3. **Confirmé dans cette machine** : ancienne politique toujours active, probe refusé. La dernière version publiée globale n'a pas été vérifiée indépendamment comme attachée à cette instance.

Des indications de navigation de l'assistant se sont révélées erronées : le menu du titre affichait seulement **Renommer / Copier / Archiver** ; il ne donnait pas accès aux réglages. Le panneau **Sorties** n'était pas celui de l'environnement. **La cause exacte de l'absence du bouton dans une vue et de sa présence dans l'autre n'est pas connue**. Ne pas l'expliquer comme un comportement normal prouvé de tous les chats ni comme un bug identifié.

La solution proposée était une nouvelle tâche avec l'environnement `lol_drafter` publié et ce dépôt. Elle permet de tester une machine issue de la nouvelle configuration ; elle n'a pas encore été exécutée ni validée ici. Aucun outil disponible ne permettait de rattacher/reconfigurer directement cette instance ; ne pas inventer de lien interne, de bouton ou d'API de publication.

À la reprise, redécouvrir l'environnement sélectionné avec l'outil de statut, sans réutiliser un ancien identifiant. Lire les instructions cloud pertinentes, inspecter la politique active et faire une **nouvelle connexion** après un changement effectivement appliqué. Conserver les proxies et la vérification TLS. Un refus explicite de destination se résout par la configuration autorisée, pas par un proxy alternatif ou un miroir pour contourner la règle. Ne pas refaire des essais inchangés en boucle et ne pas demander un nouveau secret pour un blocage de domaine.

## 12. Plan de reprise recommandé : première preuve réelle avant extension

### A. Réunir des preuves d'accès

1. Lire cette passation et le rapport, vérifier le checkout/HEAD et les éventuels changements utilisateur.
2. Vérifier les domaines **actifs** de la nouvelle machine et les éventuels états de disponibilité. Le brouillon seul ne suffit pas.
3. Exécuter le probe public existant. Si le tunnel est encore refusé, rapporter la politique et le refus précis ; ne pas attribuer cela à Lolalytics.
4. Une fois le site accessible, vérifier les règles publiques pertinentes. Un `robots.txt` permissif ne suffit pas à démontrer une autorisation de réutilisation exhaustive ; distinguer essai technique limité et service de collecte quotidien.

### B. POC sur trois couples

1. Prendre **Renekton Top, Ahri Mid, Jhin Bottom**, rôles distincts, pour commencer.
2. Dans le site, constater Emerald+, Global, Solo/Duo, 14 jours, Min Lane 2, Min Games 100, Min Pick 0. Conserver les URL réellement utilisées, dates et captures/HTML autorisés.
3. Examiner le HTML initial et les scripts JSON. Si les nombres ne s'y trouvent pas, examiner le rendu navigateur et le mécanisme de chargement avec des outils autorisés. **Ne présumer ni requests suffisant, ni Playwright obligatoire, ni API interne nécessaire.**
4. Pour chaque couple, relever de vrais Delta 2 Against et Synergy, les deux rôles, les IDs/noms et le nombre de parties. Identifier les colonnes et éventuellement les tooltips ; la présence d'un titre « Delta 2 » ne valide aucune ligne numérique.
5. Comparer plusieurs valeurs à l'affichage avec exactement les mêmes filtres. Vérifier des rôles différents, des absences et un zéro réel si présent ; ne pas fabriquer un zéro pour satisfaire un test.
6. Compter les lignes par page, groupe et relation, la pagination et les requêtes supplémentaires. Identifier la couverture réellement disponible, y compris les rôles marginaux filtrés.
7. Implémenter seulement alors un petit adaptateur à partir de la structure observée. Conserver de petites fixtures source autorisées et des tests liant une ligne source au tuple normalisé attendu. Documenter aussi les cas non extractibles.

### C. Brancher la source vérifiée

1. Produire le JSON de paires avec `context` exact et une provenance/date honnêtes ; conserver l'indicateur et les nombres de parties, sans reconstruire les deltas.
2. Le faire passer par le pipeline existant, comparer quelques lignes du snapshot à la source et tester la fidélité, pas seulement la forme JSON.
3. Établir les conditions de collecte/réutilisation et un débit approprié avant extension ; la licence MIT du wrapper est une question distincte.
4. Établir les couples/rôles réellement utiles et le nombre d'accès mesuré avant de lancer un balayage global. Réutiliser toute table complète récupérée en un accès.
5. Publier par le mécanisme de snapshots, vérifier la référence d'une nouvelle salle et le maintien de celle d'une salle en cours. Tester une actualisation défaillante.
6. Activer la planification seulement avec source, paramètres et accès vérifiés. Si la collecte Lolalytics voulue n'est pas autorisée, conserver l'import et le pipeline génériques pour une source autorisée, en exposant clairement la limitation.

**Ne pas profiter de cette reprise pour refaire le scoring ou l'UI collaborative.** Le périmètre de l'acquisition permet les seules adaptations de chargement nécessaires ; les changements d'interface éventuels doivent être motivés par une nouvelle demande.

## 13. Exécution locale et validations : ce qui a effectivement passé

Référence technique utilisée : **Node 24, npm 11, Python 3.12**. Le code Python n'ajoute pas de dépendances tierces. Les tests TypeScript incluent un test de publication qui appelle aussi `python3` ; ce binaire est donc utile même pour `npm test`.

```sh
# Depuis la racine réelle du checkout ; installer seulement si nécessaire
npm ci
npm run dev
npm test
npm run build

# Suite Python séparée
python3 -m unittest discover -s tests/statistics -v

# Parcours navigateur
PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/usr/bin/chromium npm run test:e2e
# Autre environnement : installer Chromium par le mécanisme Playwright prévu,
# puis npm run test:e2e, plutôt que supposer ce chemin universel.

# Diagnostic public, dans une nouvelle politique réseau effectivement appliquée
python3 scripts/statistics/probe.py --output /tmp/lolalytics-probe

# À utiliser uniquement avec un export autorisé conforme
python3 scripts/statistics/pipeline.py build export.json --output statistics-cache
python3 scripts/statistics/pipeline.py verify statistics-cache/IDENTIFIANT_SHA256
python3 scripts/statistics/publish.py statistics-cache/IDENTIFIANT_SHA256
```

La dernière commande administrative exige `SUPABASE_PROJECT_REF` et `SUPABASE_ACCESS_TOKEN` dans l'environnement ; ne jamais en mettre les valeurs dans un fichier versionné ou une variable `VITE_*`. Les placeholders ci-dessus ne désignent pas des fichiers déjà disponibles dans une nouvelle session.

Résultats historiques enregistrés avant la passation :

| Vérification | Résultat | Limite |
| --- | --- | --- |
| Vitest / PGlite | **42 tests passés** | Base PostgreSQL simulée, pas le service Realtime hébergé |
| Python unittest | **10 tests passés** | Fixtures explicitement synthétiques et exécuteurs isolés |
| Playwright | **8 parcours passés** | Démo locale ; demandes de swap injectées pour les tests de popup |
| Production build | TypeScript et Vite réussis | Ne prouve pas le déploiement distant |
| SQL produit par le publisher | Exécuté dans PGlite : échec de promotion incomplète puis réussite complète | Aucun snapshot de vrais Delta 2 publié sur cette base de preuve |

Total annoncé précédemment : **60 tests**, soit 42 + 10 + 8 ; ce ne sont pas 60 tests d'extraction réelle. La recette à cinq navigateurs contre Supabase/Netlify reste à vérifier séparément, notamment après 007.

[ci.yml](../.github/workflows/ci.yml) exécute npm test, build et Playwright sur push/PR. La suite Python dédiée est exécutée dans le workflow statistique et manuellement ; elle n'a pas été ajoutée comme étape séparée au CI frontend. L'état de réussite des derniers runs GitHub Actions n'a pas été consulté pour cette passation.

Lors des travaux précédents, un cache npm accessible sous `/tmp/lol-npm-cache` a été utile avec des permissions de répertoire utilisateur limitées. `/usr/bin/chromium` était disponible. Ce sont des observations de cette machine, pas des hypothèses à imposer à une autre. Ne pas réinstaller ni recréer un checkout/worktree sans nécessité.

## 14. Assets : ce qui est actuel, ce qui reste à vérifier

- **173 champions** et portraits PNG locaux, catalogue **Data Dragon 16.22.1**, miroir `InFinity54/LoL_DDragon`, commit `dc04342110a9e0d7f76ffc844475070317015216`. La vieille mention 10.23.1 / 152 champions a été supprimée. Cette liste est datée ; ne pas affirmer qu'elle reste la dernière version pour toujours.
- Icônes PNG de rôle locales, récupérées depuis le miroir `Seunghyun0606/lolbody` épinglé dans [ASSETS.md](ASSETS.md), avec validation/documentation de provenance. L'utilisateur demandait des icônes League plutôt que des lettres ou des dessins générés.
- Le symbole client d'échange est encore référencé depuis `raw.communitydragon.org/.../button-swap.png`, avec repli **⇅** sur erreur. Son téléchargement et sa vérification visuelle depuis l'environnement étaient bloqués ; **ne pas le présenter comme un asset officiel local vérifié**. Les accès du navigateur d'un visiteur sont distincts du réseau Codex.
- Riot/CommunityDragon/Data Dragon apportent ici des assets et données statiques ; un catalogue récent de portraits n'apporte aucun Delta 2 ni aucune statistique réelle de matchup.

## 15. Incertitudes et travaux non terminés

| Point | À valider / ne pas promettre |
| --- | --- |
| Accès réseau de la prochaine session | Nouvelle machine réellement attachée à la version publiée avec les deux domaines actifs |
| UI de configuration Codex | Cause de la disparition du bouton et mécanisme exact de mise à jour de cette ancienne instance inconnus |
| Source Lolalytics | Format, filtres réels, nombres, groupes, couverture, coût et conditions d'usage |
| POC numérique réel | Toujours absent ; les fixtures ne remplissent pas ce livrable |
| Adaptateur source et quotidien réel | Non implémentés/validés ; workflow générique seulement |
| Paramètres GitHub de rafraîchissement | Présence, portée des secrets et activation non vérifiées |
| Déploiement frontend le plus récent | Push confirmé, déploiement Netlify après `d38db00` non observé indépendamment |
| Recette hébergée complète | Cinq profils, Realtime, conflits et chargement partagé avec la nouvelle migration à tester |
| Taille/performance à grande échelle | Aucun benchmark de 1,34 million de relations ; limite de validation ≠ garantie de débit ou mémoire |
| Rétention des snapshots | Historique conservé ; pas de purge automatique validée des instantanés anciens/non référencés. Les triggers d'immutabilité empêchent leur suppression administrative ordinaire. |
| Salles abandonnées sans Quit | Fermeture d'onglet conserve le siège ; pas de nettoyage par délai documenté comme implémenté |
| Coefficients des trois rôles uniformes | Jungle/Mid/Bottom restent à `2/9`, provisoires ; ne pas les retoucher dans la tâche d'acquisition |
| Asset d'échange distant | Vérification/téléchargement local encore incomplets |

## 16. Préférences de collaboration et suite du travail

- Répondre en français, expliquer simplement les actions à effectuer dans les consoles. Le produit reste en anglais.
- L'utilisateur veut que Codex réalise les tâches autorisées jusqu'au résultat concret, avec validation et push quand demandé, plutôt que lui proposer continuellement de poursuivre ou de copier du SQL.
- Pour Supabase, utiliser les accès déjà configurés et vérifier le projet avant modification. Ne pas redemander les mêmes autorisations ou des secrets déjà disponibles. Ne pas exposer les secrets dans les messages, logs, commits ou captures.
- Respecter les limites de périmètre de chaque demande : l'ordre initial « rapport uniquement » puis le nouveau mandat de pipeline étaient deux étapes distinctes ; la demande présente est **un document uniquement**.
- Ne pas réappliquer les anciens changements d'environnement ni publier une configuration automatiquement parce qu'une publication est techniquement possible. L'utilisateur a explicitement demandé d'attendre ses modifications dans le chat de configuration ; il a ensuite déclaré avoir publié lui-même les changements réseau.
- Éviter les tours de diagnostic vagues et les instructions d'interface supposées. Décrire ce que montrent réellement la capture ou l'outil et reconnaître les inconnues. Un statut « saved » n'est ni une application active ni une publication vérifiée.
- Séparer dans les comptes rendus **implémenté**, **testé localement**, **appliqué au service distant**, **déployé et constaté**, **déclaré par l'utilisateur** et **hypothétique**.
- Pour l'acquisition, privilégier une expérience limitée et chiffrée plutôt qu'une nouvelle architecture spéculative. Ne pas remplacer le problème des données par un nouveau modèle de score.

### Message possible pour la nouvelle session

> Reprends `NicoHelemon/lol_drafter` sur main avec l'environnement `lol_drafter` publié. Lis `docs/HANDOFF.md` puis `docs/statistics/REPORT.md`. Vérifie la politique réseau active et un accès public à Lolalytics avant de conclure quoi que ce soit sur le site. Reprends le POC sur Renekton Top, Ahri Mid et Jhin Bottom : vrais Delta 2 Against et Synergy, rôles, nombres de parties et comparaison à l'affichage, sous les filtres fixés. Mesure les lignes et requêtes effectives, conserve les preuves et distingue toute fixture synthétique des données réelles. Respecte les conditions d'accès ; conserve le pipeline/import si la collecte exhaustive n'est pas autorisée. Le cache partagé est déjà codé et la migration 007 a été appliquée : ne pas repartir de zéro ni rejouer les anciennes migrations. Ne modifie pas le score ni l'interface collaborative, sauf adaptation nécessaire du chargement des données.
