// Simulation du monde à pas fixe (60 pas par seconde), séparée de l'affichage.
// Phase 3 : un seul joueur, simulation dans la page, avec son corps (santé, énergie, fatigue,
// blessures, soins), son inventaire, la mort, le corps laissé dans le monde et la réapparition.
// En phase 8, cette même logique tournera sur le serveur de l'hôte et le client prédira.

import type { ActionResult, BuildRef, FurnaceOp, HandOrSlot, PieceOp, PlayerAction } from './actions';
import {
  type BuildTarget,
  BuildState,
  type Need,
  PLANS,
  PLACE_REACH,
  type PlanId,
  type PlanStep,
  SITE_RADIUS,
  type InstallSite,
  combustible,
  damageFor,
  floorUnder,
  isDone,
  maxHp,
  needLabel,
  pieceBoxes,
  pieceTransform,
  plansFrom,
  rayBuild,
  repairNeeds,
  salvage,
  stepsOf,
} from './building';
import { EYE_HEIGHT, EYE_HEIGHT_CROUCH, KILL_Y, PHYS_CHUNK_RADIUS, STAMINA, TICK_DT, WATER_LEVEL } from './constants';
import {
  type ImproveKind,
  type Knowledge,
  RECIPES,
  type RecipeId,
  type RepairKind,
  applyImprove,
  applyRepair,
  canDismantle,
  craftQuality,
  dismantle,
  ensureToolMeta,
  experimentHint,
  hintFrom,
  hintRecipe,
  improveOptions,
  learn,
  makeKnowledge,
  matchRecipe,
  maxDurability,
  readKnowledge,
  repairOptions,
  skillLevel,
  stepToolOk,
  toolPower,
  wear,
} from './crafting';
import { type BodyPart, PART_LABELS, SPECIES, type SpeciesId, speciesName } from './creatures';
import { Fauna, type FaunaEnv, type FaunaEvent, type FaunaPlayer, type FaunaSave, type SoundKind } from './fauna';
import { PropSystem, type PropTarget, REACH, type TreeTarget, lookDirection } from './interaction';
import {
  CLOTHING_LABELS,
  type Container,
  type Inventory,
  type ItemStack,
  POCKET_MAX_L,
  RAGS_PER_PART,
  BENCH_SLOTS,
  FX_LIGATURE_LACHE,
  FX_MANCHE_FENDU,
  addToBag,
  addToPockets,
  carriedMass,
  consume,
  countOf,
  isEmpty,
  makeInventory,
  readInventory,
  stackAt,
  stackVolume,
  store,
  takeAt,
  tearClothing,
  unitVolume,
  metaOf,
} from './inventory';
import { ITEMS, type ItemId, MASS_ITEMS, type ToolTag, hasTag, itemName } from './items';
import {
  BTN_CROUCH,
  BTN_INTERACT,
  BTN_JUMP,
  MODE_CLIMB,
  type InputCmd,
  MODE_SWIM,
  MODE_WALK,
  type MoveState,
  R_NO_CLIMB,
  R_NO_HEAVY,
  R_NO_JUMP,
  R_NO_SPRINT,
  R_NO_THROW,
  copyState,
  makeState,
  quantizeInput,
  stepMovement,
} from './movement';
import { GROUP_OBSTACLE, GROUP_TERRAIN, type HeightProvider, PhysicsWorld, QUERY_TERRAIN, RAPIER, initPhysics, interactionGroups } from './physics';
import { IMPACT_THRESHOLD, StructurePhysics } from './structure-physics';
import { type FireState, type InstallPropKind, ITEM_OF_PROP, type PropDef, type PropKind, QUICK_PICK, TRAP_KINDS, itemShape, propWithArticle } from './props';
import { NODE_SPECS, type NodeKind, type TreePart, WorldState, treeKey, treeSpec } from './resources';
import { type SpawnPoint, chooseSpawn, findSpawnNear } from './spawn';
import { Terrain, chunkCoord } from './terrain';
import {
  type DeathCause,
  type InjuryKind,
  TREATMENT_LABELS,
  type Treatment,
  VITALS,
  type VitalEvent,
  type Vitals,
  ZONE_LABELS,
  type Zone,
  addInjury,
  applyFall,
  applyTreatment,
  bleedRate,
  canTreatSelf,
  damage,
  die,
  isLeg,
  knockOut,
  eat,
  fallAsleep,
  limits,
  makeVitals,
  rand,
  readVitals,
  sitDown,
  standUp,
  tickVitals,
  totalBleeding,
  treatmentOptions,
} from './vitals';

export type { SpawnPoint } from './spawn';

/** Point d'apparition près de l'origine (outil de test et repli). */
export function findSpawn(terrain: Terrain): SpawnPoint {
  return findSpawnNear(terrain, 0, 0);
}

export type Tone = 'info' | 'alerte' | 'danger';

/** Événements de la simulation, lus par l'affichage. */
export type SimEvent =
  | { type: 'chute'; severity: number; speed: number; height: number; surface: string; tick: number; injuries: Array<{ kind: InjuryKind; zone: Zone; grave: boolean }> }
  | { type: 'noyade'; tick: number }
  | { type: 'vital'; event: VitalEvent; tick: number }
  | { type: 'message'; text: string; tone: Tone; tick: number }
  /** Le joueur veut ouvrir un sac posé, un coffre, un foyer, fouiller un corps, ou voir une pièce de construction. */
  | { type: 'ouvrir'; prop: string; tick: number; build?: BuildRef }
  | { type: 'mort'; cause: DeathCause; tick: number }
  | { type: 'reapparition'; tick: number; place: 'sommeil' | 'arrivee' | 'secours'; body: { distance: number; direction: string } | null }
  /** Phase 6 : son d'une créature ou d'un combat (spatialisé par l'affichage). */
  | { type: 'son'; kind: SoundKind; x: number; y: number; z: number; tick: number }
  /** Une créature blesse le joueur (secousse, bord rouge). */
  | { type: 'attaque'; sp: SpeciesId; zone: Zone; tick: number }
  /** Le joueur touche une créature (sang, retour visuel). */
  | { type: 'touche'; sp: SpeciesId; part: BodyPart; killed: boolean; x: number; y: number; z: number; tick: number };

/** Geste en cours (manger, soigner) : il prend du temps et bouger l'interrompt. */
export interface Gesture {
  kind: 'manger' | 'soin' | 'fabrication' | 'reparation' | 'amelioration' | 'demontage' | 'allumage' | 'construction' | 'soufflet' | 'depecage' | 'piege';
  label: string;
  total: number;
  left: number;
  food?: { item: ItemId; from: HandOrSlot };
  injury?: number;
  treatment?: Treatment;
  recipe?: RecipeId;
  step?: number;
  from?: HandOrSlot;
  repair?: RepairKind;
  improve?: ImproveKind;
  prop?: string;
  /** Construction : chantier ou pièce visée, et ce qu'on y fait. */
  build?: BuildRef;
  buildOp?: 'etape' | 'reparer' | 'torchis' | 'demonter';
  /** Phase 6 : carcasse dépecée ; piège à réarmer ou dont on se dégage. */
  carcass?: string;
  trap?: string;
  trapOp?: 'liberer' | 'rearmer';
}

/** Requête de visée pour tracer un plan : le sol et les obstacles (pièces, troncs), pas les objets. */
const QUERY_BUILD = interactionGroups(0xffff, GROUP_TERRAIN | GROUP_OBSTACLE);
/** Plan de chaque installation (pour ses débris). */
const INSTALL_PLANS_BY_KIND: Record<InstallPropKind, PlanId> = { coffre: 'coffre', etabli: 'etabli', puits: 'puits', fourneau: 'fourneau', forge: 'forge', collet: 'collet', assommoir: 'assommoir', fosse: 'fosse' };
const PROP_NAMES: Partial<Record<PropKind, string>> = { coffre: 'Le coffre', etabli: 'L’établi', puits: 'Le puits', fourneau: 'Le fourneau', forge: 'La forge', collet: 'Le collet', assommoir: 'L’assommoir', fosse: 'La fosse' };
/** Portée des gestes de construction (m). */
const BUILD_REACH = 3.4;
/** Demi-hauteur des installations (le centre de leur volume est à cette hauteur au-dessus du sol). */
const INSTALL_HALF: Record<InstallPropKind, number> = { coffre: 0.3, etabli: 0.45, puits: 0.4, fourneau: 0.7, forge: 0.4, collet: 0.05, assommoir: 0.3, fosse: 0.05 };

/** Outils nécessaires, pour les messages. */
export const TOOL_NEEDS: Record<ToolTag, string> = {
  tranchant: 'un outil tranchant (éclat de quartz, couteau, hache)',
  hache: 'une hache',
  percuteur: 'un galet (pierre) comme percuteur',
  fouir: 'un bâton à fouir',
  batee: 'une batée',
  feu: 'un archet à feu',
  recipient: 'un pot',
  pointe: 'une lance',
};

/** Verbes des gisements, pour les indications à l'écran. */
const NODE_VERB: Record<NodeKind, string> = {
  bloc_quartz: 'frapper le bloc de quartz',
  touffe_herbe: 'arracher des herbes sèches',
  gisement_argile: 'creuser l’argile',
  filon_fer: 'extraire le minerai de fer',
  gravier_or: 'laver le gravier (orpailler)',
};

/** Endurance dépensée par coup selon l'outil. */
const STRIKE_COST: Record<string, number> = { hache: 6, percuteur: 4, tranchant: 3, fouir: 5, batee: 3, main: 2 };
/** Durée d'un coup (s). */
const STRIKE_TIME = 0.6;
/** Combustion : un bâton, une bûche (s). */
const FUEL_STICK = 60;
const FUEL_LOG = 240;
const FIRE_START = 300;
const BOIL_TIME = 30;
const FIRING_TIME = 90;
/** Viande : cuisson sur le foyer (s), carcasse avariée puis disparue (s). */
const MEAT_COOK = 45;
const CARCASS_ROT = 3600;
const CARCASS_GONE = 10800;
const CARCASS_KINDS = new Set<PropKind>(['carcasse']);
const FOOD_KINDS = new Set<PropKind>(['fruit_baobab', 'figue', 'muhacha', 'viande_crue', 'viande_cuite', 'sac']);
const FOOD_ITEMS = new Set<ItemId>(['fruit_baobab', 'figue', 'muhacha', 'viande_crue', 'viande_cuite']);
/** Requête des sens des créatures : le relief, les rochers, les troncs et les murs. */
const QUERY_SIGHT = interactionGroups(0xffff, GROUP_TERRAIN | GROUP_OBSTACLE);
const ZONE_AT: Record<Zone, string> = { tete: 'à la tête', torse: 'au torse', bras_g: 'au bras gauche', bras_d: 'au bras droit', jambe_g: 'à la jambe gauche', jambe_d: 'à la jambe droite' };
const ATTACK_VERB: Partial<Record<SpeciesId, string>> = {
  hyene: 'vous mord',
  phacochere: 'vous blesse de ses défenses',
  babouin: 'vous mord',
  elephant: 'vous charge et vous projette',
  leopard: 'vous saute dessus et vous lacère',
  crocodile: 'vous happe',
  ombre: 'vous saisit',
};

/** Sauvegarde de la partie (solo pour l'instant ; l'hôte en phase 8). */
export interface SimSave {
  version: 1;
  time: number;
  player: {
    x: number;
    y: number;
    z: number;
    vitals: Vitals;
    inventory: Inventory;
    respawn: SpawnPoint | null;
    lastBody: { id: string; x: number; z: number } | null;
    knowledge: Knowledge;
  };
  props: ReturnType<PropSystem['serialize']>;
  world: ReturnType<WorldState['serialize']>;
  /** Constructions (phase 5) ; absentes des anciennes sauvegardes. */
  build?: ReturnType<BuildState['serialize']>;
  /** Faune (phase 6) : populations, individus suivis, évolution ; absente des anciennes sauvegardes. */
  fauna?: FaunaSave;
}

export interface SimulationOptions {
  /** Graine du point d'apparition du joueur (apparition au hasard dans le monde). */
  spawnSeed?: number;
  /** Position de reprise (dernière position connue). */
  start?: SpawnPoint;
  /** Source de hauteurs précalculées pour la physique. */
  heightProvider?: HeightProvider;
  /** Sauvegarde à reprendre (joueur et objets du monde). */
  save?: unknown;
  /** Créatures réelles au plus autour du joueur (téléphone : 24). */
  creatureCap?: number;
  /** Faune active (par défaut : seulement dans un vrai monde, pas sur les terrains de test). */
  fauna?: boolean;
}

/** Secondes entre la mort et la réapparition. */
export const RESPAWN_DELAY = 5;
/** Un corps vidé disparaît après 10 minutes. */
export const BODY_EMPTY_SECONDS = 600;
const ACTION_REACH = REACH + 0.8;

const DIRECTIONS = ['au nord', 'au nord-est', "à l'est", 'au sud-est', 'au sud', 'au sud-ouest', "à l'ouest", 'au nord-ouest'];

/** Direction approximative (8 points cardinaux) : +z est le nord, +x l'est. */
export function compassDirection(dx: number, dz: number): string {
  const deg = (Math.atan2(dx, dz) * 180) / Math.PI;
  return DIRECTIONS[(((Math.round(deg / 45) % 8) + 8) % 8)]!;
}

const cap = (t: string): string => t.charAt(0).toUpperCase() + t.slice(1);
const PROP_ARTICLE = (kind: PropKind): string => propWithArticle(kind);
const ok = (message?: string): ActionResult => (message ? { ok: true, message } : { ok: true });
const fail = (message?: string): ActionResult => (message ? { ok: false, message } : { ok: false });

export class LocalSimulation {
  readonly terrain: Terrain;
  readonly phys: PhysicsWorld;
  readonly props: PropSystem;
  readonly state: MoveState;
  /** État avant le dernier pas, pour interpoler l'affichage. */
  readonly prev: MoveState;
  /** Point d'arrivée du joueur dans le monde. */
  readonly spawn: SpawnPoint;
  readonly events: SimEvent[] = [];
  tick = 0;
  respawns = 0;
  deaths = 0;
  vitals: Vitals;
  inventory: Inventory;
  /** Endroit du dernier sommeil d'au moins une minute : on y réapparaît. */
  respawnPoint: SpawnPoint | null = null;
  /** Dernier corps laissé, pour s'en souvenir à la réapparition. */
  lastBody: { id: string; x: number; z: number } | null = null;
  gesture: Gesture | null = null;
  /** Temps du monde en secondes (continue d'une partie à l'autre). */
  time = 0;
  /** Secondes écoulées depuis la mort (réapparition après RESPAWN_DELAY). */
  deadTime = 0;
  /** Gisements et arbres modifiés par le joueur. */
  readonly world = new WorldState();
  /** Recettes connues et pressenties, compétence « Fabrication ». */
  knowledge: Knowledge = makeKnowledge();
  /** Fabrication en cours sur le plan de travail : recette et étape suivante. */
  craft: { recipe: RecipeId; step: number } | null = null;
  /** Constructions et chantiers (phase 5). */
  readonly build: BuildState;
  /** Collisions des constructions proches. */
  readonly structPhys: StructurePhysics;
  /** Chocs subis par les pièces pendant le pas (dégâts à appliquer). */
  private readonly impacts = new Map<string, number>();
  /** Coups déjà portés sur une cible (gisement, partie d'un arbre). */
  private readonly strikes = new Map<string, number>();
  /** Temps avant le prochain coup d'outil (s). */
  private useCooldown = 0;
  /** Endurance dépensée hors déplacement (coups d'outil), pour l'énergie et la fatigue. */
  private extraSpent = 0;
  /** Faune (phase 6). */
  readonly fauna: Fauna;
  private readonly faunaEnv: FaunaEnv;
  /** Objets lancés suivis (dégâts aux créatures) ; pierre d'un assommoir (peut toucher le joueur). */
  private readonly projectiles = new Map<string, { left: number; age: number; trap: boolean }>();
  /** Piège qui retient le joueur (collet, fosse). */
  trappedIn: string | null = null;
  private readonly collider: RAPIER.Collider;
  private lastDrownEvent = -1e9;
  private yaw = 0;
  private pitch = 0;

  /** Charge Rapier si nécessaire puis crée la simulation. */
  static async create(seed: number, opts: SimulationOptions = {}): Promise<LocalSimulation> {
    await initPhysics();
    return new LocalSimulation(seed, opts);
  }

  /** Rapier doit déjà être chargé (initPhysics). Un terrain de test peut être fourni. */
  constructor(seedOrTerrain: number | Terrain, opts: SimulationOptions = {}) {
    this.terrain = typeof seedOrTerrain === 'number' ? new Terrain(seedOrTerrain) : seedOrTerrain;
    this.phys = new PhysicsWorld(this.terrain);
    if (opts.heightProvider) this.phys.heightProvider = opts.heightProvider;
    this.props = new PropSystem(this.phys);
    this.props.clock = () => this.time;
    this.phys.treeFelled = (cx, cz, i) => this.world.isFelled(treeKey(cx, cz, i), this.time);
    this.build = new BuildState((x, z) => this.terrain.heightAt(x, z));
    this.structPhys = new StructurePhysics(this.phys, this.build);
    this.phys.onContactForce = (h1, h2, force) => this.onImpact(h1, h2, force);
    this.fauna = new Fauna(this.terrain.seed, this.terrain, opts.creatureCap ?? 40);
    this.fauna.enabled = opts.fauna ?? this.terrain.floraEnabled;
    this.faunaEnv = {
      terrain: this.terrain,
      physicsAt: (x, z) => this.phys.hasChunk(chunkCoord(x), chunkCoord(z)),
      ray: (x, y, z, dx, dy, dz, len) => {
        const hit = this.phys.world.castRay(new RAPIER.Ray({ x, y, z }, { x: dx, y: dy, z: dz }), len, true, undefined, QUERY_SIGHT);
        return hit ? hit.timeOfImpact : null;
      },
      ground: (x, z) => this.terrain.heightAt(x, z),
      fires: [],
      carcasses: [],
      food: [],
      pieceAt: (x, y, z, r) => this.pieceNear(x, y, z, r),
      traps: [],
    };
    this.spawn = opts.spawnSeed !== undefined ? chooseSpawn(this.terrain, opts.spawnSeed) : findSpawn(this.terrain);
    this.vitals = makeVitals((opts.spawnSeed ?? this.terrain.seed) ^ 0x5eed);
    this.inventory = makeInventory(true);
    let start = opts.start ?? this.spawn;
    // La sauvegarde est reprise avant le chargement des premiers chunks (objets ramassés, déplacés).
    if (opts.save !== undefined) start = this.restore(opts.save) ?? start;
    this.state = makeState(start.x, start.y, start.z);
    this.prev = makeState(start.x, start.y, start.z);
    this.phys.ensureAround([this.state], PHYS_CHUNK_RADIUS, 0);
    this.structPhys.sync(start.x, start.z);
    this.phys.refresh();
    this.collider = this.phys.createPlayerCollider(start.x, start.y, start.z);
  }

  get dead(): boolean {
    return this.vitals.state === 'mort';
  }

  private push(e: SimEvent): void {
    this.events.push(e);
  }

  private msg(text: string, tone: Tone = 'info'): void {
    this.push({ type: 'message', text, tone, tick: this.tick });
  }

  /** Applique au déplacement les limites du corps et de la charge. */
  private applyLimits(): void {
    const s = this.state;
    const lim = limits(this.vitals);
    const load = carriedMass(this.inventory);
    const over = Math.max(0, load - 10);
    s.loadKg = load;
    s.staminaMax = lim.maxStamina;
    s.speedCap = lim.speedCap;
    s.speedMul = lim.speedMul * Math.max(0.6, 1 - 0.012 * over);
    s.regenMul = lim.regenMul;
    s.drainMul = lim.drainMul * (1 + 0.03 * over);
    let r = 0;
    if (lim.noSprint || load > 25) r |= R_NO_SPRINT;
    if (lim.noJump || load > 35) r |= R_NO_JUMP;
    if (lim.noClimb) r |= R_NO_CLIMB;
    if (lim.noHeavy) r |= R_NO_HEAVY;
    if (lim.noThrow) r |= R_NO_THROW;
    s.restrict = r;
    if (s.stamina > s.staminaMax) s.stamina = s.staminaMax;
  }

