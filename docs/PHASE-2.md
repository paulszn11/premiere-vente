# Phase 2 — Monde et déplacements

**Statut : terminée côté code et tests automatiques. Il reste à la valider sur vos appareils.**

## Décisions prises avec vous

| Sujet | Décision |
| --- | --- |
| Univers | Monde inspiré du Zimbabwe, avec des biomes à la géographie logique |
| Taille | 16 km × 16 km (256 km²), fermé par des montagnes frontalières |
| Principe du jeu | Chaque joueur apparaît à un endroit au hasard, loin des autres (au moins 4 km quand c'est possible). Aucune carte ne montre les autres joueurs : se retrouver doit être très difficile |
| Joueurs | **10 au maximum** (le cahier des charges initial disait 6) |
| Multijoueur (phase 8) | L'hôte lance le jeu et ouvre son monde, ce qui démarre le serveur. Les autres entrent le code privé et rejoignent la partie. Quand l'hôte quitte, le monde s'arrête. À sa prochaine connexion, tout le monde retrouve le monde grâce aux sauvegardes |

## La carte

```
                         NORD
   ┌─────────── montagnes frontalières ───────────┐
   │  Vallée du Zambèze : terre rouge, mopanes,    │ Hautes
   │  baobabs ; le fleuve d'ouest en est, le lac   │ terres
   │ ─────────── escarpement (falaises) ────────── │ de l'Est :
 O │ Sables du   Haut plateau : prairies dorées,   │ montagnes,  E
   │ Kalahari :  forêts de miombo, zones humides   │ forêt de
   │ tecks,      (boue), kopjes isolés             │ montagne
   │ cuvettes    ┌ Collines de granit ┐            │
   │             │ kopjes, rochers en │            │
   │             └ équilibre ─────────┘            │
   │  Lowveld : savane sèche, acacias, baobabs     │
   │  ~~~~~~~~~~~~~ le Limpopo ~~~~~~~~~~~~~~~~~~  │
   └─────────── montagnes frontalières ───────────┘
                          SUD
```

Les limites entre régions sont déformées par du bruit pour paraître naturelles. Tout est calculé à partir de la graine du monde, de façon identique sur tous les appareils.

## Ce qui a été fait

| Domaine | Contenu |
| --- | --- |
| Relief et biomes | 11 biomes : plateau, miombo, zone humide, vallée, bords du fleuve, escarpement, collines de granit, hautes terres, lowveld, Kalahari, frontière. Kopjes (dômes de granit aux flancs raides), fleuves et lac creusés sous l'eau, rares sommets enneigés à l'est |
| Sols | Herbe, terre sèche, sable, boue, roche, granite, neige, eau. Chacun change la vitesse, l'adhérence, la pente praticable et l'amorti des chutes (la boue ralentit de 45 %) |
| Flore et décor | 8 espèces : miombo, mopane, baobab, acacia, teck, arbre de montagne, palmier ilala, figuier. Avec elles, des buissons verts ou secs, des rochers (certains en équilibre) et des termitières. Les troncs, rochers et termitières sont solides |
| Accroupi | Plus bas et plus lent ; impossible de se relever sous un plafond |
| Endurance | La course, le saut, la nage et l'escalade la consomment. Épuisé, on ne peut plus courir tant qu'elle n'est pas remontée |
| Équilibre | Un demi-tour brusque en pleine course, une descente raide en courant ou un sol glissant peuvent faire trébucher |
| Chutes | La gravité dépend de la vitesse d'impact (donc de la hauteur), du sol et de la posture (s'accroupir à l'atterrissage amortit), sur 4 niveaux : trébucher, légère, grave, mortelle. Les blessures elles-mêmes arrivent en phase 3 |
| Nage et plongée | On flotte la tête hors de l'eau. On nage, plus vite en forçant. On plonge en regardant vers le bas ou avec « S'accroupir ». Le souffle dure 30 s. Le Zambèze et le Limpopo ont du courant. L'eau s'assombrit et se trouble avec la profondeur |
| Escalade | Toute paroi trop raide pour marcher (plus de 44°) s'escalade : saut face à la paroi, déplacement dans les 4 directions, endurance, passage du rebord en haut. On lâche avec « S'accroupir » ou on saute en arrière ; on tombe si l'endurance est épuisée |
| Objets | Pierres, bûches et troncs. Les objets légers se portent à une main, ceux de plus de 8 kg à deux mains (lent, sans course ni saut), ceux de plus de 60 kg ne peuvent que se traîner. On peut poser, lancer (plus loin si l'objet est léger), pousser un gros tronc en marchant et enjamber les petits objets. Un objet déplacé reste là où on l'a laissé |
| Apparition | Au hasard dans le monde. La position est reprise à la partie suivante, sur ce navigateur |
| Caméra | Balancement de la marche, plongeon à l'atterrissage, hauteur des yeux accroupi, secousse en trébuchant, champ de vision un peu plus large en courant, flottement en nageant |
| Performance | Le terrain et la flore sont calculés dans un fil séparé. Les hauteurs physiques sont réutilisées par la simulation, ce qui évite les saccades au changement de chunk |
| Commandes | Nouvelles actions « Lancer » (clic gauche, RT) et boutons tactiles Accroupir, Prendre, Lancer |
| Outils de test | Réglages → « Outils de test » : téléportation vers chaque région, le lac (nage) et une paroi de granit (escalade) |

## Tests automatiques

| Suite | Résultat |
| --- | --- |
| `npm test` (Vitest) : géographie (régions au bon endroit, fleuves en eau, frontière), sols, accroupi, endurance, équilibre, chutes, nage, plongée, courant, sortie de l'eau, escalade, objets (prendre, porter, lancer, traîner, pousser, mémoriser), apparitions éloignées | **67 / 67** |
| `npm run test:e2e -- --webgpu` (Chromium) : tout le scénario de la phase 1, plus téléportation dans 7 régions, nage, plongée, escalade d'un vrai kopje, accroupi, barres d'endurance et de souffle, prendre, poser, reprendre et lancer une pierre | **57 / 57** |

Problèmes trouvés par les tests et corrigés :
- **On restait bloqué au pied d'un kopje sans pouvoir grimper.** Entre la pente maximale de marche (42°) et le seuil d'escalade (55°), il y avait un trou. Désormais, tout ce qui ne se marche pas s'escalade.
- **En escalade, on s'enfonçait dans les parois inclinées.** Le maintien contre la paroi se fait maintenant perpendiculairement à celle-ci.
- **Les pierres roulaient sans fin sur les pentes douces**, car le moteur physique ne simule pas la résistance au roulement. Elles ont maintenant une forme de caillou aux coins arrondis.
- **Viser une petite pierre était trop exigeant.** La visée tolère maintenant une petite marge, tout en vérifiant qu'aucun mur ne cache l'objet.

## Limites et compromis (signalés)

- **Escalade :** pas encore d'animation des mains. Les « prises » sont simplifiées : toute roche assez raide est escaladable avec de l'endurance.
- **Eau :** le niveau de l'eau est le même partout. Il n'y a donc pas encore de ruisseaux sur le plateau ni de chutes d'eau (prévus avec le monde complet, phase 9). Le matériel de plongée viendra avec la fabrication.
- **Neige :** très rare, seulement sur les plus hauts sommets de l'est, comme au Zimbabwe.
- **Sauvegarde :** les objets déplacés sont mémorisés pendant la partie, mais pas encore sauvegardés (phase 8). Seule votre position est gardée, sur ce navigateur.
- **Interface temporaire :** le nom du biome en entrant, l'indication d'action près du viseur et les barres d'endurance et de souffle seront remplacés par une interface intégrée à l'univers.
- **Outils de test :** ils seront retirés ou réservés à l'hôte en multijoueur.
- **Performance :** la flore plus variée ajoute des appels de dessin. À mesurer sur vos appareils avec le test de performance.

## À vérifier sur vos appareils

1. **Test de performance :** relancez-le sur l'iPhone et envoyez-moi le rapport.
2. **Une partie :** apparition, déplacements, accroupi, course jusqu'à l'épuisement.
3. **Réglages → Outils de test :**
   - le **lac**, pour la nage et la plongée ;
   - la **paroi de granit**, pour l'escalade ;
   - les **collines de granit**, pour prendre, poser et lancer des pierres ;
   - chaque **région**, pour comparer les paysages.
