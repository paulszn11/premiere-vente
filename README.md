# Bienvenue au Zimbabwe

Jeu 3D de survie, d'exploration, de construction et d'horreur, jouable dans le navigateur et installable comme une application (PWA) sur téléphone, tablette et ordinateur.

**État : phase 6 terminée (202 tests unitaires et 186 vérifications dans le navigateur, toutes réussies).** Le prototype contient :
- un monde de 16 km × 16 km inspiré du Zimbabwe : vallée du Zambèze et grand lac, haut plateau, forêts de miombo, collines de granit, hautes terres, lowveld, sables du Kalahari ;
- les déplacements à la première personne : marche, course, accroupi, saut, nage et plongée, escalade, avec endurance, équilibre et chutes ;
- les objets à prendre, porter, lancer et traîner ;
- la survie (phase 3) :
  - santé, énergie, fatigue et sommeil ;
  - blessures localisées et soins (chiffons, attelles, aloès) ;
  - fruits du pays ;
  - sac à dos de 30 litres et 4 poches, avec une vue du sac en 3D ;
  - perte de connaissance et mort ;
  - corps laissé dans le monde et réapparition ;
- les ressources et la fabrication (phase 4) :
  - gisements de quartz, d'herbes sèches, d'argile, de fer et d'or, répartis selon les régions ;
  - récolte par gestes avec l'outil en main : tailler le quartz, écorcer, couper, abattre un arbre ;
  - un plan de travail sur la toile du sac, des recettes par étapes et un carnet, avec découverte et expérimentation ;
  - qualité, usure, réparations, améliorations et démontage des outils ;
  - le feu, l'eau bouillie, les pansements propres, et une fumée visible de loin ;
