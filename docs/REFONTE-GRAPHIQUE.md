# Refonte graphique — référence visuelle du propriétaire

Cette passe améliore le rendu du monde sans modifier les règles de simulation, les collisions, les sauvegardes, les contrôles ni le contenu des phases 1 à 7.

## Direction artistique

Références fournies par le propriétaire : savane africaine en plein jour, herbes hautes dorées et olive, buissons irréguliers, acacias étalés, arbres aux houppiers variés, gros rochers granitiques patinés, ciel bleu avec nuages blancs volumineux. Les créatures/personnages de référence ont des silhouettes très simples, arrondies, colorées et lisibles. Le monde doit conserver le contraste entre environnement naturel détaillé et silhouettes stylisées.

## Modifications réalisées

- `src/client/render/world-view.ts` :
  - ciel sphérique avec texture procédurale et amas nuageux doux, sans téléchargement d'asset externe ;
  - éclairage hémisphérique plus naturel et soleil directionnel renforcé ;
  - textures procédurales répétables de sol, feuillage, écorce et granite ;
  - arbres retravaillés avec troncs ramifiés, houppiers multiples et silhouettes organiques (notamment acacia en parasol) ;
  - buissons composés de plusieurs volumes irréguliers ;
  - rochers à géométrie moins sphérique et matériau granuleux ;
  - touffes d'herbe sèche et olive placées de façon déterministe, sans modifier la géographie ni la physique ;
  - ombres PCF activées uniquement sur les qualités Haute/Ultra ;
  - eau légèrement plus profonde et reflets spéculaires plus nets.

## Contraintes conservées

- Aucun fichier de `src/shared/` n'a été modifié : le terrain physique et la simulation restent inchangés.
- Les arbres, rochers et herbes restent des instances, pour limiter les appels de dessin.
- Les textures sont générées localement à l'exécution ; aucun service externe ni téléchargement d'assets n'est requis.
- Les ombres sont désactivées en qualité Basse/Moyenne.

## Vérifications

La syntaxe TypeScript de `world-view.ts` a été analysée et ne présente pas d'erreur de parsing. La vérification complète (`npm run typecheck`, `npm test`, `npm run build`, `npm run test:e2e`) n'a pas pu être exécutée dans l'environnement de préparation : l'installation des dépendances (`npm ci`) a expiré pendant le téléchargement depuis npm. Claude doit donc lancer ces commandes avant le déploiement et corriger toute erreur éventuelle.

## Limites connues de cette passe

Le rendu est amélioré de manière procédurale, mais ce n'est pas encore une reproduction photoréaliste au niveau d'un jeu AAA : les modèles restent générés par code et les matériaux n'utilisent pas encore de véritables cartes PBR haute résolution (albedo, normal, roughness). Une prochaine étape pourra intégrer des modèles et textures optimisés, sous réserve de disposer d'assets adaptés et de licences compatibles.
