// Corps du joueur : santé, énergie, fatigue, blessures localisées, soins, conscience.
// Pas de faim, de soif ni de température (cahier des charges, 7.3) : la nourriture sert
// uniquement à restaurer la santé. Tout est déterministe (générateur pseudo-aléatoire
// rangé dans l'état) : en phase 8, le serveur de l'hôte fera foi.

import type { FoodEffect, ItemId } from './items';

export type Zone = 'tete' | 'torse' | 'bras_g' | 'bras_d' | 'jambe_g' | 'jambe_d';
export type InjuryKind = 'contusion' | 'entorse' | 'fracture' | 'coupure' | 'commotion';
export type Treatment = 'bander' | 'attelle' | 'aloes';
export type Consciousness = 'eveille' | 'inconscient' | 'critique' | 'mort';
export type Posture = 'debout' | 'assis' | 'endormi';
export type DeathCause = 'chute' | 'noyade' | 'hemorragie' | 'infection' | 'abandon' | 'attaque';

export const ZONES: Zone[] = ['tete', 'torse', 'bras_g', 'bras_d', 'jambe_g', 'jambe_d'];
export const ZONE_LABELS: Record<Zone, string> = {
  tete: 'tête',
  torse: 'torse',
  bras_g: 'bras gauche',
  bras_d: 'bras droit',
  jambe_g: 'jambe gauche',
  jambe_d: 'jambe droite',
};
export const INJURY_LABELS: Record<InjuryKind, string> = {
  contusion: 'contusion',
  entorse: 'entorse',
  fracture: 'fracture',
  coupure: 'coupure',
  commotion: 'commotion',
};
export const TREATMENT_LABELS: Record<Treatment, string> = { bander: 'Bander', attelle: 'Poser une attelle', aloes: "Appliquer de l'aloès" };
export const DEATH_LABELS: Record<DeathCause, string> = {
  chute: 'une chute mortelle',
  noyade: 'la noyade',
  hemorragie: 'une hémorragie',
  infection: 'une infection',
  abandon: 'vos blessures',
  attaque: 'l’attaque d’un animal',
};

export interface Injury {
  id: number;
  zone: Zone;
  kind: InjuryKind;
  /** Coupure grave : saignement fort, qui ne s'arrête pas seul. */
  grave: boolean;
  /** Secondes depuis la blessure. */
  age: number;
  /** Guérison de 0 à 1 (la blessure disparaît à 1). */
  heal: number;
  bandaged: boolean;
  splinted: boolean;
  disinfected: boolean;
  /** Saignement léger arrêté de lui-même. */
  clotted: boolean;
  /** Infection de 0 (aucune) à 1 (fièvre forte). */
  infection: number;
  /** Âge auquel l'infection se déclarera (−1 : pas d'infection prévue). */
  infectAt: number;
}

export interface Vitals {
  health: number;
  energy: number;
  fatigue: number;
  state: Consciousness;
  /** Inconscient : secondes avant le réveil. Critique : secondes avant la mort. */
  timer: number;
  /** Choc accumulé en bougeant sur une jambe cassée sans attelle (0 à 100). */
  shock: number;
  posture: Posture;
  /** Durée du sommeil en cours. */
  sleepTime: number;
  /** Aliments en digestion : santé rendue par seconde et secondes restantes. */
  digest: Array<{ rate: number; left: number }>;
  injuries: Injury[];
  nextId: number;
  rng: number;
  /** Secondes de soulagement de la douleur restantes (aloès). */
  painRelief: number;
  /** Micro-sommeil en cours (fatigue extrême) et délai avant le prochain. */
  microSleep: number;
  microTimer: number;
  /** Secondes passées inconscient dans l'eau. */
  waterTime: number;
  cause: DeathCause | null;
}

