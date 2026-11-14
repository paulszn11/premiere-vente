// Liaison entre un joueur distant et l'hôte (phase 8), indépendante du transport :
// WebRTC dans le navigateur, liaison en mémoire pour les tests.
// Deux canaux : « fiable » (ordonné, sans perte) et « rapide » (sans renvoi : une position périmée ne sert à rien).

export interface Link {
  /** Envoie un message (objet sérialisable en JSON). `fast` : canal rapide. */
  send(msg: unknown, fast?: boolean): void;
  onMessage: ((msg: unknown, fast: boolean) => void) | null;
  onClose: (() => void) | null;
  close(): void;
  /** Identifiant de la source (limitation des tentatives). */
  readonly source: string;
  readonly open: boolean;
}

/** Deux liaisons reliées en mémoire (tests) ; les messages passent par JSON, de façon asynchrone. */
export function memoryLinkPair(sourceA = 'a', sourceB = 'b'): [Link, Link] {
  class Mem implements Link {
    onMessage: ((msg: unknown, fast: boolean) => void) | null = null;
    onClose: (() => void) | null = null;
    peer: Mem | null = null;
    open = true;
    constructor(readonly source: string) {}
    send(msg: unknown, fast = false): void {
      if (!this.open) return;
      const data = JSON.stringify(msg);
      const peer = this.peer;
      queueMicrotask(() => {
        if (peer?.open) peer.onMessage?.(JSON.parse(data), fast);
      });
    }
    close(): void {
      if (!this.open) return;
      this.open = false;
      this.onClose?.();
      const peer = this.peer;
      if (peer?.open) queueMicrotask(() => peer.close());
    }
  }
  const a = new Mem(sourceA);
  const b = new Mem(sourceB);
  a.peer = b;
  b.peer = a;
  return [a, b];
}
