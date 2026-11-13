// Affichage des créatures (phase 6) : animaux faits de formes simples, animés selon leur vitesse
// et leur état (broute, alerte, attaque, couché, pris au piège), carcasses couchées sur le flanc,
// vautours qui tournoient, traces de sang, et la créature du lac (un long corps qui ondule).
// Une seule matière (couleurs par sommet) et des instances par partie : peu d'appels de dessin.

import { Color3 } from '@babylonjs/core/Maths/math.color';
import { Matrix, Quaternion, Vector3 } from '@babylonjs/core/Maths/math.vector';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import { CreateBoxVertexData } from '@babylonjs/core/Meshes/Builders/boxBuilder';
import { CreateCylinderVertexData } from '@babylonjs/core/Meshes/Builders/cylinderBuilder';
import { CreateSphereVertexData } from '@babylonjs/core/Meshes/Builders/sphereBuilder';
import type { Mesh } from '@babylonjs/core/Meshes/mesh';
import type { VertexData } from '@babylonjs/core/Meshes/mesh.vertexData';
import type { Scene } from '@babylonjs/core/scene';
import { WATER_LEVEL } from '../../shared/constants';
import { SPECIES, type SpeciesId } from '../../shared/creatures';
import type { CreatureView as CreatureState } from '../../shared/fauna';
import type { PropView } from '../../shared/interaction';
import { type Part, meshFromParts } from './item-meshes';

type RGB = [number, number, number];

/** Point d'attache d'une partie (animation). */
type Joint = 'corps' | 'tete' | 'avg' | 'avd' | 'arg' | 'ard' | 'queue' | 'oreilles' | 'trompe' | 'ailes';

interface RigPart {
  key: string;
  joint: Joint;
  /** Pivot dans le repère de l'animal (avant = +z), à l'échelle 1. */
  px: number;
  py: number;
  pz: number;
  parts: Part[];
}

function box(w: number, h: number, d: number, x = 0, y = 0, z = 0): VertexData {
  const vd = CreateBoxVertexData({ width: w, height: h, depth: d });
  vd.transform(Matrix.Translation(x, y, z));
  return vd;
}

function ell(dx: number, dy: number, dz: number, x = 0, y = 0, z = 0, seg = 4): VertexData {
  const vd = CreateSphereVertexData({ diameterX: dx, diameterY: dy, diameterZ: dz, segments: seg });
  vd.transform(Matrix.Translation(x, y, z));
  return vd;
}

/** Cylindre qui descend du pivot (patte) : de y = 0 à y = −length. */
function leg(length: number, top: number, bottom: number): VertexData {
  const vd = CreateCylinderVertexData({ height: length, diameterTop: top, diameterBottom: bottom, tessellation: 5 });
  vd.transform(Matrix.Translation(0, -length / 2, 0));
  return vd;
}

/** Cylindre couché vers l'arrière (−z) depuis le pivot (queue). */
function tail(length: number, d0: number, d1: number, droop = 0.6): VertexData {
  const vd = CreateCylinderVertexData({ height: length, diameterTop: d1, diameterBottom: d0, tessellation: 4 });
  vd.transform(Matrix.Translation(0, length / 2, 0).multiply(Matrix.RotationX(-Math.PI / 2 - droop)));
  return vd;
}

/** Cylindre vers l'avant (+z) depuis le pivot, incliné vers le bas (trompe, museau). */
function snout(length: number, d0: number, d1: number, down = 0): VertexData {
  const vd = CreateCylinderVertexData({ height: length, diameterTop: d1, diameterBottom: d0, tessellation: 5 });
  vd.transform(Matrix.Translation(0, length / 2, 0).multiply(Matrix.RotationX(Math.PI / 2 + down)));
  return vd;
}

