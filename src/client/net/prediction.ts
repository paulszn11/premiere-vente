// Prédiction côté client et réconciliation avec le serveur, interpolation des autres joueurs.
// Ce module n'utilise ni le DOM ni le rendu : il est testé dans Node avec le vrai serveur.

import { PHYS_CHUNK_RADIUS, TICK_DT, TICK_RATE } from '../../shared/constants';
import { type InputCmd, type MoveState, cloneState, copyState, positionError, stepMovement } from '../../shared/movement';
import type { PhysicsWorld, RAPIER } from '../../shared/physics';
import type { NetPlayer } from '../../shared/protocol';

interface HistoryEntry {
  cmd: InputCmd;
  after: MoveState;
}

export interface ReconcileResult {
  corrected: boolean;
  error: number;
  replayed: number;
}

/** Au-delà de cette correction, la position est replacée sans lissage. */
const SNAP_DISTANCE = 2;
const MAX_HISTORY = 900;

export class Predictor {
  readonly state: MoveState;
  /** État avant le dernier pas (pour interpoler l'affichage entre deux pas). */
  readonly prev: MoveState;
  /** Décalage visuel résiduel après une correction, ramené progressivement à zéro. */
  readonly visualOffset = { x: 0, y: 0, z: 0 };
  corrections = 0;
  lastCorrection = 0;
  private readonly history: HistoryEntry[] = [];
  private readonly collider: RAPIER.Collider;
  private ticks = 0;

  constructor(
    private readonly phys: PhysicsWorld,
    initial: MoveState,
  ) {
    this.state = cloneState(initial);
    this.prev = cloneState(initial);
    this.collider = phys.createPlayerCollider(initial.x, initial.y, initial.z);
  }

  get pendingCount(): number {
    return this.history.length;
  }

  private prepareWorld(): void {
    this.phys.ensureAround([this.state], PHYS_CHUNK_RADIUS, this.ticks);
    if (this.ticks % 120 === 0) this.phys.unloadUnused(this.ticks, 600);
    this.phys.refresh();
  }

  /** Applique immédiatement une commande locale (sans attendre le serveur). */
  applyLocal(cmd: InputCmd): void {
    copyState(this.prev, this.state);
    this.prepareWorld();
    stepMovement(this.phys, this.collider, this.state, cmd, TICK_DT);
    this.history.push({ cmd, after: cloneState(this.state) });
    if (this.history.length > MAX_HISTORY) this.history.shift();
    this.ticks++;
  }

  /**
   * Compare l'état du serveur (après la commande `ack`) à la prédiction. En cas d'écart,
   * repart de l'état du serveur et rejoue les commandes pas encore confirmées.
   */
  onServerState(ack: number, server: MoveState): ReconcileResult {
    let predictedAtAck: MoveState | null = null;
    while (this.history.length > 0 && this.history[0]!.cmd.seq <= ack) {
      const e = this.history.shift()!;
      if (e.cmd.seq === ack) predictedAtAck = e.after;
    }
    if (predictedAtAck) {
      const posErr = positionError(predictedAtAck, server);
      const velErr = Math.abs(predictedAtAck.vx - server.vx) + Math.abs(predictedAtAck.vy - server.vy) + Math.abs(predictedAtAck.vz - server.vz);
      if (posErr < 1e-4 && velErr < 1e-3 && predictedAtAck.grounded === server.grounded && predictedAtAck.jumpLatch === server.jumpLatch) {
        return { corrected: false, error: posErr, replayed: 0 };
      }
    } else if (this.history.length > 0 && ack === 0) {
      // Aucune commande encore traitée par le serveur : rien de fiable à comparer.
      // On se recale quand même si l'écart est important (téléportation, apparition).
    }

    const before = cloneState(this.state);
    copyState(this.state, server);
    copyState(this.prev, server);
    this.prepareWorld();
    for (const h of this.history) {
      copyState(this.prev, this.state);
      stepMovement(this.phys, this.collider, this.state, h.cmd, TICK_DT);
      copyState(h.after, this.state);
    }
    const dx = before.x - this.state.x;
    const dy = before.y - this.state.y;
    const dz = before.z - this.state.z;
    const jump = Math.sqrt(dx * dx + dy * dy + dz * dz);
    if (jump > SNAP_DISTANCE) {
      this.visualOffset.x = 0;
      this.visualOffset.y = 0;
      this.visualOffset.z = 0;
    } else {
      this.visualOffset.x += dx;
      this.visualOffset.y += dy;
      this.visualOffset.z += dz;
    }
    if (jump > 1e-4) {
      this.corrections++;
      this.lastCorrection = jump;
    }
    return { corrected: jump > 1e-4, error: jump, replayed: this.history.length };
  }

