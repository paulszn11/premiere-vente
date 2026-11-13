// Déplacement du joueur : la même fonction tourne sur le serveur (référence) et sur le
// client (prédiction). À entrées identiques, le résultat est identique.
//
// Trois modes : marche (sols, accroupi, saut, chutes, équilibre), nage (flottaison,
// plongée, souffle, courants) et escalade (parois raides, passage du rebord).

import {
  CLIMB,
  EYE_HEIGHT,
  FALL,
  MOVE,
  PLAYER_CENTER_Y,
  PLAYER_CROUCH_HALF_HEIGHT,
  PLAYER_HALF_HEIGHT,
  PLAYER_RADIUS,
  STAMINA,
  SWIM,
  WATER_LEVEL,
} from './constants';
import { SURFACE_EFFECTS, type SurfaceEffect, type SurfaceId, surfaceOf } from './geography';
import { PLAYER_GROUPS, type PhysicsWorld, QUERY_TERRAIN, RAPIER } from './physics';

export const MODE_WALK = 0;
export const MODE_SWIM = 1;
export const MODE_CLIMB = 2;

/** Au-delà de cette masse portée, le portage se fait à deux mains (voir props.ts). */
export const ONE_HAND_CARRY_KG = 8;

export interface MoveState {
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  grounded: boolean;
  /** Vrai tant que la touche de saut reste enfoncée (un saut par appui). */
  jumpLatch: boolean;
  /** Boutons du pas précédent (pour détecter les appuis). */
  prevButtons: number;
  crouched: boolean;
  mode: number;
  /** Endurance de 0 à 100. */
  stamina: number;
  /** Épuisé : plus de course ni de nage rapide jusqu'à récupération partielle. */
  exhausted: boolean;
  regenDelay: number;
  /** Souffle de 0 à 100 (sous l'eau). */
  breath: number;
  /** Déséquilibre accumulé (0 à 1) : à 1, le joueur trébuche. */
  balance: number;
  /** Temps restant de trébuchement (contrôle réduit). */
  stumble: number;
  /** Point le plus haut depuis que le joueur a quitté le sol. */
  airPeakY: number;
  /** Normale de la paroi pendant l'escalade. */
  climbNx: number;
  climbNy: number;
  climbNz: number;
  /** Temps restant du passage du rebord en haut d'une paroi. */
  mantle: number;
  /** Masse de l'objet porté (0 si mains libres) et objet traîné, fournis par la simulation. */
  carryMass: number;
  dragging: boolean;
  surface: SurfaceId;
  /** Vitesse d'impact effective de l'atterrissage de ce pas (0 sinon) et gravité (0 à 4). */
  impact: number;
  impactSeverity: number;
  impactHeight: number;
  /** Vrai pendant les pas où le souffle est épuisé sous l'eau. */
  drowning: boolean;
  /** Limites venant du corps (blessures, énergie, fatigue) et de la charge, fixées par la simulation. */
  staminaMax: number;
  /** Vitesse maximale au sol (m/s ; 99 : aucune limite). */
  speedCap: number;
  speedMul: number;
  regenMul: number;
  /** Coût en endurance des efforts. */
  drainMul: number;
  /** Actions impossibles (R_NO_SPRINT…). */
  restrict: number;
  /** Charge portée sur soi (kg). */
  loadKg: number;
  /** Endurance dépensée pendant le dernier pas (pour l'énergie et la fatigue). */
  spent: number;
}

/** Commande envoyée par le client à chaque pas de simulation. */
export interface InputCmd {
  seq: number;
  /** Direction souhaitée dans le repère du monde (longueur ≤ 1). */
  wx: number;
  wz: number;
  /** Orientation du regard (cap et inclinaison, en radians). */
  yaw: number;
  pitch: number;
  buttons: number;
}

export const BTN_JUMP = 1;
export const BTN_SPRINT = 2;
export const BTN_CROUCH = 4;
export const BTN_INTERACT = 8;
export const BTN_THROW = 16;

