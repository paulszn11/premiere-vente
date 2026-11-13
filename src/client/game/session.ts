// Session de jeu : relie la simulation (pas fixe de 60 Hz), la caméra à la première personne,
// l'affichage du monde, les commandes et les mesures de performance.
// Mode « bench » : la caméra suit un parcours fixe pour le test de performance.

import { FreeCamera } from '@babylonjs/core/Cameras/freeCamera';
import type { AbstractEngine } from '@babylonjs/core/Engines/abstractEngine';
import { SceneInstrumentation } from '@babylonjs/core/Instrumentation/sceneInstrumentation';
import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import { Scene } from '@babylonjs/core/scene';
import { EYE_HEIGHT, EYE_HEIGHT_CROUCH, TICK_DT, WATER_LEVEL } from '../../shared/constants';
import { BIOME_LABELS, type BiomeId, SURFACE_LABELS } from '../../shared/geography';
import type { PlayerAction } from '../../shared/actions';
import { ensureToolMeta } from '../../shared/crafting';
import { type ItemStack, store } from '../../shared/inventory';
import { ITEMS } from '../../shared/items';
import { BTN_CROUCH, BTN_INTERACT, BTN_JUMP, BTN_SPRINT, BTN_THROW, type InputCmd, MAX_PITCH, MODE_CLIMB, MODE_SWIM, wrapAngle } from '../../shared/movement';
import { ITEM_OF_PROP, QUICK_PICK, propWithArticle } from '../../shared/props';
import { LocalSimulation, RESPAWN_DELAY, type SimEvent, type Tone, findSpawn } from '../../shared/simulation';
import { DEATH_LABELS, INJURY_LABELS, VITALS, ZONE_LABELS, limits } from '../../shared/vitals';
import { treeKey } from '../../shared/resources';
import { type SpawnPoint, TEST_DESTINATIONS, resolveDestination } from '../../shared/spawn';
import { Terrain } from '../../shared/terrain';
import type { DeviceInfo } from '../device';
import { type Action, codeLabel } from '../input/bindings';
import type { InputManager } from '../input/input-manager';
import { BENCH_MAX_LOADING_S, BENCH_MEASURE_S, BENCH_SEED, BENCH_WARMUP_S, type BenchReport, type BenchResult, reportMeta } from '../perf/benchmark';
import { AdaptiveResolution, PerfMonitor, computeStats } from '../perf/perf-monitor';
import { BACKEND_LABELS, type ActiveBackend } from '../render/engine';
import { TerrainJobs } from '../render/terrain-jobs';
import { WorldView } from '../render/world-view';
import type { BagView } from '../ui/bag-view';
import { PRESETS, PRESET_LABELS, type QualityParams, type QualityPreset, type Settings, effectiveQuality } from '../settings';

export interface DownState {
  kind: 'inconscient' | 'critique' | 'mort' | 'endormi';
  title: string;
  detail: string;
  canGiveUp: boolean;
}

export interface HudState {
  stamina: number;
  /** Endurance maximale (réduite par l'énergie, la douleur, la fièvre). */
  staminaMax: number;
  breath: number;
  exhausted: boolean;
  underwater: boolean;
  prompt: string | null;
  health: number;
  bleeding: boolean;
  /** Vision trouble de 0 à 1. */
  blur: number;
  /** Paupières fermées de 0 à 1 (micro-sommeil). */
  eyelids: number;
  gesture: { label: string; progress: number } | null;
  down: DownState | null;
}

export interface SessionOptions {
  engine: AbstractEngine;
  backend: ActiveBackend;
  device: DeviceInfo;
  input: InputManager;
  autoPreset: QualityPreset;
  getSettings: () => Settings;
  onPauseChange?: (paused: boolean) => void;
  onTogglePerf?: () => void;
  onHud?: (text: string | null) => void;
  onStatus?: (hud: HudState) => void;
  onMessage?: (text: string, tone: Tone) => void;
  /** Vue du sac (créée par l'interface). */
  bag?: BagView;
  /** Le sac s'ouvre ou se ferme (curseur, commandes tactiles). */
  onBagChange?: (open: boolean) => void;
}

export interface Pose {
  x: number;
  y: number;
  z: number;
  yaw: number;
  pitch: number;
}

type BenchRunner = (ms: number, now: number) => void;

const MODE_LABELS = ['marche', 'nage', 'escalade'];
const FALL_MESSAGES: Array<[string, Tone]> = [
  ['', 'info'],
  ['Vous trébuchez à la réception.', 'info'],
  ['Mauvaise chute.', 'alerte'],
  ['Chute violente.', 'danger'],
  ['Chute mortelle.', 'danger'],
];

