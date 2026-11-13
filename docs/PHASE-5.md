# Phase 5 — Construction

**Statut : en cours (commencée le 13/11/2026).**

## Ce que demande le cahier des charges

- **10.1 Liberté.** Construire librement sur terre, dans les grottes, sur l'eau et dans les zones difficiles d'accès.
- **10.2 Assemblage.** Les constructions sont assemblées physiquement :
  - pièces emboîtables, boulons, cordes, soudures, fixations adaptées aux matériaux ;
  - supports, équilibre, résistance.
- **10.3 Installations.** Coffres, ateliers, éclairage, électricité, eau, machines, systèmes techniques, automatisation.
- **10.4 Destruction.** Les bases peuvent être attaquées à tout moment. La destruction dépend des matériaux, des armes, des créatures, des forces physiques et de la structure.
- **Autres exigences liées :**
  - 6.4 : les actions des joueurs modifient durablement le monde ;
  - 6.3 : incendies ;
  - 14.5 : physique détaillée seulement près des joueurs.

## Décisions (comme pour les phases 3 et 4, en m'inspirant de jeux du même style)

> **Section 15 du cahier.** La liste des matériaux et leurs propriétés (résistance, poids, combustion), ainsi que les améliorations des constructions, font partie des éléments encore à spécifier. Ce qui suit est une proposition signalée et modifiable.

### Principe : un plan, puis un vrai chantier

| Décision | Inspirée de | Pourquoi |
| --- | --- | --- |
| On trace un **plan** (fantôme translucide) qui s'aligne sur une grille de 2 m quand il touche une construction existante, sinon il se pose librement | Valheim, Rust (accroche des pièces), The Forest (plans fantômes) | Simple au doigt comme à la souris ; les pièces s'emboîtent |
| Le plan devient un **chantier** : il faut apporter les matériaux et faire chaque étape, avec son outil (planter les montants, tresser les baguettes, ligaturer, enduire…) | The Forest et Green Hell (on remplit le plan), Primitive Technology (étapes) | « Physiquement assemblées » (10.2) ; même système d'étapes que la fabrication (phase 4) |
| Les matériaux comptent s'ils sont **sur soi ou posés à côté du chantier**. Les bûches et les grosses pierres, trop lourdes pour le sac, se portent une à une | Sons of the Forest (porter les rondins) | Logistique physique, fidèle à l'esprit du jeu |
| Un chantier n'a pas de collision ; la pièce devient solide une fois terminée | The Forest | Lisible, et évite de se coincer |

### Pièces et matériaux du pays

