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
import { type FrameKind, uprightness } from '../shared/vehicles';
import { HostSession, joinWorld, loadIdentity, saveIdentity } from './net/multiplayer';
import { readRecoveryKey, recoveryKey } from '../shared/net-crypto';
import { ACCESS_LABELS, PERMS, PERM_LABELS, ROLE_LABELS, type Role } from '../shared/permissions';
import { formatWorldCode, normalizeWorldCode } from '../shared/worldcode';

/** Outils de test : véhicules prêts à l'emploi. */
const VEHICLE_TOOLS: Array<{ id: string; label: string; frame: FrameKind; steam: boolean }> = [
  { id: 'chariot_bras', label: 'Chariot à bras', frame: 'chariot_bras', steam: false },
  { id: 'chariot_vapeur', label: 'Chariot à vapeur (machine en pression)', frame: 'chariot', steam: true },
  { id: 'chariot', label: 'Chariot sans machine', frame: 'chariot', steam: false },
  { id: 'radeau', label: 'Radeau (à la pagaie)', frame: 'radeau', steam: false },
  { id: 'radeau_vapeur', label: 'Radeau à vapeur (roue à aubes)', frame: 'radeau', steam: true },
  { id: 'pirogue', label: 'Pirogue (mukoro)', frame: 'pirogue', steam: false },
];
import { renderSettings } from './ui/settings-panel';

