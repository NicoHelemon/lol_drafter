# Candidats pour les dix rôles

Décision confirmée le 15 novembre 2026 ; branche `feat/candidates-all-roles`. Chaque rôle allié et ennemi peut avoir une liste dans le lobby et pendant la draft, même sans participant. Ajouter, retirer ou préparer des candidats ne sélectionne aucun champion. En draft, un clic sélectionne un candidat, un autre le remplace, et un second clic sur le pick le désélectionne. [+] reste présent dans les dix cases ; les picks existants des anciennes salles restent visibles même sans liste.

## Propriété et prise de rôle

Le pool personnel existant reste la source de vérité d'un rôle allié incarné. Prendre un rôle remplace sa liste préparée par ce pool **sans fusion, même si le pool est vide**. Le remplacement est atomique et supprime la liste masquée : elle ne réapparaît pas lorsque le joueur repart. Le dernier pool du joueur reste alors disponible dans le poste libéré. Lors d'un échange, les pools suivent leurs propriétaires, avec les règles de consentement et de déplacement des picks existantes.

Les listes de rôles libres et ennemis sont partagées entre les membres. En préparation, modifier un pool personnel reste réservé à son propriétaire ou à l'hôte ; pendant la draft, les membres peuvent éditer les candidats comme auparavant. Les champions pris ailleurs ou bannis peuvent appartenir à une liste, mais restent indisponibles à la sélection. Un même champion peut être candidat à plusieurs rôles ; l'unicité des picks/bans reste obligatoire.

## Persistance et compatibilité

La migration **013** ajoute une RPC `set_role_candidates` et un trigger de validation/réconciliation. Elle n'efface ni ne transforme les salles existantes. Les listes libres sont conservées dans le champ optionnel `state.rolePools`, les pools personnels restent dans `players[].pool`. Aucun doublon d'autorité pour un rôle incarné : sa liste libre est retirée à l'arrivée du joueur.

La RPC contrôle l'appartenance, la version de la salle, le rôle, l'équipe et la liste (IDs textuels numériques, uniques, 500 maximum). Elle ne modifie pas les picks, bans ou statistiques. Une écriture préparée avant qu'un joueur prenne le poste est refusée comme obsolète. Le trigger s'applique aussi aux anciens chemins de sauvegarde, échanges et départs. Si un ancien client omet le champ optionnel, les listes présentes sont conservées. Les anciennes RPC restent opérationnelles.

Le cache statistique charge les fragments de toutes les listes, alliées et ennemies, en dédupliquant les clés champion/rôle. Les paires chargées et les métadonnées de cache ne sont toujours pas renvoyées dans les sauvegardes. La couverture de préparation inclut les dix listes. La formule de score, le shrinkage, le collecteur, les modèles immuables et la maintenance ne changent pas. Les listes étant dans la salle, elles suivent son expiration et sa suppression existantes.

## Validation

**96 tests TypeScript/PostgreSQL**, **23 parcours navigateur** et build TypeScript/Vite réussis localement. Les nouveaux tests couvrent les dix listes, la transition lobby/draft sans sélection automatique, l'override vide et non vide, le départ, les droits, les requêtes concurrentes, les charges invalides, la compatibilité avec un champ absent et l'hydratation dédupliquée des listes ennemies/libres. Le parcours navigateur couvre les dix cases, une prise de rôle, les candidats adverses multiples, la sélection/désélection, le retrait d'un candidat sélectionné sans effacement du pick, le rechargement et le mobile.

![Préparation des deux équipes, démo synthétique](evidence/ten-role-lobby-demo.png)

![Candidats et sélections distincts, démo synthétique](evidence/ten-role-draft-demo.png)

La validation GitHub Actions, l'application de la seule migration 013 après sauvegarde et la recette Supabase hébergée seront consignées après observation. Aucun accès Riot, import OP.GG ou compte persistant ajouté : ces sujets restent au stade de discussion.
