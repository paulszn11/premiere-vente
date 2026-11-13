// Vue du sac et examen du corps. Le contenu est montré en 3D sur une toile (bag-scene), les
// actions sont de gros boutons (doigt, souris) et tout se pilote aussi au clavier et à la
// manette. Aucun glisser-déposer n'est nécessaire : on touche un objet, puis une action.

import type { AbstractEngine } from '@babylonjs/core/Engines/abstractEngine';
import type { PlayerAction } from '../../shared/actions';
import { type Slot, bagContentMass, bagVolume, BAG_CAPACITY_L, carriedMass, POCKET_COUNT, stackAt, unitMass } from '../../shared/inventory';
import { ITEMS, type ItemId, itemName } from '../../shared/items';
import { ITEM_OF_PROP, PROP_LABELS } from '../../shared/props';
import type { LocalSimulation, Tone } from '../../shared/simulation';
import {
  INJURY_LABELS,
  type Injury,
  TREATMENT_LABELS,
  VITALS,
  ZONE_LABELS,
  type Zone,
  bleedRate,
  limits,
  treatmentOptions,
} from '../../shared/vitals';
import { BagScene, type BagSlot, sameSlot } from '../render/bag-scene';
import type { InputManager } from '../input/input-manager';

export interface BagViewDeps {
  root: HTMLElement;
  canvas: HTMLCanvasElement;
  engine: AbstractEngine;
  input: InputManager;
  onClose: () => void;
  onMessage: (text: string, tone: Tone) => void;
}

interface ActionButton {
  label: string;
  run: () => void;
  disabled?: boolean;
}

const fmtKg = (kg: number): string => `${kg < 10 ? kg.toFixed(1).replace('.', ',') : Math.round(kg)} kg`;
const cap = (t: string): string => t.charAt(0).toUpperCase() + t.slice(1);

function painLabel(p: number): string {
  if (p < 5) return 'aucune';
  if (p < 25) return 'faible';
  if (p < 55) return 'forte';
  return 'très forte';
}

function injuryText(i: Injury): string {
  let t = cap(INJURY_LABELS[i.kind]);
  if (i.kind === 'coupure') t += i.grave ? ' profonde' : ' légère';
  const notes: string[] = [];
  if (bleedRate(i) > 0) notes.push(i.grave ? 'saigne beaucoup' : 'saigne');
  if (i.bandaged) notes.push('bandée');
  if (i.splinted) notes.push('attelle posée');
  if (i.kind === 'fracture' && !i.splinted) notes.push('ne guérira pas sans attelle');
  if (i.disinfected) notes.push('désinfectée');
  if (i.infection > 0) notes.push('infectée : fièvre');
  if (i.heal > 0.02) notes.push(`guérie à ${Math.round(i.heal * 100)} %`);
  return notes.length ? `${t} — ${notes.join(', ')}` : t;
}

export class BagView {
  private readonly bag: BagScene;
  private sim: LocalSimulation | null = null;
  private otherProp: string | null = null;
  private selected: BagSlot | null = { zone: 'poche', index: 0 };
  private zone: Zone | null = null;
  private tab: 'sac' | 'corps' = 'sac';
  private navCooldown = 0;
  private lastSig = '';
  private buttons: ActionButton[] = [];
  /** Tous les boutons affichés (objets, corps, soins), pour les tests. */
  private allButtons: ActionButton[] = [];
  private readonly el: Record<string, HTMLElement>;
  private readonly badges: HTMLElement;
  private readonly zones: Map<Zone, SVGElement>;
  open_ = false;

