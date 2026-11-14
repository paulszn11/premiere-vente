// Réplication (phase 8) : ce que le serveur de l'hôte envoie à chaque joueur distant, et comment la copie
// du monde de ce joueur l'applique. Rien ici ne touche au réseau : c'est testé dans Node avec deux simulations.
//
// - « snap » (20 fois par seconde, canal rapide) : sa position (accusé de la dernière commande appliquée),
//   les autres joueurs, créatures et véhicules proches.
// - « self » (quand il change) : son corps, son sac, son carnet, son geste, sa conduite.
// - « props » (10 fois par seconde) : les objets des chunks autour de lui (créés, déplacés, disparus).
// - « veh », « build », « world » (quand ils changent) : véhicules proches, constructions, arbres et gisements.
// - « ev » : ses événements (messages, sons, panneaux à ouvrir, chutes…).

import { PHYS_CHUNK_RADIUS } from './constants';
import type { CreatureView } from './fauna';
import type { MoveState } from './movement';
import type { PropDef, PropKind } from './props';
import type { LocalSimulation, SelfState, SimEvent } from './simulation';
import { chunkCoord, chunkKey } from './terrain';
import type { VehicleState } from './vehicles';

/** Un autre joueur, tel que le voit un joueur proche. */
export interface NetPlayerView {
  id: string;
  name: string;
  x: number;
  y: number;
  z: number;
  yaw: number;
  pitch: number;
  crouched: boolean;
  /** Mode de déplacement (marche, nage, escalade). */
  mode: number;
  state: 'eveille' | 'inconscient' | 'critique' | 'mort';
  /** Endormi (déconnecté, ou qui dort). */
  asleep: boolean;
  /** Objet tenu en main (forme affichée), ou null. */
  held: PropKind | null;
  driving: boolean;
}

export type PoseTuple = [id: string, x: number, y: number, z: number, qx: number, qy: number, qz: number, qw: number];

export type HostMessage =
  | { t: 'snap'; tick: number; time: number; ack: number; you: MoveState; pl: NetPlayerView[]; cr: CreatureView[]; vp: PoseTuple[] }
  | { t: 'self'; d: SelfState }
  | { t: 'props'; area: string[]; ids?: string[]; up?: Array<[PropDef, number, number, number, number, number, number, number]>; pose?: PoseTuple[] }
  | { t: 'veh'; list: VehicleState[] }
  | { t: 'build'; v: number; d: unknown }
  | { t: 'world'; v: number; d: unknown }
  | { t: 'ev'; e: SimEvent[] };

/** Distance au-delà de laquelle on n'envoie ni les autres joueurs ni les créatures (aucune carte, § phase 2). */
export const VIEW_RANGE = 200;
const VEHICLE_RANGE = 300;

const r3 = (v: number) => Math.round(v * 1000) / 1000;

function areaAround(x: number, z: number): string[] {
  const cx = chunkCoord(x);
  const cz = chunkCoord(z);
  const out: string[] = [];
  for (let dz = -PHYS_CHUNK_RADIUS; dz <= PHYS_CHUNK_RADIUS; dz++) for (let dx = -PHYS_CHUNK_RADIUS; dx <= PHYS_CHUNK_RADIUS; dx++) out.push(chunkKey(cx + dx, cz + dz));
  return out;
}

/** Côté hôte : ce qu'il faut envoyer à un joueur distant, pas après pas. */
export class Replicator {
  private readonly sentDef = new Map<string, string>();
  private readonly sentPose = new Map<string, string>();
  private sentIds = '';
  private buildV = -1;
  private worldV = -1;
  private vehJson = '';
  private selfJson = '';

  constructor(
    private readonly sim: LocalSimulation,
    readonly playerId: string,
  ) {}

  /** Tout renvoyer (nouvelle connexion, reprise après une coupure). */
  reset(): void {
    this.sentDef.clear();
    this.sentPose.clear();
    this.sentIds = '';
    this.buildV = -1;
    this.worldV = -1;
    this.vehJson = '';
    this.selfJson = '';
  }

