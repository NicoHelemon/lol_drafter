# Recette partagée

À exécuter sur le site Netlify relié à Supabase, après la migration `202611110006_draft_candidates.sql`.

1. Nico crée une salle : titre « Nico’s room », URL `/rooms/nicos-room/setup`, badge HOST à côté de son nom. Un second Nico reçoit une URL distincte, avec suffixe numérique.
2. Quatre autres profils de navigateur rejoignent via l’invitation. Chacun choisit une case avec Join. Un sixième participant et une invitation incorrecte doivent être refusés.
3. Les pools commencent vides. [+] ouvre le sélecteur ; l’ajout et le retrait par × sont sauvegardés immédiatement. Zaahen, Yunara et les autres champions récents sont disponibles, avec des portraits locaux.
4. Aucun bouton Ready ou End room, texte Available ni pied de page de catalogue. L’hôte peut démarrer à tout moment, même avec des rôles ou pools vides ; les autres joueurs ne peuvent pas démarrer.
5. A survole le panneau occupé par B : le panneau s’efface derrière les doubles flèches. Le bouton est également accessible au clavier et sur écran tactile.
6. Une demande affiche un popup avec Accept / Decline à B et un popup d’attente avec Cancel à A. Les deux affichent une barre de temps qui se vide. Accept intervertit les rôles tout en conservant les pools. Sans réponse après cinq secondes, le popup et l’attente disparaissent et les rôles restent identiques. Recharger ou suspendre la page ne permet pas d’accepter une demande expirée.
7. Démarrer la draft avec une demande ouverte annule la demande. Tous les clients passent à `/rooms/:slug/draft`.
8. Un joueur saisit Jhin en Bottom adverse, le déplace en Jungle puis ajoute Caitlyn en Bottom. Les cinq vues se synchronisent, sans perte de pick. Ban et retrait d’un ban actualisent les recommandations.
9. Des modifications concurrentes incompatibles donnent un conflit explicite ; jamais de double pick/ban. Un rechargement récupère l’état canonique.
10. Quit libère le siège. Si l’hôte quitte, le prochain joueur reçoit le badge et les commandes d’hôte. Quand le dernier joueur quitte, la salle et toutes ses données associées disparaissent.

Automatisation : `npm test` valide le domaine, les 173 portraits et les RPC/RLS multi-identités ; `npm run test:e2e` valide le frontend local, les pages, Quit, le survol et la disparition du popup après cinq secondes. Le test navigateur du popup utilise une demande injectée dans le stockage de démo ; l’expiration et l’acceptation serveur sont vérifiées séparément par les tests SQL. La recette Supabase Realtime hébergée exige des accès aux services et n’est pas implicitement acquise.

## Tableau de draft intégré

- Aucun panneau Recommendations ni option Unassigned role. Le tableau prend toute la largeur disponible, y compris sur mobile.
- Les deux groupes de bans se trouvent immédiatement sous Draft board.
- Pour un allié incarné, chaque case affiche les candidats de son pool. [+] ajoute des candidats sans sélectionner ni remplacer le pick actuel. Cliquer un candidat le sélectionne, cliquer un autre le remplace, et recliquer le candidat sélectionné efface uniquement le pick. Le candidat choisi reste le premier, même si son score est inférieur. Le pick se déplace par glisser-déposer dans sa propre équipe, ou via ↕ puis une cible au clic/toucher/clavier. Entre deux rôles alliés incarnés, les propriétaires concernés doivent consentir sous cinq secondes. Un rôle destinataire vide reçoit le champion et le donneur perd sa sélection. Les pools et les rôles des joueurs ne sont pas échangés.
- Les candidats bannis ou pris dans une autre case restent visibles en gris et ne sont pas sélectionnables. Retirer le ban/pick les réactive.
- Les scores sont visibles en transparence sur les candidats et les picks sélectionnés des deux équipes. Les données manquantes restent N/A ; une indication signale la couverture partielle. Le survol ou focus du portrait affiche une miniature de cinq lignes en deux colonnes, avec rôles, portraits et valeurs brutes colorées. Le propre rôle allié est exclu ; les paires inconnues affichent N/A, les emplacements vides un tiret. Aucun clic de score n’est nécessaire.
- Le panneau des participants indique N/5, les noms et le badge d’hôte, sans postes. Le cadre doré de son rôle est épais de 3 px.

## Postes anonymes et rôles incarnés

- Sur un poste ennemi ou allié sans participant, [+] disparaît après la sélection initiale. Cliquer le portrait ouvre le catalogue pour remplacer le pick ; il n’y a jamais plusieurs candidats affichés pour ce poste. Retirer le pick rétablit [+].
- Sur un poste allié occupé par un participant, [+] reste présent et ouvre l’ajout de candidats. Ajouter un candidat ne sélectionne rien et ne change pas le pick actuel, y compris si celui-ci est déjà sélectionné.
- La sélection et la désélection ne retirent aucun candidat du pool. Après rechargement, les candidats ajoutés et le pick effectif restent cohérents.
- Le nom du participant apparaît sous le libellé de son rôle, par exemple Jungle puis Mathis.

- Les candidats alliés non sélectionnés et [+] sont plus petits ; le pick garde sa taille initiale. Le score utilise la moyenne à poids égaux des seules observations connues, sans convertir les absences en zéro.
