# Phase 7 — Véhicules et simulation avancée

**Statut : terminée le 13/11/2026 (version 0.7.0).** 222 tests unitaires, dont 20 propres à la phase 7 ; 206 vérifications navigateur, dont 16 propres à la phase 7 (ordinateur, téléphone, manette), toutes réussies. Reste à l'essayer sur vos appareils.

## Ce que demande le cahier des charges

- **Phase 7 (section 16) :** mécanique, transport terrestre, transport aquatique, machines personnalisées.
- **Section 11 :** construction libre de véhicules terrestres, aquatiques et de machines personnalisées. La simulation mécanique prend en compte les pièces, les moteurs, le poids, l'équilibre, le carburant, l'usure, les pannes, les réparations et le fonctionnement des composants.
- **10.3 (reporté de la phase 5) :** machines, systèmes techniques, automatisation (et électricité, voir plus bas).

## Décisions (en m'inspirant de jeux du même style, sans en copier un)

> **Section 15 du cahier.** Les types de véhicules et de composants font partie des éléments encore à spécifier. Ce qui suit est une **proposition signalée et modifiable**.

### Principe : un châssis, puis des pièces

| Décision | Inspirée de | Pourquoi |
| --- | --- | --- |
| On trace un **châssis** (plan de la phase 5) qu'on assemble en chantier, puis on y **installe des pièces** fabriquées au plan de travail ou à la forge : roues, essieux, machine à vapeur, roue à aubes, gouvernail | Scrap Mechanic, Stormworks, Raft | Construction libre, avec la même logique que les bâtiments |
| Le comportement **découle des pièces** : masse totale, centre de gravité (la machine et le conducteur le remontent), nombre et état des roues, puissance du moteur, flottaison de la coque | Stormworks, My Summer Car | Poids, équilibre, fonctionnement des composants (section 11) |
| Chaque pièce **s'use** selon l'usage (distance, charge, chocs, heures de marche) ; plus elle est usée, plus elle risque de **casser**. On la répare ou on la remplace | My Summer Car, The Long Drive | Usure, pannes, réparations |
| **Carburant :** du bois dans le foyer de la machine à vapeur, de l'eau dans la chaudière. Sans eau et à feu vif, la chaudière se fend | — | Le fer et le feu existent déjà ; l'essence viendra des bâtiments abandonnés (phase 9) |
| Vraie physique : suspensions et adhérence des roues (moteur physique Rapier), flottaison calculée point par point pour les bateaux, courant des fleuves | — | Réalisme, équilibre, renversement |

### Véhicules

