// Phase 9 : grottes et mines — volumes souterrains, entrées découpées dans le relief, obscurité, contenu.

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Caves } from '../../src/shared/caves';
import { BTN_INTERACT, BTN_JUMP, MODE_CLIMB, MODE_SWIM } from '../../src/shared/movement';
import { QUERY_TERRAIN, RAPIER, initPhysics } from '../../src/shared/physics';
import { LocalSimulation } from '../../src/shared/simulation';
import { Terrain } from '../../src/shared/terrain';
import { cmd } from './helpers';

const SEED = 20261112;
let sim: LocalSimulation;

beforeAll(async () => {
  await initPhysics();
  sim = await LocalSimulation.create(SEED, { fauna: false });
});

afterAll(() => sim.dispose());

const net = (kind: 'granite' | 'escarpement' | 'mine') => sim.terrain.caves.nets.find((n) => n.kind === kind)!;

function settle(ticks = 30): void {
  for (let i = 0; i < ticks; i++) sim.step(cmd(0, 0));
}

describe('réseaux souterrains', () => {
  it('identiques pour tous ; chaque monde a sa grotte de granit, sa grotte de l’escarpement et ses galeries de mine', () => {
    const a = new Caves(new Terrain(SEED));
    const b = new Caves(new Terrain(SEED));
    expect(b.nets.map((n) => [n.id, n.mouth, n.prims.length])).toEqual(a.nets.map((n) => [n.id, n.mouth, n.prims.length]));
    // Le maillage d'un bloc est le même partout (physique et affichage, hôte et joueurs).
    const k = a.blocksNear(a.nets[0]!.mouth.x, a.nets[0]!.mouth.z, 10)[0]!;
    expect(Array.from(b.blockMesh(k)!.positions)).toEqual(Array.from(a.blockMesh(k)!.positions));
    for (const seed of [SEED, 7, 424242]) {
      const kinds = new Caves(new Terrain(seed)).nets.map((n) => n.kind).sort();
      expect(kinds).toEqual(['escarpement', 'granite', 'mine']);
    }
    // Le lac souterrain et le fond de l'escarpement ; le puits de la mine.
    expect(net('escarpement').pools.length).toBe(3);
    expect(net('escarpement').deep).not.toBeNull();
    expect(net('mine').shaft!.top - net('mine').shaft!.bottom).toBeGreaterThan(15);
  });

  it('autour des entrées, le sol n’a ni trou ni fente : seule l’ouverture mène sous terre', () => {
    for (const n of sim.terrain.caves.nets) {
      const mx = n.shaft ? n.shaft.x : n.mouth.x;
      const mz = n.shaft ? n.shaft.z : n.mouth.z;
      sim.teleport(mx + 25, sim.terrain.heightAt(mx + 25, mz) + 1, mz);
      settle(2);
      // Rayons verticaux : ils touchent toujours quelque chose (le sol, ou la roche de la grotte).
      let gaps = 0;
      for (let dx = -12; dx <= 12; dx += 0.45) {
        for (let dz = -12; dz <= 12; dz += 0.45) {
          const x = mx + dx;
          const z = mz + dz;
          const hit = sim.phys.world.castRay(new RAPIER.Ray({ x, y: sim.terrain.heightAt(x, z) + 30, z }, { x: 0, y: -1, z: 0 }), 90, true, undefined, QUERY_TERRAIN);
          if (!hit) gaps++;
        }
      }
      expect(gaps, n.id).toBe(0);
      if (n.shaft) continue;
      // Rayons horizontaux vers la colline : aucun ne traverse le sol sans le toucher.
      const px = -n.mouth.dz;
      const pz = n.mouth.dx;
      let cracks = 0;
      for (let s = -8; s <= 8; s += 0.5) {
        for (let up = 0.25; up <= 8; up += 0.5) {
          const ox = mx - n.mouth.dx * 6 + px * s;
          const oz = mz - n.mouth.dz * 6 + pz * s;
          const oy = sim.terrain.heightAt(mx, mz) + up;
          if (oy < sim.terrain.heightAt(ox, oz) + 0.1) continue;
          const hit = sim.phys.world.castRay(new RAPIER.Ray({ x: ox, y: oy, z: oz }, { x: n.mouth.dx, y: 0, z: n.mouth.dz }), 60, true, undefined, QUERY_TERRAIN);
          if (hit) continue;
          for (let d = 0; d < 60; d += 0.5) {
            const x = ox + n.mouth.dx * d;
            const z = oz + n.mouth.dz * d;
            if (oy < sim.terrain.heightAt(x, z) - 1 && sim.terrain.caves.sdf(x, oy, z) > 0.3) {
              cracks++;
              break;
            }
          }
        }
      }
      expect(cracks, n.id).toBe(0);
    }
  });
});

