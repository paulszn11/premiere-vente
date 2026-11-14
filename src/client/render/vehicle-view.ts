// Affichage des véhicules (phase 7) : châssis et coques faits de formes simples, roues qui
// tournent, braquent et suivent leur suspension, roue à aubes qui brasse l'eau, gouvernail,
// fumée de la machine à vapeur, cales sous un châssis qui attend ses roues. Une matière
// (couleurs par sommet) ; peu de véhicules à la fois, chacun quelques maillages.

import { Color3 } from '@babylonjs/core/Maths/math.color';
import { Matrix, Quaternion, Vector3 } from '@babylonjs/core/Maths/math.vector';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import { CreateSphereVertexData } from '@babylonjs/core/Meshes/Builders/sphereBuilder';
import { Mesh } from '@babylonjs/core/Meshes/mesh';
import { TransformNode } from '@babylonjs/core/Meshes/transformNode';
import type { Scene } from '@babylonjs/core/scene';
import type { LocalSimulation } from '../../shared/simulation';
import { FRAMES, type FrameKind, PARTS, type PartKind, type VehicleState, onChocks, railBoxes } from '../../shared/vehicles';
import { type Part, box, itemParts, meshFromParts, rod, wheelParts } from './item-meshes';

const WOOD: [number, number, number] = [0.45, 0.33, 0.22];
const DARK: [number, number, number] = [0.3, 0.21, 0.13];

/** Châssis ou coque, dans le repère du véhicule (avant = +z, origine au sol). */
export function frameParts(frame: FrameKind): Part[] {
  const f = FRAMES[frame];
  // Ridelles : les mêmes volumes que pour la physique.
  const rails: Part[] = railBoxes(frame).map((b) => [box(b.hx * 2, b.hy * 2, b.hz * 2, b.x, b.y, b.z), ...DARK]);
  switch (frame) {
    case 'chariot_bras':
      return [
        [box(f.half.x * 2, f.half.y * 2, f.half.z * 2, 0, f.cy), ...WOOD],
        ...rails,
        [box(0.05, 0.05, 0.9, -0.3, f.cy + 0.16, -1.15), ...WOOD],
        [box(0.05, 0.05, 0.9, 0.3, f.cy + 0.16, -1.15), ...WOOD],
        [box(0.66, 0.04, 0.04, 0, f.cy + 0.16, -1.55), ...WOOD],
      ];
    case 'chariot':
      return [
        [box(f.half.x * 2, f.half.y * 2, f.half.z * 2, 0, f.cy), ...WOOD],
        ...rails,
        [box(1.0, 0.08, 0.4, 0, (f.seat?.y ?? 1.3) + 0.12, -1.25), ...WOOD],
        [box(0.08, 0.3, 0.08, -0.42, (f.seat?.y ?? 1.3) - 0.05, -1.25), ...DARK],
        [box(0.08, 0.3, 0.08, 0.42, (f.seat?.y ?? 1.3) - 0.05, -1.25), ...DARK],
        [box(0.12, 0.12, 2.4, 0, f.cy - 0.16), ...DARK],
      ];
    case 'radeau': {
      const parts: Part[] = [];
      for (const x of [-1.0, -0.6, -0.2, 0.2, 0.6, 1.0]) parts.push([rod(3.0, 0.34, 8, x, 0, 0, Math.PI / 2), ...WOOD]);
      for (const z of [-1.1, 0, 1.1]) parts.push([rod(2.5, 0.08, 6, 0, 0.18, z), ...DARK]);
      return parts;
    }
    case 'pirogue':
      return [
        [box(0.56, 0.32, 3.6, 0, -0.04), ...WOOD],
        [ellipsoid(0.56, 0.32, 1.4, 0, -0.04, 1.75), ...WOOD],
        [ellipsoid(0.56, 0.32, 1.4, 0, -0.04, -1.75), ...WOOD],
        [box(0.42, 0.04, 3.4, 0, 0.1), ...DARK],
        [box(0.4, 0.04, 0.22, 0, 0.0, -0.7), ...WOOD],
      ];
  }
}

function ellipsoid(dx: number, dy: number, dz: number, x: number, y: number, z: number) {
  const vd = CreateSphereVertexData({ diameterX: dx, diameterY: dy, diameterZ: dz, segments: 6 });
  vd.transform(Matrix.Translation(x, y, z));
  return vd;
}

