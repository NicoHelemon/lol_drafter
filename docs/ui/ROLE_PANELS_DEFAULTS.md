# Panneaux de rôle et filtres initiaux

Demande du 14 novembre 2026, branche `feat/role-panels-picker-defaults`.

- Le panneau de rôle entier est la poignée, avec icône, rôle et pseudo. Il occupe la hauteur de la ligne. Pendant le déplacement, les autres panneaux et toutes les cases alliées deviennent des cibles. Les portraits gardent leur geste distinct de déplacement des champions.
- Le rôle du pool ou de la case est actif dès l'ouverture du sélecteur, avec le tri par popularité. Une réouverture rétablit ces valeurs, même après modification manuelle. Les bans restent tous rôles/popularité ; l'absence de métadonnées conserve le repli tous rôles/alphabétique. Une sélection existante hors rôle reste accessible.
- Aucun changement du consentement, des RPC, du scoring, de la collecte, des statistiques persistées ou des secrets. Aucune migration nécessaire.

Validation locale : **22 parcours Playwright réussis**, build TypeScript/Vite et `git diff --check`. Les parcours existants ont été adaptés aux nouvelles valeurs initiales. Ils vérifient un glisser-déposer depuis le bas du panneau vers le fond d'une case alliée, le consentement, les cibles au clavier et Escape ; les filtres initiaux du lobby, des candidats, des picks ennemis et des bans ; la réouverture après un choix manuel, les sélections hors rôle et le repli sans catalogue. Les contrôles sur mobile restent couverts à 390 et 320 px.

![Panneaux et cases cibles, démo synthétique](evidence/full-role-panels-demo.png)

## Livraison vérifiée

Version **`e0ee7e7`** constatée sur Netlify le **14 novembre 2026 à 23:55, Europe/Zurich**. [CI de branche](https://github.com/NicoHelemon/lol_drafter/actions/runs/43650462874) et [CI de main](https://github.com/NicoHelemon/lol_drafter/actions/runs/43650587984) vertes : 88 tests TypeScript/PostgreSQL, 50 Python, 22 parcours navigateur et build. Une publication frontend groupée pour ce lot, aucune migration.

Recette hébergée réussie entre **deux identités anonymes indépendantes** : le geste part à 6 px du bord gauche et 8 px du bas du panneau, puis arrive à 8 px des bords droit/bas de la case alliée. La hauteur du panneau couvre celle de la ligne. Aucun changement avant consentement ; après Accept, les champions et pools suivent leurs propriétaires. Refus, expiration, rôle libre via clic sur le fond de la case et rechargement passent.

Les pools Top et Mid démarrent avec le rôle associé et la popularité. Modifier le filtre et le tri puis fermer/rouvrir rétablit ces valeurs. Après l'échange, les candidats du joueur passé Mid s'ouvrent sur **Mid/popularité**, avec sa sélection de Renekton conservée hors rôle. Le sélecteur de pick ennemi Mid suit le même défaut ; les bans démarrent tous rôles/popularité. Les adversaires et la référence statistique restent inchangés. Aucun appel Lolalytics depuis les navigateurs ; la salle de test et toutes ses dépendances ont été supprimées par Quit.

Preuves : [JSON](evidence/role-panels-defaults-production.json), [cibles étendues](evidence/full-role-targets-production.png), [lobby](evidence/lobby-role-defaults-production.png), [candidats Mid](evidence/mid-default-popularity-production.png). Ces preuves finales sont enregistrées sur la branche dédiée pour éviter une publication uniquement documentaire ; la production reste sur `e0ee7e7`.
