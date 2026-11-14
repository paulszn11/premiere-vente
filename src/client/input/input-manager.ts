// Regroupe clavier, souris, manette et tactile en une seule interface :
// un vecteur de déplacement, un mouvement de regard et l'état des actions.

import type { Settings } from '../settings';
import { type Action, ACTIONS } from './bindings';
import type { TouchControls } from './touch-controls';

const PAD_DEADZONE = 0.15;
const MOUSE_RAD_PER_PX = 0.0022;
const TOUCH_RAD_PER_PX = 0.0045;
const PAD_YAW_RATE = 2.8;
const PAD_PITCH_RATE = 2.0;
/** Au-delà, un mouvement de souris (en pixels, pour un seul événement) est considéré comme parasite. */
const MAX_MOUSE_EVENT_PX = 300;

function deadzone(x: number, y: number): [number, number] {
  const len = Math.hypot(x, y);
  if (len < PAD_DEADZONE) return [0, 0];
  const scaled = Math.min(1, (len - PAD_DEADZONE) / (1 - PAD_DEADZONE));
  return [(x / len) * scaled, (y / len) * scaled];
}

function curve(v: number): number {
  return Math.sign(v) * v * v;
}

export type InputDevice = 'keyboard' | 'gamepad' | 'touch';

/** Boutons tactiles dont on détecte l'appui (les autres sont maintenus ou basculés). */
const TOUCH_EDGE_ACTIONS: Action[] = ['jump', 'interact', 'throw', 'use', 'bag'];

export class InputManager {
  /** Déplacement voulu : x = droite, y = avant (longueur ≤ 1). */
  readonly move = { x: 0, y: 0 };
  /** Rotation du regard à appliquer cette image (radians). */
  readonly look = { dx: 0, dy: 0 };
  /** Vrai quand une partie est en cours (les touches du jeu ne font plus défiler la page). */
  gameActive = false;
  lastDevice: InputDevice = 'keyboard';
  gamepadName: string | null = null;
  /** Caractères imprimés sur le clavier de l'utilisateur, appris au fil des frappes. */
  readonly layout = new Map<string, string>();
  touch: TouchControls | null = null;
  onPointerLockChange: ((locked: boolean) => void) | null = null;

