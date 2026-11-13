# Phase 6 — Créatures et horreur

**Statut : en cours (décisions prises, développement commencé le 13/11/2026).**

## Ce que demande le cahier des charges

- **Phase 6 (section 16) :** intelligence artificielle, écosystème, créatures, détection, combats, horreur sous-marine.
- **5.1 Diversité.** Animaux terrestres, aquatiques, souterrains ; créatures hostiles, neutres, mystérieuses ; chaque espèce a ses caractéristiques.
- **5.2 Comportement.** Chasser, se défendre, défendre un territoire, coopérer avec certaines espèces, attaquer sans avertissement, détecter les joueurs, réagir aux blessures, mémoriser des habitudes, détruire des constructions. Détection selon l'espèce : vue, ouïe, traces, bruits, lumière, comportement du joueur, autres sens.
- **5.3 Évolution.** Reproduction, migrations, territoires, prédateurs et proies, populations qui évoluent, mort définitive ou réapparition selon l'espèce, apparitions fixes et dynamiques, évolution physique et comportementale.
- **5.4 Blessures.** Réaction selon l'espèce, la partie touchée, la gravité, la situation, les autres créatures et le comportement du joueur : fuir, attaquer davantage, ralentir, boiter, changer de stratégie.
- **8.1 à 8.4 Combats.** Réalistes, tactiques, physiques, improvisés ; armes de mêlée avec poids, équilibre, portée, usure ; dégâts localisés sur le joueur. Armes à feu rares, puissantes, difficiles.
- **8.8 Pièges** physiques, mécaniques et environnementaux, construits librement, pour la défense, la chasse et la protection des bases.
- **10.4** : certaines créatures détruisent les constructions. **14.5** : niveaux de simulation selon la distance et l'activité.

## Décisions (en m'inspirant de jeux du même style, sans en copier un)

> **Section 15 du cahier.** Le catalogue des créatures fait partie des éléments encore à spécifier. Le catalogue ci-dessous est une **proposition signalée et modifiable** : espèces, chiffres et comportements peuvent changer.

### Catalogue proposé : la faune du Zimbabwe, et une créature mystérieuse

| Espèce | Catégorie | Où | Groupe | Ce qu'elle fait | Sens | Mort |
| --- | --- | --- | --- | --- | --- | --- |
| Impala | terrestre, neutre (proie) | prairies, savane, vallée, miombo | harde de 4 à 10 | broute, s'alarme, fuit en bondissant ; prévient les autres | vue très large, ouïe fine | définitive ; la population se reproduit |
| Phacochère | terrestre, neutre | savane, prairie, Kalahari | 1 à 4 | fouille le sol, fuit ; charge s'il est acculé ou blessé | odorat, ouïe ; vue faible | définitive ; reproduction |
| Babouin chacma | terrestre, territorial | kopjes de granit, escarpement | troupe de 6 à 12 | aboie l'alarme (tout le monde l'entend), intimide, mord si on insiste ; **vole la nourriture** laissée au sol et revient là où il en a trouvé | vue excellente | définitive ; reproduction |
| Éléphant | terrestre, neutre mais dangereux | vallée du Zambèze, miombo, savane | harde de 3 à 7 | migre entre l'eau et la forêt ; prévient (oreilles, barrissement), fait de fausses charges puis charge ; **renverse clôtures et murs** sur son passage | odorat très fin, ouïe ; vue faible | définitive ; reproduction très lente |
| Hyène tachetée | terrestre, prédatrice | savane, vallée, prairie | clan de 3 à 5, tanière fixe | **chasse en groupe** (encercle, mord par derrière, se relaie), charognarde, **suit les vautours et les traces de sang**, teste les joueurs blessés, ronge les portes en bois quand elle sent de la viande | odorat (traces), ouïe excellente | les individus meurent ; le clan se reforme à sa tanière |
| Léopard | terrestre, prédateur solitaire | kopjes, escarpement, miombo | seul, territoire autour d'un kopje | traque à couvert, **attaque sans prévenir**, par derrière ; renonce s'il est repéré et fixé du regard ; **mémorise les endroits où il a vu le joueur** et vient s'y poster | vue, ouïe | **mort définitive** ; un autre léopard reprend le territoire des jours plus tard |
| Crocodile du Nil | aquatique, prédateur | fleuves, lac, zones humides | seul | guette immobile près des rives, jaillit, mord, **entraîne sous l'eau** | perçoit les remous dans l'eau | définitive ; reproduction |
| Vautour | volant, charognard | partout | 2 à 6 | tourne au-dessus des carcasses, ce qui **attire les hyènes** (et le joueur) | vue | — |
| « Ce qui dort dans le lac » | **mystérieuse**, aquatique | eaux profondes du grand lac et du Zambèze | unique | rôde dans les profondeurs, attirée par la nage, les remous et le sang ; tourne autour, passe dessous, puis saisit et entraîne vers le fond | perçoit tout mouvement dans l'eau, le sang | **ne meurt pas** : blessée, elle disparaît et revient, changée |

