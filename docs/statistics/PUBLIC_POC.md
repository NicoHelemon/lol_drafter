# POC public Lolalytics — 12 novembre 2026

> **État courant :** le [pipeline réel Against + Synergy](LIVE_PIPELINE.md) est implémenté et testé sur de vraies réponses, avec 228 cellules Synergy comparées au navigateur. Les anciens blocages techniques et résultats limités aux mocks ci-dessous sont historiques. Aucun seuil Lane/Games/Pick n’est appliqué aux nouveaux exports.

> **Dernière décision utilisateur :** suppression des seuils indicatifs Lane/Games/Pick pour la collecte. Voir la [comparaison testée des collecteurs](COLLECTOR_REVIEW.md) : 2 518 lignes Against conservées, Hextech contrôlé sur 278 paires, Synergy testée sur mocks uniquement. Les résultats avec seuils ci-dessous sont historiques.

**Against : extraction expérimentale réelle vérifiée. Synergy : non collectée, car la source utilisée par le site est explicitement privée et interdit l’usage par des tiers. Aucun dataset réel publié.** Le score, le cache partagé, les migrations, le publisher et le rafraîchissement quotidien restent inchangés.

## Accès et conditions constatés

La politique active autorise `lolalytics.com`, `www.lolalytics.com` et, après l’ajout effectué par l’utilisateur pendant ce POC, `a1.lolalytics.com`. Connexions nouvelles : HTTP 200 pour les pages publiques, `robots.txt` et la racine de `a1`. Le précédent refus CONNECT 403 du proxy est résolu pour ces domaines. `cdn5.lolalytics.com` (portraits) reste bloqué ; ce blocage n’empêche pas la comparaison des nombres dans le navigateur.

Les deux robots publics répondent avec notamment `Allow: /`, `search=yes,ai-train=no,use=reference` et des exclusions d’agents spécifiques. Cela ne constitue pas une licence de redistribution des statistiques. La page publique `/info/privacy/` est une politique de confidentialité, pas une autorisation de collecte/réutilisation exhaustive.

**Le contrôle de la racine `https://a1.lolalytics.com/` a révélé ce texte :**

> This is a private API for the sole use of visitors to the website lolalytics.com.
>
> All data inside this API is Copyright LoLalytics Limited and may not be used by third parties.

L’[avis complet](evidence/a1-access-notice.txt) et son empreinte sont conservés. Le clic « Common Teammates » observé auparavant demandait `https://a1.lolalytics.com/mega/?ep=build-team&…`. Avant l’ajout du domaine, le tunnel était refusé. Après lecture de l’avis, **aucun endpoint de données de cette API n’a été appelé**. Les captures suivantes interceptent toutes les tentatives vers des hôtes externes avant la connexion, y compris les préchargements automatiques de `build-team` par le site. Aucun contournement par paramètre de page, proxy ou autre domaine n’a été recherché.

Cette restriction d’usage est distincte d’un problème réseau. La collecte Synergy et l’intégration tierce nécessitent une autorisation de Lolalytics ou un export autorisé. Aucun contact avec le site n’a été envoyé au nom de l’utilisateur. La petite lecture de HTML public ci-dessous documente la faisabilité technique ; elle ne valide pas sa réutilisation en production.

## Filtres effectivement observés

Le sélecteur de période du site donne **`patch=14` pour « 14 Days »**, et non un patch du jeu appelé 14. Les liens de rôle utilisent `top`, `jungle`, `middle`, `bottom`, `support`. Les trois pages vérifiées :

- `https://lolalytics.com/lol/renekton/build/?lane=top&patch=14`
- `https://lolalytics.com/lol/ahri/build/?lane=middle&patch=14`
- `https://lolalytics.com/lol/jhin/build/?lane=bottom&patch=14`

Le rendu affiche Emerald+, Global, Ranked Solo/Duo et 14 Days. Les objets de route incorporés confirment `tier=emerald_plus`, `region=all`, `mode=ranked`, `patch=14` et le rôle explicite ; l’en-tête des données confirme `queue=420`, le champion et le rôle. L’inspecteur refuse toute divergence.

