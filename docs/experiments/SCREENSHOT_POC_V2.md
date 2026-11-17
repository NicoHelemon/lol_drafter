# Reconstruction des captures — exploration v2, 17 novembre 2026

**Essai interne uniquement. Aucun import d’image, endpoint image, dépôt de fichier ou traitement de captures n’a été ajouté au site.** Le surlignage des picks exceptionnels constitue un [lot livré séparé](../ui/EXCEPTIONAL_FITS.md).

## Résultat sur le dataset corrigé

Les **20 captures** ont été utilisées pour explorer, régler et tester les règles. Il n’y a pas d’entraînement d’un modèle sur ces images. Cependant, ajuster des seuils et des heuristiques sur le même jeu peut aussi suradapter une solution : les chiffres suivants ne sont **pas** une validation indépendante sur de nouvelles captures.

| Élément | Résultat |
| --- | ---: |
| Picks confirmés identifiés dans la bonne équipe | **135 / 135** |
| Faux picks confirmés ajoutés | **0 observé** |
| Captures avec tous les picks confirmés correctement retrouvés | **20 / 20** |
| Bans nommés identifiés à la bonne position dans la bonne équipe | **180 / 184 — 97,8 %** |
| Fausses attributions de ban sur les positions évaluables | **0 observée** |
| Emplacements de ban vides laissés sans fausse proposition | **6 / 6** |
| Positions de ban annotées Unknown, exclues de la mesure | **10** |
| Choix provisoires identifiés avec le bon état et le bon slot | **21 / 22**, aucun faux provisoire |
| Rôles alliés en accord avec les annotations confirmed | **67 / 68** |

Les 20/20 concernent les **identités des picks confirmés**, pas une reconstruction parfaite des rôles et des dix bans sur chaque image. Les quatre bans non reconnus sont laissés non résolus, sans fabriquer un champion. Dix positions annotées Unknown restent non résolues après le contrôle des détections contradictoires.

L’ancien prototype a été réévalué avec les **mêmes vingt images et les nouvelles annotations** : 88/135 picks retrouvés, aucun faux ajout, tous les picks corrects sur 6/20 captures. Cela fournit une comparaison plus juste que comparer directement les 58 % du précédent sous-ensemble de quinze images aux chiffres du nouveau jeu complet.

## Ce qui a changé

1. **Localiser le client avant de reconnaître les champions.** Le plein écran est vérifié par les portraits et les bans. Pour une fenêtre intégrée dans un stream/bureau, les cercles alignés, les bordures du client et les petits portraits de la rangée de bans proposent une géométrie. Une comparaison des templates vérifie les hypothèses. Aucun rectangle par identifiant d’image n’est fourni au reconnaisseur.
2. **Comparer les portraits directement aux assets locaux.** Les bandes latérales sont examinées aux positions du client, avec une petite recherche de translation et d’échelle. Le choix d’un template ne dépend plus obligatoirement de la lecture du nom. Les régions centrales contenant des champions disponibles et les grands splash arts ne sont pas utilisées comme picks.
3. **Traiter les bans à leur résolution réelle.** Les minuscules portraits sont comparés à des références réduites à 16×16, en conservant les informations de couleur et de luminance. Une géométrie commune est ajustée par rangée, avec une petite correction locale. Cela évite de déformer indépendamment chaque crop jusqu’à trouver un faux visage ressemblant.
4. **Séparer identité et état.** Le décalage des présélections alliées, le texte Picking/Choosing et la barre rouge du tour actif adverse distinguent les intentions et choix en cours des picks verrouillés. Par exemple, Thresh dans la fenêtre embarquée de l’image 007 est identifié mais reste un choix en cours.
5. **Lire le texte en secours, dans les régions utiles.** Une lecture ciblée à la résolution originale porte sur les deux premières lignes du slot. Un masque de texte clair/doré réduit les effets des grandes images de fond et des incrustations. Cela récupère notamment le nom de Kha’Zix malgré le panneau statistique qui recouvre son portrait, et Lux malgré le décor du stream.
6. **S’abstenir sur les ambiguïtés.** Un score de similarité et un écart avec le second template sont exigés. Les identités répétées et contradictoires dans une même rangée de bans sont laissées à vérifier ; un même ban dans les deux équipes reste autorisé. Cette vérification retire ici des propositions Ambessa répétées sur des widgets recouvrant des bans annotés Unknown. Le prototype ne distingue pas encore systématiquement « emplacement réellement vide » de « aucun portrait reconnu » : son statut unresolved signifie simplement qu’il n’a rien à ajouter.

La reconnaissance est un assemblage de vision classique, de templates et d’OCR. **Aucun appel LLM, aucune API d’inférence payante, aucun apprentissage spécifique sur les annotations.** Tesseract utilise néanmoins un modèle OCR préentraîné ; « aucun ML n’intervient nulle part » serait donc inexact. Aucun traitement particulier des skins n’a été nécessaire.

Sur les 135 picks confirmés, 117 ont aussi un meilleur template visuel correct au-dessus des seuils visuels configurés. Les textes et contraintes d’état apportent le complément ; le résultat final n’est donc pas présenté comme un reconnaisseur de portraits entièrement indépendant du texte.

## Cas intéressants et limites