type ScreenName = 'loading' | 'home' | 'game' | 'pause' | 'settings' | 'bench' | 'join' | 'players';

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
  join: $('#screen-join'),
  players: $('#screen-players'),
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
        vehicles: VEHICLE_TOOLS.map((v) => ({ id: v.id, label: v.label })),
        onVehicle: (id: string) => {
          const t = VEHICLE_TOOLS.find((v) => v.id === id);
          const made = t ? (session?.spawnVehicle(t.frame, t.steam) ?? null) : null;
          show('pause');
          toast(made ? `${t!.label} devant vous : Prendre pour l’ouvrir, puis monter ou pousser.` : 'Impossible ici.');
        },
        onVehicleKit: () => {
          session?.giveVehicleKit();
          show('pause');
          toast('Pièces, fer et outils reçus ; tous les plans de véhicules et de machines sont connus (onglet « Construire »).');
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
  const vehicleEl = $('#vehicle-hud');
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
    vehicleEl.hidden = !hud.vehicle;
    if (hud.vehicle && vehicleEl.textContent !== hud.vehicle) vehicleEl.textContent = hud.vehicle;
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
        refreshPauseMenu();
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
    const net = session?.net;
    if (net?.kind === 'host') void net.host.close();
    else if (net?.kind === 'client') net.client.leave();
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

  // ——— Multijoueur (phase 8) ———

  const identity = { current: loadIdentity() };
  const pseudo = (): string => {
    try {
      return localStorage.getItem('baz.pseudo') ?? '';
    } catch {
      return '';
    }
  };
  const setPseudo = (name: string) => {
    try {
      localStorage.setItem('baz.pseudo', name);
    } catch {
      // stockage indisponible
    }
  };

  const showCode = (c: string) => formatWorldCode(normalizeWorldCode(c) ?? c);

  // On quitte la page : l'hôte ferme proprement son monde, le joueur prévient l'hôte.
  window.addEventListener('pagehide', () => {
    const net = session?.net;
    if (net?.kind === 'client') net.client.leave();
    else if (net?.kind === 'host') net.host.server.close();
  });

  /** Ouvre le monde de la partie en cours aux autres joueurs (l'hôte joue en même temps). */
  async function openWorld(): Promise<boolean> {
    if (!session?.sim || session.net) return false;
    const name = pseudo() || 'Hôte';
    session.sim.local.name = name;
    const s = session;
    try {
      const host = await HostSession.open(s.sim!, settings.worldSeed!, identity.current, name, () => ({ yaw: s.yaw, pitch: s.pitch }), (text) => toast(text, 5000));
      s.net = { kind: 'host', host };
      void host.backup();
      refreshPauseMenu();
      toast(`Monde ouvert. Code : ${showCode(host.meta.code)} — donnez-le aux joueurs (menu Pause → Joueurs).`, 9000);
      return true;
    } catch (e) {
      toast(`Impossible d’ouvrir le monde : ${e instanceof Error ? e.message : String(e)}`, 8000);
      return false;
    }
  }

  function refreshPauseMenu(): void {
    const net = session?.net ?? null;
    $('#btn-players').hidden = !net;
    $('#btn-open-world').hidden = !!net || !session?.sim;
    $('#pause-note').textContent =
      net?.kind === 'client'
        ? 'Vous jouez dans le monde d’un hôte : c’est lui qui le sauvegarde. Votre personnage vous y attendra.'
        : net?.kind === 'host'
          ? 'Votre monde est ouvert : il continue pour les autres joueurs pendant la pause. Il est sauvegardé dans ce navigateur (et toutes les 15 s en sauvegarde de sécurité).'
          : 'Votre partie (position, état du corps, sac, objets ramassés ou déplacés) est enregistrée dans ce navigateur.';
  }

  function openJoin(): void {
    ($('#join-name') as HTMLInputElement).value = pseudo();
    $('#join-status').textContent = '';
    $('#join-recovery').textContent = recoveryKey(identity.current);
    show('join');
  }

  async function joinGame(codeText: string, nameText: string): Promise<boolean> {
    const status = $('#join-status');
    const code = normalizeWorldCode(codeText);
    const name = nameText.trim();
    if (!code) {
      status.textContent = 'Ce code n’est pas valide : 16 caractères (lettres et chiffres), par exemple ABCD-EFGH-JKLM-NPQR.';
      return false;
    }
    if (!name) {
      status.textContent = 'Choisissez un pseudonyme.';
      return false;
    }
    setPseudo(name);
    ($('#btn-join-go') as HTMLButtonElement).disabled = true;
    try {
      const { client, welcome } = await joinWorld(code, name, identity.current, (t) => (status.textContent = t));
      status.textContent = 'Chargement du monde…';
      show('loading');
      session = await GameSession.createRemote(sessionOpts, welcome, client, setLoading);
      client.onStop = (text) => {
        if (session?.net?.kind !== 'client' || session.net.client !== client) return;
        leaveSession();
        toast(text, 9000);
      };
      enterGame();
      session.start();
      refreshPauseMenu();
      toast(`Bienvenue dans « ${welcome.world.name} » (${ROLE_LABELS[welcome.you.role]}).`, 6000);
      return true;
    } catch (e) {
      show('join');
      status.textContent = e instanceof Error ? e.message : String(e);
      return false;
    } finally {
      ($('#btn-join-go') as HTMLButtonElement).disabled = false;
    }
  }

  const el = <K extends keyof HTMLElementTagNameMap>(tag: K, text = '', cls = ''): HTMLElementTagNameMap[K] => {
    const e = document.createElement(tag);
    if (text) e.textContent = text;
    if (cls) e.className = cls;
    return e;
  };

  /** Panneau « Joueurs » : code du monde, joueurs, rôles et droits, règles, sauvegardes (hôte) ; identité. */
  function renderPlayers(): void {
    const body = $('#players-body');
    body.replaceChildren();
    const net = session?.net;
    if (!net) return;
    if (net.kind === 'host') {
      const h = net.host;
      const srv = h.server;
      body.append(el('h3', 'Code du monde'), el('code', showCode(h.meta.code), 'world-code'));
      const copy = el('button', 'Copier le code');
      copy.type = 'button';
      copy.onclick = async () => toast((await copyText(showCode(h.meta.code))) ? 'Code copié.' : 'Copie impossible : recopiez-le à la main.');
      const rowB = el('div', '', 'menu row-buttons');
      rowB.append(copy);
      body.append(rowB);
      body.append(el('p', `Mise en relation : ${h.relays > 0 ? `${h.relays} intermédiaire(s) joignable(s)` : 'aucun intermédiaire public joignable pour l’instant (seuls les onglets de ce navigateur peuvent rejoindre)'}. Les joueurs entrent ce code dans « Rejoindre un monde ».`, 'note'));
      body.append(el('h3', `Joueurs (${srv.connectedCount + 1} / 10 en ligne)`));
      const list = el('ul', '', 'player-list');
      for (const r of srv.roster()) {
        const li = el('li');
        const who = el('span', '', 'who');
        const dot = el('span', '', `dot${r.online ? ' on' : ''}`);
        who.append(dot, document.createTextNode(`${r.name || '(sans nom)'}${r.role === 'hote' ? ' — vous' : ''}`));
        li.append(who);
        if (r.role !== 'hote') {
          const sel = el('select');
          for (const role of ['membre', 'invite'] as Role[]) {
            const o = el('option', ROLE_LABELS[role]);
            o.value = role;
            o.selected = r.role === role;
            sel.append(o);
          }
          sel.onchange = () => {
            srv.setRole(r.id, sel.value as Role);
            renderPlayers();
          };
          li.append(sel);
          if (r.online) {
            const kick = el('button', 'Retirer');
            kick.type = 'button';
            kick.onclick = () => {
              if (confirm(`Retirer ${r.name} de la partie ? Il pourra revenir avec le code.`)) {
                srv.kick(r.id);
                renderPlayers();
              }
            };
            li.append(kick);
          }
          const m = h.meta.members.find((x) => x.id === r.id);
          if (m) {
            const grid = el('div', '', 'perm-grid');
            for (const p of PERMS) {
              if (p === 'gerer') continue;
              const lab = el('label');
              const cb = el('input');
              cb.type = 'checkbox';
              cb.checked = m.overrides[p] ?? (p === 'construire' || p === 'ouvrir_autres' || p === 'conduire_autres' ? m.role === 'membre' : false);
              cb.onchange = () => srv.setOverride(r.id, p, cb.checked);
              lab.append(cb, document.createTextNode(` ${PERM_LABELS[p]}`));
              grid.append(lab);
            }
            li.append(grid);
          }
        }
        list.append(li);
      }
      body.append(list);
      body.append(el('h3', 'Règles du monde'));
      const rules = srv.rules;
      const rule = (label: string, input: HTMLElement) => {
        const l = el('label', '', 'field');
        l.append(document.createTextNode(label), input);
        body.append(l);
      };
      const away = el('select');
      for (const sec of [0, 30, 120, 300, 900]) {
        const o = el('option', sec === 0 ? 'il disparaît aussitôt' : sec < 60 ? `${sec} secondes` : `${sec / 60} minutes`);
        o.value = String(sec);
        o.selected = rules.awaySeconds === sec;
        away.append(o);
      }
      away.onchange = () => srv.setRules({ ...rules, awaySeconds: Number(away.value) });
      rule('Un joueur déconnecté reste endormi dans le monde pendant', away);
      const base = el('select');
      for (const [v, t] of [['1', 'protégé s’il est près de ses constructions'], ['0', 'vulnérable partout']] as const) {
        const o = el('option', t);
        o.value = v;
        o.selected = rules.protectAtBase === (v === '1');
        base.append(o);
      }
      base.onchange = () => srv.setRules({ ...rules, protectAtBase: base.value === '1' });
      rule('Pendant ce temps, il est', base);
      const def = el('select');
      for (const role of ['membre', 'invite'] as Role[]) {
        const o = el('option', ROLE_LABELS[role]);
        o.value = role;
        o.selected = rules.defaultRole === role;
        def.append(o);
      }
      def.onchange = () => srv.setRules({ ...rules, defaultRole: def.value as Role });
      rule('Rôle d’un nouveau joueur', def);
      body.append(el('p', `Ce que chacun construit lui appartient. Son propriétaire en règle l’accès (${ACCESS_LABELS.prive}, ${ACCESS_LABELS.partage}, ${ACCESS_LABELS.public}) depuis le panneau de la construction, du coffre ou du véhicule.`, 'note'));
      body.append(el('h3', 'Sauvegardes de sécurité'));
      const saves = el('ul', '', 'player-list');
      body.append(saves);
      void h.listBackups().then((list2) => {
        if (!list2.length) saves.append(el('li', 'Aucune pour l’instant (une toutes les 15 secondes).'));
        for (const b of list2) {
          const li = el('li');
          li.append(el('span', `${new Date(b.savedAt).toLocaleString('fr-FR')}${b.valid ? '' : ' — corrompue'}`, 'who'));
          if (b.valid) {
            const btn = el('button', 'Restaurer');
            btn.type = 'button';
            btn.onclick = () => void restoreBackup(h, b.gen);
            li.append(btn);
          }
          saves.append(li);
        }
      });
      if (h.backupError) body.append(el('p', `Dernière sauvegarde de sécurité impossible : ${h.backupError}`, 'note'));
    } else {
      const c = net.client;
      body.append(el('p', `Monde « ${c.welcome?.world.name ?? ''} » — vous êtes ${ROLE_LABELS[c.role]}.`));
      if (c.perms) {
        const ul = el('ul', '', 'player-list');
        for (const p of PERMS) ul.append(el('li', `${c.perms[p] ? '✔' : '✘'} ${PERM_LABELS[p]}`));
        body.append(el('h3', 'Vos droits'), ul);
      }
      body.append(el('h3', 'Joueurs'));
      const list = el('ul', '', 'player-list');
      for (const r of c.roster) {
        const li = el('li');
        const who = el('span', '', 'who');
        who.append(el('span', '', `dot${r.online ? ' on' : ''}`), document.createTextNode(`${r.name || '(sans nom)'} — ${ROLE_LABELS[r.role]}`));
        li.append(who);
        list.append(li);
      }
      body.append(list);
      body.append(el('p', `Liaison avec l’hôte : ${c.rtt ? `${c.rtt} ms aller-retour` : 'mesure en cours'}.`, 'note'));
      body.append(el('h3', 'Mon identité'), el('p', 'Clé de récupération (pour retrouver votre personnage sur un autre appareil). Ne la donnez à personne.', 'note'), el('code', recoveryKey(identity.current), 'key'));
    }
  }

  async function restoreBackup(h: HostSession, gen: number): Promise<void> {
    if (!confirm('Restaurer cette sauvegarde ? La partie reprendra à ce moment-là pour tout le monde (les joueurs connectés seront déconnectés).')) return;
    const data = await h.backupData(gen);
    if (!data?.sim) {
      toast('Cette sauvegarde est illisible.');
      return;
    }
    leaveSession();
    try {
      localStorage.setItem(saveKey(), JSON.stringify({ v: 1, yaw: data.view?.yaw ?? 0, pitch: data.view?.pitch ?? 0, sim: data.sim }));
    } catch {
      toast('Écriture impossible dans ce navigateur.');
      return;
    }
    await play();
    await openWorld();
    toast('Sauvegarde restaurée, monde rouvert.', 6000);
  }

  $('#btn-host').addEventListener('click', async () => {
    if (device.touch) requestImmersive();
    await play();
    if (session?.sim) await openWorld();
  });
  $('#btn-join').addEventListener('click', () => openJoin());
  $('#btn-join-cancel').addEventListener('click', () => show('home'));
  $('#btn-join-go').addEventListener('click', () => void joinGame(($('#join-code') as HTMLInputElement).value, ($('#join-name') as HTMLInputElement).value));
  $('#btn-copy-recovery').addEventListener('click', async () => toast((await copyText(recoveryKey(identity.current))) ? 'Clé copiée. Gardez-la secrète.' : 'Copie impossible : sélectionnez la clé à la main.'));
  $('#btn-import-recovery').addEventListener('click', () => {
    const idn = readRecoveryKey(($('#join-import') as HTMLInputElement).value);
    if (!idn) {
      $('#join-status').textContent = 'Cette clé de récupération n’est pas valide.';
      return;
    }
    if (!confirm('Remplacer l’identité de ce navigateur par celle de cette clé ? (Gardez une copie de l’ancienne clé si vous en avez besoin.)')) return;
    identity.current = idn;
    saveIdentity(idn);
    $('#join-recovery').textContent = recoveryKey(idn);
    $('#join-status').textContent = 'Identité reprise : vous retrouverez votre personnage chez les hôtes qui vous connaissent.';
  });
  $('#btn-players').addEventListener('click', () => {
    renderPlayers();
    show('players');
  });
  $('#btn-players-close').addEventListener('click', () => show(session ? 'pause' : 'home'));
  $('#btn-open-world').addEventListener('click', async () => {
    if (await openWorld()) {
      renderPlayers();
      show('players');
    }
  });

  // Hôte, onglet caché : le navigateur ne dessine plus d'images ; une horloge dans un worker (non ralentie)
  // fait avancer le monde pour les autres joueurs.
  const pulse = new Worker(URL.createObjectURL(new Blob(['setInterval(() => postMessage(0), 33);'], { type: 'text/javascript' })));
  let lastPulse = performance.now();
  pulse.onmessage = () => {
    const now = performance.now();
    const ms = now - lastPulse;
    lastPulse = now;
    if (document.hidden && session?.net?.kind === 'host') session.stepBackground(ms);
    else if (document.hidden && session?.net?.kind === 'client') session.net.client.keepAlive();
  };

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
    /** Phase 8 : état du multijoueur (tests). */
    net: () => {
      const n = session?.net;
      if (!n || !session?.sim) return null;
      if (n.kind === 'host')
        return { kind: 'host', code: n.host.meta.code, connected: n.host.server.connectedCount, roster: n.host.server.roster(), relays: n.host.relays, slots: session.sim.players.size, lastBackupAt: n.host.lastBackupAt };
      const c = n.client;
      return { kind: 'client', role: c.role, perms: c.perms, rtt: c.rtt, connected: c.connected, roster: c.roster, players: c.players.map((p) => ({ id: p.id, name: p.name, x: p.x, y: p.y, z: p.z })), corrections: session.sim.corrections };
    },
    openWorld: () => openWorld(),
    pause: (on = true) => session?.setPaused(on),
    joinWorld: (code: string, name: string) => joinGame(code, name),
    otherPlayers: () => session?.otherPlayers() ?? [],
    hostSetRole: (id: string, role: Role) => (session?.net?.kind === 'host' ? session.net.host.server.setRole(id, role) : undefined),
    identity: () => identity.current.id,
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
    /** Incline le regard vers le bas (tests, captures). */
    lookDown: (pitch: number) => {
      if (session) session.pitch = pitch;
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
    spawnVehicle: (frame: string, steam = false) => session?.spawnVehicle(frame as FrameKind, steam) ?? null,
    vehicleKit: () => session?.giveVehicleKit() ?? 0,
    /** Sons joués depuis le début, par sorte (phase 7 : véhicules et machines). */
    sounds: () => ({ running: sound.running, counts: { ...sound.counts } }),
    water: () => session?.world.waterStats() ?? null,
    /** Un maillage porte ce nom dans la scène (tests de l'affichage). */
    hasMesh: (name: string) => !!session?.scene.getMeshByName(name),
    wind: () => session?.sim?.wind() ?? null,
    vehicles: () =>
      session?.sim?.vehicles.map((v) => ({ id: v.id, frame: v.frame, x: v.x, y: v.y, z: v.z, hp: v.hp, parts: v.parts.map((p) => ({ ...p })), engine: { ...v.engine }, cargo: (v.cargo.bag ?? []).map((c) => ({ ...c })), upright: uprightness(v) })) ?? [],
    driving: () => (session?.sim?.driving ? { ...session.sim.driving, speed: session.sim.lastDrive?.speed ?? 0, effort: session.sim.effortW } : null),
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