| Véhicule | Type | Châssis (plan) | Pièces | Propulsion |
| --- | --- | --- | --- | --- |
| Chariot à bras | terrestre | 2 bûches, 2 perches, 2 cordes ; couteau | 4 petites roues | le joueur pousse (endurance) ; ridelles : bûches et pierres posées dessus voyagent avec lui |
| Chariot | terrestre | 6 bûches, 16 clous, 1 barre de fer, 4 boulons ; hache, galet | 2 essieux, 4 roues cerclées de fer, machine à vapeur (siège) | la machine (jusqu'à 18 km/h) ; sans machine, il se pousse lentement |
| Radeau | aquatique | 6 bûches, 2 perches, 4 cordes ; assemblé dans l'eau peu profonde | gouvernail ; machine à vapeur et roue à aubes | pagaie, ou machine et roue à aubes |
| Pirogue (*mukoro*) | aquatique | 4 bûches (le tronc), bâtons et herbes (évider au feu), hache, archet, couteau | — | pagaie : rapide et légère, mais étroite |

Le *mukoro*, pirogue creusée dans un tronc, est encore utilisé sur le Zambèze et dans le delta de l'Okavango. Simplification signalée : les 4 bûches représentent le tronc (il n'y a pas encore de tronc entier qu'on puisse déplacer jusqu'à l'eau).

Les pièces se fabriquent : petite roue et gouvernail au plan de travail (connus d'emblée) ; roue cerclée de fer, essieu, machine à vapeur et roue à aubes à la forge (pressentis en fabriquant des barres de fer ou des boulons). Le chariot est pressenti en fabriquant une roue ou un essieu, la pirogue en tenant une hache.

### Machines et automatisation

| Machine | Rôle | Puissance |
| --- | --- | --- |
| Roue à eau | Source d'énergie gratuite, sur la rive d'un fleuve qui coule (Zambèze, Limpopo) | environ 340 W dans le Zambèze, 100 W dans le Limpopo (formule simplifiée, signalée) |
| Machine à vapeur fixe | Source : la même machine que celle des véhicules, boulonnée sur un socle de pierres ; bois, eau, feu | 4 kW à pleine pression |
| Meule | Rend aux lames (couteaux, haches, lance) **tout** leur tranchant **sans réduire leur durabilité maximale** (l'affûtage à la main la réduit) | demande 150 W |
| Soufflet mécanique | À moins de 3 m d'un bas fourneau allumé, il souffle tout seul : la fonte du fer avance sans le joueur | demande 300 W |
| Pompe | Près de l'eau : remplit la chaudière des véhicules et des machines à moins de 6 m ; on y remplit aussi un pot | demande 250 W |

Les machines à moins de 6 m l'une de l'autre forment un **réseau** (arbre de transmission, de proche en proche) : la puissance des sources est partagée entre les machines entraînées. Une machine tourne si elle reçoit au moins la moitié de sa puissance.

### Reporté (avec raison)

| Élément | Phase | Raison |
| --- | --- | --- |
| Électricité (dynamo, fils, lampes) | 9 | Fils de cuivre, ampoules et batteries seront à récupérer dans les bâtiments abandonnés ; la transmission mécanique couvre l'automatisation en attendant |
| Voiles | 9 | Il faut du vent : il arrive avec la météo |
| Moteurs à essence, véhicules abandonnés | 9 | Carburant et moteurs à trouver dans les bâtiments abandonnés |
| Traction animale (charrette à bœufs) | — | Pas de domestication des animaux pour l'instant (à décider) |

## Ce qui est fait

### Construire et équiper

- Les plans des quatre châssis et des cinq machines sont dans l'onglet « Construire » ; le fantôme a la forme du véhicule. Un châssis à roues se pose sur un sol assez plat (toute son emprise compte) ; un bateau, dans l'eau peu profonde (25 cm à 1,1 m de fond, la coque entièrement dans l'eau) ; une pompe à moins de 4 m de l'eau ; une roue à eau à moins de 3 m d'un courant d'au moins 0,25 m/s.
- Un châssis à roues terminé reste **calé** (immobile, sur des cales visibles) tant qu'il lui manque des roues ou des essieux. À la dernière roue, on ôte les cales : le châssis est posé droit sur ses roues.
- **Prendre** sur un véhicule ouvre son **panneau** : état, pièces (usure, cassées), chaudière, et les actions. On installe une pièce tenue en main, rangée dans le sac ou posée à côté ; certaines demandent un outil (galet) et des fixations (boulons pour la machine, corde pour le gouvernail). Les roues d'un chariot demandent d'abord leur essieu. Une pièce retirée garde son usure (elle devient la durabilité de l'objet).

### Conduire

- **Pousser** (chariot à bras, chariot sans machine) : le joueur prend les brancards et marche derrière ; avancer pousse, reculer tire, sauter freine. L'effort compte : au-delà d'environ 120 W, l'endurance baisse ; épuisé, on pousse à moitié.
- **Monter** : sur le siège du chariot à vapeur (la machine doit avoir de la pression), à bord d'un bateau (même depuis l'eau, en nageant). Avancer/reculer et gauche/droite deviennent accélérer et tourner, sauter freine ; **la vue tourne avec le véhicule** (on peut toujours regarder autour). Prendre pour descendre : à côté du siège, sur la terre ferme si possible.
- Un **tableau de bord** donne la vitesse, l'état, la chaudière (pression, eau, minutes de feu) ou l'effort du pagayeur. La touche du sac ouvre le panneau du véhicule pendant qu'on conduit (charger le foyer, verser de l'eau).
- Mêmes gestes au clavier, au doigt (joystick, « Sauter », « Prendre ») et à la manette (stick gauche, A, X).

### Mécanique

- **Masse et centre de gravité** calculés à partir du châssis, des pièces et du conducteur ; ils changent dès qu'on ajoute ou retire une pièce.
- **Roues** : suspensions (raideur adaptée à la masse), adhérence, braquage des roues avant, freins, résistance au roulement ; une roue cassée penche et frotte, un essieu cassé bloque ses roues ; quand personne ne conduit, les roues sont calées.
- **Machine à vapeur** : le bois brûle (plus vite à pleine charge), le feu chauffe, la pression suit la chaleur s'il y a de l'eau, l'eau s'évapore selon la puissance demandée. Plus de bois : le feu s'éteint. Chaudière presque vide à feu vif : elle se fend (panne « surchauffe »). Puissance constante (4 kW) : la force diminue avec la vitesse.
- **Bateaux** : poussée d'Archimède en 9 ou 10 points de la coque, traînées longitudinale et latérale de l'eau, courant du fleuve, pagaie ou roue à aubes, gouvernail qui aide à tourner quand on avance.
- **Équilibre** : sur un dévers trop fort ou dans un virage trop serré, un véhicule au centre de gravité haut se renverse (voir les limites). On redresse un véhicule de moins de 450 kg.
- **Usure et pannes** : roues et essieux s'usent avec la distance et la charge, la machine et la roue à aubes avec les heures de marche ; les chocs usent les roues. Le risque de panne grandit au-delà de la moitié de l'usure ; les tirages viennent du générateur de la simulation (déterministe, pour la phase 8).
- **Chocs** : une collision violente (force de contact) abîme le véhicule et use ses roues ; à 0 point de vie, il est détruit et ses pièces tombent au sol. Une créature percutée à plus de 2,5 m/s est blessée selon l'énergie du choc (un chariot lancé tue une hyène) et freine le véhicule.
- **Réparations** : chaque pièce a ses matériaux et son outil (petite roue : bâton et corde ; roue : bûche et clous ; machine : barres de fer, boulons, argile…) ; le châssis ou la coque se réparent avec une bûche et des clous.

### Machines

- Les machines sont des installations : on les ouvre avec Prendre (puissance, état, foyer de la machine fixe).
- Toutes les 0,5 s : chaudières des machines fixes, puissance des roues à eau (selon le courant sur place), partage de la puissance dans chaque réseau, effets (soufflet, pompe). La meule ajoute « Affûter à la meule » aux lames qu'on a sur soi quand elle tourne à portée de main.

### Affichage

- Véhicules faits de formes simples : plateau à ridelles, brancards, siège, roues à rayons (cerclées de fer pour le chariot) qui tournent, braquent et suivent leur suspension ; machine à vapeur avec cheminée et **fumée** ; roue à aubes qui brasse l'eau ; gouvernail ; rondins du radeau ; coque de la pirogue. Les véhicules sont interpolés entre deux pas de simulation, comme le joueur.

### Sauvegarde

- Véhicules (position, orientation, pièces avec usure et qualité, chaudière, points de vie, distance parcourue) et machines (chaudière, usure) sont sauvegardés ; les anciennes sauvegardes se relisent sans véhicules. Aux commandes, la partie reprend à côté du véhicule.

### Outils de test (réglages, pendant une partie)

- Faire apparaître un véhicule prêt à rouler ou à naviguer : chariot à bras, chariot à vapeur (en pression), chariot sans machine, radeau, radeau à vapeur, pirogue.
- Recevoir des pièces, du fer, des outils et un pot d'eau ; tous les plans de véhicules et de machines deviennent connus.

## Difficultés techniques et solutions

| Difficulté | Solution |
| --- | --- |
| Véhicules à roues réalistes sans tout écrire | Contrôleur de véhicule de Rapier (rayons de suspension, adhérence, force moteur, freins, direction) ; raideur des suspensions calculée pour que chaque roue s'enfonce de 45 % de sa course à vide |
| Le contrôleur de Rapier bloquait un véhicule posé directement sur ses roues (corps figé dès sa création) | Le contrôleur n'agit qu'après un premier pas du monde physique |
| Le modèle de roues à rayons ne fait jamais basculer un véhicule (essayé jusqu'à 55° de dévers) | On ajoute le couple de renversement manquant quand la force latérale apparente (pente, virage) dépasse ce que la voie et la hauteur du centre de gravité peuvent retenir |
| Le chargement glissait hors du plateau | Ridelles physiques ; et la détection continue des collisions (CCD) du châssis, qui freinait son déplacement quand des objets reposaient dessus, est désactivée (inutile à ces vitesses) |
| Bateaux qui flottent, penchent, dérivent | Poussée d'Archimède point par point, traînée par rapport à l'eau (courant compris), amortissement de la rotation |
| Le joueur dans un véhicule | Sa capsule ne heurte plus rien ; il suit son siège ou les brancards ; la commande, lue dans le repère de la vue, devient accélérer et tourner ; l'effort humain se convertit en endurance |
| Véhicules loin du joueur | Corps physique seulement dans la zone simulée, sinon position mémorisée |
| Toucher qui ouvre un panneau | Le même toucher déclenchait le bouton apparu sous le doigt (« Retirer la petite roue ») : les boutons ignorent les clics pendant 0,45 s après l'ouverture |
| Déterminisme (phase 8) | Pannes tirées par le générateur de la simulation ; tout l'état tient dans des données sauvegardées |

## Tests

### Unitaires (`tests/unit/phase7-vehicles.test.ts`, 20 tests)

- Catalogue cohérent (emplacements, pièces, objets, recettes) ; masse et centre de gravité.
- Chaudière : bois, chaleur, pression, évaporation selon la charge, feu qui s'éteint, surchauffe qui casse la machine.
- Usure selon la distance et la charge, pannes d'une pièce très usée, réparation.
- Physique : chariot à bras poussé (vitesse plafonnée, il tourne, il s'arrête lâché) ; chariot à vapeur (5 m/s, freinage, rien sans pression) ; chariot incomplet calé ; radeau et pirogue qui flottent (la pirogue plus rapide), virage du radeau ; renversement sur un dévers de 55°, pas à 10°.
- Simulation : chariot à bras du plan aux roues, poussé puis lâché ; chargement (3 bûches, 1 pierre) qui reste sur le plateau même en virage ; chariot à vapeur (bois, eau, feu, pression, conduite, sauvegarde et reprise, ancienne sauvegarde) ; radeau assemblé dans l'eau peu profonde, pagaie (endurance), pot rempli depuis le bateau, descente dans l'eau ; chocs (mur, hyène percutée) ; actions validées.
- Machines : partage de la puissance dans un réseau ; machine fixe et meule (affûtage sans perte) ; roue à eau seulement près d'un courant ; pompe qui remplit une chaudière et un pot ; soufflet mécanique qui produit une loupe de fer sans le joueur.

### Navigateur (16 vérifications)

- Ordinateur : plans dans l'onglet Construire ; fantôme et chantier du chariot à bras (F) ; panneau (E), quatre roues installées ; pousser (W), tableau de bord ; lâcher (E) ; chariot à vapeur (siège, W, D : la vue suit, Espace freine) ; descendre à côté ; radeau sur le lac (monter depuis l'eau, pagayer, endurance) ; sauvegarde ; outil de test ; aucune erreur.
- Téléphone : Prendre ouvre le panneau sans déclencher le bouton sous le doigt, « Pousser », joystick, Prendre pour lâcher.
- Manette : X ouvre le chariot à vapeur, A monte sur le siège (première action du panneau), le stick gauche avance, X pour descendre.

Captures : `docs/captures/vehicule-chariot-vapeur.png` (vu de l'extérieur, la machine fume), `docs/captures/vehicule-radeau.png` (à la pagaie sur le lac).

## Limites et compromis (à connaître)

- **Renversement** : le couple de renversement est ajouté par le jeu (le modèle de roues de Rapier n'en produit pas) ; le seuil réel est un peu plus haut que le calcul statique, car la suspension retient (le chariot à vapeur passe à 42° de dévers, bascule vers 48°).
- **Chargement** : on charge le plateau en y posant les objets (physique réelle). Il n'y a pas encore de coffre de véhicule pour les petits objets.
- **Roue à eau** : puissance selon une formule simplifiée (proportionnelle au carré du courant), pas un calcul hydraulique.
- **Créatures** : un véhicule les blesse, mais elles ne l'abîment pas encore (l'éléphant renverse les murs, pas les chariots), et elles traversent un véhicule garé (elles ne le contournent pas).
- **Bateaux** : pas de vagues ni de vent ; on ne peut pas encore marcher sur un radeau en mouvement (on y est assis).
- **Pirogue** : les bûches représentent le tronc.
- **Sons** : les véhicules et les machines ne font pas encore de bruit.
- **Téléphone** : peu de véhicules à la fois (formes simples, quelques maillages chacun) ; à vérifier sur vos appareils.

## Inspirations (pas de sources consultées pour cette phase)

Les jeux cités plus haut (Scrap Mechanic, Stormworks, Raft, My Summer Car, The Long Drive) sont des inspirations générales de conception, de mémoire ; aucun site n'a été consulté pendant cette phase. Les puissances et les chiffres sont des ordres de grandeur choisis pour le jeu et restent modifiables.
