// Objets déplaçables autour du joueur : corps physiques Rapier, ramasser, porter (une ou
// deux mains), lancer, traîner, pousser en marchant. Les objets déplacés, ramassés ou créés
// (sac posé, chiffons, corps) sont mémorisés pour réapparaître au bon endroit quand on revient,
// et sauvegardés.

import { EYE_HEIGHT, EYE_HEIGHT_CROUCH, MOVE } from './constants';
import { type Container, readContainer } from './inventory';
import { BTN_INTERACT, BTN_THROW, type InputCmd, MODE_CLIMB, MODE_SWIM, type MoveState, ONE_HAND_CARRY_KG, R_NO_HEAVY, R_NO_THROW } from './movement';
import { DRAGGED_GROUPS, GROUP_OBSTACLE, GROUP_TERRAIN, HELD_GROUPS, PROP_GROUPS, type PhysicsWorld, QUERY_PROPS, RAPIER, interactionGroups } from './physics';
import { BODY_MASS, DENSITY, type Handling, PROP_LABELS, type PropDef, type PropKind, handlingFor, propMass, propsInChunk } from './props';
import { chunkCoord } from './terrain';

interface LiveProp {
  def: PropDef;
  body: RAPIER.RigidBody;
  collider: RAPIER.Collider;
  mass: number;
  handling: Handling;
}

interface StoredProp {
  def: PropDef;
  x: number;
  y: number;
  z: number;
  qx: number;
  qy: number;
  qz: number;
  qw: number;
}

export interface PropView {
  id: string;
  kind: PropKind;
  radius: number;
  length: number;
  x: number;
  y: number;
  z: number;
  qx: number;
  qy: number;
  qz: number;
  qw: number;
  held: boolean;
}

export interface PropTarget {
  id: string;
  kind: PropKind;
  label: string;
  mass: number;
  handling: Handling;
  distance: number;
}

/** État des objets à sauvegarder (objets naturels ramassés, objets déplacés ou créés). */
export interface PropSave {
  taken: string[];
  props: StoredProp[];
  nextDyn: number;
}

export const REACH = 2.4;
const ANGULAR_DAMPING: Partial<Record<PropKind, number>> = { pierre: 1.5, buche: 3, tronc: 2.5, baton: 3, corps: 4, sac: 3 };
const IDENTITY = { x: 0, y: 0, z: 0, w: 1 };
const AIM_BALL = new RAPIER.Ball(0.14);
const QUERY_SCENERY = interactionGroups(0xffff, GROUP_TERRAIN | GROUP_OBSTACLE);
/** Rotation qui couche un cylindre (axe Y de Rapier) le long de l'axe X. */
const LOG_ROT = { x: 0, y: 0, z: Math.SQRT1_2, w: Math.SQRT1_2 };

function yawQuat(turns: number): { x: number; y: number; z: number; w: number } {
  const a = turns * Math.PI;
  return { x: 0, y: Math.sin(a), z: 0, w: Math.cos(a) };
}

export function lookDirection(yaw: number, pitch: number): { x: number; y: number; z: number } {
  const cp = Math.cos(pitch);
  return { x: Math.sin(yaw) * cp, y: -Math.sin(pitch), z: Math.cos(yaw) * cp };
}

function colliderFor(def: PropDef): RAPIER.ColliderDesc {
  const r = def.radius;
  switch (def.kind) {
    case 'pierre':
      // Pavé aux coins arrondis : une sphère parfaite roulerait sur la moindre pente.
      return RAPIER.ColliderDesc.roundCuboid(r * 0.7, r * 0.55, r * 0.65, r * 0.25).setDensity(DENSITY.pierre);
    case 'buche':
    case 'tronc':
    case 'baton':
      return RAPIER.ColliderDesc.cylinder(def.length / 2, r).setRotation(LOG_ROT).setDensity(DENSITY[def.kind]);
    case 'chiffon':
      return RAPIER.ColliderDesc.cuboid(0.1, 0.012, 0.08).setMass(propMass(def));
    case 'aloes':
      return RAPIER.ColliderDesc.cuboid(0.1, 0.07, 0.1).setMass(propMass(def));
    case 'fruit_baobab':
      return RAPIER.ColliderDesc.roundCuboid(r * 0.6, r * 0.6, r * 1.1, r * 0.35).setMass(propMass(def));
    case 'figue':
    case 'muhacha':
      return RAPIER.ColliderDesc.roundCuboid(r * 0.7, r * 0.7, r * 0.7, r * 0.3).setMass(propMass(def));
    case 'sac':
      return RAPIER.ColliderDesc.cuboid(0.17, 0.22, 0.1).setMass(propMass(def));
    case 'corps':
      return RAPIER.ColliderDesc.capsule(def.length / 2, r).setRotation(LOG_ROT).setMass(BODY_MASS);
  }
}

