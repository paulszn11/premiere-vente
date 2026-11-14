// Phase 9 : cycle jour/nuit (heure du monde, lumière) et faune selon l'heure.

import { beforeAll, describe, expect, it } from 'vitest';
import { DAY_SECONDS, dayOf, daylight, hourOf, isNight, nextTimeAt, sunDirection } from '../../src/shared/daynight';
import { initPhysics } from '../../src/shared/physics';
import { LocalSimulation } from '../../src/shared/simulation';
import { ambienceAt } from '../../src/client/render/sky';
import { FlatTerrain, cmd } from './helpers';

beforeAll(async () => {
  await initPhysics();
});

describe('heure du monde', () => {
  it('un monde commence à 7 h ; un jour dure 40 minutes, dont environ 10 de nuit', () => {
    expect(hourOf(0)).toBeCloseTo(7, 5);
    expect(dayOf(0)).toBe(1);
    expect(hourOf(DAY_SECONDS)).toBeCloseTo(7, 5);
    expect(dayOf(DAY_SECONDS)).toBe(2);
    let night = 0;
    for (let t = 0; t < DAY_SECONDS; t += 5) if (isNight(hourOf(t))) night += 5;
    expect(night / 60).toBeGreaterThan(9);
    expect(night / 60).toBeLessThan(13);
    // Midi : plein jour ; minuit : noir.
    const noon = nextTimeAt(0, 12);
    const midnight = nextTimeAt(0, 0);
    expect(hourOf(noon)).toBeCloseTo(12, 1);
    expect(daylight(hourOf(noon))).toBeGreaterThan(0.99);
    expect(daylight(hourOf(midnight))).toBe(0);
    // L'heure avance toujours (modulo 24).
    let prev = hourOf(0);
    for (let t = 1; t < DAY_SECONDS; t += 7) {
      const h = hourOf(t);
      const d = (h - prev + 24) % 24;
      expect(d).toBeGreaterThanOrEqual(0);
      expect(d).toBeLessThan(2);
      prev = h;
    }
  });

  it('le soleil se lève à l’est, passe au nord à midi (hémisphère sud), se couche à l’ouest', () => {
    const rise = sunDirection(6.5);
    const noon = sunDirection(12);
    const set = sunDirection(17.5);
    expect(rise.x).toBeGreaterThan(0.8);
    expect(set.x).toBeLessThan(-0.8);
    expect(noon.y).toBeGreaterThan(0.9);
    expect(noon.z).toBeGreaterThan(0);
  });

  it('ambiance : ciel bleu le jour, sombre la nuit, orangé au crépuscule ; noir sous terre', () => {
    const day = ambienceAt(12, 0);
    const night = ambienceAt(0, 0);
    const dusk = ambienceAt(18, 0);
    const under = ambienceAt(12, 0, undefined, 1);
    expect(day.sky[2]).toBeGreaterThan(0.7);
    expect(night.sky[2]).toBeLessThan(0.15);
    expect(dusk.sky[0]).toBeGreaterThan(dusk.sky[2]);
    expect(day.lightIntensity).toBeGreaterThan(night.lightIntensity * 3);
    expect(under.sky[0] + under.sky[1] + under.sky[2]).toBeLessThan(0.01);
    expect(under.hemiIntensity).toBeLessThan(0.05);
  });
});

describe('créatures selon l’heure', () => {
  const LEVEL = 10;
  function setup(time: number) {
    const s = new LocalSimulation(new FlatTerrain(LEVEL), { fauna: true });
    s.fauna.wild = false;
    s.time = time;
    for (let i = 0; i < 30; i++) s.step(cmd(0, 0));
    return s;
  }

  it('la nuit, une harde d’impalas se repose au lieu de brouter', () => {
    const night = setup(nextTimeAt(0, 23));
    night.spawnCreatures('impala', night.state.x + 80, night.state.z + 80, 5);
    for (let i = 0; i < 60 * 10; i++) night.step(cmd(0, 0));
    const modes = night.creatureViews().filter((c) => c.sp === 'impala').map((c) => c.mode);
    expect(modes.filter((m) => m === 'repos').length).toBeGreaterThanOrEqual(3);
    const day = setup(nextTimeAt(0, 11));
    day.spawnCreatures('impala', day.state.x + 80, day.state.z + 80, 5);
    for (let i = 0; i < 60 * 10; i++) day.step(cmd(0, 0));
    expect(day.creatureViews().filter((c) => c.sp === 'impala' && c.mode === 'repos').length).toBe(0);
  });

  it('dans le noir, les impalas voient le joueur de moins loin', () => {
    const detect = (time: number) => {
      const s = setup(time);
      const [id] = s.spawnCreatures('impala', s.state.x, s.state.z + 45, 1);
      const c = s.fauna.creatures.get(id!)!;
      c.yaw = Math.PI; // tourné vers le joueur
      let alert = 0;
      for (let i = 0; i < 60 * 4; i++) {
        s.step(cmd(0, 0, 0, 0, 0));
        alert = Math.max(alert, c.alert);
      }
      return alert;
    };
    const dayAlert = detect(nextTimeAt(0, 12));
    const nightAlert = detect(nextTimeAt(0, 0));
    expect(dayAlert).toBeGreaterThan(nightAlert);
  });
});
