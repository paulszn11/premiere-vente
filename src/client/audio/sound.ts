// Sons du jeu (phase 6), fabriqués par le navigateur (Web Audio) : aucun fichier à télécharger.
// Cris des animaux, coups, pas lourds, frôlements, placés dans l'espace (direction et distance) ;
// battements de cœur quand le danger approche ; sous l'eau, sons étouffés et grondement sourd
// quand la créature du lac est proche. Les navigateurs n'autorisent le son qu'après un geste de
// l'utilisateur : resume() est appelé au premier clic, appui ou touche.

import type { SoundKind } from '../../shared/fauna';

type Ctx = AudioContext;

/** Distance de référence (m) : en deçà, volume plein ; au-delà, il décroît. */
const REF: Partial<Record<SoundKind, number>> = {
  hyene_cri: 40,
  elephant_barrit: 60,
  elephant_gronde: 40,
  babouin_aboie: 30,
  leopard_rale: 18,
  ombre_gronde: 50,
  vautours: 30,
  impala_alarme: 20,
  vapeur_coup: 22,
  craquement: 18,
  roue_eau: 14,
};
const MAX_VOICES = 14;

export class SoundSystem {
  private ctx: Ctx | null = null;
  private master: GainNode | null = null;
  private muffle: BiquadFilterNode | null = null;
  private noise: AudioBuffer | null = null;
  private voices = 0;
  private drone: { gain: GainNode; nodes: AudioScheduledSourceNode[] } | null = null;
  private underAmb: { gain: GainNode; src: AudioBufferSourceNode } | null = null;
  private nextBeat = 0;
  private hrtf: boolean;
  volume = 0.8;
  /** Désactivé (tests automatiques, navigateur sans Web Audio). */
  disabled = false;
  /** Nombre de sons joués par sorte (diagnostic, tests). */
  readonly counts: Partial<Record<SoundKind, number>> = {};

  constructor(mobile: boolean) {
    this.hrtf = !mobile;
  }

  get running(): boolean {
    return this.ctx?.state === 'running';
  }

  /** À appeler lors d'un geste de l'utilisateur. */
  resume(): void {
    if (this.disabled) return;
    try {
      if (!this.ctx) {
        const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
        if (!AC) {
          this.disabled = true;
          return;
        }
        const ctx = new AC();
        this.ctx = ctx;
        this.master = ctx.createGain();
        this.master.gain.value = this.volume;
        this.muffle = ctx.createBiquadFilter();
        this.muffle.type = 'lowpass';
        this.muffle.frequency.value = 18000;
        this.muffle.connect(this.master);
        this.master.connect(ctx.destination);
        // Bruit blanc réutilisable (2 s).
        const len = ctx.sampleRate * 2;
        this.noise = ctx.createBuffer(1, len, ctx.sampleRate);
        const data = this.noise.getChannelData(0);
        let seed = 12345;
        for (let i = 0; i < len; i++) {
          seed = (seed * 1103515245 + 12345) >>> 0;
          data[i] = (seed / 4294967296) * 2 - 1;
        }
      }
      if (this.ctx.state === 'suspended') void this.ctx.resume();
    } catch {
      this.disabled = true;
    }
  }

  setVolume(v: number): void {
    this.volume = Math.max(0, Math.min(1, v));
    if (this.master && this.ctx) this.master.gain.setTargetAtTime(this.volume, this.ctx.currentTime, 0.05);
  }

