// Serveur du monde partagé, dans le navigateur de l'hôte (phase 8). Il fait foi : il accueille les joueurs
// (preuve du code, puis preuve d'identité), applique leurs commandes et leurs actions à la simulation commune
// (après contrôle des droits), envoie à chacun ce qu'il doit voir, et applique les règles de déconnexion.
// Indépendant du transport : il reçoit des liaisons (WebRTC dans le navigateur, mémoire dans les tests).

import { MAX_PLAYERS, PROTOCOL_VERSION } from '../shared/constants';
import type { Link } from '../shared/link';
import type { InputCmd } from '../shared/movement';
import { type WorldKeys, checkCodeProof, checkIdentityProof, codeProof, newChallenge } from '../shared/net-crypto';
import { type Member, PERMS, type Perm, type Role, type WorldRules, hasPerm, permitUse } from '../shared/permissions';
import { type ClientMessage, type ControlMessage, type RejectReason, type RosterEntry, parseClientMessage } from '../shared/protocol';
import { AttemptLimiter } from '../shared/ratelimit';
import { Replicator } from '../shared/replication';
import type { LocalSimulation } from '../shared/simulation';

export interface HostOptions {
  sim: LocalSimulation;
  keys: WorldKeys;
  world: { name: string; seed: number };
  /** Joueurs connus (l'hôte y figure avec le rôle « hote »). */
  members: Map<string, Member>;
  rules: WorldRules;
  now?: () => number;
  /** La liste des joueurs ou leurs droits ont changé (à sauvegarder, à afficher). */
  onChange?: () => void;
  /** Journal (connexions, refus). */
  log?: (text: string) => void;
}

type Stage = 'defi' | 'ident' | 'connected' | 'closed';

interface Conn {
  link: Link;
  stage: Stage;
  hc: string;
  pc: string;
  id: string;
  name: string;
  known: boolean;
  openedAt: number;
  /** Dernier message reçu (un joueur muet trop longtemps est considéré comme parti). */
  lastMsg: number;
  replicator: Replicator | null;
  queue: InputCmd[];
  /** Pas consécutifs sans commande reçue. */
  starve: number;
  /** Messages reçus dans la seconde en cours (limitation du rythme). */
  window: { start: number; inputs: number; acts: number; total: number };
}

interface Away {
  until: number;
}

/** Commandes en attente au-delà desquelles on rattrape le retard (la plus ancienne est jetée). */
const MAX_QUEUE = 12;
const HANDSHAKE_TIMEOUT_MS = 15000;
/** Un joueur envoie ses commandes 20 fois par seconde : 10 s de silence, sa liaison est morte. */
const SILENCE_TIMEOUT_MS = 10000;

export class HostServer {
  private readonly conns = new Set<Conn>();
  private readonly byPlayer = new Map<string, Conn>();
  private readonly away = new Map<string, Away>();
  private readonly limiter = new AttemptLimiter();
  private readonly now: () => number;
  private closed = false;

  constructor(private readonly o: HostOptions) {
    this.now = o.now ?? (() => Date.now());
    const sim = o.sim;
    sim.permit = (pid, use, owner, access) => permitUse(this.o.members, pid, use, owner, access);
  }

  get rules(): WorldRules {
    return this.o.rules;
  }

  /** Nombre de joueurs connectés (sans l'hôte). */
  get connectedCount(): number {
    return this.byPlayer.size;
  }

  /** Nouvelle liaison entrante : on envoie le défi et on attend la preuve du code. */
  attach(link: Link): void {
    if (this.closed) {
      link.close();
      return;
    }
    const now = this.now();
    const wait = this.limiter.retryAfter(link.source, now);
    if (wait > 0) {
      this.sendTo(link, { t: 'reject', reason: 'rate_limited', retryAfterMs: wait });
      link.close();
      return;
    }
    const c: Conn = { link, stage: 'defi', hc: newChallenge(), pc: '', id: '', name: '', known: false, openedAt: now, lastMsg: now, replicator: null, queue: [], starve: 0, window: { start: now, inputs: 0, acts: 0, total: 0 } };
    this.conns.add(c);
    link.onMessage = (raw, fast) => void this.onMessage(c, raw, fast);
    link.onClose = () => this.onClosed(c);
    this.sendTo(link, { t: 'defi', hc: c.hc, protocol: PROTOCOL_VERSION });
  }