/** Actions rendues impossibles par le corps ou la charge. */
export const R_NO_SPRINT = 1;
export const R_NO_JUMP = 2;
export const R_NO_CLIMB = 4;
export const R_NO_HEAVY = 8;
export const R_NO_THROW = 16;

export const MAX_PITCH = 1.55;
const Q_DIR = 1024;
const Q_ANGLE = 8192;
const TWO_PI = Math.PI * 2;
const DEG = Math.PI / 180;

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

export function wrapAngle(a: number): number {
  return a - TWO_PI * Math.floor((a + Math.PI) / TWO_PI);
}

/**
 * Arrondit une commande sur une grille fixe. Le client l'applique avant de l'utiliser
 * pour sa prédiction, et le serveur fait de même à la réception : les deux simulent
 * donc exactement les mêmes valeurs.
 */
export function quantizeInput(cmd: InputCmd): InputCmd {
  let wx = clamp(Number.isFinite(cmd.wx) ? cmd.wx : 0, -1, 1);
  let wz = clamp(Number.isFinite(cmd.wz) ? cmd.wz : 0, -1, 1);
  const len2 = wx * wx + wz * wz;
  if (len2 > 1) {
    const l = Math.sqrt(len2);
    wx /= l;
    wz /= l;
  }
  wx = Math.trunc(wx * Q_DIR) / Q_DIR;
  wz = Math.trunc(wz * Q_DIR) / Q_DIR;
  const yaw = Math.round(wrapAngle(Number.isFinite(cmd.yaw) ? cmd.yaw : 0) * Q_ANGLE) / Q_ANGLE;
  const pitch = Math.round(clamp(Number.isFinite(cmd.pitch) ? cmd.pitch : 0, -MAX_PITCH, MAX_PITCH) * Q_ANGLE) / Q_ANGLE;
  return { seq: cmd.seq, wx, wz, yaw, pitch, buttons: cmd.buttons & 0xff };
}

export function makeState(x: number, y: number, z: number): MoveState {
  return {
    x,
    y,
    z,
    vx: 0,
    vy: 0,
    vz: 0,
    grounded: false,
    jumpLatch: false,
    prevButtons: 0,
    crouched: false,
    mode: MODE_WALK,
    stamina: STAMINA.max,
    exhausted: false,
    regenDelay: 0,
    breath: 100,
    balance: 0,
    stumble: 0,
    airPeakY: y,
    climbNx: 0,
    climbNy: 0,
    climbNz: 0,
    mantle: 0,
    carryMass: 0,
    dragging: false,
    surface: 'herbe',
    impact: 0,
    impactSeverity: 0,
    impactHeight: 0,
    drowning: false,
    staminaMax: STAMINA.max,
    speedCap: 99,
    speedMul: 1,
    regenMul: 1,
    drainMul: 1,
    restrict: 0,
    loadKg: 0,
    spent: 0,
  };
}

export function copyState(dst: MoveState, src: MoveState): MoveState {
  return Object.assign(dst, src);
}

export function cloneState(s: MoveState): MoveState {
  return { ...s };
}

/** Écart de position entre deux états, en mètres. */
export function positionError(a: MoveState, b: MoveState): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  const dz = a.z - b.z;
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

/** Hauteur des yeux au-dessus des pieds selon la posture. */
export function eyeHeightOf(s: Pick<MoveState, 'crouched'>, eyeStanding = EYE_HEIGHT, eyeCrouched = 1.0): number {
  return s.crouched ? eyeCrouched : eyeStanding;
}

function centerY(s: MoveState): number {
  return (s.crouched ? PLAYER_CROUCH_HALF_HEIGHT : PLAYER_HALF_HEIGHT) + PLAYER_RADIUS;
}

// ——— Endurance ———

/** Dépense d'endurance hors déplacement (pousser un chariot, pagayer). */
export function drainStamina(s: MoveState, amount: number): void {
  drain(s, amount);
}