  /** Position et orientation de l'auditeur (la caméra) ; ambiance sous l'eau ; danger (0 à 1). */
  update(x: number, y: number, z: number, yaw: number, pitch: number, o: { underwater: boolean; danger: number; ombre: number }): void {
    const ctx = this.ctx;
    if (!ctx || ctx.state !== 'running') return;
    // Une valeur non finie (image très longue, téléportation) ferait lever une exception à l'API audio.
    if (![x, y, z, yaw, pitch].every(Number.isFinite)) return;
    const l = ctx.listener;
    const fx = Math.sin(yaw) * Math.cos(pitch);
    const fy = -Math.sin(pitch);
    const fz = Math.cos(yaw) * Math.cos(pitch);
    if (l.positionX) {
      const t = ctx.currentTime;
      l.positionX.setTargetAtTime(x, t, 0.02);
      l.positionY.setTargetAtTime(y, t, 0.02);
      l.positionZ.setTargetAtTime(z, t, 0.02);
      l.forwardX.setTargetAtTime(fx, t, 0.02);
      l.forwardY.setTargetAtTime(fy, t, 0.02);
      l.forwardZ.setTargetAtTime(fz, t, 0.02);
      l.upX.value = 0;
      l.upY.value = 1;
      l.upZ.value = 0;
    } else {
      (l as unknown as { setPosition(x: number, y: number, z: number): void }).setPosition(x, y, z);
      (l as unknown as { setOrientation(a: number, b: number, c: number, d: number, e: number, f: number): void }).setOrientation(fx, fy, fz, 0, 1, 0);
    }
    // Sous l'eau : tout est étouffé, et un souffle sourd emplit les oreilles.
    this.muffle!.frequency.setTargetAtTime(o.underwater ? 550 : 18000, ctx.currentTime, 0.15);
    this.setUnderwater(o.underwater);
    this.setDrone(o.ombre);
    // Battements de cœur quand le danger approche.
    if (o.danger > 0.15 && ctx.currentTime >= this.nextBeat) {
      const bpm = 70 + o.danger * 70;
      this.heartbeat(0.15 + o.danger * 0.35);
      this.nextBeat = ctx.currentTime + 60 / bpm;
    }
  }

  private out(x: number, y: number, z: number, kind: SoundKind | null): AudioNode {
    const ctx = this.ctx!;
    if (kind === null) return this.muffle!;
    const p = ctx.createPanner();
    p.panningModel = this.hrtf ? 'HRTF' : 'equalpower';
    p.distanceModel = 'inverse';
    p.refDistance = REF[kind] ?? 8;
    p.rolloffFactor = 1.2;
    p.maxDistance = 600;
    if (p.positionX) {
      p.positionX.value = x;
      p.positionY.value = y;
      p.positionZ.value = z;
    } else (p as unknown as { setPosition(x: number, y: number, z: number): void }).setPosition(x, y, z);
    p.connect(this.muffle!);
    return p;
  }

