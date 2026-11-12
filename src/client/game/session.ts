// Session de jeu : relie la simulation (pas fixe de 60 Hz), la caméra à la première personne,
// l'affichage du monde, les commandes et les mesures de performance.
// Mode « bench » : la caméra suit un parcours fixe pour le test de performance.

import { FreeCamera } from '@babylonjs/core/Cameras/freeCamera';
import type { AbstractEngine } from '@babylonjs/core/Engines/abstractEngine';
import { SceneInstrumentation } from '@babylonjs/core/Instrumentation/sceneInstrumentation';
import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import { Scene } from '@babylonjs/core/scene';
import { EYE_HEIGHT, TICK_DT, WATER_LEVEL } from '../../shared/constants';
import { BTN_CROUCH, BTN_INTERACT, BTN_JUMP, BTN_SPRINT, type InputCmd, MAX_PITCH, wrapAngle } from '../../shared/movement';
import { LocalSimulation, findSpawn } from '../../shared/simulation';
import { Terrain } from '../../shared/terrain';
import type { DeviceInfo } from '../device';
import type { InputManager } from '../input/input-manager';
import { BENCH_MAX_LOADING_S, BENCH_MEASURE_S, BENCH_SEED, BENCH_WARMUP_S, type BenchReport, type BenchResult, reportMeta } from '../perf/benchmark';
import { AdaptiveResolution, PerfMonitor, computeStats } from '../perf/perf-monitor';
import { BACKEND_LABELS, type ActiveBackend } from '../render/engine';
import { WorldView } from '../render/world-view';
import { PRESETS, PRESET_LABELS, type QualityParams, type QualityPreset, type Settings, effectiveQuality } from '../settings';

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
}

type BenchRunner = (ms: number, now: number) => void;

export class GameSession {
  readonly scene: Scene;
  readonly camera: FreeCamera;
  readonly world: WorldView;
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

  static async createPlay(opts: SessionOptions, seed: number): Promise<GameSession> {
    const sim = await LocalSimulation.create(seed);
    return new GameSession(opts, sim.terrain, sim);
  }

  static createBench(opts: SessionOptions): GameSession {
    return new GameSession(opts, new Terrain(BENCH_SEED), null);
  }

  private constructor(
    private readonly opts: SessionOptions,
    readonly terrain: Terrain,
    readonly sim: LocalSimulation | null,
  ) {
    this.scene = new Scene(opts.engine);
    this.camera = new FreeCamera('regard', new Vector3(0, 20, 0), this.scene);
    this.camera.inputs.clear();
    this.camera.minZ = 0.05;
    this.instr = new SceneInstrumentation(this.scene);
    const { params } = effectiveQuality(opts.getSettings(), opts.autoPreset);
    this.world = new WorldView(this.scene, terrain, params);
    this.applySettings();
    if (sim) {
      const s = sim.state;
      this.camera.position.set(s.x, s.y + EYE_HEIGHT, s.z);
      this.world.flush(s.x, s.y + EYE_HEIGHT, s.z);
    }
  }

  /** Applique les réglages courants (qualité, champ de vision, résolution). */
  applySettings(): void {
    const s = this.opts.getSettings();
    const q = effectiveQuality(s, this.opts.autoPreset);
    this.preset = q.preset;
    this.params = q.params;
    this.world.setQuality(q.params);
    this.camera.fov = (s.fov * Math.PI) / 180;
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
      this.acc -= TICK_DT;
      steps++;
    }
    if (steps >= 6) this.acc = 0;
    const a = this.acc / TICK_DT;
    const p = sim.prev;
    const s = sim.state;
    const x = p.x + (s.x - p.x) * a;
    const y = p.y + (s.y - p.y) * a + EYE_HEIGHT;
    const z = p.z + (s.z - p.z) * a;
    this.camera.position.set(x, y, z);
    this.camera.rotation.set(this.pitch, this.yaw, 0);
    this.world.update(x, y, z, this.opts.device.mobile ? 4 : 6);
    this.scene.render();
    this.lastCpuMs = performance.now() - now;
    this.cpuPerf.frame(this.lastCpuMs);

    const ms = dt * 1000;
    this.perf.frame(ms);
    const settings = this.opts.getSettings();
    if (settings.adaptiveResolution && this.adaptive.frame(ms, now)) this.applyScaling();
    if (now - this.lastHud > 250) {
      this.lastHud = now;
      this.opts.onHud?.(settings.showPerf ? this.hudText() : null);
    }
  };

  hudText(): string {
    const st = this.perf.stats();
    const w = this.world.stats();
    const s = this.sim?.state;
    const settings = this.opts.getSettings();
    const scale = Math.round(settings.renderScale * (settings.adaptiveResolution ? this.adaptive.scale : 1) * 100);
    const cpu = this.cpuPerf.stats();
    const lines = [
      `IPS ${st.fps.toFixed(1)} (1 % bas ${st.fpsLow1.toFixed(1)}) · ${st.msMedian.toFixed(1)} ms (95 % : ${st.msP95.toFixed(1)}) · calcul ${cpu.msMedian.toFixed(1)} ms`,
      `${BACKEND_LABELS[this.opts.backend]} · qualité ${PRESET_LABELS[this.preset]}${settings.quality === 'auto' ? ' (auto)' : ''} · ${this.opts.engine.getRenderWidth()}×${this.opts.engine.getRenderHeight()} (${scale} %)`,
      `Chunks ${w.chunks}${w.pending ? ` (+${w.pending})` : ''} · arbres ${w.trees} · appels ${this.instr.drawCallsCounter.current} · sommets ${Math.round(w.vertices / 1000)} k`,
    ];
    if (s) {
      lines.push(
        `Position ${s.x.toFixed(1)}, ${s.y.toFixed(1)}, ${s.z.toFixed(1)} · ${s.grounded ? 'au sol' : 'en l’air'} · ${Math.hypot(s.vx, s.vz).toFixed(1)} m/s`,
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
    this.sim?.dispose();
    this.instr.dispose();
    this.scene.dispose();
  }
}
