// Pas de déplacement du joueur : la même fonction tourne sur le serveur (référence)
// et sur le client (prédiction). À entrées identiques, le résultat est identique.

import { MOVE, PLAYER_CENTER_Y } from './constants';
import { PLAYER_GROUPS, type PhysicsWorld, type RAPIER } from './physics';

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
}

/** Commande envoyée par le client à chaque pas de simulation. */
export interface InputCmd {
  seq: number;
  /** Direction souhaitée dans le repère du monde (longueur ≤ 1). */
  wx: number;
  wz: number;
  /** Orientation du regard, utilisée pour l'affichage chez les autres joueurs. */
  yaw: number;
  pitch: number;
  buttons: number;
}

export const BTN_JUMP = 1;
export const BTN_SPRINT = 2;
export const BTN_CROUCH = 4;
export const BTN_INTERACT = 8;

export const MAX_PITCH = 1.55;
const Q_DIR = 1024;
const Q_ANGLE = 8192;
const TWO_PI = Math.PI * 2;

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
  return { x, y, z, vx: 0, vy: 0, vz: 0, grounded: false, jumpLatch: false };
}

export function copyState(dst: MoveState, src: MoveState): MoveState {
  dst.x = src.x;
  dst.y = src.y;
  dst.z = src.z;
  dst.vx = src.vx;
  dst.vy = src.vy;
  dst.vz = src.vz;
  dst.grounded = src.grounded;
  dst.jumpLatch = src.jumpLatch;
  return dst;
}

export function cloneState(s: MoveState): MoveState {
  return copyState(makeState(0, 0, 0), s);
}

/** Écart de position entre deux états, en mètres. */
export function positionError(a: MoveState, b: MoveState): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  const dz = a.z - b.z;
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

/** Fait avancer l'état du joueur d'un pas de simulation (modifie `s`). */
export function stepMovement(phys: PhysicsWorld, collider: RAPIER.Collider, s: MoveState, cmd: InputCmd, dt: number): void {
  // 1. Vitesse horizontale : accélération et inertie vers la vitesse souhaitée.
  let wx = cmd.wx;
  let wz = cmd.wz;
  const wl2 = wx * wx + wz * wz;
  if (wl2 > 1) {
    const l = Math.sqrt(wl2);
    wx /= l;
    wz /= l;
  }
  const hasInput = wl2 > 1e-8;
  const speed = (cmd.buttons & BTN_SPRINT) !== 0 ? MOVE.runSpeed : MOVE.walkSpeed;
  if (s.grounded || hasInput) {
    const accel = s.grounded ? (hasInput ? MOVE.groundAccel : MOVE.groundDecel) : MOVE.airAccel;
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

  // 2. Vitesse verticale : saut (un par appui), adhérence au sol, gravité.
  const jumpDown = (cmd.buttons & BTN_JUMP) !== 0;
  if (s.grounded && jumpDown && !s.jumpLatch) {
    s.vy = MOVE.jumpSpeed;
  } else if (s.grounded && s.vy <= 0) {
    s.vy = -MOVE.groundStick;
  } else {
    s.vy -= MOVE.gravity * dt;
    if (s.vy < -MOVE.terminalSpeed) s.vy = -MOVE.terminalSpeed;
  }
  s.jumpLatch = jumpDown;

  // 3. Déplacement contraint par le décor (contrôleur de personnage Rapier).
  const dx = s.vx * dt;
  const dy = s.vy * dt;
  const dz = s.vz * dt;
  collider.setTranslation({ x: s.x, y: s.y + PLAYER_CENTER_Y, z: s.z });
  phys.controller.computeColliderMovement(collider, { x: dx, y: dy, z: dz }, undefined, PLAYER_GROUPS);
  const m = phys.controller.computedMovement();
  const grounded = phys.controller.computedGrounded();
  s.x += m.x;
  s.y += m.y;
  s.z += m.z;
  collider.setTranslation({ x: s.x, y: s.y + PLAYER_CENTER_Y, z: s.z });

  // 4. La vitesse suit le déplacement réel : un mur ou une pente trop raide absorbe l'élan.
  if (dt > 0) {
    s.vx = m.x / dt;
    s.vz = m.z / dt;
  }
  if (grounded) {
    if (s.vy < 0) s.vy = 0;
  } else if (s.vy > 0 && m.y < dy * 0.5) {
    s.vy = 0; // tête contre un plafond
  }
  s.grounded = grounded;
}
