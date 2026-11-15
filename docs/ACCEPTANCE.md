> Les recettes historiques libres ci-dessous sont complétées et remplacées pour la progression par [GUIDED_DRAFT.md](ui/GUIDED_DRAFT.md). Les nouvelles salles ont un mode obligatoire et des tours confirmés. Les salles temporaires peuvent être remises à zéro aux mises à jour.

# Recette partagée

À exécuter sur le site Netlify relié à Supabase, après toutes les migrations jusqu’à `202611150014_guided_draft.sql`.

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
- Chaque case affiche ses candidats, qu’elle soit alliée, ennemie ou sans participant. [+] ajoute des candidats sans sélectionner ni remplacer le pick actuel. Cliquer un candidat le sélectionne, cliquer un autre le remplace, et recliquer le candidat sélectionné efface uniquement le pick. Le candidat choisi reste le premier, même si son score est inférieur. Le pick se déplace par glisser-déposer dans sa propre équipe, ou via ↕ puis une cible au clic/toucher/clavier. Entre deux rôles alliés incarnés, les propriétaires concernés doivent consentir sous cinq secondes. Un rôle destinataire vide reçoit le champion et le donneur perd sa sélection. Les pools et les rôles des joueurs ne sont pas échangés.
- Les candidats bannis ou pris dans une autre case restent visibles en gris et ne sont pas sélectionnables. Retirer le ban/pick les réactive.
- Les scores sont visibles en transparence sur les candidats et les picks sélectionnés des deux équipes. Les données manquantes restent N/A ; une indication signale la couverture partielle. Le survol ou focus du portrait affiche une miniature de cinq lignes en deux colonnes, avec rôles, portraits et valeurs ajustées colorées. Le propre rôle allié est exclu ; les paires inconnues affichent N/A, les emplacements vides un tiret. Aucun clic de score n’est nécessaire.
- Le panneau des participants indique N/5, les noms et le badge d’hôte, sans postes. Le cadre doré de son rôle est épais de 3 px.

## Candidats des dix rôles

- Le lobby présente cinq rôles alliés et cinq rôles ennemis, tous avec une liste de candidats. Préparer un rôle libre ou adverse est possible avant toute prise de rôle.
- Prendre un rôle remplace sa liste préparée par le pool personnel, sans fusion, même vide. Le pool du rôle adverse correspondant reste inchangé. Une modification simultanée obsolète est refusée.
- Après Start draft, les dix listes sont conservées sans sélection automatique. [+] reste toujours présent ; ajouter un candidat ne sélectionne rien. Cliquer un candidat sélectionne/remplace le pick, recliquer le sélectionné efface uniquement le pick. Retirer un candidat depuis le sélecteur ne supprime pas un pick existant.
- Les listes peuvent partager des candidats, mais les picks/bans restent uniques. Le pick choisi reste premier ; les candidats indisponibles restent visibles en gris. Recharger conserve les dix listes et les picks séparément.
- En préparation, propriétaire ou hôte édite un pool incarné ; les listes libres et adverses sont partagées. Vérifier un second membre et la prise de rôle pendant une édition.
- Le nom du participant reste sous son rôle. Les candidats non sélectionnés et [+] sont plus petits, dans les deux équipes. Le score et les contributions ajustées ne changent pas.

## Équipes et shrinkage

- Vérifier le score au-dessus de chaque équipe, les nombres de picks/champions calculables et la couverture. Une draft ou couverture incomplète reste Provisional.
- Survoler un candidat : le panneau montre le nouveau score collectif et sa variation, avec recalcul des autres alliés, sans changer la sélection.
- Vérifier « Individual score », le remplacement explicite « Aatrox → Renekton », puis « Current team → With Renekton » et « Team score change ». Le score collectif actuel, le score après remplacement et leur différence sont trois valeurs distinctes.
- Les valeurs brutes restent en données, les contributions affichées utilisent `n/(n+k)`. Aucun compte/preset persistant nouveau.
- L’explication en bas indique la source réelle, 14 jours et le palier du snapshot, k appris et la date de calibration. Les données sans calibration affichent N/A.

## Échanges de rôles en draft et filtres

- Glisser son panneau de rôle depuis un coin éloigné de l'icône, vers le panneau d'un autre joueur ou le fond de sa case alliée. Toute la hauteur du panneau, rôle et pseudo compris, est interactive. Aucun changement avant Accept ; après consentement, chaque joueur conserve son pool et son champion sélectionné, y compris une sélection vide. Les rôles changent, les adversaires restent à leur place. Refuser, annuler ou attendre cinq secondes ne change rien.
- Vers un rôle libre, le déplacement est immédiat ; son éventuel pick anonyme revient dans l'ancien poste. Vérifier aussi clic/toucher puis cible, clavier et Escape. Une demande de champion et une demande de rôle ne peuvent pas concerner simultanément les mêmes postes.
- Dans un pool Top du lobby puis le sélecteur de candidats Top en draft, vérifier que Top et popularité sont déjà actifs. Les cinq rôles et les deux tris tiennent sur une seule ligne. Seuls les champions avec au moins 5 % de leurs parties dans ce rôle apparaissent, plus les sélections existantes. Recliquez Top pour revenir à All roles ; la recherche textuelle reste active. Vérifier à 390 et 320 px sans débordement horizontal, ainsi que le tri A–Z au clavier.
- Vérifier les valeurs initiales **avant tout clic de filtre** : pool Top → Top/popularité ; candidats ou pick Mid → Mid/popularité, alliés comme adversaires. Modifier manuellement les contrôles puis fermer et rouvrir : le rôle associé et la popularité sont rétablis. Après échange de rôle, le sélecteur suit le nouveau poste du joueur ; les sélections hors rôle restent visibles. Les bans démarrent tous rôles/popularité.
- Sans catalogue compatible, tous les champions restent accessibles par ordre alphabétique et le manque de statistiques de rôles est indiqué. Les données de démonstration sont explicitement fictives. Aucun import d'image ni compte/preset persistant ajouté.
