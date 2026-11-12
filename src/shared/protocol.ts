// Messages échangés entre le client et le serveur du monde, avec leur validation.
// Le serveur ne fait jamais confiance au client : tout message est vérifié avant usage.

import type { InputCmd, MoveState } from './movement';

export type RejectReason = 'bad_code' | 'full' | 'no_world' | 'rate_limited' | 'protocol' | 'replaced' | 'invalid';

export interface PlayerInfo {
  /** Identifiant public (jamais l'identifiant local secret du joueur). */
  id: string;
  name: string;
  color: number;
}

export interface NetPlayer {
  id: string;
  x: number;
  y: number;
  z: number;
  yaw: number;
  pitch: number;
}

export interface WelcomeWorld {
  id: string;
  name: string;
  seed: number;
}

export type ClientMessage =
  | { t: 'hello'; protocol: number; playerId: string; name: string; code: string }
  | { t: 'input'; cmds: InputCmd[] }
  | { t: 'ping'; id: number; ct: number }
  | { t: 'bye' };

export type ServerMessage =
  | {
      t: 'welcome';
      protocol: number;
      you: string;
      world: WelcomeWorld;
      tick: number;
      tickRate: number;
      snapshotInterval: number;
      state: MoveState;
      players: PlayerInfo[];
    }
  | { t: 'reject'; reason: RejectReason; retryAfterMs?: number; serverProtocol?: number }
  | { t: 'snap'; tick: number; ack: number; you: MoveState; players: NetPlayer[] }
  | { t: 'joined'; player: PlayerInfo }
  | { t: 'left'; id: string }
  | { t: 'pong'; id: number; ct: number; st: number }
  | { t: 'paused'; reason: 'host_stopped' | 'host_left' };

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

/** Nettoie un pseudonyme : supprime les caractères de contrôle, réduit les espaces. */
export function sanitizePlayerName(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  // eslint-disable-next-line no-control-regex
  const s = raw.replace(/[\u0000-\u001f\u007f-\u009f​-‏ -‮⁦-⁩]/g, '').replace(/\s+/g, ' ').trim();
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

/** Valide un message reçu d'un client. Retourne null s'il est mal formé. */
export function parseClientMessage(raw: unknown): ClientMessage | null {
  if (!isObj(raw) || typeof raw.t !== 'string') return null;
  switch (raw.t) {
    case 'hello': {
      if (!isInt(raw.protocol, 0, 1_000_000)) return null;
      if (!isPlayerId(raw.playerId)) return null;
      const name = sanitizePlayerName(raw.name);
      if (!name) return null;
      if (typeof raw.code !== 'string' || raw.code.length > 64) return null;
      return { t: 'hello', protocol: raw.protocol, playerId: raw.playerId.toLowerCase(), name, code: raw.code };
    }
    case 'input': {
      if (!Array.isArray(raw.cmds) || raw.cmds.length < 1 || raw.cmds.length > MAX_INPUTS_PER_MESSAGE) return null;
      const cmds: InputCmd[] = [];
      for (const c of raw.cmds) {
        const parsed = parseInput(c);
        if (!parsed) return null;
        cmds.push(parsed);
      }
      return { t: 'input', cmds };
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