  private sendTo(link: Link, msg: ControlMessage | object, fast = false): void {
    try {
      link.send(msg, fast);
    } catch {
      // Liaison déjà fermée.
    }
  }

  private reject(c: Conn, reason: RejectReason, failure = false): void {
    if (failure) this.limiter.recordFailure(c.link.source, this.now());
    this.o.log?.(`Connexion refusée (${reason})${c.name ? ` : ${c.name}` : ''}.`);
    this.sendTo(c.link, { t: 'reject', reason, ...(reason === 'rate_limited' ? { retryAfterMs: this.limiter.retryAfter(c.link.source, this.now()) } : {}) });
    c.stage = 'closed';
    this.conns.delete(c);
    setTimeout(() => c.link.close(), 50);
  }

  /** Limite le rythme des messages ; renvoie faux s'il faut ignorer celui-ci. */
  private rate(c: Conn, kind: 'in' | 'act' | 'other'): boolean {
    const now = this.now();
    const w = c.window;
    if (now - w.start >= 1000) {
      w.start = now;
      w.inputs = 0;
      w.acts = 0;
      w.total = 0;
    }
    w.total++;
    if (kind === 'in') w.inputs++;
    if (kind === 'act') w.acts++;
    // Bien au-delà de l'usage normal : on coupe.
    if (w.total > 600) {
      this.reject(c, 'rate_limited', true);
      return false;
    }
    if (kind === 'in' && w.inputs > 90) return false;
    if (kind === 'act' && w.acts > 30) return false;
    return true;
  }

  private async onMessage(c: Conn, raw: unknown, fast: boolean): Promise<void> {
    if (c.stage === 'closed') return;
    c.lastMsg = this.now();
    const msg = parseClientMessage(raw);
    if (!msg) {
      if (c.stage !== 'connected') this.reject(c, 'invalid', true);
      return;
    }
    if (!this.rate(c, msg.t === 'in' ? 'in' : msg.t === 'act' ? 'act' : 'other')) return;
    if (c.stage === 'defi') {
      if (msg.t !== 'hello') return this.reject(c, 'invalid', true);
      return this.onHello(c, msg);
    }
    if (c.stage === 'ident') {
      if (msg.t !== 'ident') return this.reject(c, 'invalid', true);
      return this.onIdent(c, msg);
    }
    this.onPlay(c, msg, fast);
  }

  private async onHello(c: Conn, m: Extract<ClientMessage, { t: 'hello' }>): Promise<void> {
    if (m.protocol !== PROTOCOL_VERSION) return this.reject(c, 'protocol');
    if (!(await checkCodeProof(this.o.keys, 'joueur', c.hc, m.pc, m.proof))) return this.reject(c, 'bad_code', true);
    if (c.stage !== 'defi') return;
    c.pc = m.pc;
    c.id = m.id;
    c.name = m.name;
    const member = this.o.members.get(m.id);
    c.known = !!member;
    if (member?.role === 'hote') return this.reject(c, 'identity', true);
    c.stage = 'ident';
    this.sendTo(c.link, { t: 'hote', proof: await codeProof(this.o.keys, 'hote', c.hc, c.pc), known: c.known });
  }

