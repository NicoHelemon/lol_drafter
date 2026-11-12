# Comparaison des collecteurs — 12 novembre 2026

> **État courant :** le [pipeline réel Against + Synergy](LIVE_PIPELINE.md) est implémenté et testé sur de vraies réponses, avec 228 cellules Synergy comparées au navigateur. Les anciens blocages techniques et résultats limités aux mocks ci-dessous sont historiques. Aucun seuil Lane/Games/Pick n’est appliqué aux nouveaux exports.

**Choix technique : conserver notre lecteur Qwik des pages Build pour Against, partager son normaliseur strict entre les deux relations, et utiliser RabadonGG comme référence du format Synergy, testé uniquement par mocks.** Hextech constitue une bonne seconde implémentation indépendante pour vérifier Against. Aucun cache SQLite ni moteur de scoring tiers n’est repris.

Les seuils indicatifs sont retirés : Min Lane, Min Games et Min Pick valent désormais zéro dans le contexte des **nouveaux exports**. Emerald+, Solo/Duo, Global et 14 jours restent le contexte de comparaison. Chaque ligne conserve les deux champions, les deux rôles, la relation, Delta 2 en points de pourcentage et le nombre entier de parties. Une paire absente reste absente. Le screenshot utilisateur illustre Patch 16.22 ; nos captures sont sur la fenêtre glissante `patch=14`, leurs nombres ne doivent donc pas être comparés directement.

## Dépôts réellement examinés

