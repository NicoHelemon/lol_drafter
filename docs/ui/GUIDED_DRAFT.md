# Modes et progression manuelle

Demande du 15 novembre 2026. Branche `feat/guided-draft-modes`.

La création choisit l'un des deux boutons exclusifs **Ranked draft / Tournament draft**. Le lobby retire Dataset settings, couverture et import de fichier. Le camp allié se choisit sur une grande carte interactive : diagonale haut gauche → bas droite, bleu en bas à gauche, rouge en haut à droite. Le bleu prend le premier pick selon le schéma classique explicitement demandé. L'hôte choisit le camp ; les autres membres voient son choix synchronisé. Le lobby ranked ne permet aucune préparation des candidats ennemis, y compris via les API ; tournament conserve les dix listes.

## Séquences

- Ranked : les deux groupes de cinq bans se renseignent ensemble, puis picks **B1 → R2 → B2 → R2 → B2 → R1**.
- Tournament : bans **B R B R B R**, picks **B1 R2 B2 R1**, bans **R B R B**, picks **R1 B2 R1**.

Chaque groupe de deux picks doit être complet avant confirmation. L'hôte confirme manuellement les étapes ; aucun compte à rebours de draft. Les cases actives et les bans actifs sont signalés, avec une bannière décrivant précisément le tour. Les cases déjà confirmées gardent leur champion ; les réassignations de rôle et déplacements au sein d'une équipe restent possibles car ils conservent l'ensemble des champions. Le consentement existant reste obligatoire pour les échanges entre joueurs.

Previous step revient au groupe précédent pour correction, en retirant les choix d'étapes ultérieures. Il conserve les réassignations de rôles déjà consenties. Les bans vides peuvent être confirmés comme **no ban**. En ranked, un même champion peut être banni par les deux équipes, comme lors des bans simultanés ; un doublon au sein d'une équipe reste interdit. Les bans tournament sont uniques dans la draft.

## Candidats automatiques

Les dix cases de draft affichent au moins cinq choix disponibles, avec complément par popularité du rôle. Le pick actuel est premier, puis les candidats explicitement préparés ; les compléments automatiques suivent l'ordre de popularité et portent une petite étoile. Les candidats explicites indisponibles restent visibles mais n'empêchent pas le complément par cinq choix utilisables. Les suggestions automatiques ne modifient pas les pools enregistrés. Elles excluent les champions déjà pris ou bannis et se réajustent à chaque changement. Sans métadonnées de rôle suffisantes, le repli est alphabétique pour les places restantes, sans inventer de popularité.

Le cache charge aussi les statistiques des compléments automatiques. L'index des contributions est partagé entre les dix cases pour éviter de le reconstruire à chaque rôle. La formule des scores, le shrinkage, la collecte et les modèles restent inchangés.

## Protection et remise à zéro

Migration **014** : validation des bans ranked et trigger contrôlant mode, camp, étapes, historique des confirmations, droits de l'hôte et ensembles de picks/bans autorisés. Une sauvegarde générique ne permet pas de sauter le tour, de réécrire l'historique ni de remplacer un pick confirmé. Les contrôles s'appliquent aussi aux anciennes RPC de déplacements et d'échanges. Le mode est fixé à la création ; le camp est verrouillé au démarrage.

**Nouvelle autorisation utilisateur : les salles et joueurs temporaires peuvent être vidés/supprimés lors des mises à jour. Aucune rétrocompatibilité des salles n'est exigée.** Ce lot remet les salles à zéro au déploiement. Les statistiques Supabase, snapshots et calibrations sont conservés. Les identités Auth anonymes réutilisables ne sont pas des profils personnels persistants ; la suppression des salles supprime leurs membres, invitations et demandes associées.

## Validation

106 tests TypeScript/PostgreSQL, 25 parcours Playwright, build et diff-check réussis localement. Les 96 tests de base conservent leurs fixtures historiques isolées jusqu'à la migration 013 ; neuf nouveaux tests appliquent **toutes les migrations jusqu'à 014** pour contrôler les séquences complètes dans les deux camps, droits, contournements, doublons ranked, bans tournoi, corrections et consentement des rôles. Un test supplémentaire couvre l'hydratation statistique des compléments automatiques. Les parcours de scoring existants utilisent des états synthétiques isolés, tandis que les deux nouveaux parcours UI créent réellement les modes guidés et vérifient leur progression.

![Camp allié et lobby ranked](evidence/guided-ranked-lobby.png)

![Deux picks actifs, camp allié rouge](evidence/guided-ranked-picks.png)

Ces premières images utilisent la démonstration fictive. Aucun nouveau collecteur ni intégration Riot/OP.GG ajouté. Le complément populaire n'est pas une recherche stratégique minimax.

## Livraison vérifiée

Version **`ccb334e`** observée sur Netlify le **15 novembre 2026 à 15:22 Europe/Zurich**, après [CI de branche](https://github.com/NicoHelemon/lol_drafter/actions/runs/43723650663) verte. [CI de main](https://github.com/NicoHelemon/lol_drafter/actions/runs/43723966343) également verte : 106 tests TypeScript/PostgreSQL, 50 Python et 25 parcours navigateur. La seule migration 014 a été appliquée après sauvegarde privée ; la suppression des salles temporaires autorisée a été exécutée dans la même transaction. Les tables de salles étaient déjà vides. Les identités Auth anonymes n'ont pas été supprimées.

Recette réelle à deux navigateurs réussie pour **ranked côté allié rouge** et **tournament côté allié bleu** : mode/camp synchronisés, lobby ranked limité aux alliés, priorité d'Ahri Top explicitement préparée, cinq choix disponibles dans les dix cases, toutes les étapes de picks et bans confirmées dans l'ordre, doublon de ban interéquipes accepté en ranked, seconde phase de bans rouge d'abord en tournoi, fin de draft, échange de rôles consenti sur des picks verrouillés, retour à la dernière étape, re-confirmation et rechargement. Les deux salles de test et leurs dépendances ont été supprimées par Quit.

Contrôle des scores réels réussi dans la séquence guidée rouge : Renekton **+0,97**, équipe **+0,40**, remplacement par Camille **+0,27**, variation **−0,13**. Aucun appel Lolalytics depuis les navigateurs. Le contrôle final retrouve **865 empreintes identiques**, le même snapshot courant, les mêmes modèles et catalogues, et aucune salle temporaire restante.

Preuves : [rapport structuré](evidence/guided-production-verification.json), [lobby ranked réel](evidence/guided-ranked-lobby-production.png), [seconde phase de bans réelle](evidence/guided-tournament-bans-production.png), [tournoi terminé](evidence/guided-tournament-complete-production.png). La branche dédiée conserve ces preuves sans nouvelle publication frontend uniquement documentaire.
