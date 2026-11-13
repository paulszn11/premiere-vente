// Constantes partagées par le client et le serveur.
// Toute valeur qui influence la simulation doit être identique des deux côtés.

export const GAME_NAME = 'Bienvenue au Zimbabwe';
export const GAME_VERSION = '0.4.0';

/** Version du protocole réseau. Un client et un serveur de versions différentes refusent de se parler. */
export const PROTOCOL_VERSION = 1;
/** Version du format de sauvegarde. */
export const SAVE_FORMAT_VERSION = 1;

/** Fréquence de simulation (pas fixe), côté serveur comme côté prédiction client. */
export const TICK_RATE = 60;
export const TICK_DT = 1 / TICK_RATE;
/** Le serveur envoie un instantané tous les N pas (60 / 3 = 20 instantanés par seconde). */
export const SNAPSHOT_INTERVAL_TICKS = 3;
/** Décision du 12/11/2026 : 10 joueurs au maximum (le cahier des charges initial disait 6). */
export const MAX_PLAYERS = 10;

/** Monde de 16 km × 16 km centré sur l'origine (x vers l'est, z vers le nord). */
export const WORLD_SIZE = 16000;
export const WORLD_HALF = WORLD_SIZE / 2;

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
/** Accroupi : capsule de 1,10 m, yeux à 1,0 m. */
export const PLAYER_CROUCH_HALF_HEIGHT = 0.25;
export const EYE_HEIGHT_CROUCH = 1.0;

/** Paramètres de déplacement (phase 1 : marche, course, saut, inertie). */
export const MOVE = {
  walkSpeed: 1.8,
  runSpeed: 5.2,
  groundAccel: 9,
  groundDecel: 12,
  airAccel: 1.5,
  gravity: 9.81,
  jumpSpeed: 3.6,
  groundStick: 0,
  terminalSpeed: 55,
  maxSlopeClimbDeg: 45,
  minSlopeSlideDeg: 50,
  autostepHeight: 0.35,
  autostepMinWidth: 0.2,
  snapToGround: 0.35,
  controllerOffset: 0.02,
  crouchSpeed: 0.9,
  /** Portage à deux mains : vitesse réduite, ni course ni saut. */
  heavyCarrySpeed: 1.1,
  dragSpeed: 0.7,
} as const;

/** Endurance (0 à 100) : course, nage, escalade. La fatigue de fond arrive en phase 3. */
export const STAMINA = {
  max: 100,
  sprintDrain: 11,
  jumpCost: 6,
  /** Rester accroché immobile coûte peu ; grimper coûte davantage. */
  climbDrain: 3,
  climbMoveDrain: 6,
  swimDrain: 1.5,
  fastSwimDrain: 9,
  heavyCarryDrain: 2,
  regen: 14,
  regenDelay: 0.8,
  /** Épuisé : plus de course tant que l'endurance n'est pas remontée à ce seuil. */
  recoverAt: 25,
} as const;

/** Nage et plongée. */
export const SWIM = {
  /** Profondeur d'eau (sous les pieds) à partir de laquelle on nage. */
  startDepth: 1.25,
  /** On reprend pied en dessous de cette profondeur si on touche le fond. */
  stopDepth: 1.05,
  /** Position des pieds sous la surface quand on flotte (yeux juste au-dessus de l'eau). */
  floatDepth: 1.45,
  speed: 1.1,
  fastSpeed: 1.8,
  exhaustedSpeed: 0.6,
  verticalSpeed: 0.9,
  accel: 2.5,
  /** Souffle : 30 s sous l'eau, récupération en 4 s. */
  breathSeconds: 30,
  breathRegen: 25,
  wadeStart: 0.35,
} as const;

/** Escalade des parois rocheuses. */
export const CLIMB = {
  /** Toute surface trop raide pour marcher (plus de 44° : roche) s'escalade. */
  maxNormalY: 0.72,
  reach: 0.75,
  speed: 0.7,
  minStamina: 10,
  mantleHeight: 1.3,
} as const;

/** Chutes : vitesse d'impact (m/s) et conséquences (les blessures arrivent en phase 3). */
export const FALL = {
  stumble: 7,
  light: 10,
  heavy: 13,
  lethal: 18,
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
