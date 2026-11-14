// Joueur distant (phase 8) : poignée de main avec l'hôte (preuve du code des deux côtés, preuve d'identité),
// puis envoi des commandes et des actions, et application des messages de l'hôte à la copie du monde.
// Sans affichage ni DOM : testé dans Node avec le vrai serveur de l'hôte.

import { PROTOCOL_VERSION } from '../../shared/constants';
import type { Link } from '../../shared/link';
import type { InputCmd } from '../../shared/movement';
import { type Identity, type WorldKeys, checkCodeProof, codeProof, identityProof, identityVerifier, newChallenge } from '../../shared/net-crypto';
import type { Perm, Role, WorldRules } from '../../shared/permissions';
import { type ControlMessage, REJECT_LABELS, type RejectReason, type RosterEntry } from '../../shared/protocol';
import { type HostMessage, type NetPlayerView, applyHostMessage } from '../../shared/replication';
import type { LocalSimulation } from '../../shared/simulation';

export type Welcome = Extract<ControlMessage, { t: 'welcome' }>;

export class JoinError extends Error {
  constructor(
    readonly reason: RejectReason | 'host_proof' | 'closed' | 'timeout',
    message: string,
  ) {
    super(message);
  }
}

/** Commandes regroupées par paquet (3 pas : 20 paquets par seconde). */
const INPUT_BATCH = 3;

export class RemoteClient {
  welcome: Welcome | null = null;
  role: Role = 'membre';
  perms: Record<Perm, boolean> | null = null;
  rules: WorldRules | null = null;
  roster: RosterEntry[] = [];
  /** Autres joueurs proches (dernier instantané). */
  players: NetPlayerView[] = [];
  /** Temps aller-retour mesuré (ms). */
  rtt = 0;
  onPlayers: ((list: NetPlayerView[]) => void) | null = null;
  onRoster: ((list: RosterEntry[]) => void) | null = null;
  onStop: ((reason: string) => void) | null = null;
  onResult: ((ok: boolean, message?: string) => void) | null = null;
  onPerms: (() => void) | null = null;
  private sim: LocalSimulation | null = null;
  private readonly early: HostMessage[] = [];
  private readonly batch: InputCmd[] = [];
  private nextAct = 1;
  private pingId = 0;
  private stopped = false;
  private lastPing = 0;

  constructor(
    private readonly link: Link,
    private readonly identity: Identity,
    private readonly name: string,
    private readonly keys: WorldKeys,
  ) {}

