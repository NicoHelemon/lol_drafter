# Recette partagée

À exécuter sur le site Netlify relié à Supabase, après la migration `202611110004_ephemeral_rooms.sql`.

1. Nico crée une salle : titre « Nico’s room », URL `/rooms/nicos-room/setup`, badge HOST à côté de son nom. Un second Nico reçoit une URL distincte, avec suffixe numérique.
2. Quatre autres profils de navigateur rejoignent via l’invitation. Chacun choisit une case avec Join. Un sixième participant et une invitation incorrecte doivent être refusés.
3. Les pools commencent vides. [+] ouvre le sélecteur ; l’ajout et le retrait par × sont sauvegardés immédiatement. Zaahen, Yunara et les autres champions récents sont disponibles, avec des portraits locaux.
4. Aucun bouton Ready ou End room, texte Available ni pied de page de catalogue. L’hôte peut démarrer à tout moment, même avec des rôles ou pools vides ; les autres joueurs ne peuvent pas démarrer.
5. A survole le panneau occupé par B : le panneau s’efface derrière les doubles flèches. Le bouton est également accessible au clavier et sur écran tactile.
6. Une demande affiche un popup avec Accept / Decline à B ; A voit « Waiting for B… ». Accept intervertit les rôles tout en conservant les pools. Sans réponse après cinq secondes, le popup et l’attente disparaissent et les rôles restent identiques. Recharger ou suspendre la page ne permet pas d’accepter une demande expirée.
7. Démarrer la draft avec une demande ouverte annule la demande. Tous les clients passent à `/rooms/:slug/draft`.
8. Un joueur saisit Jhin en Bottom adverse, le déplace en Jungle puis ajoute Caitlyn en Bottom. Les cinq vues se synchronisent, sans perte de pick. Ban et retrait d’un ban actualisent les recommandations.
9. Des modifications concurrentes incompatibles donnent un conflit explicite ; jamais de double pick/ban. Un rechargement récupère l’état canonique.
10. Quit libère le siège. Si l’hôte quitte, le prochain joueur reçoit le badge et les commandes d’hôte. Quand le dernier joueur quitte, la salle et toutes ses données associées disparaissent.

Automatisation : `npm test` valide le domaine, les 173 portraits et les RPC/RLS multi-identités ; `npm run test:e2e` valide le frontend local, les pages, Quit, le survol et la disparition du popup après cinq secondes. Le test navigateur du popup utilise une demande injectée dans le stockage de démo ; l’expiration et l’acceptation serveur sont vérifiées séparément par les tests SQL. La recette Supabase Realtime hébergée exige des accès aux services et n’est pas implicitement acquise.
