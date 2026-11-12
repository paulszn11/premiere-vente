// Hachage et générateurs pseudo-aléatoires déterministes.
// Uniquement des opérations entières (Math.imul, décalages) : résultats identiques
// sur tous les moteurs JavaScript, ce qui est indispensable pour que le client et
// le serveur génèrent exactement le même monde à partir de la même graine.

function mix32(h: number): number {
  h = Math.imul(h ^ (h >>> 16), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return (h ^ (h >>> 16)) >>> 0;
}

/** Hache jusqu'à quatre entiers 32 bits en un entier non signé 32 bits. */
export function hash32(a: number, b = 0, c = 0, d = 0): number {
  let h = mix32((a | 0) + 0x9e3779b9);
  h = mix32(h ^ ((b | 0) + 0x7f4a7c15));
  h = mix32(h ^ ((c | 0) + 0x632be5ab));
  h = mix32(h ^ ((d | 0) + 0x2545f491));
  return h;
}

/** Hache vers un nombre dans [0, 1). */
export function hashFloat(a: number, b = 0, c = 0, d = 0): number {
  return hash32(a, b, c, d) / 4294967296;
}

/** Générateur mulberry32 : suite déterministe de nombres dans [0, 1). */
export function mulberry32(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