  constructor(private readonly deps: BagViewDeps) {
    this.bag = new BagScene(deps.engine, deps.canvas);
    const q = (sel: string) => deps.root.querySelector<HTMLElement>(sel)!;
    this.el = {
      pick: q('.bag-pick'),
      title: q('.bag-title'),
      vitals: q('.vitals'),
      zoneDetail: q('.zone-detail'),
      bodyActions: q('.body-actions'),
      itemName: q('.item-name'),
      itemDesc: q('.item-desc'),
      itemActions: q('.item-actions'),
    };
    this.badges = q('.bag-badges');
    this.zones = new Map();
    deps.root.querySelectorAll<SVGElement>('[data-zone]').forEach((z) => {
      const zone = z.dataset.zone as Zone;
      this.zones.set(zone, z);
      z.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        this.zone = zone;
        this.lastSig = '';
      });
    });
    this.el.pick!.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      const slot = this.bag.slotAt(e.clientX, e.clientY);
      if (slot) this.select(slot);
    });
    q('.bag-close').addEventListener('click', () => this.deps.onClose());
    deps.root.querySelectorAll<HTMLElement>('[data-tab]').forEach((b) => b.addEventListener('click', () => this.setTab(b.dataset.tab === 'corps' ? 'corps' : 'sac')));
  }

  get isOpen(): boolean {
    return this.open_;
  }

  /** Ouvre le sac (et, si donné, le contenu d'un corps ou d'un sac posé à fouiller). */
  open(sim: LocalSimulation, otherProp: string | null = null): void {
    this.sim = sim;
    this.otherProp = otherProp;
    this.open_ = true;
    this.deps.root.hidden = false;
    this.selected = otherProp ? { zone: 'autre-poche', index: 0 } : { zone: 'poche', index: 0 };
    if (otherProp && !sim.props.container(otherProp)?.pockets.length) this.selected = { zone: 'autre-sac', index: 0 };
    this.bag.setSelected(this.selected);
    this.lastSig = '';
    this.setTab('sac');
  }

  close(): void {
    this.open_ = false;
    this.sim = null;
    this.otherProp = null;
    this.deps.root.hidden = true;
    this.badges.textContent = '';
  }

  private setTab(tab: 'sac' | 'corps'): void {
    this.tab = tab;
    this.deps.root.classList.toggle('tab-corps', tab === 'corps');
    this.deps.root.querySelectorAll<HTMLElement>('[data-tab]').forEach((b) => b.classList.toggle('on', b.dataset.tab === tab));
    this.lastSig = '';
  }

  private select(slot: BagSlot): void {
    this.selected = slot;
    this.bag.setSelected(slot);
    this.lastSig = '';
  }

  private act(a: PlayerAction): void {
    const sim = this.sim;
    if (!sim) return;
    const r = sim.act(a);
    if (r.message) this.deps.onMessage(r.message, r.ok ? 'info' : 'alerte');
    this.lastSig = '';
  }

  private otherContainer() {
    const sim = this.sim;
    if (!sim || !this.otherProp) return null;
    const def = sim.props.defOf(this.otherProp);
    const pos = sim.props.position(this.otherProp);
    if (!def?.container || !pos) return null;
    const s = sim.state;
    if (Math.hypot(pos.x - s.x, pos.z - s.z) > 3.4) return null;
    return { def, c: def.container };
  }

  /** Appelé à chaque image pendant que le sac est ouvert. */
  frame(dt: number): void {
    const sim = this.sim;
    if (!sim || !this.open_) return;
    if (sim.vitals.state !== 'eveille') {
      this.deps.onClose();
      return;
    }
    if (this.otherProp && !this.otherContainer()) {
      this.otherProp = null;
      if (this.selected?.zone.startsWith('autre')) this.select({ zone: 'poche', index: 0 });
    }
    this.navigate(dt);
    const other = this.otherContainer();
    const held = sim.props.held ? sim.props.defOf(sim.props.held.id) : null;
    this.bag.update({
      pockets: sim.inventory.pockets,
      bag: sim.inventory.bag,
      hand: held ? { kind: held.kind, radius: held.radius, length: held.length } : null,
      other: other?.c ?? null,
    });
    if (this.tab === 'sac' || window.innerWidth > 760) {
      const r = this.el.pick!.getBoundingClientRect();
      this.bag.setRect({ left: r.left, top: r.top, width: r.width, height: r.height });
      this.bag.render();
      this.drawBadges();
    } else this.badges.textContent = '';
    this.refreshPanels();
  }

  private navigate(dt: number): void {
    const input = this.deps.input;
    this.navCooldown = Math.max(0, this.navCooldown - dt);
    const mx = input.move.x;
    const my = input.move.y;
    if (Math.hypot(mx, my) < 0.55) this.navCooldown = Math.min(this.navCooldown, 0.02);
    else if (this.navCooldown <= 0 && this.tab === 'sac') {
      const horizontal = Math.abs(mx) > Math.abs(my);
      const next = this.bag.neighbor(this.selected, horizontal ? Math.sign(mx) : 0, horizontal ? 0 : Math.sign(my));
      if (next) this.select(next);
      this.navCooldown = 0.2;
    }
    if (input.codePressed('Pad:0') || input.codePressed('Enter') || input.pressed('interact')) this.buttons[0]?.disabled || this.buttons[0]?.run();
    if (input.codePressed('Pad:2')) this.buttons[1]?.disabled || this.buttons[1]?.run();
    if (input.pressed('use')) this.buttons.find((b) => b.label === 'Manger' || b.label === 'Utiliser')?.run();
    if (input.codePressed('Pad:4') || input.codePressed('Pad:5')) this.setTab(this.tab === 'sac' ? 'corps' : 'sac');
    if (input.codePressed('Pad:1')) this.deps.onClose();
  }

  private drawBadges(): void {
    const parts: string[] = [];
    for (const c of this.bag.cells) {
      if (c.count <= 1) continue;
      const p = this.bag.toScreen(c.x + 0.1, c.z - 0.1);
      parts.push(`<span style="left:${p.x.toFixed(0)}px;top:${p.y.toFixed(0)}px">${c.count}</span>`);
    }
    for (const l of this.bag.labels) {
      const p = this.bag.toScreen(l.x, l.z);
      parts.push(`<span class="zone-label" style="left:${p.x.toFixed(0)}px;top:${p.y.toFixed(0)}px;transform:translate(0,-50%)">${l.text}</span>`);
    }
    const html = parts.join('');
    if (this.badges.innerHTML !== html) this.badges.innerHTML = html;
  }

  /** Objet de la case choisie. */
  private selectedItem(): { item: ItemId | null; kindLabel: string; count: number; mass: number } | null {
    const sim = this.sim!;
    const s = this.selected;
    if (!s) return null;
    if (s.zone === 'main') {
      const h = sim.props.held ? sim.props.defOf(sim.props.held.id) : null;
      if (!h) return null;
      return { item: ITEM_OF_PROP[h.kind] ?? null, kindLabel: PROP_LABELS[h.kind], count: 1, mass: sim.props.massOf(h.id) };
    }
    let st = null;
    if (s.zone === 'poche' || s.zone === 'sac') st = stackAt(sim.inventory, s);
    else {
      const o = this.otherContainer();
      if (o) st = stackAt(o.c, { zone: s.zone === 'autre-poche' ? 'poche' : 'sac', index: s.index });
    }
    if (!st) return null;
    return { item: st.item, kindLabel: ITEMS[st.item].label, count: st.count, mass: unitMass(st) * st.count };
  }

  private itemButtons(): ActionButton[] {
    const sim = this.sim!;
    const s = this.selected;
    const out: ActionButton[] = [];
    const other = this.otherContainer();
    const sel = this.selectedItem();
    if (s && sel) {
      if (s.zone === 'main') {
        if (sel.item && ITEMS[sel.item].food) out.push({ label: 'Manger', run: () => this.act({ type: 'manger', from: { zone: 'main' } }) });
        if (sel.item === 'chiffon' || sel.item === 'aloes' || sel.item === 'baton') out.push({ label: 'Utiliser', run: () => this.act({ type: 'utiliser' }) });
        if (sel.item) out.push({ label: 'Ranger', run: () => this.act({ type: 'ranger' }) });
        out.push({ label: 'Poser au sol', run: () => this.act({ type: 'poser', from: { zone: 'main' } }) });
      } else if (s.zone === 'poche' || s.zone === 'sac') {
        const from: Slot = { zone: s.zone, index: s.index };
        const item = sel.item!;
        if (ITEMS[item].food) out.push({ label: 'Manger', run: () => this.act({ type: 'manger', from }) });
        out.push({ label: 'Prendre en main', run: () => this.act({ type: 'sortir', from }) });
        if (s.zone === 'poche' && sim.inventory.bag) out.push({ label: 'Mettre dans le sac', run: () => this.act({ type: 'deplacer', from, to: 'sac' }) });
        if (s.zone === 'sac' && ITEMS[item].pocket) out.push({ label: 'Mettre en poche', run: () => this.act({ type: 'deplacer', from, to: 'poche' }) });
        if (other?.def.kind === 'sac' && other.c.bag && this.otherProp) {
          const prop = this.otherProp;
          out.push({ label: 'Ranger dans le sac posé', run: () => this.act({ type: 'deposer_dans', prop, from }) });
        }
        out.push({ label: 'Poser au sol', run: () => this.act({ type: 'poser', from }) });
      } else if (this.otherProp) {
        const prop = this.otherProp;
        const from: Slot = { zone: s.zone === 'autre-poche' ? 'poche' : 'sac', index: s.index };
        out.push({ label: 'Prendre', run: () => this.act({ type: 'prendre_dans', prop, from }) });
      }
    }
    if (other && this.otherProp) {
      const prop = this.otherProp;
      out.push({ label: 'Tout prendre', run: () => this.act({ type: 'tout_prendre', prop }) });
      if (other.c.bag && !sim.inventory.bag) out.push({ label: 'Mettre ce sac sur le dos', run: () => this.act({ type: 'prendre_sac', prop }) });
      if (other.def.kind === 'corps')
        out.push({
          label: 'Traîner le corps',
          run: () => {
            this.act({ type: 'trainer', prop });
            this.deps.onClose();
          },
        });
    }
    return out;
  }

  private bodyButtons(): ActionButton[] {
    const sim = this.sim!;
    const v = sim.vitals;
    const out: ActionButton[] = [];
    if (sim.gesture) out.push({ label: 'Interrompre', run: () => this.act({ type: 'interrompre' }) });
    if (sim.inventory.clothes.haut) out.push({ label: 'Déchirer la chemise (4 chiffons)', run: () => this.act({ type: 'dechirer', part: 'haut' }) });
    if (sim.inventory.clothes.bas) out.push({ label: 'Déchirer le pantalon (4 chiffons)', run: () => this.act({ type: 'dechirer', part: 'bas' }) });
    out.push({ label: v.posture === 'assis' ? 'Se lever' : "S'asseoir", run: () => this.act({ type: 'reposer' }) });
    out.push({
      label: v.fatigue < VITALS.sleepMinFatigue ? 'Dormir (pas sommeil)' : 'Dormir',
      disabled: v.fatigue < VITALS.sleepMinFatigue,
      run: () => {
        this.act({ type: 'dormir' });
        if (sim.vitals.posture === 'endormi') this.deps.onClose();
      },
    });
    if (sim.inventory.bag) out.push({ label: 'Poser le sac', run: () => this.act({ type: 'poser_sac' }) });
    return out;
  }

  private zoneButtons(zone: Zone): { lines: string[]; buttons: ActionButton[] } {
    const sim = this.sim!;
    const v = sim.vitals;
    const injuries = v.injuries.filter((i) => i.zone === zone);
    const lines = injuries.length ? injuries.map(injuryText) : ['Rien à signaler.'];
    const buttons: ActionButton[] = [];
    for (const o of treatmentOptions(v)) {
      const inj = injuries.find((i) => i.id === o.injury);
      if (!inj) continue;
      const missing = o.needs.filter(([item, n]) => sim.available(item) < n);
      const needs = o.needs.map(([item, n]) => itemName(item, n)).join(' + ');
      buttons.push({
        label: `${TREATMENT_LABELS[o.treatment]} — ${INJURY_LABELS[inj.kind]} (${needs})`,
        disabled: missing.length > 0 || !!sim.gesture,
        run: () => this.act({ type: 'soigner', injury: o.injury, treatment: o.treatment }),
      });
    }
    return { lines, buttons };
  }

  private renderButtons(host: HTMLElement, list: ActionButton[]): void {
    this.allButtons.push(...list);
    host.textContent = '';
    for (const b of list) {
      const el = document.createElement('button');
      el.type = 'button';
      el.textContent = b.label;
      el.disabled = !!b.disabled;
      el.addEventListener('click', () => b.run());
      host.appendChild(el);
    }
  }

  private refreshPanels(): void {
    const sim = this.sim!;
    const v = sim.vitals;
    const inv = sim.inventory;
    const lim = limits(v);
    const other = this.otherContainer();
    const sel = this.selectedItem();
    const sig = JSON.stringify([
      inv,
      sim.props.held?.id ?? null,
      this.selected,
      this.zone,
      this.tab,
      other?.c ?? null,
      Math.round(v.health),
      Math.round(v.energy),
      Math.round(v.fatigue),
      v.posture,
      v.injuries,
      sim.gesture?.label ?? null,
    ]);
    if (sig === this.lastSig) return;
    this.lastSig = sig;

    const vol = inv.bag ? bagVolume(inv.bag) : 0;
    const load = carriedMass(inv);
    this.el.title!.textContent = inv.bag
      ? `Sac : ${vol.toFixed(1).replace('.', ',')} / ${BAG_CAPACITY_L} L · charge portée ${fmtKg(load)}${load > 25 ? ' (trop lourd pour courir)' : ''}`
      : `Pas de sac · ${POCKET_COUNT} poches · charge ${fmtKg(load)}`;
    if (other) this.el.title!.textContent += other.def.kind === 'corps' ? ' · vous fouillez un corps' : ` · sac posé (${fmtKg(bagContentMass(other.c.bag ?? []))})`;

    // Objet choisi.
    if (sel) {
      this.el.itemName!.textContent = `${cap(sel.item ? itemName(sel.item, sel.count) : `${sel.kindLabel}`)} · ${fmtKg(sel.mass)}`;
      this.el.itemDesc!.textContent = sel.item ? ITEMS[sel.item].description : 'Trop grand pour le sac : on le porte ou on le traîne.';
    } else {
      this.el.itemName!.textContent = other ? 'Choisissez un objet à prendre.' : 'Case vide.';
      this.el.itemDesc!.textContent = sim.gesture ? sim.gesture.label : 'Touchez un objet, puis une action.';
    }
    this.allButtons = [];
    this.buttons = this.itemButtons();
    this.renderButtons(this.el.itemActions!, this.buttons);

    // Corps.
    const meter = (label: string, value: number, color: string, text: string) =>
      `<span>${label}</span><span title="${text}"><span class="meter"><span style="width:${Math.max(0, Math.min(100, value)).toFixed(0)}%;background:${color}"></span></span></span>`;
    const notes: string[] = [];
    if (lim.bleeding > 0) notes.push('vous saignez');
    if (lim.fever > 0) notes.push('fièvre');
    if (v.posture === 'assis') notes.push('assis');
    this.el.vitals!.innerHTML = [
      meter('Santé', v.health, '#c0503c', `${Math.round(v.health)} / 100`),
      meter('Énergie', v.energy, '#d9b54a', `${Math.round(v.energy)} / 100`),
      meter('Fatigue', v.fatigue, '#5a7fd0', `${Math.round(v.fatigue)} / 100`),
      `<span>Douleur</span><span>${painLabel(lim.pain)}${notes.length ? ` · ${notes.join(', ')}` : ''}</span>`,
    ].join('');
    for (const [zone, el] of this.zones) {
      const list = v.injuries.filter((i) => i.zone === zone);
      let cls = '';
      if (list.some((i) => bleedRate(i) > 0)) cls = 'saigne';
      else if (list.some((i) => i.infection > 0)) cls = 'infecte';
      else if (list.some((i) => i.kind === 'fracture' && !i.splinted)) cls = 'fracture';
      else if (list.some((i) => i.kind === 'entorse' && !i.bandaged)) cls = 'entorse';
      else if (list.some((i) => i.kind === 'contusion' || i.kind === 'commotion')) cls = 'contusion';
      else if (list.length) cls = 'soigne';
      el.setAttribute('class', `${cls}${this.zone === zone ? ' sel' : ''}`);
    }
    const zone = this.zone ?? v.injuries[0]?.zone ?? null;
    if (zone) {
      const { lines, buttons } = this.zoneButtons(zone);
      this.el.zoneDetail!.innerHTML = `<p><strong>${cap(ZONE_LABELS[zone])}</strong></p>${lines.map((l) => `<p>${l}</p>`).join('')}`;
      const host = document.createElement('div');
      host.className = 'zone-buttons';
      this.renderButtons(host, buttons);
      this.el.zoneDetail!.appendChild(host);
    } else {
      this.el.zoneDetail!.innerHTML = '<p>Aucune blessure. Touchez une partie du corps pour l’examiner.</p>';
    }
    this.renderButtons(this.el.bodyActions!, this.bodyButtons());
  }

  /** État pour les tests automatiques. */
  debug(): unknown {
    return {
      open: this.open_,
      tab: this.tab,
      selected: this.selected,
      other: this.otherProp,
      cells: this.bag.cells.map((c) => ({ slot: c.slot, kind: c.kind, count: c.count, ...this.bag.toScreen(c.x, c.z) })),
      actions: this.buttons.map((b) => b.label),
      all: this.allButtons.map((b) => (b.disabled ? `(${b.label})` : b.label)),
    };
  }

  /** Choisit une case (tests). */
  pick(slot: BagSlot): void {
    this.select(slot);
  }

  /** Clique une action par son libellé (tests). */
  run(label: string): boolean {
    const b = this.allButtons.find((x) => x.label === label);
    if (!b || b.disabled) return false;
    b.run();
    return true;
  }

  isSelected(slot: BagSlot): boolean {
    return sameSlot(this.selected, slot);
  }

  dispose(): void {
    this.bag.dispose();
  }
}
