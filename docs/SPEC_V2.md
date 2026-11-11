# League of Legends — Collaborative Draft Assistant

> **Spécification V2 — actualisée le 11 novembre 2026**, après examen de xPerSki/lolalytics-api, CommunityDragon, Safety et des pages publiques Counter/Build de Lolalytics. Cette V2 remplace la V1 tout en conservant les décisions produit et le score.

## Mission pour Codex

Créer un dépôt GitHub contenant une application web fonctionnelle, déployable sur **Netlify**, destinée à **cinq joueurs d'une même équipe** qui préparent puis suivent ensemble une draft League of Legends. Réaliser une V1 utile, simple, rapide, lisible, responsive et testée. Privilégier un fonctionnement réel de bout en bout plutôt qu'une maquette.

La fonctionnalité centrale est le **classement dynamique des champions du pool de chaque joueur** selon les champions déjà sélectionnés des deux côtés. Le classement utilise uniquement des **Delta 2 pairwise normalisés**, inspirés des tableaux *Counter* et *Synergy* de Lolalytics, avec des coefficients fixes dépendant des rôles. Ne pas ajouter d'autres critères.

### Invariants / décisions prises

- Cinq rôles fixes, dans cet ordre : **Top, Jungle, Mid, ADC, Support**.
- Une seule équipe alliée de cinq joueurs partage **la même draft** en temps réel, sur plusieurs navigateurs/appareils. Les adversaires ne participent pas à l'application.
- Chaque joueur choisit son rôle et son **pool de champions autorisés** avant la draft (par exemple Renekton/Darius/Camille pour Top). Pools modifiables avant le début ; un hôte peut les corriger ensuite si nécessaire.
- Les cinq participants peuvent saisir ou corriger **les picks et bans des deux équipes**. Une modification devient visible par tous rapidement, sans rechargement.
- Les picks sont **attribués à un rôle supposé immédiatement** lors de la saisie, sans attendre la fin de la draft ; cette attribution est **provisoire et modifiable**. Les swaps entre rôles d'une même équipe sont faciles.
- Les recommandations sont recalculées à chaque changement de pick, ban, rôle assigné ou pool. Il n'y a pas de recours à un modèle génératif pour calculer les scores.
- **Pas de prior de winrate**, pas de score de composition, pas de pénalité AD/AP, pas de métagame, pas d'optimisation multi-étapes, pas de Monte Carlo/MCTS, pas de prédiction des futurs picks en V1.
- La finalité est d'**améliorer les choix orientés vers la victoire** via un indicateur contextuel de Delta 2, **pas de prétendre calculer une probabilité de victoire calibrée**. Sans winrate de base, le score ne peut pas mathématiquement être une probabilité absolue de victoire.
- Aucune intégration avec le client LoL n'est nécessaire : les cinq joueurs renseignent la draft **manuellement**.

## 1. Parcours utilisateur

### A. Créer ou rejoindre une session

1. Un joueur crée une salle privée et obtient un **lien d'invitation**.
2. Les quatre autres rejoignent avec ce lien. Pas besoin de créer cinq comptes classiques ; privilégier des sessions anonymes sécurisées ou un mécanisme équivalent. Chaque participant choisit un pseudonyme et réclame un **siège/rôle unique**.
3. La salle est limitée à **cinq sièges participants**, avec reconnexion possible sans dupliquer son siège. Le créateur est l'hôte pour les actions de configuration/reset ; **tous les joueurs** peuvent modifier la draft.
4. Montrer les personnes connectées, le rôle de chacune, et l'état de préparation.
5. L'hôte choisit notre côté (bleu/rouge, facultatif pour le score), et **le contexte statistique de la session** : patch/dataset, rang/tier, région/queue/période si ces dimensions existent dans la source. Une fois la draft démarrée, figer le dataset et le contexte pour éviter de mélanger les statistiques.

### B. Avant la draft : pools et préparation

