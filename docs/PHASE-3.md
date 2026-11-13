# Phase 3 — Survie et inventaire

**Statut : terminée le 13/11/2026 et vérifiée par les tests automatiques ({UNIT} tests unitaires, {E2E} vérifications dans le navigateur). Elle reste à essayer sur vos appareils.**

## Ce que demande le cahier des charges

- Besoins : santé, énergie, fatigue, blessures. **Pas de faim, pas de soif, pas de température corporelle.** La nourriture sert uniquement à restaurer la santé (7.3).
- Blessures localisées : fractures, saignements, handicaps, mobilité réduite, actions impossibles pendant un temps (8.4).
- Soins détaillés : matériel, gestes, traitements, durée, risques, conséquences d'un mauvais soin (8.5).
- Blessures graves : perdre connaissance, état critique, secours par un autre joueur, être porté ou traîné (8.6).
- Mort : réapparition à un emplacement défini ; l'ancien corps reste dans le monde avec son équipement (8.7).
- Inventaire physique : sac à dos, rangement, objets visibles et manipulables, poids et volume, objets à deux mains, poser, déplacer, traîner (7.2).
- Interface presque entièrement intégrée à l'univers : on consulte son sac, son corps, ses objets (13.4).
- Exigeant sans être inutilement punitif (13.6).

## Décisions (vous me les avez confiées le 13/11/2026)

Plusieurs points relèvent de la section 15 du cahier (« éléments encore à spécifier ») : système et emplacements de réapparition, durée de conservation des corps, conditions de secours. Vous m'avez demandé de les trancher moi-même en m'inspirant de jeux du même style, sans en copier un seul. Les voici, signalés comme demandé. Ils restent modifiables.

### Mort, secours et réapparition

