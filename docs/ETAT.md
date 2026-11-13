# État des fonctionnalités

Mis à jour le 13/11/2026, version 0.4.0.
- **Phase 1 :** validée par le propriétaire du projet le 12/11/2026.
- **Phase 2 :** terminée, puis vérifiée en profondeur à votre demande le 12/11/2026.
- **Phase 3 :** terminée le 13/11/2026 (119 tests unitaires, 122 vérifications navigateur). Les décisions de la section 15 qui la concernent m'ont été confiées et sont détaillées dans `docs/PHASE-3.md`. Reste à l'essayer sur vos appareils.
- **Phase 4 :** terminée le 13/11/2026 (146 tests unitaires, 151 vérifications navigateur, dont 31 propres à la phase 4). Les éléments de la section 15 qui la concernent (liste des matériaux et leurs propriétés, amélioration de l'équipement) sont des propositions signalées et modifiables, détaillées dans `docs/PHASE-4.md`. Reste à l'essayer sur vos appareils.

Légende des tests :
- **Auto** : vérifié par les tests automatiques (Node et Chromium sans carte graphique).
- **Appareil réel** : à vérifier sur un vrai téléphone, une tablette et un ordinateur. Rapports reçus : iPhone (phase 1), 60 images/s à tous les niveaux ; ordinateur tactile Linux à puce Mali-G57 (version 0.4.0, écran 90 Hz), 90 images/s à tous les niveaux, Ultra compris (1 % bas ≥ 77, calcul ≤ 3 ms).

## Terminé — phase 1

| Fonctionnalité | Section du cahier | Tests |
| --- | --- | --- |
| Projet TypeScript + Vite, moteur Babylon.js 9, physique Rapier 0.21 | 14.1, 16 | Auto |
| Monde continu : chargement progressif par chunks, niveaux de détail | 3, 14 | Auto · Appareil réel (iPhone) |
| Sol physique identique au sol affiché | 7 | Auto |
| Vue à la première personne ; marche et course avec accélération et inertie, saut | 6, 7.4 | Auto |
| Simulation à pas fixe (60 Hz) séparée de l'affichage | 14.2 | Auto |
| Commandes clavier, souris, tactile, manette, personnalisables | 2.2 | Auto |
| Qualités Basse à Ultra, choix automatique (Haute sur iPhone et iPad), résolution adaptative | 2.3, 14 | Auto · Appareil réel (iPhone) |
| Réglages conservés ; infos de performance (F3) ; test de performance avec rapport | 3.3, 14, 16 | Auto · Appareil réel (iPhone) |
| WebGL 2 par défaut, WebGPU en option avec repli | 14.1 | Auto |
| Installable comme application (PWA), mises à jour automatiques | 2.1, 15 | Appareil réel |

## Terminé — phase 2 (à valider sur vos appareils)

| Fonctionnalité | Section du cahier | Tests |
| --- | --- | --- |
| Monde de 16 km × 16 km inspiré du Zimbabwe, 11 biomes à la géographie logique, montagnes frontalières | 3, 4.1 | Auto |
| Fleuves (Zambèze, Limpopo) et grand lac, kopjes de granit (chacun avec un côté praticable), zones humides | 4.1, 4.3 | Auto |
| Flore par biome (8 espèces), buissons, rochers en équilibre, termitières, collisions | 5, 4.1 | Auto |
| Sols : herbe, terre, sable, boue, roche, granite, neige, eau (vitesse, adhérence, pente, amorti) | 5 (terrain dynamique), 7 | Auto |
| Accroupissement, avec vérification de la place au-dessus de la tête | 7.4 | Auto |
| Endurance (course, saut, nage, escalade), épuisement | 7.3, 7.4 | Auto |
| Équilibre et trébuchement | 7.4 | Auto |
| Chutes selon hauteur, vitesse, sol et posture (4 niveaux ; blessures en phase 3) | 7.6 | Auto |
| Nage (flottaison, effort), plongée (souffle, visibilité selon la profondeur), courants | 7.7 | Auto |
| Escalade des parois rocheuses (dès 41° sur le granite, endurance, passage du rebord, lâcher, saut en arrière) | 7.5 | Auto (y compris un vrai kopje) |
| Objets : prendre, porter à une ou deux mains, poser, lancer, traîner, pousser, mémoriser leur position | 6.2, 7 | Auto |
| Apparition au hasard, loin des autres joueurs (principe du jeu) | 3.2, 11 | Auto |
| Effets de caméra (marche, atterrissage, accroupi, trébuchement, course, nage) | 13 | Auto (partiel) |
| Terrain et flore calculés dans un fil séparé, cache des hauteurs physiques | 14.5 | Auto |
| Outils de test : téléportation vers chaque région | — | Auto |

## Terminé — phase 3 (à valider sur vos appareils)

| Fonctionnalité | Section du cahier | Tests |
| --- | --- | --- |
| Objets du monde : bâtons, fruits du pays (baobab, figue, muhacha), aloès ; ramasser directement en poche ou dans le sac | 7.2, 9 | Auto |
| Inventaire physique : 4 poches, sac de 30 litres, poids et volume, sac posé, objets visibles et manipulables | 7.2 | Auto |
| Vue du sac en 3D et examen du corps (doigt, souris, clavier, manette) | 7.2, 13.4 | Auto |
| Charge portée : vitesse, endurance, course et saut limités, sac lourd qui fait couler | 7.2, 7.4 | Auto |
| Santé (rendue seulement par la nourriture et un peu par le sommeil), sans faim ni soif ni température | 7.3 | Auto |
| Énergie (fixe l'endurance maximale), fatigue (sommeil, micro-sommeils, endormissement forcé) | 7.3, 7.4 | Auto |
| Blessures localisées : contusion, entorse, fracture, coupure, commotion ; effets sur les déplacements et les actions | 8.4, 7.6 | Auto |
| Soins par gestes : bandage (chiffons de vêtements), attelle (bâtons + chiffons), aloès ; infections si mal soigné | 8.5 | Auto |
| Perte de connaissance, état critique, abandon, noyade | 8.6 | Auto |
| Mort, corps fouillable laissé dans le monde, réapparition au dernier sommeil ou au point d'arrivée, souvenir du corps | 8.7 | Auto |
| Sauvegarde de la partie solo dans le navigateur (joueur, sac, objets du monde, corps) | 3.3 | Auto |

## Terminé — phase 4 (à valider sur vos appareils)

| Fonctionnalité | Section du cahier | Tests |
| --- | --- | --- |
| Gisements répartis par biome : quartz (commun), herbes sèches, argile, fer (rare), or (très rare), déterministes | 9.1 | Auto |
| Récolte par gestes avec l'outil en main (« Utiliser », maintenir pour enchaîner) : tailler le quartz au galet, écorcer, couper branches et perches, entailler pour la résine, creuser l'argile, orpailler | 9.2 | Auto |
| Abattage à la hache : souche, bûches, repousse au bout de 12 h ; fruits et bois mort disparaissent avec l'arbre | 9.2, 9.6, 6.4 | Auto |
| Épuisement et reconstitution des gisements et des parties d'arbre, chacun à son rythme | 9.6 | Auto |
| Plan de travail sur la toile du sac (6 pièces en 3D) ; recettes par étapes, chacune avec son outil | 9.3 | Auto |
| 12 recettes (fibres, cordes, couteau, hache, bâton à fouir, lance, archet, pot, batée, foyer, pansements) ; carnet ; recettes pressenties ; expérimentation avec indices | 9.4 | Auto |
| Compétence « Fabrication » : qualité, défauts plus rares, gestes plus rapides | 9.4, 12.3 | Auto |
| Qualité, défauts, usure par états, efficacité selon l'état, réparations qui réduisent le maximum, améliorations (feu, résine) | 9.5 | Auto |
| Démontage : pièces récupérées selon l'état | 9.7 | Auto |
| Outils avec masse, portée, équilibre, durabilité (base des armes de mêlée) | 8.3 | Auto |
| Feu : foyer, allumage à l'archet (peut échouer), bois, cuisson du pot, eau bouillie, pansements propres (jamais d'infection), fumée visible de loin | 9.3, 8.5 | Auto |
| Interface : onglets Fabriquer et Carnet, état des outils, panneau du foyer ; doigt, souris, clavier et manette | 13.4, 2.2 | Auto |
| Sauvegarde du plan de travail, du carnet et de l'état du monde (gisements, arbres, foyers) | 3.3 | Auto |

## Préparé mais pas encore branché (phase 8)

| Élément | Fichier | Tests |
| --- | --- | --- |
| Code d'accès permanent du monde (16 caractères, 80 bits) | `src/shared/worldcode.ts` | Auto |
| Protocole réseau validé côté serveur | `src/shared/protocol.ts` | Auto |
| Limitation des tentatives de connexion | `src/shared/ratelimit.ts` | Auto |
| Sauvegardes : dernière + 3 de sécurité, empreinte SHA-256, restauration | `src/server/save.ts` | Auto |
| Apparition loin des joueurs déjà présents | `src/shared/spawn.ts` | Auto |
| Prédiction client et réconciliation | `src/client/net/prediction.ts` | **Non testé** (à adapter aux nouveaux états) |
| Secours d'un joueur par un autre (bander, relever) ; traîner un corps | `src/shared/vitals.ts` (`rescue`), `src/shared/simulation.ts` | Auto (règle) ; à brancher avec le multijoueur |
| Actions du joueur validées pour le réseau | `src/shared/actions.ts` | Auto |

## En cours

La validation des phases 2, 3 et 4 sur vos appareils.

## Restant

| Phase | Contenu |
| --- | --- |
| 2 (suivi) | Animation des mains en escalade, prises plus fines ; ruisseaux et chutes d'eau (avec la phase 9) |
| 3 (suivi) | Objets manipulés à la main dans la vue du sac, examen du corps en vue réelle, vêtements de rechange ; secours entre joueurs (avec la phase 8) |
| 4 (suivi) | Manipulation libre des pièces en 3D, animations des gestes (coups d'outil, chute des arbres) ; matériel de plongée (avec les phases 6 et 9) ; usage de l'or (commerce, section 15) |
| 5 | Construction physique, structures, destruction, installations |
| 6 | Intelligence artificielle, écosystème, créatures, détection, combats, horreur sous-marine |
| 7 | Véhicules et machines |
| 8 | Serveur chez l'hôte (navigateur et programme compagnon), code privé, connexion WebRTC, synchronisation, permissions, sauvegardes du monde et des joueurs, 10 joueurs |
| 9 | Monde complet : grottes, bâtiments abandonnés, histoire, documents, événements, catastrophes, météo, cycle jour/nuit, carte révélée progressivement |
| 10 | Optimisation, tests sur appareils, installation, documentation, programme compagnon |
| Plus tard | Graphismes soignés (textures, ombres, ciel, effets), son et musique adaptative, interface intégrée à l'univers, menus pilotables à la manette |

## Limites connues

- En solo, la partie est sauvegardée dans ce navigateur : position, état du corps, sac, objets ramassés, déplacés ou posés, et corps. Les sauvegardes du monde partagé, chez l'hôte, arrivent en phase 8.
- Les indications à l'écran (nom du biome, action possible, barres d'endurance et de souffle, bords rouges, messages) sont temporaires.
- Matériel médical : chiffons, attelles, aloès et pansements propres (chiffons bouillis). Pas encore de plantes médicinales ni de médicaments.
- Les temps de reconstitution (gisements, arbres, fruits) comptent en temps de jeu. Sans cycle jour/nuit (phase 9), ce temps avance comme le temps réel, et seulement pendant qu'on joue.
- Pas d'animation des gestes : l'outil ne bouge pas à chaque coup et l'arbre abattu disparaît d'un coup en laissant sa souche.
- Les menus se pilotent au clavier, à la souris ou au doigt, pas encore à la manette (sauf Start pour la pause).
- La résolution adaptative peut baisser inutilement sur un écran limité à 30 images par seconde : désactivable dans les réglages.