/** Quadrupède générique : corps, tête, quatre pattes, queue. */
function quadruped(o: {
  L: number;
  H: number;
  R: number;
  body: RGB;
  belly?: RGB;
  head: Part[];
  headY?: number;
  frontLeg?: number;
  hindLeg?: number;
  legD?: number;
  tail: Part[];
  extra?: RigPart[];
}): RigPart[] {
  const bh = o.H - o.R * 0.85;
  const front = o.frontLeg ?? 1;
  const hind = o.hindLeg ?? 1;
  const legLen = bh - o.R * 0.35;
  const ld = o.legD ?? o.R * 0.32;
  const fz = o.L * 0.36;
  const lx = o.R * 0.55;
  const body: Part[] = [[ell(o.R * 2.1, o.R * 2, o.L * 1.05, 0, 0, 0), ...o.body]];
  if (o.belly) body.push([ell(o.R * 1.6, o.R * 1.1, o.L * 0.8, 0, -o.R * 0.55, 0), ...o.belly]);
  const parts: RigPart[] = [
    { key: 'corps', joint: 'corps', px: 0, py: bh, pz: 0, parts: body },
    { key: 'tete', joint: 'tete', px: 0, py: bh + (o.headY ?? o.R * 0.45), pz: o.L * 0.48, parts: o.head },
    { key: 'pav', joint: 'avg', px: -lx, py: bh - o.R * 0.3, pz: fz, parts: [[leg(legLen * front, ld, ld * 0.7), ...o.body]] },
    { key: 'pav', joint: 'avd', px: lx, py: bh - o.R * 0.3, pz: fz, parts: [[leg(legLen * front, ld, ld * 0.7), ...o.body]] },
    { key: 'par', joint: 'arg', px: -lx, py: bh - o.R * 0.3, pz: -fz, parts: [[leg(legLen * hind, ld * 1.1, ld * 0.7), ...o.body]] },
    { key: 'par', joint: 'ard', px: lx, py: bh - o.R * 0.3, pz: -fz, parts: [[leg(legLen * hind, ld * 1.1, ld * 0.7), ...o.body]] },
    { key: 'queue', joint: 'queue', px: 0, py: bh + o.R * 0.3, pz: -o.L * 0.5, parts: o.tail },
  ];
  return [...parts, ...(o.extra ?? [])];
}

const TAN: RGB = [0.62, 0.42, 0.24];
const CREAM: RGB = [0.86, 0.8, 0.68];
const GREY: RGB = [0.42, 0.4, 0.38];
const DARK: RGB = [0.16, 0.14, 0.12];
const IVORY: RGB = [0.9, 0.87, 0.78];