- **Capture japonaise 009 :** les dix picks et dix bans sont reconnus. Les identités viennent des portraits ; les rôles sans texte anglais exploitable sont estimés par les statistiques de rôle, pas lus magiquement en japonais.
- **Fenêtres intégrées 007 et 008 :** les cadres du client sont retrouvés automatiquement. Tous leurs picks confirmés et bans sont reconnus ; le choix en cours de Thresh n’est pas ajouté comme confirmé.
- **Aphelios, capture 006 :** deux bans restent sans identification assez fiable avec les références actuelles. L’hypothèse d’une ancienne variante de portrait ou d’une différence de rendu n’a pas été confirmée. Une tentative de lecture de deux assets historiques officiels a rencontré un refus réseau du proxy ; aucun asset alternatif ni traitement des skins n’a été ajouté pour contourner ce blocage.
- **Wukong 019 et Akali 020 :** les cinquièmes bans adverses sont tronqués par le décor du stream. L’annotation indique leur nom d’après la relecture utilisateur ; ils sont conservés dans le dénominateur et comptés comme manqués.
- **Présélection Master Yi 013 :** une intention de pick n’est pas identifiée. Elle ne devient pas pour autant un faux pick confirmé.
- **Mel Bot 013 :** le champion est correctement reconnu, mais son rôle est proposé Mid par popularité lorsque son libellé est masqué. Exploiter aussi les rôles visibles des joueurs encore en attente pourrait lever cette ambiguïté dans une prochaine version.

Les rôles adverses sont estimés par recherche d’une affectation à rôles distincts maximisant les parts de rôle du catalogue existant, en conservant les rôles lus lorsqu’ils sont utilisables. L’accord avec les 67 rôles adverses estimés par les annotations est de **58/67** ; ce n’est pas une précision sur des rôles adverses réellement observés. Les flex picks peuvent rester ambigus. La sortie conserve `role_source` pour distinguer lecture et estimation.

Le prototype Python n’est pas optimisé : cette exécution prend environ **236 secondes pour les vingt images**, médiane **9,9 secondes**, maximum **28,5 secondes** sur cette machine. Ce n’est pas un benchmark de navigateur, ni une garantie de latence d’un futur service. Les nombreuses recherches de géométrie et passes OCR pourraient être réduites avant intégration.

Il reste à vérifier des captures nouvelles, d’autres tailles de fenêtres, langues et surcouches. Une future intégration devrait montrer un aperçu, laisser corriger les rôles et conserver les placements manuels existants. **Cette intégration n’est pas implémentée dans ce lot.**

## Provenance et protocole

Archive fournie : `lol_champion_select_dataset.zip`, SHA-256 `2e97bdf32c161629c77436b338dd290fd73e11b99a48933cc87a8e2d9edc9bcf`. Les vingt empreintes d’images correspondent au manifeste et sont identiques à celles du premier jeu ; les annotations ont été corrigées et enrichies avec les bans et états provisoires. Les métadonnées de publication ne prouvent pas la date exacte de la capture d’une image republiée.

Le reconnaisseur reçoit uniquement les pixels, les portraits/noms du catalogue et, facultativement, les statistiques de rôles publiées. **Il ne consulte pas les annotations pour choisir ses champions, états, positions ou rôles.** Les annotations servent à l’évaluation après reconnaissance. Les réglages ont été développés en observant les résultats des vingt cas, conformément à la demande ; aucun résultat hors échantillon n’est revendiqué.

L’évaluation compte les identités par équipe avec des multisets, pénalisant les doublons, mauvais champions et mauvaises équipes. Les bans sont évalués par équipe **et par emplacement**, en distinguant les vrais vides des Unknown non évaluables. Les états provisoires exigent une correspondance champion/équipe/slot/état.

Le contrôle final des doublons de bans a été appliqué aux prédictions enregistrées, puis l’ensemble des métriques a été recalculé. Il ne change pas les 135 picks ou 180 bans corrects ; il retire quatre propositions non vérifiables sur les positions Unknown. Il est inclus dans le script reproductible.

## Reproduction et résultats

Les images, crops intermédiaires et caches OCR contenant des pseudonymes restent dans le dossier local ignoré `work/image-poc-v2`. Aucun screenshot du dataset n’est redistribué dans le dépôt. Les JSON de résultats ne contiennent que noms de champions, rôles, états, similarités et métadonnées techniques.

Script : [draft_image_poc_v2.py](../../scripts/experiments/draft_image_poc_v2.py), avec la base commune [draft_image_poc.py](../../scripts/experiments/draft_image_poc.py). Dépendances optionnelles de l’expérience : OpenCV headless 5.0.0, NumPy 2.5.5, Pillow 13.0.0, Tesseract 5.5.0 avec la langue anglaise. Aucun ajout aux dépendances frontend.

```sh
PYTHONPATH=/tmp/draftroom-image-poc-deps OPENBLAS_NUM_THREADS=1 \
python3 scripts/experiments/draft_image_poc_v2.py \
  --dataset work/image-poc-v2/dataset/lol_champion_select_dataset \
  --output work/image-poc-v2/replay \
  --catalogue work/image-poc/role-catalogue.json
```

Le chemin temporaire de dépendances est propre à cette machine ; sur une autre, installer ces dépendances dans un environnement Python isolé. Le catalogue facultatif est l’export existant de 413 couples champion/rôle. Sans catalogue, les rôles non lus restent inconnus.

- [Bilan structuré et résultats par image](screenshot-poc-v2-results.json)
- [Prédictions détaillées pour les vingt captures](screenshot-poc-v2-predictions.json)
