# Production — cycle de vie officialisé le 12 novembre 2026

L'utilisateur a autorisé la publication dans cette session. La branche
`wip/statistics-lifecycle` a été intégrée à `main` et Netlify sert le nouveau
frontend. La migration 008 et les deux jobs `pg_cron` sont installés dans le
projet vérifié `zsmpdkjfjqgtjinzoexv`, `NicoHelemon's Project`, `ACTIVE_HEALTHY`.

**Le site, sa maintenance et le rafraîchissement quotidien sont opérationnels.
Le nouveau jeton GitHub est validé, le passage complet 865/865 a réussi et le
nouveau snapshot a été promu puis vérifié sur le vrai site.**

## Déploiement et données préservées

- Livraison initiale du cycle de vie : `a7956fd`.
- Correctif du contrôle Actions et du test navigateur : `d13ebdf`.
- Visibilité de l’activation quotidienne dans le précontrôle : `1ef400a`.
- Renouvellement de présence réellement envoyé à Supabase : `2729cb3`.
- Ces révisions ont été constatées sur `/deployment.json` du site public.
- Migration 008 appliquée une seule fois, sans rejouer 001–007.
- Avant application : sauvegarde privée locale des salles, dépendances,
  métadonnées et fragments non courants ; corpus courant archivé séparément.
- Les **880 empreintes de fragments** (865 courants et 15 historiques) sont
  identiques avant migration, après migration et après la maintenance initiale.
- Aucune modification du moteur de scoring, de ses poids ou du collecteur.

Le snapshot courant est désormais :
`83a505ceed4690136c3cedaa67eff2a306c3956e724477d40bebd91bc07f131c`.
Il contient **865 fragments, 786 720 observations réelles** :
433 249 Against et 353 471 Synergy, `fictional:false`.
La promotion a été constatée le 12 novembre vers **23:10 en Suisse**
(22:10 UTC), après collecte et vérification complètes.
Les seuils Lane/Games/Pick restent à zéro. L'ancien snapshot réel conserve ses
865 empreintes inchangées pendant sa transition d'une heure. L'ancien import
de démonstration, 15 fragments non référencés et retirés depuis plus d'une heure,
a été effectivement purgé par cron à 22:00 UTC ; le snapshot réel courant est
resté intact. Aucun reset de base ni suppression d'identité Auth.

Les cinq salles anciennes ont été sauvegardées puis vérifiées comme inactives
depuis plus de deux heures. Elles ont été supprimées par la politique approuvée,
avec leurs dépendances. Les essais hébergés ont utilisé des salles privées
jetables, nettoyées ensuite. Aucune identité Auth n'a été effacée.

## Maintenance réellement installée

| Job | Horaire UTC | Effet |
| --- | --- | --- |
| `draftroom-statistics-maintenance` | Toutes les dix minutes | Expiration des salles et purge des snapshots éligibles |
| `draftroom-statistics-log-retention` | 03:43 chaque jour | Sept jours de journaux, uniquement pour les deux jobs Draftroom |

Les deux jobs sont actifs sous `postgres`. La première exécution automatique
de maintenance a réussi le 12 novembre à 21:00 UTC (22:00 en Suisse), en environ
11 millisecondes. Les fonctions administratives
`maintain_statistics` et `statistics_health` sont inaccessibles aux rôles web
`anon` et `authenticated`, vérification effectuée sur le service hébergé.
La rétention exacte et ses délais sont décrits dans [LIFECYCLE.md](LIFECYCLE.md).
La tâche de purge des journaux sera exécutée à son prochain horaire quotidien ;
son activation ne constitue pas une exécution déjà observée.

## Vérification du nouveau snapshot après la première actualisation

