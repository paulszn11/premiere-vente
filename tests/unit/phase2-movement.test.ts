import { beforeAll, describe, expect, it } from 'vitest';
import { MOVE, PHYS_CHUNK_RADIUS, STAMINA, SWIM, TICK_DT, WATER_LEVEL } from '../../src/shared/constants';
import { BTN_CROUCH, BTN_JUMP, BTN_SPRINT, MODE_CLIMB, MODE_SWIM, MODE_WALK, type MoveState, makeState, quantizeInput, stepMovement } from '../../src/shared/movement';
import { GROUP_TERRAIN, PhysicsWorld, RAPIER, TERRAIN_GROUPS, initPhysics } from '../../src/shared/physics';
import type { Terrain } from '../../src/shared/terrain';
import { CliffTerrain, FlatTerrain, FnTerrain, cmd } from './helpers';

beforeAll(async () => {
  await initPhysics();
});

const YAW_EAST = Math.PI / 2; // regard vers +x

function world(terrain: Terrain, x: number, y: number, z: number) {
  const phys = new PhysicsWorld(terrain);
  const state = makeState(x, y, z);
  phys.ensureAround([state], PHYS_CHUNK_RADIUS + 1, 0);
  phys.refresh();
  const collider = phys.createPlayerCollider(x, y, z);
  let tick = 0;
  const run = (n: number, wx: number, wz: number, buttons = 0, yaw = 0, pitch = 0, onTick?: (s: MoveState) => void) => {
    for (let i = 0; i < n; i++) {
      phys.ensureAround([state], PHYS_CHUNK_RADIUS, tick++);
      stepMovement(phys, collider, state, quantizeInput(cmd(wx, wz, buttons, yaw, pitch)), TICK_DT);
      phys.step(TICK_DT);
      onTick?.(state);
    }
  };
  return { phys, state, run, collider };
}

const dist = (a: { x: number; z: number }, b: { x: number; z: number }) => Math.hypot(a.x - b.x, a.z - b.z);

describe('sols', () => {
  it('la boue ralentit nettement par rapport à l’herbe', () => {
    const grass = world(new FlatTerrain(10), 0, 10, 0);
    const mud = world(new FlatTerrain(10, { biome: 'vlei' }), 0, 10, 0);
    for (const w of [grass, mud]) w.run(30, 0, 0);
    const g0 = { ...grass.state };
    const m0 = { ...mud.state };
    grass.run(120, 0, 1);
    mud.run(120, 0, 1);
    expect(mud.state.surface).toBe('boue');
    expect(grass.state.surface).toBe('herbe');
    const ratio = dist(mud.state, m0) / dist(grass.state, g0);
    expect(ratio).toBeGreaterThan(0.45);
    expect(ratio).toBeLessThan(0.65);
  });

  it('dans l’eau peu profonde, on avance moins vite', () => {
    const w = world(new FlatTerrain(WATER_LEVEL - 0.9), 0, WATER_LEVEL - 0.9, 0);
    w.run(30, 0, 0);
    const z0 = w.state.z;
    w.run(120, 0, 1);
    expect(w.state.mode).toBe(MODE_WALK);
    expect(w.state.surface).toBe('eau');
    expect(w.state.z - z0).toBeLessThan(2.4);
    expect(w.state.z - z0).toBeGreaterThan(0.8);
  });
});

describe('accroupissement', () => {
  it('accroupi : plus lent, et impossible de se relever sous un plafond bas', () => {
    const w = world(new FlatTerrain(10), 0, 10, 0);
    w.run(30, 0, 0);
    // Plafond à 1,4 m au-dessus du sol, de z = 2 à z = 6.
    w.phys.world.createCollider(RAPIER.ColliderDesc.cuboid(3, 0.1, 2).setTranslation(0, 11.5, 4).setCollisionGroups(TERRAIN_GROUPS));
    w.phys.step(TICK_DT);
    const z0 = w.state.z;
    w.run(60, 0, 1, BTN_CROUCH);
    expect(w.state.crouched).toBe(true);
    expect(w.state.z - z0).toBeLessThan(MOVE.crouchSpeed + 0.05);
    w.run(180, 0, 1, BTN_CROUCH); // passe sous le plafond
    expect(w.state.z).toBeGreaterThan(2.5);
    expect(w.state.z).toBeLessThan(5.5);
    w.run(10, 0, 0, 0); // relâche : reste accroupi sous le plafond
    expect(w.state.crouched).toBe(true);
    w.run(300, 0, 1, 0); // sort de dessous : se relève
    expect(w.state.z).toBeGreaterThan(6.3);
    expect(w.state.crouched).toBe(false);
    expect(GROUP_TERRAIN).toBe(1);
  });
});