/** Pièce installée ; les roues et la roue à aubes tournent autour de l'axe x. */
function partParts(kind: PartKind): Part[] {
  const turnX = (parts: Part[]): Part[] => parts.map(([vd, r, g, b]) => [vd.transform(Matrix.RotationZ(Math.PI / 2)), r, g, b]);
  switch (kind) {
    case 'petite_roue':
      return turnX(wheelParts(0.22, 0.08, false));
    case 'roue':
      return turnX(wheelParts(0.5, 0.12, true));
    case 'roue_aubes':
      return turnX(itemParts('roue_aubes'));
    case 'machine_vapeur':
      // La chaudière dans l'axe du véhicule.
      return itemParts('machine_vapeur').map(([vd, r, g, b]) => [vd.transform(Matrix.RotationY(Math.PI / 2)), r, g, b]);
    default:
      return itemParts(kind);
  }
}

interface Rig {
  root: TransformNode;
  meshes: Mesh[];
  wheels: Map<string, { steer: TransformNode; spin: Mesh; baseY: number }>;
  aubes: Mesh | null;
  rudder: Mesh | null;
  chimney: Vector3 | null;
  sig: string;
  aubesSpin: number;
}

const tmpQ = new Quaternion();

export class VehicleView {
  private readonly rigs = new Map<string, Rig>();
  private readonly smoke: Mesh;
  private readonly puffs: Array<{ x: number; y: number; z: number; age: number }> = [];
  private lastPuff = 0;

  constructor(
    private readonly scene: Scene,
    private readonly material: StandardMaterial,
  ) {
    const m = new StandardMaterial('fumée de chaudière', scene);
    m.diffuseColor = new Color3(0.55, 0.55, 0.55);
    m.emissiveColor = new Color3(0.25, 0.25, 0.25);
    m.specularColor = new Color3(0, 0, 0);
    m.alpha = 0.45;
    this.smoke = new Mesh('fumée de chaudière', scene);
    CreateSphereVertexData({ diameter: 1, segments: 4 }).applyToMesh(this.smoke);
    this.smoke.material = m;
    this.smoke.isPickable = false;
    this.smoke.isVisible = false;
    this.smoke.alwaysSelectAsActiveMesh = true;
  }

  private signature(v: VehicleState): string {
    return `${v.frame}|${onChocks(v) ? 'c' : ''}|${(v.cargo.bag?.length ?? 0) > 0 ? 'k' : ''}|${v.parts.map((p) => `${p.slot}${p.broken ? 'x' : ''}`).join(',')}`;
  }

  private build(v: VehicleState): Rig {
    const f = FRAMES[v.frame];
    const root = new TransformNode(`véhicule ${v.id}`, this.scene);
    root.rotationQuaternion = new Quaternion();
    const meshes: Mesh[] = [];
    const add = (name: string, parts: Part[], parent: TransformNode, x = 0, y = 0, z = 0): Mesh => {
      const m = meshFromParts(name, parts, this.scene, this.material);
      m.parent = parent;
      m.position.set(x, y, z);
      meshes.push(m);
      return m;
    };
    add(`${v.id} châssis`, frameParts(v.frame), root);
    // Un châssis qui attend ses roues repose sur des cales.
    if (onChocks(v)) {
      const h = f.cy - f.half.y;
      const parts: Part[] = [];
      for (const sx of [-1, 1]) for (const sz of [-1, 1]) parts.push([box(0.22, h, 0.3, sx * (f.half.x - 0.12), h / 2, sz * (f.half.z - 0.25)), ...DARK]);
      add(`${v.id} cales`, parts, root);
    }
    // Coffre chargé : une caisse sur le plateau (ou un ballot au fond du bateau).
    if ((v.cargo.bag?.length ?? 0) > 0) {
      const c = f.cargo;
      add(`${v.id} caisse`, [
        [box(0.5, 0.3, 0.4, c.x, c.y - 0.02, c.z), ...WOOD],
        [box(0.52, 0.04, 0.42, c.x, c.y + 0.14, c.z), ...DARK],
        [box(0.04, 0.31, 0.41, c.x - 0.18, c.y - 0.02, c.z), ...DARK],
        [box(0.04, 0.31, 0.41, c.x + 0.18, c.y - 0.02, c.z), ...DARK],
      ], root);
    }
    const wheels = new Map<string, { steer: TransformNode; spin: Mesh; baseY: number }>();
    let aubes: Mesh | null = null;
    let rudder: Mesh | null = null;
    let chimney: Vector3 | null = null;
    for (const p of v.parts) {
      const sd = f.slots.find((s) => s.id === p.slot);
      if (!sd) continue;
      if (p.kind === 'roue' || p.kind === 'petite_roue') {
        const steer = new TransformNode(`${v.id} ${p.slot}`, this.scene);
        steer.parent = root;
        steer.position.set(sd.x, sd.y, sd.z);
        const spin = add(`${v.id} ${p.slot} roue`, partParts(p.kind), steer);
        // Une roue cassée penche.
        if (p.broken) spin.rotation.z = 0.25;
        wheels.set(p.slot, { steer, spin, baseY: sd.y });
        continue;
      }
      const m = add(`${v.id} ${p.slot}`, partParts(p.kind), root, sd.x, sd.y, sd.z);
      if (p.kind === 'roue_aubes') aubes = m;
      if (p.kind === 'gouvernail') {
        rudder = m;
        m.rotation.y = Math.PI / 2;
      }
      if (p.kind === 'machine_vapeur') chimney = new Vector3(sd.x, sd.y + 0.85, sd.z + 0.55);
      if (p.broken) m.rotation.x = 0.12;
    }
    return { root, meshes, wheels, aubes, rudder, chimney, sig: this.signature(v), aubesSpin: 0 };
  }

