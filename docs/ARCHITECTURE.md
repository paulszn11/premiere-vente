# Architecture et choix techniques

Ce document présente l'architecture retenue, les technologies et leurs raisons, les principes de conception, les compromis pour les appareils mobiles et les risques techniques. Il sera tenu à jour à chaque phase.

## 1. Vue d'ensemble

Le cahier des charges (§ 14.1) demande de séparer cinq blocs. Voici ce qui existe déjà et ce qui viendra :

| Bloc | Rôle | État |
| --- | --- | --- |
| Client web 3D | Affichage, commandes, interface, prédiction | Phase 1 : en place (jeu solo) |
| Serveur autoritaire chez l'hôte | Référence pour les déplacements, inventaires, combats, constructions, ressources | Phase 8. La simulation est déjà séparée de l'affichage (`src/shared/simulation.ts`) |
| Sauvegarde locale | Monde sauvegardé chez l'hôte, 3 sauvegardes de sécurité | Phase 8. Module préparé et testé (`src/server/save.ts`) |
| Synchronisation multijoueur | Échanges client ↔ serveur | Phase 8. Protocole, prédiction et limitation des tentatives préparés |
| Programme compagnon | Démarrer et gérer le serveur hors du navigateur | Phase 8 / 10 |

```
            Phase 1 (aujourd'hui)                         Phase 8 (cible)
 ┌────────────────────────────────────┐    ┌───────────────────────┐        ┌──────────────────────────────┐
 │ Navigateur du joueur               │    │ Navigateur du joueur  │ WebRTC │ Ordinateur de l'hôte          │
 │  commandes → simulation 60 Hz ──┐  │    │  commandes            │ ◄────► │  serveur autoritaire 60 Hz    │
 │  (Rapier, même code que         │  │    │  prédiction locale    │ chiffré│  (même simulation partagée)   │
 │   le futur serveur)             ▼  │    │  affichage 3D         │        │  sauvegardes + 3 de sécurité  │
 │  affichage 3D (Babylon.js) ◄─ état │    └───────────────────────┘        │  navigateur ou programme      │
 └────────────────────────────────────┘          ▲  mise en relation       │  compagnon                    │
                                                 └── (service gratuit) ────┴──────────────────────────────┘
```

### Modèle multijoueur retenu (précisé par le propriétaire du projet)

1. L'hôte lance le jeu sur son ordinateur et ouvre son monde : le serveur démarre chez lui (dans le navigateur ou avec le programme compagnon).
2. Les autres joueurs entrent le **code privé** du monde et rejoignent la même partie (10 joueurs au maximum).
3. Quand l'hôte quitte ou éteint son ordinateur, le monde s'arrête : tout le monde est déconnecté proprement, et le monde est sauvegardé chez l'hôte.
4. À la prochaine connexion de l'hôte, tout le monde retrouve le monde grâce aux sauvegardes : positions et progression de chaque joueur, objets déplacés, constructions…

### Le monde (phase 2)

Le monde mesure 16 km × 16 km, est inspiré du Zimbabwe et fermé par des montagnes frontalières (voir la carte dans `docs/PHASE-2.md`). Il est entièrement calculé à partir de la graine (`src/shared/geography.ts`) : le relief et les biomes ne se transmettent jamais sur le réseau. Seuls les changements du monde (objets déplacés, constructions…) devront l'être, et seront sauvegardés par l'hôte.

**Principe du jeu :** chaque joueur apparaît au hasard, à au moins 4 km des autres quand c'est possible. Aucune carte ne montre les autres joueurs : se retrouver est très difficile (`src/shared/spawn.ts`).

À 8 km de l'origine, la précision des nombres à virgule utilisés par la carte graphique et la physique reste de l'ordre du millimètre. Il n'y a donc pas de tremblement visible, et pas besoin de recentrer le monde autour du joueur.

## 2. Technologies retenues

