# Phase 8 — Multijoueur et sauvegardes

**Statut : en cours (commencée le 14/11/2026).** Ce document présente les décisions, les difficultés techniques identifiées avant de commencer et l'architecture retenue. Il sera complété au fil de la phase.

## Ce que demande le cahier des charges

- **Phase 8 (section 16) :** serveur local, connexion, synchronisation, permissions, sauvegardes, sécurité.
- **3.1 Hébergement :** le monde est hébergé sur l'ordinateur de l'hôte et ne tourne que pendant la session. Quand l'hôte arrête : le monde est sauvegardé, la simulation est en pause, rien ne continue en son absence, les joueurs reviennent quand il relance.
- **3.2 Connexion :** sans compte, avec un pseudonyme ; identifiant unique généré localement ; code permanent par monde ; le code suffit pour entrer. Protections contre les tentatives répétées et les accès non autorisés. Récupération d'identité en cas de changement d'appareil (clé de récupération exportable).
- **3.3 Sauvegardes :** automatiques, chez l'hôte, paramètres individuels conservés, trois sauvegardes de sécurité, protection contre les coupures et les corruptions, restauration possible.
- **3.4 Joueurs :** rôles et permissions personnalisables, attribuables individuellement, sans groupe obligatoire ; partage des objets, ressources et constructions selon les permissions ; gestion des accès aux installations.
- **3.5 Déconnexion :** le personnage reste soumis à des règles configurables (présence temporaire, protection éventuelle, possibilité d'être attaqué, sauvegarde de son état).
- **14.3 Réseau :** le serveur de l'hôte fait foi pour les déplacements critiques, inventaires, combats, dégâts, constructions, ressources, sauvegardes ; le client ne peut pas modifier librement le monde.
- **14.4 Sécurité :** le code d'accès est le seul mécanisme d'autorisation ; code long, tentatives limitées, communications chiffrées, données validées, sauvegardes protégées, connexions abusives limitées.
- **Joueurs :** 10 au maximum (décision du propriétaire du projet ; le cahier disait 6).

Le **programme compagnon** (démarrer le serveur hors du navigateur) est rangé par le cahier dans la phase 10 : il n'est pas fait ici, mais l'architecture le permet (le serveur est du code commun, sans affichage).

## Décisions

### Hébergement et réseau

| Décision | Pourquoi |
| --- | --- |
| Le serveur tourne **dans l'onglet de l'hôte**, qui joue en même temps. Il fait avancer le monde à 60 pas par seconde avec la même simulation que le jeu solo | Rien à installer ; l'hôte joue sans aucun délai ; même code que le solo, déjà testé |
| Liaison directe **WebRTC** entre chaque joueur et l'hôte, chiffrée (DTLS) | Seule solution pour qu'un site HTTPS joigne l'ordinateur d'un particulier derrière sa box, sans ouvrir de port |
| Deux canaux par joueur : **fiable** (actions, état du monde, messages) et **rapide** (commandes et positions : sans renvoi, une position périmée ne sert à rien) | Réactivité : un paquet perdu ne bloque pas les suivants |
| **Mise en relation** par des courtiers **MQTT publics et gratuits** (sur WebSocket sécurisé), plusieurs en parallèle (EMQX, HiveMQ, Mosquitto). Aucun compte, aucun serveur à payer | WebRTC a besoin d'un intermédiaire pour se présenter ; ces services sont gratuits, sans inscription, et l'un peut tomber sans bloquer les autres |
| Les messages de mise en relation sont **chiffrés** (AES-GCM) avec une clé dérivée du code du monde ; le sujet est une empreinte du code. **Le code ne circule jamais** | Le courtier public ne voit rien d'exploitable ; seuls ceux qui ont le code peuvent proposer une connexion |
| Serveur **STUN** public de Google pour traverser les box | Gratuit, sans inscription |
| Mode de test **sur un même ordinateur** (plusieurs onglets) par `BroadcastChannel` | Tests automatiques et essais sans réseau |

> **Compromis signalé — relais TURN.** Il n'existe pas de relais TURN gratuit sans inscription. Sans relais, la liaison directe échoue dans une minorité de cas (certaines connexions 4G/5G avec partage d'adresse, réseaux d'entreprise ou d'école). Le jeu le dit clairement, et un relais pourra être ajouté dans les réglages.