describe('endurance et équilibre', () => {
  it('la course épuise l’endurance, puis on ne peut plus courir jusqu’à récupération', () => {
    const w = world(new FlatTerrain(10), 0, 10, 0);
    w.run(30, 0, 0);
    let exhaustedAt = -1;
    for (let i = 0; i < 900 && exhaustedAt < 0; i++) {
      w.run(1, 0, 1, BTN_SPRINT);
      if (w.state.exhausted) exhaustedAt = i;
    }
    // 100 / 11 par seconde ≈ 9 s de course.
    expect(exhaustedAt / 60).toBeGreaterThan(8);
    expect(exhaustedAt / 60).toBeLessThan(10.5);
    w.run(60, 0, 1, BTN_SPRINT);
    expect(Math.hypot(w.state.vx, w.state.vz)).toBeLessThan(MOVE.walkSpeed + 0.05);
    w.run(180, 0, 0); // repos
    expect(w.state.stamina).toBeGreaterThan(STAMINA.recoverAt);
    expect(w.state.exhausted).toBe(false);
  });

  it('demi-tours brusques en pleine course : le joueur trébuche', () => {
    const w = world(new FlatTerrain(10), 0, 10, 0);
    w.run(30, 0, 0);
    let stumbled = false;
    for (let k = 0; k < 8 && !stumbled; k++) {
      w.run(70, 0, 1, BTN_SPRINT, 0, 0, (s) => {
        if (s.stumble > 0) stumbled = true;
      });
      w.run(50, 0, -1, BTN_SPRINT, 0, 0, (s) => {
        if (s.stumble > 0) stumbled = true;
      });
    }
    expect(stumbled).toBe(true);
  });
});

describe('chutes', () => {
  const dropFrom = (height: number, terrain: Terrain, buttons = 0) => {
    const w = world(terrain, 0, terrain.heightAt(0, 0) + height, 0);
    let severity = 0;
    let speed = 0;
    let fallHeight = 0;
    w.run(240, 0, 0, buttons, 0, 0, (s) => {
      if (s.impactSeverity > severity || (s.impact > 0 && severity === 0)) {
        severity = s.impactSeverity;
        speed = s.impact;
        fallHeight = s.impactHeight;
      }
    });
    return { severity, speed, fallHeight, state: w.state };
  };

  it('la gravité dépend de la hauteur', () => {
    expect(dropFrom(1, new FlatTerrain(10)).severity).toBe(0);
    expect(dropFrom(3.2, new FlatTerrain(10)).severity).toBe(1);
    const high = dropFrom(12, new FlatTerrain(10));
    expect(high.severity).toBe(3);
    expect(high.fallHeight).toBeGreaterThan(11);
    expect(dropFrom(20, new FlatTerrain(10)).severity).toBe(4);
  });

  it('la surface et la posture amortissent', () => {
    expect(dropFrom(12, new FlatTerrain(10, { biome: 'vlei' })).severity).toBe(2);
    const water = dropFrom(15, new FlatTerrain(-12));
    expect(water.state.mode).toBe(MODE_SWIM);
    expect(water.severity).toBe(0);
    expect(dropFrom(12, new FlatTerrain(10), BTN_CROUCH).speed).toBeLessThan(dropFrom(12, new FlatTerrain(10)).speed);
  });
});