  private env(g: GainNode, t: number, peak: number, attack: number, hold: number, release: number): number {
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak), t + attack);
    g.gain.setValueAtTime(Math.max(0.0002, peak), t + attack + hold);
    g.gain.exponentialRampToValueAtTime(0.0001, t + attack + hold + release);
    return t + attack + hold + release;
  }

  private osc(type: OscillatorType, f0: number, f1: number, t: number, dur: number, dest: AudioNode, peak: number, attack = 0.01): void {
    const ctx = this.ctx!;
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(f0, t);
    o.frequency.exponentialRampToValueAtTime(Math.max(1, f1), t + dur);
    const g = ctx.createGain();
    const end = this.env(g, t, peak, attack, dur * 0.4, dur * 0.6);
    o.connect(g).connect(dest);
    o.start(t);
    o.stop(end + 0.05);
    this.track(o);
  }

  private burst(t: number, dur: number, dest: AudioNode, peak: number, filter: BiquadFilterType, freq: number, q = 1): void {
    const ctx = this.ctx!;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    src.loop = true;
    const f = ctx.createBiquadFilter();
    f.type = filter;
    f.frequency.value = freq;
    f.Q.value = q;
    const g = ctx.createGain();
    const end = this.env(g, t, peak, 0.005, dur * 0.3, dur * 0.7);
    src.connect(f).connect(g).connect(dest);
    src.start(t, Math.random() * 1.5);
    src.stop(end + 0.05);
    this.track(src);
  }

  private track(n: AudioScheduledSourceNode): void {
    this.voices++;
    n.onended = () => {
      this.voices = Math.max(0, this.voices - 1);
    };
  }

  /** Joue un son à cette position (repère du monde). */
  play(kind: SoundKind, x: number, y: number, z: number, gain = 1): void {
    const ctx = this.ctx;
    if (!ctx || ctx.state !== 'running' || this.voices > MAX_VOICES * 6) return;
    this.counts[kind] = (this.counts[kind] ?? 0) + 1;
    const t = ctx.currentTime + 0.01;
    const dest = this.out(x, y, z, kind);
    const k = gain;
    switch (kind) {
      case 'hyene_cri':
        // « Whoop » : glissando montant, deux fois.
        for (let i = 0; i < 2; i++) {
          this.osc('sine', 280, 820, t + i * 1.1, 0.9, dest, 0.5 * k, 0.08);
          this.osc('triangle', 290, 830, t + i * 1.1, 0.9, dest, 0.12 * k, 0.08);
        }
        break;
      case 'hyene_rire':
        for (let i = 0; i < 9; i++) this.osc('sawtooth', 520 + (i % 3) * 60, 430, t + i * 0.11, 0.08, dest, 0.12 * k);
        break;
      case 'leopard_rale':
        // Râle « en scie » : souffles rauques réguliers.
        for (let i = 0; i < 6; i++) this.burst(t + i * 0.42, 0.2, dest, 0.5 * k, 'bandpass', i % 2 ? 260 : 330, 3);
        break;
      case 'elephant_barrit':
        this.osc('sawtooth', 420, 700, t, 1.1, dest, 0.35 * k, 0.05);
        this.osc('square', 840, 1300, t, 1.1, dest, 0.06 * k, 0.05);
        this.burst(t, 1.1, dest, 0.15 * k, 'bandpass', 1100, 2);
        break;
      case 'elephant_gronde':
        this.osc('sine', 42, 34, t, 2.2, dest, 0.6 * k, 0.3);
        this.osc('sine', 84, 70, t, 2.2, dest, 0.2 * k, 0.3);
        break;
      case 'babouin_aboie':
        this.osc('square', 420, 380, t, 0.12, dest, 0.18 * k);
        this.osc('square', 300, 220, t + 0.16, 0.26, dest, 0.18 * k);
        break;
      case 'impala_alarme':
        this.burst(t, 0.25, dest, 0.5 * k, 'bandpass', 1300, 2);
        break;
      case 'phaco_grogne':
        for (let i = 0; i < 3; i++) this.osc('sawtooth', 120, 90, t + i * 0.18, 0.12, dest, 0.25 * k);
        break;
      case 'croco_souffle':
        this.burst(t, 0.9, dest, 0.35 * k, 'lowpass', 2400);
        this.osc('sine', 62, 48, t, 0.9, dest, 0.3 * k, 0.1);
        break;
      case 'ombre_gronde':
        // Un grondement très grave, qu'on sent plus qu'on ne l'entend.
        this.osc('sine', 30, 21, t, 3.2, dest, 0.9 * k, 0.6);
        this.osc('sine', 46, 38, t, 3.2, dest, 0.35 * k, 0.6);
        this.burst(t, 3, dest, 0.12 * k, 'lowpass', 180);
        break;
      case 'eclaboussure':
        this.burst(t, 0.5, dest, 0.45 * k, 'highpass', 700);
        break;
      case 'morsure':
        this.burst(t, 0.06, dest, 0.6 * k, 'highpass', 1500);
        this.osc('sine', 110, 60, t, 0.16, dest, 0.5 * k);
        break;
      case 'coup':
        this.osc('sine', 75, 40, t, 0.22, dest, 0.7 * k);
        this.burst(t, 0.06, dest, 0.3 * k, 'lowpass', 1800);
        break;
      case 'pas_lourd':
        this.osc('sine', 48, 32, t, 0.18, dest, 0.6 * k);
        break;
      case 'frolement':
        for (let i = 0; i < 3; i++) this.burst(t + i * 0.16 + Math.random() * 0.05, 0.14, dest, 0.18 * k, 'bandpass', 2600 + Math.random() * 800, 0.8);
        break;
      case 'vautours':
        for (let i = 0; i < 3; i++) this.burst(t + i * 0.5, 0.25, dest, 0.2 * k, 'bandpass', 700, 4);
        break;
      case 'cri_douleur':
        this.osc('sine', 950, 480, t, 0.22, dest, 0.25 * k);
        break;
      case 'piege':
        this.burst(t, 0.04, dest, 0.6 * k, 'highpass', 2000);
        this.osc('triangle', 320, 150, t, 0.09, dest, 0.4 * k);
        break;
      // Phase 7 : véhicules et machines.
      case 'vapeur_coup':
        // Coup de piston : souffle de vapeur et choc sourd.
        this.burst(t, 0.14, dest, 0.32 * k, 'lowpass', 1100);
        this.osc('sine', 72, 46, t, 0.12, dest, 0.35 * k);
        break;
      case 'roue_roule':
        this.burst(t, 0.32, dest, 0.12 * k, 'lowpass', 260);
        break;
      case 'pagaie':
        this.burst(t, 0.28, dest, 0.22 * k, 'bandpass', 850, 1.2);
        this.burst(t + 0.05, 0.18, dest, 0.12 * k, 'highpass', 1800);
        break;
      case 'aubes':
        this.burst(t, 0.2, dest, 0.18 * k, 'highpass', 650);
        break;
      case 'roue_eau':
        this.osc('triangle', 190, 150, t, 0.32, dest, 0.12 * k, 0.05);
        this.burst(t + 0.1, 0.45, dest, 0.2 * k, 'highpass', 500);
        break;
      case 'meule':
        this.osc('sawtooth', 880, 860, t, 0.9, dest, 0.05 * k, 0.1);
        this.burst(t, 0.9, dest, 0.12 * k, 'bandpass', 3200, 1.5);
        break;
      case 'soufflet':
        this.burst(t, 0.8, dest, 0.22 * k, 'lowpass', 600);
        break;
      case 'pompe':
        this.osc('square', 170, 120, t, 0.08, dest, 0.12 * k);
        this.burst(t, 0.05, dest, 0.2 * k, 'bandpass', 1400, 2);
        break;
      case 'craquement':
        this.burst(t, 0.16, dest, 0.5 * k, 'bandpass', 1200, 1.5);
        this.osc('sine', 95, 50, t, 0.22, dest, 0.5 * k);
        break;
    }
  }

  private heartbeat(peak: number): void {
    const ctx = this.ctx!;
    const t = ctx.currentTime + 0.01;
    const dest = this.muffle!;
    this.osc('sine', 62, 40, t, 0.12, dest, peak);
    this.osc('sine', 58, 38, t + 0.18, 0.1, dest, peak * 0.7);
  }

  private setUnderwater(on: boolean): void {
    const ctx = this.ctx!;
    if (on && !this.underAmb) {
      const src = ctx.createBufferSource();
      src.buffer = this.noise;
      src.loop = true;
      const f = ctx.createBiquadFilter();
      f.type = 'lowpass';
      f.frequency.value = 220;
      const g = ctx.createGain();
      g.gain.value = 0.0001;
      g.gain.setTargetAtTime(0.18, ctx.currentTime, 0.3);
      src.connect(f).connect(g).connect(this.master!);
      src.start();
      this.underAmb = { gain: g, src };
    } else if (!on && this.underAmb) {
      const u = this.underAmb;
      this.underAmb = null;
      u.gain.gain.setTargetAtTime(0.0001, ctx.currentTime, 0.2);
      u.src.stop(ctx.currentTime + 0.8);
    }
  }

  /** Bourdonnement sourd et battant : la créature du lac est là (0 à 1). */
  private setDrone(level: number): void {
    const ctx = this.ctx!;
    if (level > 0.02 && !this.drone) {
      const g = ctx.createGain();
      g.gain.value = 0.0001;
      g.connect(this.master!);
      const nodes: AudioScheduledSourceNode[] = [];
      for (const f of [31, 33.5, 62]) {
        const o = ctx.createOscillator();
        o.type = f > 60 ? 'triangle' : 'sine';
        o.frequency.value = f;
        o.connect(g);
        o.start();
        nodes.push(o);
      }
      this.drone = { gain: g, nodes };
    }
    if (this.drone) {
      this.drone.gain.gain.setTargetAtTime(Math.max(0.0001, level * 0.5), ctx.currentTime, 0.4);
      if (level <= 0.02) {
        const d = this.drone;
        this.drone = null;
        d.gain.gain.setTargetAtTime(0.0001, ctx.currentTime, 0.3);
        for (const n of d.nodes) n.stop(ctx.currentTime + 1.5);
      }
    }
  }

  dispose(): void {
    if (this.drone) for (const n of this.drone.nodes) n.stop();
    this.underAmb?.src.stop();
    this.drone = null;
    this.underAmb = null;
  }
}
