import { describe, expect, it } from 'vitest';
import { ITEMS } from '../../src/shared/items';
import {
  type Activity,
  VITALS,
  type VitalEvent,
  type Vitals,
  addInjury,
  applyFall,
  applyTreatment,
  eat,
  fallAsleep,
  limits,
  makeVitals,
  readVitals,
  rescue,
  sitDown,
  tickVitals,
} from '../../src/shared/vitals';

const IDLE: Activity = { staminaSpent: 0, moving: false, loadKg: 0, inWater: false, drowning: false, grounded: true };

/** Fait vivre le corps pendant `seconds` secondes (pas de 1/60 s). */
function live(v: Vitals, seconds: number, a: Partial<Activity> = {}): VitalEvent[] {
  const out: VitalEvent[] = [];
  const act = { ...IDLE, ...a };
  for (let i = 0; i < Math.round(seconds * 60); i++) tickVitals(v, 1 / 60, act, out);
  return out;
}

describe('santé, énergie, fatigue', () => {
  it('en bonne santé : endurance maximale complète, aucune limite', () => {
    const lim = limits(makeVitals(1));
    expect(lim.maxStamina).toBe(100);
    expect(lim.speedCap).toBe(99);
    expect(lim.noSprint || lim.noJump || lim.noClimb || lim.noHeavy || lim.immobile).toBe(false);
  });

  it("l'effort consomme l'énergie, qui réduit l'endurance maximale ; on la retrouve en se reposant", () => {
    const v = makeVitals(1);
    live(v, 120, { staminaSpent: 11 / 60, moving: true }); // 2 minutes de course continue
    expect(v.energy).toBeLessThan(75);
    expect(limits(v).maxStamina).toBeLessThan(85);
    const idle = { ...v };
    live(idle, 60);
    sitDown(v);
    live(v, 60);
    expect(v.energy).toBeGreaterThan(idle.energy + 10);
  });

  it('à bout d’énergie, plus de course ; la nourriture ne rend pas d’énergie', () => {
    const v = makeVitals(1);
    v.energy = 10;
    expect(limits(v).noSprint).toBe(true);
    eat(v, ITEMS.fruit_baobab.food!);
    live(v, 1, { moving: true });
    expect(v.energy).toBeLessThan(10.1);
  });

  it('la fatigue monte avec le temps éveillé (environ 3 h) et réduit l’énergie maximale', () => {
    const v = makeVitals(1);
    v.fatigue = 0;
    live(v, 3600);
    expect(v.fatigue).toBeGreaterThan(30);
    expect(v.fatigue).toBeLessThan(40);
    v.fatigue = 90;
    v.energy = 100;
    live(v, 1);
    expect(v.energy).toBeLessThanOrEqual(60.01);
  });

  it('dormir : il faut avoir sommeil ; après une minute, l’endroit devient le point de réapparition', () => {
    const v = makeVitals(1);
    v.fatigue = 10;
    expect(fallAsleep(v)).toBe(false);
    v.fatigue = 80;
    v.energy = 40;
    expect(fallAsleep(v)).toBe(true);
    const ev = live(v, 61);
    expect(ev.some((e) => e.type === 'repere')).toBe(true);
    expect(v.fatigue).toBeLessThan(50);
    expect(v.energy).toBeGreaterThan(70);
    const end = live(v, 200);
    expect(end.some((e) => e.type === 'reveille')).toBe(true);
    expect(v.posture).toBe('debout');
    expect(v.fatigue).toBeLessThan(2);
  });

  it('épuisé de fatigue, on s’endort sur place', () => {
    const v = makeVitals(1);
    v.fatigue = 99.99;
    const ev = live(v, 2, { moving: true });
    expect(ev.some((e) => e.type === 'endormi' && e.forced)).toBe(true);
    expect(v.posture).toBe('endormi');
  });

  it('la nourriture rend de la santé pendant la digestion, 3 aliments au plus à la fois', () => {
    const v = makeVitals(1);
    v.health = 40;
    expect(eat(v, ITEMS.fruit_baobab.food!)).toBe(true);
    expect(eat(v, ITEMS.figue.food!)).toBe(true);
    expect(eat(v, ITEMS.muhacha.food!)).toBe(true);
    expect(eat(v, ITEMS.figue.food!)).toBe(false);
    live(v, 10);
    expect(v.health).toBeGreaterThan(50);
    live(v, 40);
    expect(v.health).toBeCloseTo(40 + 20 + 5 + 7, 0);
    expect(v.digest).toHaveLength(0);
  });
});