export class PropSystem {
  private readonly live = new Map<string, LiveProp>();
  private readonly byCollider = new Map<number, string>();
  private readonly stored = new Map<string, StoredProp>();
  /** Objets naturels ramassés : ils ne réapparaissent pas. */
  private readonly taken = new Set<string>();
  private nextDyn = 1;
  held: { id: string; mode: 'carry' | 'drag' } | null = null;
  /** Raison du dernier refus de prise (bras cassé…), lue puis effacée par la simulation. */
  refusal: string | null = null;

  constructor(private readonly phys: PhysicsWorld) {
    phys.onChunkLoaded = (cx, cz) => this.loadChunk(cx, cz);
    phys.onChunkUnloaded = (cx, cz) => this.unloadChunk(cx, cz);
  }

  get liveCount(): number {
    return this.live.size;
  }

  /** Nombre d'objets déplacés mémorisés (y compris hors de la zone simulée). */
  get movedCount(): number {
    return this.stored.size;
  }

  private spawn(def: PropDef, x: number, y: number, z: number, q: { x: number; y: number; z: number; w: number }, sleeping: boolean): void {
    const world = this.phys.world;
    // Amortissement marqué : un objet réel, irrégulier, ne roule pas indéfiniment.
    const bodyDesc = RAPIER.RigidBodyDesc.dynamic()
      .setTranslation(x, y, z)
      .setRotation(q)
      .setLinearDamping(0.3)
      .setAngularDamping(ANGULAR_DAMPING[def.kind] ?? 2.5)
      .setCanSleep(true);
    if (sleeping) bodyDesc.setSleeping(true);
    const body = world.createRigidBody(bodyDesc);
    const colDesc = colliderFor(def).setFriction(0.8).setRestitution(0.1).setCollisionGroups(PROP_GROUPS);
    const collider = world.createCollider(colDesc, body);
    const mass = body.mass();
    this.live.set(def.id, { def, body, collider, mass, handling: handlingFor(mass) });
    this.byCollider.set(collider.handle, def.id);
  }

  /** Ajoute un objet précis (outils de test). */
  add(def: PropDef): void {
    if (this.live.has(def.id)) return;
    this.spawn(def, def.x, def.y, def.z, yawQuat(def.rot), false);
  }

  /** Crée un objet pendant la partie (objet posé, chiffon, sac posé, corps). Renvoie son identifiant. */
  spawnDynamic(def: Omit<PropDef, 'id'>, vel?: { x: number; y: number; z: number }): string {
    const id = `d${this.nextDyn++}`;
    const full: PropDef = { ...def, id, dynamic: true };
    this.spawn(full, full.x, full.y, full.z, yawQuat(full.rot), false);
    if (vel) this.live.get(id)?.body.setLinvel(vel, true);
    return id;
  }

  private despawn(id: string): void {
    const lp = this.live.get(id);
    if (!lp) return;
    if (this.held?.id === id) this.held = null;
    this.byCollider.delete(lp.collider.handle);
    this.phys.world.removeRigidBody(lp.body);
    this.live.delete(id);
  }

  /** Retire définitivement un objet du monde (ramassé, rangé). */
  remove(id: string): PropDef | null {
    const def = this.defOf(id);
    if (!def) return null;
    this.despawn(id);
    this.stored.delete(id);
    if (!def.dynamic) this.taken.add(id);
    return def;
  }

  defOf(id: string): PropDef | null {
    return this.live.get(id)?.def ?? this.stored.get(id)?.def ?? null;
  }

  /** Contenu d'un sac posé ou d'un corps. */
  container(id: string): Container | null {
    return this.defOf(id)?.container ?? null;
  }

  /** À appeler après avoir modifié le contenu d'un sac posé (sa masse change). */
  refreshMass(id: string): void {
    const lp = this.live.get(id);
    if (!lp) return;
    lp.collider.setMass(propMass(lp.def));
    lp.mass = lp.body.mass();
    lp.handling = handlingFor(lp.mass);
  }

  private loadChunk(cx: number, cz: number): void {
    for (const def of propsInChunk(this.phys.terrain, cx, cz)) {
      if (this.live.has(def.id) || this.stored.has(def.id) || this.taken.has(def.id)) continue;
      this.spawn(def, def.x, def.y, def.z, yawQuat(def.rot), true);
    }
    for (const [id, st] of this.stored) {
      if (this.live.has(id) || chunkCoord(st.x) !== cx || chunkCoord(st.z) !== cz) continue;
      this.spawn(st.def, st.x, st.y, st.z, { x: st.qx, y: st.qy, z: st.qz, w: st.qw }, true);
    }
  }