Le passage [43311641996](https://github.com/NicoHelemon/lol_drafter/actions/runs/43311641996)
est **success**, collecte et publication comprises. Les journaux contiennent
les 865 cibles terminées et le résultat du publisher concorde avec
`statistics_health()` : identité, fragments, total et deux relations.
Aucune publication incomplète ne reste en base.

Une salle privée créée avant la promotion a conservé sa référence au snapshot
`0551fd…`, y compris après rechargement. Une salle créée après a reçu `83a505…`,
sans paires inline. Les deux salles ont ensuite été quittées et supprimées.

Un nouveau contrôle du score sur le site a lu les fragments du snapshot promu :
Renekton Top contre Ambessa Top **+2,11**, avec Lee Sin Jungle **−0,15**,
soit **+1,36**, détail 2/2 paires. Score conservé après rechargement,
quatre lectures de fragments Supabase et **zéro appel navigateur à Lolalytics**.
La salle de test a été supprimée. Le calcul et les coefficients n'ont pas changé.

Preuve complète : [daily-refresh-verified.json](daily-refresh-verified.json).

## Vérifications hébergées lors du déploiement initial

Un navigateur Chromium, utilisant explicitement la clé publique de l'autorité
TLS du proxy de cet environnement, a vérifié :

1. Révision servie par Netlify et création d'une salle privée avec le snapshot réel.
2. État persistant sans paires inline ; lecture des seuls fragments Supabase.
3. Renekton Top contre Ambessa Top (+2,09) avec Lee Sin Jungle (−0,15) :
   **score +1,34**, conforme aux poids existants, détail **2/2 paires**.
4. Score préservé après rechargement ; zéro requête vers Lolalytics depuis la draft.
5. Quit et disparition de la salle de test.

Un second essai avec deux identités anonymes réellement distinctes a vérifié
l'invitation privée et la synchronisation d'un rôle entre les navigateurs.
La salle de test a ensuite été artificiellement vieillie, puis expirée par
`maintain_statistics(false)`. Les deux navigateurs sont revenus à l'accueil,
avec notification anglaise, sélection fermée et référence locale effacée.
Une nouvelle salle a pu être créée puis quittée normalement.
Les tables salle/membres/invitation/échanges ne conservaient aucune dépendance
de cette salle de test après suppression.

## Renouvellement de présence corrigé

Le contrôle prolongé d'une salle témoin a révélé un appel `rpc(heartbeat)`
construit mais jamais exécuté : les builders PostgREST sont des thenables
paresseux. `void` seul n'envoie aucune requête. Le correctif `2729cb3` consomme
explicitement le résultat avec `.then`, vérifie les erreurs et préserve le retour
à l'accueil lorsqu'une salle disparaît. Deux tests ciblés ont été ajoutés.

Vérification réelle après déploiement : requête `/rpc/heartbeat` observée,
réponse **204**, et dernière présence âgée d'environ **5,7 secondes après
25 secondes** d'ouverture de salle. La CI [43309989600](https://github.com/NicoHelemon/lol_drafter/actions/runs/43309989600)
est verte. Une salle ouverte peut ainsi rester active au-delà du délai
inactif de deux heures, dans la limite absolue prévue de 24 heures.

## GitHub Actions : incident initial puis jeton corrigé

La CI complète passe : **39 tests Python, 59 tests applicatifs/PostgreSQL,
11 parcours navigateur, build réussi**, plus actionlint local.

Le lancement de publication
[43304876138](https://github.com/NicoHelemon/lol_drafter/actions/runs/43304876138)
a échoué **avant la collecte et toute promotion**, au premier appel administratif
Supabase, avec **HTTP 401 Unauthorized**. Le snapshot courant reste intact.
Le jeton de l'environnement Codex, lui, fonctionne pour les mêmes opérations.

Le premier contrôle en lecture seule avait terminé vert à tort : le shell par
défaut renvoyait le succès de `tee` malgré l'échec Python. Le correctif `d13ebdf`
écrit d'abord l'audit dans un fichier ; un échec arrête maintenant le job et
empêche la publication dépendante. Les affirmations antérieures de validation
des accès GitHub/Supabase par ce premier run sont donc corrigées.

La tentative de mise à jour du secret `SUPABASE_ACCESS_TOKEN` depuis Codex est
refusée : **HTTP 403, Resource not accessible by integration**, lors de la lecture
de la clé publique des secrets du dépôt. Aucun secret n'a été modifié.
Le propriétaire a ensuite remplacé lui-même le secret par un jeton de gestion
valide, sans le copier dans le chat. Le [précontrôle 43308157993](https://github.com/NicoHelemon/lol_drafter/actions/runs/43308157993)
a réellement réussi : requête d'audit exécutée, 865 fragments et 786 704 paires
lues, 008 et cron confirmés. Le jeton de Codex reste fonctionnel séparément.

Le rafraîchissement [43308233633](https://github.com/NicoHelemon/lol_drafter/actions/runs/43308233633)
a ensuite collecté 520 couples sur 865 avant une réponse source tronquée
(`http.client.IncompleteRead`). Aucune promotion ni modification du courant.
L'entretien après échec a réussi, et la salle témoin a été supprimée.

Le correctif `fd172a7` ajoute cette coupure aux erreurs réseau réessayées, avec
la même limite de trois tentatives. Une réponse partielle n'entre jamais dans
le cache ; le test vérifie réussite après troncature, épuisement des trois
essais et absence de cache partiel. Les 403 et les erreurs de validation restent
bloquants. La CI [43311590931](https://github.com/NicoHelemon/lol_drafter/actions/runs/43311590931)
est verte. Le second passage complet
[43311641996](https://github.com/NicoHelemon/lol_drafter/actions/runs/43311641996)
a réussi avec précontrôle vert, 865/865 cibles traitées puis publication
complète. Les réponses tronquées sont désormais réessayées dans la limite
prévue, sans mettre de contenu partiel en cache. Les observations détaillées
de la nouvelle promotion sont consignées plus haut. Le précontrôle corrigé
[43306087734](https://github.com/NicoHelemon/lol_drafter/actions/runs/43306087734)
a confirmé **`STATISTICS_REFRESH_ENABLED=true`**, puis échoué explicitement sur
le HTTP 401 ; son job de publication a été ignoré. Cela vérifie que le correctif
ne masque plus le refus d'accès. La planification reste à 06:17 UTC, soit
07:17 en Suisse en novembre.

La maintenance Supabase fonctionne indépendamment de la collecte GitHub.
Voir [lifecycle-production-verified.json](lifecycle-production-verified.json)
pour les preuves machine de cette mise en production, et
[production-database-verified.json](production-database-verified.json) pour la
preuve historique de publication du corpus initial.
