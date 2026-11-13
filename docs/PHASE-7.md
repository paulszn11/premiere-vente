# Phase 7 — Véhicules et simulation avancée

**Statut : en cours (décisions prises, développement commencé le 13/11/2026).**

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
| Le comportement **découle des pièces** : masse totale, centre de gravité (le chargement le remonte), nombre et état des roues, puissance du moteur, flottaison de la coque | Stormworks, My Summer Car | Poids, équilibre, fonctionnement des composants (section 11) |
| Chaque pièce **s'use** selon l'usage (distance, charge, chocs, heures de marche) ; plus elle est usée, plus elle risque de **casser**. On la répare ou on la remplace | My Summer Car, The Long Drive | Usure, pannes, réparations |
| **Carburant :** du bois dans le foyer de la machine à vapeur, de l'eau dans la chaudière. Sans eau et à feu vif, la chaudière se fend | — | Le fer et le feu existent déjà ; l'essence viendra des bâtiments abandonnés (phase 9) |
| Vraie physique : suspensions et adhérence des roues (moteur physique Rapier), flottaison calculée point par point pour les bateaux, courant des fleuves | — | Réalisme, équilibre, renversement, chavirage |

### Véhicules proposés

| Véhicule | Type | Fabrication | Propulsion | Ce qu'il apporte |
| --- | --- | --- | --- | --- |
| Chariot à bras | terrestre | perches, bâtons, cordes ; 4 petites roues | le joueur pousse (endurance) | transporter bûches et pierres d'un coup |
| Chariot (à vapeur) | terrestre | bûches, clous, boulons ; 4 roues, 2 essieux, direction ; une machine à vapeur | moteur | aller loin et vite, gros chargements |
| Radeau | aquatique | 6 bûches et des cordes, construit dans l'eau peu profonde | pagaie, ou machine à vapeur et roue à aubes | traverser fleuves et lac, chargement |
| Pirogue (*mukoro*) | aquatique | creusée dans un tronc (hache, feu, couteau) | pagaie | rapide et légère, mais instable si l'on charge haut |

Le *mukoro*, pirogue creusée dans un tronc, est encore utilisé sur le Zambèze et dans le delta de l'Okavango.

### Machines personnalisées et automatisation

| Machine | Rôle |
| --- | --- |
| Roue à eau | Source d'énergie gratuite, posée sur une rive où le courant est assez fort |
| Machine à vapeur fixe | Source d'énergie : même machine que celle des véhicules, posée sur un socle |
| Meule | Affûte les outils : rend leur tranchant **sans réduire leur durabilité maximale** (contrairement à l'affûtage à la main) |
| Soufflet mécanique | Près d'un bas fourneau allumé, le maintient chaud **tout seul** : la fonte du fer s'automatise |
| Pompe | Près de l'eau, remplit les pots posés dans son bac et la chaudière des véhicules garés à côté |

Une machine fonctionne si une source d'énergie assez puissante est à moins de 6 m (arbre de transmission). Si la demande dépasse la puissance, tout tourne plus lentement.

### Reporté (avec raison)

| Élément | Phase | Raison |
| --- | --- | --- |
| Électricité (dynamo, fils, lampes) | 9 | Fils de cuivre, ampoules et batteries seront à récupérer dans les bâtiments abandonnés ; la transmission mécanique couvre l'automatisation en attendant |
| Voiles | 9 | Il faut du vent : il arrive avec la météo |
| Moteurs à essence, véhicules abandonnés | 9 | Carburant et moteurs à trouver dans les bâtiments abandonnés |
| Traction animale (charrette à bœufs) | — | Pas de domestication des animaux pour l'instant (à décider) |

## Difficultés techniques identifiées avant de commencer

| Difficulté | Solution prévue |
| --- | --- |
| Véhicules à roues réalistes sans tout écrire | Contrôleur de véhicule de Rapier (rayons de suspension, adhérence, force moteur, freins, direction) ; centre de gravité calculé à partir des pièces et du chargement |
| Bateaux qui flottent, penchent et chavirent | Poussée d'Archimède calculée en plusieurs points de la coque, traînée de l'eau, courant du fleuve |
| Le joueur assis dans un véhicule | Il suit son siège et ne heurte plus le véhicule ; la vue tourne avec le véhicule ; les commandes deviennent accélérer, freiner, tourner |
| Véhicules loin du joueur | Comme les objets : physique seulement près du joueur, sinon position mémorisée (pas de chute à travers un sol non chargé) |
| Chocs | Événements de force de contact : dégâts au véhicule, aux constructions percutées ; un animal percuté est blessé selon la vitesse |
| Déterminisme (phase 8) | Usure et pannes tirées par le générateur de la simulation ; tout l'état d'un véhicule tient dans des données sauvegardées |
| Téléphone | Peu de véhicules physiques à la fois, formes simples, commandes tactiles réutilisées (joystick : accélérer et tourner) |