export const VITALS = {
  max: 100,
  wakeHealth: 10,
  unconsciousSeconds: 30,
  criticalSeconds: 90,
  /** Inconscient mais stabilisé (saignement arrêté pendant l'état critique). */
  stableSeconds: 45,
  shockUnconsciousSeconds: 20,
  concussionUnconsciousSeconds: 15,
  respawn: { health: 70, energy: 70, fatigue: 20 },
  stomach: 3,
  // Énergie : réserve qui fixe le maximum de l'endurance.
  energyPerStamina: 0.02,
  energyWalk: 0.004,
  energyLoadPerKg: 0.0015,
  energyIdle: 0.04,
  energySit: 0.35,
  energySleep: 0.6,
  // Fatigue : besoin de sommeil (environ 3 h éveillé pour aller de 0 à 100).
  fatigueAwake: 100 / (3 * 3600),
  fatiguePerStamina: 0.0004,
  fatigueSleep: 0.55,
  sleepMinFatigue: 20,
  sleepHeal: 0.04,
  /** Après une minute de sommeil, l'endroit devient le point de réapparition. */
  sleepRespawnSeconds: 60,
  // Saignements (santé perdue par seconde).
  bleedLight: 0.12,
  bleedHeavy: 0.5,
  clotSeconds: 150,
  shockMoving: 6,
  shockDecay: 2,
  drownDamage: 10,
  drownUnconsciousSeconds: 8,
  painReliefSeconds: 300,
};

const HEAL_SECONDS: Record<InjuryKind, number> = { contusion: 240, entorse: 900, fracture: 1800, coupure: 300, commotion: 240 };

export function makeVitals(seed: number): Vitals {
  return {
    health: VITALS.max,
    energy: VITALS.max,
    fatigue: 10,
    state: 'eveille',
    timer: 0,
    shock: 0,
    posture: 'debout',
    sleepTime: 0,
    digest: [],
    injuries: [],
    nextId: 1,
    rng: seed >>> 0 || 1,
    painRelief: 0,
    microSleep: 0,
    microTimer: 30,
    waterTime: 0,
    cause: null,
  };
}