  private readonly held = new Set<string>();
  private padCodes = new Set<string>();
  private current = new Set<string>();
  private prev = new Set<string>();
  private edges = new Set<string>();
  private touchPrev = new Set<Action>();
  private touchEdges = new Set<Action>();
  /** Touches appuyées depuis la dernière image, même déjà relâchées (appui bref). */
  private readonly tapped = new Set<string>();
  /**
   * Touches et boutons encore enfoncés au moment d'un clear() (ouverture du sac, pause…) : ils ne
   * comptent plus tant qu'on ne les a pas relâchés. Sinon, un bouton de manette maintenu, relu à chaque
   * image, ou la répétition automatique d'une touche, passerait pour un nouvel appui et refermerait
   * aussitôt ce qu'on vient d'ouvrir.
   */
  private readonly suppressed = new Set<string>();
  private mouseDX = 0;
  private mouseDY = 0;
  private lockedAt = -1e9;
  private capture: ((code: string | null) => void) | null = null;
  private capturePadPrev = new Set<string>();

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly getSettings: () => Settings,
  ) {
    window.addEventListener('keydown', this.onKeyDown, { capture: true });
    window.addEventListener('keyup', this.onKeyUp, { capture: true });
    window.addEventListener('blur', () => this.held.clear());
    document.addEventListener('mousemove', this.onMouseMove);
    document.addEventListener('mousedown', this.onMouseDown);
    window.addEventListener('mouseup', (e) => {
      this.held.delete(`Mouse${e.button}`);
      this.suppressed.delete(`Mouse${e.button}`);
    });
    document.addEventListener('pointerlockchange', () => {
      if (this.locked) this.lockedAt = performance.now();
      this.onPointerLockChange?.(this.locked);
    });
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    const kb = (navigator as Navigator & { keyboard?: { getLayoutMap?: () => Promise<Map<string, string>> } }).keyboard;
    kb?.getLayoutMap?.()
      .then((m) => m.forEach((v, k) => this.layout.set(k, v)))
      .catch(() => undefined);
  }

  get locked(): boolean {
    return document.pointerLockElement === this.canvas;
  }

  get capturing(): boolean {
    return this.capture !== null;
  }

  requestPointerLock(): void {
    if (this.locked) return;
    const fallback = () => {
      try {
        const q = this.canvas.requestPointerLock() as unknown as Promise<void> | undefined;
        if (q && typeof q.catch === 'function') q.catch(() => undefined);
      } catch {
        // Verrouillage du pointeur refusé (par exemple hors d'un geste de l'utilisateur).
      }
    };
    try {
      const p = this.canvas.requestPointerLock({ unadjustedMovement: true });
      if (p && typeof p.catch === 'function') p.catch(fallback);
    } catch {
      fallback();
    }
  }

  exitPointerLock(): void {
    if (this.locked) document.exitPointerLock();
  }

  /** Attend la prochaine touche, clic ou bouton de manette (Échap annule). */
  captureNext(cb: (code: string | null) => void): void {
    this.capturePadPrev = this.readPadButtons();
    this.capture = cb;
    // Surveillance de la manette pendant la capture (fonctionne aussi hors de la boucle de jeu).
    const watch = () => {
      if (this.capture !== cb) return;
      const now = this.readPadButtons();
      for (const c of now) {
        if (!this.capturePadPrev.has(c)) {
          this.finishCapture(c);
          return;
        }
      }
      this.capturePadPrev = now;
      requestAnimationFrame(watch);
    };
    requestAnimationFrame(watch);
  }

  private readPadButtons(): Set<string> {
    const out = new Set<string>();
    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    for (const gp of pads) {
      if (!gp || !gp.connected) continue;
      gp.buttons.forEach((b, i) => {
        if (b.pressed || b.value > 0.5) out.add(`Pad:${i}`);
      });
      break;
    }
    return out;
  }

  cancelCapture(): void {
    this.finishCapture(null);
  }

  private finishCapture(code: string | null): void {
    const cb = this.capture;
    this.capture = null;
    cb?.(code);
  }

  private isBound(code: string): boolean {
    const b = this.getSettings().bindings;
    return ACTIONS.some((a) => b[a].includes(code));
  }

  private readonly onKeyDown = (e: KeyboardEvent): void => {
    if (this.capture) {
      e.preventDefault();
      e.stopPropagation();
      this.finishCapture(e.code === 'Escape' ? null : e.code);
      return;
    }
    const t = e.target as HTMLElement | null;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'SELECT' || t.tagName === 'TEXTAREA')) return;
    if (this.suppressed.has(e.code)) {
      // Touche maintenue depuis un clear() : sa répétition automatique ne compte pas.
      if (e.repeat) {
        if (this.gameActive && this.isBound(e.code)) e.preventDefault();
        return;
      }
      this.suppressed.delete(e.code);
    }
    if (e.key && e.key.length === 1 && !e.shiftKey && !e.altKey && !e.ctrlKey && !e.metaKey) this.layout.set(e.code, e.key);
    if (!e.repeat) this.tapped.add(e.code);
    this.held.add(e.code);
    this.lastDevice = 'keyboard';
    if (this.gameActive && this.isBound(e.code)) e.preventDefault();
  };

  private readonly onKeyUp = (e: KeyboardEvent): void => {
    this.held.delete(e.code);
    this.suppressed.delete(e.code);
  };

  private readonly onMouseMove = (e: MouseEvent): void => {
    if (!this.locked) return;
    // Les navigateurs envoient parfois un saut aberrant juste après le verrouillage du pointeur,
    // ou des pics isolés : on les ignore pour que la caméra ne pivote pas toute seule.
    if (performance.now() - this.lockedAt < 150) return;
    if (Math.abs(e.movementX) > MAX_MOUSE_EVENT_PX || Math.abs(e.movementY) > MAX_MOUSE_EVENT_PX) return;
    this.mouseDX += e.movementX;
    this.mouseDY += e.movementY;
  };

  private readonly onMouseDown = (e: MouseEvent): void => {
    if (this.capture) {
      e.preventDefault();
      this.finishCapture(`Mouse${e.button}`);
      return;
    }
    if (e.target !== this.canvas) return;
    this.suppressed.delete(`Mouse${e.button}`);
    if (this.locked) {
      this.held.add(`Mouse${e.button}`);
      this.tapped.add(`Mouse${e.button}`);
      this.lastDevice = 'keyboard';
    }
  };

  private pollGamepad(): { lx: number; ly: number; rx: number; ry: number } {
    this.padCodes = new Set();
    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    for (const gp of pads) {
      if (!gp || !gp.connected) continue;
      this.gamepadName = gp.id;
      gp.buttons.forEach((b, i) => {
        if (b.pressed || b.value > 0.5) this.padCodes.add(`Pad:${i}`);
      });
      const [lx, ly] = deadzone(gp.axes[0] ?? 0, gp.axes[1] ?? 0);
      const [rx, ry] = deadzone(gp.axes[2] ?? 0, gp.axes[3] ?? 0);
      if (this.padCodes.size > 0 || lx || ly || rx || ry) this.lastDevice = 'gamepad';
      return { lx, ly, rx, ry };
    }
    return { lx: 0, ly: 0, rx: 0, ry: 0 };
  }

  /** À appeler une fois par image, avant de lire move, look, isDown et pressed. */
  update(dt: number): void {
    const s = this.getSettings();
    const pad = this.pollGamepad();
    // Un bouton de manette relâché depuis le dernier clear() compte de nouveau.
    for (const c of this.suppressed) if (c.startsWith('Pad:') && !this.padCodes.has(c)) this.suppressed.delete(c);
    this.current = new Set([...this.held, ...this.padCodes].filter((c) => !this.suppressed.has(c)));
    // Un appui bref (relâché avant cette image) compte quand même pour cette image.
    this.edges = new Set([...[...this.current].filter((c) => !this.prev.has(c)), ...this.tapped]);
    this.tapped.clear();
    this.prev = this.current;
    const tt = this.touch?.visible ? this.touch.takeTaps() : new Set<string>();
    const touchNow = new Set(TOUCH_EDGE_ACTIONS.filter((a) => this.touchHeld(a) || tt.has(a)));
    this.touchEdges = new Set([...touchNow].filter((a) => !this.touchPrev.has(a) || tt.has(a)));
    this.touchPrev = new Set([...touchNow].filter((a) => this.touchHeld(a)));

    const t = this.touch?.visible ? this.touch : null;
    if (t && (t.moveX || t.moveY || t.lookDX || t.lookDY || t.jumpHeld)) this.lastDevice = 'touch';

    let mx = (this.codeDown('right') ? 1 : 0) - (this.codeDown('left') ? 1 : 0) + pad.lx + (t?.moveX ?? 0);
    let my = (this.codeDown('forward') ? 1 : 0) - (this.codeDown('back') ? 1 : 0) - pad.ly + (t?.moveY ?? 0);
    const len = Math.hypot(mx, my);
    if (len > 1) {
      mx /= len;
      my /= len;
    }
    this.move.x = mx;
    this.move.y = my;

    const inv = s.invertY ? -1 : 1;
    const touchLook = t ? t.takeLook() : { dx: 0, dy: 0 };
    this.look.dx = this.mouseDX * MOUSE_RAD_PER_PX * s.mouseSensitivity + curve(pad.rx) * PAD_YAW_RATE * s.gamepadSensitivity * dt + touchLook.dx * TOUCH_RAD_PER_PX * s.touchSensitivity;
    this.look.dy = inv * (this.mouseDY * MOUSE_RAD_PER_PX * s.mouseSensitivity + curve(pad.ry) * PAD_PITCH_RATE * s.gamepadSensitivity * dt + touchLook.dy * TOUCH_RAD_PER_PX * s.touchSensitivity);
    this.mouseDX = 0;
    this.mouseDY = 0;
  }

  private codeDown(action: Action): boolean {
    return this.getSettings().bindings[action].some((c) => this.current.has(c) || this.edges.has(c));
  }

  private touchDown(action: Action): boolean {
    return this.touchHeld(action) || this.touchEdges.has(action);
  }

  private touchHeld(action: Action): boolean {
    const t = this.touch?.visible ? this.touch : null;
    if (!t) return false;
    if (action === 'jump') return t.jumpHeld;
    if (action === 'sprint') return t.sprintOn;
    if (action === 'crouch') return t.crouchOn;
    if (action === 'interact') return t.interactHeld;
    if (action === 'throw') return t.throwHeld;
    if (action === 'use') return t.useHeld;
    if (action === 'bag') return t.bagHeld;
    return false;
  }

  /** Action maintenue (clavier, souris, manette ou bouton tactile). */
  isDown(action: Action): boolean {
    return this.codeDown(action) || this.touchDown(action);
  }

  /** Action déclenchée pendant cette image (appui d'une touche, d'un bouton ou d'un bouton tactile). */
  pressed(action: Action): boolean {
    return this.getSettings().bindings[action].some((c) => this.edges.has(c)) || this.touchEdges.has(action);
  }

  /** Code précis (touche ou bouton de manette) appuyé pendant cette image. */
  codePressed(code: string): boolean {
    return this.edges.has(code);
  }

  /**
   * Oublie les touches maintenues (changement d'écran, sac, pause) : celles encore enfoncées ne
   * compteront qu'après avoir été relâchées puis appuyées de nouveau.
   */
  clear(): void {
    for (const c of this.held) this.suppressed.add(c);
    for (const c of this.readPadButtons()) this.suppressed.add(c);
    this.held.clear();
    this.prev = new Set();
    this.current = new Set();
    this.edges = new Set();
    this.touchEdges = new Set();
    this.touchPrev = new Set();
    this.tapped.clear();
    this.mouseDX = 0;
    this.mouseDY = 0;
    this.touch?.reset();
  }
}
