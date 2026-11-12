// Point d'entrée du client : chargement, écrans, enchaînement des parties et du test de performance.

import './styles.css';
import { GAME_VERSION } from '../shared/constants';
import { initPhysics } from '../shared/physics';
import { randomSeed } from '../shared/worldcode';
import { type DeviceInfo, detectDevice, suggestPreset } from './device';
import { GameSession, type SessionOptions } from './game/session';
import { codeLabel } from './input/bindings';
import { InputManager } from './input/input-manager';
import { TouchControls } from './input/touch-controls';
import { formatReport } from './perf/benchmark';
import { BACKEND_LABELS, type EngineResult, createEngine } from './render/engine';
import { PRESET_LABELS, PRESET_ORDER, type Settings, effectiveQuality, loadSettings, saveSettings } from './settings';
import { renderSettings } from './ui/settings-panel';

type ScreenName = 'loading' | 'home' | 'game' | 'pause' | 'settings' | 'bench';

const $ = <T extends HTMLElement = HTMLElement>(sel: string): T => {
  const el = document.querySelector<T>(sel);
  if (!el) throw new Error(`Élément manquant : ${sel}`);
  return el;
};

const screens: Record<Exclude<ScreenName, 'game'>, HTMLElement> = {
  loading: $('#screen-loading'),
  home: $('#screen-home'),
  pause: $('#screen-pause'),
  settings: $('#screen-settings'),
  bench: $('#screen-bench'),
};

let screen: ScreenName = 'loading';
let settingsReturn: ScreenName = 'home';
let toastTimer = 0;

function show(name: ScreenName): void {
  screen = name;
  for (const [key, el] of Object.entries(screens)) el.hidden = key !== name;
}

function toast(text: string, ms = 4000): void {
  const el = $('#toast');
  el.textContent = text;
  el.hidden = false;
  window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => (el.hidden = true), ms);
}

function setLoading(text: string): void {
  $('#loading-text').textContent = text;
}

function nextFrame(): Promise<void> {
  return new Promise((r) => requestAnimationFrame(() => r()));
}

async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const ta = document.createElement('textarea');
    ta.value = text;
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand('copy');
    ta.remove();
    return ok;
  }
}

function requestImmersive(): void {
  const el = document.documentElement as HTMLElement & { webkitRequestFullscreen?: () => void };
  try {
    if (!document.fullscreenElement && el.requestFullscreen) {
      el.requestFullscreen({ navigationUI: 'hide' })
        .then(() => {
          const o = window.screen as unknown as { orientation?: { lock?: (o: string) => Promise<void> } };
          return o.orientation?.lock?.('landscape');
        })
        .catch(() => undefined);
    } else el.webkitRequestFullscreen?.();
  } catch {
    // Plein écran indisponible (iPhone notamment) : le jeu reste jouable.
  }
}