| Domaine | Choix | Raisons | Alternatives écartées |
| --- | --- | --- | --- |
| Langage | **TypeScript** (mode strict) | Code commun client/serveur, erreurs détectées avant l'exécution | JavaScript seul (moins sûr sur un projet de cette taille) |
| Outils | **Vite 8** | Démarrage instantané en développement, build optimisé, gestion des workers et du WebAssembly | Webpack (plus lent, plus complexe) |
| Rendu 3D | **Babylon.js 9** | Moteur de jeu complet : WebGL 2 et WebGPU avec la même API, instances, niveaux de détail, audio spatial, outils de débogage, mesures de performance intégrées | Three.js : plus léger, mais beaucoup de briques à assembler soi-même (audio spatial, optimiseur, etc.) |
| Physique | **Rapier 0.21** (Rust compilé en WebAssembly) | Contrôleur de personnage (pentes, marches, accroche au sol), rapide, **fonctionne à l'identique dans le navigateur et dans Node** (donc côté serveur), instantanés du monde pour les sauvegardes, véhicules par lancer de rayons | Havok (lié à Babylon, moins adapté au serveur Node), Ammo.js (ancien, lent) |
| Moteur graphique | **WebGL 2 par défaut**, WebGPU en option | WebGL 2 est disponible partout ; WebGPU est plus récent et variable selon les appareils. Le test de performance permettra de décider appareil par appareil | WebGPU par défaut (trop de risques sur mobile aujourd'hui) |
| Installation | **PWA** : manifeste + service worker écrit à la main | Installable sur téléphone et ordinateur, mises à jour automatiques à chaque visite, démarrage rapide | vite-plugin-pwa (dépendance lourde pour un besoin simple) |
| Réseau (phase 8) | **WebRTC** (canaux de données chiffrés) | Seule solution réaliste pour qu'un site HTTPS joigne un ordinateur personnel derrière une box : connexion directe, chiffrée, mode « non fiable » adapté au jeu | WebSocket direct vers l'hôte (impossible sans certificat ni ouverture de port) |
| Mise en relation (phase 8) | Service gratuit à choisir en phase 8 | WebRTC exige un intermédiaire pour présenter les joueurs ; un relais (TURN) est parfois nécessaire. Les offres gratuites ont des limites, à vérifier le moment venu | — |
| Sauvegardes (phase 8) | IndexedDB (hôte dans le navigateur), fichiers (programme compagnon) | Transactions atomiques, empreinte SHA-256 de chaque sauvegarde | localStorage (trop petit, pas transactionnel) |
| Tests | **Vitest** (logique, dans Node) + **Playwright** (vrai navigateur) | La physique et la simulation sont testées sans affichage ; le jeu complet est testé dans Chromium | — |

### Taille du téléchargement

| Fichier | Taille | Compressé (gzip) |
| --- | --- | --- |
| Code du jeu + Babylon.js | 1,29 Mo | 302 Ko |
| Fil de calcul du terrain | 12 Ko | — |
| Moteur physique (WebAssembly) | 3,08 Mo | 1,19 Mo |

Le moteur physique est servi comme fichier `.wasm` séparé (et non intégré en texte base64, comme le fait le paquet « compat » de Rapier). C'est environ 30 % plus léger à télécharger, et le navigateur le compile pendant le téléchargement. Le service worker garde ensuite tout en mémoire locale.

## 3. Principes de conception

1. **Simulation à pas fixe, séparée de l'affichage.** Le monde avance par pas de 1/60 s, quelle que soit la fréquence d'affichage. L'image est interpolée entre deux pas. En phase 8, la même simulation tournera sur le serveur de l'hôte.
2. **Déterminisme.** Le relief, les arbres et le point d'apparition sont calculés à partir de la graine du monde avec des opérations qui donnent le même résultat au bit près sur tous les navigateurs (pas de `sin`, `cos`, `pow` dans la génération). Le monde n'a donc jamais besoin d'être transmis : seule la graine l'est. Un test vérifie que deux simulations identiques donnent des états identiques au bit près.
3. **Le sol affiché = le sol physique.** Les triangles du terrain affiché sont découpés exactement comme ceux du moteur physique (vérifié par un test automatique).
4. **Monde continu par morceaux (chunks) de 64 m**, chargés progressivement autour du joueur dans une limite de temps par image, avec plusieurs niveaux de détail et des « jupes » qui masquent les fissures entre morceaux.
5. **Physique détaillée seulement près du joueur** (3 × 3 chunks), comme le demande le § 14.5. Les objets déplaçables n'existent physiquement que dans cette zone ; ailleurs, seule leur position est mémorisée.
8. **Génération hors du fil principal.** Le terrain et la flore sont calculés dans un fil séparé (`terrain-worker.ts`). Les hauteurs physiques produites sont réutilisées par la simulation, ce qui évite les saccades sur téléphone.
6. **Qualité adaptative** : niveau choisi d'après l'appareil, puis résolution ajustée automatiquement si la fluidité baisse.
7. **Le client ne fait pas foi** (préparé pour la phase 8) : messages validés, commandes arrondies sur une grille fixe identique des deux côtés, rythme des commandes limité, tentatives de connexion limitées.

## 4. Compromis pour les appareils mobiles (signalés)

| Compromis | Raison | Réversible ? |
| --- | --- | --- |
| Graphismes simples (couleurs unies, pas d'ombres, pas de textures) | Demande explicite pour la phase 1 ; les graphismes viendront plus tard | Oui |
| Distance d'affichage réduite en qualité Basse (128 m) | Nombre de triangles et d'appels de dessin | Réglable |
| Résolution plafonnée (rapport de pixels 1 en Basse) | Les écrans de téléphone ont 3 à 4 fois plus de pixels que nécessaire pour un jeu | Réglable |
| Arbres affichés seulement à proximité en Basse | Coût de dessin ; les arbres proches restent toujours visibles car ils ont une collision | Réglable |
| WebGPU désactivé par défaut | Support encore inégal selon les téléphones | Option dans les réglages |
| Pas de plein écran ni de verrouillage en paysage sur iPhone | Limitation de Safari sur iPhone | Non (dépend d'Apple) |

## 5. Risques techniques

| Risque | Impact | Mesure prévue |
| --- | --- | --- |
| Performances des téléphones (puce graphique, chauffe, batterie) | Jeu saccadé ou injouable | Qualité adaptative, test de performance intégré, **tests sur vrais appareils à chaque phase** |
| Ampleur du cahier des charges | Fonctions inachevées présentées comme finies | Développement par phases, liste d'état honnête (`docs/ETAT.md`), rien n'est déclaré terminé sans test |
| Synchronisation de la physique en multijoueur | Décalages, téléportations | Serveur de référence + prédiction côté client + correction douce ; physique limitée autour des joueurs |
| Connexion chez l'hôte (box, pare-feu, HTTPS) | Les amis ne peuvent pas rejoindre | WebRTC + service de mise en relation + relais ; programme compagnon |
| Hébergement dans un onglet de navigateur | Un onglet en arrière-plan est ralenti par le navigateur | Programme compagnon recommandé pour héberger ; l'hôte « navigateur » reste possible |
| Sauvegardes dans le navigateur effaçables (nettoyage, manque de place) | Perte d'un monde | Demande de stockage persistant, export du monde, sauvegardes de sécurité, programme compagnon (fichiers) |
| Écarts de calcul entre navigateurs | Corrections fréquentes en multijoueur | Génération sans fonctions transcendantes, arrondi des commandes, correction par le serveur |
| Physique avancée (escalade, structures, véhicules) coûteuse | Chute de fluidité | Niveaux de simulation selon la distance et l'activité, objets physiques actifs limités |
| Dépendances qui évoluent vite (Babylon.js, Rapier) | Ruptures lors des mises à jour | Versions épinglées, mises à jour volontaires et testées |

## 6. Décisions encore ouvertes

Décisions prises depuis (12/11/2026) : biomes inspirés du Zimbabwe, monde de 16 km × 16 km, apparition au hasard loin des autres joueurs, 10 joueurs au maximum.

Conformément au § 15 du cahier des charges, aucune décision définitive n'a été prise sur : le catalogue des créatures, les matériaux, le commerce, les véhicules, la réapparition, la durée de conservation des corps, le secours médical, le partage des cartes, les rôles et permissions, la récupération d'identité, l'administration du serveur. Les valeurs actuelles (taille des chunks, vitesses de déplacement, hauteur de saut…) sont des réglages de prototype, modifiables.