  /** Poignée de main : renvoie l'accueil de l'hôte, ou lève une JoinError. */
  connect(timeoutMs = 20000): Promise<Welcome> {
    return new Promise<Welcome>((resolve, reject) => {
      let pc = '';
      let hc = '';
      let done = false;
      const fail = (e: JoinError) => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        this.link.close();
        reject(e);
      };
      const timer = setTimeout(() => fail(new JoinError('timeout', 'L’hôte ne répond pas.')), timeoutMs);
      this.link.onClose = () => {
        if (!done) fail(new JoinError('closed', 'La liaison avec l’hôte s’est fermée.'));
        else this.handleStop('La liaison avec l’hôte est coupée.');
      };
      this.link.onMessage = (raw) => {
        const m = raw as ControlMessage | HostMessage;
        if (!m || typeof m !== 'object' || typeof (m as { t?: unknown }).t !== 'string') return;
        if (done) {
          this.onMessage(m);
          return;
        }
        void (async () => {
          switch (m.t) {
            case 'defi': {
              if (m.protocol !== PROTOCOL_VERSION) return fail(new JoinError('protocol', REJECT_LABELS.protocol));
              hc = m.hc;
              pc = newChallenge();
              this.link.send({ t: 'hello', protocol: PROTOCOL_VERSION, id: this.identity.id, name: this.name, pc, proof: await codeProof(this.keys, 'joueur', hc, pc) });
              break;
            }
            case 'hote': {
              // L'hôte prouve à son tour qu'il connaît le code : ce n'est pas un intrus qui se fait passer pour lui.
              if (!(await checkCodeProof(this.keys, 'hote', hc, pc, m.proof))) return fail(new JoinError('host_proof', 'L’hôte n’a pas prouvé qu’il connaît le code.'));
              if (m.known) this.link.send({ t: 'ident', proof: await identityProof(this.identity.secret, hc) });
              else this.link.send({ t: 'ident', verifier: await identityVerifier(this.identity.secret) });
              break;
            }
            case 'welcome':
              done = true;
              clearTimeout(timer);
              this.welcome = m;
              this.role = m.you.role;
              this.perms = m.perms;
              this.rules = m.rules;
              resolve(m);
              break;
            case 'reject':
              fail(new JoinError(m.reason, REJECT_LABELS[m.reason] ?? 'Connexion refusée.'));
              break;
            default:
              break;
          }
        })();
      };
    });
  }

  /** Branche la copie du monde : ses actions partent chez l'hôte ; les messages reçus avant sont appliqués. */
  attach(sim: LocalSimulation): void {
    this.sim = sim;
    sim.replica = { act: (a) => this.link.send({ t: 'act', n: this.nextAct++, a }) };
    for (const m of this.early.splice(0)) this.apply(m);
  }

  /** Commande du pas en cours (prédite localement par la copie, envoyée à l'hôte par paquets). */
  sendInput(cmd: InputCmd): void {
    if (this.stopped) return;
    this.batch.push(cmd);
    if (this.batch.length >= INPUT_BATCH) this.flush();
    const now = Date.now();
    if (now - this.lastPing > 2000) {
      this.lastPing = now;
      this.link.send({ t: 'ping', id: ++this.pingId, ct: now }, true);
    }
  }

  flush(): void {
    if (!this.batch.length || this.stopped) return;
    this.link.send({ t: 'in', c: this.batch.splice(0) }, true);
  }

  /** On quitte la partie. */
  leave(): void {
    if (this.stopped) return;
    this.flush();
    this.link.send({ t: 'bye' });
    this.stopped = true;
    setTimeout(() => this.link.close(), 100);
  }

  get connected(): boolean {
    return !this.stopped && this.link.open;
  }

  private onMessage(m: ControlMessage | HostMessage): void {
    switch (m.t) {
      case 'res':
        if (!m.ok || m.m) this.onResult?.(m.ok, m.m);
        if (m.m && this.sim) this.sim.pushRemoteEvents([{ type: 'message', text: m.m, tone: m.ok ? 'info' : 'alerte', tick: this.sim.tick }]);
        return;
      case 'pong':
        this.rtt = Date.now() - m.ct;
        return;
      case 'roster':
        this.roster = m.players;
        this.onRoster?.(m.players);
        return;
      case 'perms':
        this.role = m.role;
        this.perms = m.perms;
        this.rules = m.rules;
        this.onPerms?.();
        return;
      case 'stop':
        this.handleStop(m.reason === 'kicked' ? REJECT_LABELS.kicked : 'L’hôte a fermé son monde : il est sauvegardé chez lui. Vous le retrouverez quand il le rouvrira.');
        return;
      case 'reject':
        this.handleStop(REJECT_LABELS[m.reason] ?? 'Déconnecté.');
        return;
      case 'defi':
      case 'hote':
      case 'welcome':
        return;
      default:
        this.apply(m);
    }
  }

  private apply(m: HostMessage): void {
    if (!this.sim) {
      this.early.push(m);
      if (this.early.length > 2000) this.early.shift();
      return;
    }
    const r = applyHostMessage(this.sim, m);
    if (r.players) {
      this.players = r.players;
      this.onPlayers?.(r.players);
    }
  }

  private handleStop(text: string): void {
    if (this.stopped) return;
    this.stopped = true;
    this.onStop?.(text);
  }
}
