# Phase 5 — Construction

**Statut : terminée le 13/11/2026.** Vérifiée par 177 tests unitaires (dont 31 propres à la phase 5) et 16 vérifications de la phase 5 dans un vrai navigateur (ordinateur, téléphone, manette). Reste à l'essayer sur vos appareils.

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
| Coffre en bois | rangement de 30 L, ouvert comme un sac posé | Tous les jeux de survie |
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

## Ce qui a été fait

### Plans, chantiers, étapes

| Plan | Pièce | Étapes et matériaux | Points de vie |
| --- | --- | --- | --- |
| Plancher en rondins | case 2 × 2 m | (pilotis : 1 perche par coin, bâton à fouir) · poser les rondins (4 bûches) · ligaturer (2 cordes, ou 2 boulons) | 260 |
| Dallage en pierre | case, sol presque plat | poser et caler les pierres (30 kg, galet) | 600 |
| Poteau | coin | dresser (1 perche, ou 1 boulon de plus) | 200 |
| Mur de clayonnage | bord | dresser les montants (2 perches) · tresser (6 bâtons) · ligaturer (1 corde, ou 6 clous) | 220 ; torchis : 400 |
| Mur en pierre sèche | bord | trois assises (20, 20 et 15 kg de pierres, galet) | 700 |
| Porte en perches | bord | encadrement (2 perches) · battant (6 bâtons, outil tranchant) · attaches (1 corde, ou 4 clous) | 200 |
| Toit de chaume | case, sur les murs | charpente (2 perches, 1 corde) · chaume (8 brassées d'herbes) | 120 |
| Échelle | bord | montants (2 perches, 4 bâtons) · barreaux (1 corde) | 100 |
| Clôture d'épines | bord | planter et entrelacer (4 bâtons, 2 branches, bâton à fouir) | 150 |
| Coffre, établi, puits, bas fourneau, forge | posés librement (sur le sol ou un plancher) | voir l'onglet « Construire » | — |

Fonctionnement du chantier :
- Les matériaux comptent s'ils sont sur soi, en main ou posés à moins de 2,5 m du chantier. Ceux posés à côté servent en premier.
- Les pierres comptent au poids et s'utilisent entières : le jeu choisit celles qui gaspillent le moins.
- Avec des clous ou des boulons sur soi, les ligatures sont clouées : 30 % de points de vie en plus et de meilleurs appuis.
- On peut abandonner un chantier : 80 % de ce qui y était posé revient au sol.

### Stabilité

La stabilité vient du sol. Une pièce plantée dans le terrain vaut 100 %, ou 95 % sur pilotis. Elle se transmet de pièce en pièce, multipliée à chaque passage :

| Passage | Coefficient |
| --- | --- |
| Plancher vers ce qu'il porte | 0,93 (dallage : 0,98) |
| Mur ou poteau vers ce qu'il porte | bois 0,88, torchis 0,90, pierre 0,97, poteau 0,92 |
| Porte-à-faux d'un plancher au voisin | bois 0,45 (au fer : 0,50), dallage 0,30 |
| Murs voisins qui se tiennent par un coin | 0,30 (pierre : 0,25) |
| Pierre portée par du bois | × 0,75 |

- Sous 20 %, une pièce s'effondre. On peut avancer d'une case de 2 m en porte-à-faux au-delà du dernier appui, pas deux.
- Les effondrements se font par vagues (toutes les 0,25 s). Chaque pièce tombée laisse 40 % de ses matériaux en débris physiques, au plus dix objets.
- Les installations posées sur un plancher qui disparaît tombent avec lui, et le contenu d'un coffre se répand au sol.

### Destruction

| Outil | Chaume | Bois | Torchis | Pierre |
| --- | --- | --- | --- | --- |
| Hache | 25 | 18 | 6 | 1 |
| Outil tranchant (couteau, éclat) | 12 | 6 | 2 | 0,5 |
| Galet | 8 | 6 | 12 | 7 |
| Lance | 6 | 4 | 3 | 0,5 |

Les valeurs sont des points de vie par coup, multipliés par la puissance de l'outil (une hache en fer : × 1,6).

Les autres sources de dégâts :
- **Chocs.** Au-delà de 700 N de force de contact, mesurée par le moteur physique : une pierre lancée, un débris qui tombe. La pierre en subit 30 %, le torchis 60 %.
- **Feu.** Le bois perd 8 points de vie par seconde, le chaume 12. Toutes les 0,5 s, le feu passe à chaque voisin combustible avec 6 % de chance.
  - Un foyer posé sur un plancher de bois l'enflamme tôt ou tard : un dallage de pierre est sûr.
  - Un pot d'eau éteint le feu.
- **Réparer** rend 40 % des points de vie avec un peu du matériau : une bûche ou deux bâtons, une boule d'argile, 6 kg de pierres ou 3 brassées d'herbes.
- **Démonter** rend jusqu'à 75 % des matériaux, selon l'état. Les cordes, clous, herbes et argile se perdent.

### Installations et fer

| Installation | Fonctionnement |
| --- | --- |
| Coffre | E l'ouvre ; on y range comme dans un sac posé (30 L) |
| Établi | à moins de 3 m, les gestes de fabrication vont 20 % plus vite et la qualité gagne l'équivalent de deux niveaux de compétence ; E ouvre la fabrication |
| Puits | seulement si le sol est à moins de 4 m au-dessus de l'eau (près des fleuves et des vleis) ; on y remplit son pot (E, ou « Utiliser » avec le pot) |
| Bas fourneau | on charge jusqu'à 4 morceaux de minerai et du bois, on allume (torche, ou archet et herbes), puis on actionne le soufflet (4 s, épuisant). Au-dessus de 60 % de chaleur, chaque coup de soufflet avance la réduction : six coups font une loupe de fer pour deux morceaux de minerai |
| Forge | se nourrit et s'allume comme un foyer ; allumée, elle permet de forger sur le plan de travail |

Les recettes de la forge (la forge doit être allumée à moins de 3 m) :

| Recette | Pièces | Étapes |
| --- | --- | --- |
| Barre de fer | une loupe | chauffer, battre au galet |
| Clous (12) | une barre | étirer, couper |
| Boulons (8) | deux barres | forger les tiges, refouler les têtes |
| Hache en fer | deux barres + une branche | souder les barres à la forge, forger le tranchant, emmancher. Durabilité 600, puissance 1,6 |
| Couteau en fer | une barre + une branche | forger la lame, emmancher. Durabilité 400, puissance 1,5 |

Les torches se fabriquent sur le plan de travail :
- bâton et herbe : 10 min de flamme ;
- bâton et résine : 20 min.

Une torche s'allume à un feu (« Utiliser » à côté). Allumée, elle éclaire et allume foyers, forges et fourneaux sans archet. Elle peut aussi mettre le feu au bois et au chaume. Rangée dans le sac, elle s'éteint et garde ce qui lui reste à brûler.

### Interface et commandes

- **Tracer un plan.** Le sac a un nouvel onglet « Construire ». Chaque plan connu y figure avec ses matériaux ; « Tracer » ferme le sac et passe en mode construction.
- **Le fantôme** (vert ou rouge) suit le regard et s'accroche aux pièces voisines. L'indication dit pourquoi un plan est impossible : trop loin d'un appui, terrain trop haut, déjà occupé, trop loin, vous êtes dans le chemin…
- **Les commandes en mode construction :**

  | Action | Clavier et souris | Manette | Tactile |
  | --- | --- | --- | --- |
  | Poser le plan | clic gauche | RT | « Poser » |
  | Tourner le plan (crans de 15°) | R ou E | LB, RB ou X | « Tourner » |
  | Annuler | clic droit ou F | LT | « Annuler » |

- **Faire une étape.** « Utiliser » sur un chantier fait l'étape suivante. L'indication dit ce qu'il faut et ce qui manque.
- **E sur une pièce.**
  - Une porte s'ouvre ou se ferme, même les mains prises.
  - Les autres pièces ouvrent leur panneau : stabilité, état, réparer, torchis, démonter, éteindre. Pour un chantier : faire l'étape, abandonner.
- **À la manette, dans le sac :** le stick choisit un plan dans « Construire », A le trace.
- **Lumière.** Les feux, forges, fourneaux, torches et incendies les plus proches éclairent, avec une flamme qui vacille : deux lumières au plus, aucune en qualité Basse. Elles serviront surtout la nuit et dans les grottes (phase 9).
- **Outil de test.** « Recevoir des matériaux de construction » pose à côté de vous de quoi bâtir une case : 8 bûches, 8 perches, 16 bâtons, 10 pierres, 6 boules d'argile. Il met aussi dans le sac 6 cordes, 10 brassées d'herbes et 24 clous.

## Tests

### Tests unitaires (Vitest)

- `tests/unit/phase5-building.test.ts` (18 tests) :
  - grille et changement de repère ;
  - pose sur sol plat, sur une pente (pilotis), sur l'eau (jusqu'à 3,5 m) ;
  - accroche à la grille voisine, refus si occupé, trop loin, ou si le joueur est dans le chemin ;
  - stabilité : murs sur plancher à pilotis, étage, porte-à-faux limité, effondrement en cascade, pierre sur bois, toit sur poteaux ;
  - un chantier ne porte rien ;
  - dégâts selon l'outil et le matériau, réparation, torchis, fixation au fer, démontage ;
  - puits près de l'eau seulement ; installation sur un plancher ;
  - plans connus et appris ;
  - sauvegarde et relecture, données trafiquées ignorées, identifiants jamais réutilisés ; déterminisme.
