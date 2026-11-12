// Panneau des réglages : graphismes, commandes (remappables), affichage.

import { ACTIONS, ACTION_LABELS, type Action, addBinding, codeLabel, defaultBindings, removeBinding } from '../input/bindings';
import type { InputManager } from '../input/input-manager';
import { BACKEND_LABELS, type ActiveBackend } from '../render/engine';
import { PRESET_LABELS, PRESET_ORDER, type QualityPreset, type Settings } from '../settings';

export interface SettingsPanelDeps {
  root: HTMLElement;
  input: InputManager;
  autoPreset: QualityPreset;
  activeBackend: ActiveBackend;
  getSettings: () => Settings;
  update: (patch: Partial<Settings>) => void;
}

function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}

function opt(value: string, label: string, selected: boolean): string {
  return `<option value="${esc(value)}"${selected ? ' selected' : ''}>${esc(label)}</option>`;
}

function range(id: string, label: string, value: number, min: number, max: number, step: number, fmt: (v: number) => string): string {
  return `<label class="row"><span>${esc(label)}</span><input type="range" id="${id}" min="${min}" max="${max}" step="${step}" value="${value}"><output for="${id}">${esc(fmt(value))}</output></label>`;
}

function check(id: string, label: string, value: boolean): string {
  return `<label class="row check"><input type="checkbox" id="${id}"${value ? ' checked' : ''}><span>${esc(label)}</span></label>`;
}

const pct = (v: number) => `${Math.round(v * 100)} %`;
const mult = (v: number) => `× ${v.toFixed(1)}`;