describe('nage et plongée', () => {
  it('en eau profonde, on flotte, la tête hors de l’eau', () => {
    const w = world(new FlatTerrain(-8), 0, -2, 0);
    w.run(240, 0, 0);
    expect(w.state.mode).toBe(MODE_SWIM);
    expect(Math.abs(w.state.y - (WATER_LEVEL - SWIM.floatDepth))).toBeLessThan(0.15);
    expect(w.state.breath).toBe(100);
  });

  it('on nage à environ 1,1 m/s et plus vite en forçant', () => {
    const w = world(new FlatTerrain(-8), 0, -1.45, 0);
    w.run(60, 0, 0);
    let z0 = w.state.z;
    w.run(180, 0, 1);
    expect((w.state.z - z0) / 3).toBeGreaterThan(0.85);
    expect((w.state.z - z0) / 3).toBeLessThan(1.15);
    z0 = w.state.z;
    w.run(180, 0, 1, BTN_SPRINT);
    expect((w.state.z - z0) / 3).toBeGreaterThan(1.4);
    expect(w.state.stamina).toBeLessThan(80);
  });

  it('plonger fait baisser le souffle, remonter le restaure', () => {
    const w = world(new FlatTerrain(-12), 0, -1.45, 0);
    w.run(60, 0, 0);
    w.run(300, 0, 0, BTN_CROUCH); // descend 5 s
    expect(w.state.y).toBeLessThan(-4);
    expect(w.state.breath).toBeLessThan(90);
    w.run(600, 0, 0, BTN_JUMP); // remonte
    expect(w.state.breath).toBeGreaterThan(95);
  });

  it('le courant entraîne le nageur', () => {
    class River extends FnTerrain {
      override currentAt() {
        return { x: 0.75, z: 0 };
      }
    }
    const w = world(new River(() => -8), 0, -1.45, 0);
    w.run(300, 0, 0);
    expect(w.state.x).toBeGreaterThan(2.5);
  });

  it('on sort de l’eau en marchant sur une berge', () => {
    const w = world(new FnTerrain((x) => Math.min(4, -6 + x * 0.25)), 0, -1.45, 0);
    w.run(60, 0, 0);
    expect(w.state.mode).toBe(MODE_SWIM);
    w.run(1500, 1, 0);
    expect(w.state.mode).toBe(MODE_WALK);
    expect(w.state.y).toBeGreaterThan(WATER_LEVEL);
  });
});

describe('escalade', () => {
  it('saut face à une paroi raide : on grimpe, puis on passe le rebord', () => {
    const w = world(new CliffTerrain(5, 6), -0.5, 5, 0);
    w.run(30, 0, 0, 0, YAW_EAST);
    w.run(1, 1, 0, BTN_JUMP, YAW_EAST);
    expect(w.state.mode).toBe(MODE_CLIMB);
    let maxY = w.state.y;
    let climbedTicks = 0;
    for (let i = 0; i < 900 && w.state.mode === MODE_CLIMB; i++) {
      w.run(1, 1, 0, 0, YAW_EAST);
      maxY = Math.max(maxY, w.state.y);
      climbedTicks++;
    }
    expect(w.state.mode).toBe(MODE_WALK);
    w.run(60, 1, 0, 0, YAW_EAST);
    expect(w.state.y).toBeGreaterThan(10.8);
    expect(w.state.x).toBeGreaterThan(1.5);
    expect(w.state.stamina).toBeLessThan(STAMINA.max);
    expect(climbedTicks).toBeGreaterThan(60);
  });

  it('on lâche prise (accroupi) ou on tombe quand l’endurance est épuisée', () => {
    const w = world(new CliffTerrain(5, 30), -0.5, 5, 0);
    w.run(30, 0, 0, 0, YAW_EAST);
    w.run(1, 1, 0, BTN_JUMP, YAW_EAST);
    w.run(120, 1, 0, 0, YAW_EAST);
    expect(w.state.mode).toBe(MODE_CLIMB);
    w.run(1, 0, 0, BTN_CROUCH, YAW_EAST);
    expect(w.state.mode).toBe(MODE_WALK);
    w.run(120, 0, 0, 0, YAW_EAST);
    expect(w.state.grounded).toBe(true);

    w.run(1, 1, 0, BTN_JUMP, YAW_EAST);
    expect(w.state.mode).toBe(MODE_CLIMB);
    w.state.stamina = 12;
    w.run(240, 0, 0, 0, YAW_EAST);
    expect(w.state.mode).toBe(MODE_WALK);
  });

  it('pas d’escalade sur une pente douce : le saut reste un saut', () => {
    const w = world(new FnTerrain((x) => (x > 0 ? x * 0.5 : 0)), -0.5, 0, 0);
    w.run(30, 0, 0, 0, YAW_EAST);
    w.run(1, 1, 0, BTN_JUMP, YAW_EAST);
    expect(w.state.mode).toBe(MODE_WALK);
    expect(w.state.vy).toBeGreaterThan(0);
  });
});
