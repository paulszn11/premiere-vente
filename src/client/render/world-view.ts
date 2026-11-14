// Affichage du monde : terrain chargé progressivement par chunks autour de la caméra
// (calculé dans un fil séparé), plusieurs niveaux de détail, flore par biome (instances),
// rochers, termitières, eau, lumière, brouillard et objets déplaçables.
// Végétation organique, matériaux procéduraux et ambiance lumineuse du biome.

import { DirectionalLight } from '@babylonjs/core/Lights/directionalLight';
import { ShadowGenerator } from '@babylonjs/core/Lights/Shadows/shadowGenerator';
import { HemisphericLight } from '@babylonjs/core/Lights/hemisphericLight';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import { DynamicTexture } from '@babylonjs/core/Materials/Textures/dynamicTexture';
import { Texture } from '@babylonjs/core/Materials/Textures/texture';
import { Color3, Color4 } from '@babylonjs/core/Maths/math.color';
import { Matrix, Quaternion, Vector3 } from '@babylonjs/core/Maths/math.vector';
import { CreateCylinderVertexData } from '@babylonjs/core/Meshes/Builders/cylinderBuilder';
import { CreateSphereVertexData } from '@babylonjs/core/Meshes/Builders/sphereBuilder';
import { Mesh } from '@babylonjs/core/Meshes/mesh';
import { VertexData } from '@babylonjs/core/Meshes/mesh.vertexData';
import '@babylonjs/core/Meshes/thinInstanceMesh';
import { Scene } from '@babylonjs/core/scene';
import { CHUNK_SIZE, WATER_LEVEL } from '../../shared/constants';
import type { PropView } from '../../shared/interaction';
import type { PropKind } from '../../shared/props';
import { type Terrain, chunkCoord, chunkKey } from '../../shared/terrain';
import { hash32 } from '../../shared/rng';
import { type ChunkFlora, SPECIES, SPECIES_LIST, type Species } from '../../shared/vegetation';
import type { QualityParams } from '../settings';
import { type Wind, waveDepthFactor, waveHeight } from '../../shared/wind';
import { buildItemMesh } from './item-meshes';
import type { ChunkJobResult, TerrainJobs } from './terrain-jobs';

const SKY = new Color3(0.42, 0.66, 0.88);
const GRASS_GOLD: [number, number, number] = [0.66, 0.48, 0.25];
const GRASS_OLIVE: [number, number, number] = [0.35, 0.43, 0.2];

/** Objets affichés à leur taille réelle (les bâtons, bûches, branches et perches utilisent la forme des bûches). */
const ITEM_RENDER_KINDS: PropKind[] = [
  'chiffon',
  'aloes',
  'fruit_baobab',
  'figue',
  'muhacha',
  'sac',
  'corps',
  'quartz',
  'ecorce',
  'fibres',
  'corde',
  'herbe',
  'ilala',
  'argile',
  'resine',
  'minerai_fer',
  'pepite_or',
  'couteau',
  'hache',
  'baton_fouir',
  'lance',
  'archet',
  'pot_cru',
  'pot',
  'batee',
  'pansement',
  'foyer',
  'torche',
  'loupe_fer',
  'barre_fer',
  'clous',
  'boulons',
  'hache_fer',
  'couteau_fer',
  'coffre',
  'etabli',
  'puits',
  'fourneau',
  'forge',
  // Phase 6 : viande et pièges (les carcasses sont dessinées par l'affichage des créatures).
  'viande_crue',
  'viande_cuite',
  'collet',
  'assommoir',
  'fosse',
  // Phase 7 : pièces de véhicules.
  'petite_roue',
  'roue',
  'essieu',
  'machine_vapeur',
  'roue_aubes',
  'gouvernail',
  // Machines.
  'roue_eau',
  'machine_fixe',
  'meule',
  'soufflet_meca',
  'pompe',
];
const NODE_RENDER_KINDS: PropKind[] = ['bloc_quartz', 'filon_fer', 'touffe_herbe', 'gisement_argile', 'gravier_or'];
const UNDERWATER = new Color3(0.05, 0.2, 0.24);

interface ChunkRecord {
  cells: number;
  mesh: Mesh;
}

interface Desired {
  cx: number;
  cz: number;
  cells: number;
  dist: number;
  flora: boolean;
}

export interface WorldViewStats {
  chunks: number;
  pending: number;
  trees: number;
  vertices: number;
}

type Part = [VertexData, number, number, number];

function colored(vd: VertexData, r: number, g: number, b: number): VertexData {
  const count = vd.positions!.length / 3;
  const colors = new Float32Array(count * 4);
  for (let i = 0; i < count; i++) colors.set([r, g, b, 1], i * 4);
  vd.colors = colors;
  return vd;
}

function cyl(height: number, top: number, bottom: number, tess: number, y: number): VertexData {
  const vd = CreateCylinderVertexData({ height, diameterTop: top, diameterBottom: bottom, tessellation: tess });
  vd.transform(Matrix.Translation(0, y, 0));
  return vd;
}

/** Sphère organique légèrement irrégulière : évite les houppiers et rochers parfaitement géométriques. */
function organicBall(dx: number, dy: number, dz: number, segments: number, x: number, y: number, z: number, seed: number, roughness = 0.09): VertexData {
  const vd = CreateSphereVertexData({ diameterX: dx, diameterY: dy, diameterZ: dz, segments });
  const pos = vd.positions!;
  for (let i = 0; i < pos.length; i += 3) {
    const px = pos[i]! / (dx * 0.5);
    const py = pos[i + 1]! / (dy * 0.5);
    const pz = pos[i + 2]! / (dz * 0.5);
    const wave = Math.sin(px * 7.1 + seed) * Math.cos(pz * 5.7 - seed * 0.7) * 0.45
      + Math.sin(py * 8.3 + pz * 4.1 + seed * 1.3) * 0.35
      + Math.cos(px * 11.2 - py * 6.4 + seed) * 0.2;
    const k = 1 + wave * roughness;
    pos[i] = px * dx * 0.5 * k;
    pos[i + 1] = py * dy * 0.5 * k;
    pos[i + 2] = pz * dz * 0.5 * k;
  }
  const normals = new Float32Array(pos.length);
  VertexData.ComputeNormals(pos, vd.indices!, normals);
  vd.normals = normals;
  vd.transform(Matrix.Translation(x, y, z));
  return vd;
}

