// Mise en relation (phase 8) : avant d'ouvrir la liaison directe WebRTC, l'hôte et le joueur échangent
// une offre et une réponse par un intermédiaire. Les messages sont chiffrés avec la clé dérivée du code du
// monde (l'intermédiaire ne voit rien d'exploitable) ; le sujet est une empreinte du code.
//
// - Courtiers MQTT publics et gratuits (WebSocket sécurisé), plusieurs à la fois : l'un peut tomber.
// - BroadcastChannel : plusieurs onglets du même navigateur (essais et tests automatiques).

export interface Signaling {
  /** Publie un message (déjà chiffré) sur le sujet du monde. */
  publish(data: string): void;
  onMessage: ((data: string) => void) | null;
  /** Au moins un intermédiaire est joignable. */
  readonly ready: Promise<void>;
  /** Intermédiaires joignables en ce moment. */
  readonly connected: number;
  close(): void;
}

/** Courtiers MQTT publics (gratuits, sans inscription) ; ils acceptent les connexions WebSocket sécurisées. */
export const PUBLIC_BROKERS = ['wss://broker.emqx.io:8084/mqtt', 'wss://broker.hivemq.com:8884/mqtt', 'wss://test.mosquitto.org:8081/mqtt'];

/** Plusieurs onglets du même navigateur. */
export class BroadcastSignaling implements Signaling {
  onMessage: ((data: string) => void) | null = null;
  readonly ready = Promise.resolve();
  readonly connected = 1;
  private readonly ch: BroadcastChannel;

  constructor(topic: string) {
    this.ch = new BroadcastChannel(`baz-mise-en-relation-${topic}`);
    this.ch.onmessage = (e: MessageEvent) => {
      if (typeof e.data === 'string') this.onMessage?.(e.data);
    };
  }

  publish(data: string): void {
    this.ch.postMessage(data);
  }

  close(): void {
    this.ch.close();
  }
}

// ——— MQTT 3.1.1 minimal (CONNECT, SUBSCRIBE, PUBLISH QoS 0, PINGREQ) ———

const te = new TextEncoder();
const td = new TextDecoder();

function varint(n: number): number[] {
  const out: number[] = [];
  do {
    let b = n % 128;
    n = Math.floor(n / 128);
    if (n > 0) b |= 0x80;
    out.push(b);
  } while (n > 0);
  return out;
}

function str(s: string): number[] {
  const b = te.encode(s);
  return [b.length >> 8, b.length & 255, ...b];
}

function packet(type: number, body: number[]): Uint8Array<ArrayBuffer> {
  return new Uint8Array([type, ...varint(body.length), ...body]);
}

export function mqttConnect(clientId: string, keepAlive = 45): Uint8Array<ArrayBuffer> {
  return packet(0x10, [...str('MQTT'), 4, 0x02, keepAlive >> 8, keepAlive & 255, ...str(clientId)]);
}

export function mqttSubscribe(packetId: number, topic: string): Uint8Array<ArrayBuffer> {
  return packet(0x82, [packetId >> 8, packetId & 255, ...str(topic), 0]);
}

export function mqttPublish(topic: string, payload: string): Uint8Array<ArrayBuffer> {
  return packet(0x30, [...str(topic), ...te.encode(payload)]);
}

export const MQTT_PING = new Uint8Array([0xc0, 0]);

/** Découpe un flux d'octets en paquets MQTT ; renvoie les paquets complets et le reste. */
export function mqttSplit(buf: Uint8Array): { packets: Array<{ type: number; body: Uint8Array }>; rest: Uint8Array<ArrayBuffer> } {
  const packets: Array<{ type: number; body: Uint8Array }> = [];
  let i = 0;
  while (i < buf.length) {
    let len = 0;
    let mul = 1;
    let j = i + 1;
    let ok = false;
    for (let k = 0; k < 4 && j < buf.length; k++, j++) {
      len += (buf[j]! & 127) * mul;
      mul *= 128;
      if ((buf[j]! & 128) === 0) {
        ok = true;
        j++;
        break;
      }
    }
    if (!ok || j + len > buf.length) break;
    packets.push({ type: buf[i]!, body: buf.slice(j, j + len) });
    i = j + len;
  }
  return { packets, rest: new Uint8Array(buf.slice(i)) };
}

/** Sujet et contenu d'un PUBLISH (QoS 0 ou 1). */
export function mqttReadPublish(type: number, body: Uint8Array): { topic: string; payload: string } | null {
  if (body.length < 2) return null;
  const tl = (body[0]! << 8) | body[1]!;
  if (2 + tl > body.length) return null;
  const topic = td.decode(body.slice(2, 2 + tl));
  const qos = (type >> 1) & 3;
  const start = 2 + tl + (qos > 0 ? 2 : 0);
  return { topic, payload: td.decode(body.slice(start)) };
}