/** Récupération d'endurance quand le déplacement n'est pas calculé (conduite). */
export function regenStamina(s: MoveState, dt: number): void {
  regen(s, dt);
}

function drain(s: MoveState, amount: number): void {
  const a = Math.min(s.stamina, amount * s.drainMul);
  s.stamina -= a;
  s.spent += a;
  s.regenDelay = STAMINA.regenDelay;
  if (s.stamina <= 0) s.exhausted = true;
}

function regen(s: MoveState, dt: number, rate = 1): void {
  if (s.regenDelay > 0) s.regenDelay = Math.max(0, s.regenDelay - dt);
  else s.stamina = Math.min(s.staminaMax, s.stamina + STAMINA.regen * rate * s.regenMul * dt);
  if (s.stamina > s.staminaMax) s.stamina = s.staminaMax;
  if (s.exhausted && s.stamina >= Math.min(STAMINA.recoverAt, s.staminaMax * 0.8)) s.exhausted = false;
}

// ——— Outils physiques ———

interface MoveResult {
  my: number;
  mxz: number;
  grounded: boolean;
}

function moveCollider(phys: PhysicsWorld, collider: RAPIER.Collider, s: MoveState, dx: number, dy: number, dz: number, maxClimbDeg: number, snap: boolean): MoveResult {
  const c = phys.controller;
  c.setMaxSlopeClimbAngle(maxClimbDeg * DEG);
  c.setMinSlopeSlideAngle(Math.min(89, maxClimbDeg + 5) * DEG);
  if (snap) c.enableSnapToGround(MOVE.snapToGround);
  else c.disableSnapToGround();
  collider.setTranslation({ x: s.x, y: s.y + centerY(s), z: s.z });
  c.computeColliderMovement(collider, { x: dx, y: dy, z: dz }, undefined, PLAYER_GROUPS);
  const m = c.computedMovement();
  const grounded = c.computedGrounded();
  s.x += m.x;
  s.y += m.y;
  s.z += m.z;
  collider.setTranslation({ x: s.x, y: s.y + centerY(s), z: s.z });
  return { my: m.y, mxz: Math.sqrt(m.x * m.x + m.z * m.z), grounded };
}

function setCrouch(phys: PhysicsWorld, collider: RAPIER.Collider, s: MoveState, want: boolean): void {
  if (want && !s.crouched) {
    s.crouched = true;
    collider.setHalfHeight(PLAYER_CROUCH_HALF_HEIGHT);
  } else if (!want && s.crouched) {
    // On ne se relève que s'il y a la place au-dessus de la tête.
    const shape = new RAPIER.Capsule(PLAYER_HALF_HEIGHT, PLAYER_RADIUS * 0.9);
    const blocked = phys.world.intersectionWithShape({ x: s.x, y: s.y + PLAYER_CENTER_Y + 0.05, z: s.z }, { x: 0, y: 0, z: 0, w: 1 }, shape, undefined, PLAYER_GROUPS, collider);
    if (!blocked) {
      s.crouched = false;
      collider.setHalfHeight(PLAYER_HALF_HEIGHT);
    }
  }
}

interface Wall {
  nx: number;
  ny: number;
  nz: number;
  distance: number;
}

/** Normale verticale maximale d'une paroi escaladable, selon la roche (sans zone morte avec la marche). */
const CLIMBABLE_NY_GRANITE = 0.755; // à partir de 41° (on ne marche plus au-delà de 42° sur le granite)

