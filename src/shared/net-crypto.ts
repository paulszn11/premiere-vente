// Cryptographie du multijoueur (phase 8), avec l'API Web Crypto (navigateur et Node).
// - Le code du monde (80 bits) n'est jamais transmis : on en dérive un sujet de mise en relation,
//   une clé de chiffrement (AES-GCM) pour les messages qui y passent, et une clé d'authentification
//   (HMAC) pour prouver à l'ouverture de la liaison que chacun connaît le code.
// - Chaque joueur a un identifiant et une clé secrète créés dans son navigateur ; l'hôte ne garde que
//   le « vérificateur » (empreinte de la clé), et le joueur prouve qu'il le connaît (HMAC d'un défi).

import { normalizeWorldCode } from './worldcode';

const enc = new TextEncoder();
const dec = new TextDecoder();
const SALT = enc.encode('bienvenue-au-zimbabwe/phase8/v1');

export interface WorldKeys {
  /** Sujet public de mise en relation (empreinte du code, 32 caractères hexadécimaux). */
  topic: string;
  /** Chiffrement des messages de mise en relation. */
  seal: CryptoKey;
  /** Preuve de connaissance du code (défi-réponse). */
  auth: CryptoKey;
}

function subtle(): SubtleCrypto {
  return globalThis.crypto.subtle;
}

export function toHex(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

export function fromHex(hex: string): Uint8Array<ArrayBuffer> | null {
  if (typeof hex !== 'string' || hex.length % 2 !== 0 || !/^[0-9a-f]*$/i.test(hex)) return null;
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return out;
}

function toB64(bytes: Uint8Array): string {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
}

function fromB64(text: string): Uint8Array<ArrayBuffer> | null {
  try {
    const s = atob(text);
    const out = new Uint8Array(s.length);
    for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
    return out;
  } catch {
    return null;
  }
}

export function randomBytes(n: number): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(n);
  globalThis.crypto.getRandomValues(out);
  return out;
}

/** Comparaison en temps constant de deux chaînes. */
export function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/** Dérive les clés d'un monde à partir de son code (HKDF-SHA-256). Renvoie null si le code est invalide. */
export async function deriveWorldKeys(code: string): Promise<WorldKeys | null> {
  const norm = normalizeWorldCode(code);
  if (!norm) return null;
  const base = await subtle().importKey('raw', enc.encode(norm), 'HKDF', false, ['deriveBits', 'deriveKey']);
  const hkdf = (info: string) => ({ name: 'HKDF', hash: 'SHA-256', salt: SALT, info: enc.encode(info) });
  const topicBits = new Uint8Array(await subtle().deriveBits(hkdf('sujet'), base, 128));
  const seal = await subtle().deriveKey(hkdf('chiffrement'), base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
  const auth = await subtle().deriveKey(hkdf('authentification'), base, { name: 'HMAC', hash: 'SHA-256', length: 256 }, false, ['sign', 'verify']);
  return { topic: toHex(topicBits), seal, auth };
}

/** Chiffre un objet (JSON) : vecteur d'initialisation + texte chiffré, en base 64. */
export async function sealMessage(key: CryptoKey, value: unknown): Promise<string> {
  const iv = randomBytes(12);
  const data = enc.encode(JSON.stringify(value));
  const ct = new Uint8Array(await subtle().encrypt({ name: 'AES-GCM', iv }, key, data));
  const out = new Uint8Array(iv.length + ct.length);
  out.set(iv, 0);
  out.set(ct, iv.length);
  return toB64(out);
}

/** Déchiffre un message ; null s'il a été altéré ou chiffré avec une autre clé (autre code). */
export async function openMessage(key: CryptoKey, text: unknown): Promise<unknown> {
  if (typeof text !== 'string' || text.length > 200_000) return null;
  const raw = fromB64(text);
  if (!raw || raw.length < 13) return null;
  try {
    const pt = await subtle().decrypt({ name: 'AES-GCM', iv: raw.slice(0, 12) }, key, raw.slice(12));
    return JSON.parse(dec.decode(pt));
  } catch {
    return null;
  }
}

async function hmacHex(key: CryptoKey, text: string): Promise<string> {
  return toHex(new Uint8Array(await subtle().sign('HMAC', key, enc.encode(text))));
}

/** Défi aléatoire (hexadécimal). */
export function newChallenge(): string {
  return toHex(randomBytes(16));
}

/**
 * Preuve de connaissance du code pour ce rôle et ces deux défis. L'hôte et le joueur échangent leurs
 * défis, puis chacun envoie sa preuve : un intrus sans code ne peut pas la calculer, et une preuve
 * enregistrée ne sert à rien pour une autre liaison (défis différents).
 */
export function codeProof(keys: WorldKeys, role: 'hote' | 'joueur', hostChallenge: string, playerChallenge: string): Promise<string> {
  return hmacHex(keys.auth, `${role}|${hostChallenge}|${playerChallenge}`);
}

export async function checkCodeProof(keys: WorldKeys, role: 'hote' | 'joueur', hostChallenge: string, playerChallenge: string, proof: unknown): Promise<boolean> {
  if (typeof proof !== 'string' || proof.length !== 64) return false;
  return constantTimeEqual(await codeProof(keys, role, hostChallenge, playerChallenge), proof);
}

// ——— Identité des joueurs ———

export interface Identity {
  /** Identifiant public (UUID). */
  id: string;
  /** Clé secrète (64 caractères hexadécimaux) : elle ne quitte jamais le navigateur du joueur. */
  secret: string;
}

export function newIdentity(): Identity {
  return { id: globalThis.crypto.randomUUID(), secret: toHex(randomBytes(32)) };
}

/** Vérificateur gardé par l'hôte : empreinte SHA-256 de la clé secrète. */
export async function identityVerifier(secret: string): Promise<string> {
  return toHex(new Uint8Array(await subtle().digest('SHA-256', enc.encode(`joueur|${secret}`))));
}

async function verifierKey(verifier: string): Promise<CryptoKey> {
  return subtle().importKey('raw', enc.encode(verifier), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
}

/** Preuve d'identité pour le défi de l'hôte (le joueur la calcule depuis sa clé secrète). */
export async function identityProof(secret: string, hostChallenge: string): Promise<string> {
  return hmacHex(await verifierKey(await identityVerifier(secret)), `identite|${hostChallenge}`);
}

/** L'hôte vérifie la preuve avec le vérificateur qu'il a gardé. */
export async function checkIdentityProof(verifier: string, hostChallenge: string, proof: unknown): Promise<boolean> {
  if (typeof proof !== 'string' || proof.length !== 64) return false;
  return constantTimeEqual(await hmacHex(await verifierKey(verifier), `identite|${hostChallenge}`), proof);
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Clé de récupération à recopier sur un autre appareil : « BAZ1- » + identifiant + clé secrète. */
export function recoveryKey(idn: Identity): string {
  return `BAZ1-${idn.id.replace(/-/g, '')}${idn.secret}`.toUpperCase();
}

/** Relit une clé de récupération (tolère espaces, minuscules) ; null si elle est invalide. */
export function readRecoveryKey(text: string): Identity | null {
  if (typeof text !== 'string' || text.length > 200) return null;
  const t = text.replace(/\s+/g, '').toLowerCase();
  if (!t.startsWith('baz1-')) return null;
  const body = t.slice(5);
  if (body.length !== 32 + 64 || !/^[0-9a-f]+$/.test(body)) return null;
  const h = body.slice(0, 32);
  const id = `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
  if (!UUID_RE.test(id)) return null;
  return { id, secret: body.slice(32) };
}
