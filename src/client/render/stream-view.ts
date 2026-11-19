// Ruisseaux, chutes d'eau et bassins (phase 9) : rubans d'eau posés dans leur lit creusé, voiles d'écume
// sur les chutes, disques d'eau pour les bassins. Construits autour de la caméra à partir de l'hydrologie
// partagée (déterministe), reconstruits quand on change de chunk. L'eau défile dans le sens du courant.

import { DynamicTexture } from '@babylonjs/core/Materials/Textures/dynamicTexture';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import { Color3 } from '@babylonjs/core/Maths/math.color';
import { Mesh } from '@babylonjs/core/Meshes/mesh';
import { VertexData } from '@babylonjs/core/Meshes/mesh.vertexData';
import type { Scene } from '@babylonjs/core/scene';
import { CHUNK_SIZE } from '../../shared/constants';
import type { Pool, StreamPoint, Waterfall } from '../../shared/hydrology';
import type { Terrain } from '../../shared/terrain';

/** Texture de rides (traits clairs irréguliers), répétée et défilée. */
function rippleTexture(scene: Scene, name: string, base: number, streaks: number, seed: number): DynamicTexture {
  const size = 64;
  const tex = new DynamicTexture(name, { width: size, height: size }, scene, true);
  const ctx = tex.getContext() as CanvasRenderingContext2D;
  ctx.fillStyle = `rgb(${base},${base},${base})`;
  ctx.fillRect(0, 0, size, size);
  let s = seed;
  const rnd = () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
  for (let i = 0; i < streaks; i++) {
    const x = rnd() * size;
    const y = rnd() * size;
    const len = 4 + rnd() * 14;
    const v = Math.min(255, base + 40 + Math.floor(rnd() * 60));
    ctx.strokeStyle = `rgba(${v},${v},${v},${0.35 + rnd() * 0.4})`;
    ctx.lineWidth = 0.6 + rnd() * 1.2;
    ctx.beginPath();
    // Traits dans le sens du courant (axe v), répétés aux bords pour un raccord sans couture.
    for (const oy of [0, -size, size]) {
      ctx.moveTo(x, y + oy);
      ctx.lineTo(x + (rnd() - 0.5) * 3, y + len + oy);
    }
    ctx.stroke();
  }
  tex.update();
  tex.wrapU = DynamicTexture.WRAP_ADDRESSMODE;
  tex.wrapV = DynamicTexture.WRAP_ADDRESSMODE;
  return tex;
}

export class StreamView {
  private meshes: Mesh[] = [];
  private readonly waterMat: StandardMaterial;
  private readonly poolMat: StandardMaterial;
  private readonly foamMat: StandardMaterial;
  private readonly waterTex: DynamicTexture;
  private readonly poolTex: DynamicTexture;
  private readonly foamTex: DynamicTexture;
  private builtKey = '';
  private lastCheck = -1e9;
  /** Nombre de rubans, voiles et bassins affichés (outils de test). */
  stats = { streams: 0, falls: 0, pools: 0 };

  constructor(
    private readonly scene: Scene,
    private readonly terrain: Terrain,
  ) {
    this.waterTex = rippleTexture(scene, 'rides ruisseau', 170, 70, 3);
    this.poolTex = rippleTexture(scene, 'rides bassin', 190, 25, 5);
    this.foamTex = rippleTexture(scene, 'écume', 200, 160, 9);
    const mat = (name: string, color: Color3, alpha: number, tex: DynamicTexture, spec: number) => {
      const m = new StandardMaterial(name, scene);
      m.diffuseColor = color;
      m.diffuseTexture = tex;
      m.specularColor = new Color3(spec, spec, spec * 0.95);
      m.specularPower = 24;
      m.alpha = alpha;
      m.backFaceCulling = false;
      // Toujours devant le lit (pas de scintillement avec le sol).
      m.zOffset = -2;
      return m;
    };
    this.waterMat = mat('eau des ruisseaux', new Color3(0.2, 0.36, 0.42), 0.8, this.waterTex, 0.5);
    this.poolMat = mat('eau des bassins', new Color3(0.14, 0.3, 0.38), 0.84, this.poolTex, 0.45);
    this.foamMat = mat('écume', new Color3(0.9, 0.93, 0.95), 0.9, this.foamTex, 0.15);
    // L'écume diffuse la lumière dans tous les sens : elle reste claire même quand le soleil l'éclaire mal.
    this.foamMat.emissiveColor = new Color3(0.5, 0.53, 0.56);
  }

