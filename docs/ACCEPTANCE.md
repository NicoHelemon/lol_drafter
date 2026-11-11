# Recette partagée après création Supabase

À exécuter sur le site Netlify connecté à Supabase ; cette recette n'a pas été exécutée sans accès aux services.

1. Ouvrir cinq profils de navigateur indépendants. A crée une salle ; B–E rejoignent via son invitation. Chacun réserve un poste différent et prépare son pool. Un sixième profil doit être refusé. Un faux token ne donne aucun accès.
2. Marquer chaque joueur prêt. A démarre. Tous affichent le même dataset ; un autre participant ne peut ni modifier le dataset ni réinitialiser la salle.
3. B ajoute Jhin en ADC adverse ; les cinq vues doivent s'actualiser sans rechargement. C le déplace vers Jungle puis ajoute Caitlyn en ADC. Aucun pick ne disparaît. La couverture signale le manque pour Jhin Jungle dans la démo.
4. D ajoute un ban d'un champion du pool Top ; il disparaît du classement et ne peut être pické. Retirer ce ban le rend disponible.
5. B et C modifient une case presque simultanément : une mutation réussit, l'autre reçoit un conflit explicite. Aucun doublon ne subsiste. Refaire avec un pick et un ban du même champion.
6. E recharge puis coupe/rétablit le réseau : même identité, même siège, état canonique récupéré. L'indicateur de présence n'est pas instantané (heartbeat 20 s, expiration 65 s).
7. A tente d'importer en live : l'interface ne le propose pas et la RPC refuse un dataset différent. Terminer et commencer une nouvelle préparation pour importer.
8. Essayer le remplacement avec conservation de l'ancien pick sans rôle et la réattribution à un poste occupé : échange, pas de perte ; maximum cinq picks y compris sans rôle.
9. Contrôler desktop et mobile, contributions détaillées, valeurs N/A, absence de faux classement sans contexte et label fictif permanent pour la démo.

Tests automatisés déjà disponibles : `npm test` (SQL/Postgres avec cinq identités et permissions) et `npm run test:e2e` (parcours réel de navigateur en mode local). Ne pas les présenter comme une validation de Supabase Realtime en production.

## Préparation et fin de salle

- La préparation n’affiche ni tableau de picks/bans ni classements. Le démarrage attend que tous les participants présents aient un rôle, un pool et soient prêts ; un seul joueur peut aussi lancer sa draft.
- Le démarrage ouvre `/rooms/:id/draft` sur tous les appareils ; le rechargement garde le bon écran.
- Quitter pendant la préparation libère le siège et autorise un remplaçant. Quitter comme hôte transfère les droits au prochain participant.
- Terminer depuis la préparation ou le live fige la salle pour tous. Seul l’hôte dispose de cette action. Chacun peut quitter une salle terminée.

## Pools et échanges de rôles

- Une nouvelle salle commence sans rôle ni champions prédéfinis. Les sélections des salles existantes restent conservées.
- Choisir un rôle depuis sa case ; ajouter un champion via [+] l’enregistre immédiatement. Retirer le dernier champion reste possible, mais désactive Ready. Un changement de pool annule Ready.
- Les portraits du pool et le bouton [+] ont la même taille (58 × 58 px). Aucun bouton My role, Pool · x champions ou Save pool.
- Tous les libellés affichent Bottom et Score. Le moteur et les clés de données ne changent pas.
- Avec deux navigateurs membres A et B, choisir deux rôles distincts. A clique Swap role dans la case de B : A attend, B reçoit Accept / Decline.
- Seul B peut accepter. Les rôles sont intervertis atomiquement, les pools restent liés à leur joueur et les deux joueurs redeviennent Not ready.
- Décliner ou annuler conserve les rôles. Une deuxième demande impliquant l’un des deux joueurs est refusée. La draft ne démarre pas avec une demande en attente.
- Changer de rôle, quitter ou fermer la salle retire la demande devenue obsolète.
