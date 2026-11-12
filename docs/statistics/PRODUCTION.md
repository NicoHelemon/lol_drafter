# Mise en production — 12 novembre 2026

## Données effectivement publiées

Projet vérifié : **NicoHelemon’s Project**, référence `zsmpdkjfjqgtjinzoexv`, état `ACTIVE_HEALTHY`.

Le snapshot **`0551fd06485293f646720494eef5e1a4158aca434145a860ac66028fb5ebf0fb`** a été chargé, marqué prêt et promu dans `statistics_current` par la transaction finale du publisher.

- **865 fragments**, **786 704 observations réelles** (`fictional:false`).
- **433 233 Against** et **353 471 Synergy**.
- Contrôle distant après promotion : 865 comptes de paires et **865 empreintes de contenu concordantes** avec les fragments locaux. Aucun recours à une comparaison approximative.
- Les cinq salles préexistantes restent sur leur ancien instantané. La publication ne modifie aucun état de salle.
- Les connexions anonymes Supabase sont activées, les inscriptions ne sont pas désactivées et aucun CAPTCHA n’est configuré.

Preuve machine : [production-database-verified.json](production-database-verified.json), contrôlée le 12 novembre à **20:27 heure suisse**.

Les nouvelles salles résolvent le pointeur courant dans `createRoom`, puis chargent les fragments de leurs pools/picks. Une salle ouverte auparavant conserve volontairement son snapshot : créer une nouvelle salle pour utiliser la source publiée.

## Code effectivement poussé

Deux commits poussés sur `main` :

- `6c851aec0f93ef3a2b1f48e8a11d1a2b0f778fdc` — collecteur réel, normalisation, fixtures et rafraîchissement.
- `bf69d09ea6f2d8ca4e0838e1ee91dbef5bbc5c72` — publication par lots et `/deployment.json` pour vérifier la révision réellement servie.

CI GitHub verte pour les deux : [premier run](https://github.com/NicoHelemon/lol_drafter/actions/runs/43287909314), [second run](https://github.com/NicoHelemon/lol_drafter/actions/runs/43289186398). Validation locale après regroupement des écritures : **31 tests Python, 44 tests applicatifs/PostgreSQL, build réussi**. Les neuf parcours navigateur avaient passé avant cette adaptation backend ; le dernier CI les exécute aussi.

Aucune migration, modification du scoring ou modification de l’interface utilisateur n’a été nécessaire. Le build émet uniquement un petit fichier public `deployment.json` contenant le commit et la date du build, sans secret, pour permettre un contrôle explicite du déploiement Netlify.

## Contrôle du site encore bloqué par le réseau de cette machine

Le push sur `main` a été effectué pour le déploiement automatique Netlify configuré. **Le résultat Netlify n’est pas encore constaté indépendamment** : le proxy de l’environnement refuse le tunnel vers `draftroom-lol.netlify.app` avec HTTP 403. L’API GitHub et le domaine public du projet Supabase sont aussi absents de la politique active.

Le brouillon réseau enregistré conserve les domaines existants et ajoute :

```text
draftroom-lol.netlify.app
zsmpdkjfjqgtjinzoexv.supabase.co
api.github.com
```

L’outil a confirmé `status=saved`, `requires_publish=true`. Ce résultat n’est pas une application active. Au dernier contrôle, la politique appliquée autorisait encore seulement `a1.lolalytics.com`, `api.supabase.com`, `lolalytics.com`, `www.lolalytics.com` en plus des presets.

Le test de production est préparé, sans journaliser de jeton Auth ni d’invitation :

```sh
node scripts/statistics/verify_production.mjs /tmp/draftroom-production-check
```

Il doit contrôler le commit servi, créer une salle privée jetable, vérifier son snapshot réel et l’absence de paires inline, sélectionner Renekton Top contre Ambessa Top avec Lee Sin Jungle, comparer le score aux observations publiées, recharger la page puis quitter/supprimer sa salle de test. Le script a été tenté contre le site avec Chromium : échec `net::ERR_TUNNEL_CONNECTION_FAILED` sur `/deployment.json`, avant création de toute salle. **La vérification complète attend l’accès réseau**. Ne pas annoncer ce parcours comme réussi avant d’avoir sa preuve.

Le rafraîchissement quotidien est implémenté dans le workflow, mais les secrets/variables GitHub et son activation distante n’ont pas été configurés ou vérifiés pendant ce déploiement : l’API GitHub est encore bloquée. Aucun secret ne doit être demandé ou copié dans le chat.