Pour la créature du lac, je me suis inspiré de l'atmosphère des légendes de serpents de fleuve d'Afrique australe, **sans reprendre Nyami Nyami**, divinité protectrice du peuple tonga encore respectée aujourd'hui : en faire un monstre serait irrespectueux. La créature n'a pas de nom dans le jeu ; on la découvre par indices.

**Créatures souterraines :** elles arriveront avec les grottes (phase 9), qui n'existent pas encore.

### Détection : chaque espèce a ses sens

| Sens | Comment ça marche | Ce que le joueur peut faire |
| --- | --- | --- |
| Vue | Champ de vision et portée selon l'espèce ; il faut une ligne de vue (relief, arbres, murs) | S'accroupir, rester immobile, se cacher derrière un obstacle |
| Ouïe | Chaque action fait du bruit : marcher, courir, nager, frapper, abattre un arbre, objets qui tombent | Marcher accroupi, éviter de courir et de frapper près des animaux |
| Traces et odeur | Le joueur laisse une piste qui s'efface en quelques minutes ; le sang laisse une piste plus forte et plus longue | Soigner ses plaies (bander) ; traverser l'eau |
| Lumière et feu | La plupart des animaux craignent le feu (foyer, torche, forge) | Garder un feu au camp, une torche en main |
| Remous | Crocodile et créature du lac perçoivent la nage et les éclaboussures | Nager lentement, sortir de l'eau |
| Comportement du joueur | Fuir déclenche la poursuite ; faire face et fixer un prédateur le fait hésiter ; s'accroupir près d'un félin l'encourage ; un joueur blessé ou seul attire les hyènes | Faire face, reculer lentement, rester groupés (phase 8) |

### Combats

| Décision | Inspirée de | Pourquoi |
| --- | --- | --- |
| On frappe avec ce qu'on tient (« Utiliser ») : hache, couteau, lance, bâton à fouir, pierre, ou à mains nues. Durée du coup selon la masse et l'équilibre, coût en endurance, usure | The Forest, Green Hell | Les outils de la phase 4 ont déjà masse, portée, équilibre et durabilité |
| Dégâts selon la partie touchée : tête, cou, corps, arrière-train, pattes. Une patte touchée fait boiter ; une lame ou une pointe fait saigner (piste de sang) | Hunt: Showdown, Red Dead Redemption 2 | Réactions selon la partie touchée (5.4) |
| Objets lancés (pierres, lances) : dégâts selon leur masse et leur vitesse réelles | — | Combat physique et improvisé |
| Réactions : la proie fuit ; le blessé boite et s'affaiblit ; le phacochère et le babouin contre-attaquent ; la meute se replie si deux hyènes sont blessées ; le léopard renonce ; l'éléphant blessé charge | — | « Modifier sa stratégie » |
| Attaques des créatures : blessures localisées du corps du joueur (phase 3) : morsures aux jambes, coupures graves, fractures, chocs qui projettent | — | Les soins de la phase 3 deviennent indispensables |
| Le crocodile et la créature du lac **saisissent** : on est entraîné, le souffle baisse. On se libère en frappant (la tête de préférence) ou en se débattant (E à répétition) | — | Horreur sous-marine, sans mort sans recours |
| Carcasse : on la dépèce avec une lame (viande), elle pourrit en quelques heures ; la viande crue nourrit peu, cuite au foyer elle rend beaucoup de santé | Green Hell | La chasse sert à survivre |
| **Armes à feu : reportées à la phase 9.** Elles doivent être rares et se trouver dans les bâtiments abandonnés, qui arrivent en phase 9 | — | Sans lieux où les trouver, elles seraient soit absentes, soit trop faciles à obtenir |

### Pièges (construits avec les plans de la phase 5)