describe('blessures et soins', () => {
  it('coupure grave : saigne 0,5 point par seconde jusqu’au bandage', () => {
    const v = makeVitals(1);
    const cut = addInjury(v, 'bras_g', 'coupure', true);
    live(v, 10);
    expect(v.health).toBeCloseTo(95, 0);
    expect(applyTreatment(v, cut.id, 'bander')).toBe(true);
    const h = v.health;
    live(v, 10);
    expect(v.health).toBeCloseTo(h, 5);
  });

  it('coupure légère : s’arrête seule au bout de 2 min 30', () => {
    const v = makeVitals(1);
    addInjury(v, 'jambe_d', 'coupure', false);
    const ev = live(v, 160);
    expect(ev.some((e) => e.type === 'saignement_arrete')).toBe(true);
    expect(v.health).toBeGreaterThan(80);
  });

  it('jambe cassée : on boite, sans courir, sauter ni grimper ; sans attelle, elle ne guérit pas', () => {
    const v = makeVitals(1);
    const f = addInjury(v, 'jambe_g', 'fracture');
    const lim = limits(v);
    expect(lim.speedCap).toBeLessThan(1);
    expect(lim.noSprint && lim.noJump && lim.noClimb).toBe(true);
    live(v, 600);
    expect(f.heal).toBe(0);
    expect(applyTreatment(v, f.id, 'attelle')).toBe(true);
    expect(limits(v).speedCap).toBeGreaterThan(1);
    sitDown(v);
    const ev = live(v, 1300);
    expect(ev.some((e) => e.type === 'gueri' && e.kind === 'fracture')).toBe(true);
    expect(limits(v).noJump).toBe(false);
  });

  it('marcher sur une jambe cassée sans attelle provoque un choc et une perte de connaissance', () => {
    const v = makeVitals(1);
    addInjury(v, 'jambe_d', 'fracture');
    const ev = live(v, 20, { moving: true });
    expect(ev.some((e) => e.type === 'inconscient' && e.reason === 'choc')).toBe(true);
    expect(v.state).toBe('inconscient');
    const after = live(v, 25);
    expect(after.some((e) => e.type === 'reveil')).toBe(true);
  });

  it('bras cassé : ni escalade, ni objet à deux mains, ni lancer', () => {
    const v = makeVitals(1);
    addInjury(v, 'bras_d', 'fracture');
    const lim = limits(v);
    expect(lim.noClimb && lim.noHeavy && lim.noThrow).toBe(true);
    expect(lim.speedCap).toBe(99);
  });

  it('une plaie bandée sans être désinfectée peut s’infecter : fièvre, puis guérison avec l’aloès', () => {
    let found: Vitals | null = null;
    for (let seed = 1; seed < 200 && !found; seed++) {
      const v = makeVitals(seed);
      const cut = addInjury(v, 'bras_g', 'coupure', true);
      applyTreatment(v, cut.id, 'bander');
      if (cut.infectAt >= 0) found = v;
    }
    expect(found).not.toBeNull();
    const v = found!;
    const cut = v.injuries[0]!;
    const ev = live(v, cut.infectAt + 60);
    expect(ev.some((e) => e.type === 'infection')).toBe(true);
    expect(limits(v).fever).toBeGreaterThan(0.1);
    const h = v.health;
    live(v, 60);
    expect(v.health).toBeLessThan(h);
    expect(applyTreatment(v, cut.id, 'aloes')).toBe(true);
    const cured = live(v, 300);
    expect(cured.some((e) => e.type === 'fievre_finie')).toBe(true);
    expect(limits(v).fever).toBe(0);
  });

  it('désinfecter avant de bander rend l’infection très rare', () => {
    let infections = 0;
    for (let seed = 1; seed <= 200; seed++) {
      const v = makeVitals(seed);
      const cut = addInjury(v, 'bras_g', 'coupure', true);
      applyTreatment(v, cut.id, 'aloes');
      applyTreatment(v, cut.id, 'bander');
      if (cut.infectAt >= 0) infections++;
    }
    expect(infections).toBeLessThan(15);
  });

  it('chutes : mortelle, grave (fracture ou entorse), légère', () => {
    const dead = makeVitals(1);
    applyFall(dead, 4);
    expect(dead.state).toBe('mort');
    expect(dead.cause).toBe('chute');
    for (let seed = 1; seed <= 20; seed++) {
      const v = makeVitals(seed);
      const added = applyFall(v, 3);
      expect(v.health).toBeLessThanOrEqual(75);
      expect(added.some((i) => (i.zone === 'jambe_g' || i.zone === 'jambe_d') && (i.kind === 'fracture' || i.kind === 'entorse'))).toBe(true);
      const light = makeVitals(seed);
      applyFall(light, 2);
      expect(light.health).toBeGreaterThan(85);
    }
  });
});