  /** Messages à envoyer après ce pas (le numéro de pas règle leur fréquence). */
  collect(tick: number): HostMessage[] {
    const out: HostMessage[] = [];
    const sl = this.sim.players.get(this.playerId);
    if (!sl) return out;
    const sim = this.sim;
    if (tick % 3 === 0) out.push(this.snap(tick));
    if (tick % 6 === 0) {
      const self = sim.withPlayer(sl, () => sim.selfState());
      const json = JSON.stringify(self);
      if (json !== this.selfJson) {
        this.selfJson = json;
        out.push({ t: 'self', d: JSON.parse(json) as SelfState });
      }
      const props = this.props(tick % 30 === 0);
      if (props) out.push(props);
    }
    if (tick % 30 === 0 || this.buildV < 0) {
      if (sim.build.version !== this.buildV) {
        this.buildV = sim.build.version;
        out.push({ t: 'build', v: sim.build.version, d: sim.build.serialize() });
      }
      if (sim.world.version !== this.worldV) {
        this.worldV = sim.world.version;
        out.push({ t: 'world', v: sim.world.version, d: sim.world.serialize() });
      }
      const near = sim.vehicles.filter((v) => Math.hypot(v.x - sl.state.x, v.z - sl.state.z) < VEHICLE_RANGE);
      const json = JSON.stringify(near);
      if (json !== this.vehJson) {
        this.vehJson = json;
        out.push({ t: 'veh', list: JSON.parse(json) as VehicleState[] });
      }
    }
    const ev = sim.takePlayerEvents(this.playerId);
    if (ev.length) out.push({ t: 'ev', e: ev });
    return out;
  }

  private snap(tick: number): HostMessage {
    const sim = this.sim;
    const me = sim.players.get(this.playerId)!;
    const s = me.state;
    const pl: NetPlayerView[] = [];
    for (const o of sim.players.values()) {
      if (o === me) continue;
      const os = o.state;
      if (Math.hypot(os.x - s.x, os.z - s.z) > VIEW_RANGE) continue;
      pl.push(
        sim.withPlayer(o, () => {
          const h = sim.props.held;
          const def = h ? sim.props.defOf(h.id) : null;
          return {
            id: o.id,
            name: o.name,
            x: r3(os.x),
            y: r3(os.y),
            z: r3(os.z),
            yaw: r3(o === sim.local ? sim.local.cmd.yaw : o.cmd.yaw),
            pitch: r3(o === sim.local ? sim.local.cmd.pitch : o.cmd.pitch),
            crouched: os.crouched,
            mode: os.mode,
            state: sim.vitals.state,
            asleep: o.away || sim.vitals.posture === 'endormi',
            held: def?.kind ?? null,
            driving: sim.driving !== null,
          };
        }),
      );
    }
    const cr = sim.fauna.enabled ? sim.fauna.views().filter((c) => Math.hypot(c.x - s.x, c.z - s.z) < VIEW_RANGE) : [];
    const vp: PoseTuple[] = [];
    for (const v of sim.vehicles) if (Math.hypot(v.x - s.x, v.z - s.z) < VEHICLE_RANGE) vp.push([v.id, r3(v.x), r3(v.y), r3(v.z), r3(v.qx), r3(v.qy), r3(v.qz), r3(v.qw)]);
    return { t: 'snap', tick, time: sim.time, ack: me.lastSeq, you: { ...s }, pl, cr, vp };
  }