/** Texture procédurale multicouche : motifs organiques sans couture, sans asset externe. */
function makeNoiseTexture(name: string, scene: Scene, kind: 'ground' | 'bark' | 'foliage' | 'rock', size: number, aniso: number): DynamicTexture {
  // Les motifs sont définis en pixels pour une texture de 1024 : on garde le même dessin à toute taille.
  const k = 1024 / size;
  const tex = new DynamicTexture(name, { width: size, height: size }, scene, true, Texture.TRILINEAR_SAMPLINGMODE);
  const ctx = tex.getContext();
  const image = (ctx as unknown as CanvasRenderingContext2D).createImageData(size, size);
  let seed = kind === 'ground' ? 1907 : kind === 'bark' ? 3719 : kind === 'foliage' ? 5311 : 7127;
  const rand = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
  const clamp = (v: number) => Math.max(0, Math.min(255, v));
  for (let py = 0; py < size; py++) for (let px = 0; px < size; px++) {
    const i = (py * size + px) * 4;
    const x = px * k, y = py * k;
    // Plusieurs fréquences périodiques : le raccord des bords reste invisible.
    const macro = Math.sin(x * 0.018 + Math.sin(y * 0.013) * 2.4) * 8
      + Math.cos(y * 0.024 + Math.sin(x * 0.017) * 1.8) * 6;
    const mid = Math.sin(x * 0.115 + Math.cos(y * 0.083) * 1.7) * 4.5
      + Math.cos(y * 0.137 - x * 0.047) * 3.5;
    const micro = Math.sin(x * 0.71 + Math.cos(y * 0.39) * 2.1) * 2.8
      + Math.cos(y * 0.83 + x * 0.29) * 2.1;
    const ultraFine = Math.sin(x * 1.73 + Math.cos(y * 1.19) * 1.4) * 1.55
      + Math.cos(y * 1.91 - x * 0.77) * 1.25 + (rand() - 0.5) * 3.8;
    const grain = (rand() - 0.5) * (kind === 'foliage' ? 31 : 25) + macro + mid + micro + ultraFine;
    let r = 128 + grain, g = 128 + grain, b = 128 + grain;
    if (kind === 'ground') {
      // Terre ocre, zones de poussière claire et petites inclusions minérales.
      const dust = Math.sin(x * 0.041 + Math.sin(y * 0.029) * 2.8) * 7;
      const pebble = Math.pow(Math.max(0, Math.sin(x * 0.31 + Math.sin(y * 0.27) * 2) * Math.cos(y * 0.35 - x * 0.08)), 8) * 19
        + Math.pow(Math.max(0, Math.sin(x * 0.91 + y * 0.43) * Math.cos(y * 0.77 - x * 0.24)), 13) * 13;
      const darkSoil = Math.pow(Math.max(0, Math.sin(x * 0.052 + y * 0.033) * Math.cos(y * 0.047 - x * 0.021)), 5) * 13;
      r = 151 + grain + dust + pebble - darkSoil * 0.65;
      g = 119 + grain * 0.78 + dust * 0.7 + pebble * 0.78 - darkSoil * 0.72;
      b = 79 + grain * 0.58 + dust * 0.38 + pebble * 0.58 - darkSoil * 0.55;
    } else if (kind === 'bark') {
      // Fibres verticales, crevasses et alternance d'écorce sèche.
      const groove = Math.sin(x * 0.16 + Math.sin(y * 0.022) * 2.6) * 13
        + Math.sin(x * 0.43 + Math.cos(y * 0.014) * 1.8) * 7;
      const fissure = Math.pow(Math.max(0, Math.sin(x * 0.29 + Math.sin(y * 0.06) * 2.2)), 12) * 24;
      r = 111 + grain + groove - fissure;
      g = 72 + grain * 0.68 + groove * 0.63 - fissure * 0.72;
      b = 43 + grain * 0.42 + groove * 0.34 - fissure * 0.45;
    } else if (kind === 'foliage') {
      // Taches de chlorophylle et silhouettes de petites feuilles en grappes.
      const cluster = Math.sin(x * 0.067 + Math.cos(y * 0.052) * 2.5) * 11
        + Math.cos(y * 0.091 + Math.sin(x * 0.044) * 2) * 8;
      const leaf = Math.pow(Math.max(0, Math.sin(x * 0.24 + y * 0.13) * Math.cos(y * 0.21 - x * 0.09)), 5) * 17;
      r = 66 + grain + cluster * 0.72 + leaf * 0.58;
      g = 104 + grain + cluster + leaf;
      b = 43 + grain * 0.55 + cluster * 0.43 + leaf * 0.36;
    } else {
      // Granite patiné : grains clairs, minéraux sombres et veines diffuses.
      const mineral = Math.sin(x * 0.19 + Math.sin(y * 0.12) * 2) * 11
        + Math.cos(y * 0.27 - x * 0.11) * 8;
      const fleck = Math.pow(Math.max(0, Math.sin(x * 0.51 + y * 0.37) * Math.cos(y * 0.43 - x * 0.17)), 7) * 28
        + Math.pow(Math.max(0, Math.sin(x * 1.07 - y * 0.62) * Math.cos(y * 0.91 + x * 0.33)), 12) * 18;
      const vein = Math.sin((x + y * 0.31) * 0.047 + Math.sin(y * 0.04) * 2) * 5;
      r = 133 + grain + mineral + fleck + vein;
      g = 124 + grain * 0.92 + mineral * 0.95 + fleck * 0.88 + vein;
      b = 108 + grain * 0.78 + mineral * 0.76 + fleck * 0.7 + vein * 0.8;
    }
    image.data[i] = clamp(r); image.data[i + 1] = clamp(g); image.data[i + 2] = clamp(b); image.data[i + 3] = 255;
  }
  ctx.putImageData(image, 0, 0);
  // Fine dust / speckles drawn as soft, seamless details over the pixel layers.
  if (kind === 'ground' || kind === 'rock' || kind === 'foliage') {
    const speckles = Math.round(9000 / (k * k));
    for (let n = 0; n < speckles; n++) {
      const x = rand() * size, y = rand() * size;
      const radius = (kind === 'foliage' ? 0.45 + rand() * 1.25 : 0.35 + rand() * 1.05) / Math.sqrt(k);
      const light = rand() > 0.48;
      ctx.fillStyle = kind === 'foliage'
        ? (light ? 'rgba(177,166,83,0.17)' : 'rgba(24,48,20,0.19)')
        : (light ? 'rgba(255,226,174,0.19)' : 'rgba(55,42,29,0.16)');
      ctx.beginPath(); ctx.arc(x, y, radius, 0, Math.PI * 2); ctx.fill();
    }
  }
  tex.update(false);
  tex.wrapU = Texture.WRAP_ADDRESSMODE; tex.wrapV = Texture.WRAP_ADDRESSMODE;
  tex.anisotropicFilteringLevel = aniso;
  return tex;
}

/** Carte de relief tangentielle calculée depuis la texture de couleur : micro-grain visible sous la lumière rasante. */
function makeNormalTexture(name: string, source: DynamicTexture, scene: Scene, strength: number): DynamicTexture {
  const size = source.getSize().width;
  const src = source.getContext().getImageData(0, 0, size, size).data;
  const height = new Float32Array(size * size);
  for (let i = 0; i < height.length; i++) {
    const o = i * 4;
    height[i] = (src[o]! * 0.299 + src[o + 1]! * 0.587 + src[o + 2]! * 0.114) / 255;
  }
  const tex = new DynamicTexture(name, { width: size, height: size }, scene, false, Texture.TRILINEAR_SAMPLINGMODE);
  const ctx = tex.getContext();
  const image = (ctx as unknown as CanvasRenderingContext2D).createImageData(size, size);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const xm = (x + size - 1) % size, xp = (x + 1) % size;
    const ym = (y + size - 1) % size, yp = (y + 1) % size;
    const dx = (height[y * size + xp]! - height[y * size + xm]!) * strength;
    const dy = (height[yp * size + x]! - height[ym * size + x]!) * strength;
    const nx = -dx, ny = -dy, nz = 1;
    const inv = 1 / Math.hypot(nx, ny, nz);
    const i = (y * size + x) * 4;
    image.data[i] = Math.round((nx * inv * 0.5 + 0.5) * 255);
    image.data[i + 1] = Math.round((ny * inv * 0.5 + 0.5) * 255);
    image.data[i + 2] = Math.round((nz * inv * 0.5 + 0.5) * 255);
    image.data[i + 3] = 255;
  }
  ctx.putImageData(image, 0, 0);
  tex.update(false);
  tex.wrapU = Texture.WRAP_ADDRESSMODE;
  tex.wrapV = Texture.WRAP_ADDRESSMODE;
  tex.anisotropicFilteringLevel = 8;
  return tex;
}

/** Textures d'eau périodiques : micro-ondulations et reflets lumineux doux, sans image externe. */
function makeWaterTextures(scene: Scene, size: number, aniso: number): { color: DynamicTexture; normal: DynamicTexture } {
  const height = new Float32Array(size * size);
  const color = new DynamicTexture('nuances de surface de l eau', { width: size, height: size }, scene, true, Texture.TRILINEAR_SAMPLINGMODE);
  const colorCtx = color.getContext();
  const colorImage = (colorCtx as unknown as CanvasRenderingContext2D).createImageData(size, size);
  for (let y = 0; y < size; y++) {
    const v = (y / size) * Math.PI * 2;
    for (let x = 0; x < size; x++) {
      const u = (x / size) * Math.PI * 2;
      const h =
        Math.sin(3 * u + Math.sin(2 * v) * 0.65) * 0.34 +
        Math.sin(7 * v - 2 * u + Math.sin(u * 2)) * 0.2 +
        Math.sin(13 * u + 11 * v) * 0.075 +
        Math.sin(21 * v - 4 * u) * 0.035;
      const i = y * size + x;
      height[i] = h;
      const glint = Math.max(0, Math.sin(9 * u + 5 * v + h * 8) - 0.83) * 34;
      const shade = h * 13 + Math.sin(2 * u - 3 * v) * 5;
      const o = i * 4;
      colorImage.data[o] = Math.max(0, Math.min(255, 24 + shade + glint * 0.48));
      colorImage.data[o + 1] = Math.max(0, Math.min(255, 91 + shade * 1.2 + glint));
      colorImage.data[o + 2] = Math.max(0, Math.min(255, 112 + shade * 1.25 + glint * 1.12));
      colorImage.data[o + 3] = 255;
    }
  }
  colorCtx.putImageData(colorImage, 0, 0);
  color.update(false);

  const normal = new DynamicTexture('micro relief des ondulations', { width: size, height: size }, scene, false, Texture.TRILINEAR_SAMPLINGMODE);
  const normalCtx = normal.getContext();
  const normalImage = (normalCtx as unknown as CanvasRenderingContext2D).createImageData(size, size);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const xm = (x + size - 1) % size, xp = (x + 1) % size;
    const ym = (y + size - 1) % size, yp = (y + 1) % size;
    const dx = (height[y * size + xp]! - height[y * size + xm]!) * 3.4;
    const dy = (height[yp * size + x]! - height[ym * size + x]!) * 3.4;
    const inv = 1 / Math.hypot(dx, dy, 1);
    const o = (y * size + x) * 4;
    normalImage.data[o] = Math.round((-dx * inv * 0.5 + 0.5) * 255);
    normalImage.data[o + 1] = Math.round((-dy * inv * 0.5 + 0.5) * 255);
    normalImage.data[o + 2] = Math.round((inv * 0.5 + 0.5) * 255);
    normalImage.data[o + 3] = 255;
  }
  normalCtx.putImageData(normalImage, 0, 0);
  normal.update(false);
  for (const texture of [color, normal]) {
    texture.wrapU = Texture.WRAP_ADDRESSMODE;
    texture.wrapV = Texture.WRAP_ADDRESSMODE;
    texture.anisotropicFilteringLevel = aniso;
  }
  color.level = 0.72;
  return { color, normal };
}