/** Cherche une paroi escaladable devant le joueur (à hauteur de poitrine, de taille, puis de genou). */
function probeWall(phys: PhysicsWorld, s: MoveState, dirX: number, dirZ: number): Wall | null {
  for (const h of [1.2, 0.7, 0.35]) {
    const ox = s.x;
    const oy = s.y + h;
    const oz = s.z;
    const ray = new RAPIER.Ray({ x: ox, y: oy, z: oz }, { x: dirX, y: 0, z: dirZ });
    const hit = phys.world.castRayAndGetNormal(ray, PLAYER_RADIUS + CLIMB.reach, true, undefined, QUERY_TERRAIN);
    if (!hit) continue;
    const n = hit.normal;
    if (n.x * dirX + n.z * dirZ > -0.3) continue;
    // Rochers isolés et granite : escaladables dès 41° ; roche : dès 44°.
    let maxNy: number = CLIMB.maxNormalY;
    if (hit.collider.shapeType() !== RAPIER.ShapeType.HeightField) maxNy = CLIMBABLE_NY_GRANITE;
    else if (n.y > CLIMB.maxNormalY) {
      const px = ox + dirX * hit.timeOfImpact;
      const pz = oz + dirZ * hit.timeOfImpact;
      if (surfaceOf(phys.terrain.sampleInto(px, pz), n.y) === 'granite') maxNy = CLIMBABLE_NY_GRANITE;
    }
    if (n.y > maxNy) continue;
    return { nx: n.x, ny: n.y, nz: n.z, distance: hit.timeOfImpact };
  }
  return null;
}

function slopeAt(phys: PhysicsWorld, x: number, z: number): { gx: number; gz: number; ny: number } {
  const t = phys.terrain;
  const e = 0.75;
  const gx = (t.heightAt(x + e, z) - t.heightAt(x - e, z)) / (2 * e);
  const gz = (t.heightAt(x, z + e) - t.heightAt(x, z - e)) / (2 * e);
  return { gx, gz, ny: 1 / Math.sqrt(1 + gx * gx + gz * gz) };
}

/** Impulsion maximale qu'un joueur peut donner à un objet en un pas (force d'un humain). */
const PUSH_MAX_IMPULSE = 6;

/** Pousse les objets déplaçables heurtés pendant le dernier déplacement. */
function pushBodies(phys: PhysicsWorld, vx: number, vz: number): void {
  const sp = Math.sqrt(vx * vx + vz * vz);
  if (sp < 0.1) return;
  const c = phys.controller;
  const n = c.numComputedCollisions();
  if (n === 0) return;
  const dirx = vx / sp;
  const dirz = vz / sp;
  const done: number[] = [];
  for (let i = 0; i < n; i++) {
    const body = c.computedCollision(i)?.collider?.parent();
    if (!body || !body.isDynamic() || done.includes(body.handle)) continue;
    done.push(body.handle);
    const v = body.linvel();
    const dv = sp - (v.x * dirx + v.z * dirz);
    if (dv <= 0) continue;
    const j = Math.min(body.mass() * dv * 0.5, PUSH_MAX_IMPULSE);
    body.applyImpulse({ x: dirx * j, y: 0, z: dirz * j }, true);
  }
}

/** Gravité d'une chute selon la vitesse d'impact, le sol et la posture. */
export function fallSeverity(impactSpeed: number, eff: SurfaceEffect, crouching: boolean): { effective: number; severity: number } {
  const effective = impactSpeed * eff.impact * (crouching ? 0.85 : 1);
  let severity = 0;
  if (effective >= FALL.lethal) severity = 4;
  else if (effective >= FALL.heavy) severity = 3;
  else if (effective >= FALL.light) severity = 2;
  else if (effective >= FALL.stumble) severity = 1;
  return { effective, severity };
}

const STUMBLE_TIME = [0, 0.35, 0.8, 1.5, 2.5];

function land(s: MoveState, vyBefore: number, eff: SurfaceEffect, crouching: boolean): void {
  const speed = -vyBefore;
  if (speed <= 0) return;
  const r = fallSeverity(speed, eff, crouching);
  s.impact = r.effective;
  s.impactSeverity = r.severity;
  s.impactHeight = Math.max(0, s.airPeakY - s.y);
  if (r.severity > 0) s.stumble = Math.max(s.stumble, STUMBLE_TIME[r.severity]!);
}

