# Acquisition réelle Against et Synergy

> **Reprise du cycle de vie :** voir [LIFECYCLE.md](LIFECYCLE.md) pour l’audit du dépôt, la rétention reconstituée, les tests et les limites de publication de cette nouvelle session.

> **Publication effectuée :** les 865 fragments réels sont promus dans Supabase et leurs contenus sont vérifiés ; le code est poussé sur `main`, CI verte. Le contrôle Netlify dans le navigateur et la configuration GitHub du quotidien attendent les domaines réseau manquants. Voir le [statut de production](PRODUCTION.md).

Les deux relations sont maintenant extraites de réponses réelles Lolalytics, normalisées dans le format existant puis construites et vérifiées par le pipeline. Le moteur de scoring, ses poids et l’interface restent inchangés.

**Choix retenu : une page Build publique pour les cinq rôles adverses, une réponse `build-team` du site pour les quatre rôles alliés, par champion/rôle candidat.** Aucun calcul de Delta 2 depuis les winrates, aucune division par 100, aucun repli vers un autre rôle, aucune symétrie ou paire inventée. Les seuils Lane/Games/Pick sont tous à zéro ; les nombres de parties restent dans chaque observation. Le contexte conservé est Emerald+, Solo/Duo, Global, 14 jours.

## Preuves réelles

- Trois couples vérifiés : Renekton Top, Ahri Mid, Jhin Bottom.
- **2 518 observations Against + 2 003 observations Synergy**, soit 4 521 observations dans le snapshot local du POC, contrôlé par `pipeline.verify`.
- **228 cellules Synergy comparées exactement** au JSON réellement reçu par le navigateur (76 par champion, quatre rôles). Preuve et exemples : [live-synergy-verified.json](live-synergy-verified.json).
- La comparaison Against précédente demeure valable : 285 cellules du DOM et 278 concordances entre le parser Hextech Counters et notre parser Build.
- Un test d’import et de draft réelle affiche **+1,36** pour Renekton Top contre Ambessa Top (+2,09) et avec Lee Sin Jungle (−0,10), selon les poids existants. Aucun appel à Lolalytics pendant la draft.
- Le SQL produit par le publisher est exécuté dans PostgreSQL local simulé sur des paires réellement observées : promotion, résolution du snapshot pour une nouvelle salle, hydratation et maintien de l’ancien snapshot d’une salle existante. Ce test n’est pas une publication sur Supabase hébergé.

## Résultat exhaustif de cette session

| Mesure | Résultat |
| --- | ---: |
| Champions / couples champion-rôle demandés et traités | 173 / **865 sur 865** |
| Observations Against | **433 233** |
| Observations Synergy | **353 471** |
| Total des observations réelles | **786 704** |
| Dont moins de 100 parties, conservées | **610 253** |
| Vrais zéros | **464** |
| Fragments / maximum de paires dans un fragment | 865 / 1 537 |
| Taille des fragments JSON / gzip | 108 687 811 / 6 799 398 octets |

Le snapshot vérifié est `0551fd06485293f646720494eef5e1a4158aca434145a860ac66028fb5ebf0fb`.
L’archive portable locale `statistics-cache/lolalytics-2026-11-12.tar.gz` contient les fragments, leur manifeste, le pointeur et la provenance des réponses. Elle fait 7 035 576 octets. Son SHA-256 est `9f07003435fc1a8a6bab7bfa341a97ff049243c52f8fcb2efbaf400786a8ec8d`. Les gros corpus et captures brutes ne sont pas versionnés dans Git.

La reprise a été exercée sur ce run réel : première partie séquentielle, interruption puis reprise des réponses vérifiées, sans recommencer les téléchargements acquis. Le run est ensuite allé au bout avec deux workers et le débit global limité. Les 1 730 URL de données distinctes représentent exactement deux sources par couple demandé ; les contrôles robots sont distincts. Aucune des 865 cibles n’a été omise.

La collecte exhaustive et ses volumes réels sont consignés dans [full-acquisition-summary.json](full-acquisition-summary.json). Elle demande les **173 champions du catalogue local × cinq rôles**, sans exclure les rôles marginaux, puis vérifie l’ensemble du snapshot. « Exhaustive » décrit les 865 demandes de couples : une paire absente de Lolalytics reste manquante, et la couverture n’est jamais artificiellement complétée jusqu’à la borne théorique de 1 339 020 relations.

Captures Synergy : [Renekton](evidence/renekton-synergy.png), [Ahri](evidence/ahri-synergy.png), [Jhin](evidence/jhin-synergy.png). Les portraits restent absents à cause du domaine CDN bloqué ; les noms, rôles et nombres sont lisibles. Les fixtures versionnées sont de petits extraits réels, et les corruptions/réponses artificielles des tests portent explicitement cette distinction.

## Collecteur opérationnel

```sh
# POC réel complet des deux relations
python3 scripts/statistics/collect_lolalytics.py \
  --candidate renekton:top --candidate ahri:middle --candidate jhin:bottom \
  --output statistics-cache/poc

# Catalogue entier × cinq rôles, sans filtre
python3 scripts/statistics/collect_lolalytics.py \
  --all --output statistics-cache/run-2026-11-12

# La même commande reprend le même run après une interruption.
# Un run de plus de 48 heures exige un nouveau répertoire.
```