/** Un brin plat effilé et légèrement courbé (5 sommets par face, deux faces) : ~16 fois moins lourd qu'un cylindre. */
function bladeVertexData(h: number, w: number, bend: number): VertexData {
  const pos = [-w / 2, 0, 0, w / 2, 0, 0, -w * 0.32, h * 0.55, bend * 0.35, w * 0.32, h * 0.55, bend * 0.35, 0, h, bend];
  const ind = [0, 1, 2, 2, 1, 3, 2, 3, 4];
  const positions: number[] = [...pos, ...pos];
  const indices: number[] = [...ind, ...ind.map((i) => i + 5)];
  // Seconde face : ordre inversé pour être visible des deux côtés sans désactiver le tri des faces.
  for (let t = 9; t < 18; t += 3) { const a = indices[t + 1]!; indices[t + 1] = indices[t + 2]!; indices[t + 2] = a; }
  // Normales tournées vers le ciel : éclairage doux et homogène, comme une vraie touffe.
  const normals: number[] = [];
  for (let v = 0; v < 10; v++) normals.push(0, 0.92, v < 5 ? -0.38 : 0.38);
  const uvs = [0, 0, 1, 0, 0.18, 0.55, 0.82, 0.55, 0.5, 1];
  const vd = new VertexData();
  vd.positions = positions;
  vd.indices = indices;
  vd.normals = normals;
  vd.uvs = [...uvs, ...uvs];
  return vd;
}

function grassClumpParts(dry: boolean, tall = false): Part[] {
  const parts: Part[] = [];
  const colors = dry ? [GRASS_GOLD, [0.76, 0.58, 0.31] as [number, number, number], [0.48, 0.4, 0.23] as [number, number, number]]
    : [GRASS_OLIVE, [0.43, 0.52, 0.25] as [number, number, number], [0.57, 0.53, 0.28] as [number, number, number]];
  // Brins fins et irréguliers ; la variante haute forme un écran végétal.
  const bladeCount = tall ? 14 : 11;
  for (let k = 0; k < bladeCount; k++) {
    const a = (k / bladeCount) * Math.PI * 2 + (k % 3) * 0.17;
    const h = (tall ? 1.02 : 0.52) + ((k * 7) % 7) * (tall ? 0.205 : 0.16);
    const lean = 0.22 + ((k * 3) % 5) * 0.105;
    const blade = bladeVertexData(h, 0.05 + (k % 3) * 0.012, lean * h * 0.55);
    const r = 0.08 + lean * 0.12;
    blade.transform(Matrix.RotationY(-a + Math.PI / 2).multiply(Matrix.Translation(Math.cos(a) * r, 0, Math.sin(a) * r)));
    parts.push([blade, ...colors[k % colors.length]!]);
  }
  return parts;
}

/** Silhouettes plus naturelles : troncs ramifiés et houppiers composés de plusieurs masses organiques. */
function speciesParts(sp: Species): Part[] {
  const trunk: [number, number, number] = [0.31, 0.22, 0.14];
  const leafA: [number, number, number] = [0.22, 0.34, 0.15];
  const leafB: [number, number, number] = [0.3, 0.39, 0.17];
  const branch = (len: number, radius: number, x: number, y: number, z: number, rz: number, rx: number): VertexData => {
    const vd = CreateCylinderVertexData({ height: len, diameterTop: radius * 0.55, diameterBottom: radius, tessellation: 6 });
    vd.transform(Matrix.RotationX(rx).multiply(Matrix.RotationZ(rz)).multiply(Matrix.Translation(x, y + len * 0.5, z)));
    return vd;
  };
  switch (sp) {
    case 'miombo':
      return [
        [cyl(4.4, 0.22, 0.42, 7, 2.2), ...trunk],
        [branch(2.1, 0.18, -0.35, 2.8, 0, -0.42, 0.08), ...trunk],
        [branch(1.9, 0.16, 0.34, 2.9, 0.08, 0.4, -0.06), ...trunk],
        [organicBall(3.2, 2.2, 3.1, 10, -0.75, 4.6, 0.1, 2), ...leafA],
        [organicBall(3.5, 2.4, 3.3, 10, 0.75, 4.8, -0.1, 4), ...leafB],
        [organicBall(2.6, 2, 2.8, 9, 0, 5.35, 0.3, 6), ...leafA],
      ];
    case 'mopane':
      return [
        [cyl(3.6, 0.2, 0.34, 7, 1.8), ...trunk],
        [branch(1.35, 0.13, -0.25, 2.55, 0, -0.55, 0), ...trunk],
        [branch(1.45, 0.13, 0.25, 2.6, 0.05, 0.52, 0), ...trunk],
        [organicBall(2.5, 2.1, 2.5, 9, -0.5, 4.0, 0, 8), ...leafA],
        [organicBall(2.5, 2.2, 2.5, 9, 0.55, 4.05, 0, 9), ...leafB],
      ];
    case 'baobab':
      return [
        [cyl(6.2, 1.65, 2.35, 12, 3.1), 0.5, 0.42, 0.34],
        [organicBall(2.2, 1.5, 2.1, 9, 0.8, 6.6, 0, 12), ...leafA],
        [organicBall(2.1, 1.4, 2.1, 9, -0.85, 6.5, 0.4, 13), ...leafA],
        [organicBall(2.0, 1.35, 2.0, 9, 0.05, 6.6, -0.8, 14), ...leafB],
      ];
    case 'acacia':
      return [
        [cyl(3.25, 0.16, 0.28, 7, 1.62), ...trunk],
        [branch(2.25, 0.12, -0.25, 2.25, 0, -0.58, 0), ...trunk],
        [branch(2.1, 0.12, 0.25, 2.3, 0.05, 0.58, 0), ...trunk],
        [branch(1.75, 0.1, 0, 2.8, -0.12, 0.05, -0.5), ...trunk],
        [organicBall(4.8, 0.95, 3.9, 12, 0, 4.25, 0, 21, 0.12), 0.24, 0.36, 0.15],
        [organicBall(2.9, 0.8, 2.6, 10, -1.15, 4.35, 0.05, 22), 0.29, 0.4, 0.17],
        [organicBall(2.8, 0.78, 2.6, 10, 1.15, 4.32, -0.05, 23), 0.27, 0.38, 0.16],
      ];
    case 'teck':
      return [
        [cyl(7.1, 0.28, 0.42, 8, 3.55), ...trunk],
        [branch(2.0, 0.16, -0.35, 5.2, 0, -0.45, 0), ...trunk],
        [branch(1.9, 0.16, 0.35, 5.25, 0, 0.45, 0), ...trunk],
        [organicBall(3.8, 3.6, 3.8, 10, 0, 7.6, 0, 31), ...leafB],
      ];
    case 'montagne':
      return [
        [cyl(6.2, 0.4, 0.58, 8, 3.1), ...trunk],
        [organicBall(4.2, 4.1, 4.2, 10, 0, 7, 0, 32), 0.2, 0.34, 0.17],
        [organicBall(3.0, 3.1, 3.0, 9, -1.0, 7.25, 0.4, 33), 0.25, 0.38, 0.18],
      ];
    case 'palmier':
      return [
        [cyl(6.2, 0.2, 0.32, 8, 3.1), 0.42, 0.34, 0.23],
        [organicBall(1.45, 1.1, 1.45, 8, 0, 6.35, 0, 40), 0.3, 0.42, 0.18],
        ...Array.from({ length: 7 }, (_, i) => {
          const a = (i / 7) * Math.PI * 2;
          const vd = CreateCylinderVertexData({ height: 3.1, diameterTop: 0.015, diameterBottom: 0.12, tessellation: 4 });
          vd.transform(Matrix.RotationZ(Math.cos(a) * 0.95).multiply(Matrix.RotationX(Math.sin(a) * 0.95)).multiply(Matrix.Translation(Math.cos(a) * 1.15, 6.95, Math.sin(a) * 1.15)));
          return [vd, 0.28 + (i % 2) * 0.04, 0.42, 0.18] as Part;
        }),
      ];
    case 'figuier':
      return [
        [cyl(5.1, 0.48, 0.78, 9, 2.55), ...trunk],
        [branch(2.5, 0.18, -0.6, 3.7, 0, -0.48, 0), ...trunk],
        [branch(2.4, 0.18, 0.55, 3.75, 0.1, 0.48, 0), ...trunk],
        [organicBall(4.1, 3.6, 4.1, 10, 0, 6.0, 0, 45), 0.2, 0.35, 0.16],
        [organicBall(3.1, 2.8, 3.0, 9, -1.1, 6.2, 0.2, 46), 0.24, 0.39, 0.18],
        [organicBall(3.1, 2.8, 3.0, 9, 1.1, 6.15, -0.2, 47), 0.22, 0.37, 0.17],
      ];
  }
}

function buildMesh(name: string, scene: Scene, material: StandardMaterial, parts: Part[]): Mesh {
  const [first, ...rest] = parts.map(([vd, r, g, b]) => colored(vd, r, g, b));
  const merged = rest.length ? first!.merge(rest, true) : first!;
  const mesh = new Mesh(name, scene);
  merged.applyToMesh(mesh, false);
  mesh.material = material;
  mesh.isPickable = false;
  mesh.hasVertexAlpha = false;
  mesh.alwaysSelectAsActiveMesh = true;
  mesh.isVisible = false;
  return mesh;
}

