# État des fonctionnalités

Mis à jour le 14/11/2026, version 0.7.1.
- **Phase 1 :** validée par le propriétaire du projet le 12/11/2026.
- **Phase 2 :** terminée, puis vérifiée en profondeur à votre demande le 12/11/2026.
- **Phase 3 :** terminée le 13/11/2026 (119 tests unitaires, 122 vérifications navigateur). Les décisions de la section 15 qui la concernent m'ont été confiées et sont détaillées dans `docs/PHASE-3.md`. Reste à l'essayer sur vos appareils.
- **Phase 4 :** terminée le 13/11/2026 (146 tests unitaires, 151 vérifications navigateur, dont 31 propres à la phase 4). Les éléments de la section 15 qui la concernent (liste des matériaux et leurs propriétés, amélioration de l'équipement) sont des propositions signalées et modifiables, détaillées dans `docs/PHASE-4.md`. Validée par le propriétaire du projet le 13/11/2026.
- **Phase 5 :** terminée le 13/11/2026 (181 tests unitaires, 168 vérifications navigateur, dont 16 propres à la phase 5). Les éléments de la section 15 qui la concernent (matériaux de construction, leurs propriétés, les améliorations) sont des propositions signalées et modifiables, détaillées dans `docs/PHASE-5.md`. Reste à l'essayer sur vos appareils.
- **Phase 6 :** terminée le 13/11/2026 (202 tests unitaires, 186 vérifications navigateur, dont 18 propres à la phase 6). Le catalogue des créatures (section 15) est une proposition signalée et modifiable, détaillée dans `docs/PHASE-6.md`. Reste à l'essayer sur vos appareils.
- **Phase 7 :** terminée le 13/11/2026 (222 tests unitaires, 206 vérifications navigateur, dont 16 propres à la phase 7). Les types de véhicules, de composants et de machines (section 15) sont une proposition signalée et modifiable, détaillée dans `docs/PHASE-7.md`. Reste à l'essayer sur vos appareils.
- **Phase 7, limites levées le 14/11/2026 (version 0.7.1) :** coffre des véhicules, créatures qui contournent et bousculent les véhicules, roue à eau calculée par la théorie des roues à impulsion (avec un bief), pirogue creusée dans un vrai tronc puis poussée jusqu'à l'eau, renversement à l'angle de stabilité statique, vent et vagues (flottaison, dérive, surface de l'eau qui ondule), joueur emporté par le véhicule où il se tient, sons des véhicules et des machines. 228 tests unitaires (26 pour la phase 7), 210 vérifications navigateur (20 pour la phase 7), toutes réussies.
- **Correction (tactile), phase 7 :** le toucher qui ouvrait un panneau (véhicule, fourneau, coffre…) pouvait déclencher le bouton apparu sous le doigt ; les boutons ignorent maintenant les clics pendant 0,45 s après l'ouverture.
- **Correction (manette), présente depuis la phase 3 :** maintenir Y ouvrait puis refermait le sac à chaque image (de même pour Start et la pause, et pour une touche du clavier maintenue plus d'une demi-seconde). Un bouton encore enfoncé à l'ouverture du sac ou à la pause est maintenant ignoré jusqu'à ce qu'on le relâche.

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

## Terminé — phase 5 (à valider sur vos appareils)

| Fonctionnalité | Section du cahier | Tests |
| --- | --- | --- |
| Tracer un plan (fantôme vert ou rouge) qui s'accroche sur une grille de 2 m ; au doigt, à la souris, à la manette | 10.1, 2.2 | Auto |
| Chantier assemblé physiquement : étapes avec outils, matériaux sur soi ou posés à côté, bûches et pierres portées à la main | 10.2 | Auto |
| Pièces : plancher (sur pilotis : pentes, eau), dallage, poteau, mur de clayonnage, torchis, mur en pierre sèche, porte, toit de chaume, échelle, clôture d'épines | 10.1, 10.2 | Auto |
| Fixations adaptées : cordes, clous et boulons forgés, pierres emboîtées, torchis ; soudure à la forge pour les outils en fer | 10.2 | Auto |
| Stabilité : appuis venus du sol, porte-à-faux limité, matériaux ; effondrement en cascade et débris physiques | 10.2, 10.4 | Auto |
| Destruction selon l'outil et le matériau, chocs physiques, incendies qui se propagent, extinction ; réparation, démontage | 10.4, 6.3, 9.7 | Auto |
| Portes qui bloquent le passage, échelles qui s'escaladent, collisions seulement près du joueur | 10.2, 14.5 | Auto |
| Installations : coffre, établi, puits, bas fourneau à soufflet, forge ; torches et lumière | 10.3 | Auto |
| Métallurgie du fer : minerai → loupe → barre → clous, boulons, hache et couteau en fer | 10.3, 9.3 | Auto |
| Sauvegarde des constructions, chantiers et installations | 3.3 | Auto |

## Terminé — phase 6 (à valider sur vos appareils)

| Fonctionnalité | Section du cahier | Tests |
| --- | --- | --- |
| Faune du Zimbabwe : impala, phacochère, babouin, éléphant, hyène, léopard, crocodile, vautour ; créature mystérieuse dans les eaux profondes du lac | 5.1, 4 | Auto |
| Sens propres à chaque espèce : vue avec ligne de vue, ouïe des bruits du joueur, pistes et sang, crainte du feu, remous dans l'eau ; posture et regard du joueur | 5.2 | Auto |
| Comportements : fuite et alarme, défense, territoire, intimidation, vol de nourriture, charges, chasse en groupe, traque et embuscade, prise sous l'eau | 5.2 | Auto |
| Coopération : alarmes entendues par les autres espèces, vautours qui attirent les hyènes | 5.2 | Auto |
| Mémoire des habitudes : le léopard retourne là où il a vu le joueur, les babouins là où ils ont trouvé à manger | 5.2 | Auto |
| Destruction des constructions : l'éléphant renverse clôtures et murs, la hyène ronge les portes en bois | 5.2, 10.4 | Auto |
| Écosystème : populations par zone, naissances, prédation, migrations, territoires, apparitions fixes et dynamiques, mort définitive ou réapparition selon l'espèce, évolution du comportement et de la taille | 5.3, 14.5 | Auto |
| Réactions aux blessures selon la partie touchée : fuite, boiterie, saignement, contre-attaque, repli de la meute | 5.4 | Auto |
| Combats : coups localisés avec l'objet tenu (masse, équilibre, portée, usure), objets lancés ; blessures localisées du joueur, prises dont on se libère | 8.1, 8.3, 8.4 | Auto |
| Carcasses, vautours, dépeçage, viande crue ou cuite au foyer | 8, 9 | Auto |
| Pièges construits : collet, assommoir (pierre physique), fosse à pieux | 8.8 | Auto |
| Horreur : sons spatialisés fabriqués par le navigateur, cœur qui bat, sons étouffés sous l'eau, vue qui s'assombrit | 13.5, 16 | Auto (son démarré ; l'écoute reste à faire sur vos appareils) |
| Créatures animées, carcasses, traces de sang ; niveaux de simulation ; 24 créatures au plus sur téléphone | 14.5 | Auto |

## Terminé — phase 7 (à valider sur vos appareils)

| Fonctionnalité | Section du cahier | Tests |
| --- | --- | --- |
| Châssis tracés et assemblés en chantier : chariot à bras, chariot, radeau (dans l'eau peu profonde), pirogue *mukoro* | 11, 10.1 | Auto |
| Pièces fabriquées et installées : petites roues, roues cerclées de fer, essieux, machine à vapeur, roue à aubes, gouvernail ; un châssis incomplet reste calé | 11, 9.3 | Auto |
| Masse, centre de gravité et inertie calculés à partir des pièces et du conducteur | 11 | Auto |
| Roues physiques (suspensions, adhérence, braquage, freins, résistance au roulement) ; renversement si le centre de gravité est trop haut pour la pente ou le virage | 11 | Auto |
| Machine à vapeur : bois, chaleur, pression, eau qui s'évapore selon l'effort ; feu qui s'éteint ; chaudière à sec qui se fend | 11 | Auto |
| Bateaux : flottaison point par point, traînée, courant, pagaie, roue à aubes, gouvernail | 11 | Auto |
| Conduite : pousser (brancards), monter sur le siège ou à bord ; la vue tourne avec le véhicule ; effort humain et endurance ; tableau de bord | 11, 7.3 | Auto |
| Usure (distance, charge, chocs, heures de marche), pannes de plus en plus probables, réparations pièce par pièce, châssis | 11 | Auto |
| Chocs : véhicule abîmé ou détruit (pièces au sol), créatures percutées blessées | 11, 8 | Auto |
| Chargement : bûches et pierres posées sur le plateau voyagent avec le chariot (ridelles) | 11 | Auto |
| Machines et automatisation : roue à eau, machine à vapeur fixe, meule (affûtage sans perte), soufflet mécanique (fonte du fer sans le joueur), pompe (chaudières, pots) ; réseaux de transmission de 6 m | 10.3, 11 | Auto |
| Panneaux du véhicule et des machines ; au clavier, au doigt et à la manette ; outils de test | 13.4, 2.2 | Auto |
| Coffre du véhicule : petits objets, volume et charge maximaux, masse dans la physique, caisse visible | 11 | Auto |
| Créatures et véhicules : contournement, repoussées hors d'un véhicule, l'éléphant bouscule, la hyène ronge | 5.2, 11 | Auto |
| Pirogue creusée dans un vrai tronc couché ; bateau échoué poussé jusqu'à l'eau | 11 | Auto |
| Vent qui change lentement, vagues sur l'eau profonde (flottaison et affichage), dérive des bateaux | 11, 13 | Auto |
| Joueur debout sur un véhicule en mouvement : emporté avec lui, son poids le fait pencher | 11, 7 | Auto |
| Sons des véhicules et des machines (piston, roues, pagaie, roue à aubes, roue à eau, meule, soufflet, pompe, chocs) | 13.5 | Auto (sons joués ; l'écoute reste à faire sur vos appareils) |
| Sauvegarde des véhicules et des machines (coffre compris) | 3.3 | Auto |

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

La validation des phases 2, 3, 5, 6 et 7 sur vos appareils.

## Restant

| Phase | Contenu |
| --- | --- |
| 2 (suivi) | Animation des mains en escalade, prises plus fines ; ruisseaux et chutes d'eau (avec la phase 9) |
| 3 (suivi) | Objets manipulés à la main dans la vue du sac, examen du corps en vue réelle, vêtements de rechange ; secours entre joueurs (avec la phase 8) |
| 4 (suivi) | Manipulation libre des pièces en 3D, animations des gestes (coups d'outil, chute des arbres) ; matériel de plongée (avec les phases 6 et 9) ; usage de l'or (commerce, section 15) |
| 5 (suivi) | Électricité (phase 9) ; cases rondes et pièces de forme libre ; constructions dans les grottes (phase 9) ; attaques des bases (phases 6 et 8) |
| 6 (suivi) | Armes à feu (avec les bâtiments abandonnés, phase 9) ; créatures souterraines (grottes, phase 9) ; chasses nocturnes (cycle jour/nuit, phase 9) ; peaux et os (équipement) ; animations des coups et des créatures |
| 7 (suivi) | Voiles, moteurs à essence et électricité (phase 9) ; pluie et tempêtes (météo, phase 9) ; un arbre abattu qui laisse un tronc entier ; nageur soulevé par les vagues ; traction animale (à décider) |
| 8 | Serveur chez l'hôte (navigateur et programme compagnon), code privé, connexion WebRTC, synchronisation, permissions, sauvegardes du monde et des joueurs, 10 joueurs |
| 9 | Monde complet : grottes, bâtiments abandonnés, histoire, documents, événements, catastrophes, météo, cycle jour/nuit, carte révélée progressivement |
| 10 | Optimisation, tests sur appareils, installation, documentation, programme compagnon |
| Plus tard | Graphismes soignés (textures, ombres, ciel, effets), musique adaptative et sons du monde (vent, eau, pas du joueur), interface intégrée à l'univers, menus pilotables à la manette |

## Limites connues

- En solo, la partie est sauvegardée dans ce navigateur : position, état du corps, sac, objets ramassés, déplacés ou posés, et corps. Les sauvegardes du monde partagé, chez l'hôte, arrivent en phase 8.
- Les indications à l'écran (nom du biome, action possible, barres d'endurance et de souffle, bords rouges, messages) sont temporaires.
- Matériel médical : chiffons, attelles, aloès et pansements propres (chiffons bouillis). Pas encore de plantes médicinales ni de médicaments.
- Les temps de reconstitution (gisements, arbres, fruits) comptent en temps de jeu. Sans cycle jour/nuit (phase 9), ce temps avance comme le temps réel, et seulement pendant qu'on joue.
- Pas d'animation des gestes : l'outil ne bouge pas à chaque coup et l'arbre abattu disparaît d'un coup en laissant sa souche.
- Constructions : stabilité par coefficients (pas de calcul de forces ni de déformation), grille de 2 m et pièces droites, au plus deux lumières (aucune en qualité Basse).
- Créatures : formes simples et animation procédurale, déplacements sans calcul d'itinéraire (évitement par rayons), pas encore de nuit ; sons seulement pour les créatures et les combats.
- Véhicules : le renversement vient d'un couple ajouté au modèle de roues de Rapier (qui n'en produit pas), réglé sur le calcul de stabilité statique ; vagues affichées dans un rayon de 70 m et pas en qualité Basse. Détail dans `docs/PHASE-7.md`.
- Les menus se pilotent au clavier, à la souris ou au doigt, pas encore à la manette (sauf Start pour la pause).
- La résolution adaptative peut baisser inutilement sur un écran limité à 30 images par seconde : désactivable dans les réglages.
