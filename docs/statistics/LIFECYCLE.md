# Reprise et cycle de vie des données

Reprise du 12 novembre 2026 sur `wip/statistics-lifecycle`, depuis `ea11097`.
Ce document décrit le travail de reprise ; les autres rapports conservent leurs
preuves historiques de collecte et de publication.

## État retrouvé

Le checkout était propre, sans commits inaccessibles retrouvés par `git fsck`.
GitHub ne présentait que `main`, au même commit. Les cinq modifications de la
passation téléversée étaient toutes absentes : migration 008, cache, erreur
d'expiration, surveillance des salles et traitement dans l'application.
Elles ont été reconstituées à partir de 007 et des décisions documentées.
Le collecteur Against/Synergy, ses fixtures, le découpage des fragments, le moteur
de score et ses coefficients sont conservés.

Le corpus et l'archive locale `statistics-cache/lolalytics-2026-11-12.tar.gz`
sont présents ; empreinte de l'archive confirmée :
`9f07003435fc1a8a6bab7bfa341a97ff049243c52f8fcb2efbaf400786a8ec8d`.
Le corpus reste hors Git.

## Preuve distante en lecture seule

Projet `zsmpdkjfjqgtjinzoexv`, `NicoHelemon's Project`, `ACTIVE_HEALTHY` :
5 salles, 2 snapshots, 865 fragments et 786 704 observations courantes ; identité
courante `0551fd06485293f646720494eef5e1a4158aca434145a860ac66028fb5ebf0fb`.
Ni colonne `retired_at` ni extension `pg_cron` installées lors de l'audit.

