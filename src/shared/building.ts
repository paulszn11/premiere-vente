// Construction (phase 5) : plans, chantiers et pièces assemblées sur une grille de 2 m,
// stabilité (appuis venus du sol, transmis de pièce en pièce), points de vie, dégâts selon le
// matériau et l'outil, feu, effondrement. Données simples, sérialisables et déterministes :
// le serveur de l'hôte fera foi en phase 8. Aucune dépendance au moteur physique ni à l'affichage.

import { WATER_LEVEL } from './constants';
import { ITEMS, type ItemId, type ToolTag } from './items';

/** Côté d'une case de la grille (m). */
export const GRID = 2;
/** Hauteur d'un niveau (m). */
export const LEVEL_H = 2.4;
/** Pilotis : hauteur maximale sous un plancher (m), y compris dans l'eau. */
export const STILT_MAX = 3.5;
/** Sous cette stabilité, une pièce s'effondre. */
export const COLLAPSE_AT = 0.2;
/** Un plan s'accroche à une construction à moins de cette distance (m). */
export const SNAP_DIST = 4;
/** Distance maximale entre le joueur et un plan qu'il trace (m). */
export const PLACE_REACH = 6;
/** Les matériaux posés au sol à moins de cette distance d'un chantier comptent (m). */
export const SITE_RADIUS = 2.5;

export type PieceKind = 'sol' | 'dallage' | 'poteau' | 'mur' | 'porte' | 'toit' | 'echelle' | 'cloture';
export type InstallKind = 'coffre' | 'etabli' | 'puits' | 'fourneau' | 'forge';
export type Material = 'bois' | 'torchis' | 'pierre' | 'chaume';
export type PlanId =
  | 'sol_rondins'
  | 'dallage'
  | 'poteau'
  | 'mur_clayonnage'
  | 'mur_pierre'
  | 'porte'
  | 'toit_chaume'
  | 'echelle'
  | 'cloture'
  | 'coffre'
  | 'etabli'
  | 'puits'
  | 'fourneau'
  | 'forge';

/** Emplacement sur la grille : case (sol, toit), bord (mur, porte, échelle, clôture), coin (poteau). */
export type SlotType = 'f' | 'e' | 'c' | 'r';
export interface SlotRef {
  t: SlotType;
  i: number;
  j: number;
  k: number;
  /** Bord : 'x' (le long de l'axe x, en z = j) ou 'z' (le long de z, en x = i). */
  d?: 'x' | 'z';
}

/** Besoin d'une étape : [objet, nombre] ; pour les pierres, le nombre est une masse en kg. */
export type Need = [ItemId, number];

export interface PlanStep {
  label: string;
  needs: Need[];
  tool: ToolTag | null;
  seconds: number;
  /** Fixation en fer (clous ou boulons), utilisée en priorité si on en a : pièce plus solide. */
  iron?: { label: string; needs: Need[]; tool: ToolTag | null };
}

export interface PlanDef {
  id: PlanId;
  label: string;
  /** Pièce de la grille, ou installation posée librement (devient un objet fixe). */
  piece: PieceKind | null;
  install: InstallKind | null;
  slot: SlotType | 'libre';
  material: Material;
  /** Points de vie une fois terminée. */
  hp: number;
  steps: PlanStep[];
  known: boolean;
  /** Plan pressenti en ramassant ou en fabriquant l'un de ces objets. */
  hintedBy: ItemId[];
  hint: string;
  description: string;
  /** Seulement sur la terre ferme (dallage, puits). */
  groundOnly?: boolean;
}

const tie = (n: number): PlanStep['iron'] => ({ label: 'Clouer', needs: [['clous', n]], tool: 'percuteur' });
const bolt = (n: number): PlanStep['iron'] => ({ label: 'Boulonner', needs: [['boulons', n]], tool: 'percuteur' });