// ——— Modes ———

function walkStep(phys: PhysicsWorld, collider: RAPIER.Collider, s: MoveState, cmd: InputCmd, dt: number, pressed: number): void {
  const buttons = cmd.buttons;
  setCrouch(phys, collider, s, (buttons & BTN_CROUCH) !== 0);
  const slope = slopeAt(phys, s.x, s.z);
  const waterDepth = WATER_LEVEL - s.y;
  const surface: SurfaceId = waterDepth > SWIM.wadeStart ? 'eau' : surfaceOf(phys.terrain.sampleInto(s.x, s.z), slope.ny);
  s.surface = surface;
  const eff = SURFACE_EFFECTS[surface];

  let wx = cmd.wx;
  let wz = cmd.wz;
  const wl2 = wx * wx + wz * wz;
  if (wl2 > 1) {
    const l = Math.sqrt(wl2);
    wx /= l;
    wz /= l;
  }
  const hasInput = wl2 > 1e-8;
  const heavy = s.carryMass > ONE_HAND_CARRY_KG;
  const sprinting = (buttons & BTN_SPRINT) !== 0 && hasInput && !s.crouched && !s.exhausted && s.stamina > 0 && !heavy && !s.dragging && s.stumble <= 0 && (s.restrict & R_NO_SPRINT) === 0;

  // Escalade : saut face à une paroi raide.
  if ((pressed & BTN_JUMP) !== 0 && !heavy && !s.dragging && s.stamina >= CLIMB.minStamina && (s.restrict & R_NO_CLIMB) === 0) {
    const wall = probeWall(phys, s, Math.sin(cmd.yaw), Math.cos(cmd.yaw));
    if (wall) {
      setCrouch(phys, collider, s, false);
      if (!s.crouched) {
        s.mode = MODE_CLIMB;
        s.climbNx = wall.nx;
        s.climbNy = wall.ny;
        s.climbNz = wall.nz;
        s.vx = 0;
        s.vy = 0;
        s.vz = 0;
        s.grounded = false;
        return;
      }
    }
  }

  // Vitesse horizontale : accélération, inertie, sol, charge, eau, trébuchement.
  let speed: number = sprinting ? MOVE.runSpeed : MOVE.walkSpeed;
  if (s.crouched) speed = MOVE.crouchSpeed;
  speed = Math.min(speed, s.speedCap) * s.speedMul;
  if (heavy) speed = Math.min(speed, MOVE.heavyCarrySpeed);
  if (s.dragging) speed = Math.min(speed, MOVE.dragSpeed);
  if (s.grounded) speed *= eff.speed;
  if (waterDepth > SWIM.wadeStart) speed *= 1 - 0.55 * clamp((waterDepth - SWIM.wadeStart) / (SWIM.startDepth - SWIM.wadeStart), 0, 1);
  if (s.stumble > 0) speed *= 0.4;
  if (s.grounded || hasInput) {
    let accel = s.grounded ? (hasInput ? MOVE.groundAccel : MOVE.groundDecel) * eff.grip : MOVE.airAccel;
    if (s.stumble > 0) accel *= 0.3;
    const dvx = wx * speed - s.vx;
    const dvz = wz * speed - s.vz;
    const dl = Math.sqrt(dvx * dvx + dvz * dvz);
    const maxDv = accel * dt;
    if (dl <= maxDv) {
      s.vx += dvx;
      s.vz += dvz;
    } else {
      s.vx += (dvx / dl) * maxDv;
      s.vz += (dvz / dl) * maxDv;
    }
  }

  // Vitesse verticale : saut (un par appui, coûte de l'endurance), gravité.
  const canJump = s.grounded && (pressed & BTN_JUMP) !== 0 && !s.crouched && !heavy && !s.dragging && s.stamina >= STAMINA.jumpCost && s.stumble <= 0 && (s.restrict & R_NO_JUMP) === 0;
  if (canJump) {
    s.vy = MOVE.jumpSpeed;
    drain(s, STAMINA.jumpCost);
  } else if (s.grounded && s.vy <= 0) {
    s.vy = -MOVE.groundStick;
  } else {
    s.vy -= MOVE.gravity * dt;
    if (s.vy < -MOVE.terminalSpeed) s.vy = -MOVE.terminalSpeed;
  }

  const vyBefore = s.vy;
  const wasGrounded = s.grounded;
  const dx = s.vx * dt;
  const dy = s.vy * dt;
  const dz = s.vz * dt;
  const res = moveCollider(phys, collider, s, dx, dy, dz, eff.maxClimbDeg, true);
  pushBodies(phys, s.vx, s.vz);

  // Un obstacle (mur, tronc, pente trop raide) absorbe l'élan.
  const desiredH = Math.sqrt(dx * dx + dz * dz);
  if (dt > 0 && desiredH > 1e-6 && res.mxz < desiredH * 0.6) {
    const k = res.mxz / desiredH;
    s.vx *= k;
    s.vz *= k;
  }
  if (res.grounded) {
    if (s.vy < 0) s.vy = 0;
  } else if (s.vy > 0 && res.my < dy * 0.5) {
    s.vy = 0;
  }
  s.grounded = res.grounded;

  if (!wasGrounded && s.grounded) land(s, vyBefore, eff, (buttons & BTN_CROUCH) !== 0);
  if (s.grounded) s.airPeakY = s.y;
  else if (s.y > s.airPeakY) s.airPeakY = s.y;

  // Équilibre : demi-tours brusques en courant, descentes raides, sols glissants.
  let rate = -0.5;
  if (sprinting && s.grounded) {
    rate = -0.2;
    const sp2 = s.vx * s.vx + s.vz * s.vz;
    if (sp2 > 12.25 && hasInput) {
      // Changement de direction brutal à plus de 3,5 m/s.
      const cos = (s.vx * wx + s.vz * wz) / (Math.sqrt(sp2) * Math.sqrt(wx * wx + wz * wz));
      if (cos < -0.3) rate += 5 * -cos;
    }
    if (slope.ny < 0.88 && s.vx * slope.gx + s.vz * slope.gz < 0) rate += 0.7;
    if (eff.grip < 0.9) rate += 0.25;
  }
  s.balance = clamp(s.balance + rate * dt, 0, 1);
  if (s.balance >= 1) {
    s.stumble = Math.max(s.stumble, 0.9);
    s.balance = 0;
  }

  // Endurance et souffle.
  const moving = s.vx * s.vx + s.vz * s.vz > 0.09;
  if (sprinting && moving) drain(s, STAMINA.sprintDrain * dt);
  else if (heavy && moving) drain(s, STAMINA.heavyCarryDrain * dt);
  else if (s.dragging && moving) drain(s, STAMINA.heavyCarryDrain * 2 * dt);
  else regen(s, dt);
  s.breath = Math.min(100, s.breath + SWIM.breathRegen * dt);
}