describe('perte de connaissance, état critique, mort', () => {
  it('à 0 de santé sans saignement : inconscient, puis réveil seul, très affaibli', () => {
    const v = makeVitals(1);
    v.health = 0.01;
    addInjury(v, 'jambe_g', 'contusion');
    v.health = 0;
    const ev = live(v, 1);
    expect(ev.some((e) => e.type === 'inconscient')).toBe(true);
    expect(limits(v).immobile).toBe(true);
    const wake = live(v, VITALS.unconsciousSeconds + 1);
    expect(wake.some((e) => e.type === 'reveil')).toBe(true);
    expect(v.health).toBe(VITALS.wakeHealth);
  });

  it('à 0 de santé avec un saignement : état critique, mort au bout de 90 s', () => {
    const v = makeVitals(1);
    addInjury(v, 'torse', 'coupure', true);
    v.health = 1;
    const ev = live(v, 3);
    expect(ev.some((e) => e.type === 'critique')).toBe(true);
    const end = live(v, VITALS.criticalSeconds);
    expect(end.some((e) => e.type === 'mort' && e.cause === 'hemorragie')).toBe(true);
    expect(v.state).toBe('mort');
  });

  it('secours par un autre joueur : il bande la plaie et réveille le blessé', () => {
    const v = makeVitals(1);
    addInjury(v, 'torse', 'coupure', true);
    v.health = 0;
    live(v, 1);
    expect(v.state).toBe('critique');
    expect(rescue(v, true)).toEqual({ ok: true, usedRag: true });
    expect(v.state).toBe('eveille');
    expect(v.health).toBeGreaterThanOrEqual(15);
    expect(limits(v).bleeding).toBe(0);
  });

  it('inconscient dans l’eau : noyade', () => {
    const v = makeVitals(1);
    v.health = 0;
    const ev = live(v, VITALS.drownUnconsciousSeconds + 1, { inWater: true, grounded: false });
    expect(ev.some((e) => e.type === 'mort' && e.cause === 'noyade')).toBe(true);
  });

  it('souffle épuisé sous l’eau : la santé chute vite', () => {
    const v = makeVitals(1);
    live(v, 5, { inWater: true, grounded: false, drowning: true });
    expect(v.health).toBeLessThan(55);
  });

  it('une sauvegarde est relue sans erreur et sans valeurs absurdes', () => {
    const v = readVitals({ health: 500, energy: -3, fatigue: 'beaucoup', injuries: [{ zone: 'tete', kind: 'commotion' }, { zone: 'aile', kind: 'fracture' }], digest: [{ rate: 1, left: 5 }] }, 7);
    expect(v.health).toBe(100);
    expect(v.energy).toBe(0);
    expect(v.injuries).toHaveLength(1);
    expect(v.digest).toHaveLength(1);
    expect(v.state).toBe('eveille');
  });
});
