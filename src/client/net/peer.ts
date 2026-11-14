// Liaison directe WebRTC entre un joueur et l'hôte (phase 8), chiffrée par le navigateur (DTLS).
// Deux canaux négociés d'avance : « fiable » (ordonné) et « rapide » (sans renvoi).
// La mise en relation passe par `Signaling`, avec des messages chiffrés par la clé du code du monde.

import type { Link } from '../../shared/link';
import { type WorldKeys, openMessage, sealMessage } from '../../shared/net-crypto';
import type { Signaling } from './signaling';

/** Serveur STUN public (gratuit) pour traverser les box. Un relais TURN peut être ajouté dans les réglages. */
export const DEFAULT_ICE: RTCIceServer[] = [{ urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] }];

/** Taille maximale d'un morceau envoyé sur un canal (au-delà, le message est découpé). */
const CHUNK = 16000;

type SignalBody =
  | { k: 'join'; from: string; t: number }
  | { k: 'offer'; from: string; to: string; sdp: string }
  | { k: 'answer'; from: string; to: string; sdp: string };

function randomId(): string {
  return Array.from(globalThis.crypto.getRandomValues(new Uint8Array(8)), (b) => b.toString(16).padStart(2, '0')).join('');
}

/** Attend la fin de la collecte des chemins réseau (offre complète en un seul message), au plus `ms`. */
function gathered(pc: RTCPeerConnection, ms = 3000): Promise<void> {
  if (pc.iceGatheringState === 'complete') return Promise.resolve();
  return new Promise((resolve) => {
    const t = setTimeout(resolve, ms);
    pc.addEventListener('icegatheringstatechange', () => {
      if (pc.iceGatheringState === 'complete') {
        clearTimeout(t);
        resolve();
      }
    });
  });
}

/** Liaison sur deux canaux WebRTC. */
export class PeerLink implements Link {
  onMessage: ((msg: unknown, fast: boolean) => void) | null = null;
  onClose: (() => void) | null = null;
  private isOpen = false;
  private readonly parts = new Map<string, string[]>();
  private nextPart = 1;

  constructor(
    private readonly pc: RTCPeerConnection,
    private readonly reliable: RTCDataChannel,
    private readonly fast: RTCDataChannel,
    readonly source: string,
    /** Morceaux au plus par message reçu (côté hôte : les messages d'un joueur sont petits). */
    private readonly maxParts = 4000,
  ) {
    const recv = (fastCh: boolean) => (e: MessageEvent) => {
      if (typeof e.data !== 'string' || e.data.length > CHUNK * 2) return;
      let msg: unknown;
      try {
        msg = JSON.parse(e.data);
      } catch {
        return;
      }
      // Morceau d'un gros message : { _p: id, i, n, d }.
      const m = msg as { _p?: string; i?: number; n?: number; d?: string };
      if (typeof m._p === 'string' && typeof m.i === 'number' && typeof m.n === 'number' && typeof m.d === 'string') {
        if (m.n > this.maxParts || m.i < 0 || m.i >= m.n) return;
        let list = this.parts.get(m._p);
        if (!list) {
          if (this.parts.size > 20) return;
          list = new Array<string>(m.n).fill('');
          this.parts.set(m._p, list);
        }
        list[m.i] = m.d;
        if (list.every((x) => x !== '')) {
          this.parts.delete(m._p);
          try {
            msg = JSON.parse(list.join(''));
          } catch {
            return;
          }
        } else return;
      }
      this.onMessage?.(msg, fastCh);
    };
    reliable.onmessage = recv(false);
    fast.onmessage = recv(true);
    const closed = () => this.closeInternal();
    reliable.onclose = closed;
    fast.onclose = closed;
    pc.addEventListener('connectionstatechange', () => {
      if (pc.connectionState === 'failed' || pc.connectionState === 'closed') closed();
    });
    this.isOpen = true;
  }

  get open(): boolean {
    return this.isOpen;
  }

  send(msg: unknown, fast = false): void {
    if (!this.isOpen) return;
    const ch = fast ? this.fast : this.reliable;
    if (ch.readyState !== 'open') return;
    const data = JSON.stringify(msg);
    if (data.length <= CHUNK) {
      // Canal rapide engorgé : on jette plutôt que d'accumuler du retard.
      if (fast && ch.bufferedAmount > 256 * 1024) return;
      ch.send(data);
      return;
    }
    if (fast) return;
    const id = String(this.nextPart++);
    const n = Math.ceil(data.length / CHUNK);
    for (let i = 0; i < n; i++) ch.send(JSON.stringify({ _p: id, i, n, d: data.slice(i * CHUNK, (i + 1) * CHUNK) }));
  }

  private closeInternal(): void {
    if (!this.isOpen) return;
    this.isOpen = false;
    try {
      this.reliable.close();
      this.fast.close();
      this.pc.close();
    } catch {
      // déjà fermé
    }
    this.onClose?.();
  }

  close(): void {
    this.closeInternal();
  }
}

function channels(pc: RTCPeerConnection): { reliable: RTCDataChannel; fast: RTCDataChannel } {
  return {
    reliable: pc.createDataChannel('fiable', { negotiated: true, id: 0, ordered: true }),
    fast: pc.createDataChannel('rapide', { negotiated: true, id: 1, ordered: false, maxRetransmits: 0 }),
  };
}

