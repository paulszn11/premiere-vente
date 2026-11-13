// Actions du joueur et touches associées (personnalisables).
// Les codes clavier utilisent la position physique de la touche (event.code) :
// « KeyW » correspond à la touche Z d'un clavier AZERTY.

export const ACTIONS = ['forward', 'back', 'left', 'right', 'jump', 'sprint', 'crouch', 'interact', 'throw', 'use', 'bag', 'rest', 'pocket1', 'pocket2', 'pocket3', 'pocket4', 'pocketNext', 'pause', 'perf'] as const;
export type Action = (typeof ACTIONS)[number];
export type Bindings = Record<Action, string[]>;

export const ACTION_LABELS: Record<Action, string> = {
  forward: 'Avancer',
  back: 'Reculer',
  left: 'Aller à gauche',
  right: 'Aller à droite',
  jump: 'Sauter · grimper (face à une paroi) · monter (nage)',
  sprint: 'Courir · nager vite (maintenir)',
  crouch: "S'accroupir · plonger (nage) · lâcher (escalade)",
  interact: 'Prendre · ramasser · poser · traîner · fouiller',
  throw: "Lancer l'objet porté",
  use: "Utiliser l'objet en main (manger, bander, attelle)",
  bag: 'Sac à dos et état du corps',
  rest: "S'asseoir · dormir (maintenir)",
  pocket1: 'Poche 1',
  pocket2: 'Poche 2',
  pocket3: 'Poche 3',
  pocket4: 'Poche 4',
  pocketNext: 'Poche suivante',
  pause: 'Menu / pause',
  perf: 'Infos de performance',
};

export const MAX_CODES_PER_ACTION = 4;

export function defaultBindings(): Bindings {
  return {
    forward: ['KeyW', 'ArrowUp', 'Pad:12'],
    back: ['KeyS', 'ArrowDown', 'Pad:13'],
    left: ['KeyA', 'ArrowLeft', 'Pad:14'],
    right: ['KeyD', 'ArrowRight', 'Pad:15'],
    jump: ['Space', 'Pad:0'],
    sprint: ['ShiftLeft', 'Pad:10'],
    crouch: ['KeyC', 'Pad:1'],
    interact: ['KeyE', 'Pad:2'],
    throw: ['Mouse0', 'Pad:7'],
    use: ['Mouse2', 'KeyF', 'Pad:6'],
    bag: ['Tab', 'KeyI', 'Pad:3'],
    rest: ['KeyR', 'Pad:4'],
    pocket1: ['Digit1'],
    pocket2: ['Digit2'],
    pocket3: ['Digit3'],
    pocket4: ['Digit4'],
    pocketNext: ['Pad:5'],
    pause: ['Escape', 'Pad:9'],
    perf: ['F3', 'Pad:8'],
  };
}

const CODE_RE = /^(Key[A-Z]|Digit[0-9]|Numpad[0-9A-Za-z]+|F[0-9]{1,2}|Arrow(Up|Down|Left|Right)|Mouse[0-4]|Pad:[0-9]{1,2}|[A-Za-z]{2,20})$/;

/** Vérifie et complète des assignations lues depuis le stockage local. */
export function normalizeBindings(raw: unknown): Bindings {
  const out = defaultBindings();
  if (typeof raw !== 'object' || raw === null) return out;
  const r = raw as Record<string, unknown>;
  for (const a of ACTIONS) {
    const v = r[a];
    if (!Array.isArray(v)) continue;
    const codes = v.filter((c): c is string => typeof c === 'string' && CODE_RE.test(c)).slice(0, MAX_CODES_PER_ACTION);
    out[a] = [...new Set(codes)];
  }
  return out;
}

/** Ajoute un code à une action ; il est retiré des autres actions pour éviter les conflits. */
export function addBinding(b: Bindings, action: Action, code: string): Bindings {
  const out = { ...b } as Bindings;
  for (const a of ACTIONS) out[a] = out[a].filter((c) => c !== code);
  out[action] = [...out[action], code].slice(-MAX_CODES_PER_ACTION);
  return out;
}

export function removeBinding(b: Bindings, action: Action, code: string): Bindings {
  return { ...b, [action]: b[action].filter((c) => c !== code) };
}

const PAD_LABELS = [
  'A / Croix',
  'B / Rond',
  'X / Carré',
  'Y / Triangle',
  'LB / L1',
  'RB / R1',
  'LT / L2',
  'RT / R2',
  'Select / Share',
  'Start / Options',
  'Stick gauche (clic)',
  'Stick droit (clic)',
  'Croix haut',
  'Croix bas',
  'Croix gauche',
  'Croix droite',
];

const NAMED_KEYS: Record<string, string> = {
  Space: 'Espace',
  ShiftLeft: 'Maj gauche',
  ShiftRight: 'Maj droite',
  ControlLeft: 'Ctrl gauche',
  ControlRight: 'Ctrl droite',
  AltLeft: 'Alt',
  AltRight: 'Alt Gr',
  Escape: 'Échap',
  Enter: 'Entrée',
  Tab: 'Tab',
  Backspace: 'Retour arrière',
  ArrowUp: 'Flèche haut',
  ArrowDown: 'Flèche bas',
  ArrowLeft: 'Flèche gauche',
  ArrowRight: 'Flèche droite',
  CapsLock: 'Verr. maj',
};

/**
 * Libellé lisible d'un code. `layout` contient les caractères réellement imprimés sur
 * le clavier de l'utilisateur quand le navigateur sait les fournir.
 */
export function codeLabel(code: string, layout?: ReadonlyMap<string, string>): string {
  if (code.startsWith('Mouse')) {
    const n = Number(code.slice(5));
    return ['Clic gauche', 'Clic molette', 'Clic droit', 'Bouton souris 4', 'Bouton souris 5'][n] ?? code;
  }
  if (code.startsWith('Pad:')) {
    const n = Number(code.slice(4));
    return `Manette ${PAD_LABELS[n] ?? `bouton ${n}`}`;
  }
  const named = NAMED_KEYS[code];
  if (named) return named;
  const printed = layout?.get(code);
  if (printed && printed.trim()) return printed.toUpperCase();
  if (code.startsWith('Key')) return code.slice(3);
  if (code.startsWith('Digit')) return code.slice(5);
  return code;
}