export function renderSettings(deps: SettingsPanelDeps, capturingAction: Action | null = null): void {
  const s = deps.getSettings();
  const qualityOptions = [opt('auto', `Automatique (${PRESET_LABELS[deps.autoPreset]})`, s.quality === 'auto'), ...PRESET_ORDER.map((p) => opt(p, PRESET_LABELS[p], s.quality === p))].join('');
  const distances = [2, 3, 4, 5, 7, 9];
  const distanceOptions = [opt('', 'Selon la qualité', s.viewChunks === null), ...distances.map((d) => opt(String(d), `${d * 64} m`, s.viewChunks === d))].join('');
  const backendOptions = [
    opt('auto', 'Automatique (WebGL 2)', s.backend === 'auto'),
    opt('webgl2', 'WebGL 2', s.backend === 'webgl2'),
    opt('webgpu', 'WebGPU (expérimental)', s.backend === 'webgpu'),
  ].join('');
  const wanted = s.backend === 'webgpu' ? 'webgpu' : 'webgl2';
  const needsReload = wanted !== deps.activeBackend;

  const bindingRows = ACTIONS.map((a) => {
    const chips = s.bindings[a]
      .map((c) => `<button type="button" class="chip" data-remove="${a}" data-code="${esc(c)}" title="Retirer">${esc(codeLabel(c, deps.input.layout))} <span aria-hidden="true">✕</span></button>`)
      .join('');
    const adding = capturingAction === a;
    return `<div class="bind"><span class="bind-label">${esc(ACTION_LABELS[a])}</span><span class="chips">${chips || '<em>aucune</em>'}</span><button type="button" class="add${adding ? ' waiting' : ''}" data-add="${a}">${adding ? 'Appuyez sur une touche… (Échap : annuler)' : '+ Ajouter'}</button></div>`;
  }).join('');

  deps.root.innerHTML = `
    <h3>Graphismes</h3>
    <label class="row"><span>Qualité</span><select id="set-quality">${qualityOptions}</select></label>
    <label class="row"><span>Distance d'affichage</span><select id="set-distance">${distanceOptions}</select></label>
    ${range('set-scale', 'Résolution', s.renderScale, 0.5, 1, 0.05, pct)}
    ${check('set-adaptive', 'Baisser la résolution automatiquement si le jeu ralentit', s.adaptiveResolution)}
    ${range('set-fov', 'Champ de vision', s.fov, 50, 100, 1, (v) => `${v}°`)}
    <label class="row"><span>Moteur graphique</span><select id="set-backend">${backendOptions}</select></label>
    <p class="note">Moteur actif : ${esc(BACKEND_LABELS[deps.activeBackend])}.${needsReload ? ' <button type="button" id="set-reload">Recharger pour appliquer</button>' : ''} L'anticrénelage dépend de la qualité et s'applique au prochain démarrage.</p>
    <h3>Commandes</h3>
    ${range('set-mouse', 'Sensibilité de la souris', s.mouseSensitivity, 0.2, 3, 0.1, mult)}
    ${range('set-touch', 'Sensibilité tactile', s.touchSensitivity, 0.2, 3, 0.1, mult)}
    ${range('set-pad', 'Sensibilité de la manette', s.gamepadSensitivity, 0.2, 3, 0.1, mult)}
    ${check('set-invert', "Inverser l'axe vertical du regard", s.invertY)}
    <p class="note">Les touches sont repérées par leur position : sur un clavier AZERTY, « Avancer » est la touche Z. Les sticks de la manette servent toujours au déplacement (gauche) et au regard (droit).</p>
    <div class="binds">${bindingRows}</div>
    <button type="button" id="set-reset-binds">Réinitialiser les commandes</button>
    <h3>Affichage</h3>
    ${check('set-perf', 'Afficher les infos de performance (touche F3)', s.showPerf)}
  `;

  const root = deps.root;
  const on = <T extends HTMLElement>(id: string, ev: string, fn: (el: T) => void) => {
    const el = root.querySelector<T>(`#${id}`);
    el?.addEventListener(ev, () => fn(el));
  };
  const live = (id: string, fmt: (v: number) => string, key: keyof Settings) => {
    on<HTMLInputElement>(id, 'input', (el) => {
      const v = Number(el.value);
      const out = root.querySelector(`output[for="${id}"]`);
      if (out) out.textContent = fmt(v);
      deps.update({ [key]: v } as Partial<Settings>);
    });
  };
  on<HTMLSelectElement>('set-quality', 'change', (el) => deps.update({ quality: el.value as Settings['quality'] }));
  on<HTMLSelectElement>('set-distance', 'change', (el) => deps.update({ viewChunks: el.value ? Number(el.value) : null }));
  on<HTMLSelectElement>('set-backend', 'change', (el) => {
    deps.update({ backend: el.value as Settings['backend'] });
    renderSettings(deps);
  });
  root.querySelector('#set-reload')?.addEventListener('click', () => location.reload());
  live('set-scale', pct, 'renderScale');
  live('set-fov', (v) => `${v}°`, 'fov');
  live('set-mouse', mult, 'mouseSensitivity');
  live('set-touch', mult, 'touchSensitivity');
  live('set-pad', mult, 'gamepadSensitivity');
  on<HTMLInputElement>('set-adaptive', 'change', (el) => deps.update({ adaptiveResolution: el.checked }));
  on<HTMLInputElement>('set-invert', 'change', (el) => deps.update({ invertY: el.checked }));
  on<HTMLInputElement>('set-perf', 'change', (el) => deps.update({ showPerf: el.checked }));
  on<HTMLButtonElement>('set-reset-binds', 'click', () => {
    deps.update({ bindings: defaultBindings() });
    renderSettings(deps);
  });
  root.querySelectorAll<HTMLButtonElement>('[data-remove]').forEach((b) =>
    b.addEventListener('click', () => {
      const a = b.dataset.remove as Action;
      deps.update({ bindings: removeBinding(deps.getSettings().bindings, a, b.dataset.code!) });
      renderSettings(deps);
    }),
  );
  root.querySelectorAll<HTMLButtonElement>('[data-add]').forEach((b) =>
    b.addEventListener('click', () => {
      const a = b.dataset.add as Action;
      if (deps.input.capturing) deps.input.cancelCapture();
      renderSettings(deps, a);
      deps.input.captureNext((code) => {
        if (code) deps.update({ bindings: addBinding(deps.getSettings().bindings, a, code) });
        renderSettings(deps);
      });
    }),
  );
}
