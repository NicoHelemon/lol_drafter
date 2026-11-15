# Undo / Redo, Open draft et ordre des candidats

Demande du 15 novembre 2026. Branche `feat/open-draft-undo`. Remplace les règles de correction et de classement des documents antérieurs.

## Utilisation

Les boutons de déplacement ↕ et les croix de retrait des picks/bans disparaissent de la draft guidée. Les échanges de champions et de rôles passent par glisser-déposer ; les demandes de consentement existantes sont conservées. Les croix des listes de candidats restent disponibles pour éditer ces listes.

**Undo / Redo**, avec **Ctrl + Z / Ctrl + Y**, remplacent Previous step. L'hôte contrôle cet historique commun ; les choix des invités y figurent aussi. Un Undo annule **un choix**, pas nécessairement un tour entier : annuler le deuxième pick d'un tour double conserve le premier. Redo rétablit exactement ce choix et la progression qui l'accompagnait. Les piles sont conservées après rechargement, synchronisées entre navigateurs et un nouveau choix efface Redo. Les raccourcis laissent les champs de saisie et les fenêtres de sélection gérer leur propre édition.

**Open draft**, près de Clear / Quit pour l'hôte, conserve tous les choix présents et enlève les contraintes de tour. Les deux équipes peuvent ensuite sélectionner/remplacer/enlever des picks et bans dans n'importe quel ordre. Les doublons, limites de cinq et consentements restent contrôlés. Les croix de retrait réapparaissent ici ; aucun bouton de swap n'est réintroduit.

**Le passage à Open draft est définitif.** Il vide les piles Undo/Redo et établit une nouvelle base. Ensuite Undo/Redo portent sur les choix effectués en mode libre ; ils ne peuvent jamais réactiver la séquence guidée. Clear reste en mode libre et peut être annulé s'il a effacé des choix. Dans les deux modes, Clear conserve rôles, membres, candidats et référence statistique.

Un échange de rôle/champion ou un changement de participants établit également une nouvelle base d'historique. On ne restaure ainsi pas d'anciennes affectations de joueurs sans consentement. Les modifications des listes de candidats ne sont pas annulées et n'effacent pas l'historique des picks/bans.

## Classement

Dans chaque case de draft, tous les champions sont triés par **score Delta 2 ajusté décroissant**, indépendamment du statut explicite/automatique, de la popularité, du statut disponible/bloqué ou de la sélection courante. Le pick reste reconnaissable par sa taille et son cadre ; il n'est pas forcé en tête. Les valeurs manquantes sont en dernier, les égalités départagées par nom. Le calcul n'utilise pas les arrondis d'affichage pour trier.

La popularité sert toujours à constituer le complément d'au moins cinq candidats. Les filtres/tri du catalogue de recherche restent ceux demandés précédemment. Aucun score, modèle ni observation statistique n'est modifié.

![Mode libre et historique](evidence/open-draft-history.png)

Capture locale avec données de démonstration fictives.

## Stockage et contrôles

Migration **016**, après 015. Les positions d'historique contiennent uniquement picks, bans et progression. Les statistiques, pools, joueurs et camp ne sont pas copiés dans ces positions. Deux piles privées limitées à **60 actions** par salle sont enregistrées dans `draft_timelines`, avec suppression en cascade à l'expiration/suppression de la salle. Seuls les compteurs sont exposés dans la ligne de salle.

La RPC `control_draft` vérifie appartenance, hôte et version, verrouille la salle, restaure une position réellement enregistrée par le serveur, puis publie une seule nouvelle version. Un jeton interne de restauration reste dans la table privée, inaccessible aux membres ; aucun paramètre client ne permet de désactiver les contrôles. Les triggers de consentement restent actifs. Toute erreur annule la transaction et son jeton. L'irréversibilité d'Open draft est contrôlée avant la restauration.

## Vérification et livraison

117 tests TypeScript/PostgreSQL, 50 Python et build réussis localement. Les contrôles ajoutés couvrent annulation/rétablissement d'un choix, frontières de tours doubles, invalidation de Redo, conservation des pools, droits/versions, confidentialité de la pile, mode libre irréversible, Clear annulable, nouvelle base après échanges, limite de stockage et classement selon les scores ajustés. Les **27 parcours navigateur** passent également localement et sur GitHub Actions.

La livraison suit l'autorisation permanente : remise à zéro des salles temporaires après vérification/sauvegarde, sans rétrocompatibilité des salles. Données statistiques, secrets et collecte sont préservés.


## Livraison vérifiée

Version **`903077c`** observée en production le **15 novembre 2026 à 19:01 Europe/Zurich**. [CI de branche](https://github.com/NicoHelemon/lol_drafter/actions/runs/43743719451) et [CI de main](https://github.com/NicoHelemon/lol_drafter/actions/runs/43744013350) vertes : 117 tests TypeScript/PostgreSQL, 50 Python, 27 parcours navigateur et build.

Seule la migration 016 a été appliquée, après sauvegarde privée et vérification du projet. La salle temporaire existante, son membre et son invitation ont été supprimés dans la transaction autorisée ; les identités Auth anonymes réutilisables ne sont pas supprimées. Après migration **et après recette**, les empreintes des 865 fragments, le snapshot courant, le modèle et le catalogue sont inchangés.

Deux navigateurs indépendants ont vérifié ranked côté allié rouge et tournament côté allié bleu : choix d'un invité dans l'historique partagé, Ctrl Z/Ctrl Y et Redo après rechargement, annulation du deuxième pick d'un tour double, mode libre avec conservation des choix et piles vides, retrait par croix uniquement en mode libre, picks et bans hors séquence, Clear puis Undo sans retour au guidé, conservation des pools et du snapshot, consentement d'un échange de rôles et remise à zéro de l'historique. Les deux salles et leurs piles privées ont été supprimées par Quit.

Le classement décroissant et N/A en dernier ont été contrôlés dans les dix cases de chaque mode : **100 scores numériques réels** vérifiés. La capture montre notamment Viego sélectionné derrière Graves mieux noté, et Aatrox sélectionné après quatre candidats mieux notés ; Ahri explicitement préparée reste derrière Renekton ajouté automatiquement. La taille du pick ne change pas.

![Mode libre et classement en production](evidence/open-draft-production.png)

Recette statistique réelle inchangée : Renekton Top **+0,97**, équipe **+0,40**, remplacement Camille **+0,27**, k publié **2510,0480** ; valeurs et score d'équipe conservés après rechargement. Aucun appel direct à Lolalytics depuis les navigateurs.

[Preuve structurée](evidence/open-history-production-verification.json). Ce constat est sauvegardé sur la branche de travail sans nouvelle publication de production pour le seul ajout de documentation.