function swimStep(phys: PhysicsWorld, collider: RAPIER.Collider, s: MoveState, cmd: InputCmd, dt: number): void {
  const buttons = cmd.buttons;
  setCrouch(phys, collider, s, false);
  s.surface = 'eau';
  let wx = cmd.wx;
  let wz = cmd.wz;
  const wl2 = wx * wx + wz * wz;
  if (wl2 > 1) {
    const l = Math.sqrt(wl2);
    wx /= l;
    wz /= l;
  }
  const wl = Math.sqrt(wx * wx + wz * wz);
  const heavy = s.carryMass > ONE_HAND_CARRY_KG;
  const fast = (buttons & BTN_SPRINT) !== 0 && wl > 0.1 && !s.exhausted && s.stamina > 0 && !heavy && (s.restrict & R_NO_SPRINT) === 0;
  let speed: number = fast ? SWIM.fastSpeed : s.exhausted ? SWIM.exhaustedSpeed : SWIM.speed;
  if (heavy) speed *= 0.5;
  speed *= s.speedMul;

  // Plongée : nager en regardant vers le bas (ou le haut), ou boutons monter / descendre.
  let vyWish = 0;
  let horiz = 1;
  if (wl > 0.1 && Math.abs(cmd.pitch) > 0.25) {
    vyWish = -Math.sin(cmd.pitch) * wl * speed;
    horiz = Math.cos(cmd.pitch);
  }
  if ((buttons & BTN_JUMP) !== 0) vyWish += SWIM.verticalSpeed;
  if ((buttons & BTN_CROUCH) !== 0) vyWish -= SWIM.verticalSpeed;
  const floatY = WATER_LEVEL - SWIM.floatDepth;
  let tvy: number;
  if (vyWish !== 0) tvy = vyWish;
  else if (s.y > floatY - 0.6) tvy = clamp((floatY - s.y) * 2, -1, 1);
  else tvy = heavy ? -0.6 : 0.25;
  if (s.y > floatY && tvy > 0) tvy = (floatY - s.y) * 2;
  // Un sac lourd fait couler : il vaut mieux le poser avant de nager.
  if (s.loadKg > 20 && (buttons & BTN_JUMP) === 0) tvy -= Math.min(0.5, (s.loadKg - 20) * 0.03);

  const current = phys.terrain.currentAt(s.x, s.z);
  const tvx = wx * speed * horiz + current.x;
  const tvz = wz * speed * horiz + current.z;
  const dvx = tvx - s.vx;
  const dvy = tvy - s.vy;
  const dvz = tvz - s.vz;
  const dl = Math.sqrt(dvx * dvx + dvy * dvy + dvz * dvz);
  const maxDv = SWIM.accel * dt;
  if (dl <= maxDv) {
    s.vx = tvx;
    s.vy = tvy;
    s.vz = tvz;
  } else {
    s.vx += (dvx / dl) * maxDv;
    s.vy += (dvy / dl) * maxDv;
    s.vz += (dvz / dl) * maxDv;
  }
  moveCollider(phys, collider, s, s.vx * dt, s.vy * dt, s.vz * dt, 45, false);
  s.grounded = false;
  s.airPeakY = s.y;
  s.stumble = 0;
  s.balance = 0;

  // Souffle : 30 s la tête sous l'eau.
  if (s.y + EYE_HEIGHT < WATER_LEVEL - 0.05) {
    s.breath -= (100 / SWIM.breathSeconds) * dt;
    if (s.breath <= 0) {
      s.breath = 0;
      s.drowning = true;
    }
  } else {
    s.breath = Math.min(100, s.breath + SWIM.breathRegen * dt);
  }
  if (wl > 0.1) drain(s, (fast ? STAMINA.fastSwimDrain : STAMINA.swimDrain) * dt);
  else regen(s, dt, 0.35);
}