export const PLANS: Record<PlanId, PlanDef> = {
  sol_rondins: {
    id: 'sol_rondins',
    label: 'Plancher en rondins',
    piece: 'sol',
    install: null,
    slot: 'f',
    material: 'bois',
    hp: 260,
    steps: [
      { label: 'Poser les rondins', needs: [['buche', 4]], tool: null, seconds: 6 },
      { label: 'Ligaturer les rondins', needs: [['corde', 2]], tool: null, seconds: 4, iron: bolt(2) },
    ],
    known: true,
    hintedBy: [],
    hint: '',
    description: 'Plancher de 2 × 2 m. Sur une pente ou dans l’eau peu profonde, il repose sur des pilotis.',
  },
  dallage: {
    id: 'dallage',
    label: 'Dallage en pierre',
    piece: 'dallage',
    install: null,
    slot: 'f',
    material: 'pierre',
    hp: 600,
    steps: [{ label: 'Poser et caler les pierres', needs: [['pierre', 30]], tool: 'percuteur', seconds: 8 }],
    known: true,
    hintedBy: [],
    hint: '',
    description: 'Sol de pierres sur un terrain presque plat. Très solide, mais ne porte rien en porte-à-faux.',
    groundOnly: true,
  },
  poteau: {
    id: 'poteau',
    label: 'Poteau',
    piece: 'poteau',
    install: null,
    slot: 'c',
    material: 'bois',
    hp: 200,
    steps: [{ label: 'Dresser le poteau', needs: [['perche', 1]], tool: null, seconds: 4, iron: bolt(1) }],
    known: true,
    hintedBy: [],
    hint: '',
    description: 'Poteau d’angle : il porte les planchers et les toits au-dessus de lui.',
  },
  mur_clayonnage: {
    id: 'mur_clayonnage',
    label: 'Mur de clayonnage',
    piece: 'mur',
    install: null,
    slot: 'e',
    material: 'bois',
    hp: 220,
    steps: [
      { label: 'Dresser les montants', needs: [['perche', 2]], tool: null, seconds: 4 },
      { label: 'Tresser les baguettes', needs: [['baton', 6]], tool: null, seconds: 6 },
      { label: 'Ligaturer', needs: [['corde', 1]], tool: null, seconds: 3, iron: tie(6) },
    ],
    known: true,
    hintedBy: [],
    hint: '',
    description: 'Montants de perches et baguettes tressées. Enduit de torchis, il résiste mieux et ne brûle plus.',
  },
  mur_pierre: {
    id: 'mur_pierre',
    label: 'Mur en pierre sèche',
    piece: 'mur',
    install: null,
    slot: 'e',
    material: 'pierre',
    hp: 700,
    steps: [
      { label: 'Monter la première assise', needs: [['pierre', 20]], tool: 'percuteur', seconds: 6 },
      { label: 'Monter la deuxième assise', needs: [['pierre', 20]], tool: 'percuteur', seconds: 6 },
      { label: 'Poser le couronnement', needs: [['pierre', 15]], tool: 'percuteur', seconds: 6 },
    ],
    known: true,
    hintedBy: [],
    hint: '',
    description: 'Pierres ajustées sans mortier, comme au Grand Zimbabwe. Très résistant ; mieux vaut le poser sur le sol.',
  },
  porte: {
    id: 'porte',
    label: 'Porte en perches',
    piece: 'porte',
    install: null,
    slot: 'e',
    material: 'bois',
    hp: 200,
    steps: [
      { label: 'Dresser l’encadrement', needs: [['perche', 2]], tool: null, seconds: 4 },
      { label: 'Assembler le battant', needs: [['baton', 6]], tool: 'tranchant', seconds: 6 },
      { label: 'Poser les attaches', needs: [['corde', 1]], tool: null, seconds: 3, iron: tie(4) },
    ],
    known: true,
    hintedBy: [],
    hint: '',
    description: 'S’ouvre et se ferme (E).',
  },
  toit_chaume: {
    id: 'toit_chaume',
    label: 'Toit de chaume',
    piece: 'toit',
    install: null,
    slot: 'r',
    material: 'chaume',
    hp: 120,
    steps: [
      { label: 'Monter la charpente', needs: [['perche', 2], ['corde', 1]], tool: null, seconds: 5, iron: tie(4) },
      { label: 'Poser le chaume', needs: [['herbe', 8]], tool: null, seconds: 6 },
    ],
    known: true,
    hintedBy: [],
    hint: '',
    description: 'Couvre une case, posé sur des murs ou des poteaux. Brûle facilement.',
  },
  echelle: {
    id: 'echelle',
    label: 'Échelle',
    piece: 'echelle',
    install: null,
    slot: 'e',
    material: 'bois',
    hp: 100,
    steps: [
      { label: 'Assembler les montants', needs: [['perche', 2], ['baton', 4]], tool: null, seconds: 4 },
      { label: 'Ligaturer les barreaux', needs: [['corde', 1]], tool: null, seconds: 3, iron: tie(4) },
    ],
    known: true,
    hintedBy: [],
    hint: '',
    description: 'Pour monter à l’étage : on l’escalade (Sauter face à elle).',
  },
  cloture: {
    id: 'cloture',
    label: 'Clôture d’épines',
    piece: 'cloture',
    install: null,
    slot: 'e',
    material: 'bois',
    hp: 150,
    steps: [{ label: 'Planter et entrelacer les branches', needs: [['baton', 4], ['manche', 2]], tool: 'fouir', seconds: 6 }],
    known: true,
    hintedBy: [],
    hint: '',
    description: 'Une boma : branches épineuses entrelacées qui barrent le passage.',
  },
  coffre: {
    id: 'coffre',
    label: 'Coffre en bois',
    piece: null,
    install: 'coffre',
    slot: 'libre',
    material: 'bois',
    hp: 150,
    steps: [
      { label: 'Tailler les planches', needs: [['buche', 2]], tool: 'tranchant', seconds: 6 },
      { label: 'Assembler le coffre', needs: [['corde', 1]], tool: null, seconds: 4, iron: tie(4) },
    ],
    known: true,
    hintedBy: [],
    hint: '',
    description: 'Range 40 litres d’objets.',
  },
  etabli: {
    id: 'etabli',
    label: 'Établi',
    piece: null,
    install: 'etabli',
    slot: 'libre',
    material: 'bois',
    hp: 200,
    steps: [
      { label: 'Dresser les pieds', needs: [['perche', 2]], tool: 'tranchant', seconds: 5 },
      { label: 'Poser le plateau', needs: [['buche', 2], ['corde', 2]], tool: null, seconds: 5, iron: tie(6) },
    ],
    known: true,
    hintedBy: [],
    hint: '',
    description: 'À côté : meilleure qualité et gestes plus rapides pour la fabrication.',
  },
  puits: {
    id: 'puits',
    label: 'Puits',
    piece: null,
    install: 'puits',
    slot: 'libre',
    material: 'pierre',
    hp: 500,
    steps: [
      { label: 'Creuser jusqu’à l’eau', needs: [], tool: 'fouir', seconds: 10 },
      { label: 'Creuser encore', needs: [], tool: 'fouir', seconds: 10 },
      { label: 'Maçonner la margelle', needs: [['pierre', 25]], tool: 'percuteur', seconds: 8 },
    ],
    known: false,
    hintedBy: ['pot'],
    hint: 'Un pot à remplir… Près d’un fleuve ou d’un vlei, l’eau n’est pas loin sous la terre : un puits ?',
    description: 'Près des fleuves et des zones humides, là où l’eau est proche. On y remplit son pot.',
    groundOnly: true,
  },
  fourneau: {
    id: 'fourneau',
    label: 'Bas fourneau',
    piece: null,
    install: 'fourneau',
    slot: 'libre',
    material: 'pierre',
    hp: 400,
    steps: [
      { label: 'Monter la base de pierres', needs: [['pierre', 20]], tool: null, seconds: 6 },
      { label: 'Monter la cuve d’argile', needs: [['argile', 5]], tool: null, seconds: 8 },
      { label: 'Poser la tuyère et le soufflet', needs: [['argile', 1], ['baton', 2], ['corde', 1]], tool: 'tranchant', seconds: 6 },
    ],
    known: false,
    hintedBy: ['minerai_fer'],
    hint: 'Ce minerai rouge… Fondu dans une cuve d’argile, avec du bois et un soufflet, il donnerait du fer.',
    description: 'On y charge du minerai de fer et du bois, on allume, puis on actionne le soufflet : il en sort une loupe de fer.',
  },
  forge: {
    id: 'forge',
    label: 'Forge',
    piece: null,
    install: 'forge',
    slot: 'libre',
    material: 'pierre',
    hp: 400,
    steps: [
      { label: 'Poser l’enclume de pierre', needs: [['pierre', 15]], tool: null, seconds: 5 },
      { label: 'Monter le foyer de forge', needs: [['argile', 2], ['pierre', 10]], tool: null, seconds: 6 },
    ],
    known: false,
    hintedBy: ['loupe_fer'],
    hint: 'Une loupe de fer brut… Il faudrait la chauffer et la battre sur une enclume : une forge.',
    description: 'Allumée, elle permet de forger barres, clous, boulons et outils en fer sur le plan de travail.',
  },
};

export const PLAN_IDS = Object.keys(PLANS) as PlanId[];
export const PIECE_PLANS = PLAN_IDS.filter((id) => PLANS[id].piece !== null);
export const INSTALL_PLANS = PLAN_IDS.filter((id) => PLANS[id].install !== null);

export const MATERIAL_LABELS: Record<Material, string> = { bois: 'bois', torchis: 'torchis', pierre: 'pierre', chaume: 'chaume' };

/** Brûle (bois et chaume ; le torchis et la pierre non). */
export function combustible(mat: Material): boolean {
  return mat === 'bois' || mat === 'chaume';
}

// ——— Connaissance des plans ———

export function startingPlans(): PlanId[] {
  return PLAN_IDS.filter((id) => PLANS[id].known);
}

export function readPlans(raw: unknown): PlanId[] {
  const out = startingPlans();
  if (Array.isArray(raw)) for (const x of raw) if (typeof x === 'string' && x in PLANS && !out.includes(x as PlanId)) out.push(x as PlanId);
  return out;
}

/** Plans appris en ramassant ou en fabriquant un objet ; renvoie les nouveaux. */
export function plansFrom(known: PlanId[], item: ItemId): PlanId[] {
  const out: PlanId[] = [];
  for (const id of PLAN_IDS) {
    if (known.includes(id)) continue;
    if (PLANS[id].hintedBy.includes(item)) {
      known.push(id);
      out.push(id);
    }
  }
  return out;
}

// ——— Pièces et constructions ———

export interface Piece {
  id: number;
  plan: PlanId;
  slot: SlotRef;
  /** Étapes faites ; égal au nombre d'étapes : pièce terminée. */
  step: number;
  hp: number;
  mat: Material;
  /** Fixée au fer (clous ou boulons) : plus solide. */
  iron: boolean;
  /** Pilotis sous un plancher (nombre de coins). */
  stilts: number;
  /** Repose directement sur le terrain (calculé à la pose). */
  ground: boolean;
  /** Porte ouverte. */
  open: boolean;
  /** Secondes depuis le début de l'incendie (0 : ne brûle pas). */
  burning: number;
  /** Stabilité calculée (0 à 1), non sauvegardée. */
  support: number;
}

export interface Structure {
  id: string;
  x: number;
  y: number;
  z: number;
  /** Orientation de la grille (rad), même convention que le regard (0 : +z). */
  yaw: number;
  pieces: Piece[];
  nextId: number;
}