  /**
   * Met à jour autour de la caméra : rubans et bassins à moins de `radius` mètres. Reconstruit seulement
   * quand on change de chunk ou que de nouveaux ruisseaux apparaissent ; anime le courant à chaque image.
   */
  update(camX: number, camZ: number, radius: number, now: number, dayLight: number): void {
    const t = this.terrain;
    if (!t.floraEnabled) return;
    if (now - this.lastCheck > 300) {
      this.lastCheck = now;
      const key = `${Math.floor(camX / CHUNK_SIZE)},${Math.floor(camZ / CHUNK_SIZE)},${radius},${t.hydro.version}`;
      if (key !== this.builtKey) {
        this.builtKey = key;
        this.rebuild(camX, camZ, radius);
      }
    }
    // Le courant : les rides descendent le ruisseau ; l'écume tombe vite ; les bassins frémissent.
    this.waterTex.vOffset = -((now * 0.00045) % 1);
    this.foamTex.vOffset = -((now * 0.0016) % 1);
    this.poolTex.uOffset = Math.sin(now * 0.0003) * 0.05;
    this.poolTex.vOffset = (now * 0.00004) % 1;
    // La nuit, l'eau s'assombrit avec le reste (l'écume aussi).
    const k = 0.12 + 0.88 * dayLight;
    this.foamMat.emissiveColor.set(0.5 * k, 0.53 * k, 0.56 * k);
  }

  private rebuild(camX: number, camZ: number, radius: number): void {
    for (const m of this.meshes) m.dispose();
    this.meshes = [];
    const hydro = this.terrain.hydro;
    const r = Math.ceil(radius / CHUNK_SIZE);
    const ccx = Math.floor(camX / CHUNK_SIZE);
    const ccz = Math.floor(camZ / CHUNK_SIZE);
    const streams = new Set<string>();
    const pools = new Map<string, Pool>();
    for (let dz = -r; dz <= r; dz++) {
      for (let dx = -r; dx <= r; dx++) {
        for (const s of hydro.segmentsIn(ccx + dx, ccz + dz)) streams.add(s.stream);
        for (const p of hydro.poolsIn(ccx + dx, ccz + dz)) pools.set(p.id, p);
      }
    }
    const reach2 = (radius + 48) * (radius + 48);
    let nStreams = 0;
    for (const id of streams) {
      const st = hydro.streams.get(id);
      if (!st) continue;
      const m = this.ribbon(id, st.points, camX, camZ, reach2);
      if (m) {
        this.meshes.push(m);
        nStreams++;
      }
    }
    let nPools = 0;
    for (const p of pools.values()) {
      if ((p.x - camX) * (p.x - camX) + (p.z - camZ) * (p.z - camZ) > reach2) continue;
      this.meshes.push(this.disc(`bassin ${p.id}`, p.x, p.surface + 0.03, p.z, p.r, 28, this.poolMat, 8));
      nPools++;
    }
    let nFalls = 0;
    for (const f of hydro.fallsNear(camX, camZ, radius + 48)) {
      this.meshes.push(this.fallSheet(f));
      // Écume au pied de la chute.
      const y = this.terrain.waterLevelAt(f.x2, f.z2) + 0.05;
      this.meshes.push(this.disc(`écume ${f.id}`, f.x2, y, f.z2, Math.min(2.6, f.width * 0.6 + 0.7), 14, this.foamMat, 2));
      nFalls++;
    }
    this.stats = { streams: nStreams, falls: nFalls, pools: nPools };
  }