- `tests/unit/phase5-simulation.test.ts` (13 tests) :
  - tracer un plancher et l'assembler avec des bûches posées à côté ; on marche dessus ;
  - clous utilisés en priorité ; abandon d'un chantier ;
  - porte qui bloque, s'ouvre, refuse de se refermer sur soi, s'ouvre les mains prises ;
  - une échelle s'escalade, un mur non ;
  - effondrement de l'étage en débris ;
  - la hache détruit un mur ; une pierre lancée l'abîme ;
  - incendie à la torche, extinction, torchis ininflammable ;
  - coffre sur plancher, sauvegarde, chute avec le plancher ;
  - puits ;
  - chaîne complète minerai, fourneau, loupe, forge, barre, clous ; forge éteinte refusée ;
  - établi plus rapide ; torches ;
  - actions réseau vérifiées ; plan inconnu ou trop loin refusé.

### Dans un vrai navigateur (Playwright, scénario `phase5`)

Ordinateur, avec les vraies touches et la souris :
1. L'onglet « Construire », puis « Tracer » : le sac se ferme et le mode construction s'active.
2. Le fantôme suit le regard ; R le tourne ; clic gauche pose le plan ; clic droit arrête.
3. Matériaux posés à côté, F à chaque étape : le plancher est terminé et solide.
4. Une porte sur le bord, trois étapes. Fermée, elle arrête le joueur ; E l'ouvre ; on entre dans la case.
5. Une torche allumée au foyer (F) met le feu au mur de clayonnage. E sur le mur montre son panneau ; « Éteindre » éteint le feu avec le pot d'eau.
6. Après avoir quitté et rechargé, tout est conservé. L'outil de test pose les matériaux.

