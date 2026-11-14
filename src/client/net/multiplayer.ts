// Multijoueur dans le navigateur (phase 8) : identité du joueur, ouverture du monde par l'hôte (serveur,
// mise en relation, sauvegardes de sécurité), connexion d'un joueur distant.

import { HostServer } from '../../server/host';
import { SaveStore, type WorldMeta, type WorldSave } from '../../server/save';
import { AUTOSAVE_INTERVAL_MS, SAVE_FORMAT_VERSION } from '../../shared/constants';
import type { Link } from '../../shared/link';
import { type Identity, type WorldKeys, deriveWorldKeys, newIdentity } from '../../shared/net-crypto';
import { DEFAULT_RULES, type Member, type WorldRules, readMembers, readRules } from '../../shared/permissions';
import type { LocalSimulation } from '../../shared/simulation';
import { generateWorldCode } from '../../shared/worldcode';
import { IdbBackend } from './idb';
import { DEFAULT_ICE, joinHost, listenAsHost } from './peer';
import { RemoteClient, type Welcome } from './remote-client';
import { BroadcastSignaling, MqttSignaling, PUBLIC_BROKERS, type Signaling } from './signaling';

const IDENTITY_KEY = 'baz.identite';

/** Identité du joueur (créée une fois dans ce navigateur). */
export function loadIdentity(): Identity {
  try {
    const raw = JSON.parse(localStorage.getItem(IDENTITY_KEY) ?? 'null') as Identity | null;
    if (raw && typeof raw.id === 'string' && /^[0-9a-f-]{36}$/.test(raw.id) && typeof raw.secret === 'string' && /^[0-9a-f]{64}$/.test(raw.secret)) return raw;
  } catch {
    // illisible : on en crée une nouvelle
  }
  const idn = newIdentity();
  saveIdentity(idn);
  return idn;
}

export function saveIdentity(idn: Identity): void {
  try {
    localStorage.setItem(IDENTITY_KEY, JSON.stringify(idn));
  } catch {
    // stockage indisponible
  }
}

/** Ce que l'hôte garde de son monde partagé, en plus de la partie : code, nom, joueurs connus, règles. */
export interface HostMeta {
  code: string;
  name: string;
  worldId: string;
  members: Member[];
  rules: WorldRules;
}

const hostKey = (seed: number) => `baz.hote.${seed}`;

export function loadHostMeta(seed: number): HostMeta | null {
  try {
    const raw = JSON.parse(localStorage.getItem(hostKey(seed)) ?? 'null') as Record<string, unknown> | null;
    if (!raw || typeof raw.code !== 'string' || typeof raw.worldId !== 'string') return null;
    return { code: raw.code, name: typeof raw.name === 'string' ? raw.name : 'Mon monde', worldId: raw.worldId, members: readMembers(raw.members), rules: readRules(raw.rules) };
  } catch {
    return null;
  }
}

export function saveHostMeta(seed: number, meta: HostMeta): void {
  try {
    localStorage.setItem(hostKey(seed), JSON.stringify(meta));
  } catch {
    // stockage indisponible
  }
}

/** Courtiers de mise en relation : publics par défaut (un réglage de test peut les remplacer). */
function brokers(): string[] {
  try {
    const raw = JSON.parse(localStorage.getItem('baz.courtiers') ?? 'null') as unknown;
    if (Array.isArray(raw) && raw.every((u) => typeof u === 'string')) return raw as string[];
  } catch {
    // réglage illisible
  }
  return PUBLIC_BROKERS;
}

/** Serveurs ICE : STUN public, plus un relais TURN s'il a été configuré. */
function iceServers(): RTCIceServer[] {
  try {
    const raw = JSON.parse(localStorage.getItem('baz.turn') ?? 'null') as { urls?: string; username?: string; credential?: string } | null;
    if (raw && typeof raw.urls === 'string') return [...DEFAULT_ICE, { urls: raw.urls, ...(raw.username ? { username: raw.username, credential: raw.credential ?? '' } : {}) }];
  } catch {
    // réglage illisible
  }
  return DEFAULT_ICE;
}

/** Mise en relation : courtiers MQTT et onglets du même navigateur, en même temps. */
class MultiSignaling implements Signaling {
  onMessage: ((data: string) => void) | null = null;
  readonly ready: Promise<void>;
  constructor(private readonly list: Signaling[]) {
    for (const s of list) s.onMessage = (d) => this.onMessage?.(d);
    this.ready = Promise.race(list.map((s) => s.ready));
  }
  get connected(): number {
    return this.list.reduce((n, s) => n + s.connected, 0);
  }
  publish(data: string): void {
    for (const s of this.list) s.publish(data);
  }
  close(): void {
    for (const s of this.list) s.close();
  }
}

function openSignaling(topic: string): Signaling {
  const list: Signaling[] = [new BroadcastSignaling(topic)];
  const urls = brokers();
  if (urls.length) list.push(new MqttSignaling(topic, urls));
  return new MultiSignaling(list);
}

