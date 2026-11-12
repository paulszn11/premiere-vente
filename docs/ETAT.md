# État des fonctionnalités

Mis à jour le 12/11/2026 — version 0.1.0 (phase 1).

Légende des tests :
- **Auto** : vérifié par les tests automatiques (Node et Chromium sans carte graphique).
- **Appareil réel** : reste à vérifier sur un vrai téléphone, une tablette et un ordinateur. Aucune fonctionnalité n'est considérée comme validée tant que ce n'est pas fait.

## Terminé (phase 1)

| Fonctionnalité | Section du cahier | Tests |
| --- | --- | --- |
| Projet TypeScript + Vite, moteur Babylon.js 9, physique Rapier 0.21 | 14.1, 16 | Auto |
| Première scène 3D : relief généré, eau, arbres, lumière, brouillard | 16 (phase 1) | Auto · Appareil réel |
| Monde continu : chargement progressif par chunks, niveaux de détail | 3, 14 | Auto · Appareil réel |
| Relief et arbres déterministes (même graine = même monde au bit près) | 14.3 | Auto |
| Sol physique identique au sol affiché, troncs d'arbres solides | 7 | Auto |
| Vue à la première personne | 6, 7.1 | Auto · Appareil réel |
| Marche et course avec accélération et inertie, saut, gravité | 7.4 | Auto · Appareil réel |
| Pentes : gravissables jusqu'à 45°, bloquantes au-delà ; descente sans décoller | 7.4 | Auto |
| Simulation à pas fixe (60 Hz) séparée de l'affichage, interpolation | 14.2 | Auto |
| Commandes clavier et souris (pointeur verrouillé, filtrage des sauts parasites) | 2.2 | Auto · Appareil réel |
| Commandes tactiles : joystick, regard en glissant, boutons Sauter / Courir / Menu | 2.2 | Auto (tactile simulé) · Appareil réel |
| Manette (sticks, boutons, Start = pause) | 2.2 | Auto (manette simulée) · Appareil réel |
| Commandes personnalisables (clavier, souris, boutons de manette) | 2.2 | Auto |
| Niveaux de qualité Basse / Moyenne / Haute / Ultra, choix automatique selon l'appareil | 2.3, 14 | Auto · Appareil réel |
| Résolution adaptative (baisse si le jeu ralentit, remonte ensuite) | 2.3 | Auto |
| Réglages : qualité, distance d'affichage, résolution, champ de vision, sensibilités, axe inversé | 2.3 | Auto |
| Réglages conservés dans le navigateur | 3.3 (paramètres individuels) | Auto |
| Infos de performance en jeu (F3) | 14 | Auto |
| Test de performance intégré, sur 4 niveaux, avec rapport copiable | 16 (phase 1) | Auto · **Appareil réel (à faire)** |
| WebGL 2 par défaut, WebGPU en option avec repli automatique | 14.1 | Auto (WebGPU logiciel) · Appareil réel |
| Installable comme application (manifeste, service worker, icônes), mises à jour automatiques | 2.1, 15 | Appareil réel |
| Pause automatique quand l'application passe en arrière-plan | — | Auto (partiel) |

## Préparé mais pas encore branché (phase 8)

| Élément | Fichier | Tests |
| --- | --- | --- |
| Code d'accès permanent du monde (16 caractères, 80 bits) | `src/shared/worldcode.ts` | Auto |
| Protocole réseau validé côté serveur | `src/shared/protocol.ts` | Auto |
| Limitation des tentatives de connexion (par source et globale) | `src/shared/ratelimit.ts` | Auto |
| Sauvegardes : dernière + 3 de sécurité, empreinte SHA-256, restauration | `src/server/save.ts` | Auto (stockage en mémoire) |
| Prédiction client et réconciliation, interpolation des autres joueurs | `src/client/net/prediction.ts` | **Non testé** |

## En cours

Rien : la phase 1 attend les tests sur appareils réels (voir `docs/PHASE-1.md`).

## Restant

| Phase | Contenu |
| --- | --- |
| 1 (validation) | Tests de performance sur vos appareils, réglage des qualités par défaut |
| 2 | Biomes prototypes, équilibre, fatigue liée au déplacement, influence du terrain (boue, neige), escalade, chutes avec blessures, nage, interactions avec les objets, accroupissement |
| 3 | Santé, énergie, fatigue, blessures localisées, sac à dos physique, objets manipulables et transportables à deux mains |
| 4 | Récolte, outils, matériaux, recettes, fabrication physique, qualité et usure |
| 5 | Construction physique, structures, destruction, installations |
| 6 | Intelligence artificielle, écosystème, créatures, détection, combats, horreur sous-marine |
| 7 | Véhicules et machines |
| 8 | Serveur chez l'hôte (navigateur et programme compagnon), connexion WebRTC, synchronisation, permissions, sauvegardes, sécurité |
| 9 | Monde complet : biomes, grottes, bâtiments, histoire, documents, événements, catastrophes, météo, cycle jour/nuit |
| 10 | Optimisation, tests sur appareils, installation, documentation, programme compagnon |
| Plus tard | Graphismes soignés (textures, ombres, ciel, effets), son et musique adaptative, interface intégrée à l'univers, menus pilotables à la manette |

## Limites connues

- Pas de sauvegarde de la partie en phase 1 : on repart du point de départ à chaque partie (seuls la graine du monde et les réglages sont gardés).
- Les menus se pilotent au clavier, à la souris ou au doigt, pas encore à la manette (sauf Start pour la pause).
- Les chiffres du test de performance obtenus ici viennent d'un rendu logiciel, sans carte graphique : ils ne disent rien des vrais appareils.
- La résolution adaptative peut baisser inutilement sur un écran limité à 30 images par seconde (mode économie d'énergie) : désactivable dans les réglages.