  /** Fait avancer le monde d'un pas avec la commande du joueur. */
  step(cmd: InputCmd): void {
    const q = quantizeInput(cmd);
    const s = this.state;
    const v = this.vitals;
    copyState(this.prev, s);
    this.phys.ensureAround([s], PHYS_CHUNK_RADIUS, this.tick);
    this.structPhys.sync(s.x, s.z);
    if (this.tick % 120 === 0) this.phys.unloadUnused(this.tick, 600);
    this.time += TICK_DT;
    this.yaw = q.yaw;
    this.pitch = q.pitch;

    if (v.state === 'mort') {
      this.deadTime += TICK_DT;
      this.phys.step(TICK_DT);
      if (this.deadTime >= RESPAWN_DELAY) this.respawnAfterDeath();
      this.tick++;
      return;
    }

    this.applyLimits();
    // Tenu par une créature ou pris dans un piège : on ne se déplace plus ; on se débat.
    const held = this.fauna.grab !== null || this.trappedIn !== null;
    if (this.fauna.grab && v.state === 'eveille' && (q.buttons & ~s.prevButtons & (BTN_INTERACT | BTN_JUMP)) !== 0) this.fauna.struggle();
    // Bouger interrompt un geste, fait se lever ou réveille.
    const wantsMove = !held && (q.wx * q.wx + q.wz * q.wz > 0.01 || (q.buttons & BTN_JUMP) !== 0);
    if (wantsMove && v.state === 'eveille') {
      if (this.gesture) this.cancelGesture();
      if (v.posture !== 'debout') {
        const wasAsleep = v.posture === 'endormi';
        standUp(v);
        if (wasAsleep) this.push({ type: 'vital', event: { type: 'reveille' }, tick: this.tick });
      }
    }
    let c = q;
    if (v.state !== 'eveille' || v.posture !== 'debout') c = { ...q, wx: 0, wz: 0, buttons: BTN_CROUCH };
    else if (this.fauna.grab) c = { ...q, wx: 0, wz: 0, buttons: 0 };
    else if (this.trappedIn) c = { ...q, wx: 0, wz: 0, buttons: q.buttons & BTN_INTERACT };
    else if (this.gesture) c = { ...q, wx: 0, wz: 0, buttons: q.buttons & BTN_CROUCH };

    const pressed = c.buttons & ~s.prevButtons;
    let propPressed = pressed;
    if (v.state !== 'eveille') {
      if (this.props.held) this.props.drop(s);
      propPressed = 0;
    } else if ((pressed & BTN_INTERACT) !== 0 && this.props.held) {
      // Les mains prises (une bûche à rentrer…), E ouvre ou ferme quand même la porte visée.
      const bt = this.buildTarget();
      const door = bt?.kind === 'piece' ? this.build.piece(bt.s, bt.p) : undefined;
      if (bt?.kind === 'piece' && door && PLANS[door.plan].piece === 'porte' && isDone(door)) {
        propPressed &= ~BTN_INTERACT;
        const r = this.toggleDoor(bt.s, bt.p);
        if (r.message) this.msg(r.message, r.ok ? 'info' : 'alerte');
      }
    } else if ((pressed & BTN_INTERACT) !== 0 && this.trappedIn) {
      // Pris dans un piège : E pour se dégager.
      propPressed &= ~BTN_INTERACT;
      if (!this.gesture) this.startTrapGesture(this.trappedIn, 'liberer');
    } else if ((pressed & BTN_INTERACT) !== 0 && !this.props.held) {
      // Petits objets rangés directement ; sacs et corps s'ouvrent (affichage).
      const t = this.props.target(s, c.yaw, c.pitch);
      const bt = this.buildTarget();
      if (bt && (!t || bt.dist < t.distance)) {
        // Pièce de construction ou chantier : porte qui s'ouvre, sinon son panneau.
        propPressed &= ~BTN_INTERACT;
        this.interactBuild(bt);
      } else if (t && TRAP_KINDS.has(t.kind)) {
        propPressed &= ~BTN_INTERACT;
        const r = this.interactTrap(t.id);
        if (r.message) this.msg(r.message, r.ok ? 'info' : 'alerte');
      } else if (t && t.kind === 'carcasse') {
        propPressed &= ~BTN_INTERACT;
        const def = this.props.defOf(t.id);
        const k = def?.carcass;
        if (k) this.msg(k.meat > 0 && this.time - k.at < CARCASS_ROT ? `Carcasse ${SPECIES[k.sp].feminine ? 'd’une' : 'd’un'} ${SPECIES[k.sp].label} : une lame en main (Utiliser) pour la dépecer.` : 'Il n’y a plus rien de bon à prendre.', 'info');
      } else if (t && t.kind === 'puits') {
        propPressed &= ~BTN_INTERACT;
        const pot = this.findPot();
        const r = pot ? this.fillPot(pot) : fail('Il faut un pot pour puiser l’eau.');
        if (r.message) this.msg(r.message, r.ok ? 'info' : 'alerte');
      } else if (t && QUICK_PICK.has(t.kind)) {
        if (this.pickUp(t.id)) propPressed &= ~BTN_INTERACT;
      } else if (t && (t.kind === 'sac' || t.kind === 'corps' || t.kind === 'foyer' || t.kind === 'coffre' || t.kind === 'forge' || t.kind === 'fourneau' || t.kind === 'etabli')) {
        propPressed &= ~BTN_INTERACT;
        this.push({ type: 'ouvrir', prop: t.id, tick: this.tick });
      } else if (t && t.kind === 'touffe_herbe') {
        // Les herbes sèches s'arrachent à la main.
        propPressed &= ~BTN_INTERACT;
        const r = this.harvestNode(t, null);
        if (r.message) this.msg(r.message, r.ok ? 'info' : 'alerte');
      } else if (t && t.kind === 'gravier_or') {
        propPressed &= ~BTN_INTERACT;
        if (hintRecipe(this.knowledge, 'batee')) this.msg('Ce gravier brille… Une batée permettrait de le laver. Nouvelle idée dans le carnet.', 'info');
        else this.msg('Ce gravier brille… Il faut une batée en main (Utiliser) pour le laver.', 'info');
      }
    }
    this.props.update(s, c, propPressed);
    if (this.props.thrown) {
      this.projectiles.set(this.props.thrown, { left: 3, age: 0, trap: false });
      this.props.thrown = null;
    }
    if (this.props.refusal) {
      this.msg(this.props.refusal, 'alerte');
      this.props.refusal = null;
    }
    stepMovement(this.phys, this.collider, s, c, TICK_DT);
    this.phys.step(TICK_DT);
    this.applyImpacts();
    this.stepFauna();
    if (this.dead) {
      this.tick++;
      return;
    }
    if (this.tick % 30 === 0) this.props.rescueFallen();

    if (s.impactSeverity > 0) {
      const before = v.state;
      const added = applyFall(v, s.impactSeverity);
      this.push({
        type: 'chute',
        severity: s.impactSeverity,
        speed: s.impact,
        height: s.impactHeight,
        surface: s.surface,
        tick: this.tick,
        injuries: added.map((i) => ({ kind: i.kind, zone: i.zone, grave: i.grave })),
      });
      if (this.dead) {
        this.onDeath();
        this.tick++;
        return;
      }
      if (before === 'eveille' && v.state === 'inconscient') this.onVital({ type: 'inconscient', reason: 'commotion' });
    }
    if (s.drowning && this.tick - this.lastDrownEvent >= 60) {
      this.lastDrownEvent = this.tick;
      this.push({ type: 'noyade', tick: this.tick });
    }

    const out: VitalEvent[] = [];
    const moving = s.vx * s.vx + s.vz * s.vz > 0.09;
    tickVitals(v, TICK_DT, { staminaSpent: s.spent + this.extraSpent, moving, loadKg: s.loadKg + s.carryMass, inWater: s.mode === MODE_SWIM, drowning: s.drowning, grounded: s.grounded }, out);
    this.extraSpent = 0;
    if (this.useCooldown > 0) this.useCooldown = Math.max(0, this.useCooldown - TICK_DT);
    for (const e of out) this.onVital(e);
    if (this.dead) {
      this.tick++;
      return;
    }
    this.stepGesture();
    if (this.tick % 15 === 0) this.stepCollapse();
    if (this.tick % 30 === 0) {
      this.stepFires(30 * TICK_DT);
      this.stepFurnaces(30 * TICK_DT);
      this.stepBuildFire(30 * TICK_DT);
    }
    if (this.tick % 600 === 0) {
      this.cleanupBodies();
      for (const c of this.world.regrow(this.time)) this.phys.rebuildChunk(c.cx, c.cz);
    }
    if (s.y < KILL_Y || !Number.isFinite(s.x + s.y + s.z)) this.respawn();
    if (this.events.length > 80) this.events.splice(0, this.events.length - 80);
    this.tick++;
  }

  private onVital(e: VitalEvent): void {
    const s = this.state;
    if (e.type === 'repere') {
      this.respawnPoint = { x: s.x, y: s.y, z: s.z };
    } else if (e.type === 'mort') {
      this.onDeath();
      return;
    } else if (e.type === 'inconscient' || e.type === 'critique') {
      this.gesture = null;
      if (this.props.held) this.props.drop(s);
    }
    this.push({ type: 'vital', event: e, tick: this.tick });
  }

  /** Lit et vide la liste des événements. */
  takeEvents(): SimEvent[] {
    return this.events.splice(0, this.events.length);
  }

  /** Place le joueur à un endroit précis (point d'apparition, outil de test). */
  teleport(x: number, y: number, z: number): void {
    // L'objet tenu suit le joueur.
    this.props.moveHeld(x - this.state.x, y - this.state.y, z - this.state.z);
    const s = makeState(x, y, z);
    s.stamina = this.state.stamina;
    copyState(this.state, s);
    copyState(this.prev, s);
    this.collider.setHalfHeight(0.6);
    this.phys.ensureAround([s], PHYS_CHUNK_RADIUS, this.tick);
    this.phys.step(TICK_DT);
  }

  /** Retour d'urgence au point d'arrivée (chute hors du monde) : ce n'est pas une mort. */
  respawn(): void {
    this.teleport(this.spawn.x, this.spawn.y, this.spawn.z);
    this.state.mode = MODE_WALK;
    this.respawns++;
    this.push({ type: 'reapparition', tick: this.tick, place: 'secours', body: null });
  }

  // ——— Mort et réapparition ———

  private onDeath(): void {
    const s = this.state;
    const v = this.vitals;
    this.gesture = null;
    if (this.props.held) this.props.drop(s);
    const inv = this.inventory;
    // Les pièces du plan de travail restent avec le corps.
    for (const st of inv.bench) {
      if (inv.bag) inv.bag.push(st);
      else this.dropOnGround(st);
    }
    inv.bench = [];
    this.craft = null;
    const container: Container = { bag: inv.bag, pockets: inv.pockets };
    const shape = itemShape('corps');
    const id = this.props.spawnDynamic({ kind: 'corps', x: s.x, y: s.y + shape.radius + 0.05, z: s.z, rot: (((this.yaw / (Math.PI * 2)) % 1) + 1) % 1, ...shape, container });
    const def = this.props.defOf(id);
    if (def && isEmpty(container)) def.emptiedAt = this.time;
    this.lastBody = { id, x: s.x, z: s.z };
    this.inventory = makeInventory(false);
    // Le corps prend la place du joueur : sa capsule ne doit plus le bousculer.
    this.collider.setEnabled(false);
    this.deaths++;
    this.deadTime = 0;
    this.push({ type: 'mort', cause: v.cause ?? 'abandon', tick: this.tick });
  }

  /** Point de réapparition : dernier sommeil, sinon point d'arrivée. */
  get respawnTarget(): { point: SpawnPoint; place: 'sommeil' | 'arrivee' } {
    return this.respawnPoint ? { point: this.respawnPoint, place: 'sommeil' } : { point: this.spawn, place: 'arrivee' };
  }

  private respawnAfterDeath(): void {
    const { point, place } = this.respawnTarget;
    const v = makeVitals(this.vitals.rng);
    v.health = VITALS.respawn.health;
    v.energy = VITALS.respawn.energy;
    v.fatigue = VITALS.respawn.fatigue;
    this.vitals = v;
    this.collider.setEnabled(true);
    this.teleport(point.x, point.y + 0.15, point.z);
    this.state.stamina = 70;
    this.deadTime = 0;
    this.respawns++;
    let body: { distance: number; direction: string } | null = null;
    const lb = this.lastBody;
    if (lb && this.props.defOf(lb.id)) {
      const dx = lb.x - point.x;
      const dz = lb.z - point.z;
      const d = Math.hypot(dx, dz);
      body = { distance: d < 25 ? 0 : Math.max(100, Math.round(d / 100) * 100), direction: compassDirection(dx, dz) };
    }
    this.push({ type: 'reapparition', tick: this.tick, place, body });
  }

  private cleanupBodies(): void {
    const remove: string[] = [];
    this.props.forEachDynamic((def) => {
      if (def.kind !== 'corps' || !def.container) return;
      if (!isEmpty(def.container)) {
        delete def.emptiedAt;
        return;
      }
      if (def.emptiedAt === undefined) def.emptiedAt = this.time;
      else if (this.time - def.emptiedAt >= BODY_EMPTY_SECONDS) remove.push(def.id);
    });
    for (const id of remove) {
      this.props.remove(id);
      if (this.lastBody?.id === id) this.lastBody = null;
    }
  }

  // ——— Objets ———

  private stackFromProp(id: string, def: PropDef): ItemStack | null {
    const item = ITEM_OF_PROP[def.kind];
    if (!item) return null;
    const st: ItemStack = { item, count: 1, ...(def.meta ?? {}) };
    if (item === 'torche' && def.fire) {
      st.d = Math.max(1, Math.round(def.fire.fuel));
      st.dm = Math.max(st.dm ?? 0, st.d);
    }
    if (MASS_ITEMS.has(item)) {
      const m = this.props.massOf(id);
      if (m > 0) st.mass = m;
      st.radius = def.radius;
      if (item === 'buche') st.length = def.length;
    }
    return st;
  }

  /** Ramasse un petit objet : poche, sinon sac, sinon en main. */
  private pickUp(id: string): boolean {
    const def = this.props.defOf(id);
    if (!def) return false;
    const st = this.stackFromProp(id, def);
    if (!st) return false;
    if (store(this.inventory, st) > 0) {
      this.msg(this.inventory.bag ? 'Plus de place : vous le gardez en main.' : 'Poches pleines et pas de sac : vous le gardez en main.', 'info');
      return false;
    }
    this.props.remove(id);
    this.msg(`Vous ramassez ${itemName(st.item)}.`, 'info');
    this.noteHints(hintFrom(this.knowledge, st.item));
    this.notePlans(st.item);
    return true;
  }

  private heldItem(): { id: string; def: PropDef; item: ItemId } | null {
    const h = this.props.held;
    if (!h || h.mode !== 'carry') return null;
    const def = this.props.defOf(h.id);
    const item = def ? ITEM_OF_PROP[def.kind] : undefined;
    return def && item ? { id: h.id, def, item } : null;
  }

  /** Nombre d'unités disponibles (inventaire et main). */
  available(item: ItemId): number {
    return countOf(this.inventory, item) + (this.heldItem()?.item === item ? 1 : 0);
  }

  private use(item: ItemId, n: number): void {
    let need = n;
    const h = this.heldItem();
    if (h && h.item === item && need > 0) {
      this.props.remove(h.id);
      need--;
    }
    if (need > 0) consume(this.inventory, item, need);
  }

  private dropOnGround(st: ItemStack): void {
    const s = this.state;
    const kind = st.item as PropKind;
    for (let k = 0; k < st.count; k++) {
      const dir = lookDirection(this.yaw + (k - (st.count - 1) / 2) * 0.35, 0);
      const x = s.x + dir.x * 0.65;
      const z = s.z + dir.z * 0.65;
      const shape = MASS_ITEMS.has(st.item) ? { radius: st.radius ?? 0.08, length: st.item === 'buche' ? (st.length ?? 0.7) : 0 } : itemShape(kind);
      const y = Math.max(s.y + 0.45, this.terrain.heightAt(x, z) + shape.radius + 0.1);
      const meta = this.propMeta(st);
      this.props.spawnDynamic({ kind, x, y, z, rot: (k * 0.37) % 1, ...shape, ...(meta ? { meta } : {}) });
    }
  }

  private reachable(propId: string): PropDef | null {
    const def = this.props.defOf(propId);
    const p = this.props.position(propId);
    if (!def || !p) return null;
    const s = this.state;
    const dy = p.y - (s.y + 0.9);
    return Math.hypot(p.x - s.x, dy, p.z - s.z) <= ACTION_REACH ? def : null;
  }

  private afterContainerChange(def: PropDef): void {
    if (def.kind === 'sac') this.props.refreshMass(def.id);
    if (def.kind === 'corps' && def.container && !isEmpty(def.container)) delete def.emptiedAt;
  }

  // ——— Gestes ———

  private cancelGesture(): void {
    if (!this.gesture) return;
    this.gesture = null;
    this.msg('Geste interrompu.', 'info');
  }

  private stepGesture(): void {
    const g = this.gesture;
    if (!g) return;
    g.left -= TICK_DT;
    if (g.kind === 'allumage') {
      // Faire tourner l'archet épuise.
      const s = this.state;
      this.exert(5 * TICK_DT);
      if (s.stamina <= 0) {
        this.gesture = null;
        this.wearTool('feu', 1);
        this.msg('Épuisé, vous lâchez l’archet : le feu n’a pas pris.', 'alerte');
        return;
      }
    }
    if (g.kind === 'soufflet') {
      // Le soufflet aussi.
      this.exert(6 * TICK_DT);
      if (this.state.stamina <= 0) {
        this.gesture = null;
        this.msg('Épuisé, vous lâchez le soufflet.', 'alerte');
        return;
      }
    }
    if (g.left > 0) return;
    this.gesture = null;
    if (g.kind === 'manger' && g.food) this.finishEating(g.food.item, g.food.from);
    else if (g.kind === 'soin' && g.injury !== undefined && g.treatment) this.finishTreatment(g.injury, g.treatment);
    else if (g.kind === 'fabrication' && g.recipe && g.step !== undefined) this.finishCraftStep(g.recipe, g.step);
    else if (g.kind === 'reparation' && g.from && g.repair) this.finishRepair(g.from, g.repair);
    else if (g.kind === 'amelioration' && g.from && g.improve) this.finishImprove(g.from, g.improve);
    else if (g.kind === 'demontage' && g.from) this.finishDismantle(g.from);
    else if (g.kind === 'allumage' && g.prop) this.finishLighting(g.prop);
    else if (g.kind === 'soufflet' && g.prop) this.finishBellows(g.prop);
    else if (g.kind === 'construction' && g.build) {
      if (g.buildOp === 'etape' || !g.buildOp) this.finishBuildStep(g.build);
      else this.finishPieceOp(g.build, g.buildOp);
    } else if (g.kind === 'depecage' && g.carcass) this.finishButcher(g.carcass);
    else if (g.kind === 'piege' && g.trap && g.trapOp) this.finishTrapGesture(g.trap, g.trapOp);
  }

  private startEating(from: HandOrSlot): ActionResult {
    let item: ItemId | null = null;
    if (from.zone === 'main') item = this.heldItem()?.item ?? null;
    else item = stackAt(this.inventory, from)?.item ?? null;
    if (!item) return fail('Rien à manger ici.');
    const food = ITEMS[item].food;
    if (!food) return fail('Cela ne se mange pas.');
    if (this.vitals.digest.length >= VITALS.stomach) return fail('Vous avez assez mangé pour l’instant.');
    const seconds = item === 'fruit_baobab' ? 3 : 1.5;
    this.gesture = { kind: 'manger', label: `Vous mangez ${itemName(item)}…`, total: seconds, left: seconds, food: { item, from } };
    return ok();
  }

  private finishEating(item: ItemId, from: HandOrSlot): void {
    const food = ITEMS[item].food!;
    if (from.zone === 'main') {
      const h = this.heldItem();
      if (!h || h.item !== item) return;
      this.props.remove(h.id);
    } else {
      const st = stackAt(this.inventory, from);
      if (!st || st.item !== item) {
        if (consume(this.inventory, item, 1) === 0) return;
      } else takeAt(this.inventory, from, 1);
    }
    eat(this.vitals, food);
    this.msg(`Vous avez mangé ${itemName(item)} : votre santé remonte.`, 'info');
  }

  private startTreatment(injuryId: number, t: Treatment): ActionResult {
    const v = this.vitals;
    if (!canTreatSelf(v)) return fail('Avec les deux bras cassés, il faut l’aide de quelqu’un.');
    const opt = treatmentOptions(v).find((o) => o.injury === injuryId && o.treatment === t);
    const inj = v.injuries.find((i) => i.id === injuryId);
    if (!opt || !inj) return fail('Ce soin ne convient pas à cette blessure.');
    for (const [item, n] of this.needsFor(opt.treatment, opt.needs)) if (this.available(item) < n) return fail(`Il vous faut ${itemName(item, n)}.`);
    this.gesture = { kind: 'soin', label: `${TREATMENT_LABELS[t]} (${ZONE_LABELS[inj.zone]})…`, total: opt.seconds, left: opt.seconds, injury: injuryId, treatment: t };
    return ok();
  }