/** Couche dense (herbe, fleurs, cailloux) : trop nombreuse pour projeter des ombres. */
const DENSE_NO_SHADOW = new Set(['herbe', 'herbe-seche', 'herbe-haute', 'herbe-haute-seche', 'fleur-rouge', 'fleur-jaune', 'fleur-blanche', 'caillou']);

/**
 * Densité de la couche décorative selon le rayon de végétation (1 = Basse … 4 = Ultra).
 * grass/pebble : grille par chunk de 64 m, seulement près du joueur (anneau `near`) ;
 * thicket : grille par chunk sur tout le rayon de végétation.
 */
function denseLayout(tier: number): { grass: number; pebble: number; thicket: number; near: number } {
  if (tier <= 1) return { grass: 14, pebble: 8, thicket: 5, near: 1 };
  if (tier === 2) return { grass: 18, pebble: 9, thicket: 5, near: 1 };
  if (tier === 3) return { grass: 24, pebble: 12, thicket: 6, near: 2 };
  return { grass: 30, pebble: 16, thicket: 7, near: 2 };
}

/** Instance décorative calculée une fois par chunk (type, position, rotation, échelle). */
type DenseInstance = [type: string, x: number, y: number, z: number, yaw: number, sx: number, sy: number, sz: number];

const m = new Matrix();
const q = new Quaternion();
const sv = new Vector3();
const pv = new Vector3();

function writeMatrix(buf: Float32Array, i: number, x: number, y: number, z: number, yawTurns: number, sx: number, sy: number, sz: number): void {
  Quaternion.RotationYawPitchRollToRef(yawTurns * Math.PI * 2, 0, 0, q);
  sv.set(sx, sy, sz);
  pv.set(x, y, z);
  Matrix.ComposeToRef(sv, q, pv, m);
  m.copyToArray(buf, i * 16);
}

export class WorldView {
  private readonly material: StandardMaterial;
  private readonly vegetationMaterial: StandardMaterial;
  private readonly rockMaterial: StandardMaterial;
  private readonly skyDome: Mesh;
  private readonly shadowGenerator: ShadowGenerator | null;
  private readonly waterMaterial: StandardMaterial;
  private readonly water: Mesh;
  private readonly waterColorTexture: DynamicTexture;
  private readonly waterNormalTexture: DynamicTexture;
  private readonly flora = new Map<string, Mesh>();
  private readonly stoneMesh: Mesh;
  private readonly logMesh: Mesh;
  /** Petits objets, sacs posés et corps (une forme par type, à l'échelle réelle). */
  private readonly itemMeshes = new Map<PropKind, Mesh>();
  /** Gisements (taille 1, mis à l'échelle). */
  private readonly nodeMeshes = new Map<PropKind, Mesh>();
  private readonly flameMesh: Mesh;
  private readonly smokeMesh: Mesh;
  /** Arbre abattu : on affiche sa souche à la place (fourni par la session). */
  treeFelled: ((cx: number, cz: number, index: number) => boolean) | null = null;
  private readonly chunks = new Map<string, ChunkRecord>();
  private readonly floraCache = new Map<string, ChunkFlora>();
  /** Couche dense déjà calculée, par chunk (clé : chunk + niveau de détail). */
  private readonly denseCache = new Map<string, DenseInstance[]>();
  private desired = new Map<string, Desired>();
  private readonly requested = new Set<string>();
  private readonly heightRequested = new Set<string>();
  private readonly ready: ChunkJobResult[] = [];
  private centerKey = '';
  private center = { cx: 0, cz: 0 };
  private vegetationDirty = true;
  private treeCount = 0;
  private underwater = false;
  private params: QualityParams;

