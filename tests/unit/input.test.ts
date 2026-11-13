// Commandes : un bouton maintenu pendant l'ouverture du sac (ou la pause) ne doit pas compter comme un
// nouvel appui. Avant la correction, Y maintenu sur la manette ouvrait et refermait le sac à chaque image.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { InputManager } from '../../src/client/input/input-manager';
import { defaultSettings } from '../../src/client/settings';

type Listener = (e: unknown) => void;

function fakeTarget() {
  const listeners = new Map<string, Listener[]>();
  return {
    listeners,
    addEventListener: (type: string, fn: Listener) => listeners.set(type, [...(listeners.get(type) ?? []), fn]),
    fire: (type: string, e: unknown) => {
      for (const fn of listeners.get(type) ?? []) fn(e);
    },
  };
}

const button = (pressed: boolean) => ({ pressed, touched: pressed, value: pressed ? 1 : 0 });

describe('commandes : boutons maintenus pendant un changement d’écran', () => {
  let win: ReturnType<typeof fakeTarget>;
  let pad: { id: string; connected: boolean; axes: number[]; buttons: ReturnType<typeof button>[] };
  let input: InputManager;
  const settings = defaultSettings();
  const frame = () => input.update(1 / 60);
  const key = (type: 'keydown' | 'keyup', code: string, repeat = false) =>
    win.fire(type, { code, key: code, repeat, target: null, shiftKey: false, altKey: false, ctrlKey: false, metaKey: false, preventDefault() {}, stopPropagation() {} });

  beforeEach(() => {
    win = fakeTarget();
    const doc = { ...fakeTarget(), pointerLockElement: null };
    pad = { id: 'Manette de test', connected: true, axes: [0, 0, 0, 0], buttons: Array.from({ length: 17 }, () => button(false)) };
    vi.stubGlobal('window', win);
    vi.stubGlobal('document', doc);
    vi.stubGlobal('navigator', { getGamepads: () => [pad, null, null, null] });
    const canvas = fakeTarget() as unknown as HTMLCanvasElement;
    input = new InputManager(canvas, () => settings);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('manette : Y maintenu après l’ouverture du sac ne le referme pas ; un nouvel appui, si', () => {
    pad.buttons[3] = button(true);
    frame();
    expect(input.pressed('bag')).toBe(true);
    input.clear(); // le jeu ouvre le sac
    for (let i = 0; i < 10; i++) {
      frame();
      expect(input.pressed('bag')).toBe(false);
      expect(input.isDown('bag')).toBe(false);
    }
    pad.buttons[3] = button(false);
    frame();
    expect(input.pressed('bag')).toBe(false);
    pad.buttons[3] = button(true);
    frame();
    expect(input.pressed('bag')).toBe(true);
  });

  it('manette : les autres boutons restent utilisables pendant qu’un bouton est ignoré', () => {
    pad.buttons[9] = button(true);
    frame();
    expect(input.pressed('pause')).toBe(true);
    input.clear(); // pause
    pad.buttons[0] = button(true);
    frame();
    expect(input.pressed('pause')).toBe(false);
    expect(input.pressed('jump')).toBe(true);
  });

  it('clavier : la répétition automatique d’une touche maintenue ne rouvre pas le sac', () => {
    key('keydown', 'Tab');
    frame();
    expect(input.pressed('bag')).toBe(true);
    input.clear();
    frame();
    key('keydown', 'Tab', true);
    frame();
    expect(input.pressed('bag')).toBe(false);
    key('keydown', 'Tab', true);
    frame();
    expect(input.pressed('bag')).toBe(false);
    key('keyup', 'Tab');
    frame();
    key('keydown', 'Tab');
    frame();
    expect(input.pressed('bag')).toBe(true);
  });

  it('clavier : un appui bref entre deux images compte toujours', () => {
    key('keydown', 'KeyI');
    key('keyup', 'KeyI');
    frame();
    expect(input.pressed('bag')).toBe(true);
    frame();
    expect(input.pressed('bag')).toBe(false);
  });
});