  private finishTreatment(injuryId: number, t: Treatment): void {
    const opt = treatmentOptions(this.vitals).find((o) => o.injury === injuryId && o.treatment === t);
    if (!opt) return;
    const needs = this.needsFor(t, opt.needs);
    for (const [item, n] of needs) if (this.available(item) < n) return this.msg(`Il vous manque ${itemName(item, n)}.`, 'alerte');
    for (const [item, n] of needs) this.use(item, n);
    const sterile = needs.some(([item]) => item === 'pansement');
    applyTreatment(this.vitals, injuryId, t, sterile);
    const text = t === 'attelle' ? 'Attelle posée : la fracture peut guérir.' : t === 'aloes' ? 'Plaie désinfectée, la douleur s’apaise.' : sterile ? 'Pansement propre posé : aucun risque d’infection.' : 'Bandage posé.';
    this.msg(text, 'info');
  }

  /** Meilleur soin à faire avec l'objet tenu (bouton « Utiliser »). */
  private bestTreatmentFor(item: ItemId): { injury: number; treatment: Treatment } | null {
    const v = this.vitals;
    const opts = treatmentOptions(v);
    const injury = (id: number) => v.injuries.find((i) => i.id === id)!;
    if (item === 'chiffon' || item === 'pansement') {
      const bleeding = opts.filter((o) => o.treatment === 'bander' && bleedRate(injury(o.injury)) > 0).sort((a, b) => bleedRate(injury(b.injury)) - bleedRate(injury(a.injury)));
      const o = bleeding[0] ?? opts.find((x) => x.treatment === 'bander');
      return o ? { injury: o.injury, treatment: 'bander' } : null;
    }
    if (item === 'aloes') {
      const infected = opts.find((o) => o.treatment === 'aloes' && injury(o.injury).infection > 0);
      const o = infected ?? opts.find((x) => x.treatment === 'aloes');
      return o ? { injury: o.injury, treatment: 'aloes' } : null;
    }
    if (item === 'baton') {
      const o = opts.find((x) => x.treatment === 'attelle');
      return o ? { injury: o.injury, treatment: 'attelle' } : null;
    }
    return null;
  }

  private canRest(): boolean {
    const s = this.state;
    return s.mode === MODE_WALK && s.grounded && s.surface !== 'eau';
  }

  // ——— Actions du joueur ———

  /** Applique une action ponctuelle (sac, soins, repos…). */
  act(a: PlayerAction): ActionResult {
    const v = this.vitals;
    const s = this.state;
    const inv = this.inventory;
    if (a.type === 'abandonner') {
      if (v.state !== 'critique' && v.state !== 'inconscient') return fail('Vous n’êtes pas à terre.');
      die(v, 'abandon');
      this.onDeath();
      return ok();
    }
    if (v.state !== 'eveille') return fail(v.state === 'mort' ? 'Vous êtes mort.' : 'Vous êtes inconscient.');
    if (a.type === 'interrompre') {
      if (!this.gesture) return fail();
      this.cancelGesture();
      return ok();
    }
    if (this.gesture) return fail('Terminez d’abord votre geste.');

    switch (a.type) {
      case 'ranger': {
        const h = this.heldItem();
        if (!h) {
          const hd = this.props.held;
          return fail(hd ? 'Cet objet est trop grand pour le sac.' : 'Vous ne tenez rien.');
        }
        const st = this.stackFromProp(h.id, h.def)!;
        if (store(inv, st) > 0) return fail(inv.bag ? 'Plus de place dans le sac ni dans les poches.' : 'Plus de place dans vos poches, et vous n’avez pas de sac.');
        this.props.remove(h.id);
        return ok();
      }
      case 'sortir': {
        if (this.props.held) return fail('Vos mains sont déjà prises.');
        const one = takeAt(inv, a.from, 1);
        if (!one) return fail();
        const kind = one.item as PropKind;
        const shape = MASS_ITEMS.has(one.item) ? { radius: one.radius ?? 0.08, length: one.item === 'buche' ? (one.length ?? 0.7) : 0 } : itemShape(kind);
        const meta = this.propMeta(one);
        if (!this.props.holdNew({ kind, rot: 0, ...shape, ...(meta ? { meta } : {}) }, s, this.yaw, s.crouched ? 0.6 : 0.3)) {
          store(inv, one);
          return fail(this.props.refusal ?? 'Impossible de le prendre en main.');
        }
        return ok();
      }
      case 'deplacer': {
        const st = stackAt(inv, a.from);
        if (!st) return fail();
        if (a.to === 'sac' && !inv.bag) return fail('Vous n’avez pas de sac.');
        if ((a.to === 'poche') === (a.from.zone === 'poche')) return fail();
        const moved = takeAt(inv, a.from, st.count)!;
        const left = a.to === 'poche' ? addToPockets(inv, moved) : addToBag(inv, moved);
        if (left > 0) {
          const back = { ...moved, count: left };
          if (a.from.zone === 'poche') addToPockets(inv, back);
          else addToBag(inv, back);
          if (left === moved.count) return fail(a.to === 'poche' ? 'Pas de place dans vos poches.' : 'Le sac est plein.');
        }
        return ok();
      }
      case 'poser': {
        if (a.from.zone === 'main') {
          if (!this.props.held) return fail('Vous ne tenez rien.');
          this.props.drop(s);
          return ok();
        }
        const one = takeAt(inv, a.from, 1);
        if (!one) return fail();
        this.dropOnGround(one);
        return ok();
      }
      case 'manger':
        return this.startEating(a.from);
      case 'soigner':
        return this.startTreatment(a.injury, a.treatment);
      case 'dechirer': {
        const left = tearClothing(inv, a.part);
        if (left < 0) return fail('Ce vêtement est déjà déchiré.');
        if (left > 0) this.dropOnGround({ item: 'chiffon', count: left });
        return ok(`Vous déchirez ${CLOTHING_LABELS[a.part]} : ${RAGS_PER_PART[a.part]} chiffons${left > 0 ? ` (${left} posés au sol, faute de place)` : ''}.`);
      }
      case 'reposer': {
        if (v.posture === 'assis') {
          standUp(v);
          return ok();
        }
        if (!this.canRest()) return fail('Impossible de vous asseoir ici.');
        if (this.props.held?.mode === 'drag') this.props.drop(s);
        sitDown(v);
        return ok('Vous vous asseyez pour reprendre des forces.');
      }
      case 'dormir': {
        if (!this.canRest()) return fail('Impossible de dormir ici.');
        if (v.fatigue < VITALS.sleepMinFatigue) return fail('Vous n’avez pas sommeil.');
        if (this.props.held) this.props.drop(s);
        fallAsleep(v);
        return ok('Vous vous endormez… Après une minute de sommeil, vous réapparaîtrez ici en cas de mort.');
      }
      case 'lever':
        standUp(v);
        return ok();
      case 'poser_sac': {
        if (!inv.bag) return fail('Vous ne portez pas de sac.');
        const dir = lookDirection(this.yaw, 0);
        const x = s.x + dir.x * 0.7;
        const z = s.z + dir.z * 0.7;
        const shape = itemShape('sac');
        this.props.spawnDynamic({ kind: 'sac', x, y: Math.max(s.y + 0.5, this.terrain.heightAt(x, z) + 0.35), z, rot: 0, ...shape, container: { bag: inv.bag, pockets: [] } });
        inv.bag = null;
        return ok('Vous posez votre sac.');
      }
      case 'prendre_sac': {
        const def = this.reachable(a.prop);
        if (!def || !def.container) return fail('Trop loin.');
        if (inv.bag) return fail('Vous portez déjà un sac : posez-le d’abord.');
        if (!def.container.bag) return fail('Il n’y a pas de sac ici.');
        inv.bag = def.container.bag;
        def.container.bag = null;
        if (def.kind === 'sac') this.props.remove(def.id);
        return ok('Vous mettez le sac sur votre dos.');
      }
      case 'prendre_dans': {
        const def = this.reachable(a.prop);
        const c = def?.container;
        if (!def || !c) return fail('Trop loin.');
        const st = stackAt(c, a.from);
        if (!st) return fail();
        const taken = takeAt(c, a.from, st.count)!;
        const left = store(inv, taken);
        if (left > 0) {
          const back = { ...taken, count: left };
          if (a.from.zone === 'poche' && !c.pockets[a.from.index]) c.pockets[a.from.index] = back;
          else if (c.bag) c.bag.push(back);
          else this.dropOnGround(back);
        }
        this.afterContainerChange(def);
        return left === taken.count ? fail('Pas de place pour le prendre.') : ok();
      }
      case 'tout_prendre': {
        const def = this.reachable(a.prop);
        const c = def?.container;
        if (!def || !c) return fail('Trop loin.');
        let tookBag = false;
        if (!inv.bag && c.bag && def.kind === 'corps') {
          inv.bag = c.bag;
          c.bag = null;
          tookBag = true;
        }
        let missed = 0;
        c.pockets.forEach((st, i) => {
          if (!st) return;
          const left = store(inv, { ...st });
          if (left > 0) {
            st.count = left;
            missed += left;
          } else c.pockets[i] = null;
        });
        if (c.bag) {
          for (let i = c.bag.length - 1; i >= 0; i--) {
            const st = c.bag[i]!;
            const left = store(inv, { ...st });
            if (left > 0) {
              st.count = left;
              missed += left;
            } else c.bag.splice(i, 1);
          }
        }
        this.afterContainerChange(def);
        if (missed > 0) return ok(`Vous prenez ce que vous pouvez (${missed} objet${missed > 1 ? 's' : ''} laissé${missed > 1 ? 's' : ''}, faute de place).`);
        return ok(tookBag ? 'Vous récupérez le sac et tout son contenu.' : 'Vous prenez tout.');
      }
      case 'deposer_dans': {
        const def = this.reachable(a.prop);
        const c = def?.container;
        if (!def || !c) return fail('Trop loin.');
        if (!c.bag) return fail('Il n’y a pas de sac ici.');
        const st = stackAt(inv, a.from);
        if (!st) return fail();
        const moved = takeAt(inv, a.from, st.count)!;
        const left = addToBag(c, moved);
        if (left > 0) store(inv, { ...moved, count: left });
        this.afterContainerChange(def);
        return left === moved.count ? fail('Ce sac est plein.') : ok();
      }
      case 'trainer': {
        const def = this.reachable(a.prop);
        if (!def) return fail('Trop loin.');
        if (this.props.held) return fail('Vos mains sont déjà prises.');
        return this.props.grab(def.id, s) ? ok() : fail(this.props.refusal ?? 'Impossible.');
      }
      case 'poche': {
        const st = inv.pockets[a.index];
        const h = this.heldItem();
        if (h) {
          const item = h.item;
          if (!ITEMS[item].pocket) return fail('Cet objet ne rentre pas dans une poche.');
          const one = this.stackFromProp(h.id, h.def)!;
          if (!st) {
            if (unitVolume(one) > POCKET_MAX_L) return fail('Trop gros pour une poche.');
            inv.pockets[a.index] = one;
          } else if (st.item === item && st.count < ITEMS[item].stack && stackVolume(st) + unitVolume(one) <= POCKET_MAX_L) st.count++;
          else return fail(`La poche ${a.index + 1} est occupée.`);
          this.props.remove(h.id);
          return ok();
        }
        if (this.props.held) return fail('Vos mains sont déjà prises.');
        if (!st) return fail(`La poche ${a.index + 1} est vide.`);
        return this.act({ type: 'sortir', from: { zone: 'poche', index: a.index } });
      }
      case 'utiliser': {
        const tool = this.useTool();
        if (tool) return tool;
        const h = this.heldItem();
        if (!h) return fail('Vous ne tenez rien à utiliser.');
        if (h.item === 'torche') return a.repeat ? fail() : this.lightTorch(h);
        if (ITEMS[h.item].food) return this.startEating({ zone: 'main' });
        const best = this.bestTreatmentFor(h.item);
        if (best) return this.startTreatment(best.injury, best.treatment);
        if (h.item === 'chiffon') return fail('Aucune blessure à bander.');
        if (h.item === 'aloes') return fail('Aucune plaie à désinfecter.');
        if (h.item === 'baton') return fail('Une attelle se pose sur une fracture (2 bâtons et 2 chiffons).');
        if (a.repeat) return fail();
        return fail('Rien à faire avec cet objet ici.');
      }
      case 'etabli_poser':
        return this.benchPut(a.from);
      case 'etabli_reprendre':
        return this.benchTake(a.index);
      case 'fabriquer':
        return this.craftNext();
      case 'reparer':
        return this.startRepair(a.from, a.kind);
      case 'ameliorer':
        return this.startImprove(a.from, a.kind);
      case 'demonter':
        return this.startDismantle(a.from);
      case 'remplir':
        return this.fillPot(a.from);
      case 'allumer':
        return this.startLighting(a.prop);
      case 'alimenter':
        return this.feedFire(a.prop);
      case 'poser_feu':
        return this.putOnFire(a.prop, a.from);
      case 'reprendre_feu':
        return this.takeFromFire(a.prop);
      case 'planifier':
        return this.planify(a.plan, a.aim, a.turn, a.on);
      case 'chantier':
        return this.startBuildStep(a.target);
      case 'annuler_chantier':
        return this.cancelSite(a.target);
      case 'piece':
        return this.pieceOp(a.s, a.p, a.op);
      case 'fourneau':
        return this.furnaceOp(a.prop, a.op);
      default:
        return fail();
    }
  }


  // ——— Phase 4 : récolte, fabrication, feu ———

  /** Effort physique hors déplacement : coûte de l'endurance et en suspend la récupération. */
  private exert(cost: number): void {
    const s = this.state;
    s.stamina = Math.max(0, s.stamina - cost);
    s.regenDelay = STAMINA.regenDelay;
    this.extraSpent += cost;
  }

  private noteHints(ids: RecipeId[]): void {
    if (ids.length) this.msg(`Nouvelle idée dans le carnet : ${ids.map((id) => RECIPES[id].label).join(', ')}.`, 'info');
  }

  /** Propriétés d'un exemplaire à garder sur l'objet posé dans le monde (sans la géométrie). */
  private propMeta(st: ItemStack): PropDef['meta'] | undefined {
    const m = metaOf(st);
    delete m.mass;
    delete m.radius;
    delete m.length;
    return Object.keys(m).length ? m : undefined;
  }

  /** Accès à un objet (en main ou dans l'inventaire) ; `commit` enregistre ses changements. */
  private stackRef(from: HandOrSlot): { st: ItemStack; commit: () => void; remove: () => void } | null {
    if (from.zone === 'main') {
      const h = this.heldItem();
      if (!h) return null;
      const st = this.stackFromProp(h.id, h.def)!;
      return {
        st,
        commit: () => {
          const m = this.propMeta(st);
          if (m) h.def.meta = m;
          else delete h.def.meta;
        },
        remove: () => {
          this.props.remove(h.id);
        },
      };
    }
    const st = stackAt(this.inventory, from);
    if (!st) return null;
    return {
      st,
      commit: () => undefined,
      remove: () => {
        const i = from.zone === 'poche' ? from.index : this.inventory.bag?.indexOf(st) ?? -1;
        if (i >= 0) takeAt(this.inventory, { zone: from.zone, index: i }, 1);
      },
    };
  }

  /** Objets utilisables comme outils (main, poches, sac ; pas le plan de travail). */
  private toolStacks(): ItemStack[] {
    const out: ItemStack[] = [];
    const h = this.heldItem();
    if (h) out.push(this.stackFromProp(h.id, h.def)!);
    for (const p of this.inventory.pockets) if (p) out.push(p);
    if (this.inventory.bag) out.push(...this.inventory.bag);
    return out;
  }

  /** Trouve un outil (de préférence en main). */
  private findTool(tag: ToolTag): { st: ItemStack; commit: () => void; remove: () => void } | null {
    const h = this.heldItem();
    if (h && hasTag(h.item, tag)) return this.stackRef({ zone: 'main' });
    const inv = this.inventory;
    const usable = (st: ItemStack) => hasTag(st.item, tag) && (st.d === undefined || st.d > 0);
    for (let i = 0; i < inv.pockets.length; i++) if (inv.pockets[i] && usable(inv.pockets[i]!)) return this.stackRef({ zone: 'poche', index: i });
    if (inv.bag) for (let i = 0; i < inv.bag.length; i++) if (usable(inv.bag[i]!)) return this.stackRef({ zone: 'sac', index: i });
    return null;
  }

  /** Use un outil d'un cran ; il casse à 0 (les galets ne s'usent pas). */
  private wearRef(ref: { st: ItemStack; commit: () => void; remove: () => void }, amount: number): void {
    const spec = ITEMS[ref.st.item].tool;
    if (!spec || spec.durability <= 0) return;
    const st = ref.st;
    if (st.count > 1) {
      // On n'use qu'un exemplaire : il devient un objet à part.
      st.count--;
      const one: ItemStack = { item: st.item, count: 1, ...metaOf(st) };
      ensureToolMeta(one);
      if (wear(one, amount)) {
        this.msg(`Un ${ITEMS[one.item].label} se casse.`, 'alerte');
        return;
      }
      if (store(this.inventory, one) > 0) this.dropOnGround(one);
      return;
    }
    ensureToolMeta(st);
    if (wear(st, amount)) {
      ref.remove();
      this.msg(`Votre ${ITEMS[st.item].label} se casse.`, 'alerte');
      return;
    }
    ref.commit();
  }

  private wearTool(tag: ToolTag, amount: number): void {
    const ref = this.findTool(tag);
    if (ref) this.wearRef(ref, amount);
  }

  /** Matériel d'un soin (un pansement propre plutôt qu'un chiffon quand on en a). */
  private needsFor(t: Treatment, needs: Array<[ItemId, number]>): Array<[ItemId, number]> {
    if (t === 'bander' && this.available('pansement') > 0) return [['pansement', 1]];
    return needs;
  }

  /** Dans l'eau (fleuve, lac) : on peut remplir un pot. */
  inWater(): boolean {
    const s = this.state;
    return s.mode === MODE_SWIM || WATER_LEVEL - s.y > 0.2;
  }

  /** Dépose un objet récolté au sol, à l'endroit donné. */
  private dropNear(st: ItemStack, x: number, z: number, k: number): void {
    const kind = st.item as PropKind;
    const shape = MASS_ITEMS.has(st.item) ? { radius: st.radius ?? 0.08, length: st.length ?? 0 } : itemShape(kind);
    const a = k * 2.1;
    const px = x + Math.cos(a) * 0.18 * k;
    const pz = z + Math.sin(a) * 0.18 * k;
    const y = this.terrain.heightAt(px, pz) + 0.35 + shape.radius;
    const meta = this.propMeta(st);
    this.props.spawnDynamic({ kind, x: px, y, z: pz, rot: (k * 0.31) % 1, ...shape, ...(meta ? { meta } : {}) });
  }