/** Gabarit de chaque espèce. */
function rigOf(sp: SpeciesId): RigPart[] {
  switch (sp) {
    case 'impala':
      return quadruped({
        L: 1.3,
        H: 0.9,
        R: 0.24,
        body: TAN,
        belly: CREAM,
        legD: 0.06,
        head: [
          [box(0.14, 0.16, 0.34, 0, 0.12, 0.12), ...TAN],
          [box(0.03, 0.32, 0.03, -0.05, 0.36, 0.02), ...DARK],
          [box(0.03, 0.32, 0.03, 0.05, 0.36, 0.02), ...DARK],
          [box(0.12, 0.05, 0.04, 0, 0.18, -0.02), ...TAN],
        ],
        headY: 0.32,
        tail: [[tail(0.2, 0.06, 0.03, 0.2), ...CREAM]],
      });
    case 'phacochere':
      return quadruped({
        L: 1.2,
        H: 0.7,
        R: 0.28,
        body: GREY,
        legD: 0.08,
        head: [
          [box(0.3, 0.26, 0.42, 0, -0.05, 0.12), ...GREY],
          [box(0.03, 0.03, 0.18, -0.13, -0.05, 0.32), ...IVORY],
          [box(0.03, 0.03, 0.18, 0.13, -0.05, 0.32), ...IVORY],
          [box(0.04, 0.16, 0.5, 0, 0.18, -0.25), ...DARK],
        ],
        headY: 0.05,
        tail: [[tail(0.3, 0.03, 0.02, -0.9), ...DARK]],
      });
    case 'babouin':
      return quadruped({
        L: 0.8,
        H: 0.6,
        R: 0.2,
        body: [0.42, 0.38, 0.26],
        legD: 0.07,
        frontLeg: 1.15,
        hindLeg: 0.95,
        head: [
          [ell(0.22, 0.2, 0.22, 0, 0.04, 0.04), 0.42, 0.38, 0.26],
          [box(0.1, 0.09, 0.18, 0, 0, 0.17), 0.24, 0.2, 0.18],
        ],
        headY: 0.2,
        tail: [[tail(0.55, 0.05, 0.03, -0.5), 0.42, 0.38, 0.26]],
      });
    case 'elephant':
      return quadruped({
        L: 3.6,
        H: 2.9,
        R: 0.95,
        body: [0.5, 0.48, 0.46],
        legD: 0.5,
        head: [[ell(1.1, 1.15, 1.0, 0, 0.1, 0.25), 0.5, 0.48, 0.46]],
        headY: 0.55,
        tail: [[tail(0.9, 0.08, 0.04, 0.2), 0.45, 0.43, 0.41]],
        extra: [
          { key: 'oreilles', joint: 'oreilles', px: 0, py: 2.6, pz: 1.85, parts: [[box(1.9, 1.15, 0.06, 0, -0.1, -0.15), 0.46, 0.43, 0.42]] },
          {
            key: 'trompe',
            joint: 'trompe',
            px: 0,
            py: 2.35,
            pz: 2.25,
            parts: [
              [leg(1.6, 0.32, 0.14), 0.48, 0.46, 0.44],
              [snout(0.75, 0.1, 0.06, 0.6), ...IVORY],
            ],
          },
        ],
      });
    case 'hyene':
      return quadruped({
        L: 1.25,
        H: 0.82,
        R: 0.27,
        body: [0.6, 0.53, 0.38],
        legD: 0.08,
        frontLeg: 1.15,
        hindLeg: 0.85,
        head: [
          [box(0.24, 0.24, 0.36, 0, 0, 0.14), 0.52, 0.45, 0.32],
          [box(0.16, 0.13, 0.16, 0, -0.04, 0.36), 0.22, 0.2, 0.18],
          [ell(0.1, 0.12, 0.05, -0.1, 0.17, 0), 0.3, 0.26, 0.2],
          [ell(0.1, 0.12, 0.05, 0.1, 0.17, 0), 0.3, 0.26, 0.2],
        ],
        headY: 0.3,
        tail: [[tail(0.3, 0.06, 0.08, 0.5), ...DARK]],
      });
    case 'leopard':
      return quadruped({
        L: 1.4,
        H: 0.7,
        R: 0.22,
        body: [0.78, 0.6, 0.3],
        belly: [0.9, 0.84, 0.7],
        legD: 0.08,
        head: [
          [ell(0.24, 0.2, 0.26, 0, 0.02, 0.1), 0.78, 0.6, 0.3],
          [box(0.12, 0.08, 0.1, 0, -0.03, 0.24), 0.86, 0.78, 0.6],
        ],
        headY: 0.16,
        tail: [[tail(0.9, 0.07, 0.05, 0.9), 0.7, 0.54, 0.27]],
      });
    case 'crocodile':
      return quadruped({
        L: 2.4,
        H: 0.5,
        R: 0.3,
        body: [0.28, 0.32, 0.2],
        legD: 0.1,
        head: [
          [box(0.36, 0.18, 0.5, 0, 0, 0.2), 0.26, 0.3, 0.19],
          [box(0.26, 0.12, 0.5, 0, -0.02, 0.62), 0.24, 0.28, 0.18],
          [ell(0.07, 0.07, 0.07, -0.11, 0.1, 0.12), 0.75, 0.7, 0.3],
          [ell(0.07, 0.07, 0.07, 0.11, 0.1, 0.12), 0.75, 0.7, 0.3],
        ],
        headY: -0.02,
        frontLeg: 1.2,
        hindLeg: 1.2,
        tail: [[tail(1.7, 0.42, 0.08, 0), 0.27, 0.31, 0.19]],
      });
    case 'vautour':
      return [
        { key: 'corps', joint: 'corps', px: 0, py: 0.45, pz: 0, parts: [[ell(0.36, 0.34, 0.7), 0.32, 0.27, 0.22]] },
        {
          key: 'tete',
          joint: 'tete',
          px: 0,
          py: 0.62,
          pz: 0.3,
          parts: [
            [leg(0.28, 0.06, 0.05), 0.75, 0.62, 0.55],
            [ell(0.11, 0.1, 0.16, 0, -0.04, 0.05), 0.75, 0.62, 0.55],
          ],
        },
        { key: 'aile', joint: 'ailes', px: -0.14, py: 0.5, pz: 0, parts: [[box(1.0, 0.03, 0.5, -0.5, 0, 0), 0.24, 0.2, 0.17]] },
        { key: 'aile', joint: 'ailes', px: 0.14, py: 0.5, pz: 0, parts: [[box(1.0, 0.03, 0.5, 0.5, 0, 0), 0.24, 0.2, 0.17]] },
        { key: 'queue', joint: 'queue', px: 0, py: 0.45, pz: -0.3, parts: [[box(0.3, 0.03, 0.3, 0, 0, -0.12), 0.2, 0.17, 0.14]] },
      ];
    case 'ombre':
      return [];
  }
}