### Synchronisation (le serveur fait foi)

| Décision | Pourquoi |
| --- | --- |
| Le client envoie ses **commandes** (déplacement, regard, boutons) et ses **actions** (sac, fabrication, construction…) ; le serveur les valide et les applique | 14.3 : le client ne modifie rien lui-même |
| Le client **prédit** son propre déplacement avec la même simulation (même relief, mêmes constructions) et se **corrige** si le serveur diverge | Pas de délai ressenti sur ses propres pas |
| Le serveur envoie **20 fois par seconde** les positions des joueurs, des créatures, véhicules et objets en mouvement **proches** de chaque joueur | Débit raisonnable ; chacun ne reçoit que ce qu'il peut voir |
| L'état du monde (objets posés, constructions, ressources, véhicules) est envoyé **quand il change**, par blocs | Le relief et la végétation ne circulent jamais : ils découlent de la graine |
| Les autres joueurs sont **affichés avec un léger retard** (interpolation) | Mouvements fluides malgré le réseau |
| Aucun nom ni repère des autres joueurs au-delà de **15 m** | Principe du jeu : se retrouver doit rester difficile |

### Connexion, identité, sécurité

| Décision | Pourquoi |
| --- | --- |
| Code du monde : **16 caractères (80 bits)**, déjà en place | Impossible à deviner |
| À l'ouverture de la liaison, **preuve mutuelle** de connaissance du code (défi-réponse HMAC) ; le code lui-même n'est jamais envoyé | Un intrus sans code ne passe pas ; un faux hôte non plus |
| Chaque joueur a un **identifiant** et une **clé secrète** générés dans son navigateur. L'hôte retient l'empreinte de la clé ; au retour, le joueur prouve qu'il la possède | Personne ne peut se faire passer pour un autre et voler sa progression |
| **Clé de récupération** exportable (identifiant + clé secrète) à recopier sur un autre appareil | 3.2 : changement d'appareil |
| Tentatives limitées par pair et globalement ; rythme des messages limité ; chaque message validé avant usage | 14.4 |

### Permissions (3.4)

Proposition modifiable : chaque joueur a un **rôle**, et l'hôte peut ajuster chaque droit individuellement.