/** Nombre pseudo-aléatoire dans [0, 1), avance le générateur de l'état. */
export function rand(v: Vitals): number {
  let t = (v.rng = (v.rng + 0x6d2b79f5) >>> 0);
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

export function isLeg(z: Zone): boolean {
  return z === 'jambe_g' || z === 'jambe_d';
}

export function isArm(z: Zone): boolean {
  return z === 'bras_g' || z === 'bras_d';
}

export function bleedRate(i: Injury): number {
  if (i.kind !== 'coupure' || i.bandaged || i.clotted) return 0;
  return i.grave ? VITALS.bleedHeavy : VITALS.bleedLight;
}

export function totalBleeding(v: Vitals): number {
  let b = 0;
  for (const i of v.injuries) b += bleedRate(i);
  return b;
}

export function feverOf(v: Vitals): number {
  let f = 0;
  for (const i of v.injuries) f = Math.max(f, i.infection);
  return f;
}

/** Perte de santé continue (saignements, fièvre), en points par seconde. */
export function ongoingLoss(v: Vitals): number {
  return totalBleeding(v) + 0.03 * feverOf(v);
}

function injuryPain(i: Injury): number {
  let p: number;
  switch (i.kind) {
    case 'contusion':
      p = 8;
      break;
    case 'entorse':
      p = i.bandaged ? 12 : 20;
      break;
    case 'fracture':
      p = i.splinted ? 20 : 45;
      break;
    case 'coupure':
      p = i.grave ? 25 : 10;
      break;
    default:
      p = 15;
  }
  p *= 0.4 + 0.6 * (1 - i.heal);
  return p + 15 * Math.min(1, i.infection);
}

export function painOf(v: Vitals): number {
  let p = 0;
  for (const i of v.injuries) p += injuryPain(i);
  return Math.min(100, p) * (v.painRelief > 0 ? 0.6 : 1);
}

/** Énergie maximale : la fatigue au-delà de 50 la réduit (jusqu'à 50 à fatigue 100). */
export function energyCap(v: Vitals): number {
  return VITALS.max - Math.max(0, v.fatigue - 50);
}

// ——— Effets sur le corps ———

export interface BodyLimits {
  /** Endurance maximale (énergie, douleur, fièvre). */
  maxStamina: number;
  regenMul: number;
  /** Vitesse maximale au sol (m/s, 99 : aucune limite). */
  speedCap: number;
  speedMul: number;
  /** Coût en endurance des efforts (escalade, port). */
  drainMul: number;
  noSprint: boolean;
  noJump: boolean;
  noClimb: boolean;
  /** Pas d'objet à deux mains. */
  noHeavy: boolean;
  noThrow: boolean;
  /** Aucun déplacement (inconscient, assis, endormi). */
  immobile: boolean;
  pain: number;
  bleeding: number;
  fever: number;
  /** Vision trouble de 0 à 1 (commotion, fatigue extrême). */
  blur: number;
}

export function limits(v: Vitals): BodyLimits {
  let legFracture = 0;
  let legSplinted = 0;
  let legSprain = 0;
  let legSprainBandaged = 0;
  let armFracture = 0;
  let armSprain = 0;
  let concussion = 0;
  for (const i of v.injuries) {
    if (isLeg(i.zone)) {
      if (i.kind === 'fracture') {
        if (i.splinted) legSplinted++;
        else legFracture++;
      } else if (i.kind === 'entorse') {
        legSprain++;
        if (i.bandaged) legSprainBandaged++;
      }
    } else if (isArm(i.zone)) {
      if (i.kind === 'fracture') armFracture++;
      else if (i.kind === 'entorse') armSprain++;
    } else if (i.kind === 'commotion') concussion = Math.max(concussion, 1 - i.heal);
  }
  let speedCap = 99;
  if (legFracture >= 2) speedCap = 0.45;
  else if (legFracture === 1) speedCap = legSplinted ? 0.6 : 0.8;
  else if (legSplinted >= 2) speedCap = 0.9;
  else if (legSplinted === 1) speedCap = 1.3;
  else if (legSprain > 0) speedCap = legSprainBandaged === legSprain ? 1.7 : 1.4;

  const pain = painOf(v);
  const fever = feverOf(v);
  let regenMul = (0.5 + (0.5 * v.energy) / VITALS.max) * (pain > 60 ? 0.75 : 1) * (1 - 0.3 * fever);
  let maxStamina = 25 + 0.75 * v.energy - 0.15 * pain - 20 * fever;
  maxStamina = Math.max(15, Math.min(VITALS.max, maxStamina));
  let speedMul = 1;
  if (concussion > 0) speedMul *= 0.9;
  if (v.fatigue >= 90) speedMul *= 0.9;
  if (v.health < 25) speedMul *= 0.85;
  if (v.state !== 'eveille') regenMul = 0;
  let blur = 0.6 * concussion;
  if (v.fatigue > 85) blur += ((v.fatigue - 85) / 15) * 0.4;
  return {
    maxStamina,
    regenMul,
    speedCap,
    speedMul,
    drainMul: armSprain > 0 ? 1.5 : 1,
    noSprint: legFracture + legSplinted + legSprain > 0 || v.energy < 15,
    noJump: legFracture + legSplinted > 0 || legSprain > legSprainBandaged,
    noClimb: legFracture + legSplinted + armFracture > 0,
    noHeavy: armFracture > 0,
    noThrow: armFracture > 0,
    immobile: v.state !== 'eveille' || v.posture !== 'debout',
    pain,
    bleeding: totalBleeding(v),
    fever,
    blur: Math.min(1, blur),
  };
}

// ——— Blessures ———

function newInjury(v: Vitals, zone: Zone, kind: InjuryKind, grave: boolean): Injury {
  return { id: v.nextId++, zone, kind, grave, age: 0, heal: 0, bandaged: false, splinted: false, disinfected: false, clotted: false, infection: 0, infectAt: -1 };
}

/** Ajoute une blessure ; une blessure du même type sur la même zone s'aggrave. */
export function addInjury(v: Vitals, zone: Zone, kind: InjuryKind, grave = false): Injury {
  const same = v.injuries.find((i) => i.zone === zone && i.kind === kind && (kind !== 'coupure' || i.grave === grave) && !(kind === 'coupure' && (i.bandaged || i.clotted)));
  if (same) {
    same.heal = 0;
    if (kind === 'fracture') same.splinted = false;
    return same;
  }
  if (kind === 'entorse') {
    const frac = v.injuries.find((i) => i.zone === zone && i.kind === 'fracture');
    if (frac) {
      frac.heal = Math.max(0, frac.heal - 0.2);
      return frac;
    }
  }
  if (kind === 'fracture') {
    // Une fracture remplace l'entorse de la même zone.
    v.injuries = v.injuries.filter((i) => !(i.zone === zone && i.kind === 'entorse'));
  }
  const inj = newInjury(v, zone, kind, grave);
  v.injuries.push(inj);
  return inj;
}

function pick<T>(v: Vitals, list: readonly T[]): T {
  return list[Math.min(list.length - 1, Math.floor(rand(v) * list.length))]!;
}

export function damage(v: Vitals, amount: number): void {
  if (v.state === 'mort' || amount <= 0) return;
  v.health = Math.max(0, v.health - amount);
  // La douleur réveille.
  if (v.posture !== 'debout') {
    v.posture = 'debout';
    v.sleepTime = 0;
  }
}

export function die(v: Vitals, cause: DeathCause): void {
  if (v.state === 'mort') return;
  v.state = 'mort';
  v.cause = cause;
  v.timer = 0;
  v.posture = 'debout';
  v.health = 0;
}

export function knockOut(v: Vitals, seconds: number): void {
  if (v.state === 'mort') return;
  v.posture = 'debout';
  v.sleepTime = 0;
  if (v.state === 'critique') return;
  const already = v.state === 'inconscient';
  v.state = 'inconscient';
  v.timer = Math.max(already ? v.timer : 0, seconds);
}

/**
 * Conséquences d'une chute selon sa gravité (1 : trébucher, 2 : légère, 3 : grave,
 * 4 : mortelle), en tenant compte des blessures déjà présentes aux jambes.
 */
export function applyFall(v: Vitals, severity: number): Injury[] {
  const added: Injury[] = [];
  if (v.state === 'mort' || severity <= 0) return added;
  if (severity >= 4) {
    die(v, 'chute');
    return added;
  }
  const leg: Zone = rand(v) < 0.5 ? 'jambe_g' : 'jambe_d';
  // Une jambe déjà blessée encaisse moins bien.
  const weak = v.injuries.some((i) => isLeg(i.zone) && (i.kind === 'fracture' || i.kind === 'entorse'));
  const sev = severity === 2 && weak ? 3 : severity;
  if (sev === 1) {
    if (rand(v) < 0.25) added.push(addInjury(v, leg, 'contusion'));
    return added;
  }
  if (sev === 2) {
    damage(v, 6 + rand(v) * 8);
    added.push(addInjury(v, leg, rand(v) < 0.6 ? 'contusion' : 'entorse'));
    if (rand(v) < 0.15) added.push(addInjury(v, pick(v, ['bras_g', 'bras_d', 'jambe_g', 'jambe_d'] as const), 'coupure', false));
    return added;
  }
  damage(v, 25 + rand(v) * 15);
  added.push(addInjury(v, leg, rand(v) < 0.55 ? 'fracture' : 'entorse'));
  if (rand(v) < 0.25) added.push(addInjury(v, rand(v) < 0.5 ? 'bras_g' : 'bras_d', rand(v) < 0.6 ? 'entorse' : 'fracture'));
  if (rand(v) < 0.3) added.push(addInjury(v, pick(v, ['bras_g', 'bras_d', 'jambe_g', 'jambe_d', 'torse'] as const), 'coupure', rand(v) < 0.3));
  if (rand(v) < 0.2) {
    added.push(addInjury(v, 'tete', 'commotion'));
    if (rand(v) < 0.4) knockOut(v, VITALS.concussionUnconsciousSeconds);
  }
  return added;
}

// ——— Soins ———

export interface TreatmentOption {
  injury: number;
  treatment: Treatment;
  needs: Array<[ItemId, number]>;
  seconds: number;
}

export function treatmentNeeds(t: Treatment): Array<[ItemId, number]> {
  if (t === 'attelle') return [
    ['baton', 2],
    ['chiffon', 2],
  ];
  if (t === 'aloes') return [['aloes', 1]];
  return [['chiffon', 1]];
}

/** Soins possibles pour chaque blessure (sans vérifier le matériel disponible). */
export function treatmentOptions(v: Vitals): TreatmentOption[] {
  const out: TreatmentOption[] = [];
  for (const i of v.injuries) {
    if (i.kind === 'coupure') {
      if (!i.bandaged) out.push({ injury: i.id, treatment: 'bander', needs: treatmentNeeds('bander'), seconds: i.grave ? 6 : 4 });
      if (!i.disinfected) out.push({ injury: i.id, treatment: 'aloes', needs: treatmentNeeds('aloes'), seconds: 3 });
    } else if (i.kind === 'entorse' && !i.bandaged) {
      out.push({ injury: i.id, treatment: 'bander', needs: treatmentNeeds('bander'), seconds: 5 });
    } else if (i.kind === 'fracture' && !i.splinted) {
      out.push({ injury: i.id, treatment: 'attelle', needs: treatmentNeeds('attelle'), seconds: 8 });
    }
  }
  return out;
}

/** Peut-on se soigner soi-même ? Il faut au moins un bras valide. */
export function canTreatSelf(v: Vitals): boolean {
  return v.state === 'eveille' && v.injuries.filter((i) => isArm(i.zone) && i.kind === 'fracture' && !i.splinted).length < 2;
}

function rollInfection(v: Vitals, i: Injury, chance: number): void {
  if (i.infectAt >= 0 || i.infection > 0) return;
  if (rand(v) < chance) i.infectAt = i.age + 240 + rand(v) * 180;
}

/** Applique un soin terminé (le geste a duré le temps voulu). Pansement propre : `sterile`. */
export function applyTreatment(v: Vitals, injuryId: number, t: Treatment, sterile = false): boolean {
  const i = v.injuries.find((x) => x.id === injuryId);
  if (!i || v.state === 'mort') return false;
  if (t === 'bander') {
    if (i.bandaged || (i.kind !== 'coupure' && i.kind !== 'entorse')) return false;
    i.bandaged = true;
    // Chiffon de vêtement, pas stérile : la plaie peut s'infecter si elle n'est pas désinfectée.
    if (i.kind === 'coupure' && !sterile) rollInfection(v, i, i.disinfected ? 0.03 : i.grave ? 0.3 : 0.15);
    return true;
  }
  if (t === 'attelle') {
    if (i.kind !== 'fracture' || i.splinted) return false;
    i.splinted = true;
    return true;
  }
  if (i.kind !== 'coupure' || i.disinfected) return false;
  i.disinfected = true;
  if (i.infection <= 0) i.infectAt = -1;
  v.painRelief = VITALS.painReliefSeconds;
  return true;
}

/** Secours par un autre joueur : bande la plaie qui saigne le plus (avec un chiffon) et réveille. */
export function rescue(v: Vitals, withRag: boolean): { ok: boolean; usedRag: boolean } {
  if (v.state !== 'inconscient' && v.state !== 'critique') return { ok: false, usedRag: false };
  let usedRag = false;
  if (withRag) {
    const worst = v.injuries.filter((i) => bleedRate(i) > 0).sort((a, b) => bleedRate(b) - bleedRate(a))[0];
    if (worst) {
      applyTreatment(v, worst.id, 'bander');
      usedRag = true;
    }
  }
  v.state = 'eveille';
  v.timer = 0;
  v.shock = 0;
  v.health = Math.max(v.health, 15);
  return { ok: true, usedRag };
}

export function eat(v: Vitals, food: FoodEffect): boolean {
  if (v.state !== 'eveille' || v.digest.length >= VITALS.stomach) return false;
  v.digest.push({ rate: food.heal / food.seconds, left: food.seconds });
  return true;
}

// ——— Repos et sommeil ———

export function sitDown(v: Vitals): boolean {
  if (v.state !== 'eveille' || v.posture !== 'debout') return false;
  v.posture = 'assis';
  return true;
}

export function fallAsleep(v: Vitals, forced = false): boolean {
  if (v.state !== 'eveille' || v.posture === 'endormi') return false;
  if (!forced && v.fatigue < VITALS.sleepMinFatigue) return false;
  v.posture = 'endormi';
  v.sleepTime = 0;
  return true;
}

export function standUp(v: Vitals): void {
  if (v.posture === 'debout') return;
  v.posture = 'debout';
  v.sleepTime = 0;
}

// ——— Évolution à chaque pas ———

export interface Activity {
  /** Endurance dépensée pendant ce pas. */
  staminaSpent: number;
  moving: boolean;
  /** Charge portée (kg). */
  loadKg: number;
  /** Dans l'eau profonde (nage). */
  inWater: boolean;
  /** Souffle épuisé sous l'eau. */
  drowning: boolean;
  grounded: boolean;
}

export type VitalEvent =
  | { type: 'inconscient'; reason: 'blessures' | 'choc' | 'commotion' | 'noyade' }
  | { type: 'critique' }
  | { type: 'stabilise' }
  | { type: 'reveil' }
  | { type: 'mort'; cause: DeathCause }
  | { type: 'infection'; zone: Zone }
  | { type: 'fievre_finie'; zone: Zone }
  | { type: 'gueri'; kind: InjuryKind; zone: Zone }
  | { type: 'saignement_arrete'; zone: Zone }
  | { type: 'endormi'; forced: boolean }
  | { type: 'reveille' }
  | { type: 'repere' }
  | { type: 'micro_sommeil' };

export function tickVitals(v: Vitals, dt: number, a: Activity, out: VitalEvent[]): void {
  if (v.state === 'mort') return;
  const asleep = v.posture === 'endormi';
  const resting = v.posture === 'assis' || asleep || v.state !== 'eveille';
  const healMul = asleep ? 2 : resting ? 1.5 : 1;

  // Blessures : saignements, caillots, infections, guérison.
  for (let k = v.injuries.length - 1; k >= 0; k--) {
    const i = v.injuries[k]!;
    i.age += dt;
    if (i.kind === 'coupure' && !i.grave && !i.bandaged && !i.clotted && i.age >= VITALS.clotSeconds) {
      i.clotted = true;
      rollInfection(v, i, i.disinfected ? 0.03 : 0.25);
      out.push({ type: 'saignement_arrete', zone: i.zone });
    }
    if (i.infectAt >= 0 && i.infection <= 0 && i.age >= i.infectAt && !i.disinfected) {
      i.infection = 0.001;
      out.push({ type: 'infection', zone: i.zone });
    }
    if (i.infection > 0) {
      if (i.disinfected) {
        i.infection -= dt / 240;
        if (i.infection <= 0) {
          i.infection = 0;
          i.infectAt = -1;
          out.push({ type: 'fievre_finie', zone: i.zone });
        }
      } else i.infection = Math.min(1, i.infection + dt / 300);
    }
    let rate = 0;
    if (i.kind === 'contusion' || i.kind === 'commotion') rate = 1 / HEAL_SECONDS[i.kind];
    else if (i.kind === 'entorse') rate = 1 / (HEAL_SECONDS.entorse * (i.bandaged ? 0.5 : 1));
    else if (i.kind === 'fracture') rate = i.splinted ? 1 / HEAL_SECONDS.fracture : 0;
    else if (i.kind === 'coupure') rate = (i.bandaged || i.clotted) && i.infection <= 0 ? 1 / (i.grave ? 900 : HEAL_SECONDS.coupure) : 0;
    i.heal += rate * healMul * dt;
    if (i.heal >= 1 && i.infection <= 0) {
      v.injuries.splice(k, 1);
      out.push({ type: 'gueri', kind: i.kind, zone: i.zone });
    }
  }

  // Santé.
  const loss = ongoingLoss(v);
  let gain = 0;
  for (let k = v.digest.length - 1; k >= 0; k--) {
    const d = v.digest[k]!;
    const t = Math.min(dt, d.left);
    gain += d.rate * t;
    d.left -= dt;
    if (d.left <= 0) v.digest.splice(k, 1);
  }
  if (asleep) gain += VITALS.sleepHeal * dt;
  const drown = a.drowning ? VITALS.drownDamage * dt : 0;
  if (v.state === 'eveille') {
    v.health = Math.min(VITALS.max, v.health + gain - loss * dt - drown);
    if (drown > 0 && v.posture !== 'debout') standUp(v);
  } else {
    v.health = Math.max(0, Math.min(VITALS.max, v.health + gain - loss * dt));
  }
  if (v.health < 0) v.health = 0;

  // Énergie.
  const fever = feverOf(v);
  let dE = -a.staminaSpent * VITALS.energyPerStamina - 0.05 * fever * dt;
  if (a.moving) dE -= (VITALS.energyWalk + Math.max(0, a.loadKg - 10) * VITALS.energyLoadPerKg) * dt;
  if (asleep) dE += VITALS.energySleep * dt;
  else if (resting) dE += VITALS.energySit * dt;
  else if (!a.moving && a.staminaSpent <= 0) dE += VITALS.energyIdle * dt;
  v.energy = Math.max(0, Math.min(energyCap(v), v.energy + dE));

  // Fatigue (besoin de sommeil).
  if (asleep) {
    v.sleepTime += dt;
    const before = v.sleepTime - dt;
    if (before < VITALS.sleepRespawnSeconds && v.sleepTime >= VITALS.sleepRespawnSeconds) out.push({ type: 'repere' });
    v.fatigue = Math.max(0, v.fatigue - VITALS.fatigueSleep * dt);
    if (v.fatigue <= 0) {
      standUp(v);
      out.push({ type: 'reveille' });
    }
  } else {
    v.fatigue = Math.min(VITALS.max, v.fatigue + VITALS.fatigueAwake * dt + a.staminaSpent * VITALS.fatiguePerStamina);
  }
  if (v.state === 'eveille' && !asleep) {
    if (v.fatigue >= VITALS.max && a.grounded && !a.inWater) {
      fallAsleep(v, true);
      out.push({ type: 'endormi', forced: true });
    } else if (v.fatigue >= 90) {
      if (v.microSleep > 0) v.microSleep = Math.max(0, v.microSleep - dt);
      else {
        v.microTimer -= dt;
        if (v.microTimer <= 0) {
          v.microSleep = 1.2;
          v.microTimer = 20 + rand(v) * 20;
          out.push({ type: 'micro_sommeil' });
        }
      }
    } else v.microSleep = 0;
  }
  if (v.painRelief > 0) v.painRelief = Math.max(0, v.painRelief - dt);

  // Choc : bouger sur une jambe cassée sans attelle.
  const brokenLeg = v.injuries.some((i) => isLeg(i.zone) && i.kind === 'fracture' && !i.splinted);
  if (brokenLeg && a.moving && v.state === 'eveille') v.shock += VITALS.shockMoving * dt;
  else v.shock = Math.max(0, v.shock - VITALS.shockDecay * dt);
  if (v.shock >= 100 && v.state === 'eveille') {
    v.shock = 40;
    knockOut(v, VITALS.shockUnconsciousSeconds);
    out.push({ type: 'inconscient', reason: 'choc' });
  }

  // Conscience.
  if (v.state === 'eveille') {
    if (v.health <= 0) {
      v.posture = 'debout';
      v.sleepTime = 0;
      if (loss > 0) {
        v.state = 'critique';
        v.timer = VITALS.criticalSeconds;
        out.push({ type: 'critique' });
      } else {
        v.state = 'inconscient';
        v.timer = VITALS.unconsciousSeconds;
        out.push({ type: 'inconscient', reason: a.drowning ? 'noyade' : 'blessures' });
      }
    }
  } else if (v.state === 'inconscient') {
    if (v.health <= 0 && loss > 0) {
      v.state = 'critique';
      v.timer = VITALS.criticalSeconds;
      out.push({ type: 'critique' });
    } else {
      v.timer -= dt;
      if (v.timer <= 0) {
        v.state = 'eveille';
        v.timer = 0;
        v.health = Math.max(v.health, VITALS.wakeHealth);
        out.push({ type: 'reveil' });
      }
    }
  } else if (v.state === 'critique') {
    if (loss <= 0) {
      v.state = 'inconscient';
      v.timer = VITALS.stableSeconds;
      out.push({ type: 'stabilise' });
    } else {
      v.timer -= dt;
      if (v.timer <= 0) {
        die(v, totalBleeding(v) > 0 ? 'hemorragie' : 'infection');
        out.push({ type: 'mort', cause: v.cause! });
        return;
      }
    }
  }
  // Inconscient dans l'eau : noyade.
  if (v.state !== 'eveille' && a.inWater) {
    v.waterTime += dt;
    if (v.waterTime >= VITALS.drownUnconsciousSeconds) {
      die(v, 'noyade');
      out.push({ type: 'mort', cause: 'noyade' });
    }
  } else v.waterTime = 0;
}

// ——— Lecture sûre (sauvegardes) ———

const num = (x: unknown, lo: number, hi: number, d: number): number => (typeof x === 'number' && Number.isFinite(x) ? Math.max(lo, Math.min(hi, x)) : d);
const ZONE_SET = new Set<string>(ZONES);
const KIND_SET = new Set<string>(['contusion', 'entorse', 'fracture', 'coupure', 'commotion']);

export function readVitals(raw: unknown, seed: number): Vitals {
  const v = makeVitals(seed);
  if (typeof raw !== 'object' || raw === null) return v;
  const r = raw as Record<string, unknown>;
  v.health = num(r.health, 0, 100, v.health);
  v.energy = num(r.energy, 0, 100, v.energy);
  v.fatigue = num(r.fatigue, 0, 100, v.fatigue);
  v.rng = num(r.rng, 1, 0xffffffff, v.rng) >>> 0 || 1;
  v.painRelief = num(r.painRelief, 0, VITALS.painReliefSeconds, 0);
  // On reprend toujours éveillé et debout (un corps inconscient au chargement serait injouable).
  if (v.health <= 0) v.health = VITALS.wakeHealth;
  if (Array.isArray(r.digest)) {
    for (const d of r.digest.slice(0, VITALS.stomach)) {
      const o = d as Record<string, unknown>;
      v.digest.push({ rate: num(o?.rate, 0, 10, 0), left: num(o?.left, 0, 120, 0) });
    }
  }
  if (Array.isArray(r.injuries)) {
    for (const x of r.injuries.slice(0, 30)) {
      const o = (x ?? {}) as Record<string, unknown>;
      if (typeof o.zone !== 'string' || !ZONE_SET.has(o.zone) || typeof o.kind !== 'string' || !KIND_SET.has(o.kind)) continue;
      const inj = newInjury(v, o.zone as Zone, o.kind as InjuryKind, o.grave === true);
      inj.age = num(o.age, 0, 1e7, 0);
      inj.heal = num(o.heal, 0, 0.999, 0);
      inj.bandaged = o.bandaged === true;
      inj.splinted = o.splinted === true;
      inj.disinfected = o.disinfected === true;
      inj.clotted = o.clotted === true;
      inj.infection = num(o.infection, 0, 1, 0);
      inj.infectAt = num(o.infectAt, -1, 1e7, -1);
      v.injuries.push(inj);
    }
  }
  return v;
}
