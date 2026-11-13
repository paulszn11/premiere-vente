// Simulation du monde à pas fixe (60 pas par seconde), séparée de l'affichage.
// Phase 3 : un seul joueur, simulation dans la page, avec son corps (santé, énergie, fatigue,
// blessures, soins), son inventaire, la mort, le corps laissé dans le monde et la réapparition.
// En phase 8, cette même logique tournera sur le serveur de l'hôte et le client prédira.

import type { ActionResult, HandOrSlot, PlayerAction } from './actions';
import { KILL_Y, PHYS_CHUNK_RADIUS, TICK_DT } from './constants';
import { PropSystem, REACH, lookDirection } from './interaction';
import {
  CLOTHING_LABELS,
  type Container,
  type Inventory,
  type ItemStack,
  POCKET_MAX_L,
  RAGS_PER_PART,
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
} from './inventory';
import { ITEMS, type ItemId, itemName } from './items';
import {
  BTN_CROUCH,
  BTN_INTERACT,
  BTN_JUMP,
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
import { type HeightProvider, PhysicsWorld, type RAPIER, initPhysics } from './physics';
import { ITEM_OF_PROP, type PropDef, type PropKind, QUICK_PICK, itemShape } from './props';
import { type SpawnPoint, chooseSpawn, findSpawnNear } from './spawn';
import { Terrain } from './terrain';
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
  applyFall,
  applyTreatment,
  bleedRate,
  canTreatSelf,
  die,
  eat,
  fallAsleep,
  limits,
  makeVitals,
  readVitals,
  sitDown,
  standUp,
  tickVitals,
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
  /** Le joueur veut ouvrir un sac posé ou fouiller un corps. */
  | { type: 'ouvrir'; prop: string; tick: number }
  | { type: 'mort'; cause: DeathCause; tick: number }
  | { type: 'reapparition'; tick: number; place: 'sommeil' | 'arrivee' | 'secours'; body: { distance: number; direction: string } | null };

/** Geste en cours (manger, soigner) : il prend du temps et bouger l'interrompt. */
export interface Gesture {
  kind: 'manger' | 'soin';
  label: string;
  total: number;
  left: number;
  food?: { item: ItemId; from: HandOrSlot };
  injury?: number;
  treatment?: Treatment;
}

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
  };
  props: ReturnType<PropSystem['serialize']>;
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
  private readonly collider: RAPIER.Collider;
  private lastDrownEvent = -1e9;
  private yaw = 0;

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
    this.spawn = opts.spawnSeed !== undefined ? chooseSpawn(this.terrain, opts.spawnSeed) : findSpawn(this.terrain);
    this.vitals = makeVitals((opts.spawnSeed ?? this.terrain.seed) ^ 0x5eed);
    this.inventory = makeInventory(true);
    let start = opts.start ?? this.spawn;
    // La sauvegarde est reprise avant le chargement des premiers chunks (objets ramassés, déplacés).
    if (opts.save !== undefined) start = this.restore(opts.save) ?? start;
    this.state = makeState(start.x, start.y, start.z);
    this.prev = makeState(start.x, start.y, start.z);
    this.phys.ensureAround([this.state], PHYS_CHUNK_RADIUS, 0);
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
    if (this.tick % 120 === 0) this.phys.unloadUnused(this.tick, 600);
    this.time += TICK_DT;
    this.yaw = q.yaw;

    if (v.state === 'mort') {
      this.deadTime += TICK_DT;
      this.phys.step(TICK_DT);
      if (this.deadTime >= RESPAWN_DELAY) this.respawnAfterDeath();
      this.tick++;
      return;
    }

    this.applyLimits();
    // Bouger interrompt un geste, fait se lever ou réveille.
    const wantsMove = q.wx * q.wx + q.wz * q.wz > 0.01 || (q.buttons & BTN_JUMP) !== 0;
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
    else if (this.gesture) c = { ...q, wx: 0, wz: 0, buttons: q.buttons & BTN_CROUCH };

    const pressed = c.buttons & ~s.prevButtons;
    let propPressed = pressed;
    if (v.state !== 'eveille') {
      if (this.props.held) this.props.drop(s);
      propPressed = 0;
    } else if ((pressed & BTN_INTERACT) !== 0 && !this.props.held) {
      // Petits objets rangés directement ; sacs et corps s'ouvrent (affichage).
      const t = this.props.target(s, c.yaw, c.pitch);
      if (t && QUICK_PICK.has(t.kind)) {
        if (this.pickUp(t.id)) propPressed &= ~BTN_INTERACT;
      } else if (t && (t.kind === 'sac' || t.kind === 'corps')) {
        propPressed &= ~BTN_INTERACT;
        this.push({ type: 'ouvrir', prop: t.id, tick: this.tick });
      }
    }
    this.props.update(s, c, propPressed);
    if (this.props.refusal) {
      this.msg(this.props.refusal, 'alerte');
      this.props.refusal = null;
    }
    stepMovement(this.phys, this.collider, s, c, TICK_DT);
    this.phys.step(TICK_DT);
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
    tickVitals(v, TICK_DT, { staminaSpent: s.spent, moving, loadKg: s.loadKg + s.carryMass, inWater: s.mode === MODE_SWIM, drowning: s.drowning, grounded: s.grounded }, out);
    for (const e of out) this.onVital(e);
    if (this.dead) {
      this.tick++;
      return;
    }
    this.stepGesture();
    if (this.tick % 600 === 0) this.cleanupBodies();
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
    const st: ItemStack = { item, count: 1 };
    if (item === 'pierre') {
      st.mass = this.props.massOf(id) || undefined;
      if (st.mass === undefined) delete st.mass;
      st.radius = def.radius;
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
      const shape = st.item === 'pierre' ? { radius: st.radius ?? 0.08, length: 0 } : itemShape(kind);
      const y = Math.max(s.y + 0.45, this.terrain.heightAt(x, z) + shape.radius + 0.1);
      this.props.spawnDynamic({ kind, x, y, z, rot: (k * 0.37) % 1, ...shape });
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
    if (g.left > 0) return;
    this.gesture = null;
    if (g.kind === 'manger' && g.food) this.finishEating(g.food.item, g.food.from);
    else if (g.kind === 'soin' && g.injury !== undefined && g.treatment) this.finishTreatment(g.injury, g.treatment);
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
    for (const [item, n] of opt.needs) if (this.available(item) < n) return fail(`Il vous faut ${itemName(item, n)}.`);
    this.gesture = { kind: 'soin', label: `${TREATMENT_LABELS[t]} (${ZONE_LABELS[inj.zone]})…`, total: opt.seconds, left: opt.seconds, injury: injuryId, treatment: t };
    return ok();
  }

  private finishTreatment(injuryId: number, t: Treatment): void {
    const opt = treatmentOptions(this.vitals).find((o) => o.injury === injuryId && o.treatment === t);
    if (!opt) return;
    for (const [item, n] of opt.needs) if (this.available(item) < n) return this.msg(`Il vous manque ${itemName(item, n)}.`, 'alerte');
    for (const [item, n] of opt.needs) this.use(item, n);
    applyTreatment(this.vitals, injuryId, t);
    const text = t === 'attelle' ? 'Attelle posée : la fracture peut guérir.' : t === 'aloes' ? 'Plaie désinfectée, la douleur s’apaise.' : 'Bandage posé.';
    this.msg(text, 'info');
  }

  /** Meilleur soin à faire avec l'objet tenu (bouton « Utiliser »). */
  private bestTreatmentFor(item: ItemId): { injury: number; treatment: Treatment } | null {
    const v = this.vitals;
    const opts = treatmentOptions(v);
    const injury = (id: number) => v.injuries.find((i) => i.id === id)!;
    if (item === 'chiffon') {
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
        const shape = one.item === 'pierre' ? { radius: one.radius ?? 0.08, length: 0 } : itemShape(kind);
        if (!this.props.holdNew({ kind, rot: 0, ...shape }, s, this.yaw, s.crouched ? 0.6 : 0.3)) {
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
        const h = this.heldItem();
        if (!h) return fail('Vous ne tenez rien à utiliser.');
        if (ITEMS[h.item].food) return this.startEating({ zone: 'main' });
        const best = this.bestTreatmentFor(h.item);
        if (best) return this.startTreatment(best.injury, best.treatment);
        if (h.item === 'chiffon') return fail('Aucune blessure à bander.');
        if (h.item === 'aloes') return fail('Aucune plaie à désinfecter.');
        if (h.item === 'baton') return fail('Une attelle se pose sur une fracture (2 bâtons et 2 chiffons).');
        return fail('Rien à faire avec cet objet.');
      }
      default:
        return fail();
    }
  }

  // ——— Sauvegarde ———

  /** État à sauvegarder. Mort, le joueur est sauvegardé comme déjà réapparu. */
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
      player: { ...pos, vitals, inventory: this.inventory, respawn: this.respawnPoint, lastBody: this.lastBody },
      props: this.props.serialize(),
    };
  }

  /** Reprend une sauvegarde ; renvoie la position du joueur si elle est valide. */
  private restore(raw: unknown): SpawnPoint | null {
    if (typeof raw !== 'object' || raw === null) return null;
    const r = raw as Record<string, unknown>;
    if (typeof r.time === 'number' && Number.isFinite(r.time) && r.time >= 0) this.time = r.time;
    this.props.restore(r.props);
    const p = r.player as Record<string, unknown> | undefined;
    if (!p || typeof p !== 'object') return null;
    this.vitals = readVitals(p.vitals, this.vitals.rng);
    this.inventory = readInventory(p.inventory);
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
