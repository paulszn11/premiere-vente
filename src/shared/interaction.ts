// Objets déplaçables autour du joueur : corps physiques Rapier, ramasser, porter (une ou
// deux mains), lancer, traîner, pousser en marchant. Les objets déplacés sont mémorisés
// pour réapparaître au bon endroit quand on revient (sauvegardés par l'hôte en phase 8).

import { EYE_HEIGHT, EYE_HEIGHT_CROUCH, MOVE } from './constants';
import { BTN_INTERACT, BTN_THROW, type InputCmd, MODE_CLIMB, MODE_SWIM, type MoveState, ONE_HAND_CARRY_KG } from './movement';
import { DRAGGED_GROUPS, GROUP_OBSTACLE, GROUP_TERRAIN, HELD_GROUPS, PROP_GROUPS, type PhysicsWorld, QUERY_PROPS, RAPIER, interactionGroups } from './physics';
import { DENSITY, type Handling, PROP_LABELS, type PropDef, type PropKind, handlingFor, propsInChunk } from './props';
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

export const REACH = 2.4;
const ANGULAR_DAMPING: Record<PropKind, number> = { pierre: 1.5, buche: 3, tronc: 2.5 };
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

export class PropSystem {
  private readonly live = new Map<string, LiveProp>();
  private readonly byCollider = new Map<number, string>();
  private readonly stored = new Map<string, StoredProp>();
  held: { id: string; mode: 'carry' | 'drag' } | null = null;

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
    // Amortissement marqué : une pierre réelle, irrégulière, ne roule pas indéfiniment.
    const bodyDesc = RAPIER.RigidBodyDesc.dynamic().setTranslation(x, y, z).setRotation(q).setLinearDamping(0.3).setAngularDamping(ANGULAR_DAMPING[def.kind]).setCanSleep(true);
    if (sleeping) bodyDesc.setSleeping(true);
    const body = world.createRigidBody(bodyDesc);
    // Pierre : pavé aux coins arrondis (une sphère parfaite roulerait sur la moindre pente,
    // le moteur ne simulant pas la résistance au roulement).
    const r = def.radius;
    const colDesc = def.kind === 'pierre' ? RAPIER.ColliderDesc.roundCuboid(r * 0.7, r * 0.55, r * 0.65, r * 0.25) : RAPIER.ColliderDesc.cylinder(def.length / 2, r).setRotation(LOG_ROT);
    colDesc.setDensity(DENSITY[def.kind]).setFriction(0.8).setRestitution(0.1).setCollisionGroups(PROP_GROUPS);
    const collider = world.createCollider(colDesc, body);
    const mass = body.mass();
    this.live.set(def.id, { def, body, collider, mass, handling: handlingFor(mass) });
    this.byCollider.set(collider.handle, def.id);
  }

  /** Ajoute un objet précis (outils de test, objets fabriqués plus tard). */
  add(def: PropDef): void {
    if (this.live.has(def.id)) return;
    this.spawn(def, def.x, def.y, def.z, yawQuat(def.rot), false);
  }

  private despawn(id: string): void {
    const lp = this.live.get(id);
    if (!lp) return;
    this.byCollider.delete(lp.collider.handle);
    this.phys.world.removeRigidBody(lp.body);
    this.live.delete(id);
  }

  private loadChunk(cx: number, cz: number): void {
    for (const def of propsInChunk(this.phys.terrain, cx, cz)) {
      if (this.live.has(def.id) || this.stored.has(def.id)) continue;
      this.spawn(def, def.x, def.y, def.z, yawQuat(def.rot), true);
    }
    for (const [id, st] of this.stored) {
      if (this.live.has(id) || chunkCoord(st.x) !== cx || chunkCoord(st.z) !== cz) continue;
      this.spawn(st.def, st.x, st.y, st.z, { x: st.qx, y: st.qy, z: st.qz, w: st.qw }, true);
    }
  }

  private unloadChunk(cx: number, cz: number): void {
    for (const [id, lp] of this.live) {
      if (this.held?.id === id) continue;
      const t = lp.body.translation();
      if (chunkCoord(t.x) !== cx || chunkCoord(t.z) !== cz) continue;
      const r = lp.body.rotation();
      const d = lp.def;
      const q0 = yawQuat(d.rot);
      const displaced =
        this.stored.has(id) || Math.abs(t.x - d.x) + Math.abs(t.y - d.y) + Math.abs(t.z - d.z) > 0.15 || Math.abs(r.x - q0.x) + Math.abs(r.y - q0.y) + Math.abs(r.z - q0.z) + Math.abs(r.w - q0.w) > 0.05;
      if (displaced) this.stored.set(id, { def: d, x: t.x, y: t.y, z: t.z, qx: r.x, qy: r.y, qz: r.z, qw: r.w });
      this.despawn(id);
    }
  }

  /** Objet visé (à portée de main) depuis les yeux du joueur. */
  target(s: MoveState, yaw: number, pitch: number): PropTarget | null {
    const eyeY = s.y + (s.crouched ? EYE_HEIGHT_CROUCH : EYE_HEIGHT);
    const dir = lookDirection(yaw, pitch);
    const origin = { x: s.x, y: eyeY, z: s.z };
    // Une petite sphère plutôt qu'un rayon fin : viser une petite pierre reste facile.
    const hit = this.phys.world.castShape(origin, IDENTITY, dir, AIM_BALL, 0, REACH, true, undefined, QUERY_PROPS);
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

  private grab(id: string, s: MoveState): void {
    const lp = this.live.get(id);
    if (!lp) return;
    lp.body.wakeUp();
    if (lp.handling === 'trainer') {
      if (s.stamina < 5) return;
      lp.collider.setCollisionGroups(DRAGGED_GROUPS);
      this.held = { id, mode: 'drag' };
    } else {
      lp.body.setGravityScale(0, true);
      lp.body.setAngularDamping(6);
      lp.collider.setCollisionGroups(HELD_GROUPS);
      this.held = { id, mode: 'carry' };
    }
  }

  private release(s: MoveState, speed: number, dir: { x: number; y: number; z: number } | null): void {
    const held = this.held;
    this.held = null;
    if (!held) return;
    const lp = this.live.get(held.id);
    if (!lp) return;
    lp.body.setGravityScale(1, true);
    lp.body.setAngularDamping(ANGULAR_DAMPING[lp.def.kind]);
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
        s.stamina = Math.max(0, s.stamina - 4);
        this.release(s, PropSystem.throwSpeed(heldLp.mass), dir);
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

  /** Position d'un objet simulé (tests et diagnostic). */
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
}