  private snapshot(lp: LiveProp): StoredProp {
    const t = lp.body.translation();
    const r = lp.body.rotation();
    return { def: lp.def, x: t.x, y: t.y, z: t.z, qx: r.x, qy: r.y, qz: r.z, qw: r.w };
  }

  private displaced(id: string, lp: LiveProp): boolean {
    if (lp.def.dynamic || this.stored.has(id)) return true;
    const t = lp.body.translation();
    const r = lp.body.rotation();
    const d = lp.def;
    const q0 = yawQuat(d.rot);
    return Math.abs(t.x - d.x) + Math.abs(t.y - d.y) + Math.abs(t.z - d.z) > 0.15 || Math.abs(r.x - q0.x) + Math.abs(r.y - q0.y) + Math.abs(r.z - q0.z) + Math.abs(r.w - q0.w) > 0.05;
  }

  private unloadChunk(cx: number, cz: number): void {
    for (const [id, lp] of this.live) {
      if (this.held?.id === id) continue;
      const t = lp.body.translation();
      if (chunkCoord(t.x) !== cx || chunkCoord(t.z) !== cz) continue;
      if (this.displaced(id, lp)) this.stored.set(id, this.snapshot(lp));
      this.despawn(id);
    }
  }

  /** Objet visé (à portée de main) depuis les yeux du joueur. */
  target(s: MoveState, yaw: number, pitch: number): PropTarget | null {
    const eyeY = s.y + (s.crouched ? EYE_HEIGHT_CROUCH : EYE_HEIGHT);
    const dir = lookDirection(yaw, pitch);
    const origin = { x: s.x, y: eyeY, z: s.z };
    // Une petite sphère plutôt qu'un rayon fin : viser un petit objet reste facile.
    const hit = this.phys.world.castShape(origin, IDENTITY, dir, AIM_BALL, 0, REACH, true, undefined, QUERY_PROPS, undefined, this.held ? this.live.get(this.held.id)?.body : undefined);
    if (!hit) return null;
    const d = hit.time_of_impact;
    // L'objet ne doit pas être caché derrière le décor.
    const wall = this.phys.world.castRay(new RAPIER.Ray(origin, dir), d, true, undefined, QUERY_SCENERY);
    if (wall && wall.timeOfImpact < d - 0.2) return null;
    const id = this.byCollider.get(hit.collider.handle);
    const lp = id ? this.live.get(id) : undefined;
    if (!id || !lp) return null;
    return { id, kind: lp.def.kind, label: PROP_LABELS[lp.def.kind], mass: lp.mass, handling: lp.handling, distance: d };
  }

  /** Prend un objet en main (ou le traîne s'il est trop lourd). */
  grab(id: string, s: MoveState): boolean {
    const lp = this.live.get(id);
    if (!lp || this.held) return false;
    lp.body.wakeUp();
    if (lp.handling === 'trainer') {
      if (s.stamina < 5) {
        this.refusal = 'Trop épuisé pour traîner cela.';
        return false;
      }
      lp.collider.setCollisionGroups(DRAGGED_GROUPS);
      this.held = { id, mode: 'drag' };
    } else {
      if (lp.handling === 'deux-mains' && (s.restrict & R_NO_HEAVY) !== 0) {
        this.refusal = 'Impossible à deux mains avec un bras cassé.';
        return false;
      }
      lp.body.setGravityScale(0, true);
      lp.body.setAngularDamping(6);
      lp.collider.setCollisionGroups(HELD_GROUPS);
      this.held = { id, mode: 'carry' };
    }
    return true;
  }

  /** Crée un objet directement dans les mains du joueur (sorti du sac ou d'une poche). */
  holdNew(def: Omit<PropDef, 'id' | 'x' | 'y' | 'z'>, s: MoveState, yaw: number, pitch: number): string | null {
    if (this.held) return null;
    const dir = lookDirection(yaw, pitch);
    const eyeY = s.y + (s.crouched ? EYE_HEIGHT_CROUCH : EYE_HEIGHT);
    const id = this.spawnDynamic({ ...def, x: s.x + dir.x * 0.6, y: eyeY + dir.y * 0.6 - 0.25, z: s.z + dir.z * 0.6 });
    if (!this.grab(id, s)) {
      this.remove(id);
      return null;
    }
    return id;
  }

