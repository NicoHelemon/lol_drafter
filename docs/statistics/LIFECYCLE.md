# Reprise et cycle de vie des données

Reprise du 12 novembre 2026 sur `wip/statistics-lifecycle`, depuis `ea11097`.
Le checkout était propre, sans commits inaccessibles retrouvés par `git fsck`.
GitHub ne présentait que `main`, au même commit. Les modifications de rétention
citées dans la passation téléversée étaient toutes absentes ; elles ont été
reconstituées sans réécrire le collecteur, le scoring ou les migrations 001–007.

## Preuve distante en lecture seule

Projet `zsmpdkjfjqgtjinzoexv`, `NicoHelemon's Project`, `ACTIVE_HEALTHY` :
5 salles, 2 snapshots, 865 fragments et 786 704 observations courantes ; identité
courante `0551fd06485293f646720494eef5e1a4158aca434145a860ac66028fb5ebf0fb`.
Ni colonne `retired_at` ni extension `pg_cron` installées. Le corpus et l'archive
locale `statistics-cache/lolalytics-2026-11-12.tar.gz` sont toujours présents.

La CI de `main` est verte : run `43290888022`. Aucun run statistique observé.
La lecture des variables et des noms de secrets via GitHub retourne HTTP 403
`Resource not accessible by integration` : configuration déclarée par
l'utilisateur, non vérifiée. Aucun secret n'a été lu, créé ou modifié.

## Reconstruction locale

- Migration 008 : retrait à la promotion, transition d'une heure, salles après
  deux heures sans présence ou 24 heures absolues, incomplets après 24 heures.
- Snapshot courant protégé ; purge seulement après suppression de ses salles,
  références verrouillées pendant les écritures et données prêtes immuables.
- `maintain_statistics()` prévisualise par défaut, `maintain_statistics(false)`
  exécute ; `statistics_health()` expose un bilan administratif. Fonctions
  interdites à `PUBLIC`, `anon` et `authenticated`.
- Cache navigateur : 128 fragments en LRU, expiration absolue 30 minutes après
  chargement ; requêtes concurrentes partagées, erreurs réessayables.
- Salle disparue : retour à l'accueil, message anglais et état local nettoyé.

Première validation : les 44 tests existants passent avec 008 dans PGlite.
Les tests spécifiques et l'automatisation sont en cours de complément.

Aucune migration appliquée, aucune purge, promotion ou publication frontend
lancée sur le service distant. La branche de production `main` reste inchangée.
