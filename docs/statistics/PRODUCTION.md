# Production — cycle de vie officialisé le 12 novembre 2026

L'utilisateur a autorisé la publication dans cette session. La branche
`wip/statistics-lifecycle` a été intégrée à `main` et Netlify sert le nouveau
frontend. La migration 008 et les deux jobs `pg_cron` sont installés dans le
projet vérifié `zsmpdkjfjqgtjinzoexv`, `NicoHelemon's Project`, `ACTIVE_HEALTHY`.

**Le site et sa maintenance sont en production. Le rafraîchissement quotidien
GitHub reste bloqué par un jeton Supabase invalide dans les secrets GitHub.**

## Déploiement et données préservées

- Livraison initiale du cycle de vie : `a7956fd`.
- Correctif du contrôle Actions et du test navigateur : `d13ebdf`.
- Visibilité de l’activation quotidienne dans le précontrôle : `1ef400a`.
- Ces révisions ont été constatées sur `/deployment.json` du site public.
- Migration 008 appliquée une seule fois, sans rejouer 001–007.
- Avant application : sauvegarde privée locale des salles, dépendances,
  métadonnées et fragments non courants ; corpus courant archivé séparément.
- Les **880 empreintes de fragments** (865 courants et 15 historiques) sont
  identiques avant migration, après migration et après la maintenance initiale.
- Aucune modification du moteur de scoring, de ses poids ou du collecteur.

Le snapshot courant reste :
`0551fd06485293f646720494eef5e1a4158aca434145a860ac66028fb5ebf0fb`.
Il contient **865 fragments, 786 704 observations réelles** :
433 233 Against et 353 471 Synergy, `fictional:false`.
Les seuils Lane/Games/Pick restent à zéro.

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

## Vérifications contre le vrai site

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

## GitHub Actions : résultat réel et blocage restant

La CI complète passe : **38 tests Python, 57 tests applicatifs/PostgreSQL,
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
Le propriétaire doit remplacer ce secret par un **jeton de gestion Supabase
valide**, dans les [secrets Actions du dépôt](https://github.com/NicoHelemon/lol_drafter/settings/secrets/actions).
Ne pas utiliser de clé anon/publishable, ni copier le jeton dans le chat.

Après confirmation de cette correction, lancer d'abord `statistics.yml` sur
`main` avec `publish=false`, puis avec `publish=true` pour constater une collecte
et une promotion complètes. Le précontrôle corrigé
[43306087734](https://github.com/NicoHelemon/lol_drafter/actions/runs/43306087734)
a confirmé **`STATISTICS_REFRESH_ENABLED=true`**, puis échoué explicitement sur
le HTTP 401 ; son job de publication a été ignoré. Cela vérifie que le correctif
ne masque plus le refus d'accès. La planification reste à 06:17 UTC, soit
07:17 en Suisse en novembre.

La maintenance Supabase fonctionne indépendamment de ce blocage GitHub.
Voir [lifecycle-production-verified.json](lifecycle-production-verified.json)
pour les preuves machine de cette mise en production, et
[production-database-verified.json](production-database-verified.json) pour la
preuve historique de publication du corpus initial.