/** Chantier d'installation (coffre, établi, puits, fourneau, forge), posé librement. */
export interface InstallSite {
  id: string;
  plan: PlanId;
  x: number;
  y: number;
  z: number;
  yaw: number;
  step: number;
  /** Posé sur un plancher (sinon sur le sol). */
  on: { s: string; p: number } | null;
}

export function stepsOf(plan: PlanId, stilts = 0): PlanStep[] {
  const base = PLANS[plan].steps;
  if (stilts <= 0) return base;
  return [{ label: `Planter les pilotis (${stilts})`, needs: [['perche', stilts]], tool: 'fouir', seconds: 3 + 2 * stilts }, ...base];
}

export function isDone(p: Piece): boolean {
  return p.step >= stepsOf(p.plan, p.stilts).length;
}

/** Points de vie maximum d'une pièce terminée. */
export function maxHp(p: Pick<Piece, 'plan' | 'mat' | 'iron'>): number {
  let hp = PLANS[p.plan].hp;
  if (p.mat === 'torchis') hp = 400;
  if (p.iron) hp = Math.round(hp * 1.3);
  return hp;
}

// ——— Géométrie de la grille ———

/** Position locale (dans la grille) → monde. */
export function toWorld(s: Pick<Structure, 'x' | 'y' | 'z' | 'yaw'>, lx: number, ly: number, lz: number): { x: number; y: number; z: number } {
  const c = Math.cos(s.yaw);
  const n = Math.sin(s.yaw);
  return { x: s.x + lx * c + lz * n, y: s.y + ly, z: s.z - lx * n + lz * c };
}

/** Position dans le monde → locale. */
export function toLocal(s: Pick<Structure, 'x' | 'y' | 'z' | 'yaw'>, x: number, y: number, z: number): { x: number; y: number; z: number } {
  const c = Math.cos(s.yaw);
  const n = Math.sin(s.yaw);
  const dx = x - s.x;
  const dz = z - s.z;
  return { x: dx * c - dz * n, y: y - s.y, z: dx * n + dz * c };
}

/** Centre local d'un emplacement et orientation locale (rad) de la pièce. */
export function slotCenter(slot: SlotRef): { x: number; y: number; z: number; rot: number } {
  const { i, j, k } = slot;
  const base = k * LEVEL_H;
  switch (slot.t) {
    case 'f':
      return { x: (i + 0.5) * GRID, y: base, z: (j + 0.5) * GRID, rot: 0 };
    case 'r':
      return { x: (i + 0.5) * GRID, y: base + LEVEL_H, z: (j + 0.5) * GRID, rot: 0 };
    case 'c':
      return { x: i * GRID, y: base, z: j * GRID, rot: 0 };
    case 'e':
      return slot.d === 'x' ? { x: (i + 0.5) * GRID, y: base, z: j * GRID, rot: 0 } : { x: i * GRID, y: base, z: (j + 0.5) * GRID, rot: Math.PI / 2 };
  }
}

/** Centre et orientation d'une pièce dans le monde (la base de la pièce : dessus du plancher, pied du mur). */
export function pieceTransform(s: Structure, slot: SlotRef): { x: number; y: number; z: number; yaw: number } {
  const c = slotCenter(slot);
  const w = toWorld(s, c.x, c.y, c.z);
  return { ...w, yaw: s.yaw + c.rot };
}

export function slotKey(slot: SlotRef): string {
  return slot.t === 'e' ? `e${slot.d}:${slot.i}:${slot.j}:${slot.k}` : `${slot.t}:${slot.i}:${slot.j}:${slot.k}`;
}

/** Les quatre bords d'une case. */
function cellEdges(i: number, j: number, k: number): SlotRef[] {
  return [
    { t: 'e', d: 'x', i, j, k },
    { t: 'e', d: 'x', i, j: j + 1, k },
    { t: 'e', d: 'z', i, j, k },
    { t: 'e', d: 'z', i: i + 1, j, k },
  ];
}

function cellCorners(i: number, j: number, k: number): SlotRef[] {
  return [
    { t: 'c', i, j, k },
    { t: 'c', i: i + 1, j, k },
    { t: 'c', i, j: j + 1, k },
    { t: 'c', i: i + 1, j: j + 1, k },
  ];
}

/** Coins aux extrémités d'un bord. */
function edgeCorners(e: SlotRef): SlotRef[] {
  return e.d === 'x'
    ? [
        { t: 'c', i: e.i, j: e.j, k: e.k },
        { t: 'c', i: e.i + 1, j: e.j, k: e.k },
      ]
    : [
        { t: 'c', i: e.i, j: e.j, k: e.k },
        { t: 'c', i: e.i, j: e.j + 1, k: e.k },
      ];
}

/** Cases qui partagent un bord. */
function edgeCells(e: SlotRef): Array<[number, number]> {
  return e.d === 'x'
    ? [
        [e.i, e.j],
        [e.i, e.j - 1],
      ]
    : [
        [e.i, e.j],
        [e.i - 1, e.j],
      ];
}

/** Les quatre cases autour d'un coin. */
function cornerCells(c: SlotRef): Array<[number, number]> {
  return [
    [c.i, c.j],
    [c.i - 1, c.j],
    [c.i, c.j - 1],
    [c.i - 1, c.j - 1],
  ];
}

/** Bords qui touchent un coin (même niveau). */
function cornerEdges(c: SlotRef): SlotRef[] {
  return [
    { t: 'e', d: 'x', i: c.i, j: c.j, k: c.k },
    { t: 'e', d: 'x', i: c.i - 1, j: c.j, k: c.k },
    { t: 'e', d: 'z', i: c.i, j: c.j, k: c.k },
    { t: 'e', d: 'z', i: c.i, j: c.j - 1, k: c.k },
  ];
}

// ——— Stabilité ———

type Index = Map<string, Piece>;

function indexOf(s: Structure): Index {
  const m: Index = new Map();
  for (const p of s.pieces) m.set(slotKey(p.slot), p);
  return m;
}

/** Transmission verticale d'une pièce porteuse vers ce qu'elle porte, selon son matériau. */
function verticalFactor(from: Piece, toMat: Material): number {
  const kind = PLANS[from.plan].piece;
  let f: number;
  if (kind === 'poteau') f = 0.92;
  else if (kind === 'sol') f = 0.93;
  else if (kind === 'dallage') f = 0.98;
  else if (from.mat === 'pierre') f = 0.97;
  else if (from.mat === 'torchis') f = 0.9;
  else f = 0.88;
  if (from.iron) f = Math.min(0.99, f + 0.03);
  // Une lourde pierre portée par du bois : moins bien tenue.
  if (toMat === 'pierre' && from.mat !== 'pierre') f *= 0.75;
  return f;
}

