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
import { BTN_CROUCH, BTN_INTERACT, BTN_JUMP, BTN_SPRINT, BTN_THROW, type InputCmd, MAX_PITCH, MODE_CLIMB, MODE_SWIM, wrapAngle } from '../../shared/movement';
import { LocalSimulation, findSpawn } from '../../shared/simulation';
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
import { PRESETS, PRESET_LABELS, type QualityParams, type QualityPreset, type Settings, effectiveQuality } from '../settings';

export interface HudState {
  stamina: number;
  breath: number;
  exhausted: boolean;
  underwater: boolean;
  prompt: string | null;
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
  onMessage?: (text: string, tone: 'info' | 'alerte' | 'danger') => void;
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
const FALL_MESSAGES: Array<[string, 'info' | 'alerte' | 'danger']> = [
  ['', 'info'],
  ['Vous trébuchez à la réception.', 'info'],
  ['Mauvaise chute : blessure légère (effets en phase 3).', 'alerte'],
  ['Chute violente : blessure grave (effets en phase 3).', 'danger'],
  ['Chute mortelle (la mort arrivera en phase 3).', 'danger'],
];

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

  static async createPlay(opts: SessionOptions, seed: number, spawnSeed: number, start: Pose | null, onProgress?: (text: string) => void): Promise<GameSession> {
    const jobs = new TerrainJobs(seed, opts.device.cores >= 4 ? 2 : 1);
    onProgress?.('Préparation de la physique…');
    const sim = await LocalSimulation.create(seed, {
      spawnSeed,
      heightProvider: jobs.heightProvider,
      ...(start ? { start: { x: start.x, y: start.y, z: start.z } } : {}),
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

  /** Point d'apparition du joueur dans ce monde. */
  get spawn(): SpawnPoint | null {
    return this.sim?.spawn ?? null;
  }

  /** Outil de test : téléporte le joueur vers une destination prédéfinie. */
  teleport(destId: string): boolean {
    const dest = TEST_DESTINATIONS.find((d) => d.id === destId);
    if (!this.sim || !dest) return false;
    const r = resolveDestination(this.terrain, dest);
    this.sim.teleport(r.x, r.y, r.z);
    if (r.yaw !== null) this.yaw = r.yaw;
    this.pitch = 0;
    this.biome = null;
    return true;
  }

  private key(action: Action): string {
    const code = this.opts.getSettings().bindings[action][0];
    if (this.opts.device.touch) {
      const touchNames: Partial<Record<Action, string>> = { interact: '« Prendre »', throw: '« Lancer »', crouch: '« Accroupir »', jump: '« Sauter »' };
      if (touchNames[action]) return touchNames[action]!;
    }
    return code ? codeLabel(code, this.opts.input.layout) : '?';
  }

  private buildCmd(): InputCmd {
    const input = this.opts.input;
    const active = !this.paused;
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
    if (input.pressed('pause') && now - this.lastUnlockAt > 400) this.setPaused(!this.paused);

    if (!this.paused) {
      this.yaw = wrapAngle(this.yaw + input.look.dx);
      this.pitch = Math.max(-MAX_PITCH, Math.min(MAX_PITCH, this.pitch + input.look.dy));
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
    for (const ev of sim.takeEvents()) {
      if (ev.type === 'chute') this.opts.onMessage?.(FALL_MESSAGES[ev.severity]![0], FALL_MESSAGES[ev.severity]![1]);
      else if (ev.type === 'noyade') this.opts.onMessage?.('Vous manquez d’air ! Remontez à la surface.', 'danger');
      else if (ev.type === 'reapparition') this.opts.onMessage?.('Retour au point d’apparition.', 'alerte');
    }

    const a = this.acc / TICK_DT;
    const p = sim.prev;
    const s = sim.state;
    const x = p.x + (s.x - p.x) * a;
    const baseY = p.y + (s.y - p.y) * a;
    const z = p.z + (s.z - p.z) * a;

    // Effets de caméra : hauteur des yeux (accroupi), balancement, atterrissage, trébuchement.
    const targetEye = s.crouched ? EYE_HEIGHT_CROUCH : EYE_HEIGHT;
    this.eye += (targetEye - this.eye) * Math.min(1, dt * 10);
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
    this.camera.position.set(x + Math.cos(this.yaw) * bobX, camY, z - Math.sin(this.yaw) * bobX);
    this.camera.rotation.set(this.pitch + shakeP, this.yaw, shakeR);
    this.world.update(x, camY, z, this.opts.device.mobile ? 4 : 6);
    this.world.updateProps(sim.props.views());
    this.scene.render();
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
      this.opts.onStatus?.({ stamina: s.stamina, breath: s.breath, exhausted: s.exhausted, underwater: camY < WATER_LEVEL, prompt: this.prompt() });
    }
  };

  /** Indication d'action contextuelle (à remplacer plus tard par une interface intégrée à l'univers). */
  private prompt(): string | null {
    const sim = this.sim;
    if (!sim || this.paused) return null;
    const s = sim.state;
    if (s.mode === MODE_CLIMB) return `${this.key('crouch')} : lâcher · ${this.key('jump')} : sauter en arrière`;
    const held = sim.props.held;
    if (held) {
      return held.mode === 'drag' ? `${this.key('interact')} : lâcher le tronc` : `${this.key('interact')} : poser · ${this.key('throw')} : lancer`;
    }
    const t = sim.props.target(s, this.yaw, this.pitch);
    if (!t) return null;
    const kg = `${Math.round(t.mass)} kg`;
    if (t.handling === 'trainer') return `${this.key('interact')} : traîner le ${t.label} (${kg})`;
    const article = t.kind === 'pierre' || t.kind === 'buche' ? 'la' : 'le';
    return `${this.key('interact')} : prendre ${article} ${t.label} (${kg}${t.handling === 'deux-mains' ? ', à deux mains' : ''})`;
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
        `${MODE_LABELS[s.mode]}${s.crouched ? ' (accroupi)' : ''} · ${hs(s).toFixed(1)} m/s · endurance ${Math.round(s.stamina)}${s.exhausted ? ' (épuisé)' : ''} · souffle ${Math.round(s.breath)} · objets ${this.sim.props.liveCount}`,
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