  /** Ce que ferait « Utiliser » sur la cible visée (indication à l'écran). `interact` : se fait avec « Prendre ». */
  useHint(): { action: string; ready: boolean; interact: boolean } | null {
    const s = this.state;
    if (s.mode === MODE_CLIMB || this.vitals.state !== 'eveille') return null;
    const h = this.heldItem();
    // Phase 6 : tenu par une créature, pris dans un piège, créature visée, carcasse, piège.
    if (this.fauna.grab) return { action: 'frapper pour vous libérer (ou débattez-vous)', ready: this.useCooldown <= 0, interact: false };
    if (this.trappedIn) return { action: this.props.defOf(this.trappedIn)?.kind === 'fosse' ? 'sortir de la fosse' : 'dégager votre pied', ready: true, interact: true };
    const heldTool = h ? ITEMS[h.item].tool : undefined;
    const prey = this.fauna.enabled ? this.fauna.rayHit(this.eye(), lookDirection(this.yaw, this.pitch), 1.1 + (heldTool?.reach ?? 0.1)) : null;
    if (prey) {
      const c = this.fauna.creatures.get(prey.id);
      if (c) return { action: `frapper ${speciesName(c.sp, 'le')}${h ? '' : ' (à mains nues)'}`, ready: this.useCooldown <= 0, interact: false };
    }
    const tp = this.props.target(s, this.yaw, this.pitch);
    if (tp?.kind === 'carcasse') {
      const k = this.props.defOf(tp.id)?.carcass;
      if (k) {
        if (k.meat <= 0) return { action: 'carcasse : il ne reste que les os', ready: false, interact: false };
        if (this.time - k.at > CARCASS_ROT) return { action: 'carcasse : la viande est avariée', ready: false, interact: false };
        return h && hasTag(h.item, 'tranchant') ? { action: `dépecer la carcasse (${k.meat} ${k.meat > 1 ? 'morceaux' : 'morceau'})`, ready: true, interact: false } : { action: 'dépecer : il faut une lame en main', ready: false, interact: false };
      }
    }
    if (tp && TRAP_KINDS.has(tp.kind)) {
      const t = this.props.defOf(tp.id)?.trap;
      if (t) {
        const caught = t.caught && t.caught !== 'joueur' ? this.fauna.creatures.get(t.caught) : null;
        if (caught && !caught.dead) return { action: `${speciesName(caught.sp, 'un')} est pris`, ready: false, interact: true };
        return { action: t.armed ? `${PROP_ARTICLE(tp.kind)} est tendu` : `réarmer ${PROP_ARTICLE(tp.kind)}`, ready: !t.armed, interact: true };
      }
    }
    if (h?.item === 'pot' && (this.inWater() || this.nearInstall('puits', 2.6))) return { action: 'remplir le pot d’eau', ready: true, interact: false };
    const t = this.props.target(s, this.yaw, this.pitch);
    const node = t && t.fixed && t.kind in NODE_SPECS ? t : null;
    const tree = this.props.targetTree(s, this.yaw, this.pitch);
    const bt = this.buildTarget();
    if (bt && (!t || bt.dist <= t.distance) && (!tree || bt.dist <= tree.distance)) {
      const bh = this.buildHint(bt, h);
      if (bh) return bh;
    }
    if (t && this.litTorchInHand() && (t.kind === 'foyer' || t.kind === 'forge' || t.kind === 'fourneau')) return { action: 'allumer avec la torche', ready: true, interact: false };
    if (h?.item === 'torche' && !h.def.fire?.lit) return { action: 'allumer la torche (près d’un feu)', ready: true, interact: false };
    if (node && (!tree || node.distance <= tree.distance)) {
      const kind = node.kind as NodeKind;
      const spec = NODE_SPECS[kind];
      const verb = NODE_VERB[kind];
      if (this.world.nodeLeft(node.id, kind, this.time) <= 0) return { action: `${spec.label} : épuisé pour l’instant`, ready: false, interact: false };
      if (!spec.tool) return { action: verb, ready: true, interact: true };
      if (!(h && hasTag(h.item, spec.tool))) return { action: `${verb} : il faut ${TOOL_NEEDS[spec.tool]} en main`, ready: false, interact: false };
      const done = this.strikes.get(node.id) ?? 0;
      return { action: `${verb}${done > 0 ? ` (${Math.round((done / spec.strikes) * 100)} %)` : ''}`, ready: true, interact: false };
    }
    if (!tree) return null;
    if (!h || !hasTag(h.item, 'tranchant')) return h ? { action: 'arbre : il faut un outil tranchant (éclat de quartz, couteau, hache)', ready: false, interact: false } : null;
    const spec = treeSpec(tree.species, tree.scale);
    const axe = hasTag(h.item, 'hache');
    if (axe && !s.crouched) return { action: `abattre l’arbre (${Math.round(this.world.fellProgress(tree.key, spec) * 100)} %) · accroupi : couper`, ready: true, interact: false };
    const key = tree.key;
    const resin = this.world.resinState(key, this.time);
    if (resin === 'prete') return { action: 'récolter la résine', ready: true, interact: false };
    if (this.world.partLeft(key, 'ilala', spec, this.time) > 0) return { action: 'couper des feuilles d’ilala', ready: true, interact: false };
    if (axe && this.world.partLeft(key, 'perche', spec, this.time) > 0) return { action: 'couper une perche', ready: true, interact: false };
    if (this.world.partLeft(key, 'ecorce', spec, this.time) > 0) return { action: 'écorcer (bandes d’écorce)', ready: true, interact: false };
    if (this.world.partLeft(key, 'manche', spec, this.time) > 0) return { action: 'couper une branche verte', ready: true, interact: false };
    if (spec.resin && resin === 'aucune') return { action: 'entailler l’écorce pour la résine', ready: true, interact: false };
    return { action: resin === 'coule' ? 'la résine coule : revenez plus tard' : 'cet arbre n’a plus rien à donner pour l’instant', ready: false, interact: false };
  }

  /** Indication pour une pièce ou un chantier visé. */
  private buildHint(bt: BuildTarget, h: { id: string; def: PropDef; item: ItemId } | null): { action: string; ready: boolean; interact: boolean } | null {
    const ref = this.refOf(bt);
    const info = this.stepInfo(ref);
    if (info) {
      const step = info.steps[info.index]!;
      const fix = this.chooseFixing(step, info.center);
      const where = `${PLANS[info.plan].label.toLowerCase()}, étape ${info.index + 1}/${info.steps.length}`;
      const miss = this.missingNeed(fix.needs, info.center);
      if (miss) return { action: `${fix.label.toLowerCase()} (${where}) : il manque ${needLabel(miss)}`, ready: false, interact: false };
      if (fix.tool && !this.findTool(fix.tool)) return { action: `${fix.label.toLowerCase()} (${where}) : il faut ${TOOL_NEEDS[fix.tool]}`, ready: false, interact: false };
      const what = fix.needs.length ? ` (${fix.needs.map(needLabel).join(', ')})` : '';
      return { action: `${fix.label.toLowerCase()}${what} · ${where}`, ready: true, interact: false };
    }
    if (bt.kind !== 'piece') return null;
    const p = this.build.piece(bt.s, bt.p);
    if (!p) return null;
    const label = PLANS[p.plan].label;
    if (PLANS[p.plan].piece === 'porte') return { action: p.open ? 'fermer la porte' : 'ouvrir la porte', ready: true, interact: true };
    if (h?.item === 'torche' && h.def.fire?.lit && combustible(p.mat) && p.burning <= 0) return { action: `mettre le feu : ${label.toLowerCase()}`, ready: true, interact: false };
    if (h?.item === 'pot' && p.burning > 0) return { action: 'éteindre le feu avec l’eau du pot', ready: (this.findWaterPot() !== null), interact: false };
    const state = `stabilité ${Math.round(p.support * 100)} % · état ${Math.round((p.hp / maxHp(p)) * 100)} %${p.burning > 0 ? ' · EN FEU' : ''}`;
    if (h && ITEMS[h.item].tool) return { action: `frapper : ${label.toLowerCase()} (${state})`, ready: true, interact: false };
    // Les mains prises, E pose l'objet tenu : pas d'options.
    if (this.props.held) return null;
    return { action: `${label} (${state}) : options`, ready: true, interact: true };
  }

  /** « Utiliser » avec un outil sur un gisement ou un arbre ; null si aucune cible à travailler. */
  private useTool(): ActionResult | null {
    const s = this.state;
    if (s.mode === MODE_CLIMB) return null;
    const h = this.heldItem();
    // Phase 6 : une créature visée (ou celle qui vous tient) passe avant tout.
    const fight = this.attackCreature(h);
    if (fight) return fight;
    if (h?.item === 'pot' && (this.inWater() || this.nearInstall('puits', 2.6))) return this.fillPot({ zone: 'main' });
    const t = this.props.target(s, this.yaw, this.pitch);
    const node = t && t.fixed && t.kind in NODE_SPECS ? t : null;
    const tree = this.props.targetTree(s, this.yaw, this.pitch);
    const bt = this.buildTarget();
    if (bt && (!t || bt.dist <= t.distance) && (!tree || bt.dist <= tree.distance)) {
      const r = this.useOnBuild(bt, h);
      if (r) return r;
    }
    // Torche allumée : allumer un foyer, une forge ou un fourneau visé.
    if (t && this.litTorchInHand() && (t.kind === 'foyer' || t.kind === 'forge' || t.kind === 'fourneau')) return this.startLighting(t.id);
    // Carcasse : la dépecer avec une lame.
    if (t && t.kind === 'carcasse') return this.startButcher(t.id, h);
    if (!node && !tree) return null;
    if (this.useCooldown > 0) return fail();
    if (node && (!tree || node.distance <= tree.distance)) return this.harvestNode(node, h);
    return this.harvestTree(tree!, h);
  }

  private harvestNode(t: PropTarget, h: { id: string; def: PropDef; item: ItemId } | null): ActionResult {
    const kind = t.kind as NodeKind;
    const spec = NODE_SPECS[kind];
    const s = this.state;
    if (spec.tool && !(h && hasTag(h.item, spec.tool))) {
      if (kind === 'gravier_or' && hintRecipe(this.knowledge, 'batee')) this.noteHints(['batee']);
      return fail(`Il faut ${TOOL_NEEDS[spec.tool]} en main.`);
    }
    if (this.world.nodeLeft(t.id, kind, this.time) <= 0) return fail('Plus rien à prendre ici pour l’instant : cela se reconstitue avec le temps.');
    const cost = STRIKE_COST[spec.tool ?? 'main']!;
    if (s.stamina < cost) return fail('Trop fatigué : reprenez votre souffle.');
    this.exert(cost);
    this.useCooldown = STRIKE_TIME;
    this.fauna.noise(s.x, s.z, spec.tool === 'percuteur' || spec.tool === 'fouir' ? 30 : 12);
    const ref = h && spec.tool ? this.stackRef({ zone: 'main' }) : null;
    const power = ref ? toolPower(ref.st) : 1;
    if (ref) this.wearRef(ref, 1);
    const done = (this.strikes.get(t.id) ?? 0) + power;
    if (done < spec.strikes - 1e-6) {
      this.strikes.set(t.id, done);
      return ok();
    }
    this.strikes.delete(t.id);
    this.world.useNode(t.id, kind, this.time);
    if (rand(this.vitals) >= spec.chance) return ok('Rien cette fois… Continuez à laver le gravier.');
    const pos = this.props.position(t.id) ?? { x: s.x, y: s.y, z: s.z };
    const n = spec.amount === 1 ? 1 : 1 + Math.floor(rand(this.vitals) * spec.amount);
    for (let k = 0; k < n; k++) this.dropNear({ item: spec.yields, count: 1 }, pos.x + (s.x - pos.x) * 0.45, pos.z + (s.z - pos.z) * 0.45, k);
    if (kind === 'touffe_herbe') return ok('Vous arrachez une brassée d’herbes sèches.');
    if (kind === 'gravier_or') return ok('Une pépite d’or brille au fond de la batée !');
    return ok(`${cap(itemName(spec.yields, n))} ${n > 1 ? 'tombent' : 'tombe'} au sol.`);
  }

  private harvestTree(tree: TreeTarget, h: { id: string; def: PropDef; item: ItemId } | null): ActionResult {
    const s = this.state;
    if (!h || !hasTag(h.item, 'tranchant')) return fail('Il faut un outil tranchant en main : un éclat de quartz ou un couteau pour écorcer et couper, une hache pour abattre.');
    const spec = treeSpec(tree.species, tree.scale);
    const axe = hasTag(h.item, 'hache');
    const ref = this.stackRef({ zone: 'main' })!;
    const power = toolPower(ref.st);
    const cost = axe ? STRIKE_COST.hache! : STRIKE_COST.tranchant!;
    if (s.stamina < cost) return fail('Trop fatigué : reprenez votre souffle.');
    if (axe && !s.crouched) {
      this.exert(cost);
      this.useCooldown = STRIKE_TIME;
      this.wearRef(ref, 1);
      this.fauna.noise(s.x, s.z, 40);
      const r = this.world.fellStrike(tree.key, spec, power, this.time);
      if (r.felled) {
        this.onTreeFelled(tree, spec.logs);
        return ok('L’arbre s’abat ! Les bûches sont au sol.');
      }
      return ok();
    }
    // Outil tranchant : résine prête, feuilles (palmier), perche (hache, accroupi), écorce, branche, entaille.
    const key = tree.key;
    const resin = this.world.resinState(key, this.time);
    let part: TreePart | 'resine' | 'entaille' | null = null;
    if (resin === 'prete') part = 'resine';
    else if (this.world.partLeft(key, 'ilala', spec, this.time) > 0) part = 'ilala';
    else if (axe && this.world.partLeft(key, 'perche', spec, this.time) > 0) part = 'perche';
    else if (this.world.partLeft(key, 'ecorce', spec, this.time) > 0) part = 'ecorce';
    else if (this.world.partLeft(key, 'manche', spec, this.time) > 0) part = 'manche';
    else if (spec.resin && resin === 'aucune') part = 'entaille';
    if (!part) return fail(resin === 'coule' ? 'La résine coule encore : revenez dans quelques minutes.' : 'Cet arbre n’a plus rien à donner pour l’instant : il repoussera.');
    this.exert(cost);
    this.useCooldown = STRIKE_TIME;
    if (part !== 'resine') this.wearRef(ref, 1);
    const need = part === 'perche' ? 3 : part === 'ecorce' || part === 'manche' ? 2 : 1;
    const sk = `${key}:${part}`;
    const done = (this.strikes.get(sk) ?? 0) + (part === 'resine' || part === 'entaille' ? 1 : power);
    if (done < need - 1e-6) {
      this.strikes.set(sk, done);
      return ok();
    }
    this.strikes.delete(sk);
    const x = s.x + (tree.x - s.x) * 0.5;
    const z = s.z + (tree.z - s.z) * 0.5;
    if (part === 'resine') {
      this.world.takeResin(key, this.time);
      this.dropNear({ item: 'resine', count: 1 }, x, z, 0);
      return ok('Une boulette de résine tombe au sol.');
    }
    if (part === 'entaille') {
      this.world.incise(key, this.time);
      return ok('Vous entaillez l’écorce : la résine coulera dans une dizaine de minutes.');
    }
    this.world.usePart(key, part, spec, this.time);
    const item: ItemId = part;
    this.dropNear({ item, count: 1 }, x, z, 0);
    return ok(`${cap(itemName(item))} tombe au sol.`);
  }

  private onTreeFelled(tree: TreeTarget, logs: number): void {
    this.phys.rebuildChunk(tree.cx, tree.cz);
    // Un arbre qui tombe s'entend de très loin.
    this.fauna.noise(tree.x, tree.z, 120);
    const s = this.state;
    // L'arbre tombe à l'opposé du joueur : les bûches s'alignent le long du tronc.
    let dx = tree.x - s.x;
    let dz = tree.z - s.z;
    const l = Math.hypot(dx, dz) || 1;
    dx /= l;
    dz /= l;
    for (let i = 0; i < logs; i++) {
      const d = 1.2 + i * 0.9;
      const r = 0.06 + rand(this.vitals) * 0.02;
      const length = 0.5 + rand(this.vitals) * 0.2;
      this.dropNear({ item: 'buche', count: 1, radius: r, length }, tree.x + dx * d, tree.z + dz * d, 0);
    }
    this.dropNear({ item: 'baton', count: 1 }, tree.x + dz * 1.5, tree.z - dx * 1.5, 0);
    this.dropNear({ item: 'baton', count: 1 }, tree.x - dz * 1.5, tree.z + dx * 1.5, 0);
  }

  // Plan de travail.

  private benchAdd(st: ItemStack): boolean {
    const b = this.inventory.bench;
    const plain = (x: ItemStack) => Object.keys(metaOf(x)).length === 0;
    const same = b.find((x) => x.item === st.item && !MASS_ITEMS.has(st.item) && plain(x) && plain(st) && x.count + st.count <= ITEMS[st.item].stack);
    if (same) {
      same.count += st.count;
      return true;
    }
    if (b.length >= BENCH_SLOTS) return false;
    b.push(st);
    return true;
  }

  private benchPut(from: HandOrSlot): ActionResult {
    const inv = this.inventory;
    if (from.zone === 'main') {
      const h = this.heldItem();
      if (!h) return fail('Vous ne tenez rien.');
      const st = this.stackFromProp(h.id, h.def);
      if (!st) return fail('Cet objet ne va pas sur le plan de travail.');
      if (!this.benchAdd(st)) return fail('Le plan de travail est plein (6 emplacements).');
      this.props.remove(h.id);
    } else {
      const cur = stackAt(inv, from);
      if (!cur) return fail();
      // Un outil (éclat de quartz…) se pose un par un : les autres restent sous la main pour travailler.
      const n = (ITEMS[cur.item].tool?.durability ?? 0) > 0 ? 1 : cur.count;
      if (!this.benchAdd({ ...cur, count: n })) return fail('Le plan de travail est plein (6 emplacements).');
      takeAt(inv, from, n);
    }
    this.craft = null;
    return ok();
  }

  private benchTake(index: number): ActionResult {
    const b = this.inventory.bench;
    const st = b[index];
    if (!st) return fail();
    b.splice(index, 1);
    const left = store(this.inventory, st);
    if (left > 0) this.dropOnGround({ ...st, count: left });
    this.craft = null;
    return ok();
  }

  /** Recette reconnue sur le plan de travail, avec l'étape suivante (pour l'affichage). */
  benchRecipe(): { recipe: (typeof RECIPES)[RecipeId]; step: number; known: boolean } | null {
    const r = matchRecipe(this.inventory.bench);
    if (!r) return null;
    const step = this.craft && this.craft.recipe === r.id ? this.craft.step : 0;
    return { recipe: r, step, known: this.knowledge.known.includes(r.id) };
  }

  /** Outil disponible pour une étape (pour l'affichage). */
  hasTool(tag: ToolTag | null): boolean {
    if (!tag) return true;
    return stepToolOk({ label: '', tool: tag, seconds: 0 }, this.toolStacks());
  }

  private findBoiledPot(): { st: ItemStack; commit: () => void; remove: () => void } | null {
    const h = this.heldItem();
    if (h?.item === 'pot' && h.def.meta?.w === 2) return this.stackRef({ zone: 'main' });
    const inv = this.inventory;
    for (let i = 0; i < inv.pockets.length; i++) if (inv.pockets[i]?.item === 'pot' && inv.pockets[i]!.w === 2) return this.stackRef({ zone: 'poche', index: i });
    if (inv.bag) for (let i = 0; i < inv.bag.length; i++) if (inv.bag[i]!.item === 'pot' && inv.bag[i]!.w === 2) return this.stackRef({ zone: 'sac', index: i });
    return null;
  }

  private craftNext(): ActionResult {
    const bench = this.inventory.bench;
    const r = matchRecipe(bench);
    if (!r) return fail(experimentHint(bench, this.knowledge));
    let discovered = false;
    if (learn(this.knowledge, r.id)) discovered = true;
    if (!this.craft || this.craft.recipe !== r.id) this.craft = { recipe: r.id, step: 0 };
    const step = r.steps[this.craft.step]!;
    const intro = discovered ? `Nouvelle recette découverte : ${r.label} ! ` : '';
    if (r.boiledWater && !this.findBoiledPot()) return discovered ? ok(`${intro}Il faut un pot d’eau bouillante.`) : fail('Il faut un pot d’eau bouillante (rempli au fleuve, chauffé sur un feu allumé).');
    if (r.station === 'forge' && !this.nearInstall('forge', 3, true)) return discovered ? ok(`${intro}Il faut une forge allumée à côté.`) : fail('Il faut une forge allumée à moins de 3 m.');
    if (!stepToolOk(step, this.toolStacks())) {
      const need = `Il faut ${TOOL_NEEDS[step.tool!]} pour : ${step.label.toLowerCase()}.`;
      return discovered ? ok(`${intro}${need}`) : fail(need);
    }
    // À côté d'un établi : gestes plus rapides.
    const seconds = step.seconds * (1 - 0.04 * skillLevel(this.knowledge.xp)) * (this.nearInstall('etabli', 3) ? 0.8 : 1);
    this.gesture = { kind: 'fabrication', label: `${step.label}… (${this.craft.step + 1}/${r.steps.length})`, total: seconds, left: seconds, recipe: r.id, step: this.craft.step };
    return discovered ? ok(intro.trim()) : ok();
  }

  private finishCraftStep(id: RecipeId, stepIndex: number): void {
    const r = RECIPES[id];
    if (!this.craft || this.craft.recipe !== id || this.craft.step !== stepIndex || matchRecipe(this.inventory.bench)?.id !== id) return;
    const step = r.steps[stepIndex]!;
    if (step.tool && step.tool !== 'recipient') this.wearTool(step.tool, 1);
    this.craft.step++;
    if (this.craft.step < r.steps.length) {
      this.msg(`Étape faite. Suivante : ${r.steps[this.craft.step]!.label.toLowerCase()}.`, 'info');
      return;
    }
    this.craft = null;
    const used: ItemStack[] = [];
    for (const [item, n] of r.inputs) {
      let need = n;
      const b = this.inventory.bench;
      for (let i = b.length - 1; i >= 0 && need > 0; i--) {
        const st = b[i]!;
        if (st.item !== item) continue;
        const k = Math.min(need, st.count);
        used.push({ ...st, count: k });
        st.count -= k;
        need -= k;
        if (st.count <= 0) b.splice(i, 1);
      }
    }
    // À côté d'un établi : meilleure qualité.
    const level = skillLevel(this.knowledge.xp) + (this.nearInstall('etabli', 3) ? 2 : 0);
    this.knowledge.xp += 10 * r.steps.length;
    if ('place' in r.output) {
      this.placeFire();
      this.msg('Foyer monté. Allumez-le avec un archet à feu et des herbes sèches.', 'info');
      return;
    }
    const out: ItemStack = { item: r.output.item, count: r.output.count };
    let detail = '';
    const tool = ITEMS[out.item].tool;
    if (tool && tool.durability > 0) {
      const { q, fx } = craftQuality(used, level, rand(this.vitals), rand(this.vitals), rand(this.vitals));
      out.q = q;
      if (fx) out.fx = fx;
      out.dm = maxDurability(out.item, q, fx);
      out.d = out.dm;
      const label = q < 40 ? 'médiocre' : q < 70 ? 'correcte' : q < 85 ? 'bonne' : 'excellente';
      detail = ` : qualité ${label}${fx & FX_LIGATURE_LACHE ? ', ligature un peu lâche' : fx & FX_MANCHE_FENDU ? ', manche fendu' : ''}`;
    } else if (out.item === 'pot_cru') out.q = Math.round(Math.max(20, Math.min(100, 50 + level * 4 + rand(this.vitals) * 25)));
    if (r.burn) {
      out.d = r.burn;
      out.dm = r.burn;
    }
    if (r.boiledWater) {
      const pot = this.findBoiledPot();
      if (pot) {
        pot.st.w = 0;
        pot.commit();
      }
    }
    const left = store(this.inventory, out);
    if (left > 0) this.dropOnGround({ ...out, count: left });
    this.msg(`Vous avez fabriqué ${itemName(out.item, out.count)}${detail}.`, 'info');
    this.noteHints(hintFrom(this.knowledge, out.item));
    this.notePlans(out.item);
  }