/** Porteurs possibles d'une pièce : [pièce porteuse ou sol, coefficient de transmission]. */
function supportersOf(p: Piece, idx: Index): Array<[Piece | 'sol', number]> {
  const out: Array<[Piece | 'sol', number]> = [];
  const kind = PLANS[p.plan].piece;
  const { i, j, k } = p.slot;
  const get = (slot: SlotRef): Piece | undefined => idx.get(slotKey(slot));
  const add = (q: Piece | undefined, f: number): void => {
    if (q && q !== p) out.push([q, f]);
  };
  if (p.ground) out.push(['sol', p.stilts > 0 ? 0.95 : 1]);
  switch (kind) {
    case 'sol':
    case 'dallage': {
      if (k > 0) {
        for (const e of cellEdges(i, j, k - 1)) {
          const w = get(e);
          if (w && PLANS[w.plan].piece !== 'cloture') add(w, verticalFactor(w, p.mat));
        }
        for (const c of cellCorners(i, j, k - 1)) {
          const q = get(c);
          if (q) add(q, verticalFactor(q, p.mat));
        }
      }
      for (const [di, dj] of [
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1],
      ] as const) {
        const q = get({ t: 'f', i: i + di, j: j + dj, k });
        if (!q) continue;
        // Porte-à-faux : le bois tient une portée, la pierre presque pas.
        const f = PLANS[q.plan].piece === 'dallage' ? 0.3 : q.iron ? 0.5 : 0.45;
        add(q, f);
      }
      // Coins portés par des poteaux du même niveau (poteaux posés sur le sol, plancher dessus).
      for (const c of cellCorners(i, j, k)) {
        const q = get(c);
        if (q && q.ground) add(q, 0.9);
      }
      break;
    }
    case 'mur':
    case 'porte':
    case 'echelle':
    case 'cloture': {
      for (const [ci, cj] of edgeCells(p.slot)) {
        const f = get({ t: 'f', i: ci, j: cj, k });
        if (f) add(f, verticalFactor(f, p.mat));
      }
      if (k > 0) {
        const below = get({ ...p.slot, k: k - 1 });
        if (below && PLANS[below.plan].piece !== 'cloture') add(below, verticalFactor(below, p.mat));
      }
      for (const c of edgeCorners(p.slot)) add(get(c), 0.9);
      // Murs voisins (même niveau, un coin commun) : ils se tiennent un peu.
      for (const c of edgeCorners(p.slot)) {
        for (const e of cornerEdges(c)) {
          if (slotKey(e) === slotKey(p.slot)) continue;
          const q = get(e);
          if (q && (PLANS[q.plan].piece === 'mur' || PLANS[q.plan].piece === 'porte')) add(q, q.mat === 'pierre' ? 0.25 : 0.3);
        }
      }
      break;
    }
    case 'poteau': {
      if (k > 0) add(get({ t: 'c', i, j, k: k - 1 }), 0.92);
      for (const [ci, cj] of cornerCells(p.slot)) {
        const f = get({ t: 'f', i: ci, j: cj, k });
        if (f) add(f, verticalFactor(f, p.mat));
      }
      if (k > 0) for (const e of cornerEdges({ ...p.slot, k: k - 1 })) {
        const w = get(e);
        if (w && PLANS[w.plan].piece !== 'cloture') add(w, verticalFactor(w, p.mat));
      }
      break;
    }
    case 'toit': {
      for (const e of cellEdges(i, j, k)) {
        const w = get(e);
        if (w && PLANS[w.plan].piece !== 'cloture' && PLANS[w.plan].piece !== 'echelle') add(w, verticalFactor(w, p.mat));
      }
      for (const c of cellCorners(i, j, k)) add(get(c), 0.9);
      for (const [di, dj] of [
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1],
      ] as const) {
        add(get({ t: 'r', i: i + di, j: j + dj, k }), 0.5);
      }
      break;
    }
    default:
      break;
  }
  return out;
}

/**
 * Calcule la stabilité de chaque pièce (0 à 1) : le meilleur chemin d'appuis depuis le sol,
 * produit des coefficients de transmission. Seules les pièces terminées portent.
 */
export function computeSupport(s: Structure): void {
  const idx = indexOf(s);
  const dependents = new Map<Piece, Array<[Piece, number]>>();
  const grounded: Array<[Piece, number]> = [];
  for (const p of s.pieces) {
    p.support = 0;
    for (const [from, f] of supportersOf(p, idx)) {
      if (from === 'sol') grounded.push([p, f]);
      else {
        let list = dependents.get(from);
        if (!list) dependents.set(from, (list = []));
        list.push([p, f]);
      }
    }
  }
  // Propagation du meilleur appui (algorithme de Dijkstra sur le produit des coefficients).
  const queue: Piece[] = [];
  for (const [p, f] of grounded) {
    if (f > p.support) p.support = f;
  }
  for (const p of s.pieces) if (p.support > 0) queue.push(p);
  const done = new Set<Piece>();
  while (queue.length) {
    let best = 0;
    for (let n = 1; n < queue.length; n++) if (queue[n]!.support > queue[best]!.support) best = n;
    const p = queue.splice(best, 1)[0]!;
    if (done.has(p)) continue;
    done.add(p);
    // Un chantier reçoit un appui mais n'en donne pas.
    if (!isDone(p)) continue;
    for (const [q, f] of dependents.get(p) ?? []) {
      const cand = p.support * f;
      if (cand > q.support + 1e-9) {
        q.support = cand;
        queue.push(q);
      }
    }
  }
}

/** Stabilité qu'aurait une nouvelle pièce à cet emplacement (sans la poser). */
export function supportIfPlaced(s: Structure, candidate: Piece): number {
  const idx = indexOf(s);
  let best = 0;
  for (const [from, f] of supportersOf(candidate, idx)) {
    const v = from === 'sol' ? f : isDone(from) ? from.support * f : 0;
    if (v > best) best = v;
  }
  return best;
}

// ——— État des constructions ———

export interface PlacementInput {
  plan: PlanId;
  /** Point visé (sur le terrain ou sur une pièce). */
  aim: { x: number; y: number; z: number };
  /** Cap du regard du joueur et rotation supplémentaire demandée (quarts de tour de 15°). */
  yaw: number;
  turn: number;
  /** Pièce visée (pour poser une installation sur un plancher). */
  onPiece?: { s: string; p: number } | null;
  player: { x: number; y: number; z: number };
}

export interface Placement {
  ok: boolean;
  reason: string | null;
  plan: PlanId;
  /** Construction existante où s'accroche la pièce (null : nouvelle construction ou installation). */
  structure: string | null;
  /** Nouvelle construction : origine de sa grille. */
  origin: { x: number; y: number; z: number; yaw: number } | null;
  slot: SlotRef | null;
  /** Installation : position libre. */
  free: { x: number; y: number; z: number; yaw: number; on: { s: string; p: number } | null } | null;
  stilts: number;
  ground: boolean;
  support: number;
  /** Pour dessiner le fantôme : base et orientation de la pièce dans le monde. */
  world: { x: number; y: number; z: number; yaw: number };
}

const STEP15 = Math.PI / 12;

function blank(plan: PlanId, aim: { x: number; y: number; z: number }, yaw: number): Placement {
  return { ok: false, reason: null, plan, structure: null, origin: null, slot: null, free: null, stilts: 0, ground: false, support: 0, world: { x: aim.x, y: aim.y, z: aim.z, yaw } };
}

export class BuildState {
  structures: Structure[] = [];
  sites: InstallSite[] = [];
  /** Change à chaque modification (affichage, collisions). */
  version = 0;
  private nextStructure = 1;
  private nextSite = 1;

  constructor(private readonly heightAt: (x: number, z: number) => number) {}

  structure(id: string): Structure | undefined {
    return this.structures.find((s) => s.id === id);
  }

  piece(sid: string, pid: number): Piece | undefined {
    return this.structure(sid)?.pieces.find((p) => p.id === pid);
  }

  site(id: string): InstallSite | undefined {
    return this.sites.find((x) => x.id === id);
  }

  touch(): void {
    this.version++;
  }

  /** Construction la plus proche d'un point (au plus SNAP_DIST d'une de ses pièces). */
  nearestStructure(x: number, y: number, z: number, max = SNAP_DIST): Structure | null {
    let best: Structure | null = null;
    let bestD = max;
    for (const s of this.structures) {
      for (const p of s.pieces) {
        const t = pieceTransform(s, p.slot);
        const d = Math.hypot(t.x - x, (t.y - y) * 0.5, t.z - z);
        if (d < bestD) {
          bestD = d;
          best = s;
        }
      }
    }
    return best;
  }

