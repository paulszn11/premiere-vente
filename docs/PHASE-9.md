# Phase 9 — Monde complet

**Statut : en cours (commencée le 14/11/2026).** Ce document présente les décisions, les difficultés techniques identifiées avant de commencer et le découpage en étapes. Il sera complété au fil de la phase.

## Ce que demande le cahier des charges

- **Phase 9 (section 16) :** extension des biomes, contenu, mystères, documents, événements, catastrophes, écosystème.
- **4.1 à 4.4 :** régions secondaires, lieux cachés, zones dangereuses, secrètes et mystérieuses ; carte vierge révélée progressivement, marqueurs, annotations ; lieux découverts grâce aux indices et documents ; zones demandant du matériel ou des connaissances ; **grottes** (passages étroits, grandes cavernes, plans d'eau souterrains, créatures, ressources rares, secrets, zones très dangereuses — de vrais environnements, pas des tunnels décoratifs) ; **bâtiments abandonnés** qui racontent chacun une histoire (pièces, objets, documents, indices, dangers, ressources, secrets).
- **5 :** créatures souterraines et mystérieuses, activité selon l'heure.
- **6.1 à 6.4 :** cycle jour/nuit (luminosité, activité des créatures, dangers selon le moment) ; météo dynamique (pluie, orages, brouillard, neige, vent, tempêtes, extrêmes) qui influence le jeu ; catastrophes rares (incendies, inondations, séismes, tempêtes majeures) aux conséquences durables.
- **8.2 :** armes à feu rares, puissantes, difficiles à utiliser, qui ne rendent pas le reste inutile.
- **10.3 :** éclairage et électricité dans les bases.
- **13 :** histoire importante mais exploration libre ; documents, journaux, événements, indices ; très peu de guidage ; interface consultée à travers des objets (carte, documents) ; son immersif (acoustique des lieux, silence, bruits du monde).
- **Reportés des phases précédentes :** ruisseaux et chutes d'eau, électricité, voiles et moteurs à essence, pluie et tempêtes, cycle jour/nuit et chasses nocturnes, créatures souterraines, armes à feu (avec les bâtiments abandonnés).

## Découpage

| Étape | Contenu |
| --- | --- |
| 9.1 | Cycle jour/nuit : heure du monde, soleil, ciel, lumière ; créatures actives selon l'heure |
| 9.2 | Météo : pluie, orage et foudre, brouillard, neige sur les sommets, vent, tempêtes ; effets sur le jeu |
| 9.3 | Eau : niveau de l'eau propre à chaque lieu ; ruisseaux, chutes d'eau, bassins ; eaux souterraines |
| 9.4 | Lieux : fermes, mission, gare, station de recherche du lac, mine d'or, ruines de pierre sèche, cercle de pierres ; objets abandonnés, documents, clés, histoire |
| 9.5 | Grottes et mines : vrais réseaux souterrains (passages étroits, cavernes, lacs), obscurité, ressources rares, secrets, créatures |
| 9.6 | Carte révélée progressivement, marqueurs et annotations, partage |
| 9.7 | Armes à feu |
| 9.8 | Électricité et éclairage des bases |
| 9.9 | Moteur à essence et voiles |
| 9.10 | Événements et catastrophes : feux de brousse, crues, séismes, tempêtes majeures, phénomènes étranges |
| 9.11 | Écosystème : nouvelles espèces, comportements selon l'heure |
| 9.12 | Sons du monde : jour, nuit, pluie, tonnerre, eau, échos des grottes |

## Décisions

> **Section 15 du cahier.** Le catalogue des créatures (nouvelles espèces), le partage des cartes et des marqueurs, et la liste des objets et matériaux nouveaux font partie des éléments à spécifier. Ce qui suit est une **proposition signalée et modifiable**.

### 9.1 Jour et nuit

| Décision | Pourquoi |
| --- | --- |
| Un jour dure **40 minutes réelles** (le temps du monde va 36 fois plus vite) : environ 26 min de jour, 10 min de nuit, aube et crépuscule de 2 min | Assez long pour une expédition de jour, une vraie nuit à chaque séance de jeu (Valheim : 30 min, 7 Days to Die : 60 min) |
| Un nouveau monde commence à **7 h** | On découvre le monde de jour |
| L'heure découle du temps du monde : hôte et joueurs voient le même ciel sans rien échanger de plus | Simple, cohérent en multijoueur |
| La nuit est **sombre mais pas noire** (lune) ; le feu, la torche et les lampes comptent vraiment | Dangers variables selon le moment |
| Les prédateurs (hyènes, léopard, lions) chassent surtout la nuit ; les herbivores se regroupent et dorment ; on voit moins loin et les créatures aussi (sauf celles qui chassent à l'ouïe ou à l'odorat) ; une torche se voit de loin | 6.1, 5.2 (lumière, vision) |
| Aucune horloge à l'écran : la position du soleil donne l'heure | Interface diégétique (13.4) |

### 9.2 Météo

| Décision | Pourquoi |
| --- | --- |
| Météo calculée à partir de la graine et du temps (comme le vent) : identique pour tous, sans échange réseau | Cohérent en multijoueur |
| **Régions** : hautes terres de l'Est pluvieuses et brumeuses ; Kalahari et lowveld secs ; brouillard au matin dans les zones humides ; **neige** seulement sur les sommets les plus hauts quand il précipite la nuit | Climat du Zimbabwe |
| **Pluie** : visibilité réduite, sol glissant (l'herbe et la terre deviennent de la boue), feux à découvert qui s'éteignent peu à peu, bruits et pistes atténués (les créatures entendent et sentent moins) | La météo influence le jeu (6.2) |
| **Orage** : vent fort, éclairs ; la foudre frappe les points hauts (arbres isolés, constructions hautes, joueur sur un sommet) et peut allumer un feu | Danger réel, rare |
| **Abri** : sous un toit, on n'est ni mouillé ni frappé, et le feu tient | Intérêt des constructions |
| Pas de température corporelle (cahier, section 5) : la pluie ne refroidit pas le joueur | Respect du cahier |

### 9.3 Eau

| Décision | Pourquoi |
| --- | --- |
| Le niveau de l'eau devient **propre à chaque lieu** (fleuves et lac au niveau de la mer du jeu, ruisseaux, bassins, lacs souterrains au-dessus) | Indispensable pour les ruisseaux, les chutes et les grottes |
| **Ruisseaux** : ils naissent sur les hauteurs (hautes terres, plateau) et descendent la pente jusqu'au fleuve, au lac ou à une cuvette (bassin). Calculés à partir de la graine. Le relief n'est **pas** modifié (les constructions existantes restent en place) : l'eau suit les fonds de vallée | Préserver les sauvegardes |
| **Chutes d'eau** là où un ruisseau tombe d'une falaise (escarpement, hautes terres), avec un bassin où l'on peut nager ; une **cachette derrière une chute** | Spectacle et secret |
| Les ruisseaux sont peu profonds : on y marche (plus lentement), on y remplit un pot, les animaux viennent y boire | Ressource d'eau loin des fleuves |

### 9.4 Lieux, bâtiments abandonnés, histoire

| Décision | Pourquoi |
| --- | --- |
| Lieux placés à partir de la graine, dans les régions adaptées, ajoutés au monde à sa création (et aux mondes existants à leur prochaine ouverture, sans écraser les constructions des joueurs) | Chaque monde est différent ; rien n'est perdu |
| Bâtiments faits des **pièces de construction** du jeu (murs de pierre et de torchis, toits de chaume, portes, clôtures), abîmés ou effondrés : ils se visitent, se réparent ou se démontent pour leurs matériaux | Bâtiments entièrement explorables (4.4), cohérents avec la construction |
| **Fermes abandonnées** (plateau), **mission** (hautes terres), **gare** (plateau, voie ferrée), **station de recherche du lac**, **mine d'or** (avec son puits vers les galeries), **ruines de pierre sèche** (enceinte et tour, inspirées des cités de pierre de la région), **cercle de pierres** (zone mystérieuse) | Variété ; chaque lieu a son histoire |
| Objets abandonnés : outils, cordes, fer, bidons d'essence, fil de cuivre, lampes, pièces mécaniques ; très rarement un **fusil** et des cartouches | Ressources récupérables, armes rares |
| **Documents** (journaux, lettres, carnets de bord, relevés, notes) à lire depuis le sac ; ils se rangent dans le carnet. Certains indiquent un lieu (une note s'ajoute alors à la carte, approximative) | Narration par documents (13.2), découverte par indices (4.2) |
| **Zones verrouillées** : portes fermées à clé (la clé est ailleurs, un document dit où chercher) ; puits de mine à descendre à l'échelle ; passage noyé à franchir en apnée | Zones nécessitant du matériel, des connaissances ou une préparation (4.2) |
| **Histoire** (originale, non linéaire) : le jour où tout le monde a disparu (« le Silence »), une équipe qui étudiait une présence dans le lac, une mine qui a creusé trop profond, des peintures rupestres qui montrent la même créature, et la légende d'un esprit gardien du fleuve, racontée par les anciens. Le joueur reconstitue et interprète : pas de quête imposée | 13.1 à 13.3 |

### 9.5 Grottes et mines

| Décision | Pourquoi |
| --- | --- |
| **Vrais volumes souterrains** : chaque réseau est un ensemble de galeries et de cavernes (de passages où l'on doit s'accroupir à des salles de 40 m), creusé dans la roche sous le relief ; on y marche, grimpe, nage ; ils ont leurs propres collisions | « De véritables environnements explorables » (4.3) |
| Surfaces calculées par une **fonction de distance** (galeries + cavernes + bruit) et extraites en maillage (« marching cubes »), identiques pour la physique et l'affichage | Jonctions naturelles entre galeries et salles, roche irrégulière |
| **Entrées** : petits trous découpés dans le relief au pied d'un kopje ou d'une falaise, bordés de rochers ; le **puits de la mine** se descend à l'échelle | Le relief reste un « heightfield » rapide partout ailleurs |
| **Obscurité** totale sous terre : il faut une torche, une lampe ou un feu | Préparation nécessaire, ambiance |
| Réseaux dans les **collines de granit** (abris peints, salles), l'**escarpement** (grandes cavernes, lac souterrain) et la **mine** (galeries étayées, rails) | Trois ambiances |
| **Ressources rares** sous terre : cristaux de quartz, filons de fer riches, or ; **secrets** : salle cachée derrière un passage étroit ou un siphon ; **zone extrêmement dangereuse** au fond (le Rôdeur) | 4.3 |

### 9.6 Carte

| Décision | Pourquoi |
| --- | --- |
| Chaque joueur a une **carte** (dans le sac), vierge au départ, qui se dessine là où il passe | 4.2 |
| Sa position y figure ; **jamais celle des autres joueurs** | Principe du jeu (phase 2) |
| **Marqueurs** et **annotations** (texte court) ; les lieux visités s'y inscrivent ; les documents y ajoutent des notes approximatives | 4.2 |
| **Partage** (section 15, proposition) : « Montrer ma carte » à un joueur tout proche fusionne les zones explorées et les marqueurs dans la sienne | Coopération sans rien imposer |

### 9.7 Armes à feu

| Décision | Pourquoi |
| --- | --- |
| Un **fusil** (un ou deux par monde, dans des lieux précis) et des **cartouches** (rares, quelques-unes par lieu) | Rares (8.2) |
| Puissant (tue un léopard d'une balle bien placée) mais **difficile** : le canon oscille (davantage si l'on est fatigué, blessé ou essoufflé ; moins accroupi), recharge lente, enrayage s'il est usé | Difficiles à utiliser (8.2) |
| **Très bruyant** : toutes les créatures à des centaines de mètres l'entendent (certaines fuient, d'autres viennent) | Ne rend pas le reste inutile |

### 9.8 Électricité

| Décision | Pourquoi |
| --- | --- |
| **Dynamo** entraînée par une roue à eau ou une machine à vapeur (le réseau d'énergie de la phase 7) ; **lampes** reliées dans un rayon de 25 m | Éclairage et électricité des bases (10.3) |
| Fabriquées avec du **fil de cuivre** et des **ampoules** récupérés dans les bâtiments | Lien avec l'exploration |

### 9.9 Moteur à essence et voiles

| Décision | Pourquoi |
| --- | --- |
| **Moteur à essence** (récupéré, réparable) pour le chariot et le radeau, à la place de la machine à vapeur : démarre aussitôt, consomme l'**essence** des bidons trouvés, bruyant | Rare et précieux |
| **Voile** (toile cousue de chiffons, perche, cordes) pour le radeau et la pirogue : avance avec le vent (direction et force) | Le vent existe déjà |

### 9.10 Événements et catastrophes

| Décision | Pourquoi |
| --- | --- |
| **Feux de brousse** : la foudre ou un feu mal gardé, par temps sec, embrase l'herbe ; le front avance avec le vent, brûle arbres et constructions, fait fuir les animaux ; le sol reste brûlé un moment puis la végétation repousse | Incendies, conséquences durables |
| **Crues** : après de fortes pluies, le Zambèze et le lac montent (jusqu'à 1,5 m) puis redescendent : les berges basses sont inondées | Inondations |
| **Séismes** (rares) : la terre tremble, les constructions fragiles s'effondrent, des passages de grottes s'éboulent | Séismes |
| **Tempêtes majeures** : vent violent, toits de chaume arrachés, embarcations renversées | Tempêtes majeures |
| **Phénomènes étranges** : lueurs la nuit près du cercle de pierres, la boussole affolée, des sons dans la brume | Mystères et anomalies |
| Calculés par l'hôte, transmis aux joueurs ; annoncés par ce qu'on voit et entend, pas par un message | Diégétique |

### 9.11 Écosystème (section 15 : catalogue des créatures, proposition)

| Espèce | Milieu | Comportement |
| --- | --- | --- |
| **Lion** | savane, plateau | chasse en troupe la nuit, rugit ; évite le feu |
| **Buffle** | prairies, bords de l'eau | troupeau ; charge s'il est menacé ou blessé |
| **Chauve-souris** | grottes | essaims qui fuient la lumière, sortent au crépuscule ; inoffensives |
| **Le Rôdeur** | fond des grottes | créature aveugle qui chasse au bruit ; extrêmement dangereuse ; ne sort jamais au jour |

### 9.12 Sons

Ambiances jour (oiseaux) et nuit (insectes, grenouilles), pluie, tonnerre (décalé selon la distance), ruisseaux et chutes, **écho des grottes** (réverbération), gouttes ; silence au fond des galeries.

## Difficultés techniques identifiées

1. **Grottes dans un relief en « heightfield »** : impossible de faire un trou dans ce type de relief. Les chunks où débouche une entrée utilisent un maillage (le même relief, moins le trou) ; l'affichage enlève les mêmes cellules.
2. **Volumes souterrains** : générer des surfaces fermées et naturelles (jonctions galeries–salles) sans artefacts, identiques sur tous les appareils (pas de fonctions trigonométriques dans les calculs partagés), assez vite pour ne pas saccader.
3. **Eau à plusieurs niveaux** : le niveau unique est utilisé partout (déplacements, nage, faune, véhicules, affichage).
4. **Lumière** : jusqu'ici deux lumières au plus (aucune en qualité Basse) ; la nuit et les grottes rendent la torche indispensable à toutes les qualités.
5. **Créatures sous terre** : la faune suit le relief ; il faut des créatures qui suivent le sol des grottes.
6. **Contenu** : beaucoup de lieux, d'objets et de textes à écrire, tous cohérents avec l'histoire.
7. **Multijoueur** : tout ce qui change le monde (feux de brousse, crues, séismes, lieux) doit être calculé par l'hôte et transmis.
8. **Performances** : pluie, feu, grottes et chutes ajoutent du dessin et du calcul ; compromis à signaler pour les téléphones.