La CI de `main` est verte : [run 43290888022](https://github.com/NicoHelemon/lol_drafter/actions/runs/43290888022).
Le workflow statistique est enregistré et actif ; aucun run statistique observé
au premier audit. La lecture des variables et des noms de secrets via GitHub
retourne HTTP 403 `Resource not accessible by integration` : configuration
déclarée par l'utilisateur, non vérifiée par ces endpoints.
Aucun secret n'a été créé, modifié ou copié dans les logs.

Le lancement manuel [43302888389](https://github.com/NicoHelemon/lol_drafter/actions/runs/43302888389)
a terminé vert avec le job de publication ignoré. **Ce vert ne prouvait pas
l'accès Supabase depuis Actions** : l'audit était envoyé à `tee`, dont le succès
masquait l'échec Python dans le shell par défaut. Le premier lancement réel en
production a établi un HTTP 401 sur le jeton GitHub. Cette erreur d'interprétation
a été corrigée ; l'audit écrit maintenant d'abord dans un fichier et doit réussir
avant toute suite. L'accès administratif depuis l'environnement Codex est vérifié
séparément et fonctionne. Voir [PRODUCTION.md](PRODUCTION.md) pour l'état courant.
La lecture et la modification des secrets restent refusées avec HTTP 403 à
l'intégration GitHub ; la correction du secret nécessite son propriétaire.

## Politique implémentée

| Donnée | Règle |
| --- | --- |
| Snapshot courant | Toujours protégé, même ancien ou sans salle |
| Snapshot remplacé | `retired_at` fixé dans la transaction de promotion ; transition d'une heure |
| Salles sur snapshot retiré | Supprimées après la transition, même avec présence ; elles ne changent jamais de snapshot pendant la draft |
| Toute salle | Expiration après deux heures sans présence d'aucun membre, ou 24 heures après création |
| Import prêt devenu orphelin | Retiré lors de l'entretien, puis une heure de transition |
| Publication incomplète | Purge après 24 heures depuis création, sauf référence/pointeur |
| Cache navigateur | 128 fragments résolus en LRU ; expiration absolue 30 minutes après chargement |
| Journaux cron | Sept jours pour les deux jobs Draftroom uniquement |

La migration 008 n'efface aucune donnée à son installation. Elle attribue un
début de transition aux snapshots prêts non courants déjà présents. Les contenus
et identités des snapshots prêts restent immuables ; seul `retired_at` peut
changer. La purge d'un snapshot exige l'absence de pointeur et de salle restante.
Les références des salles sont verrouillées jusqu'au commit. Maintenance et
promotion sont sérialisées ; les lignes déjà verrouillées sont ignorées par
l'entretien et réexaminées au prochain passage.

`maintain_statistics()` prévisualise par défaut ;
`maintain_statistics(false)` exécute. `statistics_health()` rapporte fraîcheur,
source, contexte, volumes Against/Synergy, salles et publications incomplètes.
Ces fonctions sont interdites à `PUBLIC`, `anon` et `authenticated`.
Aucune identité `auth.users` n'est effacée par cette politique.

Le cache partage les requêtes concurrentes, retire les erreurs pour permettre
une nouvelle tentative et conserve les promesses propres à chaque hydratation :
un besoin de plus de 128 fragments reste entièrement chargé malgré les évictions.
Les requêtes en cours ne sont conservées que jusqu'à leur résolution. Le cache
résolu est vidé en quittant une salle ou lors de sa disparition.

Une salle disparue produit un message anglais, ferme le sélecteur et les
échanges, enlève la référence locale et revient au formulaire de création.
Le polling de secours détecte la disparition en environ 20 secondes si le
navigateur reste actif. Un onglet suspendu peut la constater plus tard.
L'échec réseau est affiché comme reconnexion et ne vaut pas expiration.
Un nouveau visiteur sans siège ne peut pas distinguer par RLS une salle privée
d'une salle absente ; son invitation est vérifiée lors de Join. Une référence
locale connue expirée est nettoyée dès le rechargement.

## Rafraîchissement et automatisation préparés

`refresh.py` effectue un bilan et une maintenance avant la collecte, vérifie le
snapshot complet et sa fraîcheur (48 heures maximum, cinq minutes de tolérance
future), puis contrôle les volumes avant toute publication. Une baisse de plus
de 20 % des fragments, du total de paires, d'Against ou de Synergy fait échouer le
job en conservant le pointeur courant. Un changement de source ou de contexte
exige une revue. Ce seuil protège le corpus global : aucune observation n'est
filtrée par Lane/Pick/Games. Les observations à une ou deux parties sont testées.

La promotion reste atomique après chargement complet. Le bilan distant doit
ensuite correspondre au snapshot, aux fragments et aux paires publiés.
L'entretien s'exécute aussi après succès ou échec ; une erreur d'entretien ne
masque pas l'erreur initiale de collecte/publication.

Le workflow conserve 06:17 UTC (07:17 en Suisse en novembre) et la condition
`STATISTICS_REFRESH_ENABLED=true`. Son lancement manuel utilise maintenant
`publish=false` par défaut : tests Python et audit Supabase en lecture seule.
La publication exige `main`, puis un événement planifié activé ou l'entrée
manuelle `publish=true`. Un lancement sur la branche de travail ne publie pas.
Aucune migration n'est appliquée automatiquement par GitHub Actions.

Le script séparé [install_cron.sql](../../supabase/maintenance/install_cron.sql)
prépare `pg_cron` : entretien toutes les dix minutes et purge des journaux à
03:43 UTC. Il remplace uniquement ses deux jobs nommés si on le rejoue.
Il doit être installé après 008 et revue du dry-run. L'entretien est ainsi
indépendant d'une panne de collecte ou de GitHub Actions.

Commandes administratives préparées, à distinguer par leur effet :

```sh
# Lecture seule, fonctionne même avant 008
SUPABASE_PROJECT_REF=zsmpdkjfjqgtjinzoexv python3 scripts/statistics/maintenance.py --audit

# Après installation de 008 : prévisualisation, sans suppression
python3 scripts/statistics/maintenance.py

# Après revue et autorisation : suppression des éléments éligibles
python3 scripts/statistics/maintenance.py --execute
```

Le jeton de gestion reste dans l'environnement backend. Ne pas rejouer les
migrations 001–007 sur le projet existant, en particulier 004 qui contient une
suppression historique des salles.

## Validation de reprise

Résultats locaux :

| Vérification | Résultat |
| --- | --- |
| Python unittest | 38 tests réussis |
| TypeScript / PostgreSQL PGlite | 57 tests réussis |
| Playwright Chromium | 11 parcours réussis |
| Build TypeScript / Vite | Réussi |
| actionlint 1.7.7 | Deux workflows acceptés |
| Corpus complet préservé | `pipeline.py verify` réussi, identité et volumes inchangés |

Les nouveaux tests couvrent la protection du courant, les limites des délais,
la cascade des dépendances, le dry-run, la purge des incomplets, les permissions,
l'immutabilité, le refus des références expirées, l'échec de promotion,
l'installation de 008 sur une base 007 peuplée sans altérer ses données,
le cache LRU/TTL dépassant sa capacité, les lectures concurrentes dédupliquées et
leurs erreurs, puis l'expiration/recréation d'une salle dans le navigateur.
Un sélecteur erroné du nouveau test navigateur a été corrigé avant le passage
complet vert. Aucun échec résiduel constaté.
Les tests SQL utilisent PGlite ; ils ne prouvent pas un service Realtime hébergé
ni une course entre plusieurs connexions PostgreSQL. Le script pg_cron est
préparé et relu ; son installation et ses exécutions réelles restent à constater.

La CI GitHub complète du code `7884e55` a également réussi :
[run 43302864123](https://github.com/NicoHelemon/lol_drafter/actions/runs/43302864123),
tests Python, applicatifs, build et onze parcours navigateur compris.

## Frontière de production

Aucune migration appliquée, aucune purge ou promotion distante lancée pendant
cette reprise. Aucun changement de secret et aucun push sur `main`.
L'installation 008, l'activation cron et la publication du nouveau frontend
nécessitent l'accord de l'utilisateur, conformément à sa demande actuelle.
L'exécution d'une collecte avec promotion réelle attend également cet accord.