  /** Calcule où irait un plan (et s'il est possible), sans rien modifier. */
  placement(inp: PlacementInput): Placement {
    const def = PLANS[inp.plan];
    const yaw = Math.round((inp.yaw + inp.turn * STEP15) / STEP15) * STEP15;
    const out = blank(inp.plan, inp.aim, yaw);
    const reach = Math.hypot(inp.aim.x - inp.player.x, inp.aim.z - inp.player.z);
    const fail = (reason: string): Placement => ({ ...out, ok: false, reason });
    if (def.slot === 'libre') return this.placeInstall(inp, out, yaw, reach);
    const near = this.nearestStructure(inp.aim.x, inp.aim.y, inp.aim.z);
    let s: Structure;
    let slot: SlotRef;
    if (near) {
      s = near;
      const l = toLocal(s, inp.aim.x, inp.aim.y, inp.aim.z);
      const i = Math.floor(l.x / GRID);
      const j = Math.floor(l.z / GRID);
      const fx = l.x / GRID - i;
      const fz = l.z / GRID - j;
      const k = Math.max(0, Math.floor((l.y + 0.3) / LEVEL_H));
      if (def.slot === 'f') slot = { t: 'f', i, j, k };
      else if (def.slot === 'c') slot = { t: 'c', i: Math.round(l.x / GRID), j: Math.round(l.z / GRID), k };
      else if (def.slot === 'e') {
        const m = Math.min(fx, 1 - fx, fz, 1 - fz);
        if (m === fz) slot = { t: 'e', d: 'x', i, j, k };
        else if (m === 1 - fz) slot = { t: 'e', d: 'x', i, j: j + 1, k };
        else if (m === fx) slot = { t: 'e', d: 'z', i, j, k };
        else slot = { t: 'e', d: 'z', i: i + 1, j, k };
      } else {
        // Toit : posé sur les murs ou poteaux les plus hauts autour de la case.
        const idx = indexOf(s);
        let kw = -1;
        for (let kk = 0; kk <= Math.max(k, 0) + 1; kk++) {
          if (cellEdges(i, j, kk).some((e) => idx.has(slotKey(e))) || cellCorners(i, j, kk).some((c) => idx.has(slotKey(c)))) kw = kk;
        }
        slot = { t: 'r', i, j, k: kw >= 0 ? kw : Math.max(0, Math.floor(l.y / LEVEL_H)) };
      }
    } else {
      // Nouvelle construction : la grille est centrée sur le point visé, orientée comme le regard.
      if (def.slot === 'r') return fail('Un toit se pose sur des murs ou des poteaux.');
      const c = Math.cos(yaw);
      const n = Math.sin(yaw);
      const local = def.slot === 'f' ? { x: GRID / 2, z: GRID / 2 } : def.slot === 'e' ? { x: GRID / 2, z: 0 } : { x: 0, z: 0 };
      const ox = inp.aim.x - (local.x * c + local.z * n);
      const oz = inp.aim.z - (-local.x * n + local.z * c);
      const probe: Structure = { id: '', x: ox, y: 0, z: oz, yaw, pieces: [], nextId: 1 };
      slot = def.slot === 'f' ? { t: 'f', i: 0, j: 0, k: 0 } : def.slot === 'e' ? { t: 'e', d: 'x', i: 0, j: 0, k: 0 } : { t: 'c', i: 0, j: 0, k: 0 };
      const hs = this.footprintHeights(probe, slot);
      let oy: number;
      if (def.slot === 'f') oy = Math.max(...hs) + (def.piece === 'dallage' ? 0.05 : 0.15);
      else oy = Math.min(...hs);
      s = { ...probe, y: oy };
      out.origin = { x: ox, y: oy, z: oz, yaw };
    }
    out.slot = slot;
    out.structure = near ? near.id : null;
    const t = pieceTransform(s, slot);
    out.world = t;
    if (reach > PLACE_REACH) return fail('Trop loin : approchez-vous.');
    if (s.pieces.some((p) => slotKey(p.slot) === slotKey(slot))) return fail('Il y a déjà une pièce ici.');
    // Contact avec le terrain.
    const hs = this.footprintHeights(s, slot);
    const baseY = s.y + slot.k * LEVEL_H;
    let stilts = 0;
    let ground = false;
    if (slot.t === 'f') {
      const top = baseY;
      if (hs.some((h) => h > top + 0.05)) return fail('Le terrain dépasse ici : choisissez un endroit plus plat ou plus bas.');
      if (def.groundOnly && (slot.k > 0 || hs.some((h) => h < top - 0.35))) return fail('Un dallage se pose sur un sol presque plat.');
      if (slot.k === 0 && !def.groundOnly) {
        for (const h of hs) {
          const gap = top - 0.2 - h;
          if (gap > STILT_MAX) return fail('Trop haut au-dessus du sol ou de l’eau : 3,5 m de pilotis au plus.');
          if (gap > 0.25) stilts++;
        }
        ground = hs.every((h) => top - 0.2 - h <= STILT_MAX);
      } else if (def.groundOnly) ground = true;
    } else if (slot.t === 'e' || slot.t === 'c') {
      if (slot.k === 0) {
        const hmax = Math.max(...hs);
        const hmin = Math.min(...hs);
        if (hmax > baseY + 1) return fail('Le terrain est trop haut ici.');
        if (slot.t === 'c') ground = hmin >= baseY - STILT_MAX;
        else ground = hmin >= baseY - 0.6;
      }
    }
    const candidate: Piece = { id: 0, plan: inp.plan, slot, step: stepsOf(inp.plan, stilts).length, hp: 0, mat: def.material, iron: false, stilts, ground, open: false, burning: 0, support: 0 };
    const support = near ? supportIfPlaced(s, candidate) : ground ? (stilts > 0 ? 0.95 : 1) : 0;
    out.stilts = stilts;
    out.ground = ground;
    out.support = support;
    if (support < COLLAPSE_AT) return fail(slot.k > 0 || near ? `Trop loin d’un appui (stabilité ${Math.round(support * 100)} %).` : 'Rien pour le porter ici.');
    // Le joueur ne doit pas être dans le volume de la pièce.
    if (this.blocksPlayer(t, slot, inp.player)) return fail('Vous êtes dans le chemin.');
    return { ...out, ok: true };
  }

  private placeInstall(inp: PlacementInput, out: Placement, yaw: number, reach: number): Placement {
    const def = PLANS[inp.plan];
    const fail = (reason: string): Placement => ({ ...out, ok: false, reason });
    const { x, z } = inp.aim;
    let y = inp.aim.y;
    let on: { s: string; p: number } | null = null;
    if (inp.onPiece) {
      const p = this.piece(inp.onPiece.s, inp.onPiece.p);
      const kind = p ? PLANS[p.plan].piece : null;
      if (!p || !isDone(p) || (kind !== 'sol' && kind !== 'dallage')) return fail('Une installation se pose sur le sol ou sur un plancher terminé.');
      if (def.groundOnly) return fail('Un puits se creuse dans la terre, pas sur un plancher.');
      on = inp.onPiece;
      const s = this.structure(on.s)!;
      y = pieceTransform(s, p.slot).y;
    } else {
      const hs = [this.heightAt(x - 0.5, z - 0.5), this.heightAt(x + 0.5, z - 0.5), this.heightAt(x - 0.5, z + 0.5), this.heightAt(x + 0.5, z + 0.5)];
      const hmax = Math.max(...hs);
      const hmin = Math.min(...hs);
      if (hmax - hmin > 0.6) return fail('Le sol est trop en pente ici.');
      y = hmin;
      if (hmin < WATER_LEVEL + 0.1) return fail('Pas dans l’eau.');
      if (inp.plan === 'puits' && hmin > WATER_LEVEL + 4) return fail('L’eau est trop profonde sous la terre ici : creusez près d’un fleuve ou d’une zone humide.');
    }
    out.free = { x, y, z, yaw, on };
    out.world = { x, y, z, yaw };
    out.ground = on === null;
    out.support = 1;
    if (reach > PLACE_REACH) return fail('Trop loin : approchez-vous.');
    if (Math.hypot(x - inp.player.x, z - inp.player.z) < 0.7) return fail('Vous êtes dans le chemin.');
    for (const site of this.sites) if (Math.hypot(site.x - x, site.z - z) < 1) return fail('Il y a déjà un chantier ici.');
    return { ...out, ok: true };
  }