Les champs **Min Lane 2 %, Min Games 100, Min Pick 0 %** ont été constatés dans la **tier list**, aux valeurs par défaut 2/100/0. Ils ne figurent pas comme contrôles des matrices Build. Il ne faut donc pas prétendre qu’ils ont déjà filtré leurs lignes. Le POC applique explicitement `games >= 100` à chaque observation. Il n’applique aucun seuil de pick supplémentaire. La distribution des rôles du candidat confirme Top 95,3 % pour Renekton, Mid 95,6 % pour Ahri et Bottom 98 % pour Jhin. L’éligibilité de **chaque rôle adverse à Min Lane 2 %** reste à établir : le compteur ci-dessous est antérieur à cette étape. L’absence de ce filtre empêche de déclarer le contrat `context` complet du pipeline.

## Structure et résultats numériques

Le HTML est une page Qwik. Son `<script type="qwik/json">` contient une table `objs` avec références en base 36, et non un JSON métier directement lisible. Le bloc Build expose :

- `header` : champion/rôle, période et queue ;
- `enemy_h` : **`["id", "wr", "d1", "d2", "pr", "n"]`** ;
- `enemy` : cinq tableaux indexés par rôle adverse ;
- `nav.lanes` : distribution des rôles du candidat.

L’adaptateur lit **uniquement `d2`** comme Delta 2, avec `n` pour les parties. Il ne soustrait jamais les winrates. Les unités sont des points de pourcentage. Les observations restent directionnelles ; aucune Synergy, inversion ou symétrie n’est fabriquée.

| Candidat | Lignes source Top/Jungle/Mid/Bottom/Support | Lignes ≥100 parties | Lignes rendues comparées | Zéros source ≥100 |
| --- | --- | ---: | ---: | ---: |
| Renekton Top | 172 / 144 / 170 / 166 / 170 | 388 | 95 | 3 |
| Ahri Mid | 172 / 160 / 170 / 169 / 172 | 449 | 95 | 1 |
| Jhin Bottom | 172 / 166 / 172 / 172 / 171 | 525 | 95 | 2 |
| Total | 2 518 | **1 462** | **285** | **6** |

Les 285 comparaisons concordent sur **Delta 2 et nombre de parties**, à partir des cellules du DOM rendu, indépendamment du décodage des références Qwik. Chaque rôle adverse est représenté. Aucun identifiant retenu n’est absent du catalogue local. Les 1 056 lignes de moins de 100 parties sont exclues, sans devenir zéro. Aucune valeur `null` n’a été constatée dans les lignes retenues ; la conservation de `null` est testée séparément par corruption synthétique explicite.

Exemples vérifiés à l’affichage :

| Candidat | Adversaire et rôle | Delta 2 | Parties |
| --- | --- | ---: | ---: |
| Renekton Top | Ambessa Top | +2,09 | 8 509 |
| Renekton Top | Aatrox Top | **0,00** | 6 639 |
| Renekton Top | Ahri Mid | −0,79 | 8 663 |
| Ahri Mid | Lee Sin Jungle | −0,31 | 17 102 |
| Jhin Bottom | Kai’Sa Bottom | −2,07 | 74 649 |
| Jhin Bottom | Twitch Bottom | **0,00** | 12 737 |

Les [preuves JSON](public-poc-2026-11-12.json) contiennent les URL, empreintes des HTML, comptes, cellules d’échantillon et rôles. Captures d’écran : [Renekton](evidence/renekton-14.png), [Ahri](evidence/ahri-14.png), [Jhin](evidence/jhin-14.png). Les portraits y sont absents à cause du CDN bloqué ; les textes et chiffres sont visibles. Les HTML complets restent dans `/tmp`, hors versionnement. Les fixtures versionnées sont de très petits extraits publics élagués avec références remappées et valeurs conservées, pas des pages complètes ni des données synthétiques présentées comme réelles.

## Coût, affichage et limites

**Against seul : une réponse HTML Build par couple suffit pour accéder aux cinq groupes incorporés**, soit trois réponses utiles pour ce POC. Pas de requête de matchup par paire. La validation navigateur ajoute le téléchargement des modules JS/CSS du site. Dans la capture initiale, 541/501/505 ressources ont été *tentées*, y compris images et API interrompues localement : ce ne sont pas des nombres de requêtes statistiques réussies. Ces comptes dépendent du cache de modules du navigateur partagé.