  // Réparer, améliorer, démonter.

  private startRepair(from: HandOrSlot, kind: RepairKind): ActionResult {
    const ref = this.stackRef(from);
    if (!ref) return fail();
    ensureToolMeta(ref.st);
    ref.commit();
    const opt = repairOptions(ref.st).find((o) => o.kind === kind);
    if (!opt) return fail('Rien à réparer de cette façon.');
    for (const [item, n] of opt.needs) if (this.available(item) < n) return fail(`Il vous faut ${itemName(item, n)}.`);
    if (opt.tool && !this.findTool(opt.tool)) return fail(`Il faut ${TOOL_NEEDS[opt.tool]}.`);
    this.gesture = { kind: 'reparation', label: `${opt.label}…`, total: opt.seconds, left: opt.seconds, from, repair: kind };
    return ok();
  }

  private finishRepair(from: HandOrSlot, kind: RepairKind): void {
    const ref = this.stackRef(from);
    if (!ref) return;
    const st = ref.st;
    const opt = repairOptions(st).find((o) => o.kind === kind);
    if (!opt) return;
    for (const [item, n] of opt.needs) if (this.available(item) < n) return this.msg(`Il vous manque ${itemName(item, n)}.`, 'alerte');
    for (const [item, n] of opt.needs) this.use(item, n);
    if (opt.tool) this.wearTool(opt.tool, 1);
    applyRepair(st, kind);
    ref.commit();
    this.knowledge.xp += 5;
    this.msg(`${opt.label} : c’est fait (${st.d}/${st.dm}).`, 'info');
  }

  /** Un feu allumé à portée de main (pour l'affichage et les gestes au feu). */
  fireNearby(): boolean {
    return this.litFireNear(3);
  }

  private litFireNear(radius: number): boolean {
    const s = this.state;
    for (const { def, fire } of this.props.fires()) {
      if (!fire.lit) continue;
      const p = this.props.position(def.id);
      if (p && Math.hypot(p.x - s.x, p.z - s.z) <= radius) return true;
    }
    return false;
  }

  private startImprove(from: HandOrSlot, kind: ImproveKind): ActionResult {
    const ref = this.stackRef(from);
    if (!ref) return fail();
    const opt = improveOptions(ref.st).find((o) => o.kind === kind);
    if (!opt) return fail('Cette amélioration ne convient pas.');
    for (const [item, n] of opt.needs) if (this.available(item) < n) return fail(`Il vous faut ${itemName(item, n)}.`);
    if (opt.fire && !this.litFireNear(3)) return fail('Il faut un feu allumé tout près.');
    this.gesture = { kind: 'amelioration', label: `${opt.label}…`, total: opt.seconds, left: opt.seconds, from, improve: kind };
    return ok();
  }

  private finishImprove(from: HandOrSlot, kind: ImproveKind): void {
    const ref = this.stackRef(from);
    if (!ref) return;
    const st = ref.st;
    const opt = improveOptions(st).find((o) => o.kind === kind);
    if (!opt) return;
    if (opt.fire && !this.litFireNear(3)) return this.msg('Le feu s’est éteint.', 'alerte');
    for (const [item, n] of opt.needs) if (this.available(item) < n) return this.msg(`Il vous manque ${itemName(item, n)}.`, 'alerte');
    for (const [item, n] of opt.needs) this.use(item, n);
    applyImprove(st, kind);
    ref.commit();
    this.knowledge.xp += 5;
    this.msg(`${opt.label} : plus solide (${st.d}/${st.dm}).`, 'info');
  }

  private startDismantle(from: HandOrSlot): ActionResult {
    const ref = this.stackRef(from);
    if (!ref) return fail();
    if (!canDismantle(ref.st.item)) return fail('Cet objet ne se démonte pas.');
    this.gesture = { kind: 'demontage', label: `Vous démontez ${itemName(ref.st.item)}…`, total: 3, left: 3, from };
    return ok();
  }

  private finishDismantle(from: HandOrSlot): void {
    const ref = this.stackRef(from);
    if (!ref || !canDismantle(ref.st.item)) return;
    const one: ItemStack = { ...ref.st, count: 1 };
    ref.remove();
    const parts = dismantle(one, () => rand(this.vitals));
    for (const p of parts) {
      const left = store(this.inventory, p);
      if (left > 0) this.dropOnGround({ ...p, count: left });
    }
    this.msg(parts.length ? `Vous récupérez : ${parts.map((p) => itemName(p.item, p.count)).join(', ')}.` : 'Rien de récupérable : les pièces étaient trop usées.', 'info');
  }

  // Feu et eau.

  private placeFire(): void {
    const s = this.state;
    const dir = lookDirection(this.yaw, 0);
    const x = s.x + dir.x * 1.3;
    const z = s.z + dir.z * 1.3;
    const fire: FireState = { lit: false, fuel: 0, pot: null, cook: 0 };
    // Sur un plancher, le foyer repose sur le plancher (attention : le bois peut prendre feu).
    const floor = floorUnder(this.build, x, s.y + 0.3, z);
    const y = floor ? floor.top : this.terrain.heightAt(x, z);
    const on = floor ? { s: floor.s, p: floor.p } : undefined;
    this.props.spawnDynamic({ kind: 'foyer', x, y: y + 0.12, z, rot: 0, ...itemShape('foyer'), fixed: true, fire, ...(on ? { on } : {}) });
    if (floor && combustible(this.build.piece(floor.s, floor.p)?.mat ?? 'pierre')) this.msg('Attention : un feu sur un plancher de bois peut l’enflammer. Un dallage de pierre est plus sûr.', 'alerte');
  }

  private fireDef(prop: string): PropDef | null {
    const def = this.reachable(prop);
    return (def?.kind === 'foyer' || def?.kind === 'forge') && def.fire ? def : null;
  }

  private startLighting(prop: string): ActionResult {
    const fdef = this.reachable(prop);
    const furnace = fdef?.kind === 'fourneau' ? fdef.furnace : undefined;
    const def = furnace ? fdef : this.fireDef(prop);
    if (!def) return fail('Trop loin du foyer.');
    if (furnace) {
      if (furnace.lit) return fail('Le fourneau brûle déjà.');
      if (furnace.fuel <= 0) return fail('Chargez d’abord du bois dans le fourneau.');
    } else if (def.fire!.lit) return fail('Le feu brûle déjà.');
    if (this.litTorchInHand()) {
      if (furnace) {
        furnace.lit = true;
        furnace.heat = Math.max(furnace.heat, 20);
        return ok('Le bois du fourneau s’embrase. Actionnez le soufflet pour faire monter la chaleur.');
      }
      def.fire!.lit = true;
      def.fire!.fuel = Math.max(def.fire!.fuel, FIRE_START);
      return ok('Vous allumez le feu avec la torche.');
    }
    if (!this.findTool('feu')) return fail('Il faut un archet à feu (ou une torche allumée).');
    if (this.available('herbe') < 1) return fail('Il faut des herbes sèches comme amadou.');
    if (this.state.stamina < 20) return fail('Trop fatigué pour faire tourner l’archet.');
    const seconds = 6 * (1 - 0.04 * skillLevel(this.knowledge.xp));
    this.gesture = { kind: 'allumage', label: 'Vous faites tourner l’archet…', total: seconds, left: seconds, prop };
    return ok();
  }

  private finishLighting(prop: string): void {
    const fdef = this.reachable(prop);
    if (fdef?.kind === 'fourneau' && fdef.furnace) {
      if (fdef.furnace.lit) return;
      if (this.available('herbe') < 1) return this.msg('Il manque des herbes sèches.', 'alerte');
      this.use('herbe', 1);
      this.wearTool('feu', 1);
      fdef.furnace.lit = true;
      fdef.furnace.heat = Math.max(fdef.furnace.heat, 20);
      this.knowledge.xp += 5;
      this.msg('Le bois du fourneau s’embrase. Actionnez le soufflet pour faire monter la chaleur.', 'info');
      return;
    }
    const def = this.fireDef(prop);
    if (!def || def.fire!.lit) return;
    if (this.available('herbe') < 1) return this.msg('Il manque des herbes sèches.', 'alerte');
    this.use('herbe', 1);
    this.wearTool('feu', 1);
    def.fire!.lit = true;
    def.fire!.fuel = Math.max(def.fire!.fuel, FIRE_START);
    this.knowledge.xp += 5;
    this.msg('Une braise, puis une flamme : le feu prend ! Ajoutez du bois pour l’entretenir.', 'info');
  }

  private feedFire(prop: string): ActionResult {
    const def = this.fireDef(prop);
    if (!def) return fail('Trop loin du foyer.');
    const f = def.fire!;
    if (f.fuel >= 1800) return fail('Le foyer est plein de bois.');
    if (this.available('buche') > 0) {
      this.use('buche', 1);
      f.fuel += FUEL_LOG;
    } else if (this.available('baton') > 0) {
      this.use('baton', 1);
      f.fuel += FUEL_STICK;
    } else return fail('Il faut du bois : un bâton ou une bûche.');
    return ok(f.lit ? 'Vous ajoutez du bois.' : 'Vous ajoutez du bois. Le feu est éteint : allumez-le.');
  }

  private putOnFire(prop: string, from: HandOrSlot): ActionResult {
    const def = this.fireDef(prop);
    if (!def) return fail('Trop loin du foyer.');
    const f = def.fire!;
    if (f.pot) return fail('Il y a déjà un pot sur le feu.');
    const ref = this.stackRef(from);
    if (!ref) return fail();
    if (ref.st.item === 'viande_crue') {
      // Jusqu'à 4 morceaux à la fois, sur les pierres du foyer.
      const n = Math.min(4, ref.st.count);
      f.pot = { item: 'viande_crue', count: n };
      f.cook = 0;
      if (n >= ref.st.count) ref.remove();
      else {
        ref.st.count -= n;
        ref.commit();
      }
      return ok(`La viande grille sur le feu (${n} ${n > 1 ? 'morceaux' : 'morceau'}) : trois quarts de minute, feu allumé.`);
    }
    if (ref.st.item !== 'pot' && ref.st.item !== 'pot_cru') return fail('Seuls un pot ou de la viande crue se posent sur le feu.');
    f.pot = { ...ref.st, count: 1 };
    f.cook = 0;
    ref.remove();
    if (f.pot.item === 'pot_cru') return ok('Le pot cuit sur le feu : environ une minute et demie, feu allumé.');
    return ok(f.pot.w === 1 ? 'L’eau chauffe : une demi-minute, feu allumé.' : 'Pot posé sur le feu (il est vide : remplissez-le au fleuve).');
  }

  private takeFromFire(prop: string): ActionResult {
    const def = this.fireDef(prop);
    if (!def) return fail('Trop loin du foyer.');
    const f = def.fire!;
    if (!f.pot) return fail('Rien sur le feu.');
    const st = f.pot;
    f.pot = null;
    f.cook = 0;
    const left = store(this.inventory, st);
    if (left > 0) this.dropOnGround(st);
    return ok();
  }

  private fillPot(from: HandOrSlot): ActionResult {
    if (!this.inWater() && !this.nearInstall('puits', 2.6)) return fail('Il faut être dans l’eau (fleuve, lac) ou à côté d’un puits pour remplir le pot.');
    const ref = this.stackRef(from);
    if (!ref || ref.st.item !== 'pot') return fail('Il faut un pot en terre cuite.');
    ensureToolMeta(ref.st);
    ref.st.w = 1;
    ref.commit();
    return ok('Le pot est plein d’eau. Posez-le sur un feu allumé pour la faire bouillir.');
  }

  /** Le feu brûle son bois ; l'eau bout ; l'argile cuit. */
  private stepFires(dt: number): void {
    const s = this.state;
    for (const { def, fire } of this.props.fires()) {
      if (!fire.lit) continue;
      fire.fuel -= dt;
      const pos = this.props.position(def.id);
      const near = pos ? Math.hypot(pos.x - s.x, pos.z - s.z) < 12 : false;
      if (def.kind === 'torche') {
        if (fire.fuel <= 0) {
          this.props.remove(def.id);
          if (near) this.msg('La torche s’est consumée.', 'info');
        }
        continue;
      }
      if (fire.fuel <= 0) {
        fire.fuel = 0;
        fire.lit = false;
        if (near) this.msg('Le feu s’est éteint.', 'info');
        continue;
      }
      if (!fire.pot) continue;
      fire.cook += dt;
      if (fire.pot.item === 'pot' && fire.pot.w === 1 && fire.cook >= BOIL_TIME) {
        fire.pot.w = 2;
        if (near) this.msg('L’eau bout dans le pot.', 'info');
      } else if (fire.pot.item === 'viande_crue' && fire.cook >= MEAT_COOK) {
        fire.pot = { item: 'viande_cuite', count: fire.pot.count };
        fire.cook = 0;
        if (near) this.msg('La viande est cuite : reprenez-la sur le foyer.', 'info');
      } else if (fire.pot.item === 'pot_cru' && fire.cook >= FIRING_TIME) {
        const q = fire.pot.q ?? 60;
        const dm = maxDurability('pot', q, 0);
        fire.pot = { item: 'pot', count: 1, q, dm, d: dm, w: 0 };
        fire.cook = 0;
        if (near) this.msg('Le pot est cuit : il tiendra l’eau.', 'info');
        this.noteHints(hintFrom(this.knowledge, 'pot'));
      }
    }
  }

  // ——— Phase 5 : construction ———

  private eye(): { x: number; y: number; z: number } {
    const s = this.state;
    return { x: s.x, y: s.y + (s.crouched ? EYE_HEIGHT_CROUCH : EYE_HEIGHT), z: s.z };
  }

  /** Pièce, chantier ou installation en chantier visé (le terrain peut cacher la cible). */
  buildTarget(): BuildTarget | null {
    const o = this.eye();
    const d = lookDirection(this.yaw, this.pitch);
    const bt = rayBuild(this.build, o, d, BUILD_REACH);
    if (!bt) return null;
    const hit = this.phys.world.castRay(new RAPIER.Ray(o, d), bt.dist, true, undefined, QUERY_TERRAIN);
    if (hit && hit.timeOfImpact < bt.dist - 0.05 && !this.structPhys.pieceOf(hit.collider.handle)) return null;
    return bt;
  }

  /** Point visé pour tracer un plan (sol ou pièce), et le plancher visé s'il y en a un. */
  aimPoint(): { aim: { x: number; y: number; z: number }; on: { s: string; p: number } | null } {
    const o = this.eye();
    const d = lookDirection(this.yaw, this.pitch);
    const hit = this.phys.world.castRayAndGetNormal(new RAPIER.Ray(o, d), PLACE_REACH, true, undefined, QUERY_BUILD);
    if (hit) {
      const t = hit.timeOfImpact;
      const aim = { x: o.x + d.x * t, y: o.y + d.y * t, z: o.z + d.z * t };
      const piece = this.structPhys.pieceOf(hit.collider.handle);
      let on: { s: string; p: number } | null = null;
      if (piece && hit.normal.y > 0.7) {
        const p = this.build.piece(piece.s, piece.p);
        const kind = p ? PLANS[p.plan].piece : null;
        if (kind === 'sol' || kind === 'dallage') on = piece;
      }
      return { aim, on };
    }
    const x = o.x + d.x * PLACE_REACH;
    const z = o.z + d.z * PLACE_REACH;
    return { aim: { x, y: this.terrain.heightAt(x, z), z }, on: null };
  }

  /** Aperçu d'un plan à l'endroit visé (fantôme), sans rien modifier. */
  previewPlan(plan: PlanId, turn: number): ReturnType<BuildState['placement']> {
    const { aim, on } = this.aimPoint();
    const s = this.state;
    return this.build.placement({ plan, aim, yaw: this.yaw, turn, onPiece: on, player: { x: s.x, y: s.y, z: s.z } });
  }

  private refOf(bt: BuildTarget): BuildRef {
    return bt.kind === 'piece' ? { kind: 'piece', s: bt.s, p: bt.p } : { kind: 'site', id: bt.id };
  }

  /** Étape suivante d'un chantier, avec ce qu'il faut (fixation en fer si on en a). */
  private stepInfo(ref: BuildRef): { steps: PlanStep[]; index: number; plan: PlanId; center: { x: number; y: number; z: number } } | null {
    if (ref.kind === 'piece') {
      const s = this.build.structure(ref.s);
      const p = s?.pieces.find((q) => q.id === ref.p);
      if (!s || !p || isDone(p)) return null;
      const t = pieceTransform(s, p.slot);
      return { steps: stepsOf(p.plan, p.stilts), index: p.step, plan: p.plan, center: { x: t.x, y: t.y, z: t.z } };
    }
    const site = this.build.site(ref.id);
    if (!site) return null;
    return { steps: PLANS[site.plan].steps, index: site.step, plan: site.plan, center: { x: site.x, y: site.y, z: site.z } };
  }

  private chooseFixing(step: PlanStep, c: { x: number; y: number; z: number }): { needs: Need[]; tool: ToolTag | null; label: string; iron: boolean } {
    const iron = step.iron;
    if (iron && !this.missingNeed(iron.needs, c) && (!iron.tool || this.findTool(iron.tool))) return { needs: iron.needs, tool: iron.tool, label: iron.label, iron: true };
    return { needs: step.needs, tool: step.tool, label: step.label, iron: false };
  }

  /** Objets posés au sol près d'un chantier (ils comptent comme matériaux). */
  private looseNear(c: { x: number; y: number; z: number }, item: ItemId): Array<{ id: string; mass: number; d: number }> {
    const out: Array<{ id: string; mass: number; d: number }> = [];
    const held = this.props.held?.id;
    for (const id of this.props.liveIds()) {
      if (id === held) continue;
      const def = this.props.defOf(id);
      if (!def || def.fixed || def.kind !== item) continue;
      const pos = this.props.position(id);
      if (!pos) continue;
      const d = Math.hypot(pos.x - c.x, pos.z - c.z);
      if (d > SITE_RADIUS || Math.abs(pos.y - c.y) > 3) continue;
      out.push({ id, mass: this.props.massOf(id), d });
    }
    return out.sort((a, b) => a.d - b.d);
  }

  /** Masse de pierres disponible : posées près du chantier, dans le sac et en main. */
  private stoneKg(c: { x: number; y: number; z: number }): number {
    let kg = this.looseNear(c, 'pierre').reduce((a, x) => a + x.mass, 0);
    for (const st of [...this.inventory.pockets, ...(this.inventory.bag ?? [])]) if (st?.item === 'pierre') kg += (st.mass ?? ITEMS.pierre.mass) * st.count;
    const h = this.heldItem();
    if (h?.item === 'pierre') kg += this.props.massOf(h.id);
    return kg;
  }

  /** Premier besoin non couvert (avec ce qui manque), ou null. */
  private missingNeed(needs: Need[], c: { x: number; y: number; z: number }): Need | null {
    for (const [item, n] of needs) {
      if (item === 'pierre') {
        const kg = this.stoneKg(c);
        if (kg < n - 1e-6) return ['pierre', Math.ceil(n - kg)];
        continue;
      }
      const have = this.available(item) + this.looseNear(c, item).length;
      if (have < n) return [item, n - have];
    }
    return null;
  }