  /** Hauteurs du terrain aux extrémités de l'emplacement (coins d'une case, bouts d'un bord, coin). */
  private footprintHeights(s: Pick<Structure, 'x' | 'y' | 'z' | 'yaw'>, slot: SlotRef): number[] {
    const pts: Array<[number, number]> = [];
    if (slot.t === 'f' || slot.t === 'r')
      pts.push(
        [slot.i, slot.j],
        [slot.i + 1, slot.j],
        [slot.i, slot.j + 1],
        [slot.i + 1, slot.j + 1],
      );
    else if (slot.t === 'c') pts.push([slot.i, slot.j]);
    else if (slot.d === 'x') pts.push([slot.i, slot.j], [slot.i + 0.5, slot.j], [slot.i + 1, slot.j]);
    else pts.push([slot.i, slot.j], [slot.i, slot.j + 0.5], [slot.i, slot.j + 1]);
    return pts.map(([a, b]) => {
      const w = toWorld(s, a * GRID, 0, b * GRID);
      return this.heightAt(w.x, w.z);
    });
  }

  /** Le joueur (capsule de 0,3 m de rayon) serait-il dans la pièce ? */
  private blocksPlayer(t: { x: number; y: number; z: number; yaw: number }, slot: SlotRef, p: { x: number; y: number; z: number }): boolean {
    const dx = p.x - t.x;
    const dz = p.z - t.z;
    const c = Math.cos(t.yaw);
    const n = Math.sin(t.yaw);
    const lx = dx * c - dz * n;
    const lz = dx * n + dz * c;
    const r = 0.32;
    if (slot.t === 'f') return Math.abs(lx) < GRID / 2 + r && Math.abs(lz) < GRID / 2 + r && p.y > t.y - 1.9 && p.y < t.y - 0.05;
    if (slot.t === 'e') return Math.abs(lx) < GRID / 2 && Math.abs(lz) < 0.2 + r && p.y > t.y - 1.7 && p.y < t.y + LEVEL_H;
    if (slot.t === 'c') return Math.hypot(lx, lz) < 0.1 + r && p.y > t.y - 1.7 && p.y < t.y + LEVEL_H;
    return false;
  }

  /** Pose un plan (chantier). Renvoie la pièce ou le chantier créé. */
  apply(pl: Placement): { s: string; p: number } | { site: string } | null {
    if (!pl.ok) return null;
    if (pl.free) {
      const site: InstallSite = { id: `i${this.nextSite++}`, plan: pl.plan, x: pl.free.x, y: pl.free.y, z: pl.free.z, yaw: pl.free.yaw, step: 0, on: pl.free.on };
      this.sites.push(site);
      this.touch();
      return { site: site.id };
    }
    let s = pl.structure ? this.structure(pl.structure) : undefined;
    if (!s) {
      if (!pl.origin) return null;
      s = { id: `s${this.nextStructure++}`, ...pl.origin, pieces: [], nextId: 1 };
      this.structures.push(s);
    }
    const def = PLANS[pl.plan];
    const p: Piece = { id: s.nextId++, plan: pl.plan, slot: pl.slot!, step: 0, hp: 0, mat: def.material, iron: false, stilts: pl.stilts, ground: pl.ground, open: false, burning: 0, support: 0 };
    s.pieces.push(p);
    computeSupport(s);
    this.touch();
    return { s: s.id, p: p.id };
  }

  /** Termine une étape d'un chantier de pièce ; renvoie vrai si la pièce est terminée. */
  advance(sid: string, pid: number, iron: boolean): boolean {
    const s = this.structure(sid);
    const p = s?.pieces.find((q) => q.id === pid);
    if (!s || !p || isDone(p)) return false;
    p.step++;
    if (iron) p.iron = true;
    const done = isDone(p);
    if (done) p.hp = maxHp(p);
    computeSupport(s);
    this.touch();
    return done;
  }

  /** Enduit de torchis un mur de clayonnage. */
  plaster(sid: string, pid: number): boolean {
    const p = this.piece(sid, pid);
    if (!p || !isDone(p) || p.plan !== 'mur_clayonnage' || p.mat !== 'bois') return false;
    const ratio = p.hp / maxHp(p);
    p.mat = 'torchis';
    p.hp = Math.round(maxHp(p) * Math.max(ratio, 0.6));
    p.burning = 0;
    computeSupport(this.structure(sid)!);
    this.touch();
    return true;
  }

  /** Retire une pièce (démontée, détruite) puis recalcule la stabilité. */
  remove(sid: string, pid: number): Piece | null {
    const s = this.structure(sid);
    if (!s) return null;
    const n = s.pieces.findIndex((p) => p.id === pid);
    if (n < 0) return null;
    const [p] = s.pieces.splice(n, 1);
    if (s.pieces.length === 0) this.structures = this.structures.filter((x) => x !== s);
    else computeSupport(s);
    this.touch();
    return p!;
  }

  removeSite(id: string): InstallSite | null {
    const n = this.sites.findIndex((x) => x.id === id);
    if (n < 0) return null;
    const [site] = this.sites.splice(n, 1);
    this.touch();
    return site!;
  }

  /** Pièces dont la stabilité est passée sous le seuil (à faire s'effondrer). */
  unstable(): Array<{ s: Structure; p: Piece }> {
    const out: Array<{ s: Structure; p: Piece }> = [];
    for (const s of this.structures) for (const p of s.pieces) if (p.support < COLLAPSE_AT) out.push({ s, p });
    return out;
  }

  /** Inflige des dégâts ; renvoie vrai si la pièce est détruite (points de vie à 0). */
  damage(sid: string, pid: number, amount: number): boolean {
    const p = this.piece(sid, pid);
    if (!p || !isDone(p) || amount <= 0) return false;
    p.hp = Math.max(0, p.hp - amount);
    this.touch();
    return p.hp <= 0;
  }

  /** Répare une partie des points de vie. */
  repair(sid: string, pid: number): boolean {
    const p = this.piece(sid, pid);
    if (!p || !isDone(p)) return false;
    const max = maxHp(p);
    if (p.hp >= max) return false;
    p.hp = Math.min(max, p.hp + Math.round(max * 0.4));
    this.touch();
    return true;
  }

  toggleDoor(sid: string, pid: number): boolean {
    const p = this.piece(sid, pid);
    if (!p || PLANS[p.plan].piece !== 'porte' || !isDone(p)) return false;
    p.open = !p.open;
    this.touch();
    return true;
  }

  /** Pièces voisines (porteuses ou portées) : pour la propagation du feu. */
  neighbors(s: Structure, p: Piece): Piece[] {
    const idx = indexOf(s);
    const set = new Set<Piece>();
    for (const [q] of supportersOf(p, idx)) if (q !== 'sol') set.add(q);
    for (const q of s.pieces) {
      if (q === p) continue;
      if (supportersOf(q, idx).some(([from]) => from === p)) set.add(q);
    }
    return [...set];
  }

  serialize(): { v: 1; structures: Array<Omit<Structure, 'pieces'> & { pieces: Array<Omit<Piece, 'support'>> }>; sites: InstallSite[]; next: [number, number] } {
    return {
      v: 1,
      structures: this.structures.map((s) => ({ ...s, pieces: s.pieces.map(({ support: _support, ...rest }) => ({ ...rest, slot: { ...rest.slot } })) })),
      sites: this.sites.map((x) => ({ ...x, on: x.on ? { ...x.on } : null })),
      next: [this.nextStructure, this.nextSite],
    };
  }