function exitClimb(s: MoveState): void {
  s.mode = MODE_WALK;
  s.vx = 0;
  s.vy = 0;
  s.vz = 0;
  s.mantle = 0;
  s.airPeakY = s.y;
}

function climbStep(phys: PhysicsWorld, collider: RAPIER.Collider, s: MoveState, cmd: InputCmd, dt: number, pressed: number): void {
  s.surface = 'roche';
  const nx = s.climbNx;
  const ny = s.climbNy;
  const nz = s.climbNz;
  const hl = Math.sqrt(nx * nx + nz * nz) || 1;

  // Passage du rebord en cours.
  if (s.mantle > 0) {
    const t = Math.min(dt, s.mantle);
    s.mantle -= dt;
    const up = CLIMB.mantleHeight / 0.45;
    const fw = 0.8 / 0.45;
    moveCollider(phys, collider, s, (-nx / hl) * fw * t, up * t, (-nz / hl) * fw * t, 60, false);
    if (s.mantle <= 0) exitClimb(s);
    return;
  }
  if ((pressed & BTN_CROUCH) !== 0 || (s.restrict & R_NO_CLIMB) !== 0) {
    exitClimb(s);
    return;
  }
  if ((pressed & BTN_JUMP) !== 0) {
    exitClimb(s);
    s.vx = (nx / hl) * 2.5;
    s.vz = (nz / hl) * 2.5;
    s.vy = 2.5;
    drain(s, STAMINA.jumpCost);
    return;
  }

  const sin = Math.sin(cmd.yaw);
  const cos = Math.cos(cmd.yaw);
  const mx = cos * cmd.wx - sin * cmd.wz;
  const my = sin * cmd.wx + cos * cmd.wz;
  const moving = mx * mx + my * my > 0.01;
  drain(s, (STAMINA.climbDrain + (moving ? STAMINA.climbMoveDrain : 0)) * dt);
  if (s.stamina <= 0) {
    exitClimb(s);
    return;
  }

  // Repère de la paroi : « haut » le long de la paroi et « droite » horizontale.
  let ux = -nx * ny;
  let uy = 1 - ny * ny;
  let uz = -nz * ny;
  const ul = Math.sqrt(ux * ux + uy * uy + uz * uz) || 1;
  ux /= ul;
  uy /= ul;
  uz /= ul;
  const rx = -nz / hl;
  const rz = nx / hl;
  const v = CLIMB.speed;
  // Déplacement le long de la paroi + légère poussée perpendiculaire pour rester au contact
  // (perpendiculaire : elle ne fait ni monter ni descendre, même sur une paroi inclinée).
  const stick = 0.03;
  moveCollider(phys, collider, s, (ux * my + rx * mx) * v * dt - nx * stick, uy * my * v * dt - ny * stick, (uz * my + rz * mx) * v * dt - nz * stick, 89, false);
  s.vx = 0;
  s.vy = 0;
  s.vz = 0;
  s.grounded = false;

  const wall = probeWall(phys, s, -nx / hl, -nz / hl);
  if (wall) {
    s.climbNx = wall.nx;
    s.climbNy = wall.ny;
    s.climbNz = wall.nz;
    return;
  }
  // Plus de paroi raide devant : on passe le rebord si on montait, sinon on lâche.
  if (my > 0.1) s.mantle = 0.45;
  else exitClimb(s);
}