/** Créature du lac : segments du corps, tête, et deux reflets pâles à la place des yeux. */
const OMBRE_SEGMENTS = 14;

const tmpM = new Matrix();
const tmpA = new Matrix();
const tmpB = new Matrix();
const tmpQ = new Quaternion();
const tmpS = new Vector3();
const tmpP = new Vector3();

interface Anim {
  phase: number;
  /** Position abaissée (couché), tête (0 : normale, 1 : basse). */
  lie: number;
  head: number;
  wing: number;
}

interface Template {
  mesh: Mesh;
  buf: Float32Array;
  count: number;
}

export class CreatureView {
  private readonly material: StandardMaterial;
  private readonly glowMaterial: StandardMaterial;
  private readonly templates = new Map<string, Template>();
  private readonly rigs = new Map<SpeciesId, RigPart[]>();
  private readonly anims = new Map<string, Anim>();
  private readonly ombreBody: Template;
  private readonly ombreHead: Template;
  private readonly ombreEyes: Template;
  private readonly bloodMesh: Template;
  private lastTime = 0;
  /** Distance d'affichage (m). */
  range = 160;

  constructor(private readonly scene: Scene) {
    this.material = new StandardMaterial('créatures', scene);
    this.material.diffuseColor = new Color3(1, 1, 1);
    this.material.specularColor = new Color3(0, 0, 0);
    this.glowMaterial = new StandardMaterial('reflets', scene);
    this.glowMaterial.emissiveColor = new Color3(0.75, 0.8, 0.62);
    this.glowMaterial.disableLighting = true;
    for (const sp of Object.keys(SPECIES) as SpeciesId[]) {
      const rig = rigOf(sp);
      this.rigs.set(sp, rig);
      for (const part of rig) {
        const key = `${sp}:${part.key}`;
        if (!this.templates.has(key)) this.templates.set(key, this.makeTemplate(key, part.parts, this.material));
      }
    }
    const dark: RGB = [0.05, 0.07, 0.06];
    this.ombreBody = this.makeTemplate('ombre:corps', [[ell(1.3, 0.9, 1.2), ...dark]], this.material);
    this.ombreHead = this.makeTemplate(
      'ombre:tete',
      [
        [box(1.6, 0.7, 1.9, 0, 0, 0.3), ...dark],
        [box(1.5, 0.25, 1.6, 0, -0.45, 0.45), 0.08, 0.06, 0.06],
      ],
      this.material,
    );
    this.ombreEyes = this.makeTemplate('ombre:yeux', [[ell(0.16, 0.12, 0.08, -0.55, 0.15, 1.2)], [ell(0.16, 0.12, 0.08, 0.55, 0.15, 1.2)]].map(([vd]) => [vd!, 1, 1, 1] as Part), this.glowMaterial);
    this.bloodMesh = this.makeTemplate('sang', [[box(0.22, 0.01, 0.18), 0.35, 0.03, 0.03]], this.material);
  }