  /** Atténue le décalage visuel (demi-vie d'environ 60 ms). */
  decayVisualOffset(dt: number): void {
    const k = Math.exp(-dt / 0.085);
    this.visualOffset.x *= k;
    this.visualOffset.y *= k;
    this.visualOffset.z *= k;
  }

  /** Position affichée : interpolation entre deux pas + décalage de correction. */
  renderPosition(alpha: number, out: { x: number; y: number; z: number }): void {
    out.x = this.prev.x + (this.state.x - this.prev.x) * alpha + this.visualOffset.x;
    out.y = this.prev.y + (this.state.y - this.prev.y) * alpha + this.visualOffset.y;
    out.z = this.prev.z + (this.state.z - this.prev.z) * alpha + this.visualOffset.z;
  }

  dispose(): void {
    this.phys.removeCollider(this.collider);
  }
}

/** Estimation du pas courant du serveur à partir des instantanés reçus. */
export class ServerClock {
  private offset = 0;
  private initialised = false;

  update(serverTick: number, nowMs: number): void {
    const sample = serverTick - (nowMs * TICK_RATE) / 1000;
    if (!this.initialised) {
      this.offset = sample;
      this.initialised = true;
    } else if (sample > this.offset) {
      this.offset += (sample - this.offset) * 0.3;
    } else {
      this.offset += (sample - this.offset) * 0.02;
    }
  }

  tickAt(nowMs: number): number {
    return (nowMs * TICK_RATE) / 1000 + this.offset;
  }
}

interface InterpSnap {
  tick: number;
  players: Map<string, NetPlayer>;
}

function lerpAngle(a: number, b: number, t: number): number {
  let d = b - a;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return a + d * t;
}

/** Interpolation des autres joueurs, affichés avec un léger retard pour rester fluides. */
export class Interpolator {
  private readonly snaps: InterpSnap[] = [];

  push(tick: number, players: NetPlayer[]): void {
    const last = this.snaps[this.snaps.length - 1];
    if (last && tick <= last.tick) return;
    this.snaps.push({ tick, players: new Map(players.map((p) => [p.id, p])) });
    if (this.snaps.length > 40) this.snaps.shift();
  }

  get latestTick(): number {
    return this.snaps[this.snaps.length - 1]?.tick ?? 0;
  }

  sample(renderTick: number): NetPlayer[] {
    const n = this.snaps.length;
    if (n === 0) return [];
    const first = this.snaps[0]!;
    const last = this.snaps[n - 1]!;
    if (renderTick >= last.tick) return [...last.players.values()];
    if (renderTick <= first.tick) return [...first.players.values()];
    let k = n - 2;
    while (k > 0 && this.snaps[k]!.tick > renderTick) k--;
    const a = this.snaps[k]!;
    const b = this.snaps[k + 1]!;
    const t = (renderTick - a.tick) / (b.tick - a.tick);
    const out: NetPlayer[] = [];
    for (const pb of b.players.values()) {
      const pa = a.players.get(pb.id);
      if (!pa) {
        out.push(pb);
        continue;
      }
      out.push({
        id: pb.id,
        x: pa.x + (pb.x - pa.x) * t,
        y: pa.y + (pb.y - pa.y) * t,
        z: pa.z + (pb.z - pa.z) * t,
        yaw: lerpAngle(pa.yaw, pb.yaw, t),
        pitch: pa.pitch + (pb.pitch - pa.pitch) * t,
      });
    }
    return out;
  }
}
