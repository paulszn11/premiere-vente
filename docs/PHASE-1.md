# Phase 1 — Architecture et prototype

**Statut : validée par le propriétaire du projet le 12/11/2026.** Les rapports du test de performance sur appareils réels n'ont pas encore été reçus ; ils restent utiles pour ajuster les qualités par défaut (procédure plus bas).

## Objectif

Selon le cahier des charges : choix définitif du moteur et des technologies, mise en place du projet, première scène 3D, contrôles à la première personne, test de performances sur différents appareils.

Décisions prises avec vous avant de commencer :
- code dans le dépôt `premiere-vente` ;
- **pas de multijoueur** en phase 1 (il arrive en phase 8, avec WebRTC et des services gratuits) ;
- nom du jeu : **Bienvenue au Zimbabwe** ;
- **graphismes simples** pour l'instant.

## Étapes réalisées

1. Mise en place du projet : TypeScript strict, Vite 8, Babylon.js 9.33, Rapier 0.21, versions épinglées.
2. Code partagé, sans affichage : génération déterministe du relief et des arbres, monde physique, déplacement du joueur.
3. Simulation à pas fixe séparée de l'affichage (elle deviendra le serveur de la phase 8).
4. Rendu : terrain par chunks avec niveaux de détail, arbres en instances, eau, brouillard, qualité adaptative.
5. Commandes : clavier, souris, tactile, manette, toutes remappables.
6. Outils de mesure : infos en jeu (F3) et test de performance automatique avec rapport copiable.
7. Installation en application (PWA) et publication sur Vercel.

## Tests automatiques

| Suite | Contenu | Résultat |
| --- | --- | --- |
| `npm test` (Vitest, dans Node) | Bruit et relief déterministes, sol physique = relief, point d'apparition, marche, course, inertie, saut, pentes, troncs, déterminisme au bit près, maillage, réglages, commandes, mesures, modules de la phase 8 | **35 / 35** |
| `npm run test:e2e -- --webgpu` (Playwright, Chromium sans carte graphique) | Démarrage, rendu, souris, clavier (marche, course, saut), F3, pause, réglages, remappage, persistance, tactile (joystick, regard, boutons), manette (sticks, A, Start), test de performance complet, WebGPU | **34 / 34** |

Problèmes trouvés et corrigés grâce aux tests :
- le personnage accrochait les arêtes du terrain et perdait sa vitesse : la poussée vers le sol a été supprimée, l'accroche au sol de Rapier suffit ;
- la vitesse s'effondrait en montée : elle n'est plus réduite que par un vrai obstacle ;
- au verrouillage du pointeur, un mouvement de souris aberrant faisait pivoter la caméra : ces mouvements sont désormais filtrés ;
- un ordinateur portable à écran tactile aurait été pris pour un téléphone : la détection se base maintenant sur le pointeur principal.

## Test sur vos appareils (à faire)

Les tests automatiques tournent sans carte graphique : ils prouvent que le jeu fonctionne, pas qu'il est fluide. La phase 1 n'est validée qu'après les tests suivants.

**Sur chaque appareil (téléphone, tablette, ordinateur) :**
1. Ouvrez le site et touchez « Test de performance ». Laissez faire environ une minute sans toucher à rien.
2. Touchez « Copier les résultats » et envoyez-moi le texte.
3. Lancez une partie, déplacez-vous une minute et dites-moi si c'est fluide, si les commandes répondent bien, et si quelque chose est gênant.
4. Essayez d'installer l'application (Chrome : « Installer l'application » ; iPhone : Partager → « Sur l'écran d'accueil »).

**Critères proposés (à discuter) :**

| Appareil | Qualité | Objectif |
| --- | --- | --- |
| Téléphone récent | Basse | 30 images/s au moins, « 1 % bas » au-dessus de 20 |
| Téléphone récent | Moyenne | 30 images/s au moins |
| Ordinateur | Haute | 60 images/s au moins |

Avec vos résultats, j'ajusterai la qualité choisie automatiquement pour chaque type d'appareil, puis on passera à la phase 2.

## Référence : rapport obtenu ici (rendu logiciel, non représentatif)

```
Qualité  IPS moy.  1 % bas  ms méd./95 %   Résolution  Chunks  Arbres  Appels
Basse    37.1      21.6     25.8 / 33.9    800×450     21      99      12
Moyenne  26.9      20.0     36.6 / 46.3    800×450     37      384     18
Haute    19.6      14.4     50.5 / 61.4    800×450     97      388     38
Ultra    16.5      12.9     59.2 / 73.1    800×450     177     680     63
```