| Pièce | Matériaux | Inspirée de |
| --- | --- | --- |
| Plancher en rondins (2 × 2 m), sur le sol ou sur **pilotis** (sur une pente ou dans l'eau jusqu'à 3,5 m de profondeur) | bûches + cordes (ou boulons) ; perches pour les pilotis | Greniers sur pilotis, Raft (construire sur l'eau) |
| Dallage en pierre (sol plat seulement) | pierres | — |
| Poteau | perche | Valheim (poteaux qui portent) |
| Mur de clayonnage, puis **torchis** (dagga) | perches + bâtons, puis argile | Huttes « pole and dagga » du Zimbabwe |
| Mur en **pierre sèche**, sans mortier | pierres (au poids) | Le Grand Zimbabwe |
| Porte (s'ouvre et se ferme) | perches + bâtons + corde | — |
| Toit de chaume | perches + herbes sèches + corde | Toits des rondavels |
| Échelle (s'escalade) | perches + bâtons + corde | — |
| Clôture d'épines (boma) | bâtons + branches | Les bomas et kraals |

**Fixations adaptées aux matériaux (10.2) :**

| Fixation | Où | Effet |
| --- | --- | --- |
| Cordes | ligatures du bois | fixation de départ |
| Clous et boulons forgés | bois | plus solides : plus de points de vie, meilleure transmission des appuis |
| Pierres emboîtées | pierre sèche | sans aucun liant |
| Torchis | enduit sur le clayonnage | protège du feu |
| Soudure à la forge | outils en fer | pour corroyer deux barres de fer |

### Stabilité : appuis, équilibre, résistance

| Décision | Inspirée de | Pourquoi |
| --- | --- | --- |
| Chaque pièce a une **stabilité** de 0 à 100 % qui vient du sol et passe de pièce en pièce. Elle se perd plus vite à l'horizontale (porte-à-faux) qu'à la verticale, et selon le matériau : la pierre porte bien vers le haut mais mal en porte-à-faux, le bois tient mieux les portées | Valheim (couleurs de stabilité), 7 Days to Die (charge selon le matériau) | Supports, équilibre, résistance (10.2) |
| On voit la stabilité en visant une pièce ; un plan trop loin d'un appui est refusé | Valheim | On comprend pourquoi |
| Sous 20 %, une pièce **s'effondre** : elle se brise en débris physiques qui tombent (des bûches, des perches, des pierres à ramasser), et les pièces qu'elle portait suivent en cascade | Valheim, Medieval Engineers | Physique et destruction par la structure (10.4) |
| Une pierre lourde posée sur du bois transmet moins bien | 7 Days to Die (masse) | Poids des matériaux |

### Destruction et réparation

| Décision | Inspirée de | Pourquoi |
| --- | --- | --- |
| Chaque pièce a des points de vie selon son matériau et sa fixation (chaume < bois < torchis < pierre ; clous et boulons : +30 %) | Rust (paliers de matériaux) | Matériaux (10.4) |
| Les dégâts dépendent de l'outil ou de l'arme et du matériau : la hache tranche le bois, le galet casse le torchis et la pierre, la main ne fait presque rien | Rust, Valheim | Armes (10.4) |
| Les **chocs physiques** abîment : une pierre lancée, un débris qui tombe (force du contact mesurée par le moteur physique) | Medieval Engineers | Forces physiques (10.4) |
| **Le feu** : une torche peut enflammer le bois et le chaume, le feu se propage aux pièces voisines combustibles, le torchis et la pierre ne brûlent pas ; un pot d'eau l'éteint | Rust (le bois brûle), Green Hell | Matériaux, incendies (6.3) |
| Les créatures pourront s'attaquer aux constructions (phase 6) : la fonction de dégâts est prête | Raft (le requin qui ronge les fondations) | Créatures (10.4) |
| Réparer une pièce demande un peu de son matériau ; la démonter rend une partie des matériaux selon son état | Rust, Valheim | Recyclage (9.7) |
| Pas d'usure automatique des bases (pas de « décrépitude » à entretenir) | — | Rester exigeant sans être punitif (13.6) |

### Installations

| Installation | Rôle | Inspirée de |
| --- | --- | --- |
| Coffre en bois | rangement de 40 L, ouvert comme un sac posé | Tous les jeux de survie |
| Établi | à proximité : meilleure qualité et gestes plus rapides pour la fabrication | Valheim (confort de l'établi) |
| Torche (fabriquée sur le plan de travail) | **lumière**, à tenir ou à planter ; s'allume à un feu ; brûle 10 à 20 min | The Forest, Green Hell |
| Puits (près des fleuves et des zones humides) | remplir son pot sans aller au fleuve | — |
| Bas fourneau (argile, pierres, soufflet) | fondre le minerai de fer : on charge le minerai et le bois, on allume, on actionne le soufflet. Il en sort une loupe de fer | Fourneaux à soufflets du plateau zimbabwéen (Njanja, Grand Zimbabwe) |
| Forge (enclume de pierre, foyer) | forger barres, clous, boulons, hache et couteau en fer | Vintage Story |

### Électricité, machines, automatisation (10.3)

Elles demandent des métaux et des pièces qui n'existent pas encore : cuivre, aimants, pièces récupérées dans les bâtiments abandonnés (phase 9). Elles demandent aussi la simulation mécanique des moteurs et des machines (phase 7). Je les reporte donc à ces phases et je l'indique dans l'état du projet. Le bas fourneau et son soufflet sont la première « machine » du jeu.

### Où construire (10.1)

- Sur terre, sur les pentes (pilotis), sur l'eau peu profonde (pilotis dans le lit du fleuve).
- En hauteur : échelles, étages, et il faut monter les matériaux.
- Dans les grottes : elles n'existent pas encore (phase 9), mais rien n'empêche de construire sous un surplomb rocheux.
- Les radeaux flottants sont des véhicules : phase 7.

## Difficultés techniques identifiées avant de commencer

| Difficulté | Réponse prévue |
| --- | --- |
| Calcul de stabilité rapide et identique partout (multijoueur) | Graphe de pièces par construction, propagation du meilleur appui (algorithme déterministe), recalculé seulement quand une pièce change |
| Beaucoup de collisions fixes | Collisions des pièces seulement près des joueurs (14.5), retirées au loin |
| Effondrements en cascade | Effondrement par vagues (quelques dixièmes de seconde) ; nombre de débris physiques limité |
| Mesurer les chocs | Événements de force de contact du moteur physique, sur les pièces seulement |
| Poser une pièce au doigt | Grille et accroche automatique, visée au centre de l'écran, boutons « Poser » et « Tourner » |
| Porte qui se referme sur le joueur | On vérifie la place avant de fermer |
| Échelles | Elles deviennent une surface escaladable par le système d'escalade existant ; les murs, eux, ne s'escaladent pas (défense) |
| Lumière sur téléphone | Nombre de lumières limité selon la qualité (aucune en Basse), créées une fois pour éviter de recompiler les matériaux |
| Sauvegardes existantes | Les anciennes sauvegardes se relisent : simplement aucune construction |
| Réseau (phase 8) | Chaque action est une demande vérifiée (place, distance, matériaux, appuis), comme pour la fabrication |

## Sources consultées

- Valheim : [intégrité structurelle](https://hostedgg.com/wiki/valheim/structural-integrity), [guide de construction](https://mobalytics.gg/gamebase/guides/valheim-general-building-guide)
- The Forest et Sons of the Forest : [plans fantômes à remplir](https://www.corrosionhour.com/the-forest-beginners-guide/), [construction](https://techraptor.net/gaming/guides/sons-of-forest-building-guide)
- Rust : [paliers de matériaux et armoire à outils](https://rustafied.com/building-in-rust)
- 7 Days to Die : [charge maximale](https://7daystodie.fandom.com/wiki/Max_Load)
- Raft : [le requin et les fondations](https://raft.fandom.com/wiki/Threats?diff=4976)
- Grand Zimbabwe : [maçonnerie de pierre sèche](https://www.metmuseum.org/essays/great-zimbabwe)
- Huttes « pole and dagga » : [architecture domestique du Zimbabwe](https://postcolonialweb.org/zimbabwe/art/architecture/huts.html), [rondavel](https://Www.Wikipedia.org/wiki/Rondavel)
- Métallurgie du fer au Zimbabwe : [fourneaux à soufflets](https://hmsjournal.org/index.php/home/article/download/670/654/679), [fer njanja](https://open.uct.ac.za/handle/11427/18208)