  /** Consomme les matériaux : d'abord ceux posés près du chantier, puis la main et l'inventaire. */
  private consumeNeeds(needs: Need[], c: { x: number; y: number; z: number }): void {
    for (const [item, n] of needs) {
      if (item === 'pierre') {
        // Les pierres s'utilisent entières : on choisit celles qui gaspillent le moins.
        type Cand = { mass: number; take: () => void; zone?: 'sac' | 'poche'; index?: number };
        const cands: Cand[] = this.looseNear(c, 'pierre').map((l) => ({ mass: l.mass, take: () => this.props.remove(l.id) }));
        const inv = this.inventory;
        for (const zone of ['sac', 'poche'] as const) {
          const list = zone === 'sac' ? (inv.bag ?? []) : inv.pockets;
          list.forEach((st, index) => {
            if (st?.item === 'pierre') cands.push({ mass: st.mass ?? ITEMS.pierre.mass, take: () => undefined, zone, index });
          });
        }
        const h = this.heldItem();
        if (h?.item === 'pierre') cands.push({ mass: this.props.massOf(h.id), take: () => this.props.remove(h.id) });
        const chosen: Cand[] = [];
        let left = n;
        const pool = [...cands].sort((a, b) => a.mass - b.mass);
        while (left > 1e-6 && pool.length) {
          // La plus petite qui suffit à finir, sinon la plus grosse.
          const fit = pool.findIndex((x) => x.mass >= left - 1e-6);
          const k = fit >= 0 ? fit : pool.length - 1;
          const [x] = pool.splice(k, 1);
          chosen.push(x!);
          left -= x!.mass;
        }
        for (const x of chosen) if (!x.zone) x.take();
        // Retirer les pierres de l'inventaire en partant de la fin (les index restent valables).
        for (const x of chosen.filter((y) => y.zone).sort((a, b) => b.index! - a.index!)) takeAt(inv, { zone: x.zone!, index: x.index! }, 1);
        continue;
      }
      let left = n;
      for (const l of this.looseNear(c, item)) {
        if (left <= 0) break;
        this.props.remove(l.id);
        left--;
      }
      if (left > 0) this.use(item, left);
    }
  }

  /** Tracer un plan. */
  private planify(plan: PlanId, aim: { x: number; y: number; z: number }, turn: number, on: { s: string; p: number } | null): ActionResult {
    if (!this.knowledge.plans.includes(plan)) return fail('Vous ne connaissez pas encore ce plan.');
    const s = this.state;
    if (s.mode !== MODE_WALK || !s.grounded) return fail('Il faut avoir les pieds au sol pour tracer un plan.');
    const pl = this.build.placement({ plan, aim, yaw: this.yaw, turn, onPiece: on, player: { x: s.x, y: s.y, z: s.z } });
    if (!pl.ok) return fail(pl.reason ?? 'Impossible ici.');
    this.build.apply(pl);
    return ok(`Plan tracé : ${PLANS[plan].label.toLowerCase()}. Apportez les matériaux (sur vous ou posés à côté), puis « Utiliser » sur le chantier.`);
  }

  private nearCenter(c: { x: number; y: number; z: number }, r = BUILD_REACH + 0.6): boolean {
    const s = this.state;
    return Math.hypot(c.x - s.x, c.z - s.z) <= r && Math.abs(c.y - (s.y + 1)) < 4;
  }

  private startBuildStep(ref: BuildRef): ActionResult {
    const info = this.stepInfo(ref);
    if (!info) return fail('Ce chantier est terminé.');
    if (!this.nearCenter(info.center)) return fail('Trop loin du chantier.');
    const step = info.steps[info.index]!;
    const fix = this.chooseFixing(step, info.center);
    if (fix.tool && !this.findTool(fix.tool)) return fail(`Il faut ${TOOL_NEEDS[fix.tool]} pour : ${fix.label.toLowerCase()}.`);
    const miss = this.missingNeed(fix.needs, info.center);
    if (miss) return fail(`Il manque ${needLabel(miss)} (sur vous ou posé à côté du chantier).`);
    if (this.state.stamina < 8) return fail('Trop fatigué : reprenez votre souffle.');
    const seconds = step.seconds * (1 - 0.04 * skillLevel(this.knowledge.xp));
    this.gesture = { kind: 'construction', label: `${fix.label}… (${info.index + 1}/${info.steps.length})`, total: seconds, left: seconds, build: ref, buildOp: 'etape' };
    return ok();
  }

  private finishBuildStep(ref: BuildRef): void {
    const info = this.stepInfo(ref);
    if (!info) return;
    const step = info.steps[info.index]!;
    const fix = this.chooseFixing(step, info.center);
    if (fix.tool && !this.findTool(fix.tool)) return this.msg(`Il faut ${TOOL_NEEDS[fix.tool]}.`, 'alerte');
    const miss = this.missingNeed(fix.needs, info.center);
    if (miss) return this.msg(`Il manque ${needLabel(miss)}.`, 'alerte');
    this.consumeNeeds(fix.needs, info.center);
    if (fix.tool) this.wearTool(fix.tool, 1);
    this.exert(4);
    this.knowledge.xp += 4;
    const label = PLANS[info.plan].label;
    if (ref.kind === 'piece') {
      const done = this.build.advance(ref.s, ref.p, fix.iron);
      if (done) this.msg(`${label} : terminé${fix.iron ? ', fixé au fer' : ''}.`, 'info');
      else this.msg(`Étape faite. Suivante : ${info.steps[info.index + 1]!.label.toLowerCase()}.`, 'info');
      return;
    }
    const site = this.build.site(ref.id)!;
    site.step++;
    this.build.touch();
    if (site.step >= info.steps.length) this.completeSite(site);
    else this.msg(`Étape faite. Suivante : ${info.steps[site.step]!.label.toLowerCase()}.`, 'info');
  }

  /** Un chantier d'installation terminé devient un objet fixe (coffre, établi, puits, fourneau, forge). */
  private completeSite(site: InstallSite): void {
    const def = PLANS[site.plan];
    const kind = def.install!;
    const prop: Omit<PropDef, 'id'> = {
      kind,
      x: site.x,
      y: site.y + INSTALL_HALF[kind],
      z: site.z,
      rot: (((site.yaw / (Math.PI * 2)) % 1) + 1) % 1,
      ...itemShape(kind),
      fixed: true,
      ...(site.on ? { on: { ...site.on } } : {}),
    };
    if (kind === 'coffre') prop.container = { pockets: [], bag: [] };
    if (kind === 'forge') prop.fire = { lit: false, fuel: 0, pot: null, cook: 0 };
    if (kind === 'fourneau') prop.furnace = { ore: 0, fuel: 0, lit: false, heat: 0, work: 0, blooms: 0 };
    if (TRAP_KINDS.has(kind)) prop.trap = { armed: true, caught: null };
    this.build.removeSite(site.id);
    this.props.spawnDynamic(prop);
    // Un piège terminé est actif tout de suite (les créatures le connaissent sans attendre).
    if (TRAP_KINDS.has(kind)) this.refreshFaunaEnv();
    this.msg(`${def.label} : terminé.`, 'info');
  }

  /** Les créatures prennent en compte sans attendre un objet posé (piège, nourriture) : tests, outils. */
  noticeWorldChange(): void {
    if (this.fauna.enabled) this.refreshFaunaEnv();
  }

  /** E sur une pièce : ouvrir ou fermer une porte ; sinon afficher la pièce (réparer, démonter…). */
  private interactBuild(bt: BuildTarget): void {
    if (bt.kind === 'piece') {
      const p = this.build.piece(bt.s, bt.p);
      if (p && PLANS[p.plan].piece === 'porte' && isDone(p)) {
        const r = this.toggleDoor(bt.s, bt.p);
        if (r.message) this.msg(r.message, r.ok ? 'info' : 'alerte');
        return;
      }
    }
    this.push({ type: 'ouvrir', prop: '', build: this.refOf(bt), tick: this.tick });
  }

  private toggleDoor(sid: string, pid: number): ActionResult {
    const s = this.build.structure(sid);
    const p = s?.pieces.find((q) => q.id === pid);
    if (!s || !p || PLANS[p.plan].piece !== 'porte' || !isDone(p)) return fail();
    if (!this.nearCenter(pieceTransform(s, p.slot))) return fail('Trop loin de la porte.');
    if (p.open) {
      // Ne pas refermer le battant sur soi.
      const leaf = pieceBoxes(s, { ...p, open: false }, true).at(-1)!;
      const st = this.state;
      const c = Math.cos(leaf.yaw);
      const n = Math.sin(leaf.yaw);
      const dx = st.x - leaf.x;
      const dz = st.z - leaf.z;
      const lx = dx * c - dz * n;
      const lz = dx * n + dz * c;
      if (Math.abs(lx) < leaf.hx + 0.35 && Math.abs(lz) < leaf.hz + 0.35 && st.y < leaf.y + leaf.hy && st.y + 1.8 > leaf.y - leaf.hy) return fail('Vous êtes dans le passage.');
    }
    this.build.toggleDoor(sid, pid);
    return ok();
  }

  /** « Utiliser » visant une construction ; null : laisser « Utiliser » faire autre chose (manger…). */
  private useOnBuild(bt: BuildTarget, h: { id: string; def: PropDef; item: ItemId } | null): ActionResult | null {
    const ref = this.refOf(bt);
    if (bt.kind === 'site') return this.startBuildStep(ref);
    const s = this.build.structure(bt.s)!;
    const p = s.pieces.find((q) => q.id === bt.p)!;
    if (!isDone(p)) return this.startBuildStep(ref);
    if (h?.item === 'torche' && h.def.fire?.lit) {
      if (!combustible(p.mat)) return fail(`${PLANS[p.plan].label} : ${p.mat === 'torchis' ? 'le torchis' : 'la pierre'} ne brûle pas.`);
      if (p.burning > 0) return fail('Cela brûle déjà.');
      p.burning = 0.01;
      this.build.touch();
      return ok('Le feu prend !');
    }
    if (h?.item === 'pot' && p.burning > 0) return this.pieceOp(bt.s, bt.p, 'eteindre');
    if (!h || !ITEMS[h.item].tool) return null;
    return this.strikePiece(bt.s, bt.p, h);
  }

  /** Frapper une pièce avec l'outil tenu : dégâts selon le matériau et l'outil. */
  private strikePiece(sid: string, pid: number, h: { id: string; def: PropDef; item: ItemId }): ActionResult {
    if (this.useCooldown > 0) return fail();
    const p = this.build.piece(sid, pid)!;
    const spec = ITEMS[h.item].tool!;
    let tag: ToolTag | null = null;
    let best = 0;
    for (const t of spec.tags) {
      const dmg = damageFor(p.mat, t, 1);
      if (dmg > best) {
        best = dmg;
        tag = t;
      }
    }
    if (!tag || best <= 0) return fail(p.mat === 'pierre' ? 'Il faudrait un galet (percuteur) pour entamer la pierre.' : 'Cet outil n’y fait rien.');
    const cost = STRIKE_COST[tag] ?? 4;
    if (this.state.stamina < cost) return fail('Trop fatigué : reprenez votre souffle.');
    this.exert(cost);
    this.useCooldown = STRIKE_TIME;
    const ref = this.stackRef({ zone: 'main' })!;
    const power = toolPower(ref.st);
    this.wearRef(ref, 1);
    const dmg = damageFor(p.mat, tag, power);
    if (this.build.damage(sid, pid, dmg)) {
      this.breakPiece(sid, pid, 0.5, `${PLANS[p.plan].label} : détruit.`);
      return ok();
    }
    return ok();
  }

  /** Actions sur une pièce terminée (panneau de la pièce). */
  private pieceOp(sid: string, pid: number, op: PieceOp): ActionResult {
    const s = this.build.structure(sid);
    const p = s?.pieces.find((q) => q.id === pid);
    if (!s || !p) return fail('Cette pièce n’existe plus.');
    const c = pieceTransform(s, p.slot);
    if (!this.nearCenter(c)) return fail('Trop loin.');
    if (op === 'porte') return this.toggleDoor(sid, pid);
    if (!isDone(p)) return fail('Ce chantier n’est pas terminé.');
    if (op === 'eteindre') {
      if (p.burning <= 0) return fail('Cela ne brûle pas.');
      const pot = this.findWaterPot();
      if (!pot) return fail('Il faut un pot plein d’eau.');
      pot.st.w = 0;
      pot.commit();
      p.burning = 0;
      this.build.touch();
      return ok('Vous versez l’eau : le feu s’éteint.');
    }
    if (op === 'reparer') {
      if (p.hp >= maxHp(p)) return fail('Cette pièce est en bon état.');
      const miss = this.missingNeed(repairNeeds(p), c);
      if (miss) return fail(`Il manque ${needLabel(miss)} pour réparer.`);
      this.gesture = { kind: 'construction', label: 'Vous réparez…', total: 4, left: 4, build: { kind: 'piece', s: sid, p: pid }, buildOp: 'reparer' };
      return ok();
    }
    if (op === 'torchis') {
      if (p.plan !== 'mur_clayonnage' || p.mat !== 'bois') return fail('Seul un mur de clayonnage s’enduit de torchis.');
      const miss = this.missingNeed([['argile', 3]], c);
      if (miss) return fail(`Il manque ${needLabel(miss)} pour le torchis.`);
      this.gesture = { kind: 'construction', label: 'Vous enduisez le mur de torchis…', total: 6, left: 6, build: { kind: 'piece', s: sid, p: pid }, buildOp: 'torchis' };
      return ok();
    }
    this.gesture = { kind: 'construction', label: `Vous démontez : ${PLANS[p.plan].label.toLowerCase()}…`, total: 5, left: 5, build: { kind: 'piece', s: sid, p: pid }, buildOp: 'demonter' };
    return ok();
  }

  private finishPieceOp(ref: BuildRef, op: 'reparer' | 'torchis' | 'demonter'): void {
    if (ref.kind !== 'piece') return;
    const s = this.build.structure(ref.s);
    const p = s?.pieces.find((q) => q.id === ref.p);
    if (!s || !p || !isDone(p)) return;
    const c = pieceTransform(s, p.slot);
    if (op === 'reparer') {
      const needs = repairNeeds(p);
      const miss = this.missingNeed(needs, c);
      if (miss) return this.msg(`Il manque ${needLabel(miss)}.`, 'alerte');
      this.consumeNeeds(needs, c);
      this.build.repair(ref.s, ref.p);
      this.msg(`Réparé (${p.hp}/${maxHp(p)}).`, 'info');
    } else if (op === 'torchis') {
      const miss = this.missingNeed([['argile', 3]], c);
      if (miss) return this.msg(`Il manque ${needLabel(miss)}.`, 'alerte');
      this.consumeNeeds([['argile', 3]], c);
      this.build.plaster(ref.s, ref.p);
      this.msg('Mur enduit de torchis : plus solide, et il ne brûle plus.', 'info');
    } else {
      this.breakPiece(ref.s, ref.p, 0.75 * (p.hp / maxHp(p)), `${PLANS[p.plan].label} : démonté.`);
    }
  }

  /** Abandonner un chantier : une partie des matériaux posés est rendue. */
  private cancelSite(ref: BuildRef): ActionResult {
    if (ref.kind === 'piece') {
      const s = this.build.structure(ref.s);
      const p = s?.pieces.find((q) => q.id === ref.p);
      if (!s || !p || isDone(p)) return fail('Ce n’est pas un chantier.');
      if (!this.nearCenter(pieceTransform(s, p.slot))) return fail('Trop loin.');
      this.breakPiece(ref.s, ref.p, 0.8, 'Chantier abandonné.');
      return ok();
    }
    const site = this.build.site(ref.id);
    if (!site) return fail('Ce chantier n’existe plus.');
    if (!this.nearCenter(site)) return fail('Trop loin.');
    const parts = salvage({ plan: site.plan, stilts: 0, step: site.step, mat: PLANS[site.plan].material }, 0.8);
    this.build.removeSite(site.id);
    this.spawnDebris(parts, { x: site.x, y: site.y + 0.4, z: site.z });
    return ok('Chantier abandonné.');
  }

  /** Une pièce disparaît (effondrement, destruction, démontage) : ses débris tombent. */
  private breakPiece(sid: string, pid: number, keep: number, message: string | null): void {
    const s = this.build.structure(sid);
    const p = s?.pieces.find((q) => q.id === pid);
    if (!s || !p) return;
    const t = pieceTransform(s, p.slot);
    const center = { x: t.x, y: t.y + (p.slot.t === 'f' ? 0.1 : p.slot.t === 'r' ? 0.4 : 1.1), z: t.z };
    const parts = salvage(p, keep);
    this.build.remove(sid, pid);
    this.spawnDebris(parts, center);
    const st = this.state;
    if (message && Math.hypot(t.x - st.x, t.z - st.z) < 30) this.msg(message, 'alerte');
  }

  /** Débris physiques (au plus 10 objets) : ils tombent et se ramassent. */
  private spawnDebris(parts: Need[], c: { x: number; y: number; z: number }): void {
    let n = 0;
    const put = (kind: PropKind, shape: { radius: number; length: number }): void => {
      const a = rand(this.vitals) * Math.PI * 2;
      const r = 0.2 + rand(this.vitals) * 0.6;
      this.props.spawnDynamic(
        { kind, x: c.x + Math.cos(a) * r, y: c.y + n * 0.05, z: c.z + Math.sin(a) * r, rot: rand(this.vitals), ...shape },
        { x: Math.cos(a) * 0.8, y: 0.5, z: Math.sin(a) * 0.8 },
      );
      n++;
    };
    for (const [item, count] of parts) {
      if (item === 'pierre') {
        let kg = count;
        while (kg > 0.5 && n < 10) {
          const m = Math.min(kg, 3 + rand(this.vitals) * 3);
          kg -= m;
          put('pierre', { radius: Math.cbrt((3 * m) / (4 * Math.PI * 2600)), length: 0 });
        }
      } else {
        const shape = item === 'buche' ? { radius: 0.07, length: 0.6 } : itemShape(item as PropKind);
        for (let k = 0; k < count && n < 10; k++) put(item as PropKind, shape);
      }
    }
  }

  /** Choc violent sur une pièce (pierre lancée, débris qui tombe) : dégâts selon la force. */
  private onImpact(h1: number, h2: number, force: number): void {
    const a = this.structPhys.pieceOf(h1) ?? this.structPhys.pieceOf(h2);
    if (!a) return;
    const key = `${a.s}:${a.p}`;
    this.impacts.set(key, Math.min(80, (this.impacts.get(key) ?? 0) + (force - IMPACT_THRESHOLD) / 400));
  }

  private applyImpacts(): void {
    if (this.impacts.size === 0) return;
    for (const [key, amount] of this.impacts) {
      const i = key.lastIndexOf(':');
      const sid = key.slice(0, i);
      const pid = Number(key.slice(i + 1));
      const p = this.build.piece(sid, pid);
      if (!p) continue;
      if (this.build.damage(sid, pid, damageFor(p.mat, 'choc', amount))) this.breakPiece(sid, pid, 0.4, `${PLANS[p.plan].label} : brisé par le choc.`);
    }
    this.impacts.clear();
  }

  /**
   * Effondrements (par vagues : une toutes les 0,25 s), installations et chantiers qui perdent
   * leur plancher.
   */
  private stepCollapse(): void {
    for (const { s, p } of this.build.unstable()) this.breakPiece(s.id, p.id, isDone(p) ? 0.4 : 0.6, isDone(p) ? `${PLANS[p.plan].label} : s’effondre !` : null);
    for (const site of [...this.build.sites]) if (site.on && !this.build.piece(site.on.s, site.on.p)) this.build.removeSite(site.id);
    const orphans: Array<{ def: PropDef; pos: { x: number; y: number; z: number } }> = [];
    this.props.forEachDynamic((def, pos) => {
      if (def.on && !this.build.piece(def.on.s, def.on.p)) orphans.push({ def, pos: { x: pos.x, y: pos.y, z: pos.z } });
    });
    for (const { def, pos } of orphans) {
      const plan = INSTALL_PLANS_BY_KIND[def.kind as keyof typeof INSTALL_HALF];
      this.props.remove(def.id);
      const parts = plan ? salvage({ plan, stilts: 0, step: PLANS[plan].steps.length, mat: PLANS[plan].material }, 0.4) : [];
      this.spawnDebris(parts, pos);
      // Le contenu d'un coffre tombe aussi.
      for (const st of def.container?.bag ?? []) this.dropNear(st, pos.x, pos.z, 1);
      this.msg(`${PROP_NAMES[def.kind] ?? 'L’installation'} tombe avec le plancher !`, 'alerte');
    }
  }

  /** Incendies : le bois et le chaume brûlent et propagent le feu ; un feu posé sur un plancher de bois peut l'enflammer. */
  private stepBuildFire(dt: number): void {
    const st = this.state;
    for (const s of [...this.build.structures]) {
      for (const p of [...s.pieces]) {
        if (p.burning <= 0) continue;
        if (!combustible(p.mat)) {
          p.burning = 0;
          continue;
        }
        p.burning += dt;
        for (const q of this.build.neighbors(s, p)) {
          if (q.burning <= 0 && isDone(q) && combustible(q.mat) && rand(this.vitals) < 0.06 * dt * 2) q.burning = 0.01;
        }
        if (this.build.damage(s.id, p.id, damageFor(p.mat, 'feu', dt))) this.breakPiece(s.id, p.id, 0.1, Math.hypot(s.x - st.x, s.z - st.z) < 30 ? `${PLANS[p.plan].label} : réduit en cendres.` : null);
      }
    }
    for (const { def, fire } of this.props.fires()) {
      if (!fire.lit || (def.kind !== 'foyer' && def.kind !== 'forge')) continue;
      const pos = this.props.position(def.id);
      if (!pos) continue;
      const f = floorUnder(this.build, pos.x, pos.y, pos.z);
      const piece = f ? this.build.piece(f.s, f.p) : undefined;
      if (piece && combustible(piece.mat) && piece.burning <= 0 && rand(this.vitals) < 0.01 * dt * 2) {
        piece.burning = 0.01;
        this.build.touch();
        this.msg('Le plancher de bois prend feu sous le foyer !', 'danger');
      }
    }
  }