  private props(checkDefs: boolean): HostMessage | null {
    const sim = this.sim;
    const me = sim.players.get(this.playerId)!;
    const area = areaAround(me.state.x, me.state.z);
    const inArea = new Set(area);
    const ids: string[] = [];
    const up: Array<[PropDef, number, number, number, number, number, number, number]> = [];
    const pose: PoseTuple[] = [];
    for (const id of sim.props.liveIds()) {
      const lp = sim.props.livePose(id);
      if (!lp || !inArea.has(chunkKey(chunkCoord(lp.x), chunkCoord(lp.z)))) continue;
      ids.push(id);
      const p: [number, number, number, number, number, number, number] = [r3(lp.x), r3(lp.y), r3(lp.z), r3(lp.qx), r3(lp.qy), r3(lp.qz), r3(lp.qw)];
      const pk = p.join(',');
      const known = this.sentDef.get(id);
      if (known === undefined || checkDefs) {
        const dj = JSON.stringify(lp.def);
        if (dj !== known) {
          this.sentDef.set(id, dj);
          this.sentPose.set(id, pk);
          up.push([JSON.parse(dj) as PropDef, ...p]);
          continue;
        }
      }
      if (this.sentPose.get(id) !== pk) {
        this.sentPose.set(id, pk);
        pose.push([id, ...p]);
      }
    }
    ids.sort();
    const idsKey = ids.join('|') + '#' + area.join('|');
    const keep = new Set(ids);
    for (const id of [...this.sentDef.keys()]) {
      if (keep.has(id)) continue;
      this.sentDef.delete(id);
      this.sentPose.delete(id);
    }
    const changed = idsKey !== this.sentIds;
    if (!changed && !up.length && !pose.length) return null;
    const msg: HostMessage = { t: 'props', area };
    if (changed) {
      this.sentIds = idsKey;
      msg.ids = ids;
    }
    if (up.length) msg.up = up;
    if (pose.length) msg.pose = pose;
    return msg;
  }
}

/** Côté joueur distant : applique un message de l'hôte à sa copie du monde. Renvoie les autres joueurs (snap). */
export function applyHostMessage(sim: LocalSimulation, msg: HostMessage): { players?: NetPlayerView[]; error?: number } {
  switch (msg.t) {
    case 'snap': {
      const error = sim.reconcile(msg.you, msg.ack, msg.time);
      sim.remoteCreatures = msg.cr;
      for (const [id, x, y, z, qx, qy, qz, qw] of msg.vp) {
        const v = sim.vehicle(id);
        if (!v) continue;
        sim.vehiclePrev.set(id, { x: v.x, y: v.y, z: v.z, qx: v.qx, qy: v.qy, qz: v.qz, qw: v.qw });
        Object.assign(v, { x, y, z, qx, qy, qz, qw });
      }
      return { players: msg.pl, error };
    }
    case 'self':
      sim.applySelf(msg.d);
      return {};
    case 'props': {
      const held = sim.props.held?.id;
      if (msg.ids) {
        const keep = new Set(msg.ids);
        const area = new Set(msg.area);
        for (const id of sim.props.liveIds()) {
          if (keep.has(id)) continue;
          const p = sim.props.position(id);
          if (p && area.has(chunkKey(chunkCoord(p.x), chunkCoord(p.z)))) sim.props.forget(id);
        }
      }
      for (const [def, x, y, z, qx, qy, qz, qw] of msg.up ?? []) {
        if (def.id === held && sim.props.livePose(def.id)) continue;
        sim.props.upsert(def, { x, y, z, qx, qy, qz, qw });
      }
      for (const [id, x, y, z, qx, qy, qz, qw] of msg.pose ?? []) if (id !== held) sim.props.setPose(id, x, y, z, qx, qy, qz, qw);
      return {};
    }
    case 'veh': {
      const poses = new Map(sim.vehicles.map((v) => [v.id, v]));
      sim.applyVehicles(msg.list);
      // Garder la position la plus récente (snap) plutôt que celle, plus ancienne, de l'état complet.
      for (const v of sim.vehicles) {
        const p = poses.get(v.id);
        if (p) Object.assign(v, { x: p.x, y: p.y, z: p.z, qx: p.qx, qy: p.qy, qz: p.qz, qw: p.qw });
      }
      return {};
    }
    case 'build':
      sim.applyBuild(msg.d, msg.v);
      return {};
    case 'world':
      sim.applyWorld(msg.d, msg.v);
      return {};
    case 'ev':
      sim.pushRemoteEvents(msg.e);
      return {};
  }
}