- la construction (phase 5) :
  - on trace un plan qui s'accroche aux pièces voisines, puis on l'assemble étape par étape avec les matériaux et les outils ;
  - planchers (sur pilotis au-dessus des pentes et de l'eau), murs de clayonnage et de torchis, murs en pierre sèche, portes, toits de chaume, échelles, clôtures d'épines ;
  - stabilité : sans appui, les pièces s'effondrent en débris ; on peut aussi détruire à l'outil, par les chocs ou par le feu ;
  - installations : coffre, établi, puits, bas fourneau et forge (le fer : clous, boulons, outils), torches ;
- les créatures et l'horreur (phase 6) :
  - une faune du Zimbabwe vivante : impalas, phacochères, babouins, éléphants, hyènes, léopards, crocodiles, vautours, avec des populations qui naissent, migrent et réagissent à la chasse ;
  - chaque espèce a ses sens (vue, ouïe, odorat et pistes de sang, crainte du feu) et ses comportements : fuite et alarme, charges, hyènes qui encerclent, léopard qui traque par derrière ;
  - combats avec ce qu'on tient (coups localisés, objets lancés), carcasses à dépecer, viande à cuire, pièges (collet, assommoir, fosse à pieux) ;
  - une créature mystérieuse dans les eaux profondes du lac ;
  - des sons placés dans l'espace, fabriqués par le navigateur ;
- les commandes au clavier, à la souris, au tactile et à la manette ;
- des réglages graphiques adaptatifs et un test de performance intégré.

Le jeu est solo pour l'instant. Le multijoueur arrive en phase 8 : un joueur héberge le monde, les autres le rejoignent avec un code privé. Les graphismes restent volontairement simples. Le détail est dans [`docs/ETAT.md`](docs/ETAT.md).

![Les régions du monde](docs/captures/biomes-phase2.png)

## Jouer

Site : https://bienvenue-au-zimbabwe.vercel.app

Tant que la protection Vercel est activée, il faut être connecté à son compte Vercel pour ouvrir le site. Pour l'ouvrir à tout le monde, allez dans le projet Vercel, Settings, puis Deployment Protection.

| Action | Clavier / souris | Manette | Tactile |
| --- | --- | --- | --- |
| Se déplacer | W A S D (Z Q S D en AZERTY) ou flèches | Stick gauche, croix | Joystick (moitié gauche de l'écran) |
| Regarder | Souris (cliquez dans le jeu) | Stick droit | Glisser sur la moitié droite |
| Sauter · grimper face à une paroi · monter (nage) | Espace | A / Croix | Bouton « Sauter » |
| Courir · nager vite | Maj gauche (maintenir) | Clic du stick gauche | Bouton « Courir » |
| S'accroupir · plonger · lâcher la paroi | C | B / Rond | Bouton « Accroupir » |
| Prendre · ramasser · poser · traîner · fouiller | E | X / Carré | Bouton « Prendre » |
| Lancer l'objet porté | Clic gauche | RT / R2 | Bouton « Lancer » |
| Utiliser l'objet en main : manger, soigner, frapper, couper, abattre (maintenir pour enchaîner les coups) | Clic droit ou F | LT / L2 | Bouton « Utiliser » |
| Sac, examen du corps, fabrication, carnet | Tab ou I | Y / Triangle | Bouton « Sac » |
| S'asseoir · dormir (maintenir) | R | LB / L1 | Sac → onglet « Corps » |
| Poches 1 à 4 | 1 à 4 | RB / R1 (poche suivante) | Dans le sac |
| Menu / pause | Échap | Start | Bouton ☰ |
| Infos de performance | F3 | Select | — |

Toutes les touches se changent dans « Réglages » → « Commandes ».

Dans le sac :
- toucher ou cliquer un objet affiche ses actions, dont « Poser sur le plan de travail » ;
- l'onglet « Fabriquer » montre la recette reconnue et ses étapes, avec le bouton « Faire » ;
- l'onglet « Construire » liste les plans connus avec leurs matériaux : « Tracer » passe en mode construction ;
- l'onglet « Carnet » liste les recettes et les plans connus, et les idées ;
- à la manette, LB et RB changent d'onglet ; dans « Fabriquer », X pose l'objet choisi sur le plan de travail et A fabrique ; dans « Construire », le stick choisit un plan et A le trace.

En mode construction :

| Action | Clavier / souris | Manette | Tactile |
| --- | --- | --- | --- |
| Poser le plan | Clic gauche | RT | « Poser » |
| Tourner le plan | R ou E | LB, RB ou X | « Tourner » |
| Annuler | Clic droit ou F | LT | « Annuler » |

Ensuite, « Utiliser » sur le chantier fait l'étape suivante (les matériaux peuvent être sur vous ou posés à côté). E sur une pièce ouvre une porte ou montre la pièce : réparer, enduire de torchis, démonter, éteindre un feu.

Face aux créatures :

| Action | Clavier / souris | Manette | Tactile |
| --- | --- | --- | --- |
| Frapper l'animal visé, avec ce que vous tenez | Clic droit ou F | LT | « Utiliser » |
| Lancer une pierre ou une lance | Clic gauche | RT | « Lancer » |
| Se débattre quand une créature vous tient | E à répétition | X à répétition | « Prendre » à répétition |
| Dépecer une carcasse (une lame en main) | Clic droit ou F | LT | « Utiliser » |
| Se dégager d'un piège, réarmer un piège | E | X | « Prendre » |

Écoutez : les cris, les frôlements et les battements de cœur préviennent du danger. Un feu ou une torche tient la plupart des animaux à distance. Un casque aide à situer les sons ; le volume se règle dans « Réglages » → « Son ».

Pour bien démarrer :
1. Prenez un galet (E) et frappez un bloc de quartz blanc (clic droit maintenu) : des éclats tranchants tombent.
2. Avec un éclat en main, écorcez un arbre.
3. Sur le plan de travail : battez l'écorce (fibres), torsadez une corde, puis fabriquez un couteau.

Pour essayer rapidement chaque région, ouvrez le menu pause, puis « Réglages » → « Outils de test ». Vous y trouverez :
- la téléportation vers le lac (nage), une paroi de granit (escalade) et chaque biome ;
- la téléportation à côté du gisement de quartz, d'argile, de fer ou d'or le plus proche ;
- un jeu d'outils (couteau, hache, bâton à fouir, batée, archet, pot, galet) ;
- des matériaux de construction posés à côté de vous (bûches, perches, bâtons, pierres, argile, cordes, herbes, clous) ;
- des créatures à faire apparaître devant vous, et une baignade au-dessus des eaux profondes du lac, là où rôde la créature.

Ces outils seront retirés ou réservés à l'hôte en multijoueur.

## Tester les performances sur vos appareils

Sur l'écran d'accueil, choisissez « Test de performance » puis attendez environ une minute. Touchez ensuite « Copier les résultats » et envoyez le texte. La procédure complète est dans [`docs/PHASE-1.md`](docs/PHASE-1.md).

## Développement

Il faut Node.js 20 ou plus.

```bash
npm install
npm run dev          # serveur de développement : http://localhost:5173
npm run build        # version de production dans dist/
npm run preview      # sert dist/ sur http://localhost:4173
npm run typecheck    # vérification des types
npm test             # tests unitaires (Vitest)
npm run test:e2e     # tests dans un vrai navigateur (Playwright + Chromium)
npm run check        # tout ce qui précède, dans l'ordre
```

Pour les tests navigateur sur votre machine, installez d'abord Playwright :

```bash
npm install --no-save playwright
npx playwright install chromium
```

Options des tests navigateur :
- `node tests/e2e/run.mjs --webgpu` ajoute le scénario WebGPU ;
- `--only=ordinateur,telephone,manette,phase2,verification,phase3,phase4,phase5,phase6,performance,captures,webgpu` ne lance que certains scénarios (« verification » : contrôle complet de la phase 2 ; « phase3 » : survie et inventaire ; « phase4 » : ressources et fabrication ; « phase5 » : construction ; « phase6 » : créatures et horreur ; chacun sur ordinateur, téléphone et manette).

Les captures et le rapport sont écrits dans `tests/e2e/out/`.

## Organisation du code

```
src/shared/     code commun au client et au futur serveur : géographie, relief, flore,
                objets, inventaire, corps du joueur (santé, blessures), ressources
                (gisements, arbres), fabrication (recettes, qualité, usure), construction
                (plans, stabilité, dégâts, collisions des pièces), actions,
                physique, déplacements, simulation à pas fixe, apparitions,
                protocole, codes de monde
src/client/     jeu dans le navigateur : rendu (Babylon.js), commandes, réglages,
                mesures de performance, écrans
src/server/     préparé pour la phase 8 : sauvegardes
src/vendor/     chargement du moteur physique en fichier WebAssembly séparé
public/         manifeste, service worker, icônes
tests/unit/     tests Vitest
tests/e2e/      tests Playwright
docs/           architecture, état des fonctionnalités, phase 1
```

## Publication

Le projet Vercel `bienvenue-au-zimbabwe` construit le site avec `npm run build` et publie le dossier `dist/` (voir `vercel.json`).

## Documentation

- [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) : architecture, technologies et raisons, compromis mobiles, risques
- [`docs/ETAT.md`](docs/ETAT.md) : fonctionnalités terminées, préparées et restantes
- [`docs/PHASE-1.md`](docs/PHASE-1.md) : architecture et prototype, procédure de test sur appareils réels
- [`docs/PHASE-2.md`](docs/PHASE-2.md) : monde et déplacements (carte, décisions, tests, limites)
- [`docs/PHASE-3.md`](docs/PHASE-3.md) : survie et inventaire (décisions inspirées d'autres jeux, tests, limites)
- [`docs/PHASE-4.md`](docs/PHASE-4.md) : ressources et fabrication (matériaux, recettes, outils, feu, tests, limites)
- [`docs/PHASE-5.md`](docs/PHASE-5.md) : construction (décisions, difficultés techniques, stabilité, destruction, installations, fer, tests, limites)
- [`docs/PHASE-6.md`](docs/PHASE-6.md) : créatures et horreur (catalogue proposé, sens, comportements, écosystème, combats, pièges, sons, tests, limites)