  /** Une installation de ce type à portée. */
  private nearInstall(kind: PropKind, r: number, lit = false): PropDef | null {
    const s = this.state;
    for (const id of this.props.liveIds()) {
      const def = this.props.defOf(id);
      if (!def || def.kind !== kind) continue;
      if (lit && !(def.fire?.lit || def.furnace?.lit)) continue;
      const pos = this.props.position(id);
      if (pos && Math.hypot(pos.x - s.x, pos.z - s.z) <= r && Math.abs(pos.y - s.y) < 3) return def;
    }
    return null;
  }

  /** Un pot (main d'abord, puis inventaire). */
  private findPot(): HandOrSlot | null {
    if (this.heldItem()?.item === 'pot') return { zone: 'main' };
    const inv = this.inventory;
    const i = inv.pockets.findIndex((p) => p?.item === 'pot');
    if (i >= 0) return { zone: 'poche', index: i };
    const j = inv.bag?.findIndex((p) => p.item === 'pot') ?? -1;
    return j >= 0 ? { zone: 'sac', index: j } : null;
  }

  /** Pot plein d'eau (main d'abord, puis inventaire). */
  private findWaterPot(): { st: ItemStack; commit: () => void; remove: () => void } | null {
    const h = this.heldItem();
    if (h?.item === 'pot') {
      const ref = this.stackRef({ zone: 'main' });
      if (ref && (ref.st.w ?? 0) >= 1) return ref;
    }
    const inv = this.inventory;
    for (let i = 0; i < inv.pockets.length; i++) if (inv.pockets[i]?.item === 'pot' && (inv.pockets[i]!.w ?? 0) >= 1) return this.stackRef({ zone: 'poche', index: i });
    if (inv.bag) for (let i = 0; i < inv.bag.length; i++) if (inv.bag[i]!.item === 'pot' && (inv.bag[i]!.w ?? 0) >= 1) return this.stackRef({ zone: 'sac', index: i });
    return null;
  }

  /** Allumer la torche tenue à un feu (foyer, forge, fourneau, autre torche, incendie). */
  private lightTorch(h: { id: string; def: PropDef; item: ItemId }): ActionResult {
    if (h.def.fire?.lit) return fail('La torche brûle déjà.');
    const s = this.state;
    let source = false;
    for (const { def, fire } of this.props.fires()) {
      if (!fire.lit || def.id === h.id) continue;
      const pos = this.props.position(def.id);
      if (pos && Math.hypot(pos.x - s.x, pos.z - s.z) < 2.6) source = true;
    }
    if (!source) for (const { def, furnace } of this.props.furnaces()) {
      const pos = this.props.position(def.id);
      if (furnace.lit && pos && Math.hypot(pos.x - s.x, pos.z - s.z) < 2.6) source = true;
    }
    if (!source)
      for (const st of this.build.structures)
        for (const p of st.pieces) {
          if (p.burning <= 0) continue;
          const t = pieceTransform(st, p.slot);
          if (Math.hypot(t.x - s.x, t.z - s.z) < 3.5) source = true;
        }
    if (!source) return fail('Approchez la torche d’un feu allumé pour l’allumer.');
    h.def.fire = { lit: true, fuel: h.def.meta?.d ?? 600, pot: null, cook: 0 };
    return ok('La torche s’allume.');
  }

  private litTorchInHand(): boolean {
    const h = this.heldItem();
    return h?.item === 'torche' && h.def.fire?.lit === true;
  }

  // Bas fourneau.

  private furnaceOp(prop: string, op: FurnaceOp): ActionResult {
    const def = this.reachable(prop);
    const f = def?.kind === 'fourneau' ? def.furnace : undefined;
    if (!def || !f) return fail('Trop loin du fourneau.');
    switch (op) {
      case 'minerai':
        if (f.ore >= 4) return fail('Le fourneau est plein de minerai (4 au plus).');
        if (this.available('minerai_fer') < 1) return fail('Il faut du minerai de fer.');
        this.use('minerai_fer', 1);
        f.ore++;
        return ok(`Minerai chargé (${f.ore}/4). Deux morceaux donnent une loupe de fer.`);
      case 'bois':
        if (f.fuel >= 1200) return fail('Le fourneau est plein de bois.');
        if (this.available('buche') > 0) {
          this.use('buche', 1);
          f.fuel += FUEL_LOG;
        } else if (this.available('baton') > 0) {
          this.use('baton', 1);
          f.fuel += FUEL_STICK;
        } else return fail('Il faut du bois : une bûche ou un bâton.');
        return ok(f.lit ? 'Vous rechargez le fourneau.' : 'Bois chargé. Allumez le fourneau (torche, ou archet et herbes sèches).');
      case 'souffler':
        if (!f.lit) return fail('Allumez d’abord le fourneau.');
        if (f.ore < 2) return fail('Chargez au moins deux morceaux de minerai.');
        if (this.state.stamina < 15) return fail('Trop fatigué pour actionner le soufflet.');
        this.gesture = { kind: 'soufflet', label: 'Vous actionnez le soufflet…', total: 4, left: 4, prop };
        return ok();
      case 'loupe': {
        if (f.blooms <= 0) return fail('Aucune loupe de fer n’est prête.');
        f.blooms--;
        const st: ItemStack = { item: 'loupe_fer', count: 1 };
        if (store(this.inventory, st) > 0) this.dropOnGround(st);
        this.noteHints(hintFrom(this.knowledge, 'loupe_fer'));
        this.notePlans('loupe_fer');
        return ok('Vous retirez une loupe de fer, encore pleine de scories.');
      }
    }
  }

  private finishBellows(prop: string): void {
    const def = this.reachable(prop);
    const f = def?.furnace;
    if (!f || !f.lit) return;
    f.heat = Math.min(100, f.heat + 30);
    if (f.heat < 60 || f.ore < 2) {
      this.msg(`La chaleur monte (${Math.round(f.heat)} %) : continuez à souffler.`, 'info');
      return;
    }
    f.work += 4;
    if (f.work >= 24) {
      f.work -= 24;
      f.ore -= 2;
      f.blooms++;
      this.msg('Une loupe de fer s’est formée au fond de la cuve : retirez-la.', 'info');
    } else this.msg(`Le fourneau ronfle (chaleur ${Math.round(f.heat)} %, fer ${Math.round((f.work / 24) * 100)} %).`, 'info');
  }

  private stepFurnaces(dt: number): void {
    const s = this.state;
    for (const { def, furnace: f } of this.props.furnaces()) {
      if (f.lit) {
        f.fuel -= dt;
        f.heat = Math.max(20, f.heat - 2 * dt);
        if (f.fuel <= 0) {
          f.fuel = 0;
          f.lit = false;
          const pos = this.props.position(def.id);
          if (pos && Math.hypot(pos.x - s.x, pos.z - s.z) < 12) this.msg('Le fourneau s’est éteint : plus de bois.', 'info');
        }
      } else f.heat = Math.max(0, f.heat - 4 * dt);
    }
  }

  private notePlans(item: ItemId): void {
    const plans = plansFrom(this.knowledge.plans, item);
    if (plans.length) this.msg(`Nouvelle idée de construction : ${plans.map((p) => PLANS[p].label).join(', ')}.`, 'info');
  }

  // ——— Sauvegarde ———

  /** État à sauvegarder. Mort, le joueur est sauvegardé comme déjà réapparu. */
  // ——— Phase 6 : faune, combats, carcasses, pièges ———

  /** Ce que les créatures savent du joueur à ce pas. */
  private faunaPlayer(): FaunaPlayer {
    const s = this.state;
    const v = this.vitals;
    const speed = Math.hypot(s.vx, s.vz);
    let noise = 0;
    if (s.mode === MODE_SWIM) noise = speed > 1.4 ? 30 : speed > 0.2 ? 14 : 4;
    else if (s.mode === MODE_CLIMB) noise = 6;
    else if (speed > 4) noise = 28;
    else if (speed > 0.5) noise = s.crouched ? 3 : 10;
    const h = this.heldItem();
    const tool = h ? ITEMS[h.item].tool : undefined;
    const weapon = tool && (tool.tags.includes('pointe') || tool.tags.includes('hache') || (tool.tags.includes('tranchant') && tool.reach >= 0.3)) ? Math.min(1, 0.5 + tool.power * 0.3) : 0;
    const meat = countOf(this.inventory, 'viande_crue') + countOf(this.inventory, 'viande_cuite') > 0 || h?.item === 'viande_crue' || h?.item === 'viande_cuite';
    return {
      x: s.x,
      y: s.y,
      z: s.z,
      vx: s.vx,
      vz: s.vz,
      crouched: s.crouched,
      swimming: s.mode === MODE_SWIM,
      underwater: s.y + (s.crouched ? EYE_HEIGHT_CROUCH : EYE_HEIGHT) < WATER_LEVEL,
      climbing: s.mode === MODE_CLIMB,
      waterDepth: Math.max(0, WATER_LEVEL - this.terrain.heightAt(s.x, s.z)),
      yaw: this.yaw,
      state: v.state,
      health: v.health,
      bleeding: totalBleeding(v),
      injuredLegs: v.injuries.some((i) => isLeg(i.zone) && (i.kind === 'fracture' || i.kind === 'entorse')),
      weapon,
      torch: this.litTorchInHand(),
      meat,
      noise,
    };
  }

  /** Feux, carcasses, nourriture et pièges autour du joueur (deux fois par seconde). */
  private refreshFaunaEnv(): void {
    const env = this.faunaEnv;
    env.fires = [];
    for (const { def, fire } of this.props.fires()) {
      if (!fire.lit) continue;
      const pos = this.props.position(def.id);
      if (pos) env.fires.push({ x: pos.x, z: pos.z, r: def.kind === 'torche' ? 1 : 2 });
    }
    for (const { def, furnace } of this.props.furnaces()) {
      if (!furnace.lit) continue;
      const pos = this.props.position(def.id);
      if (pos) env.fires.push({ x: pos.x, z: pos.z, r: 2 });
    }
    for (const st of this.build.structures) {
      for (const p of st.pieces) {
        if ((p.burning ?? 0) <= 0) continue;
        const c = pieceTransform(st, p.slot);
        env.fires.push({ x: c.x, z: c.z, r: 3 });
      }
    }
    env.carcasses = [];
    for (const def of this.props.liveOfKind(CARCASS_KINDS)) {
      const pos = this.props.position(def.id);
      if (pos && def.carcass) env.carcasses.push({ id: def.id, x: pos.x, y: pos.y, z: pos.z, meat: this.time - def.carcass.at < CARCASS_ROT * 2 ? def.carcass.meat : 0 });
    }
    env.traps = [];
    for (const def of this.props.liveOfKind(TRAP_KINDS)) {
      if (!def.trap) continue;
      env.traps.push({ id: def.id, x: def.x, z: def.z, kind: def.kind as 'collet' | 'assommoir' | 'fosse', armed: def.trap.armed });
    }
    if (this.tick % 60 === 0) {
      env.food = [];
      const heldId = this.props.held?.id;
      for (const def of this.props.liveOfKind(FOOD_KINDS)) {
        if (def.id === heldId) continue;
        if (def.kind === 'sac' && !(def.container && [...def.container.pockets, ...(def.container.bag ?? [])].some((st) => st && FOOD_ITEMS.has(st.item)))) continue;
        const pos = this.props.position(def.id);
        if (pos) env.food.push({ id: def.id, x: pos.x, z: pos.z });
      }
    }
  }

  private stepFauna(): void {
    if (!this.fauna.enabled) return;
    if (this.tick % 30 === 0) this.refreshFaunaEnv();
    this.stepProjectiles();
    this.fauna.step(TICK_DT, this.time, this.faunaPlayer(), this.faunaEnv);
    for (const e of this.fauna.takeEvents()) {
      this.onFaunaEvent(e);
      if (this.dead) return;
    }
    this.applyGrab();
    this.separateFromCreatures();
    if (this.tick % 6 === 0) this.stepPlayerTraps();
    if (this.tick % 60 === 0) this.stepCarcasses();
    if (this.tick % 60 === 30) this.stepTrappedCreatures();
  }

  private onFaunaEvent(e: FaunaEvent): void {
    const s = this.state;
    const v = this.vitals;
    switch (e.type) {
      case 'son':
        this.push({ type: 'son', kind: e.kind, x: e.x, y: e.y, z: e.z, tick: this.tick });
        break;
      case 'attaque': {
        const c = this.fauna.creatures.get(e.id);
        const d = SPECIES[e.sp];
        const atk = d.attack;
        if (!atk || !c) break;
        const zones: Array<[Zone, number]> = e.downed ? [['torse', 3], ['tete', 1], ['bras_g', 1], ['bras_d', 1]] : atk.zones;
        let total = 0;
        for (const [, w] of zones) total += w;
        let r = rand(v) * total;
        let zone: Zone = zones[0]![0];
        for (const [z, w] of zones) {
          r -= w;
          if (r <= 0) {
            zone = z;
            break;
          }
        }
        const dmg = atk.damage * c.scale * (e.behind ? 1.4 : 1) * (0.85 + 0.3 * rand(v));
        damage(v, dmg);
        if (atk.injury === 'coupure') addInjury(v, zone, 'coupure', rand(v) < atk.grave);
        else addInjury(v, zone, atk.injury);
        if (rand(v) < atk.fracture && zone !== 'torse') addInjury(v, zone, 'fracture');
        if (zone === 'tete' && dmg > 18 && rand(v) < 0.35) {
          addInjury(v, 'tete', 'commotion');
          knockOut(v, VITALS.concussionUnconsciousSeconds);
        }
        // Le choc projette, interrompt le geste et fait lâcher ce qu'on tient.
        if (atk.knock > 0) {
          const dx = s.x - c.x;
          const dz = s.z - c.z;
          const l = Math.hypot(dx, dz) || 1;
          s.vx += (dx / l) * atk.knock;
          s.vz += (dz / l) * atk.knock;
          if (atk.knock > 5) s.vy = Math.max(s.vy, atk.knock * 0.35);
        }
        if (this.gesture) this.gesture = null;
        if (this.props.held && (atk.knock >= 3 || dmg > 20)) this.props.drop(s);
        this.push({ type: 'attaque', sp: e.sp, zone, tick: this.tick });
        this.msg(`${cap(speciesName(e.sp))} ${ATTACK_VERB[e.sp] ?? 'vous attaque'} ${ZONE_AT[zone]} !`, 'danger');
        // À terre, un prédateur achève sa proie.
        const predator = d.archetype === 'meute' || d.archetype === 'embuscade' || d.archetype === 'aquatique';
        if (e.downed && predator && rand(v) < 0.35) {
          die(v, 'attaque');
          this.onDeath();
        }
        break;
      }
      case 'saisie':
        this.props.held && this.props.drop(s);
        this.gesture = null;
        this.msg(e.sp === 'ombre' ? 'Quelque chose d’énorme vous a saisi et vous tire vers le fond ! Frappez-le (Utiliser) ou débattez-vous (E) !' : 'Le crocodile vous entraîne dans l’eau ! Frappez-le à la tête (Utiliser) ou débattez-vous (E) !', 'danger');
        break;
      case 'lache':
        if (e.reason === 'coups') this.msg(e.sp === 'ombre' ? 'Touchée, la chose vous lâche ! Remontez !' : 'Frappé, le crocodile vous lâche !', 'alerte');
        else if (e.reason === 'debattu') this.msg('Vous vous dégagez !', 'alerte');
        else if (e.reason === 'temps' && !this.dead) this.msg(e.sp === 'ombre' ? 'L’étreinte se relâche… Remontez vite !' : 'Le crocodile vous lâche.', 'alerte');
        break;
      case 'mort':
        if (e.sp !== 'vautour' && e.sp !== 'ombre') this.spawnCarcass(e.sp, e.x, e.z, e.yaw, e.scale);
        break;
      case 'piece': {
        const p = this.build.piece(e.s, e.p);
        if (!p) break;
        if (this.build.damage(e.s, e.p, damageFor(p.mat, 'creature', e.damage))) {
          const near = Math.hypot(p ? (this.build.structure(e.s)?.x ?? s.x) - s.x : 0, (this.build.structure(e.s)?.z ?? s.z) - s.z) < 80;
          this.breakPiece(e.s, e.p, 0.4, near ? `${cap(speciesName(e.sp, 'un'))} a renversé : ${PLANS[p.plan].label.toLowerCase()}.` : null);
        }
        break;
      }
      case 'manger': {
        const def = this.props.defOf(e.carcass);
        if (def?.carcass) def.carcass.meat = Math.max(0, def.carcass.meat - e.amount);
        break;
      }
      case 'vol': {
        const def = this.props.defOf(e.prop);
        if (!def) break;
        const pos = this.props.position(e.prop);
        if (def.kind === 'sac' && def.container) {
          const all = [...def.container.pockets, ...(def.container.bag ?? [])];
          const st = all.find((x) => x && FOOD_ITEMS.has(x.item));
          if (st) {
            st.count--;
            def.container.pockets = def.container.pockets.map((x) => (x && x.count <= 0 ? null : x));
            if (def.container.bag) def.container.bag = def.container.bag.filter((x) => x.count > 0);
            this.props.refreshMass(def.id);
          }
        } else this.props.remove(e.prop);
        if (pos && Math.hypot(pos.x - s.x, pos.z - s.z) < 70) this.msg('Un babouin file avec votre nourriture !', 'alerte');
        this.refreshFaunaEnv();
        break;
      }
      case 'piege':
        this.onTrapTriggered(e.trap, e.id, e.sp);
        break;
      case 'disparait':
        break;
    }
  }

  /** Le joueur tenu suit la gueule de la créature ; il perd son souffle et sa santé. */
  private applyGrab(): void {
    const gr = this.fauna.grab;
    if (!gr) return;
    const pt = this.fauna.grabPoint();
    const c = this.fauna.creatures.get(gr.id);
    if (!pt || !c) return;
    const s = this.state;
    const v = this.vitals;
    let y = pt.y;
    if (c.sp === 'crocodile') y = WATER_LEVEL - 1.2 - 0.8 * Math.abs(Math.sin(gr.t * 2.5));
    y = Math.max(this.terrain.heightAt(pt.x, pt.z) + 0.05, y);
    s.x = pt.x;
    s.y = y;
    s.z = pt.z;
    s.vx = 0;
    s.vy = 0;
    s.vz = 0;
    if (c.sp === 'ombre') {
      // Tiré vers le fond : le souffle part trois fois plus vite.
      s.breath = Math.max(0, s.breath - 7 * TICK_DT);
      damage(v, 2 * TICK_DT);
    } else {
      damage(v, 4 * TICK_DT);
      if (Math.floor((gr.t - TICK_DT) / 2.5) !== Math.floor(gr.t / 2.5)) addInjury(v, rand(v) < 0.5 ? 'jambe_g' : 'jambe_d', rand(v) < 0.3 ? 'fracture' : 'coupure', rand(v) < 0.4);
    }
  }

  /** On ne traverse pas une créature : elle repousse le joueur. */
  private separateFromCreatures(): void {
    const s = this.state;
    if (this.fauna.grab) return;
    const nb = this.fauna.nearestBody(s.x, s.y + 0.9, s.z);
    if (!nb || nb.d >= 0.3) return;
    const c = this.fauna.creatures.get(nb.id);
    if (!c) return;
    const dx = s.x - c.x;
    const dz = s.z - c.z;
    const l = Math.hypot(dx, dz) || 1;
    const push = Math.min(3, (0.3 - nb.d) * 12);
    s.vx += (dx / l) * push;
    s.vz += (dz / l) * push;
  }