  /** Ruban d'eau d'un ruisseau : tronçons d'eau consécutifs proches de la caméra. */
  private ribbon(id: string, pts: StreamPoint[], camX: number, camZ: number, reach2: number): Mesh | null {
    const positions: number[] = [];
    const normals: number[] = [];
    const uvs: number[] = [];
    const indices: number[] = [];
    let run = -1;
    let v = 0;
    const near = (p: StreamPoint) => (p.x - camX) * (p.x - camX) + (p.z - camZ) * (p.z - camZ) < reach2;
    for (let i = 0; i < pts.length; i++) {
      const p = pts[i]!;
      const prev = i > 0 ? pts[i - 1]! : null;
      const next = i + 1 < pts.length ? pts[i + 1]! : null;
      const inWater = prev !== null && !prev.fall && !prev.seep;
      const outWater = next !== null && !p.fall && !p.seep;
      if ((!inWater && !outWater) || !near(p)) {
        run = -1;
        continue;
      }
      // Direction moyenne (entrée et sortie d'eau) pour une largeur continue dans les virages.
      let dx = 0;
      let dz = 0;
      if (inWater) {
        dx += p.x - prev.x;
        dz += p.z - prev.z;
      }
      if (outWater) {
        dx += next.x - p.x;
        dz += next.z - p.z;
      }
      const l = Math.hypot(dx, dz) || 1;
      dx /= l;
      dz /= l;
      const hw = p.width * 0.5;
      const y = p.surface + 0.02;
      if (run >= 0 && inWater && prev) v += Math.hypot(p.x - prev.x, p.z - prev.z) / 5;
      const base = positions.length / 3;
      positions.push(p.x - dz * hw, y, p.z + dx * hw, p.x + dz * hw, y, p.z - dx * hw);
      normals.push(0, 1, 0, 0, 1, 0);
      uvs.push(0, v, Math.max(1, hw / 2), v);
      if (run >= 0 && inWater) indices.push(base - 2, base - 1, base, base - 1, base + 1, base);
      run = outWater ? base : -1;
    }
    if (!indices.length) return null;
    const mesh = new Mesh(`ruisseau ${id}`, this.scene);
    const vd = new VertexData();
    vd.positions = positions;
    vd.normals = normals;
    vd.uvs = uvs;
    vd.indices = indices;
    vd.applyToMesh(mesh);
    mesh.material = this.waterMat;
    mesh.isPickable = false;
    return mesh;
  }

  /** Voile d'écume d'une chute : du rebord jusqu'au pied, sans rentrer dans la roche. */
  private fallSheet(f: Waterfall): Mesh {
    const positions: number[] = [];
    const normals: number[] = [];
    const uvs: number[] = [];
    const indices: number[] = [];
    const rows = 9;
    const hw = f.width * 0.45;
    const px = -f.dz;
    const pz = f.dx;
    const drop = f.top - f.bottom;
    for (let i = 0; i < rows; i++) {
      const t = i / (rows - 1);
      const x = f.x + (f.x2 - f.x) * t;
      const z = f.z + (f.z2 - f.z) * t;
      // L'eau reste en haut puis tombe ; jamais sous le sol.
      let y = f.top - drop * Math.pow(t, 1.5);
      const ground = this.terrain.heightAt(x, z) + 0.25;
      if (y < ground) y = ground;
      if (i === rows - 1) y = Math.max(y, f.bottom + 0.05);
      const base = positions.length / 3;
      positions.push(x + px * hw, y, z + pz * hw, x - px * hw, y, z - pz * hw);
      normals.push(-f.dx * 0.5, 0.86, -f.dz * 0.5, -f.dx * 0.5, 0.86, -f.dz * 0.5);
      uvs.push(0, t * (drop / 3), 1, t * (drop / 3));
      if (i > 0) indices.push(base - 2, base - 1, base, base - 1, base + 1, base);
    }
    const mesh = new Mesh(`chute ${f.id}`, this.scene);
    const vd = new VertexData();
    vd.positions = positions;
    vd.normals = normals;
    vd.uvs = uvs;
    vd.indices = indices;
    vd.applyToMesh(mesh);
    mesh.material = this.foamMat;
    mesh.isPickable = false;
    return mesh;
  }

  /** Disque horizontal (bassin, écume). */
  private disc(name: string, x: number, y: number, z: number, r: number, seg: number, mat: StandardMaterial, uvScale: number): Mesh {
    const positions: number[] = [x, y, z];
    const normals: number[] = [0, 1, 0];
    const uvs: number[] = [x / uvScale, z / uvScale];
    const indices: number[] = [];
    for (let i = 0; i <= seg; i++) {
      const a = (i / seg) * Math.PI * 2;
      const px = x + Math.cos(a) * r;
      const pz = z + Math.sin(a) * r;
      positions.push(px, y, pz);
      normals.push(0, 1, 0);
      uvs.push(px / uvScale, pz / uvScale);
      if (i > 0) indices.push(0, i, i + 1);
    }
    const mesh = new Mesh(name, this.scene);
    const vd = new VertexData();
    vd.positions = positions;
    vd.normals = normals;
    vd.uvs = uvs;
    vd.indices = indices;
    vd.applyToMesh(mesh);
    mesh.material = mat;
    mesh.isPickable = false;
    return mesh;
  }

  dispose(): void {
    for (const m of this.meshes) m.dispose();
    this.meshes = [];
    for (const m of [this.waterMat, this.poolMat, this.foamMat]) m.dispose();
    for (const t of [this.waterTex, this.poolTex, this.foamTex]) t.dispose();
  }
}