  private async onIdent(c: Conn, m: Extract<ClientMessage, { t: 'ident' }>): Promise<void> {
    const member = this.o.members.get(c.id);
    if (member) {
      if (!(await checkIdentityProof(member.verifier, c.hc, m.proof))) return this.reject(c, 'identity', true);
    } else if (!m.verifier) return this.reject(c, 'identity', true);
    if (c.stage !== 'ident') return;
    const already = this.byPlayer.get(c.id);
    if (already) {
      // Le même joueur se reconnecte (autre onglet, coupure) : l'ancienne liaison est remplacée.
      this.sendTo(already.link, { t: 'reject', reason: 'replaced' });
      this.dropConn(already, false);
    } else if (this.byPlayer.size >= MAX_PLAYERS - 1) return this.reject(c, 'full');
    this.limiter.recordSuccess(c.link.source);
    const now = this.now();
    let mem = member;
    if (!mem) {
      mem = { id: c.id, name: c.name, role: this.o.rules.defaultRole, overrides: {}, verifier: m.verifier!, lastSeen: now };
      this.o.members.set(c.id, mem);
    }
    mem.name = c.name;
    mem.lastSeen = now;
    const sim = this.o.sim;
    this.away.delete(c.id);
    const slot = sim.addPlayer(c.id, c.name, (Math.random() * 2 ** 31) >>> 0);
    c.stage = 'connected';
    c.replicator = new Replicator(sim, c.id);
    this.byPlayer.set(c.id, c);
    this.sendTo(c.link, {
      t: 'welcome',
      you: { id: c.id, name: c.name, role: mem.role },
      world: { name: this.o.world.name, seed: this.o.world.seed },
      start: { x: slot.state.x, y: slot.state.y, z: slot.state.z, yaw: slot.cmd.yaw },
      perms: this.permsOf(mem),
      rules: this.o.rules,
    });
    this.o.log?.(`${c.name} a rejoint la partie.`);
    this.broadcastRoster();
    this.o.onChange?.();
  }

  private permsOf(m: Member): Record<Perm, boolean> {
    const out = {} as Record<Perm, boolean>;
    for (const p of PERMS) out[p] = hasPerm(m, p);
    return out;
  }

  private onPlay(c: Conn, m: ClientMessage, _fast: boolean): void {
    const sim = this.o.sim;
    switch (m.t) {
      case 'in':
        for (const cmd of m.c) c.queue.push(cmd);
        while (c.queue.length > MAX_QUEUE) c.queue.shift();
        break;
      case 'act': {
        const r = sim.actAs(c.id, m.a);
        this.sendTo(c.link, { t: 'res', n: m.n, ok: r.ok, ...(r.message ? { m: r.message } : {}) });
        break;
      }
      case 'ping':
        this.sendTo(c.link, { t: 'pong', id: m.id, ct: m.ct }, true);
        break;
      case 'bye':
        this.dropConn(c, true);
        break;
      default:
        break;
    }
  }

  /** Avant chaque pas : la prochaine commande de chaque joueur connecté. */
  beforeStep(): void {
    for (const c of this.byPlayer.values()) {
      const cmd = c.queue.shift();
      if (cmd) {
        c.starve = 0;
        this.o.sim.setInput(c.id, cmd);
      } else if (++c.starve === 15) {
        // Plus de commandes (onglet caché, réseau ralenti) : le personnage s'arrête au lieu de répéter la dernière.
        const slot = this.o.sim.players.get(c.id);
        if (slot) slot.cmd = { ...slot.cmd, wx: 0, wz: 0, buttons: 0 };
      }
    }
  }

  /** Après chaque pas : envois, délais de connexion, joueurs absents. */
  afterStep(): void {
    const sim = this.o.sim;
    for (const c of this.byPlayer.values()) {
      if (!c.replicator) continue;
      for (const msg of c.replicator.collect(sim.tick)) this.sendTo(c.link, msg, msg.t === 'snap');
    }
    if (sim.tick % 30 === 0) this.housekeeping();
  }

  private housekeeping(): void {
    const now = this.now();
    for (const c of [...this.conns]) if (c.stage !== 'connected' && now - c.openedAt > HANDSHAKE_TIMEOUT_MS) this.reject(c, 'invalid');
    for (const c of [...this.byPlayer.values()]) if (now - c.lastMsg > SILENCE_TIMEOUT_MS) this.dropConn(c, true);
    const sim = this.o.sim;
    for (const [id, a] of [...this.away]) {
      const slot = sim.players.get(id);
      if (!slot) {
        this.away.delete(id);
        continue;
      }
      slot.shielded = this.o.rules.protectAtBase && this.atBase(id);
      if (now >= a.until) {
        sim.removePlayer(id);
        this.away.delete(id);
        this.broadcastRoster();
        this.o.onChange?.();
      }
    }
  }

