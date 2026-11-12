// Code d'accès permanent d'un monde : 16 caractères (80 bits), groupés par 4.
// Alphabet sans caractères ambigus (pas de 0/O, 1/I).

const ALPHABET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
export const WORLD_CODE_LENGTH = 16;

function randomBytes(n: number): Uint8Array {
  const out = new Uint8Array(n);
  globalThis.crypto.getRandomValues(out);
  return out;
}

export function generateWorldCode(): string {
  const bytes = randomBytes(WORLD_CODE_LENGTH);
  let raw = '';
  for (let i = 0; i < WORLD_CODE_LENGTH; i++) raw += ALPHABET[bytes[i]! & 31];
  return formatWorldCode(raw);
}

/** Met en forme XXXX-XXXX-XXXX-XXXX. */
export function formatWorldCode(raw: string): string {
  return raw.match(/.{1,4}/g)?.join('-') ?? raw;
}

/** Normalise une saisie (majuscules, sans espaces ni tirets). Retourne null si invalide. */
export function normalizeWorldCode(input: string): string | null {
  if (typeof input !== 'string' || input.length > 64) return null;
  const s = input.toUpperCase().replace(/[\s-]/g, '');
  if (s.length !== WORLD_CODE_LENGTH) return null;
  for (const ch of s) if (!ALPHABET.includes(ch)) return null;
  return s;
}

/** Comparaison en temps constant de deux codes (déjà normalisés ou non). */
export function worldCodesEqual(a: string, b: string): boolean {
  const na = normalizeWorldCode(a);
  const nb = normalizeWorldCode(b);
  if (!na || !nb) return false;
  let diff = 0;
  for (let i = 0; i < WORLD_CODE_LENGTH; i++) diff |= na.charCodeAt(i) ^ nb.charCodeAt(i);
  return diff === 0;
}

export function randomSeed(): number {
  const b = randomBytes(4);
  return ((b[0]! << 24) | (b[1]! << 16) | (b[2]! << 8) | b[3]!) >>> 0;
}

export function randomHex(bytes: number): string {
  return Array.from(randomBytes(bytes), (b) => b.toString(16).padStart(2, '0')).join('');
}
