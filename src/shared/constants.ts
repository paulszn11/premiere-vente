// Constantes partagées par le client et le serveur.
// Toute valeur qui influence la simulation doit être identique des deux côtés.

export const GAME_NAME = 'Bienvenue au Zimbabwe';
export const GAME_VERSION = '0.1.0';

/** Version du protocole réseau. Un client et un serveur de versions différentes refusent de se parler. */
export const PROTOCOL_VERSION = 1;
/** Version du format de sauvegarde. */
export const SAVE_FORMAT_VERSION = 1;

/** Fréquence de simulation (pas fixe), côté serveur comme côté prédiction client. */
export const TICK_RATE = 60;
export const TICK_DT = 1 / TICK_RATE;
/** Le serveur envoie un instantané tous les N pas (60 / 3 = 20 instantanés par seconde). */
export const SNAPSHOT_INTERVAL_TICKS = 3;
export const MAX_PLAYERS = 6;

/** Taille d'un morceau (chunk) de terrain, en mètres. */
export const CHUNK_SIZE = 64;
/** Nombre de cellules de la grille physique par côté de chunk (1 cellule = 1 m). */
export const PHYS_CELLS = 64;
/** Rayon (en chunks) de terrain physique chargé autour de chaque joueur. */
export const PHYS_CHUNK_RADIUS = 1;
export const WATER_LEVEL = 0;
/** En dessous de cette altitude, le joueur est replacé au point d'apparition. */
export const KILL_Y = -120;

// Corps du joueur : capsule de 1,80 m.
export const PLAYER_RADIUS = 0.3;
export const PLAYER_HALF_HEIGHT = 0.6;
/** Hauteur du centre de la capsule au-dessus des pieds. */
export const PLAYER_CENTER_Y = PLAYER_HALF_HEIGHT + PLAYER_RADIUS;
export const EYE_HEIGHT = 1.62;

/** Paramètres de déplacement (phase 1 : marche, course, saut, inertie). */
export const MOVE = {
  walkSpeed: 1.8,
  runSpeed: 5.2,
  groundAccel: 9,
  groundDecel: 12,
  airAccel: 1.5,
  gravity: 9.81,
  jumpSpeed: 3.6,
  groundStick: 1,
  terminalSpeed: 55,
  maxSlopeClimbDeg: 45,
  minSlopeSlideDeg: 50,
  autostepHeight: 0.35,
  autostepMinWidth: 0.2,
  snapToGround: 0.35,
  controllerOffset: 0.02,
} as const;

/** Sauvegarde automatique du monde par l'hôte. */
export const AUTOSAVE_INTERVAL_MS = 15000;
/** Générations conservées : la dernière sauvegarde + 3 sauvegardes de sécurité. */
export const SAVE_GENERATIONS_KEPT = 4;

export const HEARTBEAT_INTERVAL_MS = 1000;
export const HEARTBEAT_TIMEOUT_MS = 6000;

/** Limitation des tentatives de connexion avec un mauvais code. */
export const JOIN_MAX_FAILURES = 5;
export const JOIN_FAILURE_WINDOW_MS = 60000;
export const JOIN_LOCKOUT_MS = 60000;
export const JOIN_GLOBAL_MAX_FAILURES = 30;