- Chaque joueur sélectionne plusieurs champions qu'il accepte de jouer sur **son poste**, via une recherche textuelle et des portraits de champions.
- Un pool peut contenir 1 à N champions. Ne pas imposer arbitrairement une limite très faible ; le coût de préparation peut être indiqué.
- **Préparer/charger en cache** toutes les entrées pairwise nécessaires pour classer les candidats de ces pools face aux picks possibles des autres rôles. L'objectif est de ne pas effectuer de requête externe vers la source statistique après chaque pick.
- Montrer explicitement si les données sont **prêtes, partielles ou indisponibles**. Permettre la draft en mode données partielles, sans inventer de valeurs.
- L'hôte démarre la draft ; le site passe en mode suivi en temps réel.

### C. Pendant la draft

Afficher simultanément les **deux compositions en cinq lignes**, dans l'ordre **Top, Jungle, Mid, ADC, Support**, par exemple :

| Poste | Notre équipe | Équipe adverse |
|---|---|---|
| Top | Pick / vide | Pick / vide |
| Jungle | Pick / vide | Pick / vide |
| Mid | Pick / vide | Pick / vide |
| ADC | Pick / vide | Pick / vide |
| Support | Pick / vide | Pick / vide |

- Chaque case peut être renseignée, vidée, modifiée ou échangée avec une autre case de la **même équipe**. Champs accessibles aux cinq participants.
- Chaque équipe possède une zone de **cinq bans** (avec portraits), éditable en direct. Un champion banni n'est plus sélectionnable dans les picks/recommandations.
- Un champion ne peut pas figurer deux fois dans les picks ou bans de la session. Validation transactionnelle côté serveur, pas seulement côté interface.
- Ne **pas** imposer une séquence officielle de pick/ban en V1 : les utilisateurs observent la draft réelle et saisissent les événements où et quand ils les connaissent. Garder, si simple, un petit historique des modifications.
- Si l'on tente de placer un nouveau champion dans un rôle occupé, proposer clairement **remplacer / échanger / déplacer l'ancien pick dans une zone « rôle à confirmer »**. Une équipe ne peut avoir plus de cinq picks, y compris ceux non attribués à un poste.
- Les picks dont le rôle est encore indéterminé sont visibles séparément et **ne contribuent pas aux scores par rôle** tant qu'un rôle ne leur est pas attribué. Ils continuent de bloquer le champion comme indisponible.

**Exemple impératif à rendre ergonomique :** l'utilisateur renseigne `Jhin` en **ADC adverse** ; plus tard l'équipe adverse choisit `Caitlyn` et l'on comprend que `Caitlyn` est ADC et `Jhin` Jungle. Il doit être possible de déplacer Jhin vers Jungle et Caitlyn vers ADC en quelques interactions, **sans perdre le pick ni dupliquer le champion**, et tous les classements se recalculent aussitôt. Ne pas empêcher des assignations de rôles atypiques : si le dataset ne couvre pas Jhin Jungle, signaler simplement le manque de données.

### D. Recommandations