| Décision | Inspirée de | Pourquoi |
| --- | --- | --- |
| À 0 de santé, on **perd connaissance** au lieu de mourir aussitôt | DayZ (inconscience), Grounded (« à terre »), PEAK (évanoui) | Laisse une chance, surtout à plusieurs |
| **Sans saignement**, on se réveille seul après environ 30 s, très affaibli | DayZ | Le jeu reste jouable seul, ce qui est le cas le plus fréquent puisque les joueurs sont dispersés |
| **Avec un saignement**, l'état devient **critique** : 90 s pour être secouru, sinon la mort | Grounded (moins d'une minute pour relever un joueur), PEAK (minuteur avant la mort) | Les blessures graves comptent vraiment |
| Un autre joueur peut **secourir** (bander la plaie, réveiller), **porter** ou **traîner** le blessé | Grounded, PEAK (porter un équipier), Lethal Company (ramener un corps) | Récompense le fait de s'être retrouvés (principe du jeu) |
| On peut **abandonner** pour mourir tout de suite quand personne ne peut venir | Grounded | Évite d'attendre 90 s pour rien |
| Une chute mortelle tue sur le coup ; on peut aussi se noyer | — | Réalisme demandé (7.6, 7.7) |
| **Réapparition** à l'endroit où l'on a **dormi** en dernier (au moins une minute de sommeil), sinon à son **point d'arrivée** dans le monde | Lit de Minecraft et de Valheim, sac de couchage de Rust, abri de Grounded | « Emplacement défini » (8.7) ; jamais près des autres par défaut. Si un groupe dort au même endroit, il réapparaît ensemble |
| Avec la construction (phase 5), un lit ou un abri pourra servir de point de réapparition | Minecraft, Valheim, Grounded, Raft | À préciser en phase 5 |
| On réapparaît avec ses vêtements, **sans sac** ni objets : tout est resté sur le corps | Grounded (sac laissé sur place), Valheim (tombe), DayZ | Donne une vraie raison de retourner chercher son corps, sans tout perdre |
| À la réapparition, on se **souvient** de la direction et de la distance approximatives du corps (à 100 m près) | Boussole de récupération de Minecraft, repère du sac dans Grounded | Retrouver son corps reste une expédition, sans marqueur permanent à l'écran |
| Rien ne se perd en dehors des objets portés (pas encore d'expérience ni de compétences ; à revoir quand elles arriveront) | Valheim (perte de compétences) | Pas de punition supplémentaire pour l'instant |

### Le corps

| Décision | Inspirée de | Pourquoi |
| --- | --- | --- |
| Le corps reste dans le monde avec tout son équipement **jusqu'à ce qu'il soit entièrement vidé**, sans limite de temps | Tombes de Valheim (n'expirent jamais), sacs de Grounded (plusieurs peuvent s'accumuler) | Le monde fait 256 km² : un délai comme les 5 minutes de Minecraft serait injouable |
| Une fois vidé, il disparaît au bout de 10 minutes | — | Évite d'encombrer le monde |
| Tout le monde peut le fouiller (les permissions de la phase 8 pourront le restreindre) | Valheim, DayZ, Rust | Simple et cohérent avec un monde partagé |
| C'est un objet physique de 70 kg : on peut le traîner | Lethal Company (ramener les corps au vaisseau), R.E.P.O. | « Être porté ou traîné » (8.6) |
| Plus tard (phase 9), il se décomposera peu à peu (ambiance d'horreur) | Content Warning, Lethal Company | Ambiance |

### Santé, énergie, fatigue

| Décision | Inspirée de | Pourquoi |
| --- | --- | --- |
| **Santé** : elle ne remonte pas seule à l'état de veille ; elle remonte en **mangeant** (sur quelques secondes, jusqu'à 3 aliments en digestion à la fois) et un peu en dormant | Valheim (3 aliments à la fois, régénération par la nourriture), Minecraft | Cahier : la nourriture sert uniquement à restaurer la santé |
| **Énergie** : réserve qui fixe le **maximum de l'endurance**. L'effort prolongé (course, escalade, nage, charges lourdes) la consomme ; le repos et le sommeil la rendent. La nourriture n'y touche pas | Death Stranding (l'endurance maximale baisse avec l'effort, on récupère en se reposant), PEAK (une seule barre réduite par les problèmes) | Énergie sans faim, comme l'exige le cahier |
| **Fatigue** : besoin de sommeil qui monte avec le temps éveillé (environ 3 h de jeu). Fatigué : énergie maximale réduite, paupières lourdes, puis micro-sommeils. À bout de fatigue, on s'endort sur place | Project Zomboid, PEAK (somnolence) | Fatigue distincte de l'endurance |
| **Dormir** prend environ 3 minutes de jeu réel, sans accélérer le temps pour les autres. On est vulnérable pendant ce temps | Project Zomboid en multijoueur (le temps n'accélère que si tout le monde dort) | Compatible avec 10 joueurs dispersés |
| Une seule barre à l'écran (temporaire) : l'endurance, avec en plus sombre la part rendue indisponible par l'énergie, la fatigue et les blessures | PEAK | Lisible, y compris sur téléphone |
| La santé basse se voit à l'écran (bords rouges, saignement), le détail se lit en **examinant son corps** | Green Hell (examen du corps), Content Warning | Interface intégrée à l'univers (13.4) |

### Blessures et soins

| Décision | Inspirée de | Pourquoi |
| --- | --- | --- |
| 6 zones : tête, torse, bras gauche et droit, jambes gauche et droite | DayZ, Project Zomboid, Green Hell | Dégâts localisés (8.4) |
| Blessures : contusion, entorse, fracture, coupure (saignement léger ou grave), commotion | DayZ, Green Hell, The Long Dark | Fractures, saignements, handicaps (8.4) |
| Jambe cassée : on boite, sans courir, sauter ni grimper ; bouger sans attelle provoque un choc qui peut faire perdre connaissance | DayZ | Mobilité réduite, actions impossibles (8.4) |
| Bras cassé : pas d'escalade, pas d'objet à deux mains, pas de lancer | — | Actions impossibles (8.4) |
| **Chiffons** obtenus en **déchirant ses vêtements** ; un chiffon arrête un saignement | DayZ | Matériel disponible dès le début |
| **Attelle** : 2 bâtons + 2 chiffons. Sans attelle, une fracture ne guérit pas | DayZ (attelle : bâtons + chiffons, environ 30 min de guérison) | Gestes et durée (8.5) |
| **Aloès**, une plante des kopjes de granit, désinfecte et calme la douleur | Pansements naturels de Green Hell ; aloès réels du Zimbabwe | Ancré dans l'univers |
| Une plaie bandée sans désinfecter peut s'**infecter** quelques minutes plus tard (fièvre : santé et énergie baissent) | Green Hell | Conséquences d'un mauvais soin (8.5) |
| Chaque soin est un **geste** qui prend quelques secondes ; bouger l'interrompt | Green Hell, DayZ | Gestes (8.5) |
| Le matériel médical fabriqué (pansements propres, désinfectant, remèdes) arrive avec la fabrication | — | Phase 4 |

### Sac à dos et objets

| Décision | Inspirée de | Pourquoi |
| --- | --- | --- |
| Ouvrir son sac : le personnage s'accroupit et le sac s'ouvre devant lui, avec les objets visibles en 3D | Sons of the Forest (sac posé sur une toile), Green Hell | Inventaire physique et immersif (7.2) |
| Le sac a un **volume** (30 litres) et chaque objet un poids et un volume | DayZ, Project Zomboid | Poids et volume (7.2) |
| **4 poches** pour les petits objets, accessibles sans ouvrir le sac | Lethal Company, Content Warning, PEAK (peu d'emplacements) | Accès rapide en urgence (saignement) |
| Le poids porté ralentit et fatigue ; au-delà de 25 kg, plus de course | Death Stranding, Project Zomboid | Effet physique de la charge |
| On peut **poser son sac** pour grimper ou nager plus léger ; un sac posé est un objet du monde que d'autres peuvent ouvrir ou emporter | PEAK | Choix intéressants, objets visibles et manipulables |
| Les gros objets (bûches, troncs) ne rentrent pas dans le sac : on les porte ou on les traîne (déjà fait) | — | 7.2 |
| Fruits du pays : fruit du baobab, figue sauvage, muhacha (prune du miombo) | Le Zimbabwe réel | Nourriture qui restaure la santé |
| Ramasser un petit objet le range directement (poche, puis sac) | Minecraft, Raft | Rapide, surtout au doigt |

### Appareils

Il y aura des joueurs sur ordinateur, sur téléphone et sur tablette. Tout ce qui est ajouté se joue donc au doigt, à la souris et à la manette :
- gros boutons ;
- aucun glisser-déposer obligatoire : on touche un objet, puis une action ;
- navigation à la manette dans le sac.

### Pour plus tard (inspirations notées, rien n'est encore décidé)

- **Se retrouver** (principe du jeu, à préparer pour la phase 8) : voix de proximité et voix qui porte quand on crie, sifflet, feux et fumée visibles de loin, cartes que l'on dessine et que l'on peut donner à quelqu'un. La section 15 laisse ouvert le partage des cartes et des marqueurs. Inspiration : Big Walk, sorti en août 2026, où perdre le contact avec les autres fait partie des énigmes.

## Ce qui a été fait

| Domaine | Contenu |
| --- | --- |
| Objets du monde | Bâtons (bois mort au pied des arbres), fruits du baobab, figues sauvages près de l'eau, muhachas dans le miombo, aloès sur les kopjes et les sols rocheux. Leur emplacement est déterministe ; un objet ramassé ne réapparaît pas |
| Ramasser | « Prendre » sur un petit objet le range directement : en poche, sinon dans le sac, sinon en main. Les pierres se prennent toujours en main, pour être lancées |
| Sac et poches | 4 poches pour les petits objets (1 litre chacune), sac de 30 litres. Chaque objet a un poids et un volume. On peut sortir un objet en main, le ranger, le déplacer entre poches et sac, le poser au sol, poser son sac ou en mettre un autre sur son dos |
| Vue du sac | Le personnage s'agenouille et le contenu apparaît en 3D sur une toile : poches, sac, main, et le corps ou le sac posé que l'on fouille. On touche un objet, puis une action. Le monde continue pendant ce temps |
| Charge | Au-delà de 10 kg portés, on va moins vite et l'effort coûte plus d'endurance. Au-delà de 25 kg, on ne court plus ; au-delà de 35 kg, on ne saute plus. Un sac lourd fait couler à la nage |
| Santé | Elle baisse avec les chutes, les saignements, la noyade et la fièvre, et ne remonte qu'en mangeant (et un peu en dormant) |
| Nourriture | Fruit du baobab : +20 en 40 s. Figue : +5 en 12 s. Muhacha : +7 en 15 s. Au plus 3 aliments en digestion à la fois. Manger est un geste de 1,5 à 3 s |
| Énergie | L'effort la consomme. Elle fixe l'endurance maximale : la partie hachurée de la barre montre ce qui n'est plus disponible. On la retrouve en s'asseyant (R) ou en dormant |
| Fatigue | Elle monte en environ 3 h de jeu. Au-delà de 50, l'énergie maximale baisse ; au-delà de 85, la vision se trouble ; au-delà de 90, viennent des micro-sommeils. À 100, on s'endort sur place |
| Sommeil | Maintenir R (au doigt : « Sac », onglet « Corps », « Dormir »). Cela dure environ 3 minutes réelles, sans accélérer le temps. Bouger réveille (au doigt : bouton « Se réveiller »). Après une minute de sommeil, l'endroit devient le point de réapparition |
| Blessures | Six zones du corps. Contusions, entorses, fractures, coupures légères ou profondes, commotions. Les chutes graves en provoquent selon la hauteur, le sol, la posture et les blessures déjà présentes |
| Effets | Jambe cassée : on boite, sans courir, sauter ni grimper, et marcher sans attelle provoque un choc puis une perte de connaissance. Bras cassé : pas d'escalade, pas d'objet à deux mains, pas de lancer. Entorse : on boite un peu. La douleur et la fièvre réduisent l'endurance |
| Soins | Chiffons, en déchirant sa chemise ou son pantalon : un chiffon arrête un saignement ou maintient une entorse. Attelle : 2 bâtons et 2 chiffons. Aloès : désinfecte et calme la douleur. Chaque soin est un geste de 3 à 8 s, que bouger interrompt |
| Infections | Une plaie bandée sans être désinfectée peut s'infecter quelques minutes plus tard : fièvre, perte de santé et d'énergie. L'aloès la guérit |
| Examen du corps | Silhouette colorée (saigne, fracture, entorse, contusion, infectée, soignée), jauges de santé, d'énergie et de fatigue, niveau de douleur, détail de chaque zone et soins possibles avec le matériel disponible |
| Perte de connaissance | À 0 de santé sans saignement : réveil seul au bout de 30 s, avec 10 de santé. Avec un saignement : état critique, 90 s avant la mort. On peut abandonner avec un bouton, ou en maintenant « Prendre » 2 s au clavier et à la manette. Inconscient dans l'eau : noyade |
| Secours (pour la phase 8) | Un autre joueur pourra bander la plaie et relever le blessé, ou traîner son corps. La règle est écrite et testée ; elle sera branchée avec le multijoueur |
| Mort | Chute mortelle, noyade, hémorragie, infection ou abandon. On voit son corps de l'extérieur, puis on se réveille 5 s plus tard |
| Corps | Il reste avec le sac et les poches jusqu'à ce qu'il soit vidé. Il est sauvegardé ; on peut le fouiller, tout reprendre, remettre son sac sur son dos, ou le traîner |
| Réapparition | Au dernier endroit où l'on a dormi au moins une minute, sinon au point d'arrivée. On repart sans sac, avec 70 de santé, et on se souvient de la direction et de la distance du corps |
| Sauvegarde | La partie solo est enregistrée dans le navigateur : position, corps, sac, objets ramassés, déplacés ou posés, et corps laissés. L'ancienne sauvegarde de position de la phase 2 est reprise |

## Commandes ajoutées

| Action | Clavier / souris | Manette | Tactile |
| --- | --- | --- | --- |
| Ramasser · fouiller un corps · ouvrir un sac posé | E | X / Carré | « Prendre » |
| Utiliser l'objet en main (manger, bander, attelle, aloès) | Clic droit ou F | LT / L2 | « Utiliser » |
| Sac et examen du corps | Tab ou I | Y / Triangle | « Sac » |
| S'asseoir · se lever (appui court) · dormir (maintenir) | R | LB / L1 | Dans le sac, onglet « Corps » |
| Poches 1 à 4 : prendre en main ou y ranger l'objet tenu | 1 à 4 | RB / R1 (poche suivante) | Dans le sac |
| Dans le sac : choisir, agir, fermer | Souris, flèches, E, Tab ou Échap | Stick, A, X, B | Toucher, « Fermer » |

Sur petit écran, le sac a deux onglets, « Sac » et « Corps ».

## Tests automatiques

| Suite | Résultat |
| --- | --- |
| `npm test` (Vitest) : inventaire (poches, sac, volume, pierres, vêtements, lecture des sauvegardes), objets du monde, énergie, fatigue, sommeil, nourriture, saignements, caillots, fractures, attelles, choc, bras cassé, infections, chutes, perte de connaissance, état critique, secours, noyade ; simulation complète : ramasser, ranger, poches, déchirer, charge, manger, bander, attelle, repos, sommeil, mort, corps, réapparition, fouille, corps vidé qui disparaît, chute et noyade mortelles, sauvegarde | **{UNIT} / {UNIT}** (dont 50 pour la phase 3) |
| `npm run test:e2e -- --webgpu` (Chromium) : phases 1 et 2, et la phase 3 sur ordinateur, téléphone et manette (35 vérifications) | **{E2E} / {E2E}** |

Le scénario « phase 3 » joue dans le navigateur :
- ramasser une figue, un bâton et un fruit ;
- ouvrir le sac, choisir un objet au clic, manger ;
- déchirer la chemise, bander une coupure depuis l'examen du corps ;
- boiter avec une jambe cassée, puis poser l'attelle avec « Utiliser » ;
- s'asseoir, dormir et se réveiller ;
- subir une chute de 16 m ;
- atteindre l'état critique, abandonner, mourir, réapparaître, retrouver son corps et tout reprendre ;
- quitter puis recharger la partie ;
- au doigt : « Sac », onglets, « Utiliser », « Se réveiller » ;
- à la manette : Y, stick, A, B, et maintenir X pour abandonner.

### Problèmes trouvés par les tests et corrigés

- **Les appuis très brefs étaient perdus.** Une touche ou un bouton tactile pressé puis relâché entre deux images n'était pas vu. Sur un appareil lent, cela pouvait arriver à un vrai joueur. Ils sont maintenant toujours pris en compte.
- **Les boutons de soins se recréaient à chaque image** pendant qu'une plaie saignait, ce qui pouvait faire rater un clic ou un toucher. Ils ne changent plus que lorsque leur liste change.
- **Le curseur restait capturé quand on était à terre :** impossible de cliquer « Abandonner ». Il est libéré dès qu'on perd connaissance.
- **À la manette, le stick sautait parfois deux cases** et X déclenchait deux actions. La répétition est plus lente au départ, et chaque bouton a un seul rôle.
- **Fermer le sac à la manette pendant une image provoquait une erreur.** C'est corrigé.
- **Au doigt, les écrans « à terre » et « sommeil » étaient sous la couche des commandes tactiles :** impossible de toucher « Abandonner » ou « Se réveiller ». Ils sont maintenant au-dessus, et l'écran de sommeil a un bouton « Se réveiller », car il couvre le joystick.
- **À la manette, on ne pouvait pas abandonner.** Il suffit maintenant de maintenir X (ou E au clavier) 2 secondes.
- **Vue à la mort :** la caméra se trouvait dans le corps. Elle se place maintenant au-dessus.
- **Sur téléphone, des étiquettes du sac restaient affichées dans l'onglet « Corps ».** C'est corrigé.
- **Les tests navigateur laissaient un serveur ouvert** après chaque exécution. Il est maintenant bien arrêté.

## Limites et compromis (signalés)

- **Vue du sac :** objets en 3D sur une toile vue de dessus, avec des boutons d'action. On ne manipule pas encore les objets à la main dans la scène, comme dans Sons of the Forest : ce sera repris avec les graphismes soignés.
- **Examen du corps :** silhouette dessinée, et non vue de ses propres bras et jambes comme dans Green Hell.
- **Secours, porter un blessé :** la règle existe (`rescue` dans `vitals.ts`) et on peut traîner un corps. Mais secourir quelqu'un demande un autre joueur : ce sera branché et testé en phase 8.
- **Matériel médical :** chiffons de vêtements, bâtons et aloès seulement. Pansements propres, désinfectant, remèdes et outils viendront avec la fabrication (phase 4). Les vêtements déchirés ne se remplacent pas encore, sauf à la réapparition.
- **Sommeil :** sans cycle jour et nuit (phase 9) ni abri (phase 5), on peut dormir partout. Les dangers de la nuit viendront avec les créatures (phase 6).
- **Corps :** pas encore de décomposition visible (phase 9). Tout le monde peut le fouiller (permissions en phase 8).
- **Interface temporaire :** la barre d'endurance, les bords rouges et les messages seront remplacés par une interface intégrée à l'univers (respiration, battements de cœur, gestes visibles).
- **Graphismes simples :** les objets sont des formes de couleur unie, comme le reste du prototype.

## À vérifier sur vos appareils

1. **Une partie :**
   - ramasser des fruits au pied d'un baobab (lowveld, vallée) ou d'un figuier (près du fleuve) ;
   - ramasser des bâtons sous les arbres et de l'aloès sur les kopjes.
2. **Le sac :**
   - Tab sur ordinateur, Y à la manette, « Sac » au doigt ;
   - manger un fruit ;
   - déchirer sa chemise ;
   - poser son sac.
3. **Les blessures :**
   - sauter d'un kopje (Réglages → Outils de test → paroi de granit) et regarder l'examen du corps ;
   - bander, poser une attelle.
4. **La mort :**
   - se laisser mourir (par exemple en restant sous l'eau au lac) ;
   - vérifier la réapparition et le message qui indique où est le corps ;
   - retourner fouiller le corps.
5. **Le sommeil :** maintenir R (ou « Sac » → « Corps » → « Dormir ») pendant une minute, puis vérifier qu'on réapparaît là en cas de mort.

## Sources consultées

- Grounded 2 : [mort, sac et réapparition](https://primagames.com/?p=351726), [joueurs à terre](https://game8.co/games/Grounded-2/archives/539777)
- Raft : [réapparition](https://raft.gamepedia.com/Respawn)
- Content Warning : [réanimer un joueur](https://dexerto.com/gaming/content-warning-how-to-revive-other-players-2629008)
- Big Walk : [présentation](https://engadget.com/2190596/big-walk-is-an-oddball-blend-of-peak-and-escape-academy-and-its-out-august-4), [multijoueur et voix](https://www.player.one/big-walk-multiplayer-guide-crossplay-player-limits-voice-chat-explained-163936)
- PEAK : [évanouissement et secours](https://www.pcgamer.com/games/sim/peak-how-to-revive-heal), [règles du jeu](https://peak.wiki.gg/wiki/How_to_play)
- Valheim : [mort et tombe](https://gamepressure.com/valheim/death-how-to-recover-items/zee2af)
- DayZ : [soins](https://xgamingserver.com/blog/dayz-medical-system-how-to-heal/), [attelle](https://dayz.fandom.com/wiki/Splint)
- Green Hell : [soins et infections](https://Techraptor.net/gaming/guides/green-hell-medicine-and-healing-guide)
- R.E.P.O. : [réanimer](https://www.pcgamer.com/games/horror/repo-how-to-heal-and-revive/)
- Sons of the Forest : [inventaire sur une toile](https://www.g-portal.com/wiki/en/basics-of-the-sons-of-the-forest-inventory)
- Minecraft : [boussole de récupération](https://www.minecraft.net/pt-br/article/taking-inventory--recovery-compass)
- Lethal Company : [ramener les corps](https://primagames.com/?p=324165)
- Death Stranding : [endurance](https://samurai-gamers.com/death-stranding/status-gauge-guide/)
- Project Zomboid : [sommeil en multijoueur](https://supercraft.host/wiki/project-zomboid/server-sleeping)
