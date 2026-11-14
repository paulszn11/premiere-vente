// Faune (phase 6) : écosystème à trois niveaux de simulation (cahier, 14.5).
//   1. Populations par zone de 1 km : naissances, prédation, migrations, pression de chasse.
//   2. Individus suivis (léopards, clans de hyènes, troupes de babouins, créature du lac) :
//      position, santé, mémoire des habitudes, sauvegardés, même loin du joueur.
//   3. Créatures proches (moins de ~260 m) : sens, décisions, déplacements, attaques.
// Tout est déterministe (générateur rangé dans l'état) : en phase 8, le serveur fera foi.
// La simulation fournit l'environnement (terrain, rayons, feux, carcasses) et applique les
// conséquences (blessures du joueur, carcasses, dégâts aux constructions) via les événements.

import { WATER_LEVEL, WORLD_HALF } from './constants';
import { POPULATION_SPECIES, SPECIES, type SpeciesDef, type SpeciesId, type BodyPart, bodySegment, isSpeciesId, partAt, pointSegmentDistance, rayCapsule, segmentSegmentDistance } from './creatures';
import { LANDMARKS } from './geography';
import { hash32 } from './rng';
import type { Terrain } from './terrain';

// ——— Interfaces avec la simulation ———

export interface FaunaPlayer {
  x: number;
  y: number;
  z: number;
  vx: number;
  vz: number;
  crouched: boolean;
  swimming: boolean;
  /** Les yeux sous la surface. */
  underwater: boolean;
  climbing: boolean;
  /** Profondeur d'eau sous le joueur (m). */
  waterDepth: number;
  yaw: number;
  state: 'eveille' | 'inconscient' | 'critique' | 'mort';
  health: number;
  /** Santé perdue par seconde en saignant. */
  bleeding: number;
  injuredLegs: boolean;
  /** Arme en main (0 : rien ; 1 : arme sérieuse). */
  weapon: number;
  torch: boolean;
  meat: boolean;
  /** Rayon du bruit des déplacements (m). */
  noise: number;
}

export interface FaunaEnv {
  terrain: Terrain;
  /** La zone physique est chargée autour de ce point (rayons possibles). */
  physicsAt(x: number, z: number): boolean;
  /** Premier obstacle (sol, rochers, troncs, murs) le long d'une direction unitaire : distance, ou null. */
  ray(x: number, y: number, z: number, dx: number, dy: number, dz: number, len: number): number | null;
  /** Obstacles au déplacement (les véhicules en plus) ; par défaut, le même rayon que la vue. */
  moveRay?(x: number, y: number, z: number, dx: number, dy: number, dz: number, len: number): number | null;
  /** Hauteur du sol (rochers compris dans la zone physique). */
  ground(x: number, z: number): number;
  /** Feux allumés (foyers, forges, torches tenues, pièces en feu). */
  fires: Array<{ x: number; z: number; r: number }>;
  carcasses: Array<{ id: string; x: number; y: number; z: number; meat: number }>;
  /** Nourriture laissée au sol ou dans un sac posé (babouins). */
  food: Array<{ id: string; x: number; z: number }>;
  /** Pièce de construction devant ce point, dans ce rayon (éléphants, hyènes). */
  pieceAt(x: number, y: number, z: number, r: number): { s: string; p: number; wood: boolean } | null;
  traps: Array<{ id: string; x: number; z: number; kind: 'collet' | 'assommoir' | 'fosse'; armed: boolean }>;
}

export type SoundKind =
  | 'hyene_cri'
  | 'hyene_rire'
  | 'leopard_rale'
  | 'elephant_barrit'
  | 'elephant_gronde'
  | 'babouin_aboie'
  | 'impala_alarme'
  | 'phaco_grogne'
  | 'croco_souffle'
  | 'ombre_gronde'
  | 'eclaboussure'
  | 'morsure'
  | 'coup'
  | 'pas_lourd'
  | 'frolement'
  | 'vautours'
  | 'cri_douleur'
  | 'piege';

export type FaunaEvent =
  | { type: 'attaque'; id: string; sp: SpeciesId; behind: boolean; downed: boolean }
  | { type: 'saisie'; id: string; sp: SpeciesId }
  | { type: 'lache'; id: string; sp: SpeciesId; reason: 'temps' | 'coups' | 'debattu' | 'blessee' | 'mort' }
  | { type: 'son'; kind: SoundKind; x: number; y: number; z: number }
  | { type: 'mort'; id: string; sp: SpeciesId; x: number; y: number; z: number; yaw: number; scale: number }
  | { type: 'piece'; s: string; p: number; damage: number; sp: SpeciesId }
  | { type: 'manger'; carcass: string; amount: number }
  | { type: 'vol'; prop: string; id: string }
  | { type: 'piege'; trap: string; id: string; sp: SpeciesId }
  | { type: 'disparait'; id: string; sp: SpeciesId };

export type Mode =
  | 'repos'
  | 'paitre'
  | 'errer'
  | 'alerte'
  | 'fuite'
  | 'menace'
  | 'charge'
  | 'traque'
  | 'rode'
  | 'encercle'
  | 'attaque'
  | 'repli'
  | 'manger'
  | 'pris'
  | 'guet'
  | 'vol'
  | 'cercle'
  | 'saisit'
  | 'chasse';

export interface Creature {
  id: string;
  sp: SpeciesId;
  group: string;
  x: number;
  y: number;
  z: number;
  yaw: number;
  speed: number;
  goalYaw: number;
  goalSpeed: number;
  /** Vitesse verticale voulue (nageurs et oiseaux). */
  goalY: number | null;
  hp: number;
  maxHp: number;
  /** Santé perdue par seconde (blessure qui saigne). */
  bleed: number;
  /** Boiterie (0 à 1). */
  limp: number;
  /** Taille (jeunes plus petits ; la créature du lac grandit). */
  scale: number;
  mode: Mode;
  modeT: number;
  /** Cible : 'joueur', identifiant d'une créature ou d'une carcasse. */
  target: string | null;
  gx: number;
  gz: number;
  /** Vigilance (0 à 1), peur, colère. */
  alert: number;
  fear: number;
  anger: number;
  /** Voit le joueur en ce moment. */
  sees: boolean;
  /** Dernière position connue du joueur et quand. */
  seenX: number;
  seenZ: number;
  seenT: number;
  windup: number;
  cooldown: number;
  stagger: number;
  /** Piège qui la retient. */
  caught: string | null;
  lastHurt: number;
  hurtByPlayer: number;
  /** Fixée du regard par le joueur depuis (s). */
  stared: number;
  nextThink: number;
  lastThink: number;
  blocked: boolean;
  /** Repérée par le joueur (léopard qui renonce) jusqu'à ce temps. */
  spottedUntil: number;
  /** Bouchées prises sur une carcasse. */
  fed: number;
  dead: boolean;
  /** Hauteur du sol sous la créature (mise à jour quand elle bouge). */
  groundY: number;
}

interface Spot {
  x: number;
  z: number;
  w: number;
}

export interface Group {
  id: string;
  sp: SpeciesId;
  /** Groupe suivi (léopard, clan, troupe, créature du lac) : sa clé de site ; null pour les autres. */
  key: string | null;
  /** Zone de population d'origine (−1 : aucune). */
  cell: number;
  home: { x: number; z: number; r: number };
  members: string[];
  /** Hors de portée : position, santé et taille de chaque membre. */
  abstract: { x: number; z: number; hp: number[]; scale: number[] } | null;
  habits: Spot[];
  food: Spot[];
  mode: Mode;
  modeT: number;
  target: string | null;
  gx: number;
  gz: number;
  morale: number;
  hunger: number;
  /** Étapes de migration (éléphants). */
  route: Array<{ x: number; z: number }>;
  leg: number;
  /** Retour d'un individu disparu (léopard remplacé, créature du lac) : temps du monde. */
  returnAt: number;
  /** Créature du lac : attention portée au joueur ; nombre de passages sous lui. */
  attention: number;
  passes: number;
  /** Fin d'une activité en cours (éléphants qui broutent). */
  until: number;
}

interface Cell {
  counts: Record<string, number>;
  caps: Record<string, number>;
  /** Pression de chasse du joueur (0 à 1). */
  fear: number;
}

export interface CreatureView {
  id: string;
  sp: SpeciesId;
  x: number;
  y: number;
  z: number;
  yaw: number;
  speed: number;
  mode: Mode;
  hp: number;
  scale: number;
  limp: number;
  windup: number;
  caught: boolean;
  grabbing: boolean;
  alert: number;
}

interface Crumb {
  x: number;
  z: number;
  t: number;
  blood: boolean;
}

interface Noise {
  x: number;
  z: number;
  r: number;
  t: number;
  water: boolean;
}

const CELL = 1000;
const CELLS = WORLD_HALF * 2 / CELL;
const SITE = 2000;
/** Distances (m) de matérialisation et de retour à l'état abstrait. */
const NEAR_IN = 240;
const NEAR_OUT = 300;
const DYN_SPAWN_MIN = 150;
const DYN_SPAWN_MAX = 200;
const DYN_DESPAWN = 280;
const TRAIL_STEP = 3;
const TRAIL_LIFE = 600;
const BLOOD_LIFE = 1200;
const LEOPARD_RETURN = 3600;
/** États où une créature doit réagir vite (décisions plus fréquentes). */
const ACTIVE_MODES = new Set<string>(['fuite', 'menace', 'charge', 'traque', 'rode', 'encercle', 'attaque', 'repli', 'saisit', 'chasse', 'vol', 'cercle']);
const OMBRE_RETURN = 900;

const TAU = Math.PI * 2;
const wrap = (a: number): number => {
  let x = a % TAU;
  if (x > Math.PI) x -= TAU;
  if (x < -Math.PI) x += TAU;
  return x;
};
const angleTo = (fx: number, fz: number, tx: number, tz: number): number => Math.atan2(tx - fx, tz - fz);
const clamp = (v: number, lo: number, hi: number): number => (v < lo ? lo : v > hi ? hi : v);
const dist2 = (ax: number, az: number, bx: number, bz: number): number => Math.hypot(ax - bx, az - bz);

/** Zone de la créature du lac : eaux profondes du grand lac et du Zambèze voisin. */
export function inLakeDomain(terrain: Terrain, x: number, z: number, minDepth = 3): boolean {
  const depth = WATER_LEVEL - terrain.heightAt(x, z);
  if (depth < minDepth) return false;
  const L = LANDMARKS.lake;
  const ex = (x - L.x) / (L.rx * 1.25);
  const ez = (z - L.z) / (L.rz * 1.6);
  if (ex * ex + ez * ez <= 1) return true;
  return Math.abs(z - LANDMARKS.zambeziZ) < 900 && Math.abs(x - L.x) < 8000;
}

export class Fauna {
  readonly creatures = new Map<string, Creature>();
  readonly groups = new Map<string, Group>();
  private readonly cells = new Map<number, Cell>();
  /** Sites de groupes suivis disparus définitivement (clé → temps du monde). */
  private readonly sitesTried = new Set<string>();
  private trail: Crumb[] = [];
  /** Traces de sang des créatures blessées (affichage, pistage). */
  blood: Array<{ x: number; z: number; t: number }> = [];
  private noises: Noise[] = [];
  private readonly events: FaunaEvent[] = [];
  /** Évolution du comportement par espèce : méfiance (proies) et hardiesse (prédateurs), de −1 à 1. */
  readonly traits: Record<string, { wary: number; bold: number }> = {};
  /** Prise en cours : créature qui tient le joueur. */
  grab: { id: string; t: number; struggle: number; hits: number } | null = null;
  private rng: number;
  private nextId = 1;
  private nextGroup = 1;
  private time = 0;
  private lastSpawnCheck = -999;
  private lastSites = -999;
  private lastEco = 0;
  private lastSound = new Map<string, number>();
  private tickCount = 0;
  private player: FaunaPlayer | null = null;
  private env: FaunaEnv | null = null;
  /** Créatures réelles au plus (téléphone : 24). */
  cap: number;
  /** Faune désactivée (tests d'autres phases). */
  enabled = true;
  /** Apparitions spontanées (tanières, hardes) : désactivables pour les tests. */
  wild = true;

  constructor(
    readonly seed: number,
    readonly terrain: Terrain,
    cap = 40,
  ) {
    this.rng = hash32(seed, 0xfa0a) || 1;
    this.cap = cap;
    for (const sp of Object.keys(SPECIES)) this.traits[sp] = { wary: 0, bold: 0 };
    this.createOmbre();
  }

  // ——— Hasard déterministe ———

