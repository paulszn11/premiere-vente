# Phase 3 — Survie et inventaire

**Statut : en cours (commencée le 13/11/2026).**

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