function minSec(t: number): string {
  const s = Math.max(0, Math.ceil(t));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

export class GameSession {
  readonly scene: Scene;
  readonly camera: FreeCamera;
  readonly world: WorldView;
  readonly jobs: TerrainJobs;
  readonly perf = new PerfMonitor();
  /** Temps de calcul de chaque image côté processeur (simulation + préparation du rendu). */
  readonly cpuPerf = new PerfMonitor();
  readonly adaptive = new AdaptiveResolution();
  yaw = 0;
  pitch = 0;
  paused = false;
  preset: QualityPreset = 'medium';
  private params: QualityParams = PRESETS.medium;
  private readonly instr: SceneInstrumentation;
  private acc = 0;
  private lastFrame = 0;
  private lastHud = 0;
  private seq = 0;
  private benchRunner: BenchRunner | null = null;
  private lastCpuMs = 0;
  private lastUnlockAt = -1e9;
  private running = false;
  // Effets de caméra.
  private eye = EYE_HEIGHT;
  private bobPhase = 0;
  private landOffset = 0;
  private landVel = 0;
  private fovBoost = 0;
  private biome: BiomeId | null = null;
  private biomeCheck = 0;
  private roll = 0;
  private deadBack = 0;
  private giveUpHeld = 0;
  private useHeld = 0;
  private worldVersion = -1;
  private restHeld = 0;
  private restDone = false;
  private nextPocket = 0;

  static async createPlay(opts: SessionOptions, seed: number, spawnSeed: number, start: Pose | null, onProgress?: (text: string) => void, save?: unknown): Promise<GameSession> {
    const jobs = new TerrainJobs(seed, opts.device.cores >= 4 ? 2 : 1);
    onProgress?.('Préparation de la physique…');
    const sim = await LocalSimulation.create(seed, {
      spawnSeed,
      heightProvider: jobs.heightProvider,
      ...(start ? { start: { x: start.x, y: start.y, z: start.z } } : {}),
      ...(save !== undefined ? { save } : {}),
    });
    const session = new GameSession(opts, sim.terrain, sim, jobs);
    if (start) {
      session.yaw = start.yaw;
      session.pitch = start.pitch;
    }
    const s = sim.state;
    await session.world.preload(s.x, s.y + EYE_HEIGHT, s.z, (done, total) => onProgress?.(`Chargement du terrain… ${done} / ${total}`));
    return session;
  }

  static createBench(opts: SessionOptions): GameSession {
    return new GameSession(opts, new Terrain(BENCH_SEED), null, new TerrainJobs(BENCH_SEED, opts.device.cores >= 4 ? 2 : 1));
  }

  private constructor(
    private readonly opts: SessionOptions,
    readonly terrain: Terrain,
    readonly sim: LocalSimulation | null,
    jobs: TerrainJobs,
  ) {
    this.jobs = jobs;
    this.scene = new Scene(opts.engine);
    this.camera = new FreeCamera('regard', new Vector3(0, 20, 0), this.scene);
    this.camera.inputs.clear();
    this.camera.minZ = 0.05;
    this.instr = new SceneInstrumentation(this.scene);
    const { params } = effectiveQuality(opts.getSettings(), opts.autoPreset);
    this.world = new WorldView(this.scene, terrain, jobs, params);
    this.applySettings();
    if (sim) {
      const s = sim.state;
      this.camera.position.set(s.x, s.y + EYE_HEIGHT, s.z);
      // Arbres abattus : souches à la place des arbres.
      this.world.treeFelled = (cx, cz, i) => sim.world.isFelled(treeKey(cx, cz, i), sim.time);
    }
  }

  /** Applique les réglages courants (qualité, champ de vision, résolution). */
  applySettings(): void {
    const s = this.opts.getSettings();
    const q = effectiveQuality(s, this.opts.autoPreset);
    this.preset = q.preset;
    this.params = q.params;
    this.world.setQuality(q.params);
    this.camera.maxZ = this.world.viewDistance * 1.05 + 60;
    if (!s.adaptiveResolution) this.adaptive.reset();
    this.applyScaling();
  }

  private applyScaling(): void {
    const s = this.opts.getSettings();
    const dpr = window.devicePixelRatio || 1;
    const bench = this.benchRunner !== null;
    const userScale = bench ? 1 : s.renderScale;
    const adaptive = !bench && s.adaptiveResolution ? this.adaptive.scale : 1;
    const ratio = Math.min(dpr, this.params.maxPixelRatio) * userScale * adaptive;
    this.opts.engine.setHardwareScalingLevel(1 / Math.max(0.25, ratio));
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.lastFrame = performance.now();
    this.opts.engine.runRenderLoop(this.frame);
  }

  stop(): void {
    this.running = false;
    this.opts.engine.stopRenderLoop(this.frame);
  }

  setPaused(paused: boolean): void {
    if (this.paused === paused) return;
    this.paused = paused;
    this.opts.input.clear();
    this.opts.onPauseChange?.(paused);
  }

  /** Signale que le pointeur vient d'être libéré (Échap) : évite une double bascule de la pause. */
  notePointerUnlock(): void {
    this.lastUnlockAt = performance.now();
  }

  /** Position et regard actuels (pour reprendre plus tard au même endroit). */
  pose(): Pose | null {
    const s = this.sim?.state;
    return s ? { x: s.x, y: s.y, z: s.z, yaw: this.yaw, pitch: this.pitch } : null;
  }

  /** Sauvegarde complète de la partie solo (position, regard, corps, sac, objets du monde). */
  saveData(): { v: 1; yaw: number; pitch: number; sim: unknown } | null {
    return this.sim ? { v: 1, yaw: this.yaw, pitch: this.pitch, sim: this.sim.serialize() } : null;
  }

  /** Point d'apparition du joueur dans ce monde. */
  get spawn(): SpawnPoint | null {
    return this.sim?.spawn ?? null;
  }

  /** Outil de test : téléporte le joueur vers une destination prédéfinie. */
  teleport(destId: string): boolean {
    const dest = TEST_DESTINATIONS.find((d) => d.id === destId);
    if (!this.sim || !dest) return false;
    const r = resolveDestination(this.terrain, dest, { x: this.sim.state.x, z: this.sim.state.z });
    this.sim.teleport(r.x, r.y, r.z);
    if (r.yaw !== null) this.yaw = r.yaw;
    this.pitch = 0;
    this.biome = null;
    return true;
  }

  /** Outil de test : un jeu d'outils pour essayer la récolte sans tout fabriquer. Renvoie le nombre d'objets reçus. */
  giveTestKit(): number {
    const sim = this.sim;
    if (!sim) return 0;
    const kit: ItemStack[] = [
      { item: 'couteau', count: 1 },
      { item: 'hache', count: 1 },
      { item: 'baton_fouir', count: 1 },
      { item: 'batee', count: 1 },
      { item: 'archet', count: 1 },
      { item: 'pot', count: 1 },
      { item: 'pierre', count: 1, mass: 0.6, radius: 0.04 },
    ];
    let given = 0;
    for (const st of kit) {
      ensureToolMeta(st, 75);
      if (store(sim.inventory, st) === 0) given++;
    }
    return given;
  }

  private key(action: Action): string {
    const code = this.opts.getSettings().bindings[action][0];
    if (this.opts.device.touch) {
      const touchNames: Partial<Record<Action, string>> = { interact: '« Prendre »', throw: '« Lancer »', crouch: '« Accroupir »', jump: '« Sauter »', use: '« Utiliser »', bag: '« Sac »' };
      if (touchNames[action]) return touchNames[action]!;
    }
    return code ? codeLabel(code, this.opts.input.layout) : '?';
  }

  private buildCmd(): InputCmd {
    const input = this.opts.input;
    const bagOpen = this.opts.bag?.isOpen ?? false;
    const active = !this.paused && !bagOpen;
    const mx = active ? input.move.x : 0;
    const my = active ? input.move.y : 0;
    const sin = Math.sin(this.yaw);
    const cos = Math.cos(this.yaw);
    // Avant = (sin, cos), droite = (cos, -sin) dans le repère de Babylon.
    const wx = cos * mx + sin * my;
    const wz = -sin * mx + cos * my;
    let buttons = 0;
    if (active) {
      if (input.isDown('jump')) buttons |= BTN_JUMP;
      if (input.isDown('sprint')) buttons |= BTN_SPRINT;
      if (input.isDown('crouch')) buttons |= BTN_CROUCH;
      if (input.isDown('interact')) buttons |= BTN_INTERACT;
      if (input.isDown('throw')) buttons |= BTN_THROW;
    } else if (bagOpen && !this.paused) {
      // À genoux devant son sac ouvert.
      buttons = BTN_CROUCH;
    }
    this.seq++;
    return { seq: this.seq, wx, wz, yaw: this.yaw, pitch: this.pitch, buttons };
  }

  private readonly frame = (): void => {
    const now = performance.now();
    let dt = (now - this.lastFrame) / 1000;
    this.lastFrame = now;
    if (dt > 0.25) dt = 0.25;
    const input = this.opts.input;
    input.update(dt);

    if (this.benchRunner) {
      this.benchRunner(dt * 1000, now);
      this.scene.render();
      this.lastCpuMs = performance.now() - now;
      this.perf.frame(dt * 1000);
      this.cpuPerf.frame(this.lastCpuMs);
      return;
    }

    if (input.pressed('perf')) this.opts.onTogglePerf?.();
    const bag = this.opts.bag;
    if (bag?.isOpen && !this.paused && (input.pressed('pause') || input.pressed('bag'))) this.closeBag();
    else if (input.pressed('pause') && now - this.lastUnlockAt > 400) this.setPaused(!this.paused);

    if (!this.paused && !bag?.isOpen) {
      this.yaw = wrapAngle(this.yaw + input.look.dx);
      this.pitch = Math.max(-MAX_PITCH, Math.min(MAX_PITCH, this.pitch + input.look.dy));
      this.handleActions(dt);
      // À terre : maintenir « Prendre » 2 s pour abandonner (clavier et manette).
      const vs = this.sim?.vitals.state;
      if ((vs === 'critique' || vs === 'inconscient') && input.isDown('interact')) {
        this.giveUpHeld += dt;
        if (this.giveUpHeld >= 2) {
          this.giveUpHeld = 0;
          this.giveUp();
        }
      } else this.giveUpHeld = 0;
    }

    const sim = this.sim!;
    this.acc += dt;
    let steps = 0;
    while (this.acc >= TICK_DT && steps < 6) {
      sim.step(this.buildCmd());
      if (sim.state.impact > 3) this.landVel -= Math.min(4, sim.state.impact * 0.12);
      this.acc -= TICK_DT;
      steps++;
    }
    if (steps >= 6) this.acc = 0;
    for (const ev of sim.takeEvents()) this.handleEvent(ev);

    const a = this.acc / TICK_DT;
    const p = sim.prev;
    const s = sim.state;
    const x = p.x + (s.x - p.x) * a;
    const baseY = p.y + (s.y - p.y) * a;
    const z = p.z + (s.z - p.z) * a;

    // Effets de caméra : hauteur des yeux (accroupi), balancement, atterrissage, trébuchement.
    const v = sim.vitals;
    let targetEye = s.crouched ? EYE_HEIGHT_CROUCH : EYE_HEIGHT;
    let targetRoll = 0;
    if (v.state === 'mort') {
      // Hors du corps : on le voit d'un peu plus haut, en arrière.
      targetEye = 2.3;
      this.pitch += (0.75 - this.pitch) * Math.min(1, dt * 2);
    } else if (v.state !== 'eveille' || v.posture === 'endormi') {
      targetEye = 0.3;
      targetRoll = 0.35;
    } else if (v.posture === 'assis') targetEye = 0.85;
    this.roll += (targetRoll - this.roll) * Math.min(1, dt * 3);
    this.eye += (targetEye - this.eye) * Math.min(1, dt * (targetEye < 0.5 ? 3 : 10));
    const hs = Math.sqrt(s.vx * s.vx + s.vz * s.vz);
    let bobY = 0;
    let bobX = 0;
    if (s.mode === MODE_SWIM) {
      bobY = Math.sin(now * 0.0016) * 0.05;
    } else if (s.grounded && hs > 0.3) {
      this.bobPhase += dt * (hs * 1.9 + 2);
      const amp = Math.min(0.055, 0.012 * hs);
      bobY = Math.sin(this.bobPhase * 2) * amp * 0.5;
      bobX = Math.sin(this.bobPhase) * amp * 0.6;
    }
    this.landVel += (-60 * this.landOffset - 11 * this.landVel) * dt;
    this.landOffset += this.landVel * dt;
    let shakeP = 0;
    let shakeR = 0;
    if (s.stumble > 0) {
      shakeP = (Math.random() - 0.5) * 0.03 * Math.min(1, s.stumble);
      shakeR = Math.sin(now * 0.02) * 0.05 * Math.min(1, s.stumble);
    }
    const sprinting = hs > 4 && s.grounded;
    this.fovBoost += ((sprinting ? 6 : 0) - this.fovBoost) * Math.min(1, dt * 4);
    const settings = this.opts.getSettings();
    this.camera.fov = ((settings.fov + this.fovBoost) * Math.PI) / 180;
    const camY = baseY + this.eye + bobY + this.landOffset;
    this.deadBack += ((v.state === 'mort' ? 2.2 : 0) - this.deadBack) * Math.min(1, dt * 2);
    this.camera.position.set(x + Math.cos(this.yaw) * bobX - Math.sin(this.yaw) * this.deadBack, camY, z - Math.sin(this.yaw) * bobX - Math.cos(this.yaw) * this.deadBack);
    this.camera.rotation.set(this.pitch + shakeP, this.yaw, shakeR + this.roll);
    this.world.update(x, camY, z, this.opts.device.mobile ? 4 : 6);
    if (sim.world.version !== this.worldVersion) {
      this.worldVersion = sim.world.version;
      this.world.invalidateVegetation();
    }
    this.world.updateProps(sim.props.views());
    this.scene.render();
    if (bag?.isOpen) bag.frame(dt);
    this.lastCpuMs = performance.now() - now;
    this.cpuPerf.frame(this.lastCpuMs);

    const ms = dt * 1000;
    this.perf.frame(ms);
    if (settings.adaptiveResolution && this.adaptive.frame(ms, now)) this.applyScaling();
    if (++this.biomeCheck % 30 === 0) {
      const b = this.terrain.sampleInto(s.x, s.z).biome;
      if (b !== this.biome) {
        if (this.biome !== null) this.opts.onMessage?.(BIOME_LABELS[b], 'info');
        this.biome = b;
      }
    }
    if (now - this.lastHud > 100) {
      this.lastHud = now;
      this.opts.onHud?.(settings.showPerf ? this.hudText() : null);
      const lim = limits(v);
      const g = sim.gesture;
      this.opts.onStatus?.({
        stamina: s.stamina,
        staminaMax: s.staminaMax,
        breath: s.breath,
        exhausted: s.exhausted,
        underwater: camY < WATER_LEVEL,
        prompt: this.prompt(),
        health: v.health,
        bleeding: lim.bleeding > 0,
        blur: v.state === 'eveille' ? lim.blur : 0,
        eyelids: v.microSleep > 0 ? 1 : 0,
        gesture: g ? { label: g.label, progress: 1 - g.left / g.total } : null,
        down: this.downState(),
      });
    }
  };

  /** Indication d'action contextuelle (à remplacer plus tard par une interface intégrée à l'univers). */
  private prompt(): string | null {
    const sim = this.sim;
    if (!sim || this.paused || this.opts.bag?.isOpen) return null;
    const s = sim.state;
    const v = sim.vitals;
    if (v.state !== 'eveille' || v.posture === 'endormi' || sim.gesture) return null;
    if (v.posture === 'assis') return this.opts.device.touch ? 'Bougez pour vous lever · « Sac » pour dormir' : `${this.key('rest')} : se lever (maintenir : dormir) · bouger : se lever`;
    if (s.mode === MODE_CLIMB) return `${this.key('crouch')} : lâcher · ${this.key('jump')} : sauter en arrière`;
    const held = sim.props.held;
    const hint = sim.useHint();
    const hintText = hint ? `${this.key(hint.interact ? 'interact' : 'use')} : ${hint.action}` : null;
    if (held) {
      if (held.mode === 'drag') return `${this.key('interact')} : lâcher`;
      const def = sim.props.defOf(held.id);
      const item = def ? ITEM_OF_PROP[def.kind] : undefined;
      if (hintText) return `${hintText} · ${this.key('interact')} : poser`;
      const parts = [`${this.key('interact')} : poser`, `${this.key('throw')} : lancer`];
      if (item && ITEMS[item].food) parts.unshift(`${this.key('use')} : manger`);
      else if (item === 'chiffon' || item === 'aloes' || item === 'baton') parts.unshift(`${this.key('use')} : soigner`);
      if (item && item !== 'pierre') parts.push(`${this.key('bag')} : sac`);
      return parts.join(' · ');
    }
    if (hintText) return hintText;
    const t = sim.props.target(s, this.yaw, this.pitch);
    if (!t) return null;
    if (t.kind === 'foyer') {
      const f = sim.props.defOf(t.id)?.fire;
      return `${this.key('interact')} : foyer (${f?.lit ? `allumé, ${Math.ceil(f.fuel / 60)} min de bois` : 'éteint'})`;
    }
    if (t.kind === 'gravier_or') return `${this.key('interact')} : examiner le gravier qui brille`;
    if (t.fixed) return null;
    if (t.kind === 'corps') return `${this.key('interact')} : fouiller le corps`;
    if (t.kind === 'sac') return `${this.key('interact')} : ouvrir le sac à dos`;
    if (QUICK_PICK.has(t.kind)) return `${this.key('interact')} : ramasser ${propWithArticle(t.kind)}`;
    const kg = `${Math.round(t.mass)} kg`;
    if (t.handling === 'trainer') return `${this.key('interact')} : traîner le ${t.label} (${kg})`;
    const article = t.kind === 'pierre' || t.kind === 'buche' ? 'la' : 'le';
    return `${this.key('interact')} : prendre ${article} ${t.label} (${kg}${t.handling === 'deux-mains' ? ', à deux mains' : ''})`;
  }

  private doAct(a: PlayerAction): void {
    const sim = this.sim;
    if (!sim) return;
    const r = sim.act(a);
    if (r.message) this.opts.onMessage?.(r.message, r.ok ? 'info' : 'alerte');
  }

  /** Action du joueur (interface, tests). */
  act(a: PlayerAction): { ok: boolean; message?: string } {
    const r = this.sim ? this.sim.act(a) : { ok: false };
    if (r.message) this.opts.onMessage?.(r.message, r.ok ? 'info' : 'alerte');
    return r;
  }

  /** Touches des actions ponctuelles (utiliser, poches, repos, sac). */
  private handleActions(dt: number): void {
    const input = this.opts.input;
    const sim = this.sim;
    if (!sim) return;
    const v = sim.vitals;
    if (v.state !== 'eveille') return;
    if (input.pressed('bag')) {
      this.openBag(null);
      return;
    }
    // Utiliser : un appui, ou maintenir pour enchaîner les coups d'outil.
    if (input.pressed('use')) {
      this.doAct({ type: 'utiliser' });
      this.useHeld = 0;
    } else if (input.isDown('use')) {
      this.useHeld += dt;
      if (this.useHeld > 0.25) {
        const r = sim.act({ type: 'utiliser', repeat: true });
        if (r.ok && r.message) this.opts.onMessage?.(r.message, 'info');
      }
    } else this.useHeld = 0;
    const pockets: Action[] = ['pocket1', 'pocket2', 'pocket3', 'pocket4'];
    pockets.forEach((a, i) => {
      if (input.pressed(a)) this.doAct({ type: 'poche', index: i });
    });
    if (input.pressed('pocketNext')) this.cyclePocket();
    // Repos : appui court = s'asseoir ou se lever ; maintenu = dormir.
    if (input.isDown('rest')) {
      if (input.pressed('rest')) {
        this.restHeld = 0;
        this.restDone = false;
        if (v.posture !== 'debout') {
          this.doAct({ type: 'lever' });
          this.restDone = true;
        }
      }
      this.restHeld += dt;
      if (!this.restDone && this.restHeld >= 0.8) {
        this.doAct({ type: 'dormir' });
        this.restDone = true;
      }
    } else if (this.restHeld > 0) {
      if (!this.restDone) this.doAct({ type: 'reposer' });
      this.restHeld = 0;
    }
  }

  private cyclePocket(): void {
    const sim = this.sim!;
    if (sim.props.held) {
      this.doAct({ type: 'ranger' });
      return;
    }
    for (let k = 0; k < 4; k++) {
      const i = (this.nextPocket + k) % 4;
      if (sim.inventory.pockets[i]) {
        this.nextPocket = (i + 1) % 4;
        this.doAct({ type: 'poche', index: i });
        return;
      }
    }
    this.opts.onMessage?.('Vos poches sont vides.', 'info');
  }

  /** Ouvre le sac (et un corps ou un sac posé à fouiller). */
  openBag(otherProp: string | null): void {
    const sim = this.sim;
    const bag = this.opts.bag;
    if (!sim || !bag || sim.vitals.state !== 'eveille' || this.paused) return;
    if (sim.vitals.posture === 'endormi') return;
    bag.open(sim, otherProp);
    this.opts.input.clear();
    this.opts.onBagChange?.(true);
  }

  closeBag(): void {
    const bag = this.opts.bag;
    if (!bag?.isOpen) return;
    bag.close();
    this.opts.input.clear();
    this.opts.onBagChange?.(false);
  }

  /** État critique ou inconscient : mourir tout de suite. */
  giveUp(): void {
    this.sim?.act({ type: 'abandonner' });
  }

  private handleEvent(ev: SimEvent): void {
    const msg = (text: string, tone: Tone) => this.opts.onMessage?.(text, tone);
    switch (ev.type) {
      case 'chute': {
        if (ev.severity >= 4) break;
        const [base, tone] = FALL_MESSAGES[ev.severity]!;
        const hurt = ev.injuries.filter((i) => i.kind !== 'contusion').map((i) => `${INJURY_LABELS[i.kind]}${i.kind === 'coupure' && i.grave ? ' profonde' : ''} (${ZONE_LABELS[i.zone]})`);
        msg(hurt.length ? `${base} ${hurt.join(', ').replace(/^./, (c) => c.toUpperCase())}.` : base, tone);
        break;
      }
      case 'noyade':
        msg('Vous manquez d’air ! Remontez à la surface.', 'danger');
        break;
      case 'message':
        msg(ev.text, ev.tone);
        break;
      case 'ouvrir':
        this.openBag(ev.prop);
        break;
      case 'mort':
        this.closeBag();
        break;
      case 'reapparition': {
        this.biome = null;
        this.pitch = 0;
        if (ev.place === 'secours') {
          msg('Retour au point d’arrivée.', 'alerte');
          break;
        }
        const where = ev.place === 'sommeil' ? 'là où vous avez dormi' : 'à votre point d’arrivée';
        const body = !ev.body ? '' : ev.body.distance === 0 ? ' Votre corps est tout près, avec vos affaires.' : ` Votre corps est resté à environ ${ev.body.distance.toLocaleString('fr-FR')} m ${ev.body.direction}, avec vos affaires.`;
        msg(`Vous vous réveillez ${where}.${body}`, 'alerte');
        break;
      }
      case 'vital': {
        const e = ev.event;
        if (e.type === 'inconscient')
          msg(e.reason === 'choc' ? 'La douleur vous fait perdre connaissance : une jambe cassée a besoin d’une attelle.' : e.reason === 'commotion' ? 'Le choc à la tête vous assomme.' : 'Vous perdez connaissance.', 'danger');
        else if (e.type === 'critique') msg('État critique : vous perdez votre sang.', 'danger');
        else if (e.type === 'stabilise') msg('Le saignement s’est arrêté : vous êtes stabilisé.', 'alerte');
        else if (e.type === 'reveil') msg('Vous reprenez connaissance, très affaibli.', 'alerte');
        else if (e.type === 'infection') msg(`Une plaie s’est infectée (${ZONE_LABELS[e.zone]}) : fièvre. Désinfectez-la avec de l’aloès.`, 'danger');
        else if (e.type === 'fievre_finie') msg('La fièvre est tombée.', 'info');
        else if (e.type === 'gueri') msg(`${INJURY_LABELS[e.kind].replace(/^./, (c) => c.toUpperCase())} guérie (${ZONE_LABELS[e.zone]}).`, 'info');
        else if (e.type === 'saignement_arrete') msg(`Le saignement s’est arrêté (${ZONE_LABELS[e.zone]}).`, 'info');
        else if (e.type === 'endormi' && e.forced) msg('Épuisé, vous vous endormez sur place.', 'alerte');
        else if (e.type === 'reveille') msg('Vous vous réveillez.', 'info');
        else if (e.type === 'repere') msg('Vous vous souviendrez de cet endroit : vous y réapparaîtrez en cas de mort.', 'info');
        break;
      }
    }
  }

  /** Écran affiché quand le joueur ne peut plus agir (inconscient, critique, mort, endormi). */
  private downState(): DownState | null {
    const sim = this.sim;
    if (!sim) return null;
    const v = sim.vitals;
    if (v.state === 'mort')
      return {
        kind: 'mort',
        title: 'Vous êtes mort',
        detail: `Cause : ${DEATH_LABELS[v.cause ?? 'abandon']}. Votre corps et vos affaires restent ici. Réveil dans ${Math.max(1, Math.ceil(RESPAWN_DELAY - sim.deadTime))} s…`,
        canGiveUp: false,
      };
    if (v.state === 'critique')
      return {
        kind: 'critique',
        title: 'État critique',
        detail: `Vous perdez votre sang. Sans aide, vous mourrez dans ${minSec(v.timer)}. Un autre joueur peut bander votre plaie et vous relever.${this.opts.device.touch ? '' : ` Maintenir ${this.key('interact')} pour abandonner.`}`,
        canGiveUp: true,
      };
    if (v.state === 'inconscient')
      return {
        kind: 'inconscient',
        title: 'Vous avez perdu connaissance',
        detail: sim.state.mode === MODE_SWIM ? 'Vous coulez…' : `Vous reprendrez connaissance dans ${Math.max(1, Math.ceil(v.timer))} s environ.`,
        canGiveUp: true,
      };
    if (v.posture === 'endormi')
      return {
        kind: 'endormi',
        title: 'Vous dormez',
        detail: `Fatigue : ${Math.round(v.fatigue)} %. ${v.sleepTime >= VITALS.sleepRespawnSeconds ? 'Vous réapparaîtrez ici en cas de mort. ' : 'Au bout d’une minute, vous réapparaîtrez ici en cas de mort. '}Bougez pour vous réveiller.`,
        canGiveUp: false,
      };
    return null;
  }

  hudText(): string {
    const st = this.perf.stats();
    const w = this.world.stats();
    const s = this.sim?.state;
    const settings = this.opts.getSettings();
    const scale = Math.round(settings.renderScale * (settings.adaptiveResolution ? this.adaptive.scale : 1) * 100);
    const cpu = this.cpuPerf.stats();
    const lines = [
      `IPS ${st.fps.toFixed(1)} (1 % bas ${st.fpsLow1.toFixed(1)}) · ${st.msMedian.toFixed(1)} ms (95 % : ${st.msP95.toFixed(1)}) · calcul ${cpu.msMedian.toFixed(1)} ms`,
      `${BACKEND_LABELS[this.opts.backend]} · qualité ${PRESET_LABELS[this.preset]}${settings.quality === 'auto' ? ' (auto)' : ''} · ${this.opts.engine.getRenderWidth()}×${this.opts.engine.getRenderHeight()} (${scale} %)${this.jobs.usesWorkers ? '' : ' · sans fil de calcul'}`,
      `Chunks ${w.chunks}${w.pending ? ` (+${w.pending})` : ''} · arbres ${w.trees} · appels ${this.instr.drawCallsCounter.current} · sommets ${Math.round(w.vertices / 1000)} k`,
    ];
    if (s && this.sim) {
      const b = this.terrain.sampleInto(s.x, s.z).biome;
      lines.push(
        `Position ${s.x.toFixed(0)}, ${s.y.toFixed(1)}, ${s.z.toFixed(0)} · ${BIOME_LABELS[b]} · sol : ${SURFACE_LABELS[s.surface]}`,
        `${MODE_LABELS[s.mode]}${s.crouched ? ' (accroupi)' : ''} · ${hs(s).toFixed(1)} m/s · endurance ${Math.round(s.stamina)} / ${Math.round(s.staminaMax)}${s.exhausted ? ' (épuisé)' : ''} · souffle ${Math.round(s.breath)} · objets ${this.sim.props.liveCount}`,
        `santé ${Math.round(this.sim.vitals.health)} · énergie ${Math.round(this.sim.vitals.energy)} · fatigue ${Math.round(this.sim.vitals.fatigue)} · blessures ${this.sim.vitals.injuries.length} · charge ${s.loadKg.toFixed(1)} kg · ${this.sim.vitals.state}`,
      );
    }
    return lines.join('\n');
  }

  /** Test de performance sur chaque niveau de qualité demandé. */
  runBenchmark(presets: QualityPreset[], onProgress: (text: string) => void, isCancelled: () => boolean): Promise<BenchReport> {
    return new Promise((resolve) => {
      const spawn = findSpawn(this.terrain);
      const antialias = this.params.antialias;
      const results: BenchResult[] = [];
      let index = 0;
      let phase: 'loading' | 'warmup' | 'measure' = 'loading';
      let phaseStart = performance.now();
      let loadingS = 0;
      let frameTimes: number[] = [];
      let cpuTimes: number[] = [];
      let drawSum = 0;
      let t = 0;
      let camY = spawn.y + 3;

      const label = () => `Qualité ${PRESET_LABELS[presets[index]!]} (${index + 1}/${presets.length})`;
      const startPreset = () => {
        this.params = { ...PRESETS[presets[index]!], antialias };
        this.preset = presets[index]!;
        this.world.setQuality(this.params);
        this.camera.maxZ = this.world.viewDistance * 1.05 + 60;
        this.camera.fov = (this.opts.getSettings().fov * Math.PI) / 180;
        this.applyScaling();
        phase = 'loading';
        phaseStart = performance.now();
        onProgress(`${label()} : chargement du terrain…`);
      };
      const finish = (cancelled: boolean) => {
        this.benchRunner = null;
        this.applySettings();
        resolve({ ...reportMeta(this.opts.backend, this.opts.device), results, cancelled });
      };

      this.benchRunner = (ms, now) => {
        t += ms / 1000;
        const angle = t * ((Math.PI * 2) / 24);
        const radius = 70;
        const x = spawn.x + Math.cos(angle) * radius;
        const z = spawn.z + Math.sin(angle) * radius;
        const ground = Math.max(this.terrain.heightAt(x, z), WATER_LEVEL);
        camY += (ground + 3 - camY) * Math.min(1, ms / 300);
        this.yaw = Math.atan2(-Math.sin(angle), Math.cos(angle));
        this.pitch = 0.08;
        this.camera.position.set(x, camY, z);
        this.camera.rotation.set(this.pitch, this.yaw, 0);
        this.world.update(x, camY, z, 6);

        if (isCancelled()) {
          finish(true);
          return;
        }
        if (phase === 'loading') {
          if (this.world.stats().pending === 0 || now - phaseStart > BENCH_MAX_LOADING_S * 1000) {
            loadingS = (now - phaseStart) / 1000;
            phase = 'warmup';
            phaseStart = now;
          }
        } else if (phase === 'warmup') {
          if (now - phaseStart >= BENCH_WARMUP_S * 1000) {
            phase = 'measure';
            phaseStart = now;
            frameTimes = [];
            cpuTimes = [];
            drawSum = 0;
          }
        } else {
          frameTimes.push(ms);
          cpuTimes.push(this.lastCpuMs);
          drawSum += this.instr.drawCallsCounter.current;
          const remaining = BENCH_MEASURE_S - (now - phaseStart) / 1000;
          if (remaining <= 0) {
            const w = this.world.stats();
            const cpu = computeStats(cpuTimes);
            results.push({
              preset: presets[index]!,
              ...computeStats(frameTimes),
              cpuMedian: cpu.msMedian,
              cpuP95: cpu.msP95,
              drawCalls: drawSum / Math.max(1, frameTimes.length),
              chunks: w.chunks,
              trees: w.trees,
              vertices: w.vertices,
              renderWidth: this.opts.engine.getRenderWidth(),
              renderHeight: this.opts.engine.getRenderHeight(),
              loadingS,
            });
            index++;
            if (index >= presets.length) finish(false);
            else startPreset();
          } else {
            onProgress(`${label()} : mesure, encore ${Math.ceil(remaining)} s`);
          }
        }
      };
      startPreset();
    });
  }

  dispose(): void {
    this.stop();
    this.world.dispose();
    this.jobs.dispose();
    this.sim?.dispose();
    this.instr.dispose();
    this.scene.dispose();
  }
}

function hs(s: { vx: number; vz: number }): number {
  return Math.sqrt(s.vx * s.vx + s.vz * s.vz);
}