  constructor(
    private readonly scene: Scene,
    private readonly terrain: Terrain,
    private readonly jobs: TerrainJobs,
    params: QualityParams,
  ) {
    this.params = params;
    // Taille des textures procédurales : 512 en Basse/Moyenne (démarrage rapide sur téléphone), 1024 au-delà.
    // Textures procédurales en 1024 et relief fin à toutes les qualités (priorité au rendu ; optimisation prévue plus tard).
    const texSize = 1024;
    const aniso = 8;
    scene.clearColor = new Color4(SKY.r, SKY.g, SKY.b, 1);
    scene.ambientColor = new Color3(0.12, 0.12, 0.1);
    scene.fogMode = Scene.FOGMODE_LINEAR;
    scene.fogColor = SKY.clone();
    scene.skipPointerMovePicking = true;

    const sky = new HemisphericLight('ciel', new Vector3(0, 1, 0), scene);
    sky.intensity = 0.92;
    sky.groundColor = new Color3(0.34, 0.29, 0.22);
    const sun = new DirectionalLight('soleil', new Vector3(-0.42, -1, -0.28), scene);
    sun.position.set(120, 180, 90);
    sun.intensity = 0.78;

    // Dôme céleste procédural : ciel bleu profond et nuages blancs doux, sans asset externe.
    const skyTexture = new DynamicTexture('ciel nuageux', { width: 512, height: 256 }, scene, true, Texture.TRILINEAR_SAMPLINGMODE);
    const skyCtx = skyTexture.getContext();
    const gradient = skyCtx.createLinearGradient(0, 0, 0, 256);
    gradient.addColorStop(0, '#347ec5'); gradient.addColorStop(0.55, '#70b2e8'); gradient.addColorStop(1, '#d0e7f5');
    skyCtx.fillStyle = gradient; skyCtx.fillRect(0, 0, 512, 256);
    let cloudSeed = 2468;
    const cloudRand = () => { cloudSeed = (cloudSeed * 1664525 + 1013904223) >>> 0; return cloudSeed / 4294967296; };
    for (let c = 0; c < 14; c++) {
      const cx = cloudRand() * 560 - 24, cy = 28 + cloudRand() * 135, radius = 18 + cloudRand() * 35;
      for (let l = 0; l < 9; l++) {
        const x = cx + (cloudRand() - 0.5) * radius * 2.5, y = cy + (cloudRand() - 0.5) * radius * 0.75;
        const r = radius * (0.45 + cloudRand() * 0.65);
        const g = skyCtx.createRadialGradient(x, y, r * 0.12, x, y, r);
        g.addColorStop(0, 'rgba(255,255,255,0.6)'); g.addColorStop(0.62, 'rgba(255,255,255,0.28)'); g.addColorStop(1, 'rgba(255,255,255,0)');
        skyCtx.fillStyle = g; skyCtx.beginPath(); skyCtx.arc(x, y, r, 0, Math.PI * 2); skyCtx.fill();
      }
    }
    skyTexture.update(false); skyTexture.wrapU = Texture.WRAP_ADDRESSMODE;
    // Les UV de la sphère vont du bas vers le haut : on retourne la texture pour avoir le bleu profond au zénith.
    skyTexture.wrapV = Texture.WRAP_ADDRESSMODE; skyTexture.vScale = -1;
    const skyMat = new StandardMaterial('matiere ciel', scene);
    skyMat.disableLighting = true; skyMat.backFaceCulling = false; skyMat.disableDepthWrite = true;
    skyMat.emissiveTexture = skyTexture; skyMat.diffuseColor = new Color3(0, 0, 0); skyMat.specularColor = new Color3(0, 0, 0);
    this.skyDome = new Mesh('dome du ciel', scene);
    // Sphère unité mise à l'échelle de la distance d'affichage : elle doit rester en deçà du plan lointain de la caméra.
    CreateSphereVertexData({ diameter: 2, segments: 32 }).applyToMesh(this.skyDome, false);
    this.skyDome.applyFog = false;
    this.skyDome.material = skyMat; this.skyDome.isPickable = false; this.skyDome.infiniteDistance = true;
    this.skyDome.alwaysSelectAsActiveMesh = true;

    this.material = new StandardMaterial('materiau terrain et objets', scene);
    this.material.diffuseColor = new Color3(1, 1, 1);
    this.material.specularColor = new Color3(0.035, 0.03, 0.02);
    this.material.specularPower = 24;
    const groundTexture = makeNoiseTexture('grain du sol', scene, 'ground', texSize, aniso);
    groundTexture.level = 1.45;
    this.material.diffuseTexture = groundTexture;
    this.material.bumpTexture = makeNormalTexture('relief fin du sol', groundTexture, scene, 3.1);
    this.material.bumpTexture.level = 0.62;
    this.vegetationMaterial = new StandardMaterial('materiau vegetation', scene);
    this.vegetationMaterial.diffuseColor = new Color3(1, 1, 1);
    this.vegetationMaterial.specularColor = new Color3(0.025, 0.03, 0.018);
    this.vegetationMaterial.specularPower = 12;
    const foliageTexture = makeNoiseTexture('grain des feuilles', scene, 'foliage', texSize, aniso);
    foliageTexture.level = 2.1;
    this.vegetationMaterial.diffuseTexture = foliageTexture;
    this.vegetationMaterial.bumpTexture = makeNormalTexture('relief des feuillages', foliageTexture, scene, 2.0);
    this.vegetationMaterial.bumpTexture.level = 0.3;
    this.rockMaterial = new StandardMaterial('materiau roche', scene);
    this.rockMaterial.diffuseColor = new Color3(1, 1, 1);
    this.rockMaterial.specularColor = new Color3(0.12, 0.11, 0.09);
    this.rockMaterial.specularPower = 18;
    const rockTexture = makeNoiseTexture('grain du granite', scene, 'rock', texSize, aniso);
    rockTexture.level = 1.8;
    this.rockMaterial.diffuseTexture = rockTexture;
    this.rockMaterial.bumpTexture = makeNormalTexture('relief des roches', rockTexture, scene, 4.2);
    this.rockMaterial.bumpTexture.level = 0.82;

    this.waterMaterial = new StandardMaterial('eau', scene);
    const waterTextures = makeWaterTextures(scene, texSize >= 1024 ? 512 : 256, aniso);
    this.waterColorTexture = waterTextures.color;
    this.waterNormalTexture = waterTextures.normal;
    this.waterMaterial.diffuseColor = new Color3(0.78, 0.9, 0.94);
    this.waterMaterial.diffuseTexture = this.waterColorTexture;
    this.waterMaterial.bumpTexture = this.waterNormalTexture;
    this.waterNormalTexture.level = 0.72;
    // Reflets spéculaires plus nets, avec une transparence réduite pour garder la profondeur visible.
    this.waterMaterial.specularColor = new Color3(0.82, 0.91, 0.96);
    this.waterMaterial.specularPower = 112;
    this.waterMaterial.alpha = 0.91;
    this.waterMaterial.backFaceCulling = false;
    this.water = new Mesh('eau', scene);
    this.water.material = this.waterMaterial;
    this.water.position.y = WATER_LEVEL;
    this.water.isPickable = false;
    this.water.alwaysSelectAsActiveMesh = true;

    for (const sp of SPECIES_LIST) this.flora.set(sp, buildMesh(`arbre ${sp}`, scene, this.vegetationMaterial, speciesParts(sp)));
    this.flora.set('buisson', buildMesh('buissons', scene, this.vegetationMaterial, [[organicBall(1.8, 1.1, 1.8, 8, -0.38, 0.38, 0, 61), 0.24, 0.38, 0.16], [organicBall(1.5, 1.0, 1.5, 8, 0.45, 0.34, 0.12, 62), 0.31, 0.44, 0.19], [organicBall(1.2, 0.9, 1.3, 8, 0, 0.52, -0.45, 63), 0.27, 0.4, 0.17]]));
    this.flora.set('buisson-sec', buildMesh('buissons secs', scene, this.vegetationMaterial, [[organicBall(1.8, 1.05, 1.8, 8, -0.35, 0.36, 0, 64), 0.53, 0.43, 0.27], [organicBall(1.3, 0.85, 1.4, 8, 0.42, 0.3, 0.1, 65), 0.62, 0.51, 0.32]]));
    this.flora.set('fourre-dense', buildMesh('fourres denses', scene, this.vegetationMaterial, [
      [organicBall(2.2, 1.55, 2.0, 6, -0.55, 0.9, 0, 81), 0.24, 0.34, 0.14],
      [organicBall(2.0, 1.7, 1.9, 6, 0.62, 1.05, 0.18, 82), 0.29, 0.38, 0.16],
      [organicBall(1.9, 1.6, 2.1, 6, 0.05, 1.42, -0.55, 83), 0.34, 0.41, 0.18],
      [organicBall(1.55, 1.35, 1.65, 5, -0.9, 1.75, 0.55, 84), 0.22, 0.32, 0.13],
      [organicBall(1.6, 1.25, 1.7, 5, 0.92, 1.82, -0.45, 85), 0.31, 0.4, 0.17],
    ]));
    this.flora.set('rocher', buildMesh('rochers', scene, this.rockMaterial, [[organicBall(2.15, 1.55, 2.25, 10, 0, 0, 0, 70, 0.17), 0.62, 0.58, 0.51]]));
    // Petits cailloux du semis dense : géométrie simplifiée (ils sont tout petits et très nombreux).
    this.flora.set('caillou', buildMesh('cailloux', scene, this.rockMaterial, [[organicBall(2.15, 1.55, 2.25, 4, 0, 0, 0, 71, 0.17), 0.62, 0.58, 0.51]]));
    this.flora.set('termitiere', buildMesh('termitières', scene, this.rockMaterial, [[organicBall(1.2, 1.8, 1.2, 8, 0, 0.85, 0, 72, 0.06), 0.58, 0.36, 0.22]]));
    this.flora.set('herbe', buildMesh('touffes herbeuses', scene, this.vegetationMaterial, grassClumpParts(false)));
    this.flora.set('herbe-seche', buildMesh('touffes herbe sèche', scene, this.vegetationMaterial, grassClumpParts(true)));
    this.flora.set('herbe-haute', buildMesh('herbes hautes de camouflage', scene, this.vegetationMaterial, grassClumpParts(false, true)));
    this.flora.set('herbe-haute-seche', buildMesh('herbes hautes sèches', scene, this.vegetationMaterial, grassClumpParts(true, true)));
    // Petites fleurs sauvages africaines : trois variantes, géométrie fusionnée et instances légères.
    const flowerParts = (petal: [number, number, number]): Part[] => {
      const parts: Part[] = [];
      for (let i = 0; i < 5; i++) {
        const a = i * Math.PI * 2 / 5;
        parts.push([organicBall(0.105, 0.075, 0.105, 3, Math.cos(a) * 0.105, 0.42, Math.sin(a) * 0.105, 90 + i, 0.025), ...petal]);
      }
      parts.push([organicBall(0.085, 0.08, 0.085, 3, 0, 0.45, 0, 99, 0.02), 0.92, 0.69, 0.18]);
      const stem = CreateCylinderVertexData({ height: 0.42, diameterTop: 0.012, diameterBottom: 0.018, tessellation: 4 });
      stem.transform(Matrix.Translation(0, 0.21, 0));
      parts.push([stem, 0.25, 0.38, 0.16]);
      return parts;
    };
    this.flora.set('fleur-rouge', buildMesh('fleurs rouges', scene, this.vegetationMaterial, flowerParts([0.72, 0.16, 0.12])));
    this.flora.set('fleur-jaune', buildMesh('fleurs jaunes', scene, this.vegetationMaterial, flowerParts([0.91, 0.66, 0.18])));
    this.flora.set('fleur-blanche', buildMesh('fleurs blanches', scene, this.vegetationMaterial, flowerParts([0.88, 0.84, 0.68])));
    this.stoneMesh = buildMesh('pierres', scene, this.rockMaterial, [[organicBall(2, 1.65, 1.9, 9, 0, 0, 0, 73, 0.13), 0.52, 0.5, 0.47]]);
    const log = cyl(1, 2, 2, 8, 0);
    log.transform(Matrix.RotationZ(Math.PI / 2));
    this.logMesh = buildMesh('bûches', scene, this.vegetationMaterial, [[log, 0.45, 0.33, 0.22]]);
    for (const kind of ITEM_RENDER_KINDS) {
      const mesh = buildItemMesh(`objets ${kind}`, kind, scene, this.material);
      mesh.alwaysSelectAsActiveMesh = true;
      mesh.isVisible = false;
      this.itemMeshes.set(kind, mesh);
    }
    for (const kind of NODE_RENDER_KINDS) {
      const mesh = buildItemMesh(`gisements ${kind}`, kind, scene, this.material);
      mesh.alwaysSelectAsActiveMesh = true;
      mesh.isVisible = false;
      this.nodeMeshes.set(kind, mesh);
    }
    this.flora.set('souche', buildMesh('souches', scene, this.vegetationMaterial, [[cyl(0.55, 2, 2.4, 7, 0.27), 0.42, 0.32, 0.22]]));
    // Feu : flammes lumineuses et colonne de fumée visible de loin (pour signaler sa position).
    const flameMat = new StandardMaterial('flammes', scene);
    flameMat.emissiveColor = new Color3(1, 0.55, 0.12);
    flameMat.diffuseColor = new Color3(0, 0, 0);
    flameMat.disableLighting = true;
    this.flameMesh = new Mesh('flammes', scene);
    CreateCylinderVertexData({ height: 0.7, diameterTop: 0, diameterBottom: 0.45, tessellation: 7 }).applyToMesh(this.flameMesh);
    this.flameMesh.material = flameMat;
    this.flameMesh.isPickable = false;
    this.flameMesh.alwaysSelectAsActiveMesh = true;
    this.flameMesh.isVisible = false;
    const smokeMat = new StandardMaterial('fumée', scene);
    smokeMat.diffuseColor = new Color3(0.55, 0.55, 0.56);
    smokeMat.emissiveColor = new Color3(0.35, 0.35, 0.36);
    smokeMat.specularColor = new Color3(0, 0, 0);
    smokeMat.alpha = 0.32;
    smokeMat.backFaceCulling = false;
    this.smokeMesh = new Mesh('fumée', scene);
    // Colonne qui s'élargit en montant ; transparente au pied (on voit le feu) et en haut (elle se dissipe).
    const smoke = CreateCylinderVertexData({ height: 1, diameterTop: 4, diameterBottom: 0.35, tessellation: 8, subdivisions: 6, cap: 0 });
    const sp = smoke.positions!;
    const sc: number[] = [];
    for (let i = 0; i < sp.length; i += 3) {
      const t = sp[i + 1]! + 0.5;
      sc.push(1, 1, 1, Math.max(0, t < 0.12 ? t / 0.12 : 1 - (t - 0.12) / 0.88));
    }
    smoke.colors = sc;
    smoke.applyToMesh(this.smokeMesh);
    this.smokeMesh.hasVertexAlpha = true;
    this.smokeMesh.material = smokeMat;
    this.smokeMesh.isPickable = false;
    this.smokeMesh.alwaysSelectAsActiveMesh = true;
    this.smokeMesh.isVisible = false;
    // Ombres douces activées sur les qualités Haute et Ultra uniquement.
    this.shadowGenerator = params.antialias ? new ShadowGenerator(1024, sun) : null;
    if (this.shadowGenerator) {
      this.shadowGenerator.usePercentageCloserFiltering = true;
      this.shadowGenerator.filteringQuality = ShadowGenerator.QUALITY_MEDIUM;
      this.shadowGenerator.bias = 0.0005;
      this.shadowGenerator.normalBias = 0.025;
      this.shadowGenerator.darkness = 0.28;
      for (const [type, mesh] of this.flora) {
        if (!DENSE_NO_SHADOW.has(type)) this.shadowGenerator.addShadowCaster(mesh, true);
        mesh.receiveShadows = true;
      }
      this.stoneMesh.receiveShadows = true;
      this.logMesh.receiveShadows = true;
    }
    this.applyFog();
  }