  private makeTemplate(name: string, parts: Part[], material: StandardMaterial): Template {
    const mesh = meshFromParts(name, parts, this.scene, material);
    mesh.alwaysSelectAsActiveMesh = true;
    mesh.isVisible = false;
    return { mesh, buf: new Float32Array(16 * 8), count: 0 };
  }

  private push(t: Template, m: Matrix): void {
    if ((t.count + 1) * 16 > t.buf.length) {
      const nb = new Float32Array(t.buf.length * 2);
      nb.set(t.buf);
      t.buf = nb;
    }
    m.copyToArray(t.buf, t.count * 16);
    t.count++;
  }

  private flush(t: Template): void {
    if (t.count === 0) {
      t.mesh.isVisible = false;
      return;
    }
    t.mesh.thinInstanceSetBuffer('matrix', t.buf.subarray(0, t.count * 16), 16, false);
    t.mesh.isVisible = true;
  }

  /**
   * Met à jour l'affichage : créatures vivantes, carcasses (objets « carcasse »), traces de sang.
   * camUnder : la caméra est sous l'eau.
   */
  update(creatures: CreatureState[], props: PropView[], blood: ReadonlyArray<{ x: number; z: number; t: number }>, heightAt: (x: number, z: number) => number, cam: { x: number; y: number; z: number }, now: number): void {
    const dt = Math.min(0.1, Math.max(0, now - this.lastTime));
    this.lastTime = now;
    for (const t of this.templates.values()) t.count = 0;
    this.ombreBody.count = 0;
    this.ombreHead.count = 0;
    this.ombreEyes.count = 0;
    this.bloodMesh.count = 0;
    const seen = new Set<string>();
    for (const c of creatures) {
      if (Math.hypot(c.x - cam.x, c.z - cam.z) > this.range) continue;
      seen.add(c.id);
      let a = this.anims.get(c.id);
      if (!a) {
        a = { phase: Math.random() * 6, lie: 0, head: 0, wing: 0 };
        this.anims.set(c.id, a);
      }
      if (c.sp === 'ombre') this.drawOmbre(c, a, dt, cam);
      else this.drawAnimal(c, a, dt, now, false);
    }
    for (const id of this.anims.keys()) if (!seen.has(id)) this.anims.delete(id);
    // Carcasses : couchées sur le flanc.
    for (const v of props) {
      if (v.kind !== 'carcasse' || !v.sp) continue;
      if (Math.hypot(v.x - cam.x, v.z - cam.z) > this.range) continue;
      const yaw = 2 * Math.atan2(v.qy, v.qw) + Math.PI / 2;
      const d = SPECIES[v.sp];
      const ground = heightAt(v.x, v.z);
      const fake: CreatureState = { id: v.id, sp: v.sp, x: v.x, y: Math.max(ground, v.y - d.radius * (v.scale ?? 1) * 0.6), z: v.z, yaw, speed: 0, mode: 'repos', hp: 0, scale: v.scale ?? 1, limp: 0, windup: 0, caught: false, grabbing: false, alert: 0 };
      this.drawAnimal(fake, { phase: 0, lie: 1, head: 0, wing: 0 }, 0, now, true);
    }
    // Traces de sang (les plus récentes, proches).
    let n = 0;
    for (let k = blood.length - 1; k >= 0 && n < 120; k--) {
      const b = blood[k]!;
      if (Math.hypot(b.x - cam.x, b.z - cam.z) > 50) continue;
      const y = heightAt(b.x, b.z);
      if (y < WATER_LEVEL) continue;
      tmpS.set(1, 1, 1);
      Quaternion.RotationYawPitchRollToRef((k * 1.7) % 6.28, 0, 0, tmpQ);
      tmpP.set(b.x, y + 0.03, b.z);
      Matrix.ComposeToRef(tmpS, tmpQ, tmpP, tmpM);
      this.push(this.bloodMesh, tmpM);
      n++;
    }
    for (const t of this.templates.values()) this.flush(t);
    this.flush(this.ombreBody);
    this.flush(this.ombreHead);
    this.flush(this.ombreEyes);
    this.flush(this.bloodMesh);
  }