| Projet | Révision figée | Résultat |
| --- | --- | --- |
| [RabadonGG](https://github.com/Kuderic/RabadonGG/tree/848eb8a7274d488a5f54b68e282d255b7cbd9397) | `848eb8a7274d488a5f54b68e282d255b7cbd9397` | `scraper.py`, `lolalytics_client.py`, cache DB, architecture et tests examinés. Cinq requêtes `counter`, une `build-team` par candidat/rôle sur cache froid, hors catalogue. |
| [Hextech Studies](https://github.com/githubpsyche/hextech-studies/tree/fed9bc6af990bc27cd40b81f406125bca2a42a8f) | `fed9bc6af990bc27cd40b81f406125bca2a42a8f` | `projects/counterpick-coverage/build.py` et ses tests examinés. Extraction Qwik des pages publiques `/counters/`, avec rôle adverse fixé au rôle du candidat. |

RabadonGG n’a **aucun fichier de licence identifié dans l’arbre versionné** de cette révision ; lire/exécuter localement ses tests ne justifie pas de copier son implémentation dans notre produit. Hextech est sous MIT, copyright 2026 Jordan Gunn : une reprise substantielle nécessiterait de conserver son avis. Aucun code tiers n’a été incorporé : le harnais importe les checkouts temporaires à leurs révisions contrôlées, et notre lecteur Qwik existait avant cette comparaison. La licence d’un outil ne couvre pas les droits sur les données Lolalytics.

Les autres noms du texte fourni n’ont pas été traités comme des preuves de fonctionnement. La comparaison se concentre sur les deux dépôts identifiés par URL et fichiers précis.

## Tests exécutés, avec réseau interdit pour les mocks

1. **Tests amont RabadonGG : 25 réussites**, fichiers `test_scraper.py` et `test_lolalytics_client.py`, sockets bloquées.
2. **Tests amont Hextech : 16 réussites**, fichier `test_build.py`, sockets bloquées. Ces tests incluent des calculs propres à Hextech ; leur modèle n’est pas repris.
3. **Harnais comparatif propre au projet** : exécution des véritables fonctions des deux dépôts. Transport HTTP simulé pour RabadonGG ; six HTML publics sauvegardés pour Hextech et notre lecteur. Aucun endpoint privé n’est appelé.
4. **Tests locaux : 24 Python et 42 TypeScript/PostgreSQL réussis**, build réussi. Cinq nouveaux tests couvrent le normaliseur commun et le passage au pipeline sans seuil. Le test de faible volume de l’inspecteur a été adapté pour vérifier la conservation d’une ligne à 99 parties.

Le [résultat machine](collector-method-results.json) sépare clairement données publiques et réponses **entièrement synthétiques** de l’API. Les assertions du harnais échouent si la requête simulée, l’unité, les rôles ou les comparaisons réelles divergent.

### Résultat réel : Against

Les six réponses HTTP 200 comprennent, pour chaque champion, une page Build et une page Counters au même contexte. L’extracteur Hextech non modifié est appelé avec un catalogue complet d’IDs locaux, afin de ne pas masquer des lignes simplement absentes de son roster de tier list.

| Candidat | Lignes Counters lues par Hextech | Concordances exactes `d2` + `n` avec Build | Lignes Build, cinq rôles, sans seuil | Dont moins de 100 parties |
| --- | ---: | ---: | ---: | ---: |
| Renekton Top | 101 | 101 | 822 | 434 |
| Ahri Mid | 106 | 106 | 843 | 394 |
| Jhin Bottom | 71 | 71 | 853 | 328 |
| Total | **278** | **278** | **2 518** | **1 056** |

Les pages Counters reçues présentent un minimum de 100 parties. Retirer notre seuil local ne restaure pas ce qui n’y est pas fourni. Les pages Build incorporent au contraire des observations jusqu’à **une partie**, dans les cinq groupes de rôles adverses. C’est donc la meilleure voie publique observée pour l’objectif de couverture maximale.

Le Qwik de Build utilise `enemy_h = [id, wr, d1, d2, pr, n]`. Hextech lit les objets `cid, vsWr, n, d1, d2, allWr, defaultLane` des pages Counters. Les deux méthodes lisent des `d2` fournis par la source ; elles ne reconstruisent pas le Delta 2 depuis des winrates. Les 278 concordances constituent un contrôle croisé entre deux routes et deux implémentations ; les 285 comparaisons au DOM de la [première expérience](PUBLIC_POC.md) restent une preuve distincte.

**Étendre Hextech tel quel ferait perdre de la couverture** : son contexte impose `vsLane == lane`, et son extraction ignore les adversaires hors roster. Sa structure Qwik est instructive, mais son collector same-lane et son modèle de prior/complémentarité ne correspondent pas à notre périmètre. Notre normaliseur conserve les mêmes IDs dans plusieurs rôles avec des clés directionnelles distinctes.

### Résultat simulé : Synergy et RabadonGG

Le vrai `LolalyticsClient` est exécuté avec `httpx.MockTransport`. La simulation produit exactement **six requêtes** sur un cache froid : cinq `counter` distinguées par `vslane`, une `build-team`. Les paramètres simulés comprennent `patch=14`, `tier=emerald_plus`, `queue=ranked`, `region=all`. Il ne s’agit pas de six requêtes réussies contre Lolalytics, ni d’une mesure de débit du service.

Les tables `team.{lane}` sont interprétées par RabadonGG comme `[id, wr, d1, d2, pr, n]`. Le mock utilise volontairement des deltas et nombres de parties artificiels et petits.

Deux différences importantes sont démontrées :

- **Unités** : `d2=1.25` devient `0.0125` dans la sortie de RabadonGG. C’est cohérent avec son propre moteur, mais incompatible avec le nôtre. Notre normaliseur conserve `1.25` point de pourcentage et le nombre de parties intact.
- **Rôle Synergy manquant** : avec Ahri seulement dans le groupe `middle`, demander Ahri `support` renvoie tout de même sa valeur Mid dans RabadonGG. Le harnais reproduit ce comportement. Notre normaliseur laisse la paire Support absente et conserve uniquement la paire Mid. Les zéros ne déclenchent pas de repli ; `null` reste manquant.

Le normaliseur commun local accepte les tables des deux relations, avec schéma explicite et contrôles de types, rôles, doublons et nombres finis. Il refuse les synergies de même rôle, conformément au modèle de draft à cinq postes, ainsi que les rôles inconnus. **Son support de la structure Synergy est prouvé sur mocks, pas sur une réponse actuelle de Lolalytics.** Aucun vrai Delta 2 Synergy nouveau n’est revendiqué.

## Accès, architecture retenue et coût

Le texte fourni n’apporte pas de nouvelle autorisation d’accès aux données. L’[avis déjà constaté sur a1](evidence/a1-access-notice.txt) indique une API privée réservée aux visiteurs du site et interdit son utilisation par des tiers. Aucun endpoint privé n’a été testé en direct. La mise en ligne du code RabadonGG ne démontre ni permission de réutilisation, ni fonctionnement actuel du service. Le HTML public est utilisé ici pour une expérience limitée ; son intégration ou redistribution en production reste à clarifier également.

Architecture retenue :

1. **Acquisition distincte de la normalisation** : Against depuis une page publique Build ; Synergy depuis un export autorisé ou une source dont les conditions permettent l’usage. Le format `build-team` peut être pris en charge si cet accès est accordé, sans changer les clés métier.
2. **Normalisation commune** : `{relation, candidateChampionId, candidateRole, otherChampionId, otherRole, delta2, games}`, sans seuil de popularité/parties, sans repli de rôle ou division par 100.
3. **Pipeline et cache partagé existants** : snapshots immuables, fragments champion/rôle, salles épinglées. Les tests font passer les deux relations synthétiques avec 1 et 7 parties dans le builder et le verifier. Le publisher continue de refuser les données fictives.
4. **Aucune collecte déclenchée par salle** : pas de reprise de l’architecture de requêtes à la demande de RabadonGG, ni de son cache SQLite additionnel, ni de ses pénalités de sample.

Pour Against, les trois réponses Build utiles contiennent les cinq groupes : **une réponse utile par candidat/rôle**, hors robots et validation navigateur. Si une réponse Synergy autorisée fournissait tous les groupes alliés, deux réponses par couple seraient une piste plus économique que les six appels de RabadonGG. Cela reste une hypothèse pour l’ensemble Against + Synergy : couverture Synergy et coûts globaux non mesurés. Les 5 190 appels du texte sont donc un calcul sur l’architecture de RabadonGG, pas une nécessité démontrée pour notre projet.

## Changements locaux et reproduction

`inspect_lolalytics.py` expose `normalize_groups`, partagé entre l’extraction Against et les tests Synergy. Le seuil local `games >= 100` est retiré. La sortie reste un audit expérimental non publiable ; le retrait des seuils ne résout pas l’autorisation ou la validation réelle de Synergy.

`pipeline.py` accepte un nouveau contexte avec `minLanePercent=0`, `minGames=0`, `minPickPercent=0`. Les observations avec zéro partie ne sont acceptées que si elles sont effectivement fournies, avec un entier non négatif ; aucune ligne n’est créée pour remplir la matrice. L’ancien contexte 2/100/0 reste lisible et vérifiable avec son propre minimum déclaré afin de préserver les snapshots immuables existants. Le cohorte/statistique attendue reste contrôlée : pas d’acceptation silencieuse d’une autre période, région, queue, métrique ou unité.

Le script de comparaison ne dépend d’aucun secret et bloque les sockets. Ses dépendances supplémentaires sont **réservées à la revue**, dans un venv temporaire : `requests`, `parsel`, `httpx`. Aucun nouveau package Python n’est requis par le pipeline ou le frontend.

```sh
# Dans le checkout existant ; pas de scrape global ni d'appel privé
python3 -m venv --system-site-packages /tmp/lol-method-review-venv
/tmp/lol-method-review-venv/bin/pip install requests parsel httpx pytest pytest-asyncio

git clone https://github.com/Kuderic/RabadonGG.git /tmp/rabadon-review
git -C /tmp/rabadon-review checkout 848eb8a7274d488a5f54b68e282d255b7cbd9397
git clone https://github.com/githubpsyche/hextech-studies.git /tmp/hextech-review
git -C /tmp/hextech-review checkout fed9bc6af990bc27cd40b81f406125bca2a42a8f

# Acquisition publique limitée : robots + six pages, un accès par seconde
python3 scripts/statistics/probe.py \
  --url 'https://lolalytics.com/lol/renekton/build/?lane=top&patch=14' \
  --url 'https://lolalytics.com/lol/renekton/counters/?lane=top&vslane=top&patch=14' \
  --url 'https://lolalytics.com/lol/ahri/build/?lane=middle&patch=14' \
  --url 'https://lolalytics.com/lol/ahri/counters/?lane=middle&vslane=middle&patch=14' \
  --url 'https://lolalytics.com/lol/jhin/build/?lane=bottom&patch=14' \
  --url 'https://lolalytics.com/lol/jhin/counters/?lane=bottom&vslane=bottom&patch=14' \
  --output /tmp/lol-collector-comparison

# Rejouer sur HTML sauvegardés, avec tout accès réseau interdit dans le harnais
/tmp/lol-method-review-venv/bin/python scripts/statistics/research/compare_collectors.py \
  --rabadon /tmp/rabadon-review --hextech /tmp/hextech-review \
  --pages /tmp/lol-collector-comparison --output /tmp/collector-method-results.json

python3 -m unittest discover -s tests/statistics -v
npm test
npm run build
```

Les dépendances de revue effectivement utilisées étaient requests 2.34.2, parsel 1.12.1, pytest 9.2.0 et pytest-asyncio 1.5.0, avec httpx déjà disponible dans le runtime. La reproduction sur des captures ultérieures peut donner des comptes différents : le harnais conserve les divergences entre pages, sans les corriger ou les transformer en concordances.

Aucun moteur de scoring, poids, composant d’interface, migration ou service distant n’a été modifié. Aucun push, snapshot réel publié ou rafraîchissement planifié activé.