Le registre champion ID → slug est lu dans les données Qwik du site et confronté aux 173 IDs locaux. Aucun slug n’est deviné à partir du nom affiché. Le rôle demandé et l’ID du candidat sont contrôlés dans les données Build. Synergy exige les colonnes `id/wr/d1/d2/pr/n`, une réponse valide et exactement les quatre rôles attendus.

Le débit global est limité : intervalle par défaut **une seconde entre débuts de requêtes**, au maximum deux requêtes en vol. Le run exhaustif de cette session utilise 0,5 seconde entre débuts de requêtes, soit au plus deux départs par seconde. Les redirections sont refusées, robots est vérifié et TLS reste actif. Aucun compte, cookie d’authentification ou mécanisme de contournement n’est utilisé.

Chaque réponse est conservée en gzip dans le répertoire ignoré `statistics-cache`, avec URL, date HTTP, date de capture et SHA-256. La reprise relit et vérifie ces réponses au lieu de les télécharger à nouveau. Cache altéré ou trop ancien : échec explicite. Les 429 respectent `Retry-After` avec refroidissement partagé entre les deux workers ; les erreurs transitoires sont réessayées au plus trois fois. Un 403 n’entraîne aucune tentative de contournement.

Le snapshot et son pointeur ne sont construits qu’après succès de toutes les cibles demandées. Une collecte échouée conserve le dernier snapshot valide. Les fichiers produits :

- `acquisition.json` : demandes, réponses et comptes par champion/rôle ;
- `dataset.json` : export normalisé réel, `fictional:false` ;
- `snapshots/current.json` : référence immuable ;
- `snapshots/<SHA256>/manifest.json` et fragments `.json.gz` : format portable du pipeline existant.

Le fichier complet dépasse les limites de l’import manuel du navigateur. **Il est destiné au publisher et au cache partagé**, qui servent les fragments utiles aux salles. Le navigateur ne télécharge pas le corpus complet.

## Rafraîchissement et publication

```sh
# Vérifier un snapshot local — aucun secret ni réseau
python3 scripts/statistics/pipeline.py verify statistics-cache/RUN/snapshots/SHA256

# Publication distante distincte, avec les variables backend déjà configurées
python3 scripts/statistics/publish.py statistics-cache/RUN/snapshots/SHA256

# Rafraîchir tout le catalogue puis publier atomiquement, dans un job backend
STATISTICS_SOURCE=lolalytics python3 scripts/statistics/refresh.py
```

Les deux dernières commandes écrivent dans Supabase et nécessitent `SUPABASE_PROJECT_REF` et `SUPABASE_ACCESS_TOKEN`. Le mode quotidien refuse de commencer sa collecte si ces variables manquent. Les écritures sont regroupées en lots dont le corps JSON est borné à 900 000 octets ; un refus de taille 413/503 provoque une subdivision du lot. La vérification du corpus précède la publication ; le pointeur distant est promu seulement après chargement et vérification de tous les fragments. Les salles déjà ouvertes gardent leur snapshot.

Le workflow `statistics.yml` sait maintenant utiliser ce collecteur directement (`STATISTICS_SOURCE=lolalytics`, valeur par défaut dans le workflow). Le mode `export` reste disponible avec `STATISTICS_IMPORT_URL`. La planification existante de 06:17 UTC, soit **07:17 en Suisse en novembre**, garde sa condition `STATISTICS_REFRESH_ENABLED=true`. Ce travail n’a pas modifié les variables/secrets GitHub ni activé de planification distante.

La CI exécute désormais aussi la suite Python. Vérifications de cette session : **31 tests Python, 44 tests TypeScript/PostgreSQL, neuf parcours navigateur, build réussi**. Les tests de reprise, cache altéré/expiré, 429/403, échec avant publication et immutabilité sont inclus.

Le publisher a aussi été exécuté en **dry-run sur le corpus complet** : 160 instructions générées pour les 865 fragments, taille maximale d’un corps JSON HTTP de 899 305 octets, zéro requête externe. Voir [publisher-dry-run.json](publisher-dry-run.json). Ce contrôle vérifie la préparation de la publication complète ; il ne prétend pas qu’une promotion distante a eu lieu.

## Source et statut de livraison

L’accès est **non officiel**. Le site répond sans authentification aux requêtes utilisées par son interface, mais l’[avis de a1](evidence/a1-access-notice.txt) réserve l’API aux visiteurs et limite la réutilisation par des tiers. Le succès technique et le mandat de développement ne constituent pas une licence de données. Cette restriction reste documentée ; aucun droit de redistribution n’est revendiqué. Les anciens rapports s’arrêtaient avant les essais directs de Synergy ; ils sont historiques et ne décrivent plus la capacité technique actuelle.

Le code et les artefacts réels sont préparés et testés localement. Aucune migration n’a été rejouée, aucun code n’a été poussé et aucun dataset n’a été promu sur le service distant pendant cette tâche.

Le build produit aussi `/deployment.json` (commit et date du build, sans secret), avec `Cache-Control: no-cache`, afin de vérifier quelle révision Netlify sert réellement.