  private drawAnimal(c: CreatureState, a: Anim, dt: number, now: number, dead: boolean): void {
    const rig = this.rigs.get(c.sp)!;
    const d = SPECIES[c.sp];
    const bird = c.sp === 'vautour';
    const s = c.scale;
    // Cadence : une foulée par ~1,4 longueur de corps.
    const stride = Math.max(0.4, d.halfLength * 2.8 * s);
    if (!dead) a.phase += (c.speed / stride) * Math.PI * 2 * dt;
    const lying = dead || c.mode === 'repos';
    a.lie += ((lying ? 1 : 0) - a.lie) * Math.min(1, dt * 3);
    const headDown = c.mode === 'paitre' || c.mode === 'manger' || c.mode === 'menace' && c.sp === 'hyene' ? 1 : c.mode === 'alerte' ? -0.6 : 0;
    a.head += (headDown - a.head) * Math.min(1, dt * 4);
    const run = Math.min(1, c.speed / Math.max(1, d.run * 0.6));
    const amp = dead ? 0 : Math.min(0.9, 0.25 + run * 0.6) * Math.min(1, c.speed / 0.3);
    const struggle = c.caught ? Math.sin(now * 25) * 0.25 : 0;
    const lunge = c.windup > 0 ? 0.25 : 0;
    // Corps : bascule en charge, roulis quand il est couché ou mort.
    const roll = dead ? Math.PI / 2 : a.lie * 0.1 + struggle;
    const pitch = -lunge + (c.mode === 'charge' ? -0.08 : 0) + (bird ? 0 : Math.sin(a.phase * 2) * 0.03 * run);
    const lift = dead ? d.radius * s * 0.9 : -a.lie * (d.height * 0.45) * s;
    const birdUp = bird && c.mode !== 'manger' && c.speed > 2;
    if (bird) a.wing += dt * (birdUp ? (c.speed > 8 ? 2 : 6) : 0);
    for (const part of rig) {
      const t = this.templates.get(`${c.sp}:${part.key}`)!;
      // Rotation de la partie autour de son pivot.
      let rx = 0;
      let ry = 0;
      let rz = 0;
      switch (part.joint) {
        case 'avg':
        case 'ard':
          rx = Math.sin(a.phase) * amp - (c.limp > 0.3 && part.joint === 'avg' ? 0.3 : 0);
          if (a.lie > 0.5 && !dead) rx = 1.4;
          if (dead) rz = part.joint === 'avg' ? 0.3 : -0.3;
          break;
        case 'avd':
        case 'arg':
          rx = -Math.sin(a.phase) * amp;
          if (a.lie > 0.5 && !dead) rx = part.joint === 'avd' ? 1.4 : -1.4;
          if (dead) rz = 0.3;
          break;
        case 'tete':
          rx = a.head * 0.9 - lunge * 1.5 + struggle * 0.5;
          if (c.mode === 'manger') rx += Math.sin(now * 6) * 0.15;
          if (dead) rx = 0.4;
          break;
        case 'queue':
          ry = Math.sin(now * 3 + c.x) * 0.25 * (dead ? 0 : 1);
          if (c.sp === 'crocodile') ry = Math.sin(a.phase * 0.5 + now) * 0.35 * Math.min(1, c.speed + 0.2);
          break;
        case 'oreilles':
          // Oreilles écartées en alerte ou en menace ; battement lent sinon.
          rx = 0;
          ry = 0;
          rz = 0;
          break;
        case 'trompe':
          rx = c.mode === 'menace' || c.mode === 'charge' ? -0.9 : Math.sin(now * 1.3 + c.z) * 0.2;
          break;
        case 'ailes': {
          const flap = birdUp ? Math.sin(a.wing) * 0.6 : c.mode === 'manger' ? 1.2 : 0.05;
          rz = part.px < 0 ? flap : -flap;
          break;
        }
        case 'corps':
          break;
      }
      // Partie → pivot → corps (posture) → échelle → cap → position.
      Quaternion.RotationYawPitchRollToRef(ry, rx, rz, tmpQ);
      tmpS.set(1, 1, 1);
      tmpP.set(part.px, part.py, part.pz);
      Matrix.ComposeToRef(tmpS, tmpQ, tmpP, tmpA);
      Quaternion.RotationYawPitchRollToRef(0, pitch, roll, tmpQ);
      tmpS.set(s, s, s);
      tmpP.set(0, 0, 0);
      Matrix.ComposeToRef(tmpS, tmpQ, tmpP, tmpB);
      tmpA.multiplyToRef(tmpB, tmpM);
      Quaternion.RotationYawPitchRollToRef(c.yaw, 0, 0, tmpQ);
      tmpS.set(1, 1, 1);
      tmpP.set(c.x, c.y + lift, c.z);
      Matrix.ComposeToRef(tmpS, tmpQ, tmpP, tmpB);
      tmpM.multiplyToRef(tmpB, tmpA);
      this.push(t, tmpA);
    }
  }