/** Monde ouvert par l'hôte : serveur, mise en relation, sauvegardes de sécurité. */
export class HostSession {
  readonly server: HostServer;
  private readonly stopListen: () => void;
  private readonly store = new SaveStore(new IdbBackend());
  private saveTimer: ReturnType<typeof setInterval> | null = null;
  private saving = false;
  lastBackupAt = 0;
  backupError: string | null = null;

  private constructor(
    readonly meta: HostMeta,
    private readonly seed: number,
    private readonly sim: LocalSimulation,
    private readonly signaling: Signaling,
    keys: WorldKeys,
    private readonly view: () => { yaw: number; pitch: number },
    log: (text: string) => void,
  ) {
    const members = new Map(meta.members.map((m) => [m.id, m]));
    this.server = new HostServer({
      sim,
      keys,
      world: { name: meta.name, seed },
      members,
      rules: meta.rules,
      onChange: () => {
        this.meta.members = [...members.values()];
        saveHostMeta(this.seed, this.meta);
      },
      log,
    });
    this.stopListen = listenAsHost(keys, signaling, (link: Link) => this.server.attach(link), iceServers());
    this.saveTimer = setInterval(() => void this.backup(), AUTOSAVE_INTERVAL_MS);
  }

  /** Ouvre le monde de cette partie aux autres joueurs (crée son code la première fois). */
  static async open(sim: LocalSimulation, seed: number, hostIdentity: Identity, hostName: string, view: () => { yaw: number; pitch: number }, log: (text: string) => void): Promise<HostSession> {
    let meta = loadHostMeta(seed);
    if (!meta) meta = { code: generateWorldCode(), name: `Monde de ${hostName || 'l’hôte'}`, worldId: globalThis.crypto.randomUUID(), members: [], rules: { ...DEFAULT_RULES } };
    // L'hôte figure parmi les joueurs connus, avec le rôle « hôte ».
    meta.members = meta.members.filter((m) => m.id !== hostIdentity.id && m.role !== 'hote');
    meta.members.unshift({ id: sim.local.id, name: hostName, role: 'hote', overrides: {}, verifier: '0'.repeat(64), lastSeen: Date.now() });
    saveHostMeta(seed, meta);
    const keys = (await deriveWorldKeys(meta.code))!;
    return new HostSession(meta, seed, sim, openSignaling(keys.topic), keys, view, log);
  }

  /** Intermédiaires de mise en relation joignables. */
  get relays(): number {
    return this.signaling.connected;
  }

  /** Sauvegarde de sécurité (IndexedDB, la dernière + 3), avec empreinte SHA-256. */
  async backup(): Promise<void> {
    if (this.saving) return;
    this.saving = true;
    try {
      const now = Date.now();
      let wm: WorldMeta | null = await this.store.getWorld(this.meta.worldId);
      if (!wm) wm = { id: this.meta.worldId, name: this.meta.name, code: this.meta.code, seed: this.seed, createdAt: now, lastPlayedAt: now, latestGen: 0 };
      const save: WorldSave = { format: SAVE_FORMAT_VERSION, worldId: this.meta.worldId, tick: this.sim.tick, savedAt: now, players: {}, sim: this.sim.serialize(), view: this.view(), host: { members: this.meta.members, rules: this.meta.rules } };
      await this.store.writeSave(wm, save);
      this.lastBackupAt = now;
      this.backupError = null;
    } catch (e) {
      this.backupError = e instanceof Error ? e.message : String(e);
    } finally {
      this.saving = false;
    }
  }

  listBackups(): ReturnType<SaveStore['listSaves']> {
    return this.store.listSaves(this.meta.worldId);
  }

  /** Données d'une sauvegarde de sécurité (vérifiée) pour la restaurer. */
  async backupData(gen: number): Promise<WorldSave | null> {
    const now = Date.now();
    await this.store.restore(this.meta.worldId, gen, now);
    return (await this.store.loadLatest(this.meta.worldId))?.save ?? null;
  }

  /** L'hôte ferme son monde : les joueurs sont prévenus, une sauvegarde de sécurité est faite. */
  async close(): Promise<void> {
    if (this.saveTimer) clearInterval(this.saveTimer);
    this.saveTimer = null;
    this.server.close();
    this.stopListen();
    this.signaling.close();
    await this.backup();
  }
}

/** Rejoint le monde d'un hôte : mise en relation, liaison directe, poignée de main. */
export async function joinWorld(code: string, name: string, identity: Identity, onStatus: (text: string) => void): Promise<{ client: RemoteClient; welcome: Welcome; close: () => void }> {
  const keys = await deriveWorldKeys(code);
  if (!keys) throw new Error('Ce code n’est pas valide (16 caractères, par exemple ABCD-EFGH-JKLM-NPQR).');
  const sig = openSignaling(keys.topic);
  try {
    onStatus('Recherche de l’hôte…');
    const link = await joinHost(keys, sig, 30000, iceServers());
    sig.close();
    onStatus('Connexion à l’hôte…');
    const client = new RemoteClient(link, identity, name, keys);
    const welcome = await client.connect();
    return { client, welcome, close: () => client.leave() };
  } catch (e) {
    sig.close();
    throw e;
  }
}