/** Fait avancer l'état du joueur d'un pas de simulation (modifie `s`). */
export function stepMovement(phys: PhysicsWorld, collider: RAPIER.Collider, s: MoveState, cmd: InputCmd, dt: number): void {
  const pressed = cmd.buttons & ~s.prevButtons;
  s.impact = 0;
  s.impactSeverity = 0;
  s.drowning = false;
  s.spent = 0;
  if (s.stumble > 0) s.stumble = Math.max(0, s.stumble - dt);

  const waterDepth = WATER_LEVEL - s.y;
  if (s.mode !== MODE_SWIM && waterDepth > SWIM.startDepth) {
    // Entrée dans l'eau profonde (éventuellement après une chute : l'eau amortit).
    if (s.mode === MODE_WALK && !s.grounded && s.vy < 0) land(s, s.vy, SURFACE_EFFECTS.eau, false);
    s.mode = MODE_SWIM;
    s.mantle = 0;
  } else if (s.mode === MODE_SWIM && waterDepth < SWIM.stopDepth) {
    s.mode = MODE_WALK;
    s.vy = Math.min(s.vy, 0);
  }

  if (s.mode === MODE_CLIMB) climbStep(phys, collider, s, cmd, dt, pressed);
  else if (s.mode === MODE_SWIM) swimStep(phys, collider, s, cmd, dt);
  else walkStep(phys, collider, s, cmd, dt, pressed);

  s.prevButtons = cmd.buttons;
  s.jumpLatch = (cmd.buttons & BTN_JUMP) !== 0;
}