  /** Long corps qui ondule derrière la tête ; plus pâle et visible seulement de près sous l'eau. */
  private drawOmbre(c: CreatureState, a: Anim, dt: number, cam: { x: number; y: number; z: number }): void {
    const s = c.scale;
    const camUnder = cam.y < WATER_LEVEL;
    // Vue d'au-dessus de l'eau : seulement si elle remonte près de la surface (une ombre).
    if (!camUnder && c.y < WATER_LEVEL - 7) return;
    a.phase += dt * (1.2 + c.speed * 0.6);
    const fx = Math.sin(c.yaw);
    const fz = Math.cos(c.yaw);
    const sideX = fz;
    const sideZ = -fx;
    const seg = 0.85 * s;
    const head = { x: c.x + fx * 1.2 * s, z: c.z + fz * 1.2 * s };
    for (let i = 0; i < OMBRE_SEGMENTS; i++) {
      const back = i * seg;
      const wave = Math.sin(a.phase - i * 0.55) * (0.25 + i * 0.07) * s;
      const x = head.x - fx * back + sideX * wave;
      const z = head.z - fz * back + sideZ * wave;
      const taper = (1 - i / (OMBRE_SEGMENTS + 2)) * s;
      const y = c.y + Math.sin(a.phase * 0.7 - i * 0.4) * 0.15 * s;
      const dirYaw = c.yaw - Math.cos(a.phase - i * 0.55) * 0.35;
      tmpS.set(taper, taper, taper * 1.2);
      Quaternion.RotationYawPitchRollToRef(dirYaw, 0, 0, tmpQ);
      tmpP.set(x, y, z);
      Matrix.ComposeToRef(tmpS, tmpQ, tmpP, tmpM);
      this.push(this.ombreBody, tmpM);
    }
    const jaw = c.grabbing ? 0.25 : c.windup > 0 ? 0.4 : 0;
    tmpS.set(s, s, s);
    Quaternion.RotationYawPitchRollToRef(c.yaw, -jaw, 0, tmpQ);
    tmpP.set(head.x + fx * 0.3 * s, c.y, head.z + fz * 0.3 * s);
    Matrix.ComposeToRef(tmpS, tmpQ, tmpP, tmpM);
    this.push(this.ombreHead, tmpM);
    if (camUnder) this.push(this.ombreEyes, tmpM);
  }

  dispose(): void {
    for (const t of this.templates.values()) t.mesh.dispose();
    this.ombreBody.mesh.dispose();
    this.ombreHead.mesh.dispose();
    this.ombreEyes.mesh.dispose();
    this.bloodMesh.mesh.dispose();
    this.material.dispose();
    this.glowMaterial.dispose();
  }
}
