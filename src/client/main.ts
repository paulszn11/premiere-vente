// Point d'entrée du client : chargement, écrans, enchaînement des parties et du test de performance.

import './styles.css';
import { GAME_VERSION } from '../shared/constants';
import { initPhysics } from '../shared/physics';
import { randomSeed } from '../shared/worldcode';
import { type DeviceInfo, detectDevice, suggestPreset } from './device';
import { GameSession, type HudState, type Pose, type SessionOptions } from './game/session';
import { TEST_DESTINATIONS } from '../shared/spawn';
import { codeLabel } from './input/bindings';
import { InputManager } from './input/input-manager';
import { TouchControls } from './input/touch-controls';
import { formatReport } from './perf/benchmark';
import { BACKEND_LABELS, type EngineResult, createEngine } from './render/engine';
import { PRESET_LABELS, PRESET_ORDER, type Settings, effectiveQuality, loadSettings, saveSettings } from './settings';
import { BagView } from './ui/bag-view';
import { SoundSystem } from './audio/sound';
import { SPECIES, type SpeciesId } from '../shared/creatures';
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
  // Sons : le navigateur ne les autorise qu'après un geste de l'utilisateur.
  const sound = new SoundSystem(device.mobile);
  sound.volume = settings.volume;
  const wakeSound = () => sound.resume();
  for (const ev of ['pointerdown', 'keydown', 'touchstart'] as const) window.addEventListener(ev, wakeSound, { passive: true });

  const update = (patch: Partial<Settings>) => {
    settings = { ...settings, ...patch };
    if (patch.volume !== undefined) sound.setVolume(settings.volume);
    saveSettings(settings);
    session?.applySettings();
    refreshHome();
    if (!settings.showPerf) $('#perf').hidden = true;
  };

  const settingsDeps = {
    root: $('#settings-body'),
    input,
    autoPreset,
    activeBackend: er.backend,
    getSettings,
    update,
    testTools: () => {
      if (!session || !session.sim) return null;
      const s = session.sim.state;
      const sp = session.spawn!;
      return {
        destinations: TEST_DESTINATIONS.map((d) => ({ id: d.id, label: d.label })),
        info: `Position ${Math.round(s.x)}, ${Math.round(s.z)} · point d'apparition ${Math.round(sp.x)}, ${Math.round(sp.z)} (le monde fait 16 × 16 km).`,
        onTeleport: (id: string) => {
          session?.teleport(id);
          show('pause');
          toast('Téléportation effectuée : reprenez la partie.');
        },
        onKit: () => {
          const n = session?.giveTestKit() ?? 0;
          show('pause');
          toast(n === 7 ? 'Jeu d’outils reçu : regardez dans le sac.' : `Jeu d’outils : ${n} objet(s) reçu(s), le reste ne rentre pas.`);
        },
        onBuildKit: () => {
          const n = session?.giveBuildKit() ?? 0;
          show('pause');
          toast(`Matériaux posés à côté de vous (${n} objets) ; cordes, herbes et clous dans le sac. Ouvrez le sac, onglet « Construire ».`);
        },
        species: (['impala', 'phacochere', 'babouin', 'elephant', 'hyene', 'leopard', 'crocodile'] as SpeciesId[]).map((id) => ({ id, label: SPECIES[id].plural.replace(/^./, (c) => c.toUpperCase()) })),
        onSpawn: (sp: string) => {
          const n = session?.spawnCreatures(sp as SpeciesId) ?? 0;
          show('pause');
          toast(n ? `${n} ${n > 1 ? SPECIES[sp as SpeciesId].plural : SPECIES[sp as SpeciesId].label} à 25 m devant vous.` : 'Impossible ici.');
        },
        onLake: () => {
          const ok = session?.lakeTest() ?? false;
          show('pause');
          toast(ok ? 'Vous nagez au-dessus des eaux profondes du lac. Nagez, et écoutez…' : 'Impossible.');
        },
      };
    },
  };

  // Sauvegarde de la partie solo dans ce navigateur (position, corps, sac, objets du monde).
  // En multijoueur (phase 8), la référence sera la sauvegarde de l'hôte.
  // L'ancienne clé « baz.pose » (phase 2 : position seule) est encore lue.
  const poseKey = () => `baz.pose.${settings.worldSeed}`;
  const saveKey = () => `baz.save.${settings.worldSeed}`;
  const loadPose = (): Pose | null => {
    try {
      const raw = JSON.parse(localStorage.getItem(poseKey()) ?? 'null') as Pose | null;
      return raw && [raw.x, raw.y, raw.z, raw.yaw, raw.pitch].every((v) => typeof v === 'number' && Number.isFinite(v)) ? raw : null;
    } catch {
      return null;
    }
  };
  const loadSave = (): { yaw: number; pitch: number; sim: unknown } | null => {
    try {
      const raw = JSON.parse(localStorage.getItem(saveKey()) ?? 'null') as { v?: number; yaw?: unknown; pitch?: unknown; sim?: unknown } | null;
      if (!raw || raw.v !== 1 || typeof raw.yaw !== 'number' || typeof raw.pitch !== 'number' || typeof raw.sim !== 'object') return null;
      return { yaw: raw.yaw, pitch: raw.pitch, sim: raw.sim };
    } catch {
      return null;
    }
  };
  const hasSave = () => loadSave() !== null || loadPose() !== null;
  const savePose = () => {
    const data = session?.saveData();
    if (!data) return;
    try {
      localStorage.setItem(saveKey(), JSON.stringify(data));
    } catch {
      // Stockage indisponible ou plein : on repartira de la dernière sauvegarde.
    }
  };
  const clearPose = () => {
    try {
      localStorage.removeItem(poseKey());
      localStorage.removeItem(saveKey());
    } catch {
      // rien à faire
    }
  };
  window.setInterval(() => {
    if (screen === 'game' && session?.sim) savePose();
  }, 5000);

  // Indicateurs temporaires (l'interface sera intégrée à l'univers plus tard).
  const staminaBar = $('#status .bar.stamina');
  const staminaCap = $('#status .bar.stamina .cap');
  const breathBar = $('#status .bar.breath');
  const promptEl = $('#prompt');
  const vignette = $('#vignette');
  const dreadEl = $('#dread');
  const eyelids = $('#eyelids');
  const gestureEl = $('#gesture');
  const downEl = $('#down-screen');
  const giveUpBtn = $<HTMLButtonElement>('#btn-give-up');
  const wakeBtn = $<HTMLButtonElement>('#btn-wake');
  let messageTimer = 0;
  let lastBlur = '';
  const showStatus = (hud: HudState) => {
    const capped = hud.staminaMax < 99;
    staminaBar.hidden = hud.stamina >= hud.staminaMax - 0.5 && !capped && !hud.exhausted;
    staminaBar.classList.toggle('exhausted', hud.exhausted);
    (staminaBar.firstElementChild as HTMLElement).style.transform = `scaleX(${hud.stamina / 100})`;
    staminaCap.style.width = `${Math.max(0, 100 - hud.staminaMax).toFixed(1)}%`;
    breathBar.hidden = hud.breath >= 99.5 && !hud.underwater;
    (breathBar.firstElementChild as HTMLElement).style.transform = `scaleX(${hud.breath / 100})`;
    promptEl.hidden = !hud.prompt;
    promptEl.textContent = hud.prompt ?? '';
    const hurt = hud.health < 60 ? ((60 - hud.health) / 60) * 0.9 : 0;
    vignette.style.opacity = String(Math.max(hurt, hud.bleeding ? 0.35 : 0, hud.strike * 0.85).toFixed(2));
    dreadEl.style.opacity = hud.dread.toFixed(2);
    vignette.classList.toggle('pulse', hud.bleeding);
    eyelids.style.opacity = String(hud.eyelids);
    const blur = hud.blur > 0.05 ? `blur(${(hud.blur * 2.5).toFixed(1)}px)` : '';
    if (blur !== lastBlur) {
      canvas.style.filter = blur;
      lastBlur = blur;
    }
    gestureEl.hidden = !hud.gesture;
    if (hud.gesture) {
      (gestureEl.querySelector('.label') as HTMLElement).textContent = hud.gesture.label;
      (gestureEl.querySelector('.bar span') as HTMLElement).style.transform = `scaleX(${hud.gesture.progress.toFixed(3)})`;
    }
    const wasDown = !downEl.hidden;
    downEl.hidden = !hud.down;
    // À terre ou mort : le curseur est libéré pour pouvoir cliquer « Abandonner ».
    if (hud.down && hud.down.kind !== 'endormi' && input.locked) input.exitPointerLock();
    if (wasDown !== !downEl.hidden) updateHint();
    if (hud.down) {
      downEl.className = hud.down.kind === 'mort' ? 'dead' : hud.down.kind === 'endormi' ? 'asleep' : '';
      (downEl.querySelector('.title') as HTMLElement).textContent = hud.down.title;
      (downEl.querySelector('.detail') as HTMLElement).textContent = hud.down.detail;
      giveUpBtn.hidden = !hud.down.canGiveUp;
      wakeBtn.hidden = hud.down.kind !== 'endormi';
    }
  };
  giveUpBtn.addEventListener('click', () => session?.giveUp());
  // Au doigt, l'écran de sommeil couvre le joystick : un bouton permet de se réveiller.
  wakeBtn.addEventListener('click', () => session?.act({ type: 'lever' }));
  const showMessage = (text: string, tone: 'info' | 'alerte' | 'danger') => {
    if (!text) return;
    const el = $('#message');
    el.textContent = text;
    el.className = tone;
    el.hidden = false;
    window.clearTimeout(messageTimer);
    messageTimer = window.setTimeout(() => (el.hidden = true), Math.min(9000, Math.max(tone === 'info' ? 2500 : 4000, text.length * 60)));
  };
  const bagView = new BagView({
    root: $('#bag-view'),
    canvas,
    engine,
    input,
    onClose: () => session?.closeBag(),
    onMessage: showMessage,
    onBuild: (plan) => session?.startBuild(plan),
  });
  const rotateHint = $('#rotate-hint');
  const updateRotateHint = () => {
    rotateHint.hidden = !(device.touch && screen === 'game' && window.innerHeight > window.innerWidth);
  };
  window.addEventListener('resize', updateRotateHint);

  function refreshHome(): void {
    const q = effectiveQuality(settings, autoPreset);
    $('#home-world').textContent =
      settings.worldSeed === null
        ? 'Aucun monde pour l’instant : « Jouer » en crée un (16 × 16 km, vous apparaissez à un endroit au hasard).'
        : `Monde n° ${settings.worldSeed}${hasSave() ? ' · « Jouer » reprend votre partie' : ''}.`;
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
    hint.hidden = !(screen === 'game' && !device.touch && !input.locked && !bagView.isOpen && $('#down-screen').hidden);
  };

  const sessionOpts: SessionOptions = {
    engine,
    backend: er.backend,
    device,
    input,
    autoPreset,
    getSettings,
    sound,
    creatureCap: device.mobile ? 24 : 40,
    get fauna() {
      return settings.fauna;
    },
    onTogglePerf: () => update({ showPerf: !settings.showPerf }),
    onStatus: showStatus,
    onMessage: showMessage,
    onHud: (text) => {
      const el = $('#perf');
      el.hidden = text === null;
      if (text !== null) el.textContent = text;
    },
    bag: bagView,
    onBuildMode: (active) => {
      // Mode construction : les boutons tactiles changent de rôle.
      const label = (name: string, text: string) => {
        const el = document.querySelector<HTMLElement>(`[data-touch="${name}"]`);
        if (el) el.textContent = text;
      };
      label('throw', active ? 'Poser' : 'Lancer');
      label('interact', active ? 'Tourner' : 'Prendre');
      label('use', active ? 'Annuler' : 'Utiliser');
    },
    onBagChange: (open) => {
      $('#crosshair').hidden = open;
      if (open) {
        input.exitPointerLock();
        touch.show(false);
      } else {
        if (!device.touch && screen === 'game' && !session?.paused) input.requestPointerLock();
        touch.show(device.touch && screen === 'game' && !session?.paused);
      }
      updateHint();
    },
    onPauseChange: (paused) => {
      if (paused) {
        session?.closeBag();
        savePose();
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
    const down = session?.sim ? session.sim.vitals.state !== 'eveille' : false;
    if (!locked && session && screen === 'game' && !session.paused && !bagView.isOpen && !down) {
      session.notePointerUnlock();
      session.setPaused(true);
    }
    updateHint();
  };

  canvas.addEventListener('click', () => {
    if (screen === 'game' && session && !session.paused && !device.touch && !bagView.isOpen) input.requestPointerLock();
  });

  document.addEventListener('visibilitychange', () => {
    if (document.hidden && session && screen === 'game') session.setPaused(true);
    if (document.hidden) savePose();
  });

  function enterGame(): void {
    show('game');
    $('#hud').hidden = false;
    input.gameActive = true;
    input.clear();
    touch.show(device.touch);
    if (!device.touch) input.requestPointerLock();
    updateHint();
    updateRotateHint();
  }

  function leaveSession(): void {
    savePose();
    session?.closeBag();
    session?.dispose();
    session = null;
    input.gameActive = false;
    input.exitPointerLock();
    touch.show(false);
    $('#hud').hidden = true;
    $('#perf').hidden = true;
    $('#down-screen').hidden = true;
    $('#message').hidden = true;
    canvas.style.filter = '';
    lastBlur = '';
    refreshHome();
    show('home');
    updateRotateHint();
  }

  async function play(): Promise<void> {
    if (settings.worldSeed === null) update({ worldSeed: randomSeed() });
    if (settings.spawnSeed === null) update({ spawnSeed: randomSeed() });
    show('loading');
    setLoading('Création du monde…');
    await nextFrame();
    try {
      const save = loadSave();
      const legacy = save ? null : loadPose();
      session = await GameSession.createPlay(sessionOpts, settings.worldSeed!, settings.spawnSeed!, legacy, setLoading, save?.sim);
      if (save) {
        session.yaw = save.yaw;
        session.pitch = save.pitch;
      }
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
    if (settings.worldSeed !== null && !confirm('Créer un nouveau monde ? Le monde actuel et votre partie seront remplacés.')) return;
    clearPose();
    update({ worldSeed: randomSeed(), spawnSeed: randomSeed() });
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
        spawn: session.spawn,
        props: session.sim ? session.sim.props.views().map((v) => ({ id: v.id, kind: v.kind, x: v.x, y: v.y, z: v.z, held: v.held })) : [],
        held: session.sim?.props.held ?? null,
        target: session.sim ? session.sim.props.target(session.sim.state, session.yaw, session.pitch) : null,
        biome: session.sim ? session.terrain.sampleInto(session.sim.state.x, session.sim.state.z).biome : null,
        jobsWorkers: session.jobs.usesWorkers,
        meshes: session.scene.meshes.length,
      },
    teleport: (id: string) => session?.teleport(id) ?? false,
    testKit: () => session?.giveTestKit() ?? 0,
    buildKit: () => session?.giveBuildKit() ?? 0,
    /** Simulation complète (diagnostic). */
    sim: () => session?.sim ?? null,
    /** Oriente le regard vers un point (tests). */
    lookAt: (x: number, y: number, z: number) => {
      const s = session?.sim?.state;
      if (!session || !s) return;
      const eyeY = s.y + (s.crouched ? 1.0 : 1.62);
      const dx = x - s.x;
      const dz = z - s.z;
      session.yaw = Math.atan2(dx, dz);
      session.pitch = Math.atan2(eyeY - y, Math.hypot(dx, dz));
    },
    /** Place le joueur à des coordonnées précises (tests). */
    place: (x: number, z: number) => {
      const sim = session?.sim;
      if (!sim) return;
      sim.teleport(x, sim.terrain.heightAt(x, z) + 0.2, z);
    },
    input: () => ({ move: { ...input.move }, locked: input.locked, lastDevice: input.lastDevice, touchVisible: touch.visible }),
    /** Corps, inventaire et geste en cours (copies). */
    body: () => {
      const sim = session?.sim;
      if (!sim) return null;
      return JSON.parse(
        JSON.stringify({
          vitals: sim.vitals,
          inventory: sim.inventory,
          gesture: sim.gesture,
          dead: sim.dead,
          deaths: sim.deaths,
          respawnPoint: sim.respawnPoint,
          lastBody: sim.lastBody,
          held: sim.props.held,
          state: { staminaMax: sim.state.staminaMax, speedCap: sim.state.speedCap, restrict: sim.state.restrict, loadKg: sim.state.loadKg },
        }),
      );
    },
    /** Plan de travail, recette reconnue, carnet, feux et monde (copies). */
    craft: () => {
      const sim = session?.sim;
      if (!sim) return null;
      const info = sim.benchRecipe();
      return JSON.parse(
        JSON.stringify({
          bench: sim.inventory.bench,
          recipe: info ? { id: info.recipe.id, label: info.recipe.label, step: info.step, steps: info.recipe.steps.length, known: info.known } : null,
          knowledge: sim.knowledge,
          gesture: sim.gesture,
          time: sim.time,
          fires: sim.props.fires().map((f) => ({ id: f.def.id, x: f.def.x, y: f.def.y, z: f.def.z, ...f.fire })),
          hint: sim.useHint(),
        }),
      );
    },
    act: (a: unknown) => session?.act(a as Parameters<GameSession['act']>[0]) ?? null,
    /** Constructions, chantiers, plans connus, mode construction (copies). */
    build: () => {
      const sim = session?.sim;
      if (!sim || !session) return null;
      return JSON.parse(
        JSON.stringify({
          structures: sim.build.structures.map((st) => ({ id: st.id, x: st.x, y: st.y, z: st.z, yaw: st.yaw, pieces: st.pieces })),
          sites: sim.build.sites,
          plans: sim.knowledge.plans,
          mode: session.buildPlan,
          turn: session.buildTurn,
          preview: session.buildPlan ? sim.previewPlan(session.buildPlan, session.buildTurn) : null,
          colliders: sim.structPhys.count,
        }),
      );
    },
    startBuild: (plan: string) => session?.startBuild(plan as Parameters<GameSession['startBuild']>[0]),
    /** Créatures proches, groupes, prise en cours (copies). */
    creatures: () => {
      const sim = session?.sim;
      if (!sim) return null;
      return JSON.parse(
        JSON.stringify({
          list: sim.creatureViews(),
          grab: sim.fauna.grab,
          trapped: sim.trappedIn,
          count: sim.fauna.count,
          enabled: sim.fauna.enabled,
          carcasses: sim.props.views().filter((v) => v.kind === 'carcasse').map((v) => ({ id: v.id, sp: v.sp, meat: v.meat, x: v.x, y: v.y, z: v.z })),
          ombre: [...sim.fauna.groups.values()].filter((g) => g.sp === 'ombre').map((g) => ({ attention: g.attention, members: g.members.length, home: g.home })),
          soundRunning: sound.running,
        }),
      );
    },
    spawnCreatures: (sp: string, distance = 25, n?: number) => session?.spawnCreatures(sp as SpeciesId, distance, n) ?? 0,
    lakeTest: () => session?.lakeTest() ?? false,
    stopBuild: () => session?.stopBuild(),
    bag: () => bagView.debug(),
    bagRun: (label: string) => bagView.run(label),
    openBag: (prop: string | null = null) => session?.openBag(prop),
    closeBag: () => session?.closeBag(),
    giveUp: () => session?.giveUp(),
    save: () => {
      savePose();
      return localStorage.getItem(saveKey());
    },
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