  /** Lâche l'objet tenu (sans le lancer). */
  drop(s: MoveState): void {
    this.release(s, 0, null);
  }

  private release(s: MoveState, speed: number, dir: { x: number; y: number; z: number } | null): void {
    const held = this.held;
    this.held = null;
    if (!held) return;
    const lp = this.live.get(held.id);
    if (!lp) return;
    lp.body.setGravityScale(1, true);
    lp.body.setAngularDamping(ANGULAR_DAMPING[lp.def.kind] ?? 2.5);
    lp.collider.setCollisionGroups(PROP_GROUPS);
    const vx = s.vx + (dir ? dir.x * speed : 0);
    const vy = s.vy + (dir ? dir.y * speed + speed * 0.15 : 0);
    const vz = s.vz + (dir ? dir.z * speed : 0);
    lp.body.setLinvel({ x: vx, y: vy, z: vz }, true);
  }

  /** Vitesse de lancer selon la masse (objets légers lancés plus loin). */
  static throwSpeed(mass: number): number {
    return Math.max(2, Math.min(12, 14 / Math.sqrt(Math.max(0.5, mass))));
  }

  /** À appeler à chaque pas, avant le déplacement du joueur et le pas physique. */
  update(s: MoveState, cmd: InputCmd, pressed: number): void {
    const dir = lookDirection(cmd.yaw, cmd.pitch);
    if ((pressed & BTN_INTERACT) !== 0) {
      if (this.held) this.release(s, 0, null);
      else {
        const t = this.target(s, cmd.yaw, cmd.pitch);
        if (t) this.grab(t.id, s);
      }
    }
    const heldLp = this.held ? this.live.get(this.held.id) : undefined;
    if (this.held && !heldLp) this.held = null;
    if (this.held && heldLp) {
      if ((pressed & BTN_THROW) !== 0 && this.held.mode === 'carry') {
        if ((s.restrict & R_NO_THROW) !== 0) this.refusal = 'Impossible de lancer avec un bras cassé.';
        else {
          s.stamina = Math.max(0, s.stamina - 4);
          this.release(s, PropSystem.throwSpeed(heldLp.mass), dir);
        }
      } else if (s.mode === MODE_CLIMB || (s.mode === MODE_SWIM && heldLp.mass > ONE_HAND_CARRY_KG)) {
        this.release(s, 0, null);
      }
    }
    const lp = this.held ? this.live.get(this.held.id) : undefined;
    if (this.held && lp) {
      const t = lp.body.translation();
      if (this.held.mode === 'carry') {
        const twoHands = lp.handling === 'deux-mains';
        const eyeY = s.y + (s.crouched ? EYE_HEIGHT_CROUCH : EYE_HEIGHT);
        const dist = twoHands ? 0.95 : 0.75;
        const tx = s.x + dir.x * dist;
        const ty = eyeY + dir.y * dist - (twoHands ? 0.45 : 0.25);
        const tz = s.z + dir.z * dist;
        const ex = tx - t.x;
        const ey = ty - t.y;
        const ez = tz - t.z;
        const e = Math.sqrt(ex * ex + ey * ey + ez * ez);
        if (e > 1.8) this.release(s, 0, null);
        else {
          const k = Math.min(12, 9 / Math.max(e, 1e-3));
          lp.body.setLinvel({ x: ex * k, y: ey * k, z: ez * k }, true);
        }
      } else {
        const len = Math.sqrt(dir.x * dir.x + dir.z * dir.z) || 1;
        const tx = s.x + (dir.x / len) * 1.6;
        const tz = s.z + (dir.z / len) * 1.6;
        const ex = tx - t.x;
        const ez = tz - t.z;
        const e = Math.sqrt(ex * ex + ez * ez);
        if (e > 3) this.release(s, 0, null);
        else {
          const cap = MOVE.dragSpeed + 1.5;
          const k = Math.min(5, cap / Math.max(e, 1e-3));
          const v = lp.body.linvel();
          lp.body.setLinvel({ x: ex * k, y: v.y, z: ez * k }, true);
        }
      }
    }
    const still = this.held ? this.live.get(this.held.id) : undefined;
    s.carryMass = this.held?.mode === 'carry' && still ? still.mass : 0;
    s.dragging = this.held?.mode === 'drag' && !!still;
  }

  /** Remet à la surface un objet passé sous le sol (sécurité). */
  rescueFallen(): void {
    for (const lp of this.live.values()) {
      const t = lp.body.translation();
      const ground = this.phys.terrain.heightAt(t.x, t.z);
      if (t.y < ground - 3) {
        lp.body.setTranslation({ x: t.x, y: ground + 1, z: t.z }, true);
        lp.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
      }
    }
  }