  get viewDistance(): number {
    return this.params.viewChunks * CHUNK_SIZE;
  }

  get isUnderwater(): boolean {
    return this.underwater;
  }

  stats(): WorldViewStats {
    let vertices = 0;
    for (const c of this.chunks.values()) vertices += c.mesh.getTotalVertices();
    return { chunks: this.chunks.size, pending: this.requested.size + this.ready.length, trees: this.treeCount, vertices };
  }

  setQuality(params: QualityParams): void {
    this.params = params;
    this.centerKey = '';
    this.vegetationDirty = true;
    this.applyFog();
  }

  private applyFog(): void {
    const d = this.viewDistance;
    this.scene.fogStart = d * 0.55;
    this.scene.fogEnd = d * 0.95;
    this.buildWater(d * 1.3);
  }

  // ——— Surface de l'eau (phase 7 : vagues levées par le vent) ———

  private waterPos: Float32Array = new Float32Array(0);
  private waterNormals: Float32Array = new Float32Array(0);
  /** Profondeur de l'eau sous chaque sommet proche (mise à jour quand la caméra s'éloigne). */
  private waterDepth: Float32Array = new Float32Array(0);
  private waterDepthAt = { x: Number.NaN, z: Number.NaN };
  private waterNear = 0;
  private static readonly WATER_SEGMENTS = 96;
  /** Une répétition des ondulations de l'eau tous les WATER_UV_PERIOD mètres. */
  private static readonly WATER_UV_PERIOD = 2.4;
  private waterDrift = { x: 0, z: 0 };
  private static readonly WAVE_RADIUS = 70;
  /** Vagues affichées (désactivées en qualité Basse : surface plate). */
  waves = true;

  private buildWater(outer: number): void {
    const rings: number[] = [0, 0.8];
    while (rings[rings.length - 1]! < WorldView.WAVE_RADIUS) rings.push(rings[rings.length - 1]! * 1.11 + 0.15);
    while (rings[rings.length - 1]! < outer) rings.push(Math.min(outer, rings[rings.length - 1]! * 1.6));
    const seg = WorldView.WATER_SEGMENTS;
    const n = 1 + (rings.length - 1) * seg;
    const pos = new Float32Array(n * 3);
    const uv = new Float32Array(n * 2);
    const nor = new Float32Array(n * 3);
    const idx: number[] = [];
    for (let i = 0; i < n; i++) nor[i * 3 + 1] = 1;
    for (let r = 1; r < rings.length; r++) {
      for (let k = 0; k < seg; k++) {
        const a = (k / seg) * Math.PI * 2;
        const i = 1 + (r - 1) * seg + k;
        pos[i * 3] = Math.cos(a) * rings[r]!;
        pos[i * 3 + 2] = Math.sin(a) * rings[r]!;
        // Coordonnées de texture en mètres locaux (le décalage du centre est ajouté dans update()).
        uv[i * 2] = pos[i * 3]! / WorldView.WATER_UV_PERIOD;
        uv[i * 2 + 1] = pos[i * 3 + 2]! / WorldView.WATER_UV_PERIOD;
        const k2 = (k + 1) % seg;
        if (r === 1) idx.push(0, 1 + k2, 1 + k);
        else {
          const a0 = 1 + (r - 2) * seg;
          const b0 = 1 + (r - 1) * seg;
          idx.push(a0 + k, a0 + k2, b0 + k, a0 + k2, b0 + k2, b0 + k);
        }
      }
    }
    this.waterNear = 1 + (rings.findIndex((x) => x >= WorldView.WAVE_RADIUS) - 1) * seg;
    this.waterPos = pos;
    this.waterNormals = nor;
    this.waterDepth = new Float32Array(this.waterNear);
    this.waterDepthAt = { x: Number.NaN, z: Number.NaN };
    const vd = new VertexData();
    vd.positions = pos;
    vd.normals = nor;
    vd.uvs = uv;
    vd.indices = idx;
    vd.applyToMesh(this.water, true);
  }

  /** Hauteur maximale des vagues affichées (diagnostic, tests). */
  waterStats(): { waves: boolean; maxY: number; vertices: number } {
    let maxY = 0;
    for (let i = 0; i < this.waterNear; i++) maxY = Math.max(maxY, Math.abs(this.waterPos[i * 3 + 1]!));
    return { waves: this.waves, maxY, vertices: this.waterPos.length / 3 };
  }

  /** Vagues autour de la caméra : hauteur et pente de chaque sommet proche, selon le vent et le temps. */
  updateWater(camX: number, camZ: number, time: number, wind: Wind): void {
    // Le déplacement des deux couches donne une animation continue, même quand le vent est faible.
    // (Décalage appliqué dans update(), une fois la position de la surface connue.)
    const drift = (wind.speed * 0.0021) / WorldView.WATER_UV_PERIOD;
    this.waterDrift.x = Number.isFinite(time) ? time * Math.sin(wind.dir) * drift : 0;
    this.waterDrift.z = Number.isFinite(time) ? time * Math.cos(wind.dir) * drift : 0;
    const pos = this.waterPos;
    const nor = this.waterNormals;
    const near = this.waterNear;
    if (!near) return;
    if (!this.waves || wind.speed < 0.5) {
      if (pos[1] !== 0 || pos[near * 3 - 2] !== 0) {
        for (let i = 0; i < near; i++) {
          pos[i * 3 + 1] = 0;
          nor[i * 3] = 0;
          nor[i * 3 + 1] = 1;
          nor[i * 3 + 2] = 0;
        }
        this.water.updateVerticesData('position', pos);
        this.water.updateVerticesData('normal', nor);
      }
      return;
    }
    // Profondeur sous les sommets proches : recalculée quand la caméra s'est déplacée de quelques mètres.
    if (!(Math.hypot(camX - this.waterDepthAt.x, camZ - this.waterDepthAt.z) < 3)) {
      this.waterDepthAt = { x: camX, z: camZ };
      for (let i = 0; i < near; i++) this.waterDepth[i] = WATER_LEVEL - this.terrain.heightAt(camX + pos[i * 3]!, camZ + pos[i * 3 + 2]!);
    }
    const ox = this.waterDepthAt.x;
    const oz = this.waterDepthAt.z;
    const e = 0.35;
    for (let i = 0; i < near; i++) {
      const lx = pos[i * 3]!;
      const lz = pos[i * 3 + 2]!;
      const wx = ox + lx;
      const wz = oz + lz;
      const r = Math.hypot(lx, lz);
      const fade = r < 45 ? 1 : Math.max(0, 1 - (r - 45) / (WorldView.WAVE_RADIUS - 45));
      const df = waveDepthFactor(this.waterDepth[i]!) * fade;
      if (df <= 0) {
        pos[i * 3 + 1] = 0;
        nor[i * 3] = 0;
        nor[i * 3 + 1] = 1;
        nor[i * 3 + 2] = 0;
        continue;
      }
      const h = waveHeight(wx, wz, time, wind, df);
      const gx = (waveHeight(wx + e, wz, time, wind, df) - h) / e;
      const gz = (waveHeight(wx, wz + e, time, wind, df) - h) / e;
      pos[i * 3 + 1] = h;
      const l = Math.hypot(gx, 1, gz);
      nor[i * 3] = -gx / l;
      nor[i * 3 + 1] = 1 / l;
      nor[i * 3 + 2] = -gz / l;
    }
    this.water.updateVerticesData('position', pos);
    this.water.updateVerticesData('normal', nor);
  }

  private lodCells(dist: number): number {
    const near = this.params.nearCells;
    const cells = dist <= 1.5 ? near : dist <= 3.5 ? near / 2 : near / 4;
    return Math.max(8, cells);
  }