Les 19 colonnes par groupe au moment des captures sont une **fenêtre de rendu virtualisée avec défilement horizontal**, pas la couverture totale. Le module public `q-CQvFzbva.js` découpe le tableau en mémoire selon la position de défilement. Ce POC n’a pas parcouru toutes les fenêtres du navigateur : il compare les 285 lignes présentes dans le DOM initial et compte séparément les données incorporées. Il ne revendique pas 1 462 comparaisons à l’affichage.

Aucun coût global Against + Synergy n’est établi. En particulier, 865 pages pour tous les champions/rôles reste une extrapolation non validée. Aucune collecte exhaustive ni planification n’est activée.

## Code et reproduction

- `scripts/statistics/inspect_lolalytics.py` : inspecteur **hors ligne**, schéma contrôlé, décodage borné des références ordinaires, refus des colonnes/filtres divergents, conservation des zéros et absences, comparaison facultative aux cellules rendues.
- `scripts/statistics/capture_public_poc.mjs` : expérience bornée aux trois URL, contrôle robots, cadence d’une seconde entre pages, aucun retry, TLS actif. Tous les hôtes autres que `lolalytics.com` sont bloqués **avant** le réseau ; les tentatives sont journalisées avec ce statut. Capture le HTML initial, le DOM rendu, les cellules, les captures d’écran et le journal des ressources, puis compare les 95 lignes de chaque page à l’inspecteur.
- `probe.py` reconnaît désormais les scripts `qwik/json` dans son inventaire, sans prétendre les valider numériquement.

```sh
# HTML publics déjà capturés : aucun réseau
python3 scripts/statistics/inspect_lolalytics.py /tmp/renekton-14.html \
  --url 'https://lolalytics.com/lol/renekton/build/?lane=top&patch=14' \
  --output /tmp/renekton-audit.json

# Répétition limitée du POC public, avec les dépendances dev déjà installées
node scripts/statistics/capture_public_poc.mjs /tmp/lolalytics-public-poc

python3 -m unittest discover -s tests/statistics -v
npm test
npm run build
```

Chromium doit faire confiance au certificat du proxy fourni par l’environnement. Lors de cette session, son magasin NSS a nécessité l’ajout de ce certificat ; le navigateur a ensuite été exécuté hors du bac à sable pour lire ce magasin. **Aucune désactivation de TLS**. La reproduction finale a réussi sur les trois pages avec la comparaison automatique des 95 lignes par page.

Validation actuelle : **19 tests Python, 42 tests TypeScript/PostgreSQL et build réussis**. Les neuf nouveaux tests portent sur des extraits réels, les cellules indépendantes, le zéro, les absences, les divergences de schéma/contexte et les références invalides ; les mutations synthétiques sont nommées comme telles. Pas de modification UI, donc pas de nouvelle recette frontend complète revendiquée.

La sortie porte `kind=experimental-public-html-audit`, `publicationEligible=false` et ne fournit volontairement pas de faux `context` complet. Elle est rejetée par le validateur du pipeline existant (testé). L’automatisation Lolalytics de `refresh.py` reste bloquée et le publisher reste inchangé. Aucun instantané, SQL, secret GitHub, push ou déploiement distant n’a été effectué.

## Ce qui reste nécessaire

1. Obtenir une autorisation de réutilisation couvrant Against et Synergy, ou un export autorisé du même indicateur. L’autorisation réseau donnée par l’utilisateur ne remplace pas celle de la source.
2. Établir l’éligibilité des rôles adverses au seuil de lane 2 %, sans confondre pourcentage de matchup et présence du champion dans un rôle.
3. Vérifier Synergy sur les trois couples, avec les deux rôles, nombres de parties, vrais deltas et comparaison au rendu. Le normaliseur ne doit pas inventer des lignes `with` à partir de `vs`.
4. Alors seulement produire un export respectant tout le contexte, le faire passer dans le builder/verifier existants et mesurer la couverture/coût des deux relations avant toute publication ou collecte quotidienne.