  /** Les objets lancés (et la pierre d'un assommoir) blessent les créatures qu'ils touchent. */
  private stepProjectiles(): void {
    const s = this.state;
    for (const [id, pr] of this.projectiles) {
      const pos = this.props.position(id);
      const vel = this.props.velocityOf(id);
      const def = this.props.defOf(id);
      pr.left -= TICK_DT;
      pr.age += TICK_DT;
      if (!pos || !vel || !def || pr.left <= 0) {
        this.projectiles.delete(id);
        continue;
      }
      const speed = Math.hypot(vel.x, vel.y, vel.z);
      if (speed < 3) {
        // Encore lent au départ (pierre qui commence à tomber) ; arrêté ensuite : on cesse de le suivre.
        if (pr.age > 0.6) this.projectiles.delete(id);
        continue;
      }
      const q = { x: pos.x + vel.x * TICK_DT, y: pos.y + vel.y * TICK_DT, z: pos.z + vel.z * TICK_DT };
      const mass = this.props.massOf(id);
      const pointe = def.kind === 'lance';
      const hit = this.fauna.sweepHit(pos, q, Math.max(0.05, def.radius));
      if (hit) {
        const c = this.fauna.creatures.get(hit.id);
        const ke = 0.5 * mass * speed * speed;
        const dmg = Math.min(160, ke * (pointe ? 0.6 : 0.22));
        const res = this.fauna.hurt(hit.id, dmg, hit.part, { bleed: pointe, by: pr.trap ? 'piege' : 'joueur', x: s.x, z: s.z });
        this.props.setVelocity(id, { x: -vel.x * 0.2, y: Math.max(1, -vel.y * 0.2), z: -vel.z * 0.2 });
        this.projectiles.delete(id);
        this.fauna.noise(pos.x, pos.z, 18);
        if (c && res) {
          this.push({ type: 'touche', sp: c.sp, part: hit.part, killed: res.killed, x: pos.x, y: pos.y, z: pos.z, tick: this.tick });
          if (res.killed) this.msg(`${cap(speciesName(c.sp, 'le'))} s’effondre.`, 'info');
          else if (!pr.trap) this.msg(`${cap(PROP_ARTICLE(def.kind))} touche ${speciesName(c.sp, 'le')} ${PART_LABELS[hit.part]}.`, 'info');
        }
        continue;
      }
      // La pierre d'un assommoir peut aussi tomber sur le joueur.
      if (pr.trap && vel.y < -2) {
        const dx = q.x - s.x;
        const dz = q.z - s.z;
        if (Math.hypot(dx, dz) < 0.45 + def.radius && q.y < s.y + 1.9 && q.y > s.y - 0.2) {
          const v = this.vitals;
          damage(v, Math.min(60, 0.5 * mass * speed * speed * 0.12));
          addInjury(v, rand(v) < 0.5 ? 'tete' : 'torse', 'contusion');
          if (rand(v) < 0.4) addInjury(v, rand(v) < 0.5 ? 'bras_g' : 'bras_d', 'fracture');
          this.push({ type: 'attaque', sp: 'impala', zone: 'torse', tick: this.tick });
          this.msg('La pierre de l’assommoir vous tombe dessus !', 'danger');
          this.props.setVelocity(id, { x: 0.5, y: 0, z: 0.5 });
          this.projectiles.delete(id);
        }
      }
    }
  }

  /** Coup porté à une créature visée avec ce qu'on tient (ou à mains nues). */
  private attackCreature(h: { id: string; def: PropDef; item: ItemId } | null): ActionResult | null {
    if (!this.fauna.enabled) return null;
    const s = this.state;
    const eye = this.eye();
    const dir = lookDirection(this.yaw, this.pitch);
    const spec = h ? ITEMS[h.item].tool : undefined;
    const reach = 1.1 + (spec?.reach ?? 0.1);
    let hit = this.fauna.rayHit(eye, dir, reach);
    if (hit) {
      const wall = this.phys.world.castRay(new RAPIER.Ray(eye, dir), hit.t, true, undefined, QUERY_SIGHT);
      if (wall && wall.timeOfImpact < hit.t - 0.15) hit = null;
    }
    // Tenu par une créature : on frappe celle-ci, même sans bien viser.
    const gr = this.fauna.grab;
    if (!hit && gr) {
      const c = this.fauna.creatures.get(gr.id);
      if (c) hit = { id: c.id, t: 1, part: rand(this.vitals) < 0.4 ? 'tete' : 'corps', x: c.x, y: c.y, z: c.z };
    }
    if (!hit) return null;
    const c = this.fauna.creatures.get(hit.id);
    if (!c) return null;
    if (this.useCooldown > 0) return fail();
    const mass = h ? this.props.massOf(h.id) : 0;
    const balance = spec?.balance ?? 0.5;
    const cost = 3 + mass * 2.5;
    if (s.stamina < cost) return fail('Trop fatigué pour frapper : reprenez votre souffle.');
    this.exert(cost);
    this.useCooldown = Math.max(0.35, Math.min(1.3, 0.45 + mass * 0.12 - balance * 0.15));
    const ref = h && spec && spec.durability > 0 ? this.stackRef({ zone: 'main' }) : null;
    const power = ref ? toolPower(ref.st) : spec ? spec.power : 0.4;
    const tags = spec?.tags ?? [];
    const sharp = tags.includes('pointe') ? 1.6 : tags.includes('hache') ? 1.4 : tags.includes('tranchant') ? 1.3 : 1;
    const v = this.vitals;
    const brokenArm = v.injuries.some((i) => (i.zone === 'bras_d' || i.zone === 'bras_g') && i.kind === 'fracture' && !i.splinted);
    const base = h ? (6 + 9 * power) * Math.sqrt(Math.max(0.3, mass + 0.3)) * sharp : 3;
    const dmg = base * (0.85 + 0.3 * rand(v)) * (brokenArm ? 0.5 : 1);
    const bleed = tags.includes('tranchant') || tags.includes('pointe');
    const res = this.fauna.hurt(hit.id, dmg, hit.part, { bleed, by: 'joueur', x: s.x, z: s.z });
    if (ref) this.wearRef(ref, 1);
    this.fauna.noise(s.x, s.z, 20);
    this.push({ type: 'son', kind: h ? 'coup' : 'coup', x: hit.x, y: hit.y, z: hit.z, tick: this.tick });
    this.push({ type: 'touche', sp: c.sp, part: hit.part, killed: !!res?.killed, x: hit.x, y: hit.y, z: hit.z, tick: this.tick });
    if (res?.killed) return ok(`${cap(speciesName(c.sp, 'le'))} s’effondre.`);
    return ok(`Vous frappez ${speciesName(c.sp, 'le')} ${PART_LABELS[hit.part]}.`);
  }

  private spawnCarcass(sp: SpeciesId, x: number, z: number, yaw: number, scale: number): string {
    const d = SPECIES[sp];
    const y = this.terrain.heightAt(x, z);
    const water = WATER_LEVEL - y;
    return this.props.spawnDynamic({
      kind: 'carcasse',
      x,
      y: Math.max(y, water > 0 ? WATER_LEVEL - 0.3 : y) + d.radius * scale * 0.6,
      z,
      rot: ((((yaw - Math.PI / 2) / (Math.PI * 2)) % 1) + 1) % 1,
      radius: Math.max(0.15, d.radius * scale),
      length: Math.max(0.4, d.halfLength * 2 * scale),
      fixed: true,
      carcass: { sp, meat: Math.max(1, Math.round(d.meat * scale)), at: this.time, scale },
    });
  }

  /** Les carcasses attirent les vautours, pourrissent, puis disparaissent. */
  private stepCarcasses(): void {
    const s = this.state;
    const gone: string[] = [];
    this.props.forEachDynamic((def, pos) => {
      const k = def.carcass;
      if (!k) return;
      const age = this.time - k.at;
      if (age > CARCASS_GONE || (k.meat <= 0 && age > 600)) {
        gone.push(def.id);
        return;
      }
      if (!k.vultures && age > 60 && k.meat > 0 && Math.hypot(pos.x - s.x, pos.z - s.z) < 400) {
        k.vultures = true;
        this.fauna.vulturesFor(def.id, pos.x, pos.z);
      }
    });
    for (const id of gone) this.props.remove(id);
  }

  private startButcher(id: string, h: { id: string; def: PropDef; item: ItemId } | null): ActionResult {
    const def = this.props.defOf(id);
    const k = def?.carcass;
    if (!def || !k) return fail();
    if (!h || !hasTag(h.item, 'tranchant')) return fail('Il faut une lame en main pour dépecer : éclat de quartz, couteau ou hache.');
    if (k.meat <= 0) return fail('Il ne reste que les os.');
    if (this.time - k.at > CARCASS_ROT) return fail('La viande est avariée : elle vous rendrait malade.');
    const seconds = Math.min(16, 5 + SPECIES[k.sp].mass / 60);
    this.gesture = { kind: 'depecage', label: `Vous dépecez la carcasse ${SPECIES[k.sp].feminine ? 'de la' : 'du'} ${SPECIES[k.sp].label}…`, total: seconds, left: seconds, carcass: id };
    return ok();
  }

  private finishButcher(id: string): void {
    const def = this.props.defOf(id);
    const k = def?.carcass;
    const pos = this.props.position(id);
    if (!def || !k || !pos) return;
    const n = Math.min(2, k.meat);
    if (n <= 0) return;
    k.meat -= n;
    this.wearTool('tranchant', 1);
    const left = store(this.inventory, { item: 'viande_crue', count: n });
    if (left > 0) this.dropNear({ item: 'viande_crue', count: left }, pos.x, pos.z, 0);
    this.fauna.noise(pos.x, pos.z, 8);
    this.msg(k.meat > 0 ? `Vous prélevez ${itemName('viande_crue', n)}. Il en reste sur la carcasse.` : `Vous prélevez ${itemName('viande_crue', n)}. Il ne reste que les os.`, 'info');
  }

  /** Piège déclenché par une créature. */
  private onTrapTriggered(trapId: string, creature: string, sp: SpeciesId): void {
    const def = this.props.defOf(trapId);
    const t = def?.trap;
    if (!def || !t) return;
    const s = this.state;
    const near = Math.hypot(def.x - s.x, def.z - s.z) < 60;
    const d = SPECIES[sp];
    t.armed = false;
    if (def.kind === 'collet') {
      if (d.mass <= 130) {
        t.caught = creature;
        this.fauna.setCaught(creature, trapId);
        if (near) this.msg(`${cap(speciesName(sp))} se débat, pris dans votre collet !`, 'info');
      } else {
        t.broken = true;
        if (near) this.msg(`${cap(speciesName(sp))} a arraché votre collet.`, 'alerte');
      }
    } else if (def.kind === 'fosse') {
      const res = this.fauna.hurt(creature, d.mass > 1000 ? 140 : 75, 'pattes', { bleed: true, by: 'piege', x: def.x, z: def.z });
      if (res && !res.killed && d.mass <= 1000) {
        t.caught = creature;
        this.fauna.setCaught(creature, trapId);
      }
      if (near) this.msg(`${cap(speciesName(sp))} tombe dans la fosse à pieux !`, 'info');
    } else if (def.kind === 'assommoir') {
      this.dropTrapStone(def);
    }
    this.refreshFaunaEnv();
  }

  /** La pierre de l'assommoir tombe (vraie pièce physique). */
  private dropTrapStone(def: PropDef): void {
    const mass = 20;
    const r = Math.cbrt(mass / ((4 / 3) * Math.PI * 2600));
    const id = this.props.spawnDynamic({ kind: 'pierre', x: def.x + 0.05, y: def.y + 1.1, z: def.z, rot: 0.2, radius: r, length: 0 }, { x: 0, y: -1.5, z: 0 });
    this.projectiles.set(id, { left: 2, age: 0, trap: true });
    this.push({ type: 'son', kind: 'piege', x: def.x, y: def.y, z: def.z, tick: this.tick });
  }

  /** Le joueur marche sur un piège armé. */
  private stepPlayerTraps(): void {
    if (this.trappedIn || this.vitals.state !== 'eveille' || this.state.mode !== MODE_WALK) return;
    const s = this.state;
    const v = this.vitals;
    for (const def of this.props.liveOfKind(TRAP_KINDS)) {
      const t = def.trap;
      if (!t?.armed) continue;
      const r = def.kind === 'fosse' ? 0.9 : def.kind === 'collet' ? 0.35 : 0.45;
      if (Math.hypot(def.x - s.x, def.z - s.z) > r) continue;
      t.armed = false;
      if (def.kind === 'collet') {
        t.caught = 'joueur';
        this.trappedIn = def.id;
        if (rand(v) < 0.2) addInjury(v, rand(v) < 0.5 ? 'jambe_g' : 'jambe_d', 'entorse');
        this.push({ type: 'son', kind: 'piege', x: def.x, y: def.y, z: def.z, tick: this.tick });
        this.msg('Votre pied se prend dans le collet ! E pour vous dégager.', 'alerte');
      } else if (def.kind === 'fosse') {
        t.caught = 'joueur';
        this.trappedIn = def.id;
        damage(v, 20 + rand(v) * 15);
        const leg: Zone = rand(v) < 0.5 ? 'jambe_g' : 'jambe_d';
        addInjury(v, leg, rand(v) < 0.35 ? 'fracture' : 'entorse');
        if (rand(v) < 0.7) addInjury(v, rand(v) < 0.5 ? 'jambe_g' : 'jambe_d', 'coupure', rand(v) < 0.3);
        this.push({ type: 'attaque', sp: 'impala', zone: leg, tick: this.tick });
        this.msg('Vous tombez dans la fosse à pieux ! E pour en sortir.', 'danger');
      } else {
        this.dropTrapStone(def);
      }
      this.refreshFaunaEnv();
      return;
    }
  }

  /** Une créature prise se débat : elle peut casser le collet ou sortir de la fosse. */
  private stepTrappedCreatures(): void {
    for (const def of this.props.liveOfKind(TRAP_KINDS)) {
      const t = def.trap;
      if (!t?.caught || t.caught === 'joueur') continue;
      const c = this.fauna.creatures.get(t.caught);
      if (!c || c.dead) {
        t.caught = null;
        continue;
      }
      if (this.fauna.struggleFree(t.caught, def.kind === 'collet' ? 0.05 : 0.02)) {
        t.caught = null;
        if (def.kind === 'collet') t.broken = true;
        const s = this.state;
        if (Math.hypot(def.x - s.x, def.z - s.z) < 60) this.msg(def.kind === 'collet' ? `${cap(speciesName(c.sp, 'le'))} casse le collet et s’enfuit.` : `${cap(speciesName(c.sp, 'le'))} parvient à sortir de la fosse.`, 'alerte');
      }
    }
  }

  /** E sur un piège : le réarmer, ou dire ce qu'il retient. */
  private interactTrap(id: string): ActionResult {
    const def = this.props.defOf(id);
    const t = def?.trap;
    if (!def || !t) return fail();
    if (t.caught && t.caught !== 'joueur') {
      const c = this.fauna.creatures.get(t.caught);
      if (c && !c.dead) return ok(`${cap(speciesName(c.sp, 'un'))} est pris : achevez-le (Utiliser avec une arme).`);
      t.caught = null;
    }
    if (t.armed) return ok(def.kind === 'fosse' ? 'La fosse est couverte et prête.' : def.kind === 'collet' ? 'Le collet est tendu.' : 'L’assommoir est tendu.');
    return this.startTrapGesture(id, 'rearmer');
  }

  private trapNeeds(def: PropDef): Need[] {
    if (def.kind === 'collet') return def.trap?.broken ? [['corde', 1]] : [];
    if (def.kind === 'fosse') return [['herbe', 2]];
    return [['pierre', 15]];
  }

  private startTrapGesture(id: string, op: 'liberer' | 'rearmer'): ActionResult {
    const def = this.props.defOf(id);
    if (!def?.trap) return fail();
    if (op === 'rearmer') {
      const c = { x: def.x, y: def.y, z: def.z };
      const missing = this.missingNeed(this.trapNeeds(def), c);
      if (missing) return fail(`Pour réarmer : ${needLabel(missing)}${def.kind === 'assommoir' ? ' (posée à côté)' : ''}.`);
    }
    const seconds = op === 'liberer' ? (def.kind === 'fosse' ? 4 : 2) : def.kind === 'assommoir' ? 6 : 4;
    const label = op === 'liberer' ? (def.kind === 'fosse' ? 'Vous sortez de la fosse…' : 'Vous dégagez votre pied du collet…') : `Vous réarmez ${PROP_ARTICLE(def.kind)}…`;
    this.gesture = { kind: 'piege', label, total: seconds, left: seconds, trap: id, trapOp: op };
    return ok();
  }

  private finishTrapGesture(id: string, op: 'liberer' | 'rearmer'): void {
    const def = this.props.defOf(id);
    const t = def?.trap;
    if (!def || !t) {
      if (op === 'liberer') this.trappedIn = null;
      return;
    }
    if (op === 'liberer') {
      this.trappedIn = null;
      t.caught = null;
      if (def.kind === 'collet') t.broken = true;
      this.msg(def.kind === 'fosse' ? 'Vous êtes sorti de la fosse.' : 'Vous êtes libre.', 'info');
      return;
    }
    const c = { x: def.x, y: def.y, z: def.z };
    const needs = this.trapNeeds(def);
    if (this.missingNeed(needs, c)) return;
    this.consumeNeeds(needs, c);
    t.armed = true;
    t.caught = null;
    t.broken = false;
    this.refreshFaunaEnv();
    this.msg(`${cap(PROP_ARTICLE(def.kind))} est de nouveau ${def.kind === 'fosse' ? 'prête' : 'tendu'}.`, 'info');
  }

  /** Pièce de construction qui barre le passage en ce point (clôtures, murs, portes fermées). */
  private pieceNear(x: number, y: number, z: number, r: number): { s: string; p: number; wood: boolean } | null {
    for (const st of this.build.structures) {
      if (Math.hypot(st.x - x, st.z - z) > 40) continue;
      for (const p of st.pieces) {
        if (!isDone(p)) continue;
        const kind = PLANS[p.plan].piece;
        if (kind === 'sol' || kind === 'dallage' || kind === 'toit' || kind === 'echelle') continue;
        for (const b of pieceBoxes(st, p, true)) {
          const c = Math.cos(-b.yaw);
          const sn = Math.sin(-b.yaw);
          const lx = (x - b.x) * c - (z - b.z) * sn;
          const lz = (x - b.x) * sn + (z - b.z) * c;
          const ly = y - b.y;
          const dx = Math.max(0, Math.abs(lx) - b.hx);
          const dy = Math.max(0, Math.abs(ly) - b.hy);
          const dz = Math.max(0, Math.abs(lz) - b.hz);
          if (dx * dx + dy * dy + dz * dz <= r * r) return { s: st.id, p: p.id, wood: p.mat === 'bois' || p.mat === 'chaume' };
        }
      }
    }
    return null;
  }

  /** Créatures autour du joueur (affichage). */
  creatureViews(): ReturnType<Fauna['views']> {
    return this.fauna.views();
  }

  /** Fait apparaître des créatures (outils de test, tests automatiques). */
  spawnCreatures(sp: SpeciesId, x: number, z: number, n?: number): string[] {
    const g = this.fauna.spawnGroup(sp, x, z, n);
    return [...g.members];
  }

  serialize(): SimSave {
    const s = this.state;
    let pos = { x: s.x, y: s.y, z: s.z };
    let vitals = this.vitals;
    if (this.dead) {
      const t = this.respawnTarget.point;
      pos = { x: t.x, y: t.y + 0.15, z: t.z };
      vitals = makeVitals(this.vitals.rng);
      vitals.health = VITALS.respawn.health;
      vitals.energy = VITALS.respawn.energy;
      vitals.fatigue = VITALS.respawn.fatigue;
    }
    return {
      version: 1,
      time: this.time,
      player: { ...pos, vitals, inventory: this.inventory, respawn: this.respawnPoint, lastBody: this.lastBody, knowledge: this.knowledge },
      props: this.props.serialize(),
      world: this.world.serialize(),
      build: this.build.serialize(),
      fauna: this.fauna.serialize(),
    };
  }

  /** Reprend une sauvegarde ; renvoie la position du joueur si elle est valide. */
  private restore(raw: unknown): SpawnPoint | null {
    if (typeof raw !== 'object' || raw === null) return null;
    const r = raw as Record<string, unknown>;
    if (typeof r.time === 'number' && Number.isFinite(r.time) && r.time >= 0) this.time = r.time;
    this.props.restore(r.props);
    this.world.restore(r.world);
    this.build.restore(r.build);
    this.fauna.restore(r.fauna);
    const p = r.player as Record<string, unknown> | undefined;
    if (!p || typeof p !== 'object') return null;
    this.vitals = readVitals(p.vitals, this.vitals.rng);
    this.inventory = readInventory(p.inventory);
    this.knowledge = readKnowledge(p.knowledge);
    const pt = (o: unknown): SpawnPoint | null => {
      const q = o as Record<string, unknown> | null;
      if (!q || typeof q !== 'object') return null;
      const { x, y, z } = q;
      return typeof x === 'number' && typeof y === 'number' && typeof z === 'number' && [x, y, z].every(Number.isFinite) && Math.abs(x) < 8000 && Math.abs(z) < 8000 ? { x, y, z } : null;
    };
    this.respawnPoint = pt(p.respawn);
    const lb = p.lastBody as Record<string, unknown> | null;
    if (lb && typeof lb.id === 'string' && typeof lb.x === 'number' && typeof lb.z === 'number') this.lastBody = { id: lb.id, x: lb.x, z: lb.z };
    return pt(p);
  }

  dispose(): void {
    this.phys.dispose();
  }
}