  private recompute(ccx: number, ccz: number): void {
    const r = this.params.viewChunks;
    const vr = this.params.vegetationChunks;
    const desired = new Map<string, Desired>();
    for (let dz = -r; dz <= r; dz++) {
      for (let dx = -r; dx <= r; dx++) {
        const dist = Math.sqrt(dx * dx + dz * dz);
        if (dist > r + 0.5) continue;
        const cx = ccx + dx;
        const cz = ccz + dz;
        desired.set(chunkKey(cx, cz), { cx, cz, cells: this.lodCells(dist), dist, flora: dist <= vr + 0.5 });
      }
    }
    this.desired = desired;
    for (const [key, rec] of this.chunks) {
      if (!desired.has(key)) {
        rec.mesh.dispose();
        this.chunks.delete(key);
      }
    }
    for (const key of this.floraCache.keys()) if (!desired.get(key)?.flora) this.floraCache.delete(key);
    for (const key of this.denseCache.keys()) if (!this.floraCache.has(key.slice(0, key.lastIndexOf('|')))) this.denseCache.delete(key);

    // Nouvelle file d'attente, triée par distance.
    this.jobs.clearQueue();
    this.requested.clear();
    this.heightRequested.clear();
    for (const [key, d] of desired) {
      const rec = this.chunks.get(key);
      const needMesh = rec?.cells !== d.cells;
      const needFlora = d.flora && !this.floraCache.has(key);
      const needHeights = Math.max(Math.abs(d.cx - ccx), Math.abs(d.cz - ccz)) <= 2 && !this.jobs.heights.has(key);
      if (!needMesh && !needFlora && !needHeights) continue;
      this.requested.add(key);
      this.jobs.request(d.cx, d.cz, needMesh ? d.cells : 0, needHeights, needFlora, d.dist, (res) => this.ready.push(res));
    }
  }

  private apply(res: ChunkJobResult): void {
    const key = chunkKey(res.cx, res.cz);
    this.requested.delete(key);
    const d = this.desired.get(key);
    if (!d) return;
    if (res.flora && d.flora) {
      this.floraCache.set(key, res.flora);
      this.vegetationDirty = true;
    }
    if (res.mesh && res.cells === d.cells) {
      const vd = new VertexData();
      vd.positions = res.mesh.positions;
      vd.normals = res.mesh.normals;
      vd.colors = res.mesh.colors;
      vd.indices = res.mesh.indices;
      const mesh = new Mesh(`terrain ${key}`, this.scene);
      vd.applyToMesh(mesh, false);
      mesh.material = this.material;
      mesh.receiveShadows = true;
      mesh.position.set(res.cx * CHUNK_SIZE, 0, res.cz * CHUNK_SIZE);
      mesh.isPickable = false;
      mesh.hasVertexAlpha = false;
      mesh.freezeWorldMatrix();
      this.chunks.get(key)?.mesh.dispose();
      this.chunks.set(key, { cells: res.cells, mesh });
    }
  }

  private rebuildVegetation(): void {
    const r = this.params.vegetationChunks;
    const buckets = new Map<string, Array<(buf: Float32Array, i: number) => void>>();
    const add = (type: string, write: (buf: Float32Array, i: number) => void) => {
      let list = buckets.get(type);
      if (!list) {
        list = [];
        buckets.set(type, list);
      }
      list.push(write);
    };
    let trees = 0;
    for (let dz = -r; dz <= r; dz++) {
      for (let dx = -r; dx <= r; dx++) {
        if (Math.sqrt(dx * dx + dz * dz) > r + 0.5) continue;
        const f = this.floraCache.get(chunkKey(this.center.cx + dx, this.center.cz + dz));
        if (!f) continue;
        const ccx = this.center.cx + dx;
        const ccz = this.center.cz + dz;
        f.trees.forEach((t, ti) => {
          if (this.treeFelled?.(ccx, ccz, ti)) {
            const r = SPECIES[t.species].trunkRadius * t.scale;
            add('souche', (b, i) => writeMatrix(b, i, t.x, t.y - 0.3, t.z, t.rot, r, 1, r));
            return;
          }
          trees++;
          add(t.species, (b, i) => writeMatrix(b, i, t.x, t.y - 0.3, t.z, t.rot, t.scale, t.scale, t.scale));
        });
        for (const b of f.bushes) add(b.dry ? 'buisson-sec' : 'buisson', (buf, i) => writeMatrix(buf, i, b.x, b.y, b.z, b.rot, b.scale, b.scale, b.scale));
        for (const k of f.rocks) {
          add('rocher', (buf, i) => writeMatrix(buf, i, k.x, k.y, k.z, (k.x * 0.37) % 1, k.r, k.r, k.r));
          if (k.top > 0) add('rocher', (buf, i) => writeMatrix(buf, i, k.x, k.y + k.r + k.top * 0.85, k.z, (k.z * 0.29) % 1, k.top, k.top, k.top));
        }
        for (const mo of f.mounds) add('termitiere', (buf, i) => writeMatrix(buf, i, mo.x, mo.y - 0.2, mo.z, 0, mo.radius, mo.height, mo.radius));
      }
    }
    // Couche dense : tapis d'herbe, fleurs et cailloux près du joueur, fourrés sur tout le rayon.
    // Calculée une seule fois par chunk puis mise en cache (le terrain est échantillonné une fois par point).
    const layout = denseLayout(r);
    for (let dz = -r; dz <= r; dz++) for (let dx = -r; dx <= r; dx++) {
      const dist = Math.sqrt(dx * dx + dz * dz);
      if (dist > r + 0.5) continue;
      const cx = this.center.cx + dx, cz = this.center.cz + dz;
      const key = chunkKey(cx, cz);
      if (!this.floraCache.has(key)) continue;
      const near = dist <= layout.near + 0.5;
      const ckey = `${key}|${near ? r : -r}`;
      let list = this.denseCache.get(ckey);
      if (!list) {
        list = this.computeDense(cx, cz, layout, near);
        this.denseCache.set(ckey, list);
      }
      for (const inst of list) add(inst[0], (buf, i) => writeMatrix(buf, i, inst[1], inst[2], inst[3], inst[4], inst[5], inst[6], inst[7]));
    }
    this.treeCount = trees;
    for (const [type, mesh] of this.flora) {
      const list = buckets.get(type);
      if (!list || list.length === 0) {
        mesh.isVisible = false;
        continue;
      }
      const buf = new Float32Array(list.length * 16);
      list.forEach((w, i) => w(buf, i));
      mesh.thinInstanceSetBuffer('matrix', buf, 16, true);
      mesh.isVisible = true;
    }
  }

  /** Calcule la couche dense d'un chunk (déterministe : même graine, mêmes positions). */
  private computeDense(cx: number, cz: number, layout: { grass: number; pebble: number; thicket: number }, near: boolean): DenseInstance[] {
    const out: DenseInstance[] = [];
    const seed = this.terrain.seed;
    if (near) {
      // Tapis de savane : les variantes hautes forment des écrans de camouflage visuels.
      const n = layout.grass, cell = CHUNK_SIZE / n;
      for (let gz = 0; gz < n; gz++) for (let gx = 0; gx < n; gx++) {
        const h = hash32(seed, cx * n + gx, cz * n + gz, 0x6a55);
        if ((h & 0xffff) / 65536 > 0.9) continue;
        const x = cx * CHUNK_SIZE + (gx + 0.06 + ((h >>> 16) & 255) / 255 * 0.88) * cell;
        const z = cz * CHUNK_SIZE + (gz + 0.06 + ((h >>> 24) & 255) / 255 * 0.88) * cell;
        const sample = this.terrain.sampleInto(x, z);
        if (sample.height <= WATER_LEVEL + 0.35 || sample.kopje > 0.42 || sample.wetland > 0.72) continue;
        const dry = sample.south > 0.38 || sample.west > 0.48 || sample.valley > 0.7;
        const y = sample.height;
        // Une touffe plus grosse compense une grille moins serrée que la version d'origine (64 × 64).
        const scale = (0.66 + ((h >>> 8) & 255) / 255 * 1.18) * Math.min(1.3, Math.sqrt(24 / n));
        const yaw = ((h >>> 4) & 255) / 255;
        const tall = ((h >>> 20) & 255) < 160;
        out.push([tall ? (dry ? 'herbe-haute-seche' : 'herbe-haute') : (dry ? 'herbe-seche' : 'herbe'), x, y - 0.02, z, yaw, scale, scale, scale]);
        const flowerRoll = (h >>> 1) & 0x3ff;
        if (flowerRoll < (dry ? 30 : 56)) {
          const flower = flowerRoll % 3 === 0 ? 'fleur-rouge' : flowerRoll % 3 === 1 ? 'fleur-jaune' : 'fleur-blanche';
          const fs = 0.62 + ((h >>> 12) & 127) / 127 * 0.55;
          out.push([flower, x + 0.22, y, z - 0.16, yaw, fs, fs, fs]);
        }
      }
      // Pierres et éclats de transition, tailles irrégulières.
      const p = layout.pebble, pc = CHUNK_SIZE / p;
      for (let gz = 0; gz < p; gz++) for (let gx = 0; gx < p; gx++) {
        const h = hash32(seed, cx * p + gx, cz * p + gz, 0x70c4);
        if ((h & 0xffff) / 65536 > 0.38) continue;
        const x = cx * CHUNK_SIZE + (gx + 0.04 + ((h >>> 16) & 255) / 255 * 0.92) * pc;
        const z = cz * CHUNK_SIZE + (gz + 0.04 + ((h >>> 24) & 255) / 255 * 0.92) * pc;
        const sample = this.terrain.sampleInto(x, z);
        if (sample.height <= WATER_LEVEL + 0.55 || sample.wetland > 0.7) continue;
        const size = (sample.kopje > 0.18 ? 0.19 : 0.085) + ((h >>> 8) & 255) / 255 * (sample.kopje > 0.18 ? 0.28 : 0.17);
        const yaw = ((h >>> 4) & 255) / 255;
        out.push(['caillou', x, sample.height + size * 0.22, z, yaw, size, size * (0.55 + ((h >>> 20) & 63) / 100), size * 0.88]);
      }
    }
    // Fourrés hauts en mosaïque : écrans naturels qui fragmentent les lignes de vue (visuel seulement).
    const t = layout.thicket, tc = CHUNK_SIZE / t;
    for (let gz = 0; gz < t; gz++) for (let gx = 0; gx < t; gx++) {
      const h = hash32(seed, cx * t + gx, cz * t + gz, 0xb715);
      if ((h & 0xffff) / 65536 > 0.63) continue;
      const x = cx * CHUNK_SIZE + (gx + 0.1 + ((h >>> 16) & 255) / 255 * 0.8) * tc;
      const z = cz * CHUNK_SIZE + (gz + 0.1 + ((h >>> 24) & 255) / 255 * 0.8) * tc;
      const sample = this.terrain.sampleInto(x, z);
      if (sample.height <= WATER_LEVEL + 0.5 || sample.kopje > 0.62 || sample.wetland > 0.78) continue;
      const size = 0.96 + ((h >>> 8) & 255) / 255 * 1.08;
      const yaw = ((h >>> 4) & 255) / 255;
      out.push(['fourre-dense', x, sample.height, z, yaw, size, size, size]);
    }
    return out;
  }

