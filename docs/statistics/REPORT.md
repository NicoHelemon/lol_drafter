# Acquisition des Delta 2 : résultat des essais du 12 novembre 2026

> **Reprise du cycle de vie :** voir [LIFECYCLE.md](LIFECYCLE.md) pour l’audit du dépôt, la rétention reconstituée, les tests et les limites de publication de cette nouvelle session.

> **État courant :** le [pipeline réel Against + Synergy](LIVE_PIPELINE.md) est implémenté et testé sur de vraies réponses, avec 228 cellules Synergy comparées au navigateur. Les anciens blocages techniques et résultats limités aux mocks ci-dessous sont historiques. Aucun seuil Lane/Games/Pick n’est appliqué aux nouveaux exports.

> **Dernière décision utilisateur :** suppression des seuils indicatifs Lane/Games/Pick pour la collecte. Voir la [comparaison testée des collecteurs](COLLECTOR_REVIEW.md) : 2 518 lignes Against conservées, Hextech contrôlé sur 278 paires, Synergy testée sur mocks uniquement. Les résultats avec seuils ci-dessous sont historiques.

> **Mise à jour de reprise — 12 novembre 2026 :** voir le [POC public](PUBLIC_POC.md). Accès réseau rétabli ; 285 lignes Against réelles comparées, inspecteur expérimental testé. Synergy non collectée : avis explicite d’API privée sur `a1.lolalytics.com`. Aucun dataset publié. Les résultats ci-dessous décrivent la session antérieure.

**Le cache et son intégration sont opérationnels et testés. L’extraction réelle de Lolalytics n’est pas démontrée : l’environnement refuse la connexion au domaine avant de contacter le site. Zéro Delta 2 réel a été récupéré ou comparé à l’affichage.** Les statistiques du site restent fictives tant qu’aucune source réelle vérifiée n’est publiée.

Ce document distingue les observations effectuées, le code livré et les hypothèses restant à tester. Il peut être transmis à un autre intervenant sans l’historique du chat.

## 1. Ce qui a réellement été essayé

### Accès public à Lolalytics

Deux outils ont été essayés pendant l’investigation : curl puis Python `urllib`, avec les réglages réseau et TLS de l’environnement conservés. Tous deux échouent sur `https://lolalytics.com/robots.txt`, avant toute page statistique :

```text
curl: CONNECT tunnel failed, response 403
Python: Tunnel connection failed: 403 Forbidden
```

Le proxy de l’environnement autorise notamment GitHub et `api.supabase.com`, mais pas `lolalytics.com`. **Ce 403 ne prouve ni une interdiction du scraping par Lolalytics, ni une protection anti-bot du site.** Il s’agit d’un refus du tunnel par notre environnement. Aucun autre proxy, domaine miroir ou endpoint privé n’a été utilisé pour contourner ce refus.

Le [journal reproductible du prototype](source-probe-2026-11-12.json) contient une tentative Python, zéro page reçue et zéro observation vérifiée. Le programme s’arrête au premier échec ; il ne lance pas les pages suivantes.

Conséquences précises :

| Question | Résultat mesuré |
| --- | --- |
| HTML initial des pages Build, Counter et Synergy | Non reçu ; impossible à examiner ici |
| Présence de données dans un script JSON embarqué | Non déterminée |
| Nécessité d’un navigateur ou d’un appel réseau supplémentaire | Non déterminée |
| Nombre de lignes Against / Synergy par page | Non mesuré |
| Valeurs, nombres de parties et groupes par rôle | Aucune observation réelle |
| Concordance avec le site pour les mêmes filtres | Comparaison impossible à ce stade |

Pour reprendre : autoriser `lolalytics.com` et `www.lolalytics.com` dans l’environnement. Aucune autorisation de l’API privée `a3.lolalytics.com` n’est demandée. L’essai commencera par les règles d’accès publiques, puis trois couples représentatifs : **Renekton Top, Ahri Mid, Jhin Bottom**. Il faudra relever les URL et les filtres effectivement affichés, sans inventer leurs paramètres.

### Lecture du wrapper GitHub