function whenOpen(pc: RTCPeerConnection, reliable: RTCDataChannel, fast: RTCDataChannel, ms: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('timeout')), ms);
    const check = () => {
      if (reliable.readyState === 'open' && fast.readyState === 'open') {
        clearTimeout(t);
        resolve();
      }
    };
    reliable.onopen = check;
    fast.onopen = check;
    pc.addEventListener('connectionstatechange', () => {
      if (pc.connectionState === 'failed') {
        clearTimeout(t);
        reject(new Error('failed'));
      }
    });
    check();
  });
}

/**
 * Côté hôte : écoute les demandes de connexion sur la mise en relation et ouvre une liaison WebRTC pour chacune.
 * Les demandes qu'on ne peut pas déchiffrer (autre code) sont ignorées. Renvoie une fonction pour arrêter.
 */
export function listenAsHost(keys: WorldKeys, sig: Signaling, onLink: (link: Link) => void, ice: RTCIceServer[] = DEFAULT_ICE): () => void {
  const me = randomId();
  const pending = new Map<string, RTCPeerConnection>();
  const recent: number[] = [];
  let stopped = false;
  sig.onMessage = (data) => {
    void (async () => {
      const body = (await openMessage(keys.seal, data)) as SignalBody | null;
      if (!body || stopped || body.from === me) return;
      if (body.k === 'join') {
        if (typeof body.from !== 'string' || body.from.length > 32 || pending.has(body.from)) return;
        // Pas plus de 20 nouvelles demandes par minute, ni 6 en cours à la fois.
        const now = Date.now();
        while (recent.length && now - recent[0]! > 60000) recent.shift();
        if (recent.length >= 20 || pending.size >= 6) return;
        recent.push(now);
        const pc = new RTCPeerConnection({ iceServers: ice });
        pending.set(body.from, pc);
        const { reliable, fast } = channels(pc);
        await pc.setLocalDescription(await pc.createOffer());
        await gathered(pc);
        sig.publish(await sealMessage(keys.seal, { k: 'offer', from: me, to: body.from, sdp: pc.localDescription!.sdp } satisfies SignalBody));
        try {
          await whenOpen(pc, reliable, fast, 25000);
          if (stopped) {
            pc.close();
            return;
          }
          onLink(new PeerLink(pc, reliable, fast, `rtc:${body.from}`, 16));
        } catch {
          pc.close();
        } finally {
          pending.delete(body.from);
        }
      } else if (body.k === 'answer' && body.to === me) {
        const pc = pending.get(body.from);
        if (pc && pc.signalingState === 'have-local-offer' && typeof body.sdp === 'string' && body.sdp.length < 20000) {
          await pc.setRemoteDescription({ type: 'answer', sdp: body.sdp }).catch(() => pc.close());
        }
      }
    })();
  };
  return () => {
    stopped = true;
    sig.onMessage = null;
    for (const pc of pending.values()) pc.close();
    pending.clear();
  };
}

/** Côté joueur : demande une connexion à l'hôte (répétée jusqu'à son offre), puis ouvre la liaison. */
export function joinHost(keys: WorldKeys, sig: Signaling, timeoutMs = 30000, ice: RTCIceServer[] = DEFAULT_ICE): Promise<Link> {
  const me = randomId();
  return new Promise<Link>((resolve, reject) => {
    let done = false;
    let pc: RTCPeerConnection | null = null;
    const finish = (err: Error | null, link?: Link) => {
      if (done) return;
      done = true;
      clearInterval(ask);
      clearTimeout(timer);
      sig.onMessage = null;
      if (err) {
        pc?.close();
        reject(err);
      } else resolve(link!);
    };
    const timer = setTimeout(() => finish(new Error('Aucun hôte n’a répondu : le monde n’est peut-être pas ouvert, ou le code est faux.')), timeoutMs);
    const sendJoin = async () => {
      if (!pc) sig.publish(await sealMessage(keys.seal, { k: 'join', from: me, t: Date.now() } satisfies SignalBody));
    };
    const ask = setInterval(() => void sendJoin(), 2500);
    sig.onMessage = (data) => {
      void (async () => {
        const body = (await openMessage(keys.seal, data)) as SignalBody | null;
        if (!body || done || body.k !== 'offer' || body.to !== me || pc || typeof body.sdp !== 'string' || body.sdp.length > 20000) return;
        pc = new RTCPeerConnection({ iceServers: ice });
        const { reliable, fast } = channels(pc);
        try {
          await pc.setRemoteDescription({ type: 'offer', sdp: body.sdp });
          await pc.setLocalDescription(await pc.createAnswer());
          await gathered(pc);
          sig.publish(await sealMessage(keys.seal, { k: 'answer', from: me, to: body.from, sdp: pc.localDescription!.sdp } satisfies SignalBody));
          await whenOpen(pc, reliable, fast, 25000);
          finish(null, new PeerLink(pc, reliable, fast, 'hote'));
        } catch {
          finish(new Error('La liaison directe avec l’hôte n’a pas pu s’établir (réseau trop fermé : un relais TURN serait nécessaire).'));
        }
      })();
    };
    void sig.ready.then(sendJoin);
  });
}