- Afficher un panneau pour **chacun des postes alliés non encore lock**, avec tous les champions **de son pool** encore disponibles, classés du meilleur au moins bon score.
- Un joueur peut mettre son propre panneau en évidence ; les cinq recommandations restent accessibles à tous.
- Chaque ligne présente portrait, nom, score, et accès à un **détail de contribution** par champion allié/ennemi actuellement assigné.
- Après un ban ou un pick qui rend un champion indisponible, le retirer du ranking (ou l'afficher barré dans un sous-groupe séparé).
- Quand un poste allié est définitivement pick, afficher son champion locké plutôt que des recommandations actives.
- Quand aucun adversaire/allié n'est encore connu, **aucun avantage contextuel n'est calculable** : ne pas afficher un faux « meilleur champion ». Afficher « Pas encore de données contextuelles » et lister le pool sans classement statistique.
- Afficher un **indicateur de couverture** lorsque certaines paires n'ont pas de Delta 2 disponible ; ne jamais afficher de valeurs inventées.

## 2. Moteur de scoring : spécification exacte

Pour un candidat `c` dans le rôle allié `r`, avec alliés déjà attribués à un rôle `A` et ennemis attribués à un rôle `E` :

`S(c | A, E, r) = [sum_{e in E} w_vs[r, role(e)] * delta2_vs(c,r,e,role(e)) + sum_{a in A} w_with[r, role(a)] * delta2_with(c,r,a,role(a))] / [somme des poids des paires effectivement disponibles et observées]`

- `delta2_vs` : **Delta 2**, tableau **Counter/Against** ; positif = bon pour le candidat contre cet ennemi.
- `delta2_with` : **Delta 2**, tableau **Synergy** ; positif = synergie favorable.
- Utiliser les nombres en **points de pourcentage de winrate** (par exemple `+1.25`, pas `0.0125`) et une convention uniforme dans l'ensemble de l'application.
- Ne jamais ajouter le winrate brut, le winrate moyen ou un prior dans le score.
- Les poids sont **fixes, configurables, non appris**. La normalisation porte sur les poids des paires réellement connues ET ayant une donnée disponible.
- Si aucune paire n'est calculable, score = **null / N/A**, et non score `0` prétendument comparable.
- Si la donnée manque sur une paire, **ignorer cette paire** dans le numérateur et le dénominateur, signaler le manque, et ne pas assimiler automatiquement « manquant » à zéro.
- Ne pas supposer la symétrie du Delta 2 entre directions ou rôles sans validation explicite de la source. Stocker les références `champion candidat + rôle candidat + autre champion + autre rôle + relation`.
- Le score est une **moyenne pondérée de deltas contextuels**, pas une vraie estimation calibrée de probabilité de victoire : le nommer clairement « score Delta 2 » dans l'UI.

### Matrices de poids V1

Il existe pour un rôle candidat 9 relations potentielles : **5 ennemis (vs Top/Jungle/Mid/ADC/Support)** et **4 alliés (avec les quatre autres rôles)**.

Les exemples suivants constituent les choix déjà discutés ; conserver une configuration centralisée facile à modifier.

**Candidat Top :**
- `vs Top` : **0.4**
- chacune des **8 autres paires** (4 vs non-Top + 4 synergies alliées) : **0.2**
- total théorique de tous les poids à draft complète : **2.0**

**Candidat Support :**
- `vs Support` : **0.3**
- `vs ADC` : **0.3**
- `avec ADC allié` : **0.3**
- chacune des **6 autres paires** : **1.1 / 6**
- total théorique : **2.0**

**Jungle, Mid, ADC :** poids exacts **pas encore arbitrés**. Pour disposer d'une V1 testable, utiliser provisoirement `2/9` par paire, et documenter que c'est un **paramètre par défaut**, pas un choix final de design. Prévoir une matrice de coefficients dans un fichier de configuration typé et testable.

Les poids des paires **absentes de l'état courant** ne comptent pas dans la normalisation. Les poids restent identiques quel que soit le nombre de picks.

### Détail et stabilité

- Exposer pour chaque candidat le score agrégé et les contributions pondérées, séparées entre `vs` et `with`, avec leur rôle et Delta 2 d'origine.
- Un changement d'attribution de rôle peut modifier la sélection des données, les poids, ou les deux ; recalculer toutes les recommandations concernées.
- À données et état de draft identiques, calculer toujours les mêmes scores. Pas d'aléatoire ni d'heuristique cachée.
- Pour départager deux candidats au même score, garder un ordre déterministe (par exemple ordre alphabétique) ; ne pas injecter secrètement un winrate global.

## 3. Données et cache — priorité architecturale

### Source statistique — recherche vérifiée le 11 novembre 2026

**Objectif inchangé :** utiliser les **Delta 2** des tableaux **Counter/Against** et **Synergy** de Lolalytics, conditionnés au champion et rôle candidat, à l'autre champion et à son rôle, au patch et au tier. Le jeu de données ne doit pas être reconstruit à partir du seul winrate brut. Le scoring, l'interface et les droits d'accès demeurent indépendants du provider.

**Constats concrets issus des trois références étudiées :**

1. **`xPerSki/lolalytics-api`** (`https://github.com/xPerSki/lolalytics-api`, source `src/lolalytics_api/main.py`, PyPI 0.0.6 publiée le 16.07.2025). Wrapper **non officiel** Python avec `requests` + `lxml`; les fonctions `get_counters()` et `matchup()` retournent des **winrates**, **pas Delta 2**. Il fournit néanmoins les exemples d'URL, les conventions `tier`/`lane` et le principe de parsing. Ses XPath absolus sont fragiles : ne pas les copier comme solution durable. Le code est **MIT**, réutilisable avec son avis de licence; ceci ne confère **aucun droit** sur les données Lolalytics.
2. **`https://lolalytics.com/lol/akali/counters/?tier=diamond_plus`** : la **page publique Counter** consultée affichait `Δ2` *explicitement* dans les entrées (avec champion, winrate, `Δ1`, `Δ2`, games). Son sélecteur de rôle ennemi utilise notamment **`vslane=top`** et **`vslane=support`**. Exemple observé : `https://lolalytics.com/lol/akali/counters/?tier=diamond_plus&vslane=top`. Cela constitue une preuve de **présence visible des Δ2 Against** dans les pages, **pas encore une preuve** que le `requests.get()` brut contient tous les enregistrements ou que l'extraction automatique est autorisée. Tester la présence dans le HTML brut et le filtrage du rôle du candidat (`lane`) avant de développer un parser.
3. **Synergy** : les tableaux et le sélecteur **`Normalised Delta`** sont visibles sur les pages `.../build/` et dans les captures utilisateur; la bulle d'aide indique que **Delta 2 = winrate réel ensemble – winrate normalisé attendu ensemble**. Mais la page textuelle vérifiée n'a pas exposé les valeurs de la table de synergie sous une forme permettant de démontrer une extraction complète. **L'accès programmatique aux Delta 2 Synergy reste à vérifier**, notamment HTML brut vs rendu JavaScript/réponse réseau.
4. **CommunityDragon** (`https://www.communitydragon.org/docs`) : excellente source d'assets et de données **statiques** du client LoL, **pas** de Delta 2 / winrate de matchs. Point d'entrée directement vérifié : `https://raw.communitydragon.org/latest/plugins/rcp-be-lol-game-data/global/default/v1/champion-summary.json`, contenant `id`, `name`, `alias`, `squarePortraitPath`, etc. Construire les URL de portrait à partir du chemin fourni par le JSON selon la documentation `https://www.communitydragon.org/docs/assets`. Les champs `roles` de cette ressource (mage/fighter/support, etc.) sont des **classes de champion**, et **non** les cinq postes de draft ; ne pas s'en servir pour interdire des swaps atypiques. Éviter de coder en dur des chemins de portraits non vérifiés. Data Dragon officiel reste une autre possibilité pour les assets.
5. **Safety** (`https://getsafety.com/packages/pypi/lolalytics-api`) : `lolalytics-api` 0.0.6 est indiqué **MIT**, sans vulnérabilité publique répertoriée. Ce résultat **n'est pas un audit complet**, et **n'autorise pas** l'usage des données récupérées.

**Droits d'usage :** `https://a3.lolalytics.com/` indique explicitement que l'API **privée** est destinée aux visiteurs du site et que **les données qui s'y trouvent ne peuvent pas être utilisées par des tiers**. Ce texte ne suffit pas à lui seul à caractériser tous les droits liés au HTML public, mais **ne vaut certainement pas permission** de réemployer l'API pour une application Netlify, même privée entre cinq amis. Ne pas intégrer ni contourner cette API privée sans autorisation explicite. Vérifier la politique applicable à une extraction automatisée du site public; si elle n'est pas établie, conserver le provider de démonstration/import autorisé. Ne pas masquer l'origine des données.

**Mini phase de recherche technique (sans préjuger de l'autorisation d'exploitation) :**

- Examiner **un cas `vs`** réel, par exemple Akali middle contre Top, sur la page publique `/counters/`. Confirmer que les lignes et `Δ2` peuvent être identifiés sans XPath absolus. Capturer un petit HTML de test autorisé et écrire un test qui vérifie la correspondance `(champion, rôle candidat, ennemi, rôle ennemi, delta2, games)`.
- Examiner **un cas `with`** : page `/build/`, panneau Synergy / Normalised Delta; confirmer **où** les valeurs existent (HTML brut, JSON incorporé, chargement dynamique). Ne pas confondre présence des titres `Delta 2` avec présence des données numériques de chaque paire.
- Documenter explicitement pour chaque mode d'accès : provenance, stabilité, conditions d'utilisation, couverture (tous champions/roles ou sous-ensemble), filtres exacts, nombre de lignes retournées, erreurs, schéma de sortie. Ne pas présenter une hypothèse comme un endpoint fonctionnel.
- **Si l'accès programmatique est autorisé**, intégrer un collecteur **hors du frontend** (script Python autonome inspiré du wrapper MIT ou service backend adapté) qui normalise les entrées et les stocke dans `PairwiseDelta`. Ne pas installer Python dans le bundle React/Netlify uniquement pour réutiliser le package; un script offline est suffisant. Limiter le rythme et mutualiser les appels.
- **Sinon**, fournir une saisie/import JSON/CSV de deltas provenant d'une source autorisée et une démo clairement fictive. Aucune requête privée ne doit être nécessaire pour que l'application fonctionne.

**Caches et économie de requêtes :** si une page Counter d'un `(champion candidat, rôle candidat, vslane, contexte)` fournit une liste complète de champions adverses, parser **toute la liste en une seule récupération** plutôt que requêter chaque paire individuellement. Préparer l'union des pools des cinq joueurs, regrouper par champion candidat/rôle/autre rôle, dédupliquer les pages, mettre en cache par dataset/patch/tier/filtre/source. Une draft en cours ne déclenche aucune extraction Lolalytics par pick. Ne pas extrapoler le nombre de requêtes nécessaires avant d'avoir vérifié le format et la couverture.

**Exigence impérative pour Codex :** conserver l'abstraction `PairwiseDataProvider` et livrer indépendamment des droits d'accès Lolalytics : (i) démo fictive identifiée, (ii) import JSON/CSV validé, (iii) moteur de scoring testé, (iv) provenance/patch/tier/date et couverture, (v) UI Netlify + synchronisation cinq utilisateurs. Ajouter un collecteur réel uniquement après validation séparée des conditions d'accès.

### Modèle de donnée (conceptuel)

`PairwiseDelta`: 
- `datasetId`, `patch`, `tier`, autres filtres de contexte si disponibles ;
- `relation`: `vs` ou `with` ;
- `candidateChampionId`, `candidateRole` ;
- `otherChampionId`, `otherRole` ;
- `delta2` (nullable s'il manque), `games` (optionnel, indicatif), `source`, `fetchedAt` ou `importedAt`.

`DraftSession` : id opaque, code/lien d'invitation sécurisé, hôte, statut (`setup`/`live`/`finished`), contexte et version figée du dataset, version d'état.

`Participant` : id, salle, rôle/siège, pseudonyme, pool de champions, authentification de la session.

`Pick` : équipe (`ally`/`enemy`), champion, rôle **nullable**, ordre d'entrée éventuel.

`Ban` : équipe, champion, slot de ban.

Concevoir schéma SQL/RLS concret à partir de ces types ; pas besoin de multiplier les tables sans justification.

### Stratégie de cache

- **Cache serveur/durable partagé** des deltas par clé `(dataset + relation + candidateChampion + candidateRole + otherChampion + otherRole)` ; ne jamais stocker les mêmes données cinq fois pour cinq clients.
- **Warm-up avant le début** : à partir de l'union des cinq pools, charger ou valider les données disponibles nécessaires pour toutes les relations potentielles avec les champions/roles adverses et alliés pertinents. Dédupliquer les recherches/imports, charger par lots si possible.
- Pendant la draft, **scores calculés localement à partir des données déjà chargées en mémoire**, sans appel à la source sur chaque action ; une requête complémentaire éventuelle doit être rare, dédupliquée et indiquée comme telle.
- Conserver également un cache navigateur (IndexedDB ou équivalent seulement si pertinent) pour réduire chargements/latence. Ne jamais utiliser le cache navigateur comme source de vérité de la draft.
- **Versionnement plutôt que TTL aveugle** : les statistiques d'une session sont liées à un dataset/patch figé. Un nouveau dataset peut être préparé pour les sessions futures, mais ne remplace pas silencieusement celui d'une draft en cours.
- Respecter les limites d'accès et droits de toute source externe. Pas de scraping à chaque session utilisateur.

## 4. Architecture recommandée

- **Frontend :** React + TypeScript + Vite, interface responsive (desktop prioritaire, utilisable sur téléphone) ; hébergement statique **Netlify**.
- **Backend partagé :** Supabase Postgres pour la persistance, **Supabase Realtime** pour signaler les mutations de salle, **Supabase Auth anonyme** ou une alternative sécurisée pour identifier les participants sans comptes classiques.
- Pour cinq utilisateurs par salle, la solution simple `Postgres Changes` peut suffire ; configurer la sécurité des abonnements, et envisager `Broadcast` si nécessaire. La base de données reste la source de vérité : sur reconnexion, relire l'état canonique avant de reprendre les événements temps réel.
- **Sécurité :** RLS, permissions de salle, lien d'invitation imprévisible, validation serveur des droits et contraintes d'unicité ; ne pas publier de clé de service ni de secret dans le bundle Netlify.
- **Concurrence :** mises à jour atomiques/versionnées (transaction ou RPC SQL) pour éviter que deux utilisateurs éditant la même case au même moment ne créent des doublons ou n'écrasent silencieusement une modification. En cas de conflit, notifier puis rafraîchir l'état.
- **Netlify Functions** uniquement si utiles (ex. endpoint d'import protégé ou connecteur autorisé). Pas de serveur WebSocket ad hoc sur Netlify : Supabase fournit la synchronisation.
- Prévoir `netlify.toml`, variables d'environnement documentées, migrations SQL, schéma/données de démonstration, scripts npm et tests.

## 5. Interface souhaitée

- Design sobre, lisible, rapide, sans marketing ni animations superflues ; utiliser portraits officiels des champions.
- Écran **Lobby** : lien de salle, cinq participants, rôle attribué, pool éditable, statut de préparation des données, bouton démarrer.
- Écran **Draft** : deux colonnes d'équipes et cinq lignes de rôles, zone de bans pour chacune, champ de recherche/portrait pour ajouter les picks, déplacement/swap facile, indication `rôle à confirmer`.
- À proximité ou sous le tableau : cinq panneaux de **rankings** (un par rôle, celui du joueur connecté peut être mis en avant). Pour chaque champion du pool : score Delta 2 et explication repliable des contributions.
- Indiquer joueurs connectés, statut de synchronisation, version/date du dataset, et présence de données manquantes. Sur mobile, permettre de basculer clairement entre tableau de draft et recommandations sans perdre la vision d'ensemble.
- Aucune information n'est confidentielle pour les cinq participants de la salle ; la draft et les pools sont visibles à tous.

## 6. Comportements vérifiables / tests d'acceptation

1. **Cinq navigateurs** rejoignent la même salle, chacun avec un rôle distinct et son pool ; tous voient la même draft.
2. Depuis n'importe lequel, ajouter `Jhin` en ADC adverse : les quatre autres vues se mettent à jour sans rafraîchir, et les recommandations se recalculent.
3. Déplacer `Jhin` vers Jungle adverse puis ajouter `Caitlyn` en ADC adverse : aucun pick perdu, aucun doublon, bons poids et bonnes données par rôle.
4. Ajouter un ban : le champion banni n'est plus sélectionnable ni recommandé ; retirer le ban le rétablit s'il est disponible.
5. Un candidat du pool est classé à l'aide **uniquement des Delta 2** et des coefficients ; les tests numériques vérifient la formule, les poids Top et Support et la normalisation par les paires observées.
6. Une paire de données absente réduit la couverture et **ne devient pas un zéro fictif** ; aucune paire observée donne `N/A` sans ranking trompeur.
7. Deux participants saisissant simultanément des actions incompatibles ne corrompent pas l'état ; conflit explicite, jamais de double pick/ban.
8. Un participant rafraîchit ou perd temporairement la connexion : il récupère l'état partagé et son siège, sans créer de nouveau joueur.
9. Une session utilise une seule version statistique figée ; changer le cache global ne modifie pas les recommandations de cette session.
10. Le site fonctionne sur Netlify avec le jeu de démo même **sans** accès Lolalytics ; il est clairement indiqué que les données démo sont fictives.
11. Le catalogue champions et les portraits se chargent depuis une source statique versionnée avec mapping ID/alias validé (CommunityDragon ou Data Dragon).
12. Si l’extracteur expérimental est développé, il possède au moins un test de fixture `vs` avec `Δ2` et un test de couverture des valeurs Synergy ; **ne jamais marquer la source réelle comme opérationnelle tant que les deux relations ne sont pas vérifiées et les droits d’accès clarifiés**.

## 7. Livrables de Codex et ordre de travail

1. Inspecter le dépôt s'il existe ; sinon créer proprement le projet. Poser une architecture et des types simples.
2. Implémenter d'abord le **scoring pur** et ses tests unitaires, avec matrice de poids configurable et données fictives clairement identifiées.
3. Implémenter ensuite la **persistance de salle, la sécurité et le temps réel** : mutations transactionnelles, reconnexion, validation des uniques.
4. Implémenter Lobby, pools et **draft manuelle** avec édition, swaps, bans ; connecter le ranking dynamique.
5. Implémenter la couche **provider/import/cache** et le warm-up de la session.
6. Ajouter tests unitaires et au moins un test d'intégration multi-clients, puis vérifier la compilation/qualité.
7. Préparer le **repo GitHub** (README, `.env.example`, migrations, scripts, instructions Supabase/Netlify), connecter et déployer sur **Netlify** si les accès sont disponibles. Sinon fournir les étapes exactes de configuration et ne pas prétendre que le déploiement a eu lieu.

### Arborescence suggérée, non prescriptive

```text
src/
  components/         # lobby, board, picks, bans, rankings
  domain/             # types, scoring, weights, draft validation
  data/               # provider interface, import, cache, fixtures
scripts/
  data-pipeline/      # exploratory/offline data conversion only, no runtime dependency
  lib/                # supabase client and realtime hooks
  pages/
supabase/
  migrations/
tests/
netlify.toml
.env.example
README.md
```

### Éléments explicitement exclus de la V1

- Simulation Monte Carlo, minimax, prédiction de réponses adverses.
- Détermination automatique du rôle d'un champion selon la meta ; **le rôle est une hypothèse saisie et corrigée par les joueurs**.
- Machine learning, apprentissage des coefficients, winrate de base, score de composition / AD-AP / engage / scaling.
- Connexion au client LoL, import automatique des picks du jeu, overlays en jeu.
- Scraping automatisé non autorisé et prétention que l'API privée Lolalytics est publique.
- Chat intégré, inscription sociale, ranking mondial, monétisation, multiples produits.

## 8. Références techniques

- Document utilisateur : `ChatGPT-Web scraping Lolalytics-20261111-1706.md` (historique d'investigation, pas connecteur fonctionnel).
- Lolalytics — avis API privée : https://a3.lolalytics.com/
- Riot Data Dragon : https://developer.riotgames.com/docs/lol
- Code MIT du wrapper non officiel : https://github.com/xPerSki/lolalytics-api/blob/master/src/lolalytics_api/main.py
- Page Counter avec Δ2 visible : https://lolalytics.com/lol/akali/counters/?tier=diamond_plus
- Page Counter avec rôle ennemi : https://lolalytics.com/lol/akali/counters/?tier=diamond_plus&vslane=top
- CommunityDragon docs : https://www.communitydragon.org/docs
- CommunityDragon assets : https://www.communitydragon.org/docs/assets
- Catalogue des champions : https://raw.communitydragon.org/latest/plugins/rcp-be-lol-game-data/global/default/v1/champion-summary.json
- Safety (package, MIT, vulnérabilités connues) : https://getsafety.com/packages/pypi/lolalytics-api
- Supabase Realtime (database changes) : https://supabase.com/docs/guides/realtime/subscribing-to-database-changes
- Supabase Presence : https://supabase.com/docs/guides/realtime/presence
- Netlify Functions / secrets : https://docs.netlify.com/build/functions/environment-variables/

**Consigne finale :** viser une V1 réellement testable en cinq navigateurs, ergonomique pour suivre une draft en direct et honnête sur l'origine et les limites des Delta 2. **Ne pas compliquer la fonction de score.**