describe('sous terre', () => {
  it('on entre à pied dans les grottes : la roche passe au-dessus, il fait noir', () => {
    for (const kind of ['granite', 'escarpement'] as const) {
      const n = net(kind);
      const sx = n.mouth.x - n.mouth.dx * 5;
      const sz = n.mouth.z - n.mouth.dz * 5;
      sim.teleport(sx, sim.terrain.heightAt(sx, sz) + 0.3, sz);
      expect(sim.terrain.caves.underground(sim.state.x, sim.state.y + 1.6, sim.state.z)).toBe(0);
      const yaw = Math.atan2(n.mouth.dx, n.mouth.dz);
      let deepest = 0;
      for (let i = 0; i < 60 * 14; i++) {
        sim.step(cmd(n.mouth.dx, n.mouth.dz, 0, yaw));
        deepest = Math.max(deepest, sim.terrain.caves.underground(sim.state.x, sim.state.y + 1.6, sim.state.z));
      }
      expect(deepest, kind).toBe(1);
      // Le sol sous les pieds est de la roche, et on n'est pas tombé.
      expect(sim.state.surface).toBe('roche');
      expect(sim.respawns).toBe(0);
    }
  });

  it('dans la grande caverne, le lac souterrain se nage ; le siphon est sous l’eau', () => {
    const n = net('escarpement');
    const lake = n.pools[0]!;
    sim.teleport(lake.x, lake.surface - 1.2, lake.z);
    settle(40);
    expect(sim.state.mode).toBe(MODE_SWIM);
    expect(sim.terrain.waterLevelAt(lake.x, lake.z, sim.state.y)).toBeCloseTo(lake.surface, 5);
    // Au bout du siphon (hors de la salle du lac), la voûte est plus basse que la surface : il faut plonger.
    const tube = n.prims.find((p) => !p.room && Math.hypot(p.ax - lake.x, p.az - lake.z) < 1)!;
    expect(sim.terrain.caves.sdf(tube.bx, lake.surface + 0.2, tube.bz)).toBeGreaterThan(0);
    expect(sim.terrain.caves.sdf(tube.bx, tube.fb + 0.6, tube.bz)).toBeLessThan(0);
    expect(sim.terrain.waterLevelAt(tube.bx, tube.bz, tube.fb + 0.6)).toBeCloseTo(lake.surface, 5);
    // Hors de la grotte, ce lac n'existe pas (il ne compte qu'à sa profondeur).
    expect(sim.terrain.waterLevelAt(lake.x, lake.z, lake.surface + 40)).toBeLessThan(lake.surface);
  });

  it('les gisements et les peintures sont là ; regarder une peinture la recopie dans le carnet', () => {
    const n = net('granite');
    const room = n.prims.filter((p) => p.room)[0]!;
    sim.teleport(room.ax, room.fa + 0.3, room.az);
    settle(20);
    const ids = sim.props.liveIds().filter((id) => id.startsWith(`c:${n.id}:`));
    const kinds = ids.map((id) => sim.props.defOf(id)!.kind);
    expect(kinds).toContain('peinture');
    expect(kinds).toContain('bloc_quartz');
    // Chaque peinture est plaquée contre la roche.
    for (const id of ids) {
      const d = sim.props.defOf(id)!;
      if (d.kind !== 'peinture') continue;
      const sdf = sim.terrain.caves.sdf(d.x, d.y, d.z);
      expect(sdf).toBeLessThan(0);
      expect(sdf).toBeGreaterThan(-0.6);
    }
    // Regarder la première peinture (Prendre/E en la visant).
    const paint = sim.props.defOf(ids.find((id) => sim.props.defOf(id)!.kind === 'peinture')!)!;
    const tag = paint.meta!.tag!;
    expect(sim.knowledge.docs).not.toContain(tag);
    const dx = room.ax - paint.x;
    const dz = room.az - paint.z;
    const l = Math.hypot(dx, dz);
    const sx = paint.x + (dx / l) * 1.2;
    const sz = paint.z + (dz / l) * 1.2;
    sim.teleport(sx, (sim.terrain.caves.floorBelow(sx, paint.y, sz) ?? room.fa) + 0.1, sz);
    settle(10);
    const yaw = Math.atan2(paint.x - sx, paint.z - sz);
    const eye = sim.state.y + 1.62;
    const pitch = Math.atan2(eye - paint.y, Math.hypot(paint.x - sx, paint.z - sz));
    sim.step(cmd(0, 0, 0, yaw, pitch));
    sim.step(cmd(0, 0, BTN_INTERACT, yaw, pitch));
    for (let i = 0; i < 5; i++) sim.step(cmd(0, 0, 0, yaw, pitch));
    expect(sim.knowledge.docs).toContain(tag);
  });

  it('le puits de la mine a son échelle : on la remonte sans s’épuiser', () => {
    const site = sim.placeSites().find((p) => p.kind === 'mine')!;
    sim.generatePlace(site);
    const shaft = net('mine').shaft!;
    const ladder = sim.build.structures.find((s) => s.pieces.length > 5 && s.pieces.every((p) => p.plan === 'echelle'))!;
    expect(ladder).toBeDefined();
    expect(ladder.pieces.length * 2.4).toBeGreaterThan(shaft.top - shaft.bottom);
    // Au fond du puits, face à l'échelle : on saute pour s'y agripper, puis on monte.
    const c = Math.cos(site.yaw);
    const n = Math.sin(site.yaw);
    // Pied de l'échelle (repère du lieu : 1,15 m au sud du centre du puits), on se place 0,5 m devant.
    const lx = shaft.x - n * 0.6;
    const lz = shaft.z - c * 0.6;
    sim.teleport(lx, shaft.bottom + 0.3, lz);
    settle(30);
    const yaw = Math.atan2(-n, -c);
    sim.step(cmd(0, 0, BTN_JUMP, yaw));
    let climbed = false;
    let minStamina = 100;
    for (let i = 0; i < 60 * 45 && sim.state.y < shaft.top - 0.5; i++) {
      sim.step(cmd(-n, -c, 0, yaw));
      if (sim.state.mode === MODE_CLIMB) climbed = true;
      minStamina = Math.min(minStamina, sim.state.stamina);
    }
    expect(climbed).toBe(true);
    expect(sim.state.y).toBeGreaterThan(shaft.top - 2);
    expect(minStamina).toBeGreaterThan(20);
  });
});