/** Un courtier MQTT (WebSocket), reconnecté automatiquement. */
class MqttBroker {
  private ws: WebSocket | null = null;
  private buf: Uint8Array<ArrayBuffer> = new Uint8Array(0);
  private ping: ReturnType<typeof setInterval> | null = null;
  private retry: ReturnType<typeof setTimeout> | null = null;
  private closed = false;
  up = false;
  private delay = 2000;

  constructor(
    private readonly url: string,
    private readonly topic: string,
    private readonly onPayload: (p: string) => void,
    private readonly onState: () => void,
  ) {
    this.open();
  }

  private open(): void {
    if (this.closed) return;
    let ws: WebSocket;
    try {
      ws = new WebSocket(this.url, ['mqtt']);
    } catch {
      this.schedule();
      return;
    }
    this.ws = ws;
    ws.binaryType = 'arraybuffer';
    ws.onopen = () => {
      const id = `baz-${Math.random().toString(36).slice(2, 12)}`;
      ws.send(mqttConnect(id));
      ws.send(mqttSubscribe(1, this.topic));
      this.ping = setInterval(() => {
        if (ws.readyState === WebSocket.OPEN) ws.send(MQTT_PING);
      }, 30000);
    };
    ws.onmessage = (e: MessageEvent) => {
      const chunk = new Uint8Array(e.data as ArrayBuffer);
      const merged = new Uint8Array(this.buf.length + chunk.length);
      merged.set(this.buf, 0);
      merged.set(chunk, this.buf.length);
      const { packets, rest } = mqttSplit(merged);
      this.buf = rest;
      for (const p of packets) {
        const kind = p.type >> 4;
        if (kind === 9) {
          // Abonnement accepté : le courtier est prêt.
          this.up = true;
          this.delay = 2000;
          this.onState();
        } else if (kind === 3) {
          const m = mqttReadPublish(p.type, p.body);
          if (m && m.topic === this.topic) this.onPayload(m.payload);
        }
      }
    };
    ws.onclose = () => this.down();
    ws.onerror = () => this.down();
  }

  private down(): void {
    if (this.ping) clearInterval(this.ping);
    this.ping = null;
    const was = this.up;
    this.up = false;
    this.ws = null;
    if (was) this.onState();
    this.schedule();
  }

  private schedule(): void {
    if (this.closed || this.retry) return;
    this.retry = setTimeout(() => {
      this.retry = null;
      this.open();
    }, this.delay);
    this.delay = Math.min(30000, this.delay * 2);
  }

  send(payload: string): void {
    if (this.up && this.ws?.readyState === WebSocket.OPEN) this.ws.send(mqttPublish(this.topic, payload));
  }

  close(): void {
    this.closed = true;
    if (this.retry) clearTimeout(this.retry);
    if (this.ping) clearInterval(this.ping);
    try {
      this.ws?.close();
    } catch {
      // déjà fermé
    }
  }
}

/** Plusieurs courtiers MQTT à la fois ; un message reçu par plusieurs d'entre eux n'est traité qu'une fois. */
export class MqttSignaling implements Signaling {
  onMessage: ((data: string) => void) | null = null;
  readonly ready: Promise<void>;
  private readonly brokers: MqttBroker[];
  private readonly seen: string[] = [];
  private resolveReady: (() => void) | null = null;

  constructor(topic: string, urls: string[] = PUBLIC_BROKERS) {
    this.ready = new Promise((r) => (this.resolveReady = r));
    const full = `bienvenue-au-zimbabwe/v1/${topic}`;
    this.brokers = urls.map(
      (u) =>
        new MqttBroker(
          u,
          full,
          (p) => this.receive(p),
          () => {
            if (this.connected > 0) this.resolveReady?.();
          },
        ),
    );
  }

  get connected(): number {
    return this.brokers.filter((b) => b.up).length;
  }

  private receive(p: string): void {
    // Chaque message chiffré est unique (vecteur d'initialisation aléatoire) : on l'utilise pour dédoublonner.
    const key = p.slice(0, 24);
    if (this.seen.includes(key)) return;
    this.seen.push(key);
    if (this.seen.length > 200) this.seen.shift();
    this.onMessage?.(p);
  }

  publish(data: string): void {
    for (const b of this.brokers) b.send(data);
  }

  close(): void {
    for (const b of this.brokers) b.close();
  }
}