async function boot(): Promise<void> {
  let settings: Settings = loadSettings();
  const getSettings = () => settings;
  let session: GameSession | null = null;

  setLoading('Chargement du moteur physique…');
  const physicsReady = initPhysics();
  const device: DeviceInfo = detectDevice();
  const autoPreset = suggestPreset(device);
  const canvas = $<HTMLCanvasElement>('#game');

  setLoading('Démarrage du moteur graphique…');
  let er: EngineResult;
  try {
    er = await createEngine(canvas, settings.backend, effectiveQuality(settings, autoPreset).params.antialias);
  } catch (err) {
    setLoading(`Impossible de démarrer la 3D sur cet appareil : ${err instanceof Error ? err.message : String(err)}`);
    return;
  }
  const engine = er.engine;
  window.addEventListener('resize', () => engine.resize());
  if (er.backend === 'webgpu') {
    // Si le périphérique WebGPU se perd (pilote instable), on revient à WebGL.
    engine.onContextLostObservable.add(() => {
      settings = { ...settings, backend: 'webgl2' };
      saveSettings(settings);
      toast('Le moteur WebGPU s’est arrêté : retour à WebGL dans un instant…', 6000);
      window.setTimeout(() => location.reload(), 2500);
    });
  }
  await physicsReady;

  const input = new InputManager(canvas, getSettings);
  const touch = new TouchControls($('#touch'), () => session?.setPaused(true));
  input.touch = touch;

  const update = (patch: Partial<Settings>) => {
    settings = { ...settings, ...patch };
    saveSettings(settings);
    session?.applySettings();
    refreshHome();
    if (!settings.showPerf) $('#perf').hidden = true;
  };

  const settingsDeps = { root: $('#settings-body'), input, autoPreset, activeBackend: er.backend, getSettings, update };

  function refreshHome(): void {
    const q = effectiveQuality(settings, autoPreset);
    $('#home-world').textContent = settings.worldSeed === null ? 'Aucun monde pour l’instant : « Jouer » en crée un.' : `Monde n° ${settings.worldSeed} (non sauvegardé en phase 1).`;
    $('#home-info').textContent = `Version ${GAME_VERSION} · ${BACKEND_LABELS[er.backend]} · qualité ${PRESET_LABELS[q.preset]}${settings.quality === 'auto' ? ' (auto)' : ''} · ${device.gpu}`;
    const b = settings.bindings;
    const k = (a: keyof typeof b) => (b[a][0] ? codeLabel(b[a][0]!, input.layout) : '—');
    const layoutUnknown = input.layout.size === 0;
    const isDefaultMove = b.forward[0] === 'KeyW' && b.left[0] === 'KeyA';
    const azertyHint = layoutUnknown && isDefaultMove ? ' (Z Q S D sur un clavier AZERTY)' : '';
    $('#home-controls').textContent = device.touch
      ? 'Tactile : joystick à gauche, regard en glissant à droite. Clavier, souris et manette fonctionnent aussi.'
      : `Clavier : ${k('forward')} ${k('left')} ${k('back')} ${k('right')}${azertyHint} pour se déplacer, souris pour regarder, ${k('jump')} pour sauter, ${k('sprint')} pour courir, ${k('pause')} pour le menu. Manette compatible.`;
  }

  const hint = $('#click-hint');
  const updateHint = () => {
    hint.hidden = !(screen === 'game' && !device.touch && !input.locked);
  };

  const sessionOpts: SessionOptions = {
    engine,
    backend: er.backend,
    device,
    input,
    autoPreset,
    getSettings,
    onTogglePerf: () => update({ showPerf: !settings.showPerf }),
    onHud: (text) => {
      const el = $('#perf');
      el.hidden = text === null;
      if (text !== null) el.textContent = text;
    },
    onPauseChange: (paused) => {
      if (paused) {
        input.exitPointerLock();
        touch.show(false);
        show('pause');
      } else {
        show('game');
        touch.show(device.touch);
      }
      updateHint();
    },
  };

  input.onPointerLockChange = (locked) => {
    if (!locked && session && screen === 'game' && !session.paused) {
      session.notePointerUnlock();
      session.setPaused(true);
    }
    updateHint();
  };

  canvas.addEventListener('click', () => {
    if (screen === 'game' && session && !session.paused && !device.touch) input.requestPointerLock();
  });

  document.addEventListener('visibilitychange', () => {
    if (document.hidden && session && screen === 'game') session.setPaused(true);
  });

  function enterGame(): void {
    show('game');
    $('#hud').hidden = false;
    input.gameActive = true;
    input.clear();
    touch.show(device.touch);
    if (!device.touch) input.requestPointerLock();
    updateHint();
  }

  function leaveSession(): void {
    session?.dispose();
    session = null;
    input.gameActive = false;
    input.exitPointerLock();
    touch.show(false);
    $('#hud').hidden = true;
    $('#perf').hidden = true;
    refreshHome();
    show('home');
  }

  async function play(): Promise<void> {
    if (settings.worldSeed === null) update({ worldSeed: randomSeed() });
    show('loading');
    setLoading('Création du monde…');
    await nextFrame();
    try {
      session = await GameSession.createPlay(sessionOpts, settings.worldSeed!);
    } catch (err) {
      show('home');
      toast(`Le monde n'a pas pu être créé : ${err instanceof Error ? err.message : String(err)}`, 8000);
      return;
    }
    enterGame();
    session.start();
  }

  async function bench(): Promise<void> {
    show('bench');
    $('#bench-running').hidden = false;
    $('#bench-result').hidden = true;
    $('#bench-progress').textContent = 'Préparation…';
    await nextFrame();
    let cancelled = false;
    $('#btn-bench-cancel').onclick = () => {
      cancelled = true;
    };
    session = GameSession.createBench(sessionOpts);
    session.start();
    const report = await session.runBenchmark(PRESET_ORDER, (t) => ($('#bench-progress').textContent = t), () => cancelled);
    session.dispose();
    session = null;
    const text = formatReport(report);
    try {
      localStorage.setItem('baz.lastBench', text);
    } catch {
      // Sans stockage, le rapport reste affiché et copiable.
    }
    (window as unknown as { __lastBench?: unknown }).__lastBench = report;
    $('#bench-report').textContent = text;
    $('#bench-running').hidden = true;
    $('#bench-result').hidden = false;
  }

  function openSettings(from: ScreenName): void {
    settingsReturn = from;
    renderSettings(settingsDeps);
    show('settings');
  }

  $('#btn-play').addEventListener('click', () => {
    if (device.touch) requestImmersive();
    void play();
  });
  $('#btn-new-world').addEventListener('click', () => {
    if (settings.worldSeed !== null && !confirm('Créer un nouveau monde ? Le monde actuel sera remplacé (rien n’est encore sauvegardé en phase 1).')) return;
    update({ worldSeed: randomSeed() });
    toast('Nouveau monde prêt : appuyez sur « Jouer ».');
  });
  $('#btn-bench').addEventListener('click', () => void bench());
  $('#btn-settings').addEventListener('click', () => openSettings('home'));
  $('#btn-resume').addEventListener('click', () => {
    if (!session) return;
    session.setPaused(false);
    if (!device.touch) input.requestPointerLock();
    else requestImmersive();
  });
  $('#btn-pause-settings').addEventListener('click', () => openSettings('pause'));
  $('#btn-quit').addEventListener('click', () => leaveSession());
  $('#btn-settings-close').addEventListener('click', () => {
    if (input.capturing) input.cancelCapture();
    show(settingsReturn === 'pause' && session ? 'pause' : 'home');
    refreshHome();
  });
  $('#btn-bench-copy').addEventListener('click', async () => {
    toast((await copyText($('#bench-report').textContent ?? '')) ? 'Résultats copiés.' : 'Copie impossible : sélectionnez le texte à la main.');
  });
  $('#btn-bench-close').addEventListener('click', () => {
    refreshHome();
    show('home');
  });

  let installPrompt: (Event & { prompt: () => Promise<void> }) | null = null;
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    installPrompt = e as Event & { prompt: () => Promise<void> };
    $('#btn-install').hidden = false;
  });
  $('#btn-install').addEventListener('click', async () => {
    if (!installPrompt) return;
    await installPrompt.prompt().catch(() => undefined);
    installPrompt = null;
    $('#btn-install').hidden = true;
  });

  // Accès pour les tests automatiques et le diagnostic.
  (window as unknown as { __game: unknown }).__game = {
    version: GAME_VERSION,
    backend: er.backend,
    fallbackReason: er.fallbackReason ?? null,
    autoPreset,
    device,
    screen: () => screen,
    settings: () => settings,
    session: () =>
      session && {
        state: session.sim ? { ...session.sim.state } : null,
        yaw: session.yaw,
        pitch: session.pitch,
        paused: session.paused,
        preset: session.preset,
        world: session.world.stats(),
        fps: session.perf.stats().fps,
        respawns: session.sim?.respawns ?? 0,
        tick: session.sim?.tick ?? 0,
        hud: session.hudText(),
      },
    input: () => ({ move: { ...input.move }, locked: input.locked, lastDevice: input.lastDevice, touchVisible: touch.visible }),
  };

  refreshHome();
  show('home');
  if (er.fallbackReason) toast(`${er.fallbackReason} WebGL est utilisé à la place.`, 8000);
  if (device.softwareRenderer) toast("Aucune carte graphique détectée : rendu logiciel, le jeu sera lent.", 8000);

  if ('serviceWorker' in navigator && import.meta.env.PROD) {
    navigator.serviceWorker.register('/sw.js').catch(() => undefined);
  }
}

void boot();