| Piège | Type | Matériaux | Effet |
| --- | --- | --- | --- |
| Collet | mécanique | 2 bâtons, une corde | Retient un animal moyen (impala, phacochère, babouin, hyène), qui se débat et peut casser le collet ; **le joueur aussi peut s'y prendre** |
| Assommoir | physique | 3 bâtons, une corde, une pierre de 20 kg | La pierre, vraie pièce physique, tombe quand on touche l'appât : elle blesse selon sa masse et sa vitesse |
| Fosse à pieux | environnemental | 6 bâtons, 4 brassées d'herbes ; bâton à fouir | Couverte d'herbes, invisible ; la créature (ou le joueur) qui marche dessus tombe sur les pieux et reste prise |
| Clôture d'épines (phase 5) | défense | — | Hyènes et léopards ne la franchissent pas ; l'éléphant passe au travers |
| Feu | défense | — | Les animaux gardent leurs distances |

### Écosystème et niveaux de simulation (14.5)

| Niveau | Où | Ce qui est simulé |
| --- | --- | --- |
| Populations | tout le monde (zones de 1 km) | Nombre d'animaux par espèce : naissances, prédation, migrations vers les zones plus riches, pression de chasse du joueur |
| Individus suivis | où qu'ils soient | Léopards, clans de hyènes, troupes de babouins, créature du lac : position, santé, mémoire des habitudes, sauvegardés |
| Créatures proches | moins de 260 m du joueur | Animaux réels : sens, décisions (10 fois par seconde), déplacements, combats ; collisions seulement très près |

- **Apparitions fixes :** tanières des clans, territoires des léopards, kopjes des babouins, créature du lac.
- **Apparitions dynamiques :** les hardes et familles proviennent de la population de la zone et y retournent quand on s'éloigne.
- **Évolution du comportement :** une espèce beaucoup chassée devient méfiante ; les prédateurs qui réussissent deviennent plus hardis.
- **Évolution physique :** les jeunes grandissent ; la créature du lac grossit chaque fois qu'elle se nourrit.

### Horreur

- **Sons spatialisés** fabriqués par le navigateur, sans fichiers audio : cris des hyènes, râle du léopard, barrissements, aboiements d'alarme, souffle du crocodile, pas lourds, coups, battements de cœur. Sous l'eau, sons étouffés et grondement sourd quand la créature approche. Réglage du volume. Le son était prévu « plus tard » : je l'avance, car sans lui la détection et l'horreur ne fonctionnent pas.
- **Ce qu'on ne voit pas :** frôlements dans les herbes, hyènes qui rôdent à la limite de la vue, léopard qui n'apparaît qu'au moment d'attaquer.
- **Sous l'eau :** une silhouette immense à la limite de la visibilité, l'obscurité des profondeurs (phase 2), un grondement, puis l'attaque par en dessous.

### Reporté (avec raison)

| Élément | Phase | Raison |
| --- | --- | --- |
| Armes à feu | 9 | À trouver dans les bâtiments abandonnés |
| Créatures souterraines | 9 | Avec les grottes |
| Nuit (prédateurs nocturnes) | 9 | Le cycle jour/nuit arrive avec la météo |
| Peaux et os (vêtements, outils) | 9 ou 10 | Avec l'équipement et les vêtements |
| Attaques entre joueurs, secours | 8 | Multijoueur |

## Difficultés techniques identifiées avant de commencer

| Difficulté | Solution prévue |
| --- | --- |
| Des centaines d'animaux sur 16 km × 16 km, sur téléphone | Trois niveaux de simulation (populations, individus suivis, créatures proches) ; au plus 24 créatures réelles sur téléphone, 40 sur ordinateur |
| Faire marcher des animaux sur un relief, autour des arbres et des murs, sans moteur de navigation | Déplacement sur la hauteur exacte du terrain ; évitement par rayons vers l'avant (arbres, rochers, murs) dans la zone physique ; pente et profondeur d'eau limites par espèce |
| Collisions joueur-animal, objets lancés | Collisionneur cinématique par créature proche ; trajectoire des objets lancés testée à chaque pas contre le corps des créatures (vitesse réelle avant le choc) |
| Localiser un coup | Corps de chaque espèce décrit par une capsule ; le point touché, dans le repère de l'animal, donne la partie (tête, corps, pattes) |
| Déterminisme (le serveur fera foi en phase 8) | Générateur pseudo-aléatoire rangé dans l'état, aucune dépendance au temps réel ni à l'affichage |
| Animer des animaux sans modèles 3D | Animaux faits de formes simples, pattes animées selon la vitesse (instances, peu d'appels de dessin) |
| Sons sans fichiers, sur téléphone | Synthèse Web Audio (oscillateurs, bruit filtré), spatialisation ; démarrage au premier appui (règle des navigateurs) ; nombre de voix limité |
| Ne pas rendre le jeu inutilement punitif (13.6) | Signes avant-coureurs (cris, alarmes des babouins, grondement sous l'eau), fuite possible (eau, kopjes, feu), possibilité de se libérer d'une prise |