  /** Relit une sauvegarde (contrôlée : valeurs hors bornes ignorées). Les anciennes sauvegardes n'en ont pas. */
  restore(raw: unknown): void {
    this.structures = [];
    this.sites = [];
    if (typeof raw !== 'object' || raw === null) return;
    const r = raw as Record<string, unknown>;
    const num = (v: unknown, lim = 1e7): v is number => typeof v === 'number' && Number.isFinite(v) && Math.abs(v) <= lim;
    const int = (v: unknown, lim = 1e6): v is number => num(v, lim) && Number.isInteger(v);
    if (Array.isArray(r.structures)) {
      for (const so of r.structures.slice(0, 2000)) {
        const o = so as Record<string, unknown>;
        if (typeof o?.id !== 'string' || !num(o.x, 9000) || !num(o.y, 5000) || !num(o.z, 9000) || !num(o.yaw, 100)) continue;
        const s: Structure = { id: o.id, x: o.x, y: o.y, z: o.z, yaw: o.yaw, pieces: [], nextId: int(o.nextId) ? o.nextId : 1 };
        const seen = new Set<string>();
        if (Array.isArray(o.pieces)) {
          for (const po of o.pieces.slice(0, 5000)) {
            const q = po as Record<string, unknown>;
            const sl = q?.slot as Record<string, unknown> | undefined;
            if (!int(q?.id) || typeof q.plan !== 'string' || !(q.plan in PLANS) || PLANS[q.plan as PlanId].piece === null || !sl) continue;
            const t = sl.t;
            if (t !== 'f' && t !== 'e' && t !== 'c' && t !== 'r') continue;
            if (!int(sl.i, 5000) || !int(sl.j, 5000) || !int(sl.k, 50) || sl.k < 0) continue;
            if (t === 'e' && sl.d !== 'x' && sl.d !== 'z') continue;
            const plan = q.plan as PlanId;
            const slot: SlotRef = t === 'e' ? { t, d: sl.d as 'x' | 'z', i: sl.i, j: sl.j, k: sl.k } : { t, i: sl.i, j: sl.j, k: sl.k };
            if (PLANS[plan].slot !== t || seen.has(slotKey(slot))) continue;
            seen.add(slotKey(slot));
            const stilts = int(q.stilts, 4) && q.stilts >= 0 ? q.stilts : 0;
            const nSteps = stepsOf(plan, stilts).length;
            const step = int(q.step, 100) ? Math.max(0, Math.min(nSteps, q.step)) : 0;
            const mat: Material = q.mat === 'torchis' && plan === 'mur_clayonnage' ? 'torchis' : PLANS[plan].material;
            const iron = q.iron === true;
            const max = maxHp({ plan, mat, iron });
            const hp = step >= nSteps ? (num(q.hp) ? Math.max(1, Math.min(max, q.hp)) : max) : 0;
            const id = q.id;
            s.pieces.push({ id, plan, slot, step, hp, mat, iron, stilts, ground: q.ground === true, open: q.open === true, burning: num(q.burning, 1e5) && q.burning > 0 ? q.burning : 0, support: 0 });
            if (id >= s.nextId) s.nextId = id + 1;
          }
        }
        if (s.pieces.length) {
          computeSupport(s);
          this.structures.push(s);
        }
      }
    }
    if (Array.isArray(r.sites)) {
      for (const so of r.sites.slice(0, 2000)) {
        const o = so as Record<string, unknown>;
        if (typeof o?.id !== 'string' || typeof o.plan !== 'string' || !(o.plan in PLANS) || PLANS[o.plan as PlanId].install === null) continue;
        if (!num(o.x, 9000) || !num(o.y, 5000) || !num(o.z, 9000) || !num(o.yaw, 100)) continue;
        const plan = o.plan as PlanId;
        const step = int(o.step, 100) ? Math.max(0, Math.min(PLANS[plan].steps.length - 1, o.step)) : 0;
        const onRaw = o.on as Record<string, unknown> | null;
        const on = onRaw && typeof onRaw.s === 'string' && int(onRaw.p) ? { s: onRaw.s, p: onRaw.p } : null;
        this.sites.push({ id: o.id, plan, x: o.x, y: o.y, z: o.z, yaw: o.yaw, step, on });
      }
    }
    const next = r.next as unknown[];
    if (Array.isArray(next)) {
      if (int(next[0])) this.nextStructure = Math.max(1, next[0]);
      if (int(next[1])) this.nextSite = Math.max(1, next[1]);
    }
    // Les identifiants ne doivent jamais resservir.
    for (const s of this.structures) this.nextStructure = Math.max(this.nextStructure, Number(s.id.slice(1)) + 1 || this.nextStructure);
    for (const x of this.sites) this.nextSite = Math.max(this.nextSite, Number(x.id.slice(1)) + 1 || this.nextSite);
    this.touch();
  }
}

// ——— Dégâts ———

export type DamageSource = ToolTag | 'main' | 'choc' | 'feu' | 'creature';

/** Dégâts d'un coup selon le matériau et l'outil (multipliés par la puissance de l'outil). */
const DAMAGE: Record<Material, Partial<Record<DamageSource, number>>> = {
  chaume: { hache: 25, tranchant: 12, percuteur: 8, pointe: 6, main: 3, fouir: 5 },
  bois: { hache: 18, tranchant: 6, percuteur: 6, pointe: 4, main: 1, fouir: 3 },
  torchis: { hache: 6, tranchant: 2, percuteur: 12, pointe: 3, main: 1, fouir: 8 },
  pierre: { hache: 1, tranchant: 0.5, percuteur: 7, pointe: 0.5, main: 0, fouir: 1 },
};

export function damageFor(mat: Material, source: DamageSource, power = 1): number {
  if (source === 'choc' || source === 'creature') return power * (mat === 'pierre' ? 0.3 : mat === 'torchis' ? 0.6 : 1);
  if (source === 'feu') return combustible(mat) ? power * (mat === 'chaume' ? 12 : 8) : 0;
  return (DAMAGE[mat][source] ?? 0) * power;
}

/** Ce qu'il faut pour réparer une pièce. */
export function repairNeeds(p: Pick<Piece, 'plan' | 'mat'>): Need[] {
  if (p.mat === 'torchis') return [['argile', 1]];
  if (p.mat === 'pierre') return [['pierre', 6]];
  if (p.mat === 'chaume') return [['herbe', 3]];
  if (p.plan === 'sol_rondins') return [['buche', 1]];
  return [['baton', 2]];
}

/**
 * Matériaux récupérés d'une pièce (démontage, effondrement) selon son état et une part
 * conservée (le reste se perd). Les pierres sont rendues en masse (kg).
 */
export function salvage(p: Pick<Piece, 'plan' | 'stilts' | 'step' | 'mat'>, keep: number): Need[] {
  const steps = stepsOf(p.plan, p.stilts).slice(0, p.step);
  const total = new Map<ItemId, number>();
  for (const st of steps) for (const [item, n] of st.needs) total.set(item, (total.get(item) ?? 0) + n);
  if (p.mat === 'torchis') total.set('argile', (total.get('argile') ?? 0) + 1);
  const out: Need[] = [];
  for (const [item, n] of total) {
    // Les ligatures se perdent ; le reste est rendu en partie.
    if (item === 'corde' || item === 'clous' || item === 'boulons' || item === 'herbe' || item === 'argile') continue;
    const k = item === 'pierre' ? Math.round(n * keep) : Math.floor(n * keep);
    if (k > 0) out.push([item, k]);
  }
  return out;
}