  /** État de tous les objets simulés (pour l'affichage). */
  views(): PropView[] {
    const out: PropView[] = [];
    for (const [id, lp] of this.live) {
      const t = lp.body.translation();
      const r = lp.body.rotation();
      out.push({ id, kind: lp.def.kind, radius: lp.def.radius, length: lp.def.length, x: t.x, y: t.y, z: t.z, qx: r.x, qy: r.y, qz: r.z, qw: r.w, held: this.held?.id === id });
    }
    return out;
  }

  /** Position d'un objet (simulé ou mémorisé). */
  position(id: string): { x: number; y: number; z: number } | null {
    const lp = this.live.get(id);
    if (!lp) {
      const st = this.stored.get(id);
      return st ? { x: st.x, y: st.y, z: st.z } : null;
    }
    const t = lp.body.translation();
    return { x: t.x, y: t.y, z: t.z };
  }

  /** Liste des objets simulés (tests et diagnostic). */
  liveIds(): string[] {
    return [...this.live.keys()];
  }

  massOf(id: string): number {
    return this.live.get(id)?.mass ?? 0;
  }

  /** Parcourt tous les objets créés ou déplacés (simulés ou mémorisés). */
  forEachDynamic(fn: (def: PropDef, pos: { x: number; y: number; z: number }) => void): void {
    for (const lp of this.live.values()) if (lp.def.dynamic) fn(lp.def, lp.body.translation());
    for (const st of this.stored.values()) if (st.def.dynamic && !this.live.has(st.def.id)) fn(st.def, st);
  }

  // ——— Sauvegarde ———

  serialize(): PropSave {
    const props: StoredProp[] = [];
    const seen = new Set<string>();
    for (const [id, lp] of this.live) {
      if (!this.displaced(id, lp)) continue;
      props.push(this.snapshot(lp));
      seen.add(id);
    }
    for (const [id, st] of this.stored) if (!seen.has(id)) props.push(st);
    return { taken: [...this.taken], props, nextDyn: this.nextDyn };
  }

  /** Reprend un état sauvegardé : à appeler avant le chargement des premiers chunks. */
  restore(raw: unknown): void {
    if (typeof raw !== 'object' || raw === null) return;
    const r = raw as Record<string, unknown>;
    if (Array.isArray(r.taken)) for (const id of r.taken.slice(0, 200000)) if (typeof id === 'string' && id.length < 40) this.taken.add(id);
    if (typeof r.nextDyn === 'number' && Number.isInteger(r.nextDyn) && r.nextDyn > 0) this.nextDyn = r.nextDyn;
    if (!Array.isArray(r.props)) return;
    for (const p of r.props.slice(0, 50000)) {
      const st = readStored(p);
      if (!st) continue;
      this.stored.set(st.def.id, st);
      if (st.def.dynamic) {
        const n = Number(st.def.id.slice(1));
        if (Number.isInteger(n) && n >= this.nextDyn) this.nextDyn = n + 1;
      }
    }
  }
}

const KINDS = new Set<string>(Object.keys(PROP_LABELS));
const fin = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x);

function readStored(raw: unknown): StoredProp | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const r = raw as Record<string, unknown>;
  const d = r.def as Record<string, unknown> | undefined;
  if (!d || typeof d.id !== 'string' || d.id.length > 40 || typeof d.kind !== 'string' || !KINDS.has(d.kind)) return null;
  const nums = [r.x, r.y, r.z, r.qx, r.qy, r.qz, r.qw, d.x, d.y, d.z, d.rot, d.radius, d.length];
  if (!nums.every(fin)) return null;
  if (Math.abs(r.x as number) > 9000 || Math.abs(r.z as number) > 9000 || (d.radius as number) <= 0 || (d.radius as number) > 2 || (d.length as number) < 0 || (d.length as number) > 6) return null;
  const def: PropDef = {
    id: d.id,
    kind: d.kind as PropKind,
    x: d.x as number,
    y: d.y as number,
    z: d.z as number,
    rot: d.rot as number,
    radius: d.radius as number,
    length: d.length as number,
  };
  if (d.dynamic === true) def.dynamic = true;
  if (def.kind === 'sac' || def.kind === 'corps') def.container = readContainer(d.container);
  if (fin(d.emptiedAt)) def.emptiedAt = d.emptiedAt;
  return { def, x: r.x as number, y: r.y as number, z: r.z as number, qx: r.qx as number, qy: r.qy as number, qz: r.qz as number, qw: r.qw as number };
}