  /** Près d'une de ses constructions (30 m) : « dans sa base ». */
  private atBase(id: string): boolean {
    const slot = this.o.sim.players.get(id);
    if (!slot) return false;
    const s = slot.state;
    return this.o.sim.build.structures.some((st) => st.owner === id && Math.hypot(st.x - s.x, st.z - s.z) < 30);
  }

  private onClosed(c: Conn): void {
    if (c.stage === 'connected') this.dropConn(c, true);
    else {
      c.stage = 'closed';
      this.conns.delete(c);
    }
  }

  /** Fin de liaison d'un joueur : son personnage reste endormi selon les règles, puis il est retiré. */
  private dropConn(c: Conn, stayAsleep: boolean): void {
    if (c.stage === 'closed') return;
    c.stage = 'closed';
    this.conns.delete(c);
    if (this.byPlayer.get(c.id) === c) this.byPlayer.delete(c.id);
    c.link.onMessage = null;
    c.link.onClose = null;
    c.link.close();
    const sim = this.o.sim;
    const slot = sim.players.get(c.id);
    const mem = this.o.members.get(c.id);
    if (mem) mem.lastSeen = this.now();
    if (slot && stayAsleep && this.o.rules.awaySeconds > 0) {
      slot.away = true;
      slot.cmd = { ...slot.cmd, wx: 0, wz: 0, buttons: 0 };
      slot.shielded = this.o.rules.protectAtBase && this.atBase(c.id);
      this.away.set(c.id, { until: this.now() + this.o.rules.awaySeconds * 1000 });
      this.o.log?.(`${c.name} s’est déconnecté : son personnage reste endormi un moment.`);
    } else if (slot && !this.byPlayer.has(c.id)) {
      sim.removePlayer(c.id);
      this.o.log?.(`${c.name} a quitté la partie.`);
    }
    this.broadcastRoster();
    this.o.onChange?.();
  }

  roster(): RosterEntry[] {
    const out: RosterEntry[] = [];
    for (const m of this.o.members.values()) out.push({ id: m.id, name: m.name, role: m.role, online: m.role === 'hote' || this.byPlayer.has(m.id) });
    return out;
  }

  private broadcastRoster(): void {
    const msg: ControlMessage = { t: 'roster', players: this.roster() };
    for (const c of this.byPlayer.values()) this.sendTo(c.link, msg);
  }

  private sendPerms(id: string): void {
    const c = this.byPlayer.get(id);
    const m = this.o.members.get(id);
    if (c && m) this.sendTo(c.link, { t: 'perms', role: m.role, perms: this.permsOf(m), rules: this.o.rules });
  }

  // ——— Gestion par l'hôte ———

  setRole(id: string, role: Role): void {
    const m = this.o.members.get(id);
    if (!m || m.role === 'hote' || role === 'hote') return;
    m.role = role;
    this.sendPerms(id);
    this.broadcastRoster();
    this.o.onChange?.();
  }

  setOverride(id: string, perm: Perm, value: boolean | null): void {
    const m = this.o.members.get(id);
    if (!m || m.role === 'hote') return;
    if (value === null) delete m.overrides[perm];
    else m.overrides[perm] = value;
    this.sendPerms(id);
    this.o.onChange?.();
  }

  setRules(r: WorldRules): void {
    Object.assign(this.o.rules, r);
    for (const id of this.byPlayer.keys()) this.sendPerms(id);
    this.o.onChange?.();
  }

  /** Retire un joueur de la partie (il pourra revenir avec le code). */
  kick(id: string): void {
    const c = this.byPlayer.get(id);
    if (!c) return;
    this.sendTo(c.link, { t: 'stop', reason: 'kicked' });
    this.dropConn(c, false);
  }

  /** L'hôte arrête : tout le monde est prévenu ; les personnages sont sauvegardés avec le monde. */
  close(): void {
    if (this.closed) return;
    this.closed = true;
    for (const c of [...this.conns]) {
      this.sendTo(c.link, { t: 'stop', reason: 'host_stopped' });
      c.stage = 'closed';
      c.link.onMessage = null;
      c.link.onClose = null;
      setTimeout(() => c.link.close(), 50);
    }
    this.conns.clear();
    this.byPlayer.clear();
    this.away.clear();
  }
}