/** Libellé d'un besoin (« 2 perches », « 20 kg de pierres »). */
export function needLabel([item, n]: Need): string {
  if (item === 'pierre') return `${n} kg de pierres`;
  const d = ITEMS[item];
  return n > 1 ? `${n} ${d.plural}` : `${d.feminine ? 'une' : 'un'} ${d.label}`;
}

// ——— Volumes (visée, collisions) ———

/** Boîte orientée : centre, demi-dimensions et cap (rotation autour de l'axe vertical). */
export interface Box {
  x: number;
  y: number;
  z: number;
  hx: number;
  hy: number;
  hz: number;
  yaw: number;
}

/** Épaisseur d'un mur selon son matériau. */
export function wallThickness(mat: Material): number {
  return mat === 'pierre' ? 0.35 : 0.14;
}

/**
 * Volumes d'une pièce dans le monde. `solid` : seulement ce qui fait obstacle (porte ouverte :
 * le battant pivote contre le montant). Sans `solid` : le volume complet, pour la visée.
 */
export function pieceBoxes(s: Structure, p: Piece, solid = false): Box[] {
  const t = pieceTransform(s, p.slot);
  const kind = PLANS[p.plan].piece;
  const c = Math.cos(t.yaw);
  const n = Math.sin(t.yaw);
  /** Point décalé dans le repère de la pièce (lx vers la droite, lz vers l'avant). */
  const at = (lx: number, ly: number, lz: number, hx: number, hy: number, hz: number, dyaw = 0): Box => ({ x: t.x + lx * c + lz * n, y: t.y + ly, z: t.z - lx * n + lz * c, hx, hy, hz, yaw: t.yaw + dyaw });
  const H = LEVEL_H;
  switch (kind) {
    case 'sol':
      return [at(0, -0.1, 0, GRID / 2, 0.1, GRID / 2)];
    case 'dallage':
      return [at(0, -0.08, 0, GRID / 2, 0.08, GRID / 2)];
    case 'poteau':
      return [at(0, H / 2, 0, 0.1, H / 2, 0.1)];
    case 'mur': {
      const th = wallThickness(p.mat) / 2;
      return [at(0, H / 2, 0, GRID / 2, H / 2, th)];
    }
    case 'porte': {
      if (!solid) return [at(0, H / 2, 0, GRID / 2, H / 2, 0.1)];
      // Montants de 0,5 m de chaque côté, linteau au-dessus de 2 m, battant d'un mètre.
      const out = [at(-0.75, H / 2, 0, 0.25, H / 2, 0.08), at(0.75, H / 2, 0, 0.25, H / 2, 0.08), at(0, 2 + (H - 2) / 2, 0, 0.5, (H - 2) / 2, 0.08)];
      out.push(p.open ? at(-0.5, 1, 0.5, 0.04, 1, 0.5) : at(0, 1, 0, 0.5, 1, 0.04));
      return out;
    }
    case 'toit':
      return [at(0, 0.3, 0, GRID / 2 + 0.05, 0.3, GRID / 2 + 0.05)];
    case 'echelle':
      return [at(0, H / 2, 0.12, 0.3, H / 2, 0.05)];
    case 'cloture':
      return [at(0, 0.6, 0, GRID / 2, 0.6, 0.12)];
    default:
      return [];
  }
}

/** Pilotis d'un plancher : position du pied et longueur. */
export function stiltPosts(s: Structure, p: Piece, heightAt: (x: number, z: number) => number): Array<{ x: number; z: number; top: number; bottom: number }> {
  if (p.stilts <= 0 || p.slot.t !== 'f') return [];
  const out: Array<{ x: number; z: number; top: number; bottom: number }> = [];
  const top = s.y + p.slot.k * LEVEL_H - 0.2;
  for (const [a, b] of [
    [p.slot.i, p.slot.j],
    [p.slot.i + 1, p.slot.j],
    [p.slot.i, p.slot.j + 1],
    [p.slot.i + 1, p.slot.j + 1],
  ] as const) {
    // Le pied est un peu en retrait du coin, sous le plancher.
    const w = toWorld(s, (a + (a === p.slot.i ? 0.12 : -0.12)) * GRID, 0, (b + (b === p.slot.j ? 0.12 : -0.12)) * GRID);
    const h = heightAt(w.x, w.z);
    if (top - h > 0.25) out.push({ x: w.x, z: w.z, top, bottom: h - 0.3 });
  }
  return out;
}

export function siteBox(site: InstallSite): Box {
  return { x: site.x, y: site.y + 0.45, z: site.z, hx: 0.55, hy: 0.45, hz: 0.55, yaw: site.yaw };
}

/** Distance d'entrée d'un rayon dans une boîte orientée, ou null. */
export function rayBox(o: { x: number; y: number; z: number }, d: { x: number; y: number; z: number }, b: Box, max: number): number | null {
  const c = Math.cos(b.yaw);
  const n = Math.sin(b.yaw);
  const px = o.x - b.x;
  const pz = o.z - b.z;
  const lo = [px * c - pz * n, o.y - b.y, px * n + pz * c];
  const ld = [d.x * c - d.z * n, d.y, d.x * n + d.z * c];
  const h = [b.hx, b.hy, b.hz];
  let t0 = 0;
  let t1 = max;
  for (let a = 0; a < 3; a++) {
    const oa = lo[a]!;
    const da = ld[a]!;
    const ha = h[a]!;
    if (Math.abs(da) < 1e-9) {
      if (oa < -ha || oa > ha) return null;
      continue;
    }
    let ta = (-ha - oa) / da;
    let tb = (ha - oa) / da;
    if (ta > tb) [ta, tb] = [tb, ta];
    t0 = Math.max(t0, ta);
    t1 = Math.min(t1, tb);
    if (t0 > t1) return null;
  }
  return t0;
}

export type BuildTarget = { kind: 'piece'; s: string; p: number; dist: number } | { kind: 'site'; id: string; dist: number };

/** Pièce, chantier de pièce ou chantier d'installation le plus proche sur un rayon. */
export function rayBuild(bs: BuildState, o: { x: number; y: number; z: number }, d: { x: number; y: number; z: number }, max: number): BuildTarget | null {
  let best: BuildTarget | null = null;
  for (const s of bs.structures) {
    // Construction trop loin : on ne teste pas ses pièces.
    const dx = s.x - o.x;
    const dz = s.z - o.z;
    if (dx * dx + dz * dz > (max + 60) * (max + 60)) continue;
    for (const p of s.pieces) {
      for (const b of pieceBoxes(s, p)) {
        const t = rayBox(o, d, b, max);
        if (t !== null && (!best || t < best.dist)) best = { kind: 'piece', s: s.id, p: p.id, dist: t };
      }
    }
  }
  for (const site of bs.sites) {
    const t = rayBox(o, d, siteBox(site), max);
    if (t !== null && (!best || t < best.dist)) best = { kind: 'site', id: site.id, dist: t };
  }
  return best;
}

/** Plancher (terminé) sous un point, s'il y en a un juste en dessous (installations, foyers). */
export function floorUnder(bs: BuildState, x: number, y: number, z: number): { s: string; p: number; top: number } | null {
  let best: { s: string; p: number; top: number } | null = null;
  for (const s of bs.structures) {
    for (const p of s.pieces) {
      const kind = PLANS[p.plan].piece;
      if ((kind !== 'sol' && kind !== 'dallage') || !isDone(p)) continue;
      const t = pieceTransform(s, p.slot);
      const l = toLocal({ x: t.x, y: t.y, z: t.z, yaw: t.yaw }, x, y, z);
      if (Math.abs(l.x) > GRID / 2 || Math.abs(l.z) > GRID / 2) continue;
      if (y < t.y - 0.4 || y > t.y + 1.2) continue;
      if (!best || t.y > best.top) best = { s: s.id, p: p.id, top: t.y };
    }
  }
  return best;
}