Le fichier `src/lolalytics_api/main.py` de [xPerSki/lolalytics-api](https://github.com/xPerSki/lolalytics-api/tree/3f40f7f57491921a96c21b4bf51c0282f9709e56) a été téléchargé et lu. La copie examinée correspond au commit **3f40f7f57491921a96c21b4bf51c0282f9709e56**. La [licence MIT](xPerSki-LICENSE.txt) est conservée avec ce rapport.

Observations dans le code, sans prétendre avoir exécuté ses appels vers Lolalytics :

- `requests.get` récupère le HTML ; `lxml.html` applique des XPath absolus.
- `get_counters` lit des noms et des **winrates**, sur une quantité demandée de counters.
- `get_champion_data` lit des statistiques générales, dont un champ nommé `wr_delta`. Ce nom ne permet pas de l’identifier comme Delta 2 de paire.
- `matchup` lit un **winrate** et un nombre de parties sur une page de matchup.
- Le wrapper n’implémente pas la collecte des Delta 2 Against et Synergy, ni l’ensemble des filtres demandés.

Il fournit donc une piste de lecture du HTML. Il ne démontre pas que les deux matrices complètes sont présentes dans le HTML actuel. Notre code est indépendant ; aucun calcul de Delta 2 à partir de ces winrates n’a été introduit.

## 2. Contrat statistique retenu

Les exports destinés au pipeline déclarent exactement :

```json
{
  "tier": "emerald_plus",
  "region": "global",
  "queue": "ranked_solo_duo",
  "windowDays": 14,
  "minLanePercent": 2,
  "minGames": 100,
  "minPickPercent": 0,
  "metric": "delta2",
  "unit": "percentage_points"
}
```

Ce contexte est enregistré dans chaque instantané et participe à son empreinte. Le validateur vérifie sa déclaration ; **cela ne remplace pas la vérification des filtres sur la source**. Les pourcentages de lane/pick ne peuvent pas être contrôlés à partir d’un export qui ne les contient pas : le futur adaptateur doit établir qu’ils sont appliqués.

Chaque observation conserve direction, relation (`vs` / `with`), IDs Riot, deux rôles, Delta 2 observé et nombre de parties. Le pipeline exige au moins 100 parties par ligne exportée. `0` est une valeur connue ; `null` et une paire absente restent des données manquantes. Aucune symétrie, inversion ou reconstruction à partir de winrates n’est effectuée. La clé interne `ADC` continue d’être affichée **Bottom** dans l’interface.

## 3. Ce qui est livré et exécuté

### Pipeline Python indépendant

Les programmes de `scripts/statistics` utilisent uniquement la bibliothèque standard Python :

- `probe.py` : petit essai des pages publiques, sans redirection automatique, sans API privée, avec arrêt sur échec ou interdiction robots. Sauvegarde du HTML reçu, empreinte, taille, durée, tables HTML et présence de scripts JSON. **C’est un outil de découverte, pas encore un extracteur Lolalytics validé.** Il ne confond pas une étiquette « Delta 2 » avec une observation numérique vérifiée.
- `pipeline.py` : validation d’un export JSON, découpage par champion/rôle, fichiers `.json.gz`, manifeste avec empreintes SHA-256, volumes et compteurs. L’identité de l’instantané couvre toutes les données et métadonnées. Vérification complète avant remplacement atomique du pointeur local `current.json`.
- `publish.py` : publication administrative vers Supabase, par fragments. Une publication interrompue reste invisible ; la promotion de l’instantané et le changement du pointeur courant se font dans une transaction finale après contrôle des comptes. Les instantanés prêts sont immuables. Le programme refuse de promouvoir les fixtures fictives comme source quotidienne réelle.
- `refresh.py` : import quotidien d’un **export JSON autorisé** puis validation/publication. Refus des exports datant de plus de 48 heures et des URL Lolalytics tant que l’adaptateur et les conditions de collecte ne sont pas vérifiés.

Un workflow GitHub Actions est prévu chaque jour à **06:17 UTC**. La collecte planifiée reste désactivée tant que `STATISTICS_REFRESH_ENABLED` n’est pas `true`. Lancer le workflow manuellement exige aussi une URL d’export valide et ses paramètres d’administration. Aucune autorisation de collecte exhaustive n’est déduite du présent prototype.

Les fichiers gzip sont les artefacts portables de collecte. **Dans l’intégration actuelle, Supabase stocke les fragments en JSONB**, pas ces fichiers gzip ; le navigateur les lit via PostgREST. Une distribution des fichiers compressés par stockage/CDN reste possible ultérieurement, mais n’a pas été déployée comme second système.

### Intégration à l’application

La migration `202611120007_shared_statistics.sql` ajoute :

- `statistics_snapshots` : métadonnées et identité d’un instantané ;
- `statistics_shards` : observations par champion/rôle ;
- `statistics_current` : instantané réel à utiliser pour les nouvelles salles, lorsqu’il en existe un.

Les imports autorisés de l’hôte sont déportés automatiquement vers ce cache partagé. Deux salles utilisant le même import partagent les mêmes fragments. L’état sauvegardé d’une salle contient les métadonnées, `snapshotId` et `pairs: []` : **plus de dataset complet dans chaque état de salle**. Les données actuellement en ligne ne sont pas supprimées par la migration.

Le navigateur hydrate une copie en mémoire avec les fragments des pools ayant un rôle et des picks effectivement affichés. Il garde les résultats en cache par `(snapshotId, champion, rôle)`. Les valeurs chargées sont retirées avant chaque sauvegarde de la salle. Les membres conservent leurs permissions de draft ; seul l’hôte peut changer de dataset en préparation, et celui-ci reste figé pendant la draft.

Un changement de pick ou de ban réutilise les fragments déjà chargés et recalcule localement. Un nouveau candidat, un rôle encore non chargé ou un pick anonyme peuvent nécessiter la lecture d’un fragment supplémentaire du **cache Supabase**, jamais un appel à Lolalytics. Les lectures sont groupées par 40 clés. Avec 20 couples distincts dans les pools, une lecture de fragments suffit à froid, en plus de la résolution des métadonnées. Les lectures Realtime déjà présentes pour synchroniser la salle restent en place.

Une actualisation quotidienne ne change pas les statistiques d’une salle existante : sa référence est épinglée. Les anciennes références restent lisibles. Le moteur `src/domain/scoring.ts`, ses poids et les composants de draft n’ont pas été modifiés.

### Preuve d’exécution sur données fictives, distincte du POC source

La fixture automatisée couvre les trois couples Renekton Top, Ahri Mid et Jhin Bottom. Elle contient délibérément un zéro, un nombre négatif et une donnée manquante pour chacun. **Les valeurs `0`, `-1.25` et `null` sont inventées pour les tests ; elles ne décrivent pas Lolalytics.**

| Mesure de ce test | Résultat |
| --- | ---: |
| Fragments champion/rôle | 3 |
| Lignes exportées | 9 |
| Lignes Against / Synergy | 6 / 3 |
| Valeurs connues / nulles | 6 / 3 |
| Zéros observés dans la fixture | 3 |
| JSON des fragments, avant compression | 1 240 octets |
| Fragments gzip, manifeste exclu | 506 octets |
| Requêtes à une source statistique pour ce test | 0 |

Le [manifeste produit](synthetic-poc.json) conserve les empreintes et tailles. Ces quelques lignes prouvent le fonctionnement du pipeline ; elles ne permettent d’extrapoler ni le taux de compression du dataset réel, ni la vitesse d’une collecte exhaustive.

Les tests vérifient aussi : doublons directionnels, faux champ winrate, filtres différents, nombre de parties insuffisant, corruption d’un fichier, échec de rafraîchissement/publication, isolation des instantanés, reprise du cache après échec, droits SQL et immutabilité. Le parcours multi-identités en PostgreSQL simulé vérifie qu’un membre peut modifier un pick après hydratation sans renvoyer les statistiques.

Résultats : **42 tests TypeScript/PostgreSQL, 10 tests Python et huit parcours navigateur passent**, ainsi que le build de production. Le SQL réellement produit par le programme Python de publication a aussi été exécuté dans PostgreSQL simulé, avec essai d’une promotion incomplète puis complète.

La migration 007 a été appliquée au projet Supabase vérifié `zsmpdkjfjqgtjinzoexv`. Lecture de contrôle après application : **quatre salles conservées, zéro salle avec statistiques inline, un instantané partagé prêt, quinze fragments, zéro pointeur vers une source réelle**. Les trois nouvelles tables ont RLS activé. Les parcours navigateur exécutés concernent la démo locale ; ils ne constituent pas un test multi-navigateur du service Realtime hébergé.

## 4. Couverture et coût en requêtes

Pour 173 champions et cinq rôles, la borne théorique est :

```text
173 × 5 × 172 × (5 rôles adverses + 4 autres rôles alliés)
= 1 339 020 relations directionnelles potentielles
```

Il ne s’agit **pas** de 1 339 020 requêtes HTTP. Une page pourrait fournir de nombreuses relations. Mais le nombre de pages utiles ne peut pas encore être mesuré depuis cet environnement.

- **865 pages** correspond à l’hypothèse de 173 × 5 pages fournissant chacune les deux ensembles complets. Elle n’est pas confirmée.
- Si plusieurs sections, groupes ou pages paginées nécessitent des accès supplémentaires, le coût augmente. Leur présence et leurs mécanismes ne sont pas encore observés.
- Les combinaisons marginales doivent être exclues à partir de rôles réellement présents et des filtres observés ; elles ne sont pas supprimées à partir d’une supposition sur la « méta ».
- Le seuil de 100 parties et les filtres de présence impliquent une matrice creuse. Une relation absente ne doit jamais devenir zéro.
- Une fenêtre glissante de 14 jours crée un nouvel instantané quotidien, pas autant de nouvelles observations indépendantes.

**Mesure réelle actuelle : zéro page statistique reçue, zéro ligne Against/Synergy vérifiée.** Le manifeste et le cache peuvent enregistrer des comptes exacts dès qu’un adaptateur validé fournit les lignes. Aucun benchmark de 1,34 million d’observations n’a été effectué ; la limite du builder est actuellement 2 millions de lignes, ce qui est une limite de validation, pas une garantie de performance.

## 5. Étape expérimentale restante

Une fois le domaine accessible :

1. Vérifier les règles d’accès et consulter les pages publiques des trois couples, avec les filtres demandés visibles.
2. Comparer HTML initial, JSON embarqué et rendu navigateur. Observer les mécanismes de chargement ; ne pas appeler un endpoint explicitement privé/interdit pour obtenir les valeurs manquantes.
3. Relever, pour chacun, plusieurs valeurs Against et Synergy de rôles différents avec nombre de parties, ainsi qu’un zéro réel s’il existe et des absences. Conserver captures et HTML datés.
4. Identifier les colonnes par leurs étiquettes et leur structure vérifiée. Un champ `wr_delta` ou une différence de winrates ne suffit pas.
5. Comparer chaque échantillon au rendu affiché et compter toutes les lignes accessibles par page/groupe, la pagination éventuelle et les requêtes réellement nécessaires.
6. Implémenter l’adaptateur source uniquement à partir de cette structure constatée, puis exporter le contrat du pipeline. Avant une collecte quotidienne exhaustive, établir que les conditions d’accès/réutilisation la permettent.

La licence MIT du wrapper porte sur son code. Elle ne constitue pas une autorisation de réutilisation des données. La restriction d’API privée évoquée dans la demande n’a pas pu être relue depuis cet environnement ; elle ne doit être ni ignorée, ni étendue par supposition à toute lecture publique du HTML. Si la source ne permet pas l’usage voulu, le cache et l’import restent utilisables avec un export autorisé d’une autre source fournissant réellement le même indicateur.

## 6. Reproduire et activer

```sh
# Validation du pipeline, sans accès réseau et sans dépendances Python
python3 -m unittest discover -s tests/statistics -v

# Premier diagnostic public ; s'arrête si le proxy ou robots refuse l'accès
python3 scripts/statistics/probe.py --output /tmp/lolalytics-probe

# Un export autorisé a les métadonnées du JSON existant, context et pairs
python3 scripts/statistics/pipeline.py build export.json --output statistics-cache
python3 scripts/statistics/pipeline.py verify statistics-cache/IDENTIFIANT_SHA256

# Après la migration 007 ; secrets configurés dans l'environnement, jamais VITE_*
python3 scripts/statistics/publish.py statistics-cache/IDENTIFIANT_SHA256

npm test
npm run build
PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/usr/bin/chromium npm run test:e2e
```

Pour le workflow quotidien : secret GitHub `STATISTICS_IMPORT_URL` vers l’export autorisé ; secret `SUPABASE_ACCESS_TOKEN` ; variable `SUPABASE_PROJECT_REF` pour le projet cible ; variable `STATISTICS_REFRESH_ENABLED=true` après validation de la source. Le jeton administratif reste hors du frontend et hors du dépôt. Une exécution défaillante ne remplace pas le pointeur distant courant. Ne pas rejouer les anciennes migrations pour installer 007.