  /** Met à jour l'affichage des objets déplaçables (positions issues de la simulation). */
  updateProps(views: PropView[]): void {
    const stones = views.filter((v) => v.kind === 'pierre');
    const logs = views.filter((v) => v.kind === 'buche' || v.kind === 'tronc' || v.kind === 'baton' || v.kind === 'manche' || v.kind === 'perche');
    const fill = (mesh: Mesh, list: PropView[], scale: (v: PropView) => [number, number, number]) => {
      if (list.length === 0) {
        mesh.isVisible = false;
        return;
      }
      const buf = new Float32Array(list.length * 16);
      list.forEach((v, i) => {
        q.set(v.qx, v.qy, v.qz, v.qw);
        const [sx, sy, sz] = scale(v);
        sv.set(sx, sy, sz);
        pv.set(v.x, v.y, v.z);
        Matrix.ComposeToRef(sv, q, pv, m);
        m.copyToArray(buf, i * 16);
      });
      mesh.thinInstanceSetBuffer('matrix', buf, 16, false);
      mesh.isVisible = true;
    };
    fill(this.stoneMesh, stones, (v) => [v.radius, v.radius, v.radius]);
    fill(this.logMesh, logs, (v) => [v.length, v.radius, v.radius]);
    for (const [kind, mesh] of this.itemMeshes) fill(mesh, views.filter((v) => v.kind === kind), () => [1, 1, 1]);
    for (const [kind, mesh] of this.nodeMeshes) fill(mesh, views.filter((v) => v.kind === kind), (v) => [v.size ?? 1, v.size ?? 1, v.size ?? 1]);
    // Flammes : foyers, forges, fourneaux, torches (plus petites, au bout du manche).
    const FLAME: Partial<Record<PropView['kind'], [number, number]>> = { foyer: [0, 1], forge: [0.3, 0.8], fourneau: [0.85, 0.7], torche: [0.22, 0.35] };
    const lit = views.filter((v) => v.lit && FLAME[v.kind]);
    const t = performance.now() * 0.006;
    fill(
      this.flameMesh,
      lit.map((v) => ({ ...v, y: v.y + FLAME[v.kind]![0], qx: 0, qy: 0, qz: 0, qw: 1 })),
      (v) => {
        const s = FLAME[v.kind]![1];
        const k = (0.85 + 0.15 * Math.sin(t + v.x)) * s;
        return [k, (0.9 + 0.2 * Math.sin(t * 1.7 + v.z)) * s, k];
      },
    );
    // Colonne de fumée : 30 m de haut, centrée 15 m au-dessus du foyer (pas pour les torches).
    fill(this.smokeMesh, lit.filter((v) => v.kind !== 'torche').map((v) => ({ ...v, y: v.y + 15, qx: 0, qy: 0, qz: 0, qw: 1 })), () => [1, 30, 1]);
  }

  /** À appeler quand des arbres sont abattus ou repoussent. */
  invalidateVegetation(): void {
    this.vegetationDirty = true;
  }

  /** À appeler à chaque image : demande, reçoit et affiche les chunks, dans la limite de temps donnée. */
  update(camX: number, camY: number, camZ: number, budgetMs: number): void {
    this.skyDome.position.set(camX, camY, camZ);
    this.skyDome.scaling.setAll(this.viewDistance * 0.98);
    const ccx = chunkCoord(camX);
    const ccz = chunkCoord(camZ);
    const key = chunkKey(ccx, ccz);
    if (key !== this.centerKey) {
      this.centerKey = key;
      this.center = { cx: ccx, cz: ccz };
      this.recompute(ccx, ccz);
      this.vegetationDirty = true;
    }
    const t0 = performance.now();
    this.jobs.pump(budgetMs);
    let applied = 0;
    while (this.ready.length > 0 && (applied === 0 || performance.now() - t0 < budgetMs)) {
      this.apply(this.ready.shift()!);
      applied++;
    }
    if (this.vegetationDirty) {
      this.vegetationDirty = false;
      this.rebuildVegetation();
    }
    // La surface suit la caméra (les vagues sont calculées autour du dernier point de mesure des profondeurs).
    const wx = Number.isFinite(this.waterDepthAt.x) && this.waves ? this.waterDepthAt.x : camX;
    const wz = Number.isFinite(this.waterDepthAt.z) && this.waves ? this.waterDepthAt.z : camZ;
    this.water.position.x = wx;
    this.water.position.z = wz;
    // Ondulations ancrées au monde (elles ne glissent pas avec la caméra) et poussées par le vent.
    const P = WorldView.WATER_UV_PERIOD;
    const frac = (v: number) => v - Math.floor(v);
    this.waterNormalTexture.uOffset = frac(wx / P + this.waterDrift.x + 0.17);
    this.waterNormalTexture.vOffset = frac(wz / P + this.waterDrift.z + 0.31);
    this.waterColorTexture.uOffset = frac(wx / P + this.waterDrift.x * 0.58 + 0.43);
    this.waterColorTexture.vOffset = frac(wz / P + this.waterDrift.z * 0.58 + 0.09);

    const under = camY < WATER_LEVEL - 0.05;
    this.skyDome.setEnabled(!under);
    if (under !== this.underwater) {
      this.underwater = under;
      const c = under ? UNDERWATER : SKY;
      this.scene.fogColor = c.clone();
      this.scene.clearColor = new Color4(c.r, c.g, c.b, 1);
      this.scene.fogMode = under ? Scene.FOGMODE_EXP2 : Scene.FOGMODE_LINEAR;
    }
    if (under) {
      // Plus on descend, plus l'eau est sombre et trouble.
      const depth = WATER_LEVEL - camY;
      this.scene.fogDensity = 0.06 + Math.min(0.12, depth * 0.008);
      const k = Math.max(0.35, 1 - depth * 0.04);
      this.scene.fogColor.set(UNDERWATER.r * k, UNDERWATER.g * k, UNDERWATER.b * k);
      this.scene.clearColor.set(UNDERWATER.r * k, UNDERWATER.g * k, UNDERWATER.b * k, 1);
    }
  }

  /** Attend que le terrain proche soit prêt (écran de chargement). */
  async preload(camX: number, camY: number, camZ: number, onProgress?: (done: number, total: number) => void, timeoutMs = 20000): Promise<void> {
    this.update(camX, camY, camZ, 8);
    const t0 = performance.now();
    const near = [...this.desired.entries()].filter(([, d]) => d.dist <= 1.5).map(([k]) => k);
    for (;;) {
      this.update(camX, camY, camZ, 8);
      const done = near.filter((k) => this.chunks.has(k)).length;
      onProgress?.(done, near.length);
      if (done >= near.length || performance.now() - t0 > timeoutMs) return;
      await new Promise((r) => setTimeout(r, 16));
    }
  }

  dispose(): void {
    for (const c of this.chunks.values()) c.mesh.dispose();
    this.chunks.clear();
    for (const mesh of this.flora.values()) mesh.dispose();
    this.stoneMesh.dispose();
    this.logMesh.dispose();
    for (const mesh of this.itemMeshes.values()) mesh.dispose();
    for (const mesh of this.nodeMeshes.values()) mesh.dispose();
    this.flameMesh.dispose();
    this.smokeMesh.dispose();
    this.water.dispose();
    this.material.dispose();
    this.vegetationMaterial.dispose();
    this.rockMaterial.dispose();
    this.skyDome.material?.dispose();
    this.skyDome.dispose();
    this.shadowGenerator?.dispose();
    this.waterMaterial.dispose();
    this.waterColorTexture.dispose();
    this.waterNormalTexture.dispose();
  }

  /** Terrain affiché (pour les outils). */
  get world(): Terrain {
    return this.terrain;
  }
}