| Droit | Hôte | Membre | Invité |
| --- | --- | --- | --- |
| Construire et installer | oui | oui | non |
| Démonter ou modifier les constructions des autres | oui | non | non |
| Ouvrir les coffres et installations des autres (selon le réglage de l'installation) | oui | oui | non |
| Conduire les véhicules des autres | oui | oui | non |
| Frapper les autres joueurs | réglage du monde | réglage du monde | réglage du monde |
| Gérer les joueurs et les permissions | oui | non | non |

- Chaque construction, véhicule et coffre retient **qui l'a fait**. Son propriétaire choisit son accès : **privé**, **partagé** (selon les droits ci-dessus) ou **public**.
- Le premier joueur qui rejoint est **Membre** par défaut ; l'hôte peut changer le rôle par défaut.

### Déconnexion (3.5)

Réglages de l'hôte (par défaut entre parenthèses) :

- le personnage reste **endormi** à sa place pendant un temps (2 minutes), puis disparaît du monde jusqu'au retour du joueur (son état est sauvegardé) ;
- pendant ce temps il est **vulnérable** (créatures, autres joueurs), sauf s'il est **dans sa base**, près de ses constructions (protégé par défaut) ;
- s'il meurt pendant son absence, son corps et son sac restent sur place, comme pour une mort ordinaire.

### Sauvegardes (3.3)

| Décision | Pourquoi |
| --- | --- |
| Monde sauvegardé chez l'hôte dans **IndexedDB** : automatiquement toutes les 15 secondes et à la fermeture | Transactions atomiques : une coupure ne laisse jamais une sauvegarde à moitié écrite |
| La dernière sauvegarde + **trois de sécurité**, avec une **empreinte SHA-256** chacune ; une sauvegarde corrompue est ignorée au profit de la précédente | Protection contre les coupures et les corruptions (module déjà prêt et testé) |
| **Restauration** d'une sauvegarde précédente depuis l'écran du monde | 3.3 |
| Chaque joueur retrouve chez l'hôte son personnage (position, corps, sac, carnet) ; ses réglages (commandes, qualité) restent dans son propre navigateur | Paramètres individuels conservés |
| Le monde solo de l'hôte devient son monde partagé : rien n'est perdu | Préserver les sauvegardes existantes |

## Difficultés techniques identifiées

1. **La simulation est écrite pour un seul joueur** (4 400 lignes) : position, corps, sac, geste, conduite, objet tenu… Il faut séparer ce qui appartient à chaque joueur de ce qui appartient au monde, sans casser le solo ni ses 228 tests.
2. **La faune ne connaît qu'un joueur** : chaque créature doit choisir sa cible parmi plusieurs ; une prise (crocodile, « ombre ») doit savoir qui elle tient.
3. **Prédiction et physique** : le client simule ses pas sur sa copie du monde ; les objets poussés et les véhicules restent calculés par le serveur.
4. **Débit** : l'état complet du monde est trop gros pour être renvoyé souvent ; il faut n'envoyer que ce qui change et ce qui est proche.
5. **Liaison** : mise en relation par des services publics (indisponibles ponctuellement), pas de relais TURN gratuit.
6. **Tests** : deux navigateurs qui se parlent, avec la vraie mise en relation (un courtier MQTT local reproduit les courtiers publics).
7. **Hôte sur téléphone** : le serveur et l'affichage partagent le même processeur ; avec 10 joueurs, l'hôte a intérêt à jouer sur ordinateur (signalé).

## Architecture

```
 Joueur (navigateur)                                   Hôte (navigateur)
 ┌──────────────────────────────┐                      ┌──────────────────────────────────┐
 │ affichage 3D, commandes      │   canal rapide       │ serveur : simulation 60 Hz       │
 │ prédiction de ses pas        │ ── commandes ──────► │  (un emplacement par joueur,     │
 │ copie du monde (relief,      │ ◄── positions 20/s ─ │   un monde partagé)              │
 │  constructions, objets)      │   canal fiable       │ permissions, règles de           │
 │                              │ ── actions ────────► │  déconnexion                     │
 │                              │ ◄── monde, messages ─│ sauvegardes IndexedDB (+3)       │
 └──────────────────────────────┘   WebRTC chiffré     │ + son propre affichage (joueur)  │
              ▲                                        └──────────────────────────────────┘
              └──────── mise en relation : courtiers MQTT publics (messages chiffrés) ────┘
```

| Module | Rôle |
| --- | --- |
| `src/shared/simulation.ts` | Un **emplacement par joueur** (déplacement, corps, sac, geste, conduite, objet tenu) ; le monde avance une fois par pas |
| `src/shared/fauna.ts` | Chaque créature vise le joueur le plus proche ; prise rattachée à un joueur |
| `src/shared/net-crypto.ts` | Clés dérivées du code, chiffrement des messages de mise en relation, défi-réponse |
| `src/client/net/signaling.ts` | Mise en relation : courtiers MQTT, `BroadcastChannel` pour les tests |
| `src/client/net/peer.ts` | Liaison WebRTC, canaux fiable et rapide |
| `src/server/host.ts` | Serveur de l'hôte : accueil, permissions, réception des commandes, envoi des états |
| `src/client/net/client.ts` | Client distant : prédiction, réconciliation, interpolation |
| `src/server/save.ts`, `src/client/net/idb.ts` | Sauvegardes (déjà prêtes) et stockage IndexedDB |