Téléphone :
- « Tracer » ;
- les boutons deviennent « Poser », « Tourner », « Annuler » ;
- le plan se pose ;
- retour au jeu.

Manette : Y, RB jusqu'à « Construire », A trace, RT pose, LT annule.

Captures : `tests/e2e/out/phase5-*.png`.

## Limites et compromis (signalés)

- **Physique des structures, version simplifiée.** La stabilité suit des coefficients par pièce et par matériau : pas de calcul des forces réelles, ni de déformation ou de flexion des poutres. L'effondrement fait tomber de vrais débris physiques.
- **Formes.** Une grille de 2 m et des pièces droites. Pas de cases rondes (rondavels) ni de pièces de forme libre pour l'instant.
- **Électricité, machines, automatisation (10.3) :** reportées aux phases 7 et 9, comme expliqué plus haut.
- **Radeaux flottants :** phase 7 (véhicules). Sur l'eau, on construit pour l'instant sur pilotis.
- **Grottes :** phase 9.
- **Les attaques des bases** par les créatures (phase 6) et par d'autres joueurs (phase 8) utiliseront la fonction de dégâts déjà en place. Les installations, elles, ne prennent pas encore de coups ; elles ne disparaissent qu'avec leur plancher ou quand on les démonte.
- **Sur une pente,** un plancher peut dépasser d'une marche (plus de 35 cm) : il faut sauter pour y monter, ou construire plus bas.
- **Lumière (compromis mobile).** Deux lumières au plus, aucune en qualité Basse. Sans cycle jour/nuit, l'effet est discret en plein jour.
- **Téléphone (compromis mobile).** L'onglet « Construire » occupe l'écran. Une fois le plan choisi, on vise et on pose dans le jeu avec les boutons « Poser », « Tourner », « Annuler ».

## Sources consultées

- Valheim : [intégrité structurelle](https://hostedgg.com/wiki/valheim/structural-integrity), [guide de construction](https://mobalytics.gg/gamebase/guides/valheim-general-building-guide)
- The Forest et Sons of the Forest : [plans fantômes à remplir](https://www.corrosionhour.com/the-forest-beginners-guide/), [construction](https://techraptor.net/gaming/guides/sons-of-forest-building-guide)
- Rust : [paliers de matériaux et armoire à outils](https://rustafied.com/building-in-rust)
- 7 Days to Die : [charge maximale](https://7daystodie.fandom.com/wiki/Max_Load)
- Raft : [le requin et les fondations](https://raft.fandom.com/wiki/Threats?diff=4976)
- Grand Zimbabwe : [maçonnerie de pierre sèche](https://www.metmuseum.org/essays/great-zimbabwe)
- Huttes « pole and dagga » : [architecture domestique du Zimbabwe](https://postcolonialweb.org/zimbabwe/art/architecture/huts.html), [rondavel](https://Www.Wikipedia.org/wiki/Rondavel)
- Métallurgie du fer au Zimbabwe : [fourneaux à soufflets](https://hmsjournal.org/index.php/home/article/download/670/654/679), [fer njanja](https://open.uct.ac.za/handle/11427/18208)
