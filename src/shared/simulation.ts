// Simulation du monde à pas fixe (60 pas par seconde), séparée de l'affichage.
// Phase 2 : un seul joueur, simulation dans la page. En phase 8, cette même logique
// tournera sur le serveur de l'hôte et le client ne fera plus que prédire.

import { KILL_Y, PHYS_CHUNK_RADIUS, PLAYER_HALF_HEIGHT, TICK_DT } from './constants';
import { PropSystem } from './interaction';
import { type InputCmd, MODE_WALK, type MoveState, copyState, makeState, quantizeInput, stepMovement } from './movement';
import { type HeightProvider, PhysicsWorld, type RAPIER, initPhysics } from './physics';
import { type SpawnPoint, chooseSpawn, findSpawnNear } from './spawn';
import { Terrain } from './terrain';

export type { SpawnPoint } from './spawn';

/** Point d'apparition près de l'origine (outil de test et repli). */
export function findSpawn(terrain: Terrain): SpawnPoint {
  return findSpawnNear(terrain, 0, 0);
}

/** Événements de la simulation, lus par l'affichage (les effets sur la santé arrivent en phase 3). */
export type SimEvent =
  | { type: 'chute'; severity: number; speed: number; height: number; surface: string; tick: number }
  | { type: 'noyade'; tick: number }
  | { type: 'reapparition'; tick: number };

export interface SimulationOptions {
  /** Graine du point d'apparition du joueur (apparition au hasard dans le monde). */
  spawnSeed?: number;
  /** Position de reprise (dernière position connue). */
  start?: SpawnPoint;
  /** Source de hauteurs précalculées pour la physique. */
  heightProvider?: HeightProvider;
}

export class LocalSimulation {
  readonly terrain: Terrain;
  readonly phys: PhysicsWorld;
  readonly props: PropSystem;
  readonly state: MoveState;
  /** État avant le dernier pas, pour interpoler l'affichage. */
  readonly prev: MoveState;
  readonly spawn: SpawnPoint;
  readonly events: SimEvent[] = [];
  tick = 0;
  respawns = 0;
  private readonly collider: RAPIER.Collider;
  private lastDrownEvent = -1e9;

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
    const start = opts.start ?? this.spawn;
    this.state = makeState(start.x, start.y, start.z);
    this.prev = makeState(start.x, start.y, start.z);
    this.phys.ensureAround([this.state], PHYS_CHUNK_RADIUS, 0);
    this.phys.refresh();
    this.collider = this.phys.createPlayerCollider(start.x, start.y, start.z);
  }

  /** Fait avancer le monde d'un pas avec la commande du joueur. */
  step(cmd: InputCmd): void {
    const q = quantizeInput(cmd);
    const s = this.state;
    copyState(this.prev, s);
    this.phys.ensureAround([s], PHYS_CHUNK_RADIUS, this.tick);
    if (this.tick % 120 === 0) this.phys.unloadUnused(this.tick, 600);
    const pressed = q.buttons & ~s.prevButtons;
    this.props.update(s, q, pressed);
    stepMovement(this.phys, this.collider, s, q, TICK_DT);
    this.phys.step(TICK_DT);
    if (this.tick % 30 === 0) this.props.rescueFallen();

    if (s.impactSeverity > 0) {
      this.events.push({ type: 'chute', severity: s.impactSeverity, speed: s.impact, height: s.impactHeight, surface: s.surface, tick: this.tick });
    }
    if (s.drowning && this.tick - this.lastDrownEvent >= 60) {
      this.lastDrownEvent = this.tick;
      this.events.push({ type: 'noyade', tick: this.tick });
    }
    if (s.y < KILL_Y || !Number.isFinite(s.x + s.y + s.z)) this.respawn();
    if (this.events.length > 50) this.events.splice(0, this.events.length - 50);
    this.tick++;
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
    this.collider.setHalfHeight(PLAYER_HALF_HEIGHT);
    this.phys.ensureAround([s], PHYS_CHUNK_RADIUS, this.tick);
    this.phys.step(TICK_DT);
  }

  respawn(): void {
    this.teleport(this.spawn.x, this.spawn.y, this.spawn.z);
    this.state.mode = MODE_WALK;
    this.respawns++;
    this.events.push({ type: 'reapparition', tick: this.tick });
  }

  dispose(): void {
    this.phys.dispose();
  }
}
