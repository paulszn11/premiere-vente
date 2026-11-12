# État des fonctionnalités

Mis à jour le 12/11/2026, version 0.2.0.
- **Phase 1 :** validée par le propriétaire du projet le 12/11/2026.
- **Phase 2 :** terminée et vérifiée en profondeur le 12/11/2026 (69 tests unitaires, 87 vérifications navigateur). Reste à l'essayer sur vos appareils.

Légende des tests :
- **Auto** : vérifié par les tests automatiques (Node et Chromium sans carte graphique).
- **Appareil réel** : à vérifier sur un vrai téléphone, une tablette et un ordinateur. Rapport reçu : iPhone, phase 1, 60 images/s à tous les niveaux.

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

## Préparé mais pas encore branché (phase 8)

| Élément | Fichier | Tests |
| --- | --- | --- |
| Code d'accès permanent du monde (16 caractères, 80 bits) | `src/shared/worldcode.ts` | Auto |
| Protocole réseau validé côté serveur | `src/shared/protocol.ts` | Auto |
| Limitation des tentatives de connexion | `src/shared/ratelimit.ts` | Auto |
| Sauvegardes : dernière + 3 de sécurité, empreinte SHA-256, restauration | `src/server/save.ts` | Auto |
| Apparition loin des joueurs déjà présents | `src/shared/spawn.ts` | Auto |
| Prédiction client et réconciliation | `src/client/net/prediction.ts` | **Non testé** (à adapter aux nouveaux états) |

## En cours

La validation de la phase 2 sur vos appareils.

## Restant

| Phase | Contenu |
| --- | --- |
| 2 (suivi) | Animation des mains en escalade, prises plus fines ; ruisseaux et chutes d'eau (avec la phase 9) |
| 3 | Santé, énergie, fatigue de fond, blessures localisées (les chutes et la noyade sont déjà calculées), sac à dos physique, inventaire |
| 4 | Récolte, outils, matériaux, recettes, fabrication physique, qualité et usure, matériel de plongée |
| 5 | Construction physique, structures, destruction, installations |
| 6 | Intelligence artificielle, écosystème, créatures, détection, combats, horreur sous-marine |
| 7 | Véhicules et machines |
| 8 | Serveur chez l'hôte (navigateur et programme compagnon), code privé, connexion WebRTC, synchronisation, permissions, sauvegardes du monde et des joueurs, 10 joueurs |
| 9 | Monde complet : grottes, bâtiments abandonnés, histoire, documents, événements, catastrophes, météo, cycle jour/nuit, carte révélée progressivement |
| 10 | Optimisation, tests sur appareils, installation, documentation, programme compagnon |
| Plus tard | Graphismes soignés (textures, ombres, ciel, effets), son et musique adaptative, interface intégrée à l'univers, menus pilotables à la manette |

## Limites connues

- Les objets déplacés ne sont pas encore sauvegardés (phase 8) ; votre position est gardée sur ce navigateur.
- Les indications à l'écran (nom du biome, action possible, barres d'endurance et de souffle) sont temporaires.
- Les menus se pilotent au clavier, à la souris ou au doigt, pas encore à la manette (sauf Start pour la pause).
- La résolution adaptative peut baisser inutilement sur un écran limité à 30 images par seconde : désactivable dans les réglages.