  private dispose(r: Rig): void {
    for (const m of r.meshes) m.dispose();
    r.root.dispose();
  }

  /** Place les véhicules proches (interpolés entre deux pas de simulation). */
  update(sim: LocalSimulation, alpha: number, camX: number, camZ: number, dt: number, now: number): void {
    const seen = new Set<string>();
    for (const v of sim.vehicles) {
      if (Math.hypot(v.x - camX, v.z - camZ) > 400) continue;
      seen.add(v.id);
      let r = this.rigs.get(v.id);
      const sig = this.signature(v);
      if (r && r.sig !== sig) {
        this.dispose(r);
        r = undefined;
      }
      if (!r) {
        r = this.build(v);
        this.rigs.set(v.id, r);
      }
      const p = sim.vehiclePrev.get(v.id) ?? v;
      r.root.position.set(p.x + (v.x - p.x) * alpha, p.y + (v.y - p.y) * alpha, p.z + (v.z - p.z) * alpha);
      Quaternion.SlerpToRef(new Quaternion(p.qx, p.qy, p.qz, p.qw), new Quaternion(v.qx, v.qy, v.qz, v.qw), alpha, tmpQ);
      r.root.rotationQuaternion!.copyFrom(tmpQ);
      // Roues : rotation, braquage, suspension.
      const f = FRAMES[v.frame];
      for (const w of sim.vphys.wheelStates(v.id)) {
        const rw = r.wheels.get(w.slot);
        if (!rw) continue;
        rw.steer.rotation.y = w.steer;
        rw.spin.rotation.x = w.spin;
        if (f.wheel) rw.steer.position.y = rw.baseY + f.wheel.rest * 0.55 - w.susp;
      }
      // Roue à aubes et gouvernail.
      const driven = sim.driving?.v === v.id;
      if (r.aubes) {
        const turning = driven && v.engine.pressure > 0.1 && (sim.lastDrive?.speed ?? 0) > 0.05;
        r.aubesSpin += (turning ? 2.5 : 0) * dt;
        r.aubes.rotation.x = r.aubesSpin;
      }
      if (r.rudder && driven) r.rudder.rotation.y = Math.PI / 2 - (sim.vphys.motion(v.id)?.spin ?? 0) * 0.4;
      // Fumée : la machine allumée crache des bouffées, plus serrées quand elle force.
      if (r.chimney && v.engine.lit) {
        const every = driven ? 140 : 380;
        if (now - this.lastPuff > every && this.puffs.length < 40) {
          this.lastPuff = now;
          const w = Vector3.TransformCoordinates(r.chimney, r.root.computeWorldMatrix(true));
          this.puffs.push({ x: w.x, y: w.y, z: w.z, age: 0 });
        }
      }
    }
    for (const [id, r] of this.rigs) {
      if (seen.has(id)) continue;
      this.dispose(r);
      this.rigs.delete(id);
    }
    // Bouffées de fumée qui montent et s'étalent.
    for (const p of this.puffs) {
      p.age += dt;
      p.y += dt * 0.9;
      p.x += dt * 0.25;
    }
    while (this.puffs.length && this.puffs[0]!.age > 3) this.puffs.shift();
    if (this.puffs.length) {
      const buf = new Float32Array(this.puffs.length * 16);
      const m = new Matrix();
      this.puffs.forEach((p, i) => {
        const k = 0.25 + p.age * 0.35;
        Matrix.ComposeToRef(new Vector3(k, k, k), Quaternion.Identity(), new Vector3(p.x, p.y, p.z), m);
        m.copyToArray(buf, i * 16);
      });
      this.smoke.thinInstanceSetBuffer('matrix', buf, 16, false);
      this.smoke.isVisible = true;
    } else this.smoke.isVisible = false;
  }

  disposeAll(): void {
    for (const r of this.rigs.values()) this.dispose(r);
    this.rigs.clear();
    this.smoke.dispose();
  }
}

/** Maillage d'un châssis entier (chantier, fantôme du plan). */
export function buildFrameMesh(name: string, frame: FrameKind, scene: Scene, material: StandardMaterial): Mesh {
  return meshFromParts(name, frameParts(frame), scene, material);
}

export const PART_LABEL = (k: PartKind): string => PARTS[k].label;
