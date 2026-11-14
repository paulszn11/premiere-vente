// Messages échangés entre le client et le serveur du monde, avec leur validation.
// Le serveur ne fait jamais confiance au client : tout message est vérifié avant usage.

import { type PlayerAction, readAction } from './actions';
import type { InputCmd } from './movement';
import type { Perm, Role, WorldRules } from './permissions';

export type RejectReason = 'bad_code' | 'full' | 'no_world' | 'rate_limited' | 'protocol' | 'replaced' | 'invalid' | 'identity' | 'kicked';

export const REJECT_LABELS: Record<RejectReason, string> = {
  bad_code: 'Code du monde incorrect.',
  full: 'Ce monde est complet (10 joueurs au maximum).',
  no_world: 'Aucun monde ouvert avec ce code.',
  rate_limited: 'Trop de tentatives : réessayez dans une minute.',
  protocol: 'Version du jeu différente de celle de l’hôte : rechargez la page.',
  replaced: 'Vous vous êtes connecté ailleurs.',
  invalid: 'Échange invalide.',
  identity: 'Identité refusée : ce joueur existe déjà avec une autre clé (utilisez votre clé de récupération).',
  kicked: 'L’hôte vous a retiré de la partie.',
};

/** Ancienne forme (phase 1), gardée pour la prédiction de test. */
export interface NetPlayer {
  id: string;
  x: number;
  y: number;
  z: number;
  yaw: number;
  pitch: number;
}

export interface RosterEntry {
  id: string;
  name: string;
  role: Role;
  online: boolean;
}

/** Messages du joueur vers l'hôte. */
export type ClientMessage =
  /** Réponse au défi de l'hôte : son propre défi et la preuve qu'il connaît le code. */
  | { t: 'hello'; protocol: number; id: string; name: string; pc: string; proof: string }
  /** Preuve d'identité (joueur connu) ou vérificateur (première venue). */
  | { t: 'ident'; proof?: string; verifier?: string }
  | { t: 'in'; c: InputCmd[] }
  | { t: 'act'; n: number; a: PlayerAction }
  | { t: 'ping'; id: number; ct: number }
  | { t: 'bye' };

/** Messages de contrôle de l'hôte vers le joueur (la réplication du monde est dans replication.ts). */
export type ControlMessage =
  | { t: 'defi'; hc: string; protocol: number }
  | { t: 'hote'; proof: string; known: boolean }
  | {
      t: 'welcome';
      you: { id: string; name: string; role: Role };
      world: { name: string; seed: number };
      start: { x: number; y: number; z: number; yaw: number };
      perms: Record<Perm, boolean>;
      rules: WorldRules;
    }
  | { t: 'reject'; reason: RejectReason; retryAfterMs?: number }
  | { t: 'res'; n: number; ok: boolean; m?: string }
  | { t: 'pong'; id: number; ct: number }
  | { t: 'roster'; players: RosterEntry[] }
  | { t: 'perms'; role: Role; perms: Record<Perm, boolean>; rules: WorldRules }
  | { t: 'stop'; reason: 'host_left' | 'kicked' | 'host_stopped' };

export const MAX_INPUTS_PER_MESSAGE = 32;
export const PLAYER_NAME_MAX = 20;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isObj(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function isInt(v: unknown, min: number, max: number): v is number {
  return typeof v === 'number' && Number.isInteger(v) && v >= min && v <= max;
}

function isNum(v: unknown, limit: number): v is number {
  return typeof v === 'number' && Number.isFinite(v) && Math.abs(v) <= limit;
}

/** Caractères de contrôle et caractères invisibles ou de direction de texte, retirés des pseudonymes. */
const INVISIBLE_CHARS = new RegExp(
  `[${[
    [0x00, 0x1f],
    [0x7f, 0x9f],
    [0x200b, 0x200f],
    [0x2028, 0x202e],
    [0x2066, 0x2069],
  ]
    .map(([a, b]) => `${String.fromCharCode(a!)}-${String.fromCharCode(b!)}`)
    .join('')}]`,
  'g',
);

/** Nettoie un pseudonyme : supprime les caractères de contrôle, réduit les espaces. */
export function sanitizePlayerName(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const s = raw.replace(INVISIBLE_CHARS, '').replace(/\s+/g, ' ').trim();
  const chars = Array.from(s);
  if (chars.length < 1 || chars.length > PLAYER_NAME_MAX) return null;
  return s;
}

export function isPlayerId(v: unknown): v is string {
  return typeof v === 'string' && UUID_RE.test(v);
}

function parseInput(v: unknown): InputCmd | null {
  if (!isObj(v)) return null;
  if (!isInt(v.seq, 1, 2 ** 31 - 1)) return null;
  if (!isNum(v.wx, 1.01) || !isNum(v.wz, 1.01)) return null;
  if (!isNum(v.yaw, 1000) || !isNum(v.pitch, 10)) return null;
  if (!isInt(v.buttons, 0, 255)) return null;
  return { seq: v.seq, wx: v.wx, wz: v.wz, yaw: v.yaw, pitch: v.pitch, buttons: v.buttons };
}

const HEX64 = /^[0-9a-f]{64}$/;
const HEX32 = /^[0-9a-f]{32}$/;

/** Valide un message reçu d'un joueur. Retourne null s'il est mal formé. */
export function parseClientMessage(raw: unknown): ClientMessage | null {
  if (!isObj(raw) || typeof raw.t !== 'string') return null;
  switch (raw.t) {
    case 'hello': {
      if (!isInt(raw.protocol, 0, 1_000_000)) return null;
      if (!isPlayerId(raw.id)) return null;
      const name = sanitizePlayerName(raw.name);
      if (!name) return null;
      if (typeof raw.pc !== 'string' || !HEX32.test(raw.pc) || typeof raw.proof !== 'string' || !HEX64.test(raw.proof)) return null;
      return { t: 'hello', protocol: raw.protocol, id: raw.id.toLowerCase(), name, pc: raw.pc, proof: raw.proof };
    }
    case 'ident': {
      const out: { t: 'ident'; proof?: string; verifier?: string } = { t: 'ident' };
      if (raw.proof !== undefined) {
        if (typeof raw.proof !== 'string' || !HEX64.test(raw.proof)) return null;
        out.proof = raw.proof;
      }
      if (raw.verifier !== undefined) {
        if (typeof raw.verifier !== 'string' || !HEX64.test(raw.verifier)) return null;
        out.verifier = raw.verifier;
      }
      return out.proof || out.verifier ? out : null;
    }
    case 'in': {
      if (!Array.isArray(raw.c) || raw.c.length < 1 || raw.c.length > MAX_INPUTS_PER_MESSAGE) return null;
      const c: InputCmd[] = [];
      for (const x of raw.c) {
        const parsed = parseInput(x);
        if (!parsed) return null;
        c.push(parsed);
      }
      return { t: 'in', c };
    }
    case 'act': {
      if (!isInt(raw.n, 0, 2 ** 31 - 1)) return null;
      const a = readAction(raw.a);
      return a ? { t: 'act', n: raw.n, a } : null;
    }
    case 'ping':
      if (!isInt(raw.id, 0, 2 ** 31 - 1) || !isNum(raw.ct, 1e15)) return null;
      return { t: 'ping', id: raw.id, ct: raw.ct };
    case 'bye':
      return { t: 'bye' };
    default:
      return null;
  }
}