  rand(): number {
    this.rng = (this.rng + 0x6d2b79f5) >>> 0;
    let t = this.rng;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  private range(a: number, b: number): number {
    return a + (b - a) * this.rand();
  }

  private pick<T>(list: ReadonlyArray<[T, number]>): T {
    let total = 0;
    for (const [, w] of list) total += w;
    let r = this.rand() * total;
    for (const [v, w] of list) {
      r -= w;
      if (r <= 0) return v;
    }
    return list[list.length - 1]![0];
  }

  // ——— Entrées venant de la simulation ———

  /** Bruit fait dans le monde (pas, coups, chutes d'arbres, objets qui tombent, cris). */
  noise(x: number, z: number, r: number, water = false): void {
    if (r <= 0) return;
    this.noises.push({ x, z, r, t: this.time, water });
    if (this.noises.length > 40) this.noises.splice(0, this.noises.length - 40);
  }

  takeEvents(): FaunaEvent[] {
    return this.events.splice(0, this.events.length);
  }

  private emit(e: FaunaEvent): void {
    this.events.push(e);
    if (this.events.length > 200) this.events.splice(0, this.events.length - 200);
  }

  private sound(kind: SoundKind, x: number, y: number, z: number, minGap = 0, key: string = kind): void {
    const last = this.lastSound.get(key) ?? -1e9;
    if (this.time - last < minGap) return;
    this.lastSound.set(key, this.time);
    this.emit({ type: 'son', kind, x, y, z });
  }

  // ——— Populations par zone ———

  private cellIndex(x: number, z: number): number {
    const ix = clamp(Math.floor((x + WORLD_HALF) / CELL), 0, CELLS - 1);
    const iz = clamp(Math.floor((z + WORLD_HALF) / CELL), 0, CELLS - 1);
    return iz * CELLS + ix;
  }

  private cellCenter(i: number): { x: number; z: number } {
    return { x: (i % CELLS) * CELL - WORLD_HALF + CELL / 2, z: Math.floor(i / CELLS) * CELL - WORLD_HALF + CELL / 2 };
  }

  /** Intérêt d'un point pour une espèce (0 à 1). */
  suitability(sp: SpeciesId, x: number, z: number): number {
    const s = this.terrain.sampleInto(x, z);
    const depth = WATER_LEVEL - s.height;
    const d = SPECIES[sp];
    if (sp === 'crocodile') return depth > 0.6 && depth < 5 ? 1 : 0;
    if (depth > d.maxWade) return 0;
    return d.biomes[s.biome] ?? 0;
  }

  private cell(i: number): Cell {
    let c = this.cells.get(i);
    if (c) return c;
    const center = this.cellCenter(i);
    const counts: Record<string, number> = {};
    const caps: Record<string, number> = {};
    for (const sp of POPULATION_SPECIES) {
      let sum = 0;
      for (let a = 0; a < 3; a++) for (let b = 0; b < 3; b++) sum += this.suitability(sp, center.x + (a - 1) * 320, center.z + (b - 1) * 320);
      const cap = (sum / 9) * SPECIES[sp].density * (sp === 'crocodile' ? 2 : 1);
      caps[sp] = cap;
      counts[sp] = Math.round(cap * (0.5 + 0.5 * (hash32(this.seed, i, sp.length * 31 + sp.charCodeAt(0)) / 4294967296)));
    }
    c = { counts, caps, fear: 0 };
    this.cells.set(i, c);
    return c;
  }

  /** Population d'une espèce dans la zone d'un point (diagnostic, tests). */
  population(sp: SpeciesId, x: number, z: number): number {
    return this.cell(this.cellIndex(x, z)).counts[sp] ?? 0;
  }

  /** Évolution des populations (toutes les minutes de jeu). */
  private stepEcosystem(minutes: number): void {
    const h = minutes / 60;
    for (const [i, c] of this.cells) {
      for (const sp of POPULATION_SPECIES) {
        const cap = c.caps[sp] ?? 0;
        let n = c.counts[sp] ?? 0;
        if (cap <= 0) continue;
        // Naissances (croissance logistique), freinées par la peur du joueur.
        n += n * SPECIES[sp].births * h * (1 - n / cap) * (1 - 0.5 * c.fear);
        // Prédation par les hyènes (clans proches comptés comme une pression moyenne).
        if (sp === 'impala' || sp === 'phacochere') n -= (c.counts.hyene ?? 0) * 0.02 * h;
        c.counts[sp] = Math.max(0, n);
      }
      // Migrations : une petite part part vers une zone voisine moins peuplée (éléphants : davantage).
      for (const sp of POPULATION_SPECIES) {
        const n = c.counts[sp] ?? 0;
        if (n < 1) continue;
        const rate = (sp === 'elephant' ? 0.1 : 0.02) * h + (c.fear > 0.3 && sp !== 'crocodile' ? 0.05 * h : 0);
        const ix = i % CELLS;
        const iz = Math.floor(i / CELLS);
        const nx = clamp(ix + (this.rand() < 0.5 ? -1 : 1), 0, CELLS - 1);
        const nz = clamp(iz + (this.rand() < 0.5 ? -1 : 1), 0, CELLS - 1);
        const j = nz * CELLS + nx;
        const other = this.cells.get(j);
        if (!other) continue;
        const capO = other.caps[sp] ?? 0;
        if (capO <= 0) continue;
        if ((other.counts[sp] ?? 0) / capO < n / Math.max(0.01, c.caps[sp] ?? 0)) {
          const moved = n * rate;
          c.counts[sp] = n - moved;
          other.counts[sp] = (other.counts[sp] ?? 0) + moved;
        }
      }
      c.fear = Math.max(0, c.fear - 0.1 * h);
    }
    // Les comportements reviennent lentement à la normale.
    for (const t of Object.values(this.traits)) {
      t.wary *= Math.exp(-0.05 * h);
      t.bold *= Math.exp(-0.05 * h);
    }
    // Les groupes suivis se reforment peu à peu.
    for (const g of this.groups.values()) {
      const d = SPECIES[g.sp];
      if (g.key && g.abstract && g.abstract.hp.length < d.group[1] && (g.sp === 'hyene' || g.sp === 'babouin') && this.rand() < h * 3) {
        g.abstract.hp.push(d.hp);
        g.abstract.scale.push(0.75);
      }
      if (g.abstract) for (let k = 0; k < g.abstract.scale.length; k++) g.abstract.scale[k] = Math.min(1, g.abstract.scale[k]! + 0.05 * h);
    }
  }

  // ——— Groupes suivis (apparitions fixes) ———

  private createOmbre(): void {
    const L = LANDMARKS.lake;
    // Point profond près du centre du lac.
    let best: { x: number; z: number; depth: number } = { x: L.x, z: L.z, depth: -1 };
    for (let k = 0; k < 64; k++) {
      const a = (k / 64) * TAU;
      const r = 300 + (k % 8) * 220;
      const x = L.x + Math.cos(a) * r;
      const z = L.z + Math.sin(a) * r * 0.5;
      const depth = WATER_LEVEL - this.terrain.heightAt(x, z);
      if (depth > best.depth) best = { x, z, depth };
    }
    const g = this.makeGroup('ombre', 'ombre', best.x, best.z, 2000, -1);
    g.abstract = { x: best.x, z: best.z, hp: [SPECIES.ombre.hp], scale: [1] };
    this.groups.set(g.id, g);
  }

  private makeGroup(sp: SpeciesId, key: string | null, x: number, z: number, r: number, cell: number): Group {
    return {
      id: `g${this.nextGroup++}`,
      sp,
      key,
      cell,
      home: { x, z, r },
      members: [],
      abstract: null,
      habits: [],
      food: [],
      mode: 'errer',
      modeT: 0,
      target: null,
      gx: x,
      gz: z,
      morale: 1,
      hunger: this.rand() * 0.5,
      route: [],
      leg: 0,
      returnAt: 0,
      attention: 0,
      passes: 0,
      until: 0,
    };
  }

  /** Crée les groupes suivis (tanières, territoires, kopjes) autour du joueur. */
  private ensureSites(px: number, pz: number): void {
    const R = 2600;
    const x0 = Math.floor((px - R + WORLD_HALF) / SITE);
    const x1 = Math.floor((px + R + WORLD_HALF) / SITE);
    const z0 = Math.floor((pz - R + WORLD_HALF) / SITE);
    const z1 = Math.floor((pz + R + WORLD_HALF) / SITE);
    for (let iz = z0; iz <= z1; iz++) {
      for (let ix = x0; ix <= x1; ix++) {
        for (const sp of ['leopard', 'hyene', 'babouin'] as const) {
          const key = `${sp}:${ix}:${iz}`;
          if (this.sitesTried.has(key)) continue;
          this.sitesTried.add(key);
          const h = hash32(this.seed, ix, iz, sp.charCodeAt(0) * 7 + sp.length);
          if (h / 4294967296 > (sp === 'babouin' ? 0.8 : sp === 'leopard' ? 0.45 : 0.65)) continue;
          // Cherche un emplacement favorable dans la case.
          let best: { x: number; z: number; s: number } | null = null;
          for (let k = 0; k < 10; k++) {
            const x = ix * SITE - WORLD_HALF + ((hash32(h, k, 1) % 1000) / 1000) * SITE;
            const z = iz * SITE - WORLD_HALF + ((hash32(h, k, 2) % 1000) / 1000) * SITE;
            const s = this.suitability(sp, x, z);
            if (s > (best?.s ?? 0.45)) best = { x, z, s };
          }
          if (!best) continue;
          const d = SPECIES[sp];
          const g = this.makeGroup(sp, key, best.x, best.z, sp === 'leopard' ? 900 : sp === 'hyene' ? 1200 : 600, this.cellIndex(best.x, best.z));
          const n = d.group[0] + (h % (d.group[1] - d.group[0] + 1));
          g.abstract = { x: best.x, z: best.z, hp: Array.from({ length: n }, () => d.hp), scale: Array.from({ length: n }, (_, k) => (k === 0 || sp === 'leopard' ? 1 : 0.8 + 0.2 * ((h >>> k) & 1))) };
          this.groups.set(g.id, g);
        }
      }
    }
  }

  // ——— Créatures réelles ———

  private newCreature(sp: SpeciesId, g: Group, x: number, z: number, hp: number, scale: number): Creature {
    const d = SPECIES[sp];
    const c: Creature = {
      id: `c${this.nextId++}`,
      sp,
      group: g.id,
      x,
      y: this.surfaceY(sp, x, z, null),
      z,
      yaw: this.rand() * TAU - Math.PI,
      speed: 0,
      goalYaw: 0,
      goalSpeed: 0,
      goalY: null,
      hp,
      maxHp: d.hp * scale,
      bleed: 0,
      limp: 0,
      scale,
      mode: sp === 'crocodile' ? 'guet' : 'errer',
      modeT: 0,
      target: null,
      gx: x,
      gz: z,
      alert: 0,
      fear: 0,
      anger: 0,
      sees: false,
      seenX: 0,
      seenZ: 0,
      seenT: -1e9,
      windup: 0,
      cooldown: 0,
      stagger: 0,
      caught: null,
      lastHurt: -1e9,
      hurtByPlayer: -1e9,
      stared: 0,
      nextThink: this.time + this.rand() * 0.2,
      lastThink: this.time,
      blocked: false,
      spottedUntil: -1e9,
      fed: 0,
      dead: false,
      groundY: this.terrain.heightAt(x, z),
    };
    c.goalYaw = c.yaw;
    this.creatures.set(c.id, c);
    g.members.push(c.id);
    return c;
  }

  /** Fait apparaître un groupe près d'un point (outils de test, scénarios). */
  spawnGroup(sp: SpeciesId, x: number, z: number, n?: number): Group {
    const d = SPECIES[sp];
    const g = this.makeGroup(sp, null, x, z, sp === 'crocodile' ? 60 : 400, -1);
    this.groups.set(g.id, g);
    const count = n ?? Math.round(this.range(d.group[0], d.group[1]));
    for (let k = 0; k < count; k++) {
      const a = (k / Math.max(1, count)) * TAU;
      const r = count > 1 ? 2 + d.halfLength * 2 : 0;
      this.newCreature(sp, g, x + Math.cos(a) * r, z + Math.sin(a) * r, d.hp, 1);
    }
    if (sp === 'elephant') this.planRoute(g);
    return g;
  }

  private materialize(g: Group): void {
    if (!g.abstract) return;
    const d = SPECIES[g.sp];
    const { x, z, hp, scale } = g.abstract;
    g.abstract = null;
    hp.forEach((h, k) => {
      const a = (k / Math.max(1, hp.length)) * TAU + this.rand();
      const r = hp.length > 1 ? 3 + this.rand() * 6 : 0;
      let cx = x + Math.cos(a) * r;
      let cz = z + Math.sin(a) * r;
      if (!this.passable(d, cx, cz)) {
        cx = x;
        cz = z;
      }
      this.newCreature(g.sp, g, cx, cz, h, scale[k] ?? 1);
    });
    if (g.sp === 'elephant' && !g.route.length) this.planRoute(g);
  }

  /** Retire un groupe de la scène : groupe suivi → état abstrait ; groupe de population → retour dans sa zone. */
  private dematerialize(g: Group): void {
    const alive = g.members.map((id) => this.creatures.get(id)).filter((c): c is Creature => !!c && !c.dead);
    const cx = alive.length ? alive.reduce((s, c) => s + c.x, 0) / alive.length : g.home.x;
    const cz = alive.length ? alive.reduce((s, c) => s + c.z, 0) / alive.length : g.home.z;
    for (const id of g.members) {
      this.creatures.delete(id);
      if (this.grab?.id === id) this.release('temps');
    }
    g.members = [];
    if (g.key) {
      g.abstract = { x: cx, z: cz, hp: alive.map((c) => c.hp), scale: alive.map((c) => c.scale) };
    } else {
      if (g.cell >= 0 && alive.length) {
        const cell = this.cell(this.cellIndex(cx, cz));
        cell.counts[g.sp] = (cell.counts[g.sp] ?? 0) + alive.length;
      }
      this.groups.delete(g.id);
    }
  }

  // ——— Pas de simulation ———

  /**
   * Fait avancer la faune d'un pas. Le joueur et l'environnement sont fournis par la simulation.
   * Renvoie rien : lire les événements avec takeEvents().
   */
  step(dt: number, time: number, player: FaunaPlayer, env: FaunaEnv): void {
    this.time = time;
    this.player = player;
    this.env = env;
    if (!this.enabled) return;
    this.tickCount++;
    this.trackPlayer(player);
    if (this.wild && time - this.lastSites > 5) {
      this.lastSites = time;
      this.ensureSites(player.x, player.z);
    }
    if (time - this.lastEco >= 60) {
      const minutes = Math.min(60, (time - this.lastEco) / 60);
      this.lastEco = time;
      this.stepEcosystem(minutes);
    }
    if (time - this.lastSpawnCheck >= 2) {
      this.lastSpawnCheck = time;
      this.manageGroups(player);
    }
    this.stepOmbreAttention(dt, player);
    // Décisions de groupe (2 fois par seconde), puis individuelles, puis déplacements.
    for (const g of this.groups.values()) if (g.members.length && time - g.modeT >= 0) this.thinkGroup(g);
    for (const c of this.creatures.values()) {
      if (c.dead) continue;
      if (time >= c.nextThink) {
        const elapsed = time - c.lastThink;
        c.lastThink = time;
        const far = dist2(c.x, c.z, player.x, player.z);
        // Plus souvent quand il se passe quelque chose ; moins souvent pour un animal calme ou lointain.
        const busy = c.alert > 0.3 || ACTIVE_MODES.has(c.mode) || this.grab?.id === c.id;
        c.nextThink = time + (far < 80 ? (busy ? 0.1 : 0.25) : far < 160 ? (busy ? 0.2 : 0.4) : 0.6);
        this.perceive(c, elapsed);
        this.think(c, elapsed);
      }
      this.act(c, dt);
      this.move(c, dt);
    }
    this.stepGrab(dt);
    this.stepBlood(dt);
    if (this.noises.length && time - this.noises[0]!.t > 0.6) this.noises = this.noises.filter((n) => time - n.t <= 0.6);
  }

  private trackPlayer(p: FaunaPlayer): void {
    if (p.state === 'mort') return;
    const last = this.trail[this.trail.length - 1];
    if (!last || dist2(last.x, last.z, p.x, p.z) >= TRAIL_STEP) {
      this.trail.push({ x: p.x, z: p.z, t: this.time, blood: p.bleeding > 0.05 });
      if (this.trail.length > 200) this.trail.shift();
    }
  }

  /** Piste du joueur la plus fraîche perçue par l'odorat, ou null. */
  private freshScent(c: Creature, d: SpeciesDef): Crumb | null {
    if (d.smell <= 0) return null;
    let best: Crumb | null = null;
    for (let k = this.trail.length - 1; k >= 0; k--) {
      const cr = this.trail[k]!;
      const life = cr.blood ? BLOOD_LIFE : TRAIL_LIFE;
      const age = this.time - cr.t;
      if (age > life) break;
      const reach = d.smell * (cr.blood ? 1.6 : 0.6) * (1 - age / life);
      if (dist2(c.x, c.z, cr.x, cr.z) < reach) {
        best = cr;
        break;
      }
    }
    return best;
  }

  private stepBlood(dt: number): void {
    for (const c of this.creatures.values()) {
      if (c.dead || c.bleed <= 0) continue;
      c.hp -= c.bleed * dt;
      c.bleed = Math.max(0, c.bleed - dt * 0.004);
      if (this.blood.length === 0 || dist2(this.blood[this.blood.length - 1]!.x, this.blood[this.blood.length - 1]!.z, c.x, c.z) > 1.5) {
        this.blood.push({ x: c.x, z: c.z, t: this.time });
        if (this.blood.length > 300) this.blood.shift();
      }
      if (c.hp <= 0) this.kill(c, 'saignement');
    }
    if (this.blood.length && this.time - this.blood[0]!.t > BLOOD_LIFE) this.blood = this.blood.filter((b) => this.time - b.t <= BLOOD_LIFE);
  }

  /** Apparitions et disparitions selon la distance au joueur (toutes les 2 s). */
  private manageGroups(p: FaunaPlayer): void {
    let concrete = 0;
    for (const c of this.creatures.values()) if (!c.dead) concrete++;
    for (const g of [...this.groups.values()]) {
      if (g.sp === 'ombre') continue;
      if (g.members.length) {
        const alive = g.members.map((id) => this.creatures.get(id)).filter((c): c is Creature => !!c && !c.dead);
        if (!alive.length && !g.key) {
          for (const id of g.members) this.creatures.delete(id);
          this.groups.delete(g.id);
          continue;
        }
        const near = alive.some((c) => dist2(c.x, c.z, p.x, p.z) < (g.key ? NEAR_OUT : DYN_DESPAWN));
        if (!near) this.dematerialize(g);
        // Les morts restent un moment (carcasse créée par la simulation) puis sont oubliés.
        for (const id of [...g.members]) {
          const c = this.creatures.get(id);
          if (c?.dead && this.time - c.lastHurt > 1) {
            this.creatures.delete(id);
            g.members = g.members.filter((m) => m !== id);
          }
        }
      } else if (g.abstract) {
        if (g.returnAt > this.time) continue;
        if (!g.abstract.hp.length && g.sp === 'leopard' && g.returnAt > 0) {
          // Un nouveau léopard s'installe dans le territoire : il ne sait rien du joueur.
          g.abstract = { x: g.home.x, z: g.home.z, hp: [SPECIES.leopard.hp], scale: [1] };
          g.habits = [];
          g.returnAt = 0;
        }
        if (!g.abstract.hp.length) continue;
        // Les groupes suivis se promènent dans leur territoire, même loin.
        if (this.rand() < 0.2) {
          const a = this.rand() * TAU;
          const r = this.rand() * g.home.r * 0.6;
          const tx = g.home.x + Math.cos(a) * r;
          const tz = g.home.z + Math.sin(a) * r;
          if (this.suitability(g.sp, tx, tz) > 0.2) {
            g.abstract.x += (tx - g.abstract.x) * 0.1;
            g.abstract.z += (tz - g.abstract.z) * 0.1;
          }
        }
        if (dist2(g.abstract.x, g.abstract.z, p.x, p.z) < NEAR_IN && concrete + g.abstract.hp.length <= this.cap) {
          concrete += g.abstract.hp.length;
          this.materialize(g);
        }
      }
    }
    // Apparitions dynamiques (hardes, familles, crocodiles) selon la population de la zone.
    if (p.state === 'mort' || !this.wild) return;
    for (const sp of ['impala', 'phacochere', 'elephant', 'crocodile'] as const) {
      const d = SPECIES[sp];
      let groups = 0;
      for (const g of this.groups.values()) if (!g.key && g.sp === sp && g.members.length) groups++;
      const cell = this.cell(this.cellIndex(p.x, p.z));
      const density = cell.counts[sp] ?? 0;
      const avg = (d.group[0] + d.group[1]) / 2;
      let wanted = (density * 0.2 * 1.5) / avg;
      if (sp === 'crocodile') wanted = density >= 1 ? 1.2 : 0;
      wanted *= 1 - 0.6 * (this.traits[sp]?.wary ?? 0) * 0.5;
      if (groups >= Math.floor(wanted + this.rand())) continue;
      for (let attempt = 0; attempt < 6; attempt++) {
        const a = this.rand() * TAU;
        const r = this.range(DYN_SPAWN_MIN, DYN_SPAWN_MAX);
        const x = p.x + Math.cos(a) * r;
        const z = p.z + Math.sin(a) * r;
        if (Math.abs(x) > WORLD_HALF - 400 || Math.abs(z) > WORLD_HALF - 400) continue;
        if (this.suitability(sp, x, z) < 0.3) continue;
        const ci = this.cellIndex(x, z);
        const c = this.cell(ci);
        const avail = Math.floor(c.counts[sp] ?? 0);
        if (avail < 1) break;
        const n = Math.min(avail, Math.round(this.range(d.group[0], d.group[1])));
        if (concrete + n > this.cap) break;
        c.counts[sp] = (c.counts[sp] ?? 0) - n;
        const g = this.makeGroup(sp, null, x, z, sp === 'crocodile' ? 80 : 500, ci);
        this.groups.set(g.id, g);
        for (let k = 0; k < n; k++) {
          const aa = this.rand() * TAU;
          const rr = n > 1 ? 2 + this.rand() * 6 : 0;
          const cx = x + Math.cos(aa) * rr;
          const cz = z + Math.sin(aa) * rr;
          this.newCreature(sp, g, this.passable(d, cx, cz) ? cx : x, this.passable(d, cx, cz) ? cz : z, d.hp, k > 1 && this.rand() < 0.3 ? 0.7 : 1);
        }
        if (sp === 'elephant') this.planRoute(g);
        concrete += n;
        break;
      }
    }
  }

  /** Itinéraire d'une harde d'éléphants : l'eau, puis la forêt, puis l'eau… */
  private planRoute(g: Group): void {
    const stops: Array<{ x: number; z: number }> = [];
    const base = { x: g.home.x, z: g.home.z };
    // Point d'eau le plus proche (recherche en anneaux).
    for (let ring = 1; ring <= 12 && stops.length === 0; ring++) {
      for (let k = 0; k < 12; k++) {
        const a = (k / 12) * TAU;
        const x = base.x + Math.cos(a) * ring * 150;
        const z = base.z + Math.sin(a) * ring * 150;
        const depth = WATER_LEVEL - this.terrain.heightAt(x, z);
        if (depth > 0 && depth < 1.5) {
          stops.push({ x, z });
          break;
        }
      }
    }
    for (let k = 0; k < 2; k++) {
      const a = this.rand() * TAU;
      const r = 300 + this.rand() * 500;
      const x = base.x + Math.cos(a) * r;
      const z = base.z + Math.sin(a) * r;
      if (this.suitability('elephant', x, z) > 0.3) stops.push({ x, z });
    }
    if (!stops.length) stops.push({ x: base.x + 200, z: base.z });
    g.route = stops;
    g.leg = 0;
  }

  // ——— Sens ———

  private visibility(c: Creature, d: SpeciesDef, p: FaunaPlayer): number {
    const aquatic = d.archetype === 'aquatique' || d.archetype === 'abysse';
    if (p.underwater && !aquatic) return 0;
    let f = 1;
    const speed = Math.hypot(p.vx, p.vz);
    if (p.crouched) f *= speed < 1.2 ? 0.32 : 0.45;
    if (speed < 0.3) f *= 0.7;
    else if (speed > 4) f *= 1.3;
    if (p.swimming && !p.underwater) f *= 0.7;
    if (c.mode === 'paitre') f *= 0.6;
    return f;
  }

  /** Ligne de vue entre la créature et le joueur (relief, arbres, murs). */
  private lineOfSight(c: Creature, d: SpeciesDef, p: FaunaPlayer): boolean {
    const env = this.env!;
    const ey = c.y + d.height * c.scale * 1.05;
    const ty = p.y + (p.crouched ? 0.8 : 1.3);
    const dx = p.x - c.x;
    const dy = ty - ey;
    const dz = p.z - c.z;
    const len = Math.hypot(dx, dy, dz);
    if (len < 1) return true;
    if (env.physicsAt(c.x, c.z) && env.physicsAt(p.x, p.z)) {
      const hit = env.ray(c.x, ey, c.z, dx / len, dy / len, dz / len, len);
      return hit === null || hit > len - 0.6;
    }
    for (let k = 1; k < 8; k++) {
      const t = k / 8;
      const x = c.x + dx * t;
      const z = c.z + dz * t;
      if (this.terrain.heightAt(x, z) > ey + dy * t + 0.2) return false;
    }
    return true;
  }

  private perceive(c: Creature, dt: number): void {
    const p = this.player!;
    const d = SPECIES[c.sp];
    if (d.archetype === 'abysse' || d.archetype === 'charognard') return;
    const dist = dist2(c.x, c.z, p.x, p.z);
    let see = false;
    let hear = false;
    let smell = false;
    if (p.state !== 'mort') {
      const vis = this.visibility(c, d, p);
      if (vis > 0 && dist < d.vision.range * vis) {
        const ang = Math.abs(wrap(angleTo(c.x, c.z, p.x, p.z) - c.yaw));
        if (ang <= (d.vision.fov * Math.PI) / 360 || dist < 2.5) see = this.lineOfSight(c, d, p);
      }
      if (p.noise * d.hearing >= dist) hear = true;
      if (d.smell > 0 && !p.underwater && dist < d.smell * (p.bleeding > 0.05 ? 1.8 : 1) * (p.meat ? 1.5 : 1) * 0.5) smell = true;
      // Le crocodile perçoit les remous de qui nage ou marche dans l'eau.
      if (c.sp === 'crocodile' && p.waterDepth > 0.3 && dist < 40) hear = true;
    }
    for (const n of this.noises) {
      if (n.r * d.hearing >= dist2(c.x, c.z, n.x, n.z) && n.r > 0) {
        c.alert = Math.min(1, c.alert + 0.15 * (n.r / 30));
        if (c.mode !== 'fuite' && c.mode !== 'attaque' && c.mode !== 'charge' && d.archetype !== 'aquatique') c.goalYaw = angleTo(c.x, c.z, n.x, n.z);
      }
    }
    let gain = 0;
    if (see) gain += (2.2 * (1 - dist / Math.max(1, d.vision.range)) + 0.5) * (Math.hypot(p.vx, p.vz) > 2 ? 1.5 : 1);
    if (hear) gain += 0.9;
    if (smell) gain += 0.35;
    c.alert = clamp(c.alert + gain * dt - (gain === 0 ? 0.1 * dt : 0), 0, 1);
    c.sees = see;
    if (see || (hear && c.alert > 0.4) || (smell && c.alert > 0.6)) {
      c.seenX = p.x;
      c.seenZ = p.z;
      c.seenT = this.time;
    }
    // Fixée du regard : le joueur regarde la créature, de face, à moins de 30 m.
    if (see && dist < 30) {
      const look = Math.abs(wrap(p.yaw - angleTo(p.x, p.z, c.x, c.z)));
      if (look < 0.3) c.stared += dt;
      else c.stared = Math.max(0, c.stared - dt);
    } else c.stared = Math.max(0, c.stared - dt);
  }

  /** Feu allumé près d'un point (rayon de crainte de l'espèce). */
  private fireNear(x: number, z: number, r: number): { x: number; z: number } | null {
    if (r <= 0) return null;
    for (const f of this.env!.fires) if (dist2(x, z, f.x, f.z) < r + f.r) return f;
    return null;
  }

  /** Le joueur semble vulnérable (hyènes) : de 0 (dangereux) à plus de 1 (à terre). */
  private vulnerability(g: Group): number {
    const p = this.player!;
    if (p.state === 'mort') return 0;
    if (p.state !== 'eveille') return 2;
    let v = 0.15;
    if (p.health < 50) v += 0.25;
    if (p.health < 25) v += 0.25;
    if (p.bleeding > 0.05) v += 0.3;
    if (p.injuredLegs) v += 0.2;
    if (p.meat) v += 0.2;
    v -= p.weapon * 0.15;
    if (p.torch || this.fireNear(p.x, p.z, 6)) v -= 1;
    v += (g.members.length - 3) * 0.08;
    v += (this.traits[g.sp]?.bold ?? 0) * 0.3;
    v *= g.morale;
    return v;
  }

  // ——— Décisions ———

  private members(g: Group): Creature[] {
    const out: Creature[] = [];
    for (const id of g.members) {
      const c = this.creatures.get(id);
      if (c && !c.dead) out.push(c);
    }
    return out;
  }

  private centroid(list: Creature[]): { x: number; z: number } {
    let x = 0;
    let z = 0;
    for (const c of list) {
      x += c.x;
      z += c.z;
    }
    return { x: x / Math.max(1, list.length), z: z / Math.max(1, list.length) };
  }

  private setMode(c: Creature, m: Mode): void {
    if (c.mode !== m) {
      c.mode = m;
      c.modeT = this.time;
      if (m !== 'attaque') c.windup = 0;
    }
  }

  private thinkGroup(g: Group): void {
    g.modeT = this.time + 0.5;
    const list = this.members(g);
    if (!list.length) return;
    const p = this.player!;
    const d = SPECIES[g.sp];
    const center = this.centroid(list);
    const pd = dist2(center.x, center.z, p.x, p.z);
    g.hunger = Math.min(1, g.hunger + 0.5 / 600);
    if (g.sp === 'hyene') {
      const detected = list.some((c) => c.alert > 0.6 && this.time - c.seenT < 8) || (p.state !== 'eveille' && pd < 120);
      const scent = list.map((c) => this.freshScent(c, d)).find((s) => !!s) ?? null;
      const V = this.vulnerability(g);
      const carcass = this.env!.carcasses.find((k) => k.meat > 0 && dist2(k.x, k.z, center.x, center.z) < 350);
      if (g.morale < 0.45) {
        g.mode = 'repli';
        g.gx = g.home.x;
        g.gz = g.home.z;
        if (pd > 120) g.morale = Math.min(1, g.morale + 0.01);
      } else if ((detected || scent?.blood) && p.state !== 'mort') {
        if (V > 0.45 && list.length >= 2) {
          if (g.mode !== 'encercle' && g.mode !== 'attaque') {
            g.mode = 'encercle';
            g.passes = 0;
            g.attention = this.time;
            this.sound('hyene_rire', center.x, 0, center.z, 6, g.id + 'rire');
          } else if (g.mode === 'encercle' && this.time - g.attention > 5) g.mode = 'attaque';
        } else if (V > 0.05) {
          g.mode = 'rode';
          if (this.rand() < 0.08) this.sound('hyene_cri', center.x, 0, center.z, 10, g.id + 'cri');
        } else g.mode = 'errer';
        if (scent && !detected) {
          g.gx = scent.x;
          g.gz = scent.z;
        }
      } else if (carcass && (g.hunger > 0.2 || carcass.meat > 2)) {
        g.mode = 'manger';
        g.target = carcass.id;
        g.gx = carcass.x;
        g.gz = carcass.z;
      } else if (g.hunger > 0.6) {
        // Chasse d'une proie proche.
        const prey = [...this.creatures.values()].filter((c) => !c.dead && (c.sp === 'impala' || c.sp === 'phacochere') && dist2(c.x, c.z, center.x, center.z) < 150);
        if (prey.length) {
          prey.sort((a, b) => a.hp / a.maxHp - b.hp / b.maxHp || dist2(a.x, a.z, center.x, center.z) - dist2(b.x, b.z, center.x, center.z));
          g.mode = 'chasse';
          g.target = prey[0]!.id;
        } else g.mode = 'errer';
      } else if (g.mode !== 'errer' && g.mode !== 'repos') g.mode = 'errer';
      if (g.mode === 'errer' && dist2(g.gx, g.gz, center.x, center.z) < 15) {
        const spot = g.habits.length && this.rand() < 0.5 ? this.pick(g.habits.map((h) => [h, h.w] as [Spot, number])) : null;
        const a = this.rand() * TAU;
        g.gx = spot ? spot.x : g.home.x + Math.cos(a) * g.home.r * this.rand() * 0.7;
        g.gz = spot ? spot.z : g.home.z + Math.sin(a) * g.home.r * this.rand() * 0.7;
      }
    } else if (g.sp === 'babouin') {
      const threat = list.find((c) => c.alert > 0.55 && this.time - c.seenT < 4 && dist2(c.x, c.z, p.x, p.z) < 35);
      if (threat && p.state === 'eveille') {
        if (g.mode !== 'alerte' && g.mode !== 'menace' && g.mode !== 'attaque') this.alarm(threat, 'babouin_aboie', 110);
        g.mode = pd < 13 ? 'menace' : 'alerte';
        if (this.time - threat.hurtByPlayer < 20 || pd < 4.5) g.mode = 'attaque';
      } else {
        // Vol de nourriture laissée sans surveillance, puis souvenir de l'endroit.
        const food = this.env!.food.find((f) => dist2(f.x, f.z, center.x, center.z) < 45 && dist2(f.x, f.z, p.x, p.z) > 14);
        if (food) {
          g.mode = 'vol';
          g.target = food.id;
          g.gx = food.x;
          g.gz = food.z;
        } else if (g.mode !== 'errer') g.mode = 'errer';
        if (g.mode === 'errer' && dist2(g.gx, g.gz, center.x, center.z) < 12) {
          const spot = g.food.length && this.rand() < 0.6 ? this.pick(g.food.map((h) => [h, h.w] as [Spot, number])) : null;
          const a = this.rand() * TAU;
          g.gx = spot ? spot.x : g.home.x + Math.cos(a) * g.home.r * 0.5 * this.rand();
          g.gz = spot ? spot.z : g.home.z + Math.sin(a) * g.home.r * 0.5 * this.rand();
        }
      }
    } else if (g.sp === 'elephant') {
      const alerted = list.find((c) => c.alert > 0.5 && this.time - c.seenT < 6);
      const young = list.some((c) => c.scale < 0.8);
      const angry = list.some((c) => this.time - c.hurtByPlayer < 30);
      if ((alerted || angry) && p.state === 'eveille') {
        if (angry || pd < 12) g.mode = 'charge';
        else if (pd < (young ? 30 : 22)) g.mode = 'menace';
        else if (pd < 45) g.mode = 'alerte';
        else g.mode = 'errer';
      } else if (g.mode === 'paitre' && this.time < g.until) {
        // Broute encore.
      } else g.mode = 'errer';
      if (g.mode === 'errer' && g.route.length) {
        const stop = g.route[g.leg % g.route.length]!;
        if (dist2(center.x, center.z, stop.x, stop.z) < 25) {
          g.leg++;
          g.mode = 'paitre';
          g.until = this.time + 40 + this.rand() * 60;
        }
        const next = g.route[g.leg % g.route.length]!;
        g.gx = next.x;
        g.gz = next.z;
      }
    } else if (g.sp === 'leopard') {
      // Le léopard retient où il a vu le joueur : il y reviendra se poster.
      const c = list[0]!;
      if (c.sees && this.time - (g.habits.length ? 0 : -999) > 0) this.addSpot(g.habits, p.x, p.z);
    } else if (g.sp === 'vautour') {
      // Rien : chaque vautour décide seul.
    } else {
      // Hardes (impalas) et familles : rester groupés, en dérivant lentement en broutant.
      if (dist2(g.gx, g.gz, center.x, center.z) < 4 || this.rand() < 0.005) {
        const a = this.rand() * TAU;
        g.gx = center.x + Math.cos(a) * 15;
        g.gz = center.z + Math.sin(a) * 15;
      }
    }
  }

  private addSpot(list: Spot[], x: number, z: number): void {
    const near = list.find((s) => dist2(s.x, s.z, x, z) < 25);
    if (near) near.w = Math.min(10, near.w + 0.3);
    else {
      list.push({ x, z, w: 1 });
      if (list.length > 6) {
        list.sort((a, b) => b.w - a.w);
        list.length = 6;
      }
    }
  }

  /** Cri d'alarme : prévient le groupe et les autres espèces qui l'entendent. */
  private alarm(c: Creature, kind: SoundKind, r: number): void {
    this.sound(kind, c.x, c.y, c.z, 3, c.group + kind);
    for (const o of this.creatures.values()) {
      if (o.dead || o === c) continue;
      if (dist2(o.x, o.z, c.x, c.z) > r) continue;
      const od = SPECIES[o.sp];
      if (od.archetype === 'proie' || od.archetype === 'troupe' || od.archetype === 'defensif') {
        o.alert = Math.max(o.alert, 0.8);
        if (od.archetype === 'proie' && o.mode !== 'fuite') {
          o.fear = Math.max(o.fear, 0.7);
          o.seenX = this.player!.x;
          o.seenZ = this.player!.z;
          o.seenT = this.time;
        }
      }
    }
  }

  private think(c: Creature, dt: number): void {
    const d = SPECIES[c.sp];
    const g = this.groups.get(c.group);
    if (!g) return;
    if (c.caught) {
      this.setMode(c, 'pris');
      c.goalSpeed = 0;
      if (this.rand() < 0.1) this.sound('cri_douleur', c.x, c.y, c.z, 2, c.id);
      return;
    }
    if (c.stagger > 0) {
      c.goalSpeed = 0;
      return;
    }
    c.fear = Math.max(0, c.fear - 0.05 * dt);
    c.anger = Math.max(0, c.anger - 0.03 * dt);
    switch (d.archetype) {
      case 'proie':
        this.thinkPrey(c, d, g);
        break;
      case 'defensif':
        this.thinkDefensive(c, d, g);
        break;
      case 'troupe':
        this.thinkTroop(c, d, g);
        break;
      case 'pachyderme':
        this.thinkElephant(c, d, g);
        break;
      case 'meute':
        this.thinkPack(c, d, g);
        break;
      case 'embuscade':
        this.thinkLeopard(c, d, g);
        break;
      case 'aquatique':
        this.thinkCroc(c, d, g);
        break;
      case 'charognard':
        this.thinkVulture(c, d, g);
        break;
      case 'abysse':
        this.thinkOmbre(c, d, g);
        break;
    }
    this.checkTraps(c, d);
  }

  /** Dirige la créature vers un cap en contournant les obstacles. */
  private steer(c: Creature, d: SpeciesDef, yaw: number, speed: number): void {
    if (speed <= 0.01) {
      c.goalSpeed = 0;
      return;
    }
    const look = Math.max(2, speed * 0.9) + d.halfLength * c.scale;
    for (const off of [0, 0.5, -0.5, 1, -1, 1.6, -1.6, 2.4, -2.4, Math.PI]) {
      const a = wrap(yaw + off);
      if (this.probe(c, d, a, look)) {
        c.goalYaw = a;
        c.goalSpeed = off === 0 ? speed : speed * 0.8;
        return;
      }
    }
    c.goalSpeed = 0;
  }

  private goTo(c: Creature, d: SpeciesDef, x: number, z: number, speed: number, stopAt = 0.5): void {
    const dd = dist2(c.x, c.z, x, z);
    if (dd <= stopAt) {
      c.goalSpeed = 0;
      return;
    }
    // Ralentit à l'approche : à pleine vitesse, le rayon de virage l'empêcherait d'arriver.
    this.steer(c, d, angleTo(c.x, c.z, x, z), Math.min(speed, Math.max(d.walk, (dd - stopAt) * 2.5)));
  }

  /** Distance (centre à joueur) où la créature s'arrête pour frapper. */
  private strikeRange(c: Creature, d: SpeciesDef): number {
    return d.halfLength * c.scale + (d.attack?.reach ?? 0.5) * 0.6;
  }

  private fleeFrom(c: Creature, d: SpeciesDef, x: number, z: number, speed: number): void {
    const away = angleTo(x, z, c.x, c.z) + (this.rand() - 0.5) * 0.6;
    this.steer(c, d, away, speed);
  }

  private face(c: Creature, x: number, z: number): void {
    c.goalYaw = angleTo(c.x, c.z, x, z);
    c.goalSpeed = 0;
  }

  /** Une menace proche : joueur repéré, prédateur, ou souvenir récent. */
  private threatFor(c: Creature, d: SpeciesDef): { x: number; z: number; d: number; player: boolean } | null {
    const p = this.player!;
    const wary = 1 + (this.traits[c.sp]?.wary ?? 0) + this.cell(this.cellIndex(c.x, c.z)).fear * 0.8;
    if (p.state !== 'mort' && this.time - c.seenT < 6 && c.alert > 0.45) {
      const dd = dist2(c.x, c.z, p.x, p.z);
      // Un joueur qui court fait fuir de plus loin ; accroupi, il passe pour moins menaçant.
      const speed = Math.hypot(p.vx, p.vz);
      const posture = speed > 4 ? 1.4 : p.crouched ? 0.6 : 1;
      if (dd < d.flee * wary * (1 + c.fear) * posture) return { x: p.x, z: p.z, d: dd, player: true };
    }
    for (const o of this.creatures.values()) {
      if (o.dead || o.group === c.group) continue;
      const od = SPECIES[o.sp];
      if (od.archetype !== 'meute' && od.archetype !== 'embuscade') continue;
      const dd = dist2(c.x, c.z, o.x, o.z);
      if (dd < (o.mode === 'chasse' || o.mode === 'attaque' ? 60 : 25)) return { x: o.x, z: o.z, d: dd, player: false };
    }
    if (c.fear > 0.5 && this.time - c.seenT < 10) return { x: c.seenX, z: c.seenZ, d: dist2(c.x, c.z, c.seenX, c.seenZ), player: true };
    return null;
  }

  private thinkPrey(c: Creature, d: SpeciesDef, g: Group): void {
    const threat = this.threatFor(c, d);
    const fire = this.fireNear(c.x, c.z, d.fearFire);
    if (c.mode === 'fuite') {
      const safe = !threat || threat.d > d.flee * 2.5;
      if (safe && this.time - c.modeT > 4) this.setMode(c, 'paitre');
      else if (threat) this.fleeFrom(c, d, threat.x, threat.z, d.run);
      else this.steer(c, d, c.yaw, d.run * 0.6);
      return;
    }
    if (threat) {
      if (threat.player && c.alert < 0.75 && threat.d > d.flee * 0.55 && this.time - c.lastHurt > 5) {
        this.setMode(c, 'alerte');
        this.face(c, threat.x, threat.z);
        return;
      }
      this.setMode(c, 'fuite');
      c.fear = Math.max(c.fear, 0.6);
      if (c.sp === 'impala') this.alarm(c, 'impala_alarme', 80);
      this.fleeFrom(c, d, threat.x, threat.z, d.run);
      return;
    }
    if (fire) {
      this.fleeFrom(c, d, fire.x, fire.z, d.walk);
      return;
    }
    // Brouter en restant avec la harde.
    if (c.mode === 'alerte' && this.time - c.modeT < 3) return;
    if (c.mode !== 'paitre' && c.mode !== 'errer') this.setMode(c, 'paitre');
    if (this.rand() < 0.04) this.setMode(c, c.mode === 'paitre' ? 'errer' : 'paitre');
    const dc = dist2(c.x, c.z, g.gx, g.gz);
    if (dc > 30) this.goTo(c, d, g.gx, g.gz, d.walk, 3);
    else if (c.mode === 'errer') this.goTo(c, d, g.gx + (this.rand() - 0.5) * 10, g.gz + (this.rand() - 0.5) * 10, d.walk * 0.5, 3);
    else c.goalSpeed = this.rand() < 0.3 ? d.walk * 0.3 : 0;
  }

  private thinkDefensive(c: Creature, d: SpeciesDef, g: Group): void {
    const p = this.player!;
    const pd = dist2(c.x, c.z, p.x, p.z);
    const provoked = this.time - c.hurtByPlayer < 8 || c.anger > 0.6;
    const cornered = c.blocked && pd < 4 && c.alert > 0.5;
    if (p.state === 'eveille' && (provoked || cornered) && c.hp > c.maxHp * 0.25) {
      this.setMode(c, 'charge');
      if (this.rand() < 0.2) this.sound('phaco_grogne', c.x, c.y, c.z, 2, c.id);
      this.goTo(c, d, p.x, p.z, d.run, this.strikeRange(c, d));
      if (pd < d.halfLength + d.attack!.reach + 0.5) this.startAttack(c, 'joueur');
      return;
    }
    if (c.mode === 'charge' && this.time - c.modeT > 1.5) {
      this.setMode(c, 'fuite');
      c.fear = 0.8;
    }
    this.thinkPrey(c, d, g);
  }

  private thinkTroop(c: Creature, d: SpeciesDef, g: Group): void {
    const p = this.player!;
    const pd = dist2(c.x, c.z, p.x, p.z);
    const male = c.scale >= 0.95;
    if (g.mode === 'attaque' && p.state === 'eveille') {
      if (male && c.hp > c.maxHp * 0.4) {
        this.setMode(c, 'attaque');
        this.goTo(c, d, p.x, p.z, d.run, this.strikeRange(c, d));
        if (pd < d.halfLength + d.attack!.reach + 0.5) this.startAttack(c, 'joueur');
      } else {
        this.setMode(c, 'fuite');
        this.fleeFrom(c, d, p.x, p.z, d.run);
      }
      return;
    }
    if (g.mode === 'menace' && p.state === 'eveille') {
      if (male) {
        // Fausse charge jusqu'à 5 m, puis recul, en aboyant.
        this.setMode(c, 'menace');
        if (pd > 6) this.goTo(c, d, p.x, p.z, d.run * 0.6, 5);
        else this.fleeFrom(c, d, p.x, p.z, d.walk * 2);
        if (this.rand() < 0.15) this.sound('babouin_aboie', c.x, c.y, c.z, 1.2, c.id);
      } else {
        this.setMode(c, 'fuite');
        this.fleeFrom(c, d, p.x, p.z, d.run * 0.7);
      }
      return;
    }
    if (g.mode === 'alerte') {
      this.setMode(c, 'alerte');
      this.face(c, p.x, p.z);
      return;
    }
    if (g.mode === 'vol' && g.target) {
      const food = this.env!.food.find((f) => f.id === g.target);
      if (!food) {
        g.mode = 'errer';
        return;
      }
      // Le plus proche va voler ; les autres suivent de loin.
      const thief = this.members(g).sort((a, b) => dist2(a.x, a.z, food.x, food.z) - dist2(b.x, b.z, food.x, food.z))[0];
      if (thief === c) {
        this.setMode(c, 'vol');
        this.goTo(c, d, food.x, food.z, d.run * 0.6, 0.8);
        if (dist2(c.x, c.z, food.x, food.z) < 1.2) {
          this.emit({ type: 'vol', prop: food.id, id: c.id });
          this.addSpot(g.food, food.x, food.z);
          g.mode = 'errer';
          g.gx = g.home.x;
          g.gz = g.home.z;
          this.sound('babouin_aboie', c.x, c.y, c.z, 2, c.id);
        }
      } else this.goTo(c, d, food.x, food.z, d.walk, 10);
      return;
    }
    this.setMode(c, this.rand() < 0.5 ? 'paitre' : 'errer');
    this.goTo(c, d, g.gx + (this.rand() - 0.5) * 12, g.gz + (this.rand() - 0.5) * 12, d.walk, 4);
  }

  private thinkElephant(c: Creature, d: SpeciesDef, g: Group): void {
    const p = this.player!;
    const pd = dist2(c.x, c.z, p.x, p.z);
    const leader = this.members(g)[0] === c;
    if (g.mode === 'charge' && p.state === 'eveille') {
      if (leader || this.time - c.hurtByPlayer < 30) {
        this.setMode(c, 'charge');
        if (this.time - c.modeT < 0.2) this.sound('elephant_barrit', c.x, c.y + 3, c.z, 3, c.id);
        this.steer(c, d, angleTo(c.x, c.z, p.x, p.z), d.run);
        if (pd < d.halfLength * c.scale + d.attack!.reach + 0.6) this.startAttack(c, 'joueur');
        if (this.time - c.modeT > 8) {
          g.mode = 'errer';
          c.anger = 0;
        }
      } else this.fleeFrom(c, d, p.x, p.z, d.walk * 2);
      return;
    }
    if (g.mode === 'menace' && p.state === 'eveille') {
      this.setMode(c, 'menace');
      if (leader) {
        // Fausse charge : quelques mètres vers le joueur, barrissement, puis arrêt.
        if (this.time - c.modeT < 1.6) this.steer(c, d, angleTo(c.x, c.z, p.x, p.z), d.run * 0.6);
        else this.face(c, p.x, p.z);
        this.sound('elephant_barrit', c.x, c.y + 3, c.z, 6, c.id);
      } else this.face(c, p.x, p.z);
      return;
    }
    if (g.mode === 'alerte') {
      this.setMode(c, 'alerte');
      this.face(c, p.x, p.z);
      if (this.rand() < 0.05) this.sound('elephant_gronde', c.x, c.y + 2, c.z, 8, c.id);
      return;
    }
    if (g.mode === 'paitre') {
      this.setMode(c, 'paitre');
      c.goalSpeed = this.rand() < 0.2 ? d.walk * 0.3 : 0;
      return;
    }
    this.setMode(c, 'errer');
    const center = this.centroid(this.members(g));
    const tx = leader ? g.gx : center.x + (g.gx - center.x) * 0.2;
    const tz = leader ? g.gz : center.z + (g.gz - center.z) * 0.2;
    this.goTo(c, d, tx + (leader ? 0 : (this.rand() - 0.5) * 8), tz + (leader ? 0 : (this.rand() - 0.5) * 8), d.walk, 2);
    this.pushThrough(c, d);
  }

  /** Un éléphant en marche renverse ce qui lui barre la route. */
  private pushThrough(c: Creature, d: SpeciesDef): void {
    if (c.goalSpeed <= 0.2 && !c.blocked) return;
    const r = d.halfLength * c.scale + 1;
    const piece = this.env!.pieceAt(c.x + Math.sin(c.yaw) * r, c.y + 1, c.z + Math.cos(c.yaw) * r, 1.2);
    if (piece) {
      this.emit({ type: 'piece', s: piece.s, p: piece.p, damage: 60 * Math.max(0.1, this.time - c.lastThink + 0.25), sp: c.sp });
      this.sound('coup', c.x, c.y + 1, c.z, 1.5, c.id + 'pousse');
    }
  }

  private thinkPack(c: Creature, d: SpeciesDef, g: Group): void {
    const p = this.player!;
    const pd = dist2(c.x, c.z, p.x, p.z);
    const fire = this.fireNear(c.x, c.z, d.fearFire);
    const playerFire = p.torch || !!this.fireNear(p.x, p.z, 5);
    if (c.hp < c.maxHp * 0.4 || g.mode === 'repli') {
      this.setMode(c, 'repli');
      this.fleeFrom(c, d, p.x, p.z, d.run * 0.8);
      if (pd > 60) this.goTo(c, d, g.home.x, g.home.z, d.walk, 10);
      return;
    }
    if (fire && p.state === 'eveille') {
      this.fleeFrom(c, d, fire.x, fire.z, d.walk * 2);
      return;
    }
    const list = this.members(g);
    const idx = list.indexOf(c);
    if (g.mode === 'encercle' || g.mode === 'attaque') {
      if (playerFire && p.state === 'eveille') {
        g.mode = 'rode';
        return;
      }
      // Places autour du joueur, plutôt dans son dos.
      const spread = (TAU * 0.75) / Math.max(1, list.length);
      const a = p.yaw + Math.PI + (idx - (list.length - 1) / 2) * spread;
      const ring = g.mode === 'attaque' ? 7 : 9;
      const attacker = list[g.passes % list.length] === c;
      if (g.mode === 'attaque' && attacker && c.cooldown <= 0) {
        this.setMode(c, 'attaque');
        this.goTo(c, d, p.x, p.z, d.run, this.strikeRange(c, d));
        if (pd < d.halfLength + d.attack!.reach + 0.5) this.startAttack(c, 'joueur');
        if (this.time - c.modeT > 6) g.passes++;
        return;
      }
      this.setMode(c, 'encercle');
      const tx = p.x + Math.sin(a) * ring;
      const tz = p.z + Math.cos(a) * ring;
      this.goTo(c, d, tx, tz, pd > 20 ? d.run * 0.8 : d.walk * 2.5, 1);
      if (c.goalSpeed === 0) this.face(c, p.x, p.z);
      if (this.rand() < 0.03) this.sound('hyene_rire', c.x, c.y, c.z, 4, g.id + 'rire');
      return;
    }
    if (g.mode === 'rode') {
      this.setMode(c, 'rode');
      // Suit à distance, à la limite de la vue : on l'entend plus qu'on ne la voit.
      const a = angleTo(p.x, p.z, c.x, c.z) + (idx - 1) * 0.4;
      const ring = playerFire ? 16 : 22;
      this.goTo(c, d, p.x + Math.sin(a) * ring, p.z + Math.cos(a) * ring, pd > 40 ? d.run * 0.6 : d.walk * 1.8, 2);
      if (c.goalSpeed === 0) this.face(c, p.x, p.z);
      if (pd < 30 && this.rand() < 0.05) this.sound('frolement', c.x, c.y, c.z, 3, c.id);
      return;
    }
    if (g.mode === 'manger' && g.target) {
      const k = this.env!.carcasses.find((x) => x.id === g.target);
      if (!k || k.meat <= 0) {
        g.mode = 'errer';
        g.hunger = 0;
        return;
      }
      if (dist2(c.x, c.z, k.x, k.z) > 2.2) {
        this.setMode(c, 'errer');
        this.goTo(c, d, k.x + (idx - 1) * 1.2, k.z + (idx % 2 ? 1 : -1), d.run * 0.5, 1.6);
      } else {
        this.setMode(c, 'manger');
        this.face(c, k.x, k.z);
        c.fed += this.time - c.lastThink + 0.25;
        if (c.fed > 30) {
          c.fed = 0;
          this.emit({ type: 'manger', carcass: k.id, amount: 1 });
          g.hunger = Math.max(0, g.hunger - 0.2);
        }
        // Défend la carcasse si le joueur s'approche.
        if (pd < 6 && p.state === 'eveille') {
          this.setMode(c, 'menace');
          this.face(c, p.x, p.z);
          if (pd < 3) this.startAttack(c, 'joueur');
          this.sound('hyene_rire', c.x, c.y, c.z, 3, g.id + 'rire');
        }
      }
      return;
    }
    if (g.mode === 'chasse' && g.target) {
      const prey = this.creatures.get(g.target);
      if (!prey || prey.dead) {
        g.mode = 'errer';
        return;
      }
      this.setMode(c, 'chasse');
      this.goTo(c, d, prey.x, prey.z, d.run, 0.5);
      if (dist2(c.x, c.z, prey.x, prey.z) < d.halfLength + SPECIES[prey.sp].halfLength + 0.8) this.startAttack(c, prey.id);
      return;
    }
    this.setMode(c, g.mode === 'repos' ? 'repos' : 'errer');
    const off = (idx - 1) * 3;
    this.goTo(c, d, g.gx + off, g.gz - off, d.walk, 4);
    this.gnaw(c, d);
  }

  /** Une hyène qui sent de la viande derrière une porte en bois la ronge. */
  private gnaw(c: Creature, d: SpeciesDef): void {
    if (!c.blocked) return;
    const r = d.halfLength + 0.6;
    const piece = this.env!.pieceAt(c.x + Math.sin(c.yaw) * r, c.y + 0.5, c.z + Math.cos(c.yaw) * r, 0.8);
    if (piece?.wood) this.emit({ type: 'piece', s: piece.s, p: piece.p, damage: 3, sp: c.sp });
  }

  private thinkLeopard(c: Creature, d: SpeciesDef, g: Group): void {
    const p = this.player!;
    const pd = dist2(c.x, c.z, p.x, p.z);
    const bold = this.traits.leopard?.bold ?? 0;
    const playerFire = p.torch || !!this.fireNear(p.x, p.z, 6);
    // Repéré et fixé du regard, ou blessé : il renonce pour un moment.
    if (c.stared > 1.5 || c.hp < c.maxHp * 0.65 || (this.time - c.hurtByPlayer < 30 && c.mode !== 'attaque')) {
      if (c.mode !== 'repli') this.sound('leopard_rale', c.x, c.y, c.z, 5, c.id);
      this.setMode(c, 'repli');
      c.spottedUntil = this.time + 120;
      c.stared = 0;
    }
    if (c.mode === 'repli') {
      if (pd > 70 || this.time - c.modeT > 25) this.setMode(c, 'errer');
      else this.fleeFrom(c, d, p.x, p.z, d.run * 0.5);
      return;
    }
    if (c.mode === 'attaque') {
      // Après l'attaque : continue si le joueur est à terre ; sinon repart après deux attaques.
      if (p.state === 'mort') {
        this.setMode(c, 'errer');
        return;
      }
      this.goTo(c, d, p.x, p.z, d.run, this.strikeRange(c, d));
      if (pd < d.halfLength + d.attack!.reach + 0.4) this.startAttack(c, 'joueur');
      if (p.state === 'eveille' && this.time - c.modeT > 4) this.setMode(c, 'repli');
      return;
    }
    const interested = p.state !== 'mort' && this.time - c.seenT < 20 && c.alert > 0.45 && this.time > c.spottedUntil && !playerFire;
    if (interested) {
      const looking = Math.abs(wrap(p.yaw - angleTo(p.x, p.z, c.x, c.z))) < 0.9;
      const seen = looking && this.lineOfSight(c, d, p);
      const crouchBonus = p.crouched ? 3 : 0;
      if (pd < 9 + crouchBonus + bold * 3 && !looking) {
        // Bond dans le dos, sans prévenir.
        this.setMode(c, 'attaque');
        this.steer(c, d, angleTo(c.x, c.z, p.x, p.z), d.run);
        return;
      }
      this.setMode(c, 'traque');
      if (seen && pd < 45) {
        // Le joueur regarde par ici : immobile, sans le quitter des yeux.
        this.face(c, p.x, p.z);
        return;
      }
      // Tourne autour du joueur pour passer dans son dos, en se rapprochant peu à peu.
      const around = angleTo(p.x, p.z, c.x, c.z);
      const behind = p.yaw + Math.PI;
      const a = around + clamp(wrap(behind - around), -0.6, 0.6);
      const ring = Math.max(6, pd - 4);
      this.goTo(c, d, p.x + Math.sin(a) * ring, p.z + Math.cos(a) * ring, pd > 40 ? d.walk * 2.5 : d.walk * 1.4, 1);
      if (pd < 25 && this.rand() < 0.04) this.sound('frolement', c.x, c.y, c.z, 4, c.id);
      return;
    }
    // Patrouille : ses postes habituels (là où il a vu le joueur), ou son territoire.
    if (c.mode !== 'errer' && c.mode !== 'repos') this.setMode(c, 'errer');
    if (dist2(c.x, c.z, g.gx, g.gz) < 6 || this.rand() < 0.005) {
      const spot = g.habits.length && this.rand() < 0.6 ? this.pick(g.habits.map((h) => [h, h.w] as [Spot, number])) : null;
      const a = this.rand() * TAU;
      g.gx = spot ? spot.x + (this.rand() - 0.5) * 30 : g.home.x + Math.cos(a) * g.home.r * 0.5 * this.rand();
      g.gz = spot ? spot.z + (this.rand() - 0.5) * 30 : g.home.z + Math.sin(a) * g.home.r * 0.5 * this.rand();
      this.setMode(c, this.rand() < 0.3 ? 'repos' : 'errer');
    }
    if (c.mode === 'repos') c.goalSpeed = 0;
    else this.goTo(c, d, g.gx, g.gz, d.walk, 3);
  }

  private depthAt(x: number, z: number): number {
    return WATER_LEVEL - this.terrain.heightAt(x, z);
  }

  private thinkCroc(c: Creature, d: SpeciesDef, g: Group): void {
    const p = this.player!;
    const pd = dist2(c.x, c.z, p.x, p.z);
    const depth = this.depthAt(c.x, c.z);
    if (this.grab?.id === c.id) {
      this.setMode(c, 'saisit');
      return;
    }
    if (c.hp < c.maxHp * 0.5 || c.mode === 'repli') {
      if (c.mode !== 'repli') this.setMode(c, 'repli');
      if (this.time - c.modeT > 20 && c.hp >= c.maxHp * 0.5) this.setMode(c, 'guet');
      // Vers l'eau plus profonde.
      this.seekDepth(c, d, 3, d.swim);
      return;
    }
    const inWaterPlayer = p.waterDepth > 0.3 || this.depthAt(p.x + 1.5, p.z) > 0.3 || this.depthAt(p.x - 1.5, p.z) > 0.3 || this.depthAt(p.x, p.z + 1.5) > 0.3 || this.depthAt(p.x, p.z - 1.5) > 0.3;
    if (p.state !== 'mort' && c.alert > 0.5 && pd < 40 && inWaterPlayer && c.cooldown <= 0) {
      if (pd < 4) {
        this.setMode(c, 'attaque');
        this.steer(c, d, angleTo(c.x, c.z, p.x, p.z), d.run * 3);
        if (pd < d.halfLength + d.attack!.reach + 0.6) this.startAttack(c, 'joueur');
      } else {
        this.setMode(c, 'traque');
        this.goTo(c, d, p.x, p.z, depth > 0.6 ? d.swim * 0.5 : d.walk, 2);
      }
      return;
    }
    // À l'affût près de la rive.
    this.setMode(c, 'guet');
    if (depth < 0.5) this.seekDepth(c, d, 1, d.walk);
    else if (dist2(c.x, c.z, g.gx, g.gz) > 30 && this.rand() < 0.05) this.goTo(c, d, g.gx, g.gz, d.swim * 0.3, 4);
    else c.goalSpeed = 0;
  }

  /** Se dirige vers une eau d'au moins cette profondeur. */
  private seekDepth(c: Creature, d: SpeciesDef, want: number, speed: number): void {
    let best = -1;
    let bestA = c.yaw;
    for (let k = 0; k < 8; k++) {
      const a = (k / 8) * TAU;
      const dep = this.depthAt(c.x + Math.sin(a) * 6, c.z + Math.cos(a) * 6);
      if (dep > best) {
        best = dep;
        bestA = a;
      }
    }
    if (this.depthAt(c.x, c.z) >= want) c.goalSpeed = 0;
    else this.steer(c, d, bestA, speed);
  }

  private thinkVulture(c: Creature, _d: SpeciesDef, g: Group): void {
    const p = this.player!;
    const k = this.env!.carcasses.find((x) => x.id === g.target);
    if (!k || k.meat <= 0) {
      // Repartent en tournoyant puis disparaissent.
      this.setMode(c, 'cercle');
      c.goalY = this.terrain.heightAt(c.x, c.z) + 80;
      c.goalSpeed = 10;
      c.goalYaw = wrap(c.yaw + 0.3);
      if (c.y > this.terrain.heightAt(c.x, c.z) + 70) {
        c.dead = true;
        c.lastHurt = this.time - 10;
      }
      return;
    }
    const pd = dist2(k.x, k.z, p.x, p.z);
    const landed = this.time - c.modeT > 60 && c.mode === 'cercle' && pd > 15;
    if (c.mode === 'manger' && pd < 12) this.setMode(c, 'cercle');
    if (landed) this.setMode(c, 'manger');
    if (c.mode === 'manger') {
      c.goalY = null;
      this.goTo(c, SPECIES.vautour, k.x + Math.sin(c.yaw) * 1.5, k.z + Math.cos(c.yaw) * 1.5, 1, 0.8);
      c.fed += this.time - c.lastThink + 0.25;
      if (c.fed > 40) {
        c.fed = 0;
        this.emit({ type: 'manger', carcass: k.id, amount: 1 });
      }
      return;
    }
    this.setMode(c, 'cercle');
    // Cercle de 18 m au-dessus de la carcasse : visible de loin (les hyènes aussi le voient).
    const a = angleTo(k.x, k.z, c.x, c.z) + 0.25;
    c.goalY = this.terrain.heightAt(k.x, k.z) + 35 + (Number(c.id.slice(1)) % 5) * 4;
    c.goalYaw = angleTo(c.x, c.z, k.x + Math.sin(a) * 18, k.z + Math.cos(a) * 18);
    c.goalSpeed = 9;
  }

  // ——— Créature du lac ———

  private ombreGroup(): Group | null {
    for (const g of this.groups.values()) if (g.sp === 'ombre') return g;
    return null;
  }

  /** L'attention de la créature monte quand le joueur nage dans ses eaux profondes. */
  private stepOmbreAttention(dt: number, p: FaunaPlayer): void {
    const g = this.ombreGroup();
    if (!g) return;
    const inDomain = p.state !== 'mort' && (p.swimming || p.underwater) && inLakeDomain(this.terrain, p.x, p.z, 5);
    if (inDomain) {
      const fast = Math.hypot(p.vx, p.vz) > 1.4;
      g.attention = Math.min(1, g.attention + dt * ((fast ? 0.035 : 0.012) + (p.bleeding > 0.05 ? 0.05 : 0) + (p.underwater ? 0.01 : 0)) * (1 + (this.traits.ombre?.bold ?? 0)));
    } else g.attention = Math.max(0, g.attention - dt * 0.01);
    if (g.returnAt > this.time) return;
    if (!g.members.length && inDomain && g.attention > 0.25 && g.abstract) {
      // Elle remonte des profondeurs, à distance, hors de la vue.
      const a = this.rand() * TAU;
      let sx = p.x + Math.cos(a) * 90;
      let sz = p.z + Math.sin(a) * 90;
      for (let k = 0; k < 8 && !inLakeDomain(this.terrain, sx, sz, 6); k++) {
        const b = a + (k + 1) * 0.8;
        sx = p.x + Math.cos(b) * 90;
        sz = p.z + Math.sin(b) * 90;
      }
      if (!inLakeDomain(this.terrain, sx, sz, 5)) return;
      g.abstract.x = sx;
      g.abstract.z = sz;
      this.materialize(g);
      const c = this.creatures.get(g.members[0]!);
      if (c) {
        c.y = this.terrain.heightAt(c.x, c.z) + 2;
        this.setMode(c, 'cercle');
        g.passes = 0;
      }
    } else if (g.members.length && !inDomain && g.attention < 0.1) {
      this.dematerialize(g);
      if (g.abstract) {
        g.abstract.x = g.home.x;
        g.abstract.z = g.home.z;
      }
    }
  }

  private thinkOmbre(c: Creature, d: SpeciesDef, g: Group): void {
    const p = this.player!;
    const pd = dist2(c.x, c.z, p.x, p.z);
    const bottom = this.terrain.heightAt(c.x, c.z);
    const wary = this.traits.ombre?.wary ?? 0;
    if (this.grab?.id === c.id) {
      this.setMode(c, 'saisit');
      return;
    }
    if (c.mode === 'repli') {
      c.goalY = bottom + 1;
      this.steer(c, d, angleTo(p.x, p.z, c.x, c.z), d.run);
      if (pd > 80 || this.time - c.modeT > 12) {
        this.emit({ type: 'disparait', id: c.id, sp: c.sp });
        g.returnAt = this.time + OMBRE_RETURN;
        g.attention = 0;
        this.dematerialize(g);
        if (g.abstract) {
          g.abstract.x = g.home.x;
          g.abstract.z = g.home.z;
          g.abstract.hp = [d.hp * c.scale];
        }
      }
      return;
    }
    const inDomain = (p.swimming || p.underwater) && inLakeDomain(this.terrain, p.x, p.z, 3.5);
    if (!inDomain || p.state === 'mort') {
      // Elle attend à la limite des eaux profondes : une ombre sous la surface.
      this.setMode(c, 'cercle');
      c.goalY = Math.max(bottom + 1, WATER_LEVEL - 4);
      this.goTo(c, d, c.x + Math.sin(c.yaw) * 10, c.z + Math.cos(c.yaw) * 10, d.walk * 0.5, 1);
      return;
    }
    if (this.rand() < 0.03) this.sound('ombre_gronde', c.x, c.y, c.z, 7, 'ombre');
    if (c.mode === 'attaque') {
      // Monte droit sur le joueur, par en dessous, en ralentissant au dernier moment.
      c.goalY = p.y - 0.5;
      const d3 = Math.hypot(pd, c.y - p.y);
      this.steer(c, d, angleTo(c.x, c.z, p.x, p.z), Math.min(d.run, 1.5 + d3 * 1.2));
      if (d3 < d.halfLength * c.scale + 1.6) this.startAttack(c, 'joueur');
      if (this.time - c.modeT > 10) this.setMode(c, 'cercle');
      return;
    }
    // Tourne autour, de plus en plus près, puis passe dessous.
    this.setMode(c, g.attention > 0.55 ? 'traque' : 'cercle');
    const ring = clamp(32 - g.attention * 22 + wary * 10, 7, 34);
    const a = angleTo(p.x, p.z, c.x, c.z) + 0.35;
    const tx = p.x + Math.sin(a) * ring;
    const tz = p.z + Math.cos(a) * ring;
    c.goalY = Math.max(bottom + 1.2, Math.min(p.y - 5 - (1 - g.attention) * 6, WATER_LEVEL - 3));
    this.goTo(c, d, tx, tz, d.walk + g.attention * 2, 0.5);
    if (pd < ring + 2 && this.rand() < 0.02) g.passes++;
    const ready = g.attention > 0.85 + wary * 0.1 || (g.passes >= 3 + Math.round(wary * 2) && g.attention > 0.6);
    if (ready && c.cooldown <= 0) {
      this.setMode(c, 'attaque');
      g.passes = 0;
    }
  }

  // ——— Attaques ———

  private startAttack(c: Creature, target: string): void {
    const d = SPECIES[c.sp];
    if (!d.attack || c.cooldown > 0 || c.windup > 0 || c.stagger > 0) return;
    c.windup = d.attack.windup;
    c.target = target;
  }

  /** Préparation de l'attaque puis coup (chaque pas). */
  private act(c: Creature, dt: number): void {
    if (c.cooldown > 0) c.cooldown = Math.max(0, c.cooldown - dt);
    if (c.stagger > 0) {
      c.stagger = Math.max(0, c.stagger - dt);
      c.windup = 0;
      return;
    }
    if (c.windup <= 0) return;
    c.windup -= dt;
    if (c.target === 'joueur' && this.player) {
      // Pendant la préparation : face au joueur, sans le dépasser.
      const p = this.player;
      c.goalYaw = angleTo(c.x, c.z, p.x, p.z);
      if (dist2(c.x, c.z, p.x, p.z) <= this.strikeRange(c, SPECIES[c.sp]) + 0.3) c.goalSpeed = 0;
    }
    if (c.windup > 0) return;
    c.windup = 0;
    const d = SPECIES[c.sp];
    const atk = d.attack!;
    c.cooldown = atk.cooldown;
    const p = this.player!;
    if (c.target === 'joueur') {
      if (p.state === 'mort' || this.grab) return;
      const reach = d.halfLength * c.scale + atk.reach + 0.45;
      const dx = p.x - c.x;
      const dz = p.z - c.z;
      const horiz = Math.hypot(dx, dz);
      const dy = p.y - c.y;
      const facing = Math.abs(wrap(angleTo(c.x, c.z, p.x, p.z) - c.yaw)) < 1.1;
      const vertOk = d.archetype === 'abysse' ? Math.abs(dy) < 3 : dy > -1.5 && dy < 2.2;
      if (horiz <= reach && facing && vertOk) {
        const behind = Math.abs(wrap(p.yaw - angleTo(p.x, p.z, c.x, c.z))) > 2;
        this.emit({ type: 'attaque', id: c.id, sp: c.sp, behind, downed: p.state !== 'eveille' });
        this.sound(c.sp === 'elephant' ? 'coup' : 'morsure', p.x, p.y + 1, p.z, 0.2, c.id + 'atk');
        this.traits[c.sp]!.bold = Math.min(1, this.traits[c.sp]!.bold + 0.03);
        if (atk.grab && !this.grab && (d.archetype === 'abysse' || p.waterDepth > 0.3 || this.depthAt(c.x, c.z) > 0.4)) {
          this.grab = { id: c.id, t: 0, struggle: 0, hits: 0 };
          this.setMode(c, 'saisit');
          this.emit({ type: 'saisie', id: c.id, sp: c.sp });
        }
        // Frapper puis s'éloigner (hyènes), recul après la charge (éléphant).
        const g = this.groups.get(c.group);
        if (g && c.sp === 'hyene') g.passes++;
      }
      return;
    }
    // Créature contre créature (chasse).
    const prey = c.target ? this.creatures.get(c.target) : undefined;
    if (!prey || prey.dead) return;
    const reach = d.halfLength * c.scale + SPECIES[prey.sp].halfLength * prey.scale + atk.reach + 0.4;
    if (dist2(c.x, c.z, prey.x, prey.z) <= reach) {
      this.hurt(prey.id, atk.damage * 1.2, 'arriere', { bleed: true, by: 'creature', x: c.x, z: c.z });
      this.sound('morsure', prey.x, prey.y + 0.5, prey.z, 0.3, c.id + 'atk');
    }
  }

  /** Point où le joueur est tenu (gueule de la créature), ou null. */
  grabPoint(): { x: number; y: number; z: number } | null {
    if (!this.grab) return null;
    const c = this.creatures.get(this.grab.id);
    if (!c) return null;
    const d = SPECIES[c.sp];
    const r = d.halfLength * c.scale + 0.4;
    return { x: c.x + Math.sin(c.yaw) * r, y: c.y + (d.archetype === 'abysse' ? 0 : -0.6), z: c.z + Math.cos(c.yaw) * r };
  }

  /** Le joueur se débat (E) : la créature finit par lâcher. */
  struggle(): void {
    if (!this.grab) return;
    const c = this.creatures.get(this.grab.id);
    this.grab.struggle += c?.sp === 'ombre' ? 0.1 : 0.14;
    if (this.grab.struggle >= 1) this.release('debattu');
  }

  release(reason: 'temps' | 'coups' | 'debattu' | 'blessee' | 'mort'): void {
    const gr = this.grab;
    if (!gr) return;
    this.grab = null;
    const c = this.creatures.get(gr.id);
    if (!c) return;
    this.emit({ type: 'lache', id: c.id, sp: c.sp, reason });
    c.cooldown = SPECIES[c.sp].attack!.cooldown + 4;
    if (c.sp === 'ombre') {
      this.setMode(c, reason === 'temps' ? 'cercle' : 'repli');
      if (reason !== 'temps') this.traits.ombre!.wary = Math.min(1, this.traits.ombre!.wary + 0.25);
    } else this.setMode(c, 'repli');
  }

  private stepGrab(dt: number): void {
    const gr = this.grab;
    if (!gr) return;
    const c = this.creatures.get(gr.id);
    const p = this.player!;
    if (!c || c.dead) {
      this.release('mort');
      return;
    }
    gr.t += dt;
    const d = SPECIES[c.sp];
    if (c.sp === 'crocodile') {
      // Entraîne vers l'eau plus profonde et roule.
      this.seekDepth(c, d, 2.2, 1.5);
      if (this.rand() < dt * 0.8) this.sound('eclaboussure', c.x, WATER_LEVEL, c.z, 0.5, c.id + 'roule');
      if (gr.t > 8) this.release('temps');
    } else {
      // Tire vers le fond.
      const bottom = this.terrain.heightAt(c.x, c.z);
      c.goalY = Math.max(bottom + 0.8, c.y - 2.2 * dt * 30);
      c.goalSpeed = 0.6;
      if (gr.t > 7) this.release('temps');
    }
    if (p.state === 'mort') {
      if (c.sp === 'ombre') {
        // Elle s'est nourrie : elle grandit et s'enhardit.
        c.scale = Math.min(1.6, c.scale + 0.1);
        this.traits.ombre!.bold = Math.min(1, this.traits.ombre!.bold + 0.3);
      }
      this.release('temps');
    }
  }

  /** Un coup touche la créature tenant le joueur : elle peut lâcher. */
  private onGrabHit(c: Creature, part: BodyPart): void {
    if (this.grab?.id !== c.id) return;
    this.grab.hits++;
    const chance = (part === 'tete' ? 0.7 : 0.35) + this.grab.hits * 0.1;
    if (this.rand() < chance) this.release('coups');
  }

  // ——— Blessures et mort ———

  /** Inflige des dégâts à une créature. Renvoie la partie touchée et si elle meurt. */
  hurt(id: string, amount: number, part: BodyPart, o: { bleed: boolean; by: 'joueur' | 'creature' | 'piege' | 'chute'; x: number; z: number }): { killed: boolean } | null {
    const c = this.creatures.get(id);
    if (!c || c.dead) return null;
    const d = SPECIES[c.sp];
    const mul = { tete: 2, cou: 1.6, corps: 1, arriere: 0.8, pattes: 0.6 }[part];
    const dmg = amount * mul;
    c.hp -= dmg;
    c.lastHurt = this.time;
    c.stagger = Math.min(0.8, 0.2 + dmg / Math.max(20, d.hp) * 2);
    c.alert = 1;
    if (part === 'pattes') c.limp = Math.min(1, c.limp + (dmg / d.hp) * 3);
    if (o.bleed) c.bleed = Math.min(d.hp * 0.03, c.bleed + dmg * 0.012);
    if (o.by === 'joueur') {
      c.hurtByPlayer = this.time;
      c.seenX = o.x;
      c.seenZ = o.z;
      c.seenT = this.time;
      c.anger = Math.min(1, c.anger + 0.5);
      c.fear = Math.min(1, c.fear + 0.4);
      // Le léopard se souvient d'un joueur dangereux ; la meute perd courage.
      const g = this.groups.get(c.group);
      if (g) {
        g.morale = Math.max(0, g.morale - (c.hp < c.maxHp * 0.5 ? 0.3 : 0.12));
        if (c.sp === 'babouin') g.mode = 'attaque';
        for (const m of this.members(g)) {
          m.alert = 1;
          m.seenX = o.x;
          m.seenZ = o.z;
          m.seenT = this.time;
          if (SPECIES[m.sp].archetype === 'proie') m.fear = 1;
        }
      }
      this.traits[c.sp]!.bold = Math.max(-1, this.traits[c.sp]!.bold - 0.05);
      this.onGrabHit(c, part);
    }
    if (dmg > 6) this.sound('cri_douleur', c.x, c.y + d.height * 0.5, c.z, 0.5, c.id + 'cri');
    if (c.hp <= 0) {
      this.kill(c, o.by);
      return { killed: true };
    }
    return { killed: false };
  }

  private kill(c: Creature, by: string): void {
    const d = SPECIES[c.sp];
    if (d.archetype === 'abysse') {
      // Elle ne meurt pas : blessée, elle replonge et disparaît.
      c.hp = 1;
      if (this.grab?.id === c.id) this.release('blessee');
      this.setMode(c, 'repli');
      this.traits.ombre!.wary = Math.min(1, this.traits.ombre!.wary + 0.4);
      return;
    }
    c.dead = true;
    c.hp = 0;
    c.lastHurt = this.time;
    if (this.grab?.id === c.id) this.release('mort');
    this.emit({ type: 'mort', id: c.id, sp: c.sp, x: c.x, y: c.y, z: c.z, yaw: c.yaw, scale: c.scale });
    const g = this.groups.get(c.group);
    if (by === 'joueur' || by === 'piege') {
      // Pression de chasse : la zone devient méfiante, l'espèce aussi.
      const cell = this.cell(this.cellIndex(c.x, c.z));
      cell.fear = Math.min(1, cell.fear + 0.25);
      this.traits[c.sp]!.wary = Math.min(1, this.traits[c.sp]!.wary + 0.08);
    }
    if (g) {
      g.morale = Math.max(0, g.morale - 0.35);
      if (g.key && g.sp === 'leopard') g.returnAt = this.time + LEOPARD_RETURN;
    }
  }

  /** Créature visée par un rayon (coup de mêlée) : la plus proche, avec la partie touchée. */
  rayHit(o: { x: number; y: number; z: number }, dir: { x: number; y: number; z: number }, maxT: number): { id: string; t: number; part: BodyPart; x: number; y: number; z: number } | null {
    let best: { id: string; t: number; part: BodyPart; x: number; y: number; z: number } | null = null;
    for (const c of this.creatures.values()) {
      if (c.dead) continue;
      if (dist2(c.x, c.z, o.x, o.z) > maxT + 6 * c.scale + 3) continue;
      const seg = bodySegment(c.sp, c.x, c.y, c.z, c.yaw, c.scale);
      const t = rayCapsule(o, dir, { x: seg.ax, y: seg.ay, z: seg.az }, { x: seg.bx, y: seg.by, z: seg.bz }, seg.r + 0.12, maxT);
      if (t === null || (best && t >= best.t)) continue;
      const hx = o.x + dir.x * t;
      const hy = o.y + dir.y * t;
      const hz = o.z + dir.z * t;
      best = { id: c.id, t, part: partAt(c.sp, c.x, c.y, c.z, c.yaw, hx, hy, hz, c.scale), x: hx, y: hy, z: hz };
    }
    return best;
  }

  /** Objet en mouvement (segment p → q, rayon r) qui touche une créature. */
  sweepHit(p: { x: number; y: number; z: number }, q: { x: number; y: number; z: number }, r: number): { id: string; part: BodyPart } | null {
    for (const c of this.creatures.values()) {
      if (c.dead) continue;
      if (dist2(c.x, c.z, p.x, p.z) > 8 * c.scale + Math.hypot(q.x - p.x, q.z - p.z) + 2) continue;
      const seg = bodySegment(c.sp, c.x, c.y, c.z, c.yaw, c.scale);
      const a = { x: seg.ax, y: seg.ay, z: seg.az };
      const b = { x: seg.bx, y: seg.by, z: seg.bz };
      const hit = segmentSegmentDistance(p, q, a, b);
      if (hit.d <= seg.r + r) {
        const hx = p.x + (q.x - p.x) * hit.t;
        const hy = p.y + (q.y - p.y) * hit.t;
        const hz = p.z + (q.z - p.z) * hit.t;
        return { id: c.id, part: partAt(c.sp, c.x, c.y, c.z, c.yaw, hx, hy, hz, c.scale) };
      }
    }
    return null;
  }

  /** Distance horizontale entre le joueur et le corps de la créature la plus proche (collisions). */
  nearestBody(x: number, y: number, z: number): { id: string; d: number } | null {
    let best: { id: string; d: number } | null = null;
    for (const c of this.creatures.values()) {
      if (c.dead || SPECIES[c.sp].archetype === 'charognard') continue;
      const seg = bodySegment(c.sp, c.x, c.y, c.z, c.yaw, c.scale);
      const d = pointSegmentDistance(x, y, z, { x: seg.ax, y: seg.ay, z: seg.az }, { x: seg.bx, y: seg.by, z: seg.bz }) - seg.r;
      if (!best || d < best.d) best = { id: c.id, d };
    }
    return best;
  }

  /** Pièges armés franchis par la créature. */
  private checkTraps(c: Creature, d: SpeciesDef): void {
    if (c.caught || d.archetype === 'charognard' || d.archetype === 'abysse') return;
    for (const t of this.env!.traps) {
      if (!t.armed) continue;
      const r = t.kind === 'fosse' ? 1.1 : 0.7;
      if (dist2(c.x, c.z, t.x, t.z) < r + d.radius * c.scale * 0.5) {
        this.emit({ type: 'piege', trap: t.id, id: c.id, sp: c.sp });
        t.armed = false;
        return;
      }
    }
  }

  /** Retient une créature dans un piège (collet, fosse) ou la libère. */
  setCaught(id: string, trap: string | null): void {
    const c = this.creatures.get(id);
    if (!c) return;
    c.caught = trap;
    c.speed = 0;
    if (trap) {
      this.setMode(c, 'pris');
      this.sound('piege', c.x, c.y, c.z, 0.5, c.id + 'piege');
    } else this.setMode(c, 'fuite');
  }

  /** Une créature prise se débat : chance de casser le piège (s'appelle chaque seconde). */
  struggleFree(id: string, strength: number): boolean {
    const c = this.creatures.get(id);
    if (!c || !c.caught) return false;
    const d = SPECIES[c.sp];
    const chance = strength * (d.mass / 400) * (c.hp / c.maxHp);
    if (this.rand() < chance) {
      this.setCaught(id, null);
      c.fear = 1;
      return true;
    }
    return false;
  }

  /** Les vautours arrivent au-dessus d'une carcasse (si le joueur est assez près pour les voir). */
  vulturesFor(carcass: string, x: number, z: number): void {
    for (const g of this.groups.values()) if (g.sp === 'vautour' && g.target === carcass) return;
    const g = this.makeGroup('vautour', null, x, z, 50, -1);
    g.target = carcass;
    this.groups.set(g.id, g);
    const n = 3 + Math.floor(this.rand() * 4);
    for (let k = 0; k < n; k++) {
      const a = (k / n) * TAU;
      const c = this.newCreature('vautour', g, x + Math.cos(a) * 30, z + Math.sin(a) * 30, SPECIES.vautour.hp, 1);
      c.y = this.terrain.heightAt(x, z) + 60;
      c.goalY = c.y;
      c.speed = 8;
      this.setMode(c, 'cercle');
    }
    this.sound('vautours', x, this.terrain.heightAt(x, z) + 40, z, 30, 'vautours');
    // Les hyènes voient les vautours tourner et viennent.
    for (const h of this.groups.values()) {
      if (h.sp !== 'hyene') continue;
      const hx = h.abstract ? h.abstract.x : h.home.x;
      const hz = h.abstract ? h.abstract.z : h.home.z;
      if (dist2(hx, hz, x, z) < 1800 && h.abstract) {
        h.abstract.x = x + (hx - x) * 0.15;
        h.abstract.z = z + (hz - z) * 0.15;
      }
    }
  }

  // ——— Déplacements ———

  /** Test rapide (hauteur déjà connue, sans pente) : bords du monde, profondeur d'eau. */
  private passableAt(d: SpeciesDef, x: number, z: number, h: number): boolean {
    if (Math.abs(x) > WORLD_HALF - 300 || Math.abs(z) > WORLD_HALF - 300) return false;
    const depth = WATER_LEVEL - h;
    if (d.minDepth > 0 && depth < d.minDepth) return false;
    return depth <= d.maxWade;
  }

  /** Hauteur où se tient la créature (sol, nage en surface, crocodile à fleur d'eau). */
  private surfaceAt(c: Creature, d: SpeciesDef): number {
    const depth = WATER_LEVEL - c.groundY;
    if (c.sp === 'crocodile' && depth > 0.6) return WATER_LEVEL - 0.35;
    if (depth > d.height * 0.85 * c.scale) return WATER_LEVEL - d.height * 0.7 * c.scale;
    return c.groundY;
  }

  private passable(d: SpeciesDef, x: number, z: number): boolean {
    if (Math.abs(x) > WORLD_HALF - 300 || Math.abs(z) > WORLD_HALF - 300) return false;
    const h = this.terrain.heightAt(x, z);
    const depth = WATER_LEVEL - h;
    if (d.minDepth > 0 && depth < d.minDepth) return false;
    if (depth > d.maxWade) return false;
    if (d.slope > 0 && depth <= 0.3 && this.terrain.normalY(x, z) < d.slope) return false;
    return true;
  }

  /** Le chemin est-il libre dans cette direction sur cette longueur ? */
  private probe(c: Creature, d: SpeciesDef, yaw: number, len: number): boolean {
    const sx = Math.sin(yaw);
    const sz = Math.cos(yaw);
    for (const t of [0.35, 0.7, 1]) if (!this.passable(d, c.x + sx * len * t, c.z + sz * len * t)) return false;
    const env = this.env!;
    if (d.archetype !== 'abysse' && d.archetype !== 'charognard' && env.physicsAt(c.x, c.z)) {
      const y = c.y + Math.max(0.35, d.height * c.scale * 0.45);
      const hit = (env.moveRay ?? env.ray)(c.x, y, c.z, sx, 0, sz, len);
      if (hit !== null && hit < len) return false;
    }
    if (d.archetype !== 'pachyderme' && d.archetype !== 'abysse' && d.archetype !== 'charognard') {
      // Les clôtures d'épines et les murs arrêtent les autres animaux.
      if (env.pieceAt(c.x + sx * len * 0.6, c.y + 0.5, c.z + sz * len * 0.6, Math.max(0.5, d.radius))) return false;
    }
    return true;
  }

  private surfaceY(sp: SpeciesId, x: number, z: number, c: Creature | null): number {
    const d = SPECIES[sp];
    const ground = this.env && this.env.physicsAt(x, z) ? this.env.ground(x, z) : this.terrain.heightAt(x, z);
    const depth = WATER_LEVEL - ground;
    if (d.archetype === 'abysse') return c ? c.y : ground + 2;
    if (d.archetype === 'charognard') return c ? c.y : ground;
    if (sp === 'crocodile' && depth > 0.6) return WATER_LEVEL - 0.35;
    if (depth > d.height * 0.85 * (c?.scale ?? 1)) return WATER_LEVEL - d.height * 0.7 * (c?.scale ?? 1);
    return ground;
  }

  private move(c: Creature, dt: number): void {
    const d = SPECIES[c.sp];
    if (c.caught || c.dead) {
      c.speed = 0;
      return;
    }
    const grabbed = this.grab?.id === c.id;
    const diff = wrap(c.goalYaw - c.yaw);
    const lunging = c.mode === 'attaque' || c.mode === 'charge' || c.windup > 0;
    const maxTurn = d.turn * dt * (lunging ? 1.8 : c.speed > d.run * 0.7 ? 0.6 : 1);
    c.yaw = wrap(c.yaw + clamp(diff, -maxTurn, maxTurn));
    let cap = c.goalSpeed;
    cap *= 1 - c.limp * 0.5;
    if (c.hp < c.maxHp * 0.3) cap *= 0.7;
    if (c.stagger > 0) cap = 0;
    if (c.windup > 0 && !grabbed) cap = Math.min(cap, d.run);
    const depth = WATER_LEVEL - c.groundY;
    if (c.sp !== 'crocodile' && d.archetype !== 'abysse' && d.archetype !== 'charognard' && depth > d.height * 0.85) cap = Math.min(cap, d.swim);
    c.speed += clamp(cap - c.speed, -d.accel * 1.5 * dt, d.accel * dt);
    if (c.speed < 0.02 && cap === 0) c.speed = 0;
    if (c.speed > 0) {
      const nx = c.x + Math.sin(c.yaw) * c.speed * dt;
      const nz = c.z + Math.cos(c.yaw) * c.speed * dt;
      // Une seule hauteur de terrain par pas (la pente est vérifiée par les sondes, à la décision).
      const h = this.terrain.heightAt(nx, nz);
      if (this.passableAt(d, nx, nz, h)) {
        c.x = nx;
        c.z = nz;
        c.groundY = h;
        c.blocked = false;
      } else {
        c.speed = 0;
        c.blocked = true;
      }
    }
    // Les membres d'un groupe ne se chevauchent pas (vérifié 10 fois par seconde).
    const g = this.groups.get(c.group);
    if (g && g.members.length > 1 && d.archetype !== 'charognard' && (this.tickCount + Number(c.id.slice(1))) % 6 === 0) {
      for (const id of g.members) {
        if (id === c.id) continue;
        const o = this.creatures.get(id);
        if (!o || o.dead) continue;
        const min = (d.radius * c.scale + d.radius * o.scale) * 1.6;
        const dd = dist2(c.x, c.z, o.x, o.z);
        if (dd > 0.01 && dd < min) {
          const push = ((min - dd) / dd) * 0.5 * Math.min(1, dt * 48);
          const px = (c.x - o.x) * push;
          const pz = (c.z - o.z) * push;
          const h = this.terrain.heightAt(c.x + px, c.z + pz);
          if (this.passableAt(d, c.x + px, c.z + pz, h)) {
            c.x += px;
            c.z += pz;
            c.groundY = h;
          }
        }
      }
    }
    if (c.goalY !== null && (d.archetype === 'abysse' || d.archetype === 'charognard')) {
      const vy = clamp(c.goalY - c.y, -3 * dt, 3 * dt);
      c.y += vy;
      if (d.archetype === 'abysse') c.y = clamp(c.y, c.groundY + 0.6, WATER_LEVEL - 1.2);
    } else if (d.archetype === 'charognard') {
      c.y = c.groundY;
    } else {
      const target = this.surfaceAt(c, d);
      c.y += clamp(target - c.y, -6 * dt, 6 * dt);
      if (Math.abs(target - c.y) > 2) c.y = target;
    }
    if (d.archetype === 'pachyderme' && c.speed > 2.5 && this.rand() < dt * 1.5) this.sound('pas_lourd', c.x, c.y, c.z, 0.4, c.id + 'pas');
  }

  // ——— Affichage et diagnostic ———

  views(): CreatureView[] {
    const out: CreatureView[] = [];
    for (const c of this.creatures.values()) {
      if (c.dead && SPECIES[c.sp].archetype === 'charognard') continue;
      if (c.dead) continue;
      out.push({
        id: c.id,
        sp: c.sp,
        x: c.x,
        y: c.y,
        z: c.z,
        yaw: c.yaw,
        speed: c.speed,
        mode: c.mode,
        hp: c.hp / c.maxHp,
        scale: c.scale,
        limp: c.limp,
        windup: c.windup,
        caught: !!c.caught,
        grabbing: this.grab?.id === c.id,
        alert: c.alert,
      });
    }
    return out;
  }

  /** Nombre de créatures réelles (vivantes). */
  get count(): number {
    let n = 0;
    for (const c of this.creatures.values()) if (!c.dead) n++;
    return n;
  }

  // ——— Sauvegarde ———

  serialize(): FaunaSave {
    // Les groupes de population présents retournent (dans la copie) dans leur zone.
    const cells: Array<[number, Record<string, number>, number]> = [];
    const extra = new Map<number, Record<string, number>>();
    for (const g of this.groups.values()) {
      if (g.key || g.sp === 'vautour') continue;
      for (const c of this.members(g)) {
        const i = this.cellIndex(c.x, c.z);
        const e = extra.get(i) ?? {};
        e[g.sp] = (e[g.sp] ?? 0) + 1;
        extra.set(i, e);
      }
    }
    for (const [i, c] of this.cells) {
      const counts: Record<string, number> = {};
      for (const sp of POPULATION_SPECIES) counts[sp] = Math.round(((c.counts[sp] ?? 0) + (extra.get(i)?.[sp] ?? 0)) * 100) / 100;
      cells.push([i, counts, Math.round(c.fear * 1000) / 1000]);
    }
    const groups: FaunaGroupSave[] = [];
    for (const g of this.groups.values()) {
      if (!g.key) continue;
      const alive = this.members(g);
      const ab = g.abstract ?? {
        x: alive.length ? this.centroid(alive).x : g.home.x,
        z: alive.length ? this.centroid(alive).z : g.home.z,
        hp: alive.map((c) => c.hp),
        scale: alive.map((c) => c.scale),
      };
      groups.push({ key: g.key, sp: g.sp, home: { ...g.home }, x: ab.x, z: ab.z, hp: [...ab.hp], scale: [...ab.scale], habits: g.habits.map((s) => ({ ...s })), food: g.food.map((s) => ({ ...s })), returnAt: g.returnAt });
    }
    return { rng: this.rng, cells, groups, traits: JSON.parse(JSON.stringify(this.traits)), sites: [...this.sitesTried].filter((k) => !groups.some((g) => g.key === k)) };
  }

  restore(raw: unknown): void {
    if (typeof raw !== 'object' || raw === null) return;
    const r = raw as Partial<FaunaSave>;
    const num = (v: unknown, lo: number, hi: number, d: number): number => (typeof v === 'number' && Number.isFinite(v) ? clamp(v, lo, hi) : d);
    if (typeof r.rng === 'number' && Number.isFinite(r.rng)) this.rng = r.rng >>> 0 || 1;
    if (Array.isArray(r.cells)) {
      for (const row of r.cells.slice(0, CELLS * CELLS)) {
        if (!Array.isArray(row)) continue;
        const i = num(row[0], 0, CELLS * CELLS - 1, -1);
        if (i < 0 || !Number.isInteger(i)) continue;
        const c = this.cell(i);
        const counts = row[1] as Record<string, unknown>;
        if (counts && typeof counts === 'object') for (const sp of POPULATION_SPECIES) c.counts[sp] = num(counts[sp], 0, 10000, c.counts[sp] ?? 0);
        c.fear = num(row[2], 0, 1, 0);
      }
    }
    if (r.traits && typeof r.traits === 'object') {
      for (const sp of Object.keys(this.traits)) {
        const t = (r.traits as Record<string, unknown>)[sp] as { wary?: unknown; bold?: unknown } | undefined;
        if (t) this.traits[sp] = { wary: num(t.wary, -1, 1, 0), bold: num(t.bold, -1, 1, 0) };
      }
    }
    if (Array.isArray(r.sites)) for (const k of r.sites.slice(0, 5000)) if (typeof k === 'string' && k.length < 40) this.sitesTried.add(k);
    if (Array.isArray(r.groups)) {
      for (const gs of r.groups.slice(0, 500)) {
        if (!gs || typeof gs !== 'object' || typeof gs.key !== 'string' || !isSpeciesId(gs.sp)) continue;
        const sp = gs.sp;
        const d = SPECIES[sp];
        let g: Group | undefined;
        if (sp === 'ombre') g = this.ombreGroup() ?? undefined;
        if (!g) {
          const home = gs.home && typeof gs.home === 'object' ? gs.home : { x: 0, z: 0, r: 500 };
          g = this.makeGroup(sp, gs.key, num(home.x, -WORLD_HALF, WORLD_HALF, 0), num(home.z, -WORLD_HALF, WORLD_HALF, 0), num(home.r, 10, 5000, 500), -1);
          this.groups.set(g.id, g);
        }
        this.sitesTried.add(gs.key);
        const hp = Array.isArray(gs.hp) ? gs.hp.slice(0, 20).map((v) => num(v, 1, d.hp * 2, d.hp)) : [];
        const scale = Array.isArray(gs.scale) ? gs.scale.slice(0, 20).map((v) => num(v, 0.5, 1.6, 1)) : [];
        while (scale.length < hp.length) scale.push(1);
        g.members = [];
        g.abstract = { x: num(gs.x, -WORLD_HALF, WORLD_HALF, g.home.x), z: num(gs.z, -WORLD_HALF, WORLD_HALF, g.home.z), hp, scale };
        const spots = (v: unknown): Spot[] => (Array.isArray(v) ? v.slice(0, 6).filter((s) => s && typeof s === 'object').map((s) => ({ x: num(s.x, -WORLD_HALF, WORLD_HALF, 0), z: num(s.z, -WORLD_HALF, WORLD_HALF, 0), w: num(s.w, 0, 10, 1) })) : []);
        g.habits = spots(gs.habits);
        g.food = spots(gs.food);
        g.returnAt = num(gs.returnAt, 0, 1e12, 0);
      }
    }
  }
}

export interface FaunaGroupSave {
  key: string;
  sp: SpeciesId;
  home: { x: number; z: number; r: number };
  x: number;
  z: number;
  hp: number[];
  scale: number[];
  habits: Spot[];
  food: Spot[];
  returnAt: number;
}

export interface FaunaSave {
  rng: number;
  cells: Array<[number, Record<string, number>, number]>;
  groups: FaunaGroupSave[];
  traits: Record<string, { wary: number; bold: number }>;
  sites: string[];
}
