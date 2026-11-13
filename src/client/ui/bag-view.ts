// Vue du sac et examen du corps. Le contenu est montré en 3D sur une toile (bag-scene), les
// actions sont de gros boutons (doigt, souris) et tout se pilote aussi au clavier et à la
// manette. Aucun glisser-déposer n'est nécessaire : on touche un objet, puis une action.

import type { AbstractEngine } from '@babylonjs/core/Engines/abstractEngine';
import type { BuildRef, PlayerAction } from '../../shared/actions';
import { INSTALL_PLANS, type Need, PIECE_PLANS, PLANS, PLAN_IDS, type PlanId, VEHICLE_PLANS, maxHp, needLabel, pieceTransform, repairNeeds, stepsOf } from '../../shared/building';
import { MACHINES, RUNS_AT } from '../../shared/machines';
import { ENGINE, FRAMES, FRAME_REPAIR, PARTS, partAt, partName, uprightness, vehicleName } from '../../shared/vehicles';
import { RECIPES, RECIPE_IDS, canDismantle, conditionOf, experimentHint, improveOptions, repairOptions, skillLevel } from '../../shared/crafting';
import { FX_DURCI, FX_LIGATURE_LACHE, FX_MANCHE_FENDU, FX_RESINE, type ItemStack, type Slot, bagContentMass, bagVolume, BAG_CAPACITY_L, carriedMass, POCKET_COUNT, stackAt, unitMass } from '../../shared/inventory';
import { ITEMS, type ItemId, itemName } from '../../shared/items';
import { ITEM_OF_PROP, MACHINE_KINDS, type MachinePropKind, PROP_LABELS } from '../../shared/props';
import { type LocalSimulation, TOOL_NEEDS, type Tone } from '../../shared/simulation';
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
  /** Tracer un plan (mode construction). */
  onBuild: (plan: PlanId) => void;
}

interface ActionButton {
  label: string;
  run: () => void;
  disabled?: boolean;
}

type Tab = 'sac' | 'corps' | 'fabriquer' | 'construire' | 'carnet';
/** Emplacements des pièces d'un véhicule. */
const SLOT_LABELS: Record<string, string> = {
  roue_avg: 'avant gauche',
  roue_avd: 'avant droite',
  roue_arg: 'arrière gauche',
  roue_ard: 'arrière droite',
  essieu_av: 'avant',
  essieu_ar: 'arrière',
  machine: 'sur le plateau',
  aubes: 'à l’arrière',
  gouvernail: 'à l’arrière',
};

const TABS: Tab[] = ['sac', 'corps', 'fabriquer', 'construire', 'carnet'];
type ListKey = 'item' | 'body' | 'zone' | 'bench' | 'craft' | 'plans';

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
  /** Pièce de construction ou chantier ouvert (E dessus). */
  private otherBuild: BuildRef | null = null;
  /** Phase 7 : véhicule ouvert (pièces, chaudière, conduite). */
  private otherVehicle: string | null = null;
  /** Moment d'ouverture : le toucher qui ouvre le panneau ne doit pas cliquer le bouton apparu sous le doigt. */
  private openedAt = 0;
  private selected: BagSlot | null = { zone: 'poche', index: 0 };
  private zone: Zone | null = null;
  private tab: Tab = 'sac';
  private navCooldown = 0;
  /** Plan choisi à la manette dans l'onglet « Construire ». */
  private planIndex = 0;
  private navHeld = false;
  private buttons: ActionButton[] = [];
  /** Listes de boutons à jour ; les boutons affichés ne sont recréés que si les libellés changent. */
  private readonly lists: Record<ListKey, ActionButton[]> = { item: [], body: [], zone: [], bench: [], craft: [], plans: [] };
  private readonly listSig: Record<ListKey, string> = { item: '', body: '', zone: '', bench: '', craft: '', plans: '' };
  private zoneLines!: HTMLElement;
  private zoneButtons_!: HTMLElement;
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
      benchList: q('.bench-list'),
      recipe: q('.recipe'),
      craftActions: q('.craft-actions'),
      craftHint: q('.craft-hint'),
      carnet: q('.carnet'),
      plans: q('.plans'),
      buildInfo: q('.build-info'),
    };
    this.badges = q('.bag-badges');
    this.zoneLines = document.createElement('div');
    this.zoneLines.className = 'zone-lines';
    this.zoneButtons_ = document.createElement('div');
    this.zoneButtons_.className = 'zone-buttons';
    this.el.zoneDetail!.append(this.zoneLines, this.zoneButtons_);
    this.zones = new Map();
    deps.root.querySelectorAll<SVGElement>('[data-zone]').forEach((z) => {
      const zone = z.dataset.zone as Zone;
      this.zones.set(zone, z);
      z.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        this.zone = zone;
      });
    });
    this.el.pick!.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      const slot = this.bag.slotAt(e.clientX, e.clientY);
      if (slot) this.select(slot);
    });
    q('.bag-close').addEventListener('click', () => this.deps.onClose());
    deps.root.querySelectorAll<HTMLElement>('[data-tab]').forEach((b) => b.addEventListener('click', () => this.setTab(TABS.includes(b.dataset.tab as Tab) ? (b.dataset.tab as Tab) : 'sac')));
  }

  get isOpen(): boolean {
    return this.open_;
  }

  /** Ouvre le sac (et, si donné, le contenu d'un corps ou d'un sac posé à fouiller). */
  open(sim: LocalSimulation, otherProp: string | null = null, build: BuildRef | null = null): void {
    this.sim = sim;
    // L'établi ouvre directement la fabrication.
    const etabli = otherProp ? sim.props.defOf(otherProp)?.kind === 'etabli' : false;
    this.otherProp = etabli ? null : otherProp;
    this.otherBuild = build;
    this.otherVehicle = null;
    this.open_ = true;
    this.openedAt = performance.now();
    this.deps.root.hidden = false;
    this.selected = this.otherProp ? { zone: 'autre-poche', index: 0 } : { zone: 'poche', index: 0 };
    if (this.otherProp && !sim.props.container(this.otherProp)?.pockets.length) this.selected = { zone: 'autre-sac', index: 0 };
    this.bag.setSelected(this.selected);
    this.setTab(etabli ? 'fabriquer' : 'sac');
  }

  /** Ouvre le panneau d'un véhicule (et le sac). */
  openVehicle(sim: LocalSimulation, id: string): void {
    this.open(sim, null, null);
    this.otherVehicle = id;
  }

  close(): void {
    this.open_ = false;
    this.sim = null;
    this.otherProp = null;
    this.otherBuild = null;
    this.otherVehicle = null;
    this.deps.root.hidden = true;
    this.badges.textContent = '';
  }

  private setTab(tab: Tab): void {
    this.tab = tab;
    for (const t of TABS) this.deps.root.classList.toggle(`tab-${t}`, tab === t);
    this.deps.root.querySelectorAll<HTMLElement>('[data-tab]').forEach((b) => b.classList.toggle('on', b.dataset.tab === tab));
  }

  private select(slot: BagSlot): void {
    this.selected = slot;
    this.bag.setSelected(slot);
  }

  private act(a: PlayerAction): void {
    const sim = this.sim;
    if (!sim) return;
    const r = sim.act(a);
    if (r.message) this.deps.onMessage(r.message, r.ok ? 'info' : 'alerte');
  }

  /** Bas fourneau ouvert (à portée). */
  private otherFurnace() {
    const sim = this.sim;
    if (!sim || !this.otherProp) return null;
    const def = sim.props.defOf(this.otherProp);
    const pos = sim.props.position(this.otherProp);
    if (!def?.furnace || !pos) return null;
    if (Math.hypot(pos.x - sim.state.x, pos.z - sim.state.z) > 3.4) return null;
    return { def, f: def.furnace };
  }

  /** Pièce ou chantier ouvert (à portée), avec ce qu'on en sait. */
  private openedBuild() {
    const sim = this.sim;
    const b = this.otherBuild;
    if (!sim || !b) return null;
    const st = sim.state;
    if (b.kind === 'site') {
      const site = sim.build.site(b.id);
      if (!site || Math.hypot(site.x - st.x, site.z - st.z) > 4.5) return null;
      return { kind: 'site' as const, plan: site.plan, steps: PLANS[site.plan].steps, step: site.step, piece: null };
    }
    const s = sim.build.structure(b.s);
    const p = s?.pieces.find((q) => q.id === b.p);
    if (!s || !p) return null;
    const t = pieceTransform(s, p.slot);
    if (Math.hypot(t.x - st.x, t.z - st.z) > 4.5) return null;
    return { kind: 'piece' as const, plan: p.plan, steps: stepsOf(p.plan, p.stilts), step: p.step, piece: p };
  }

  /** Foyer ouvert (à portée). */
  private otherFire() {
    const sim = this.sim;
    if (!sim || !this.otherProp) return null;
    const def = sim.props.defOf(this.otherProp);
    const pos = sim.props.position(this.otherProp);
    if (!def?.fire || !pos) return null;
    if (Math.hypot(pos.x - sim.state.x, pos.z - sim.state.z) > 3.4) return null;
    return { def, fire: def.fire };
  }

  /** Véhicule ouvert, à portée (ou conduit). */
  private openedVehicle() {
    const sim = this.sim;
    if (!sim) return null;
    const id = this.otherVehicle ?? sim.driving?.v ?? null;
    const v = id ? sim.vehicle(id) : undefined;
    if (!v) return null;
    const f = FRAMES[v.frame];
    if (sim.driving?.v !== v.id && Math.hypot(v.x - sim.state.x, v.z - sim.state.z) > Math.hypot(f.half.x, f.half.z) + 3.6) return null;
    return v;
  }

  /** Machine ouverte (à portée). */
  private otherMachine() {
    const sim = this.sim;
    if (!sim || !this.otherProp) return null;
    const def = sim.props.defOf(this.otherProp);
    const pos = sim.props.position(this.otherProp);
    if (!def || !MACHINE_KINDS.has(def.kind) || !pos) return null;
    if (Math.hypot(pos.x - sim.state.x, pos.z - sim.state.z) > 3.6) return null;
    return { def, kind: def.kind as MachinePropKind, m: def.machine ?? { power: 0 } };
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
    if (this.otherBuild && !this.openedBuild()) this.otherBuild = null;
    if (this.otherProp && !this.otherContainer() && !this.otherFire() && !this.otherFurnace()) {
      this.otherProp = null;
      if (this.selected?.zone.startsWith('autre')) this.select({ zone: 'poche', index: 0 });
    }
    this.navigate(dt);
    // Une action ou la manette a pu fermer la vue pendant cette image.
    if (!this.open_ || !this.sim) return;
    const other = this.otherContainer();
    const held = sim.props.held ? sim.props.defOf(sim.props.held.id) : null;
    this.bag.update({
      pockets: sim.inventory.pockets,
      bag: sim.inventory.bag,
      hand: held ? { kind: held.kind, radius: held.radius, length: held.length } : null,
      other: other?.c ?? null,
      bench: sim.inventory.bench,
    });
    // Même règle que la feuille de style : petit écran = onglets Sac / Corps.
    const tabbed = window.matchMedia('(max-width: 760px), (max-height: 420px)').matches;
    if (this.tab === 'sac' || !tabbed) {
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
    if (Math.hypot(mx, my) < 0.55) {
      this.navCooldown = 0;
      this.navHeld = false;
    } else if (this.navCooldown <= 0 && this.tab === 'construire' && Math.abs(my) > Math.abs(mx)) {
      // Onglet « Construire » : le stick choisit un plan.
      const n = this.knownPlans().length;
      if (n) this.planIndex = (this.planIndex + (my > 0 ? -1 : 1) + n) % n;
      this.navCooldown = this.navHeld ? 0.16 : 0.4;
      this.navHeld = true;
    } else if (this.navCooldown <= 0 && this.el.pick!.getClientRects().length > 0) {
      // Le stick choisit une case tant que le sac est à l'écran (sur grand écran, aussi pendant la fabrication).
      const horizontal = Math.abs(mx) > Math.abs(my);
      const next = this.bag.neighbor(this.selected, horizontal ? Math.sign(mx) : 0, horizontal ? 0 : Math.sign(my));
      if (next) this.select(next);
      // Première répétition plus lente, comme une touche maintenue.
      this.navCooldown = this.navHeld ? 0.16 : 0.4;
      this.navHeld = true;
    }
    // Onglet « Fabriquer » : A fabrique (étape suivante), X pose l'objet choisi sur le plan de travail (ou le reprend).
    const crafting = this.tab === 'fabriquer';
    const first = input.codePressed('Pad:0') || input.codePressed('Enter') || (input.pressed('interact') && !input.codePressed('Pad:2'));
    const a = crafting ? this.lists.craft[0] : this.tab === 'construire' ? this.lists.plans[this.planIndex] : this.buttons[0];
    if (first && a && !a.disabled) a.run();
    if (!this.open_) return;
    const x = crafting ? this.buttons.find((b) => b.label === 'Poser sur le plan de travail' || b.label === 'Reprendre') : this.buttons[1];
    if (input.codePressed('Pad:2') && x && !x.disabled) x.run();
    if (!this.open_) return;
    if (input.pressed('use')) this.buttons.find((b) => b.label === 'Manger' || b.label === 'Utiliser')?.run();
    if (input.codePressed('Pad:4')) this.setTab(TABS[(TABS.indexOf(this.tab) + TABS.length - 1) % TABS.length]!);
    if (input.codePressed('Pad:5')) this.setTab(TABS[(TABS.indexOf(this.tab) + 1) % TABS.length]!);
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
  private selectedItem(): { item: ItemId | null; kindLabel: string; count: number; mass: number; st: ItemStack | null } | null {
    const sim = this.sim!;
    const s = this.selected;
    if (!s) return null;
    if (s.zone === 'main') {
      const h = sim.props.held ? sim.props.defOf(sim.props.held.id) : null;
      if (!h) return null;
      const item = ITEM_OF_PROP[h.kind] ?? null;
      return { item, kindLabel: PROP_LABELS[h.kind], count: 1, mass: sim.props.massOf(h.id), st: item ? { item, count: 1, ...(h.meta ?? {}) } : null };
    }
    let st = null;
    if (s.zone === 'poche' || s.zone === 'sac') st = stackAt(sim.inventory, s);
    else if (s.zone === 'etabli') st = sim.inventory.bench[s.index] ?? null;
    else {
      const o = this.otherContainer();
      if (o) st = stackAt(o.c, { zone: s.zone === 'autre-poche' ? 'poche' : 'sac', index: s.index });
    }
    if (!st) return null;
    return { item: st.item, kindLabel: ITEMS[st.item].label, count: st.count, mass: unitMass(st) * st.count, st };
  }

  /** État d'un outil : « neuf (118/120), qualité bonne, durci au feu ». */
  private toolText(st: ItemStack | null): string {
    if (!st) return '';
    if (st.item === 'torche') return st.d !== undefined ? `brûlera encore ${Math.max(1, Math.round(st.d / 60))} min` : '';
    const cond = conditionOf(st);
    const parts: string[] = [];
    if (cond) parts.push(`${cond} (${st.d}/${st.dm})`);
    if (st.q !== undefined) parts.push(`qualité ${st.q < 40 ? 'médiocre' : st.q < 70 ? 'correcte' : st.q < 85 ? 'bonne' : 'excellente'}`);
    const fx = st.fx ?? 0;
    if (fx & FX_DURCI) parts.push('durci au feu');
    if (fx & FX_RESINE) parts.push('ligature à la résine');
    if (fx & FX_LIGATURE_LACHE) parts.push('ligature lâche');
    if (fx & FX_MANCHE_FENDU) parts.push('manche fendu');
    if (st.item === 'pot') parts.push(st.w === 2 ? 'eau bouillie' : st.w === 1 ? 'plein d’eau' : 'vide');
    return parts.join(', ');
  }

  private itemButtons(): ActionButton[] {
    const sim = this.sim!;
    const s = this.selected;
    const out: ActionButton[] = [];
    const other = this.otherContainer();
    const sel = this.selectedItem();
    const fire = this.otherFire();
    const toolButtons = (from: Slot | { zone: 'main' }) => {
      const st = sel?.st;
      if (!st) return;
      if (sel.item) out.push({ label: 'Poser sur le plan de travail', run: () => this.act({ type: 'etabli_poser', from }) });
      const needText = (needs: Array<[ItemId, number]>, extra: string[]) => {
        const all = [...needs.map(([item, n]) => itemName(item, n)), ...extra];
        return all.length ? ` (${all.join(', ')})` : '';
      };
      const lacks = (needs: Array<[ItemId, number]>) => needs.some(([item, n]) => sim.available(item) < n);
      for (const o of repairOptions(st, sim.meuleNearby())) {
        out.push({
          label: `Réparer : ${o.label.toLowerCase()}${needText(o.needs, [])}`,
          disabled: lacks(o.needs) || (o.tool !== null && !sim.hasTool(o.tool)),
          run: () => this.act({ type: 'reparer', from, kind: o.kind }),
        });
      }
      for (const o of improveOptions(st)) {
        out.push({
          label: `Améliorer : ${o.label.toLowerCase()}${needText(o.needs, o.fire ? ['un feu allumé'] : [])}`,
          disabled: lacks(o.needs) || (o.fire && !sim.fireNearby()),
          run: () => this.act({ type: 'ameliorer', from, kind: o.kind }),
        });
      }
      if (canDismantle(st.item)) out.push({ label: 'Démonter', run: () => this.act({ type: 'demonter', from }) });
      if (st.item === 'pot' && sim.inWater()) out.push({ label: 'Remplir d’eau', run: () => this.act({ type: 'remplir', from }) });
      if (fire && this.otherProp && (st.item === 'pot' || st.item === 'pot_cru' || (st.item === 'viande_crue' && fire.def.kind === 'foyer')) && !fire.fire.pot) {
        const prop = this.otherProp;
        out.push({ label: 'Poser sur le feu', run: () => this.act({ type: 'poser_feu', prop, from }) });
      }
    };
    if (s && sel && s.zone === 'etabli') {
      const index = s.index;
      out.push({ label: 'Reprendre', run: () => this.act({ type: 'etabli_reprendre', index }) });
    } else if (s && sel) {
      if (s.zone === 'main') {
        if (sel.item && ITEMS[sel.item].food) out.push({ label: 'Manger', run: () => this.act({ type: 'manger', from: { zone: 'main' } }) });
        if (sel.item === 'chiffon' || sel.item === 'aloes' || sel.item === 'baton') out.push({ label: 'Utiliser', run: () => this.act({ type: 'utiliser' }) });
        if (sel.item) out.push({ label: 'Ranger', run: () => this.act({ type: 'ranger' }) });
        out.push({ label: 'Poser au sol', run: () => this.act({ type: 'poser', from: { zone: 'main' } }) });
        toolButtons({ zone: 'main' });
      } else if (s.zone === 'poche' || s.zone === 'sac') {
        const from: Slot = { zone: s.zone, index: s.index };
        const item = sel.item!;
        if (ITEMS[item].food) out.push({ label: 'Manger', run: () => this.act({ type: 'manger', from }) });
        out.push({ label: 'Prendre en main', run: () => this.act({ type: 'sortir', from }) });
        if (s.zone === 'poche' && sim.inventory.bag) out.push({ label: 'Mettre dans le sac', run: () => this.act({ type: 'deplacer', from, to: 'sac' }) });
        if (s.zone === 'sac' && ITEMS[item].pocket) out.push({ label: 'Mettre en poche', run: () => this.act({ type: 'deplacer', from, to: 'poche' }) });
        if ((other?.def.kind === 'sac' || other?.def.kind === 'coffre') && other.c.bag && this.otherProp) {
          const prop = this.otherProp;
          out.push({ label: other.def.kind === 'coffre' ? 'Ranger dans le coffre' : 'Ranger dans le sac posé', run: () => this.act({ type: 'deposer_dans', prop, from }) });
        }
        out.push({ label: 'Poser au sol', run: () => this.act({ type: 'poser', from }) });
        toolButtons(from);
      } else if (this.otherProp) {
        const prop = this.otherProp;
        const from: Slot = { zone: s.zone === 'autre-poche' ? 'poche' : 'sac', index: s.index };
        out.push({ label: 'Prendre', run: () => this.act({ type: 'prendre_dans', prop, from }) });
      }
    }
    // Véhicule : ses actions (en tête si on a ouvert son panneau : A à la manette = monter ou pousser).
    const vehOut: ActionButton[] = [];
    const veh = this.openedVehicle();
    if (veh) {
      const id = veh.id;
      const f = FRAMES[veh.frame];
      const driving = sim.driving?.v === id;
      const board = (op: 'monter' | 'pousser') => () => {
        const r = sim.act({ type: 'vehicule', v: id, op });
        if (r.message) this.deps.onMessage(r.message, r.ok ? 'info' : 'alerte');
        if (r.ok && sim.driving) this.deps.onClose();
      };
      if (driving) vehOut.push({ label: sim.driving!.mode === 'pousse' ? 'Lâcher les brancards' : 'Descendre', run: () => this.act({ type: 'vehicule', v: id, op: 'descendre' }) });
      else if (uprightness(veh) < 0.6) vehOut.push({ label: `Redresser ${vehicleName(veh)}`, run: () => this.act({ type: 'vehicule', v: id, op: 'redresser' }) });
      else if (f.medium === 'eau') {
        vehOut.push({ label: 'Monter à bord', run: board('monter') });
        vehOut.push({ label: 'Pousser le bateau', run: () => this.act({ type: 'vehicule', v: id, op: 'pousser' }) });
      } else {
        if (f.seat && veh.parts.some((p) => p.kind === 'machine_vapeur')) vehOut.push({ label: 'Monter sur le siège', run: board('monter') });
        vehOut.push({ label: 'Pousser', run: board('pousser') });
      }
      if (veh.parts.some((p) => p.kind === 'machine_vapeur')) {
        const e = veh.engine;
        vehOut.push({ label: 'Charger le foyer (une bûche ou un bâton)', run: () => this.act({ type: 'vehicule', v: id, op: 'bois' }) });
        vehOut.push({ label: 'Verser de l’eau dans la chaudière (un pot)', disabled: e.water > ENGINE.water - 0.5, run: () => this.act({ type: 'vehicule', v: id, op: 'eau' }) });
        vehOut.push(e.lit ? { label: 'Éteindre le foyer', run: () => this.act({ type: 'vehicule', v: id, op: 'eteindre' }) } : { label: 'Allumer le foyer', disabled: e.fuel <= 0, run: () => this.act({ type: 'vehicule', v: id, op: 'allumer' }) });
      }
      if (!driving) {
        for (const sd of f.slots) {
          const p = partAt(veh, sd.id);
          const where = SLOT_LABELS[sd.id] ?? sd.id;
          if (!p) {
            vehOut.push({ label: `Installer ${partName(sd.part, 'un')} (${where})`, run: () => this.act({ type: 'vehicule', v: id, op: 'installer', slot: sd.id }) });
            continue;
          }
          if (p.broken || p.wear >= 0.25) vehOut.push({ label: `Réparer ${partName(p.kind)} (${where}) : ${PARTS[p.kind].repair.map(needLabel).join(', ')}`, run: () => this.act({ type: 'vehicule', v: id, op: 'reparer', slot: sd.id }) });
          vehOut.push({ label: `Retirer ${partName(p.kind)} (${where})`, run: () => this.act({ type: 'vehicule', v: id, op: 'retirer', slot: sd.id }) });
        }
        if (veh.hp < f.hp) vehOut.push({ label: `Réparer ${f.medium === 'eau' ? 'la coque' : 'le châssis'} (${FRAME_REPAIR.needs.map(needLabel).join(', ')})`, run: () => this.act({ type: 'vehicule', v: id, op: 'reparer' }) });
      }
    }
    if (this.otherVehicle) out.unshift(...vehOut);
    else out.push(...vehOut);
    const mach = this.otherMachine();
    if (mach && this.otherProp && mach.kind === 'machine_fixe' && mach.m.engine) {
      const prop = this.otherProp;
      const e = mach.m.engine;
      out.push({ label: 'Charger le foyer (une bûche ou un bâton)', run: () => this.act({ type: 'machine', prop, op: 'bois' }) });
      out.push({ label: 'Verser de l’eau dans la chaudière (un pot)', disabled: e.water > ENGINE.water - 0.5, run: () => this.act({ type: 'machine', prop, op: 'eau' }) });
      out.push(e.lit ? { label: 'Éteindre le foyer', run: () => this.act({ type: 'machine', prop, op: 'eteindre' }) } : { label: 'Allumer le foyer', disabled: e.fuel <= 0, run: () => this.act({ type: 'machine', prop, op: 'allumer' }) });
      if (mach.m.part && (mach.m.part.broken || mach.m.part.wear >= 0.25)) out.push({ label: `Réparer la machine (${PARTS.machine_vapeur.repair.map(needLabel).join(', ')})`, run: () => this.act({ type: 'machine', prop, op: 'reparer' }) });
    }
    const furnace = this.otherFurnace();
    if (furnace && this.otherProp) {
      const prop = this.otherProp;
      const f = furnace.f;
      out.push({ label: `Charger du minerai (${f.ore}/4)`, disabled: f.ore >= 4 || sim.available('minerai_fer') < 1, run: () => this.act({ type: 'fourneau', prop, op: 'minerai' }) });
      out.push({ label: 'Ajouter du bois', run: () => this.act({ type: 'fourneau', prop, op: 'bois' }) });
      if (!f.lit) out.push({ label: 'Allumer le fourneau', disabled: f.fuel <= 0, run: () => this.act({ type: 'allumer', prop }) });
      out.push({ label: 'Actionner le soufflet', disabled: !f.lit || f.ore < 2, run: () => this.act({ type: 'fourneau', prop, op: 'souffler' }) });
      if (f.blooms > 0) out.push({ label: `Retirer la loupe de fer (${f.blooms})`, run: () => this.act({ type: 'fourneau', prop, op: 'loupe' }) });
    }
    const ob = this.openedBuild();
    if (ob && this.otherBuild) {
      const ref = this.otherBuild;
      if (ob.step < ob.steps.length) {
        out.push({ label: `Faire : ${ob.steps[ob.step]!.label.toLowerCase()}`, run: () => this.act({ type: 'chantier', target: ref }) });
        out.push({ label: 'Abandonner le chantier', run: () => this.act({ type: 'annuler_chantier', target: ref }) });
      } else if (ob.piece && ref.kind === 'piece') {
        const p = ob.piece;
        if (PLANS[p.plan].piece === 'porte') out.push({ label: p.open ? 'Fermer la porte' : 'Ouvrir la porte', run: () => this.act({ type: 'piece', s: ref.s, p: ref.p, op: 'porte' }) });
        if (p.burning > 0) out.push({ label: 'Éteindre (pot d’eau)', run: () => this.act({ type: 'piece', s: ref.s, p: ref.p, op: 'eteindre' }) });
        if (p.hp < maxHp(p)) out.push({ label: `Réparer (${repairNeeds(p).map(needLabel).join(', ')})`, run: () => this.act({ type: 'piece', s: ref.s, p: ref.p, op: 'reparer' }) });
        if (p.plan === 'mur_clayonnage' && p.mat === 'bois') out.push({ label: 'Enduire de torchis (3 boules d’argile)', run: () => this.act({ type: 'piece', s: ref.s, p: ref.p, op: 'torchis' }) });
        out.push({ label: 'Démonter', run: () => this.act({ type: 'piece', s: ref.s, p: ref.p, op: 'demonter' }) });
      }
    }
    if (fire && this.otherProp) {
      const prop = this.otherProp;
      if (!fire.fire.lit) out.push({ label: 'Allumer le feu (archet + herbes sèches)', run: () => this.act({ type: 'allumer', prop }) });
      out.push({ label: 'Ajouter du bois', run: () => this.act({ type: 'alimenter', prop }) });
      if (fire.fire.pot) out.push({ label: fire.fire.pot.item.startsWith('viande') ? 'Reprendre la viande' : 'Reprendre le pot', run: () => this.act({ type: 'reprendre_feu', prop }) });
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

  /** Met à jour une liste de boutons ; le DOM n'est recréé que si les libellés ou états changent. */
  private renderButtons(host: HTMLElement, key: ListKey, list: ActionButton[]): void {
    this.lists[key] = list;
    const sig = JSON.stringify(list.map((b) => [b.label, !!b.disabled]));
    if (sig === this.listSig[key]) return;
    this.listSig[key] = sig;
    host.textContent = '';
    list.forEach((b, i) => {
      const el = document.createElement('button');
      el.type = 'button';
      el.textContent = b.label;
      el.disabled = !!b.disabled;
      // Le bouton exécute toujours l'action la plus récente à sa place (état à jour).
      el.addEventListener('click', () => {
        if (performance.now() - this.openedAt < 450) return;
        const cur = this.lists[key][i];
        if (cur && !cur.disabled) cur.run();
      });
      host.appendChild(el);
    });
  }

  private setText(el: HTMLElement, text: string): void {
    if (el.textContent !== text) el.textContent = text;
  }

  private setHtml(el: HTMLElement, html: string): void {
    if (el.innerHTML !== html) el.innerHTML = html;
  }

  private refreshPanels(): void {
    const sim = this.sim!;
    const v = sim.vitals;
    const inv = sim.inventory;
    const lim = limits(v);
    const other = this.otherContainer();
    const sel = this.selectedItem();

    const vol = inv.bag ? bagVolume(inv.bag) : 0;
    const load = carriedMass(inv);
    let title = inv.bag
      ? `Sac : ${vol.toFixed(1).replace('.', ',')} / ${BAG_CAPACITY_L} L · charge portée ${fmtKg(load)}${load > 25 ? ' (trop lourd pour courir)' : ''}`
      : `Pas de sac · ${POCKET_COUNT} poches · charge ${fmtKg(load)}`;
    if (other) title += other.def.kind === 'corps' ? ' · vous fouillez un corps' : ` · ${other.def.kind === 'coffre' ? 'coffre' : 'sac posé'} (${fmtKg(bagContentMass(other.c.bag ?? []))})`;
    const furnace = this.otherFurnace();
    if (furnace) {
      const f = furnace.f;
      title = `Bas fourneau ${f.lit ? `allumé (${Math.ceil(f.fuel / 60)} min de bois, chaleur ${Math.round(f.heat)} %)` : `éteint (${Math.ceil(f.fuel / 60)} min de bois)`} · minerai ${f.ore}/4 · fer ${Math.round((f.work / 24) * 100)} %${f.blooms ? ` · ${f.blooms} loupe prête` : ''} · ${title}`;
    }
    const veh = this.openedVehicle();
    if (veh) {
      const f = FRAMES[veh.frame];
      const slots = f.slots.length;
      const parts = veh.parts.length;
      const broken = veh.parts.filter((p) => p.broken).length;
      const worn = veh.parts.length ? Math.round((veh.parts.reduce((a, p) => a + p.wear, 0) / veh.parts.length) * 100) : 0;
      let line = `${cap(f.label)} · état ${Math.round((veh.hp / f.hp) * 100)} %`;
      if (slots) line += ` · pièces ${parts}/${slots}${broken ? ` (${broken} cassée${broken > 1 ? 's' : ''})` : ''}${parts ? ` · usure moyenne ${worn} %` : ''}`;
      if (veh.parts.some((p) => p.kind === 'machine_vapeur')) {
        const e = veh.engine;
        line += ` · machine : foyer ${e.lit ? 'allumé' : 'éteint'} (${Math.round(e.fuel / 60)} min de bois), pression ${Math.round(e.pressure * 100)} %, eau ${Math.round(e.water)}/${ENGINE.water} L`;
      }
      line += ` · ${Math.round(veh.odo)} m parcourus`;
      title = `${line} · ${title}`;
    }
    const mach = this.otherMachine();
    if (mach) {
      const def = MACHINES[mach.kind];
      const m = mach.m;
      let line = cap(def.label);
      if (def.source) line += ` · ${Math.round(m.power)} W${mach.kind === 'roue_eau' && m.power <= 0 ? ' (pas de courant ici)' : ''}`;
      else line += m.power >= RUNS_AT ? ` · tourne (${Math.round(m.power * 100)} % de sa puissance)` : ` · à l’arrêt : il faut une source d’énergie à moins de 6 m (${def.demand} W)`;
      if (m.engine) line += ` · foyer ${m.engine.lit ? 'allumé' : 'éteint'} (${Math.round(m.engine.fuel / 60)} min), pression ${Math.round(m.engine.pressure * 100)} %, eau ${Math.round(m.engine.water)} L${m.part?.broken ? ' · CASSÉE' : ''}`;
      title = `${line} · ${title}`;
    }
    const ob = this.openedBuild();
    if (ob) {
      const label = PLANS[ob.plan].label;
      if (ob.step < ob.steps.length) title = `Chantier : ${label.toLowerCase()} · étape ${ob.step + 1}/${ob.steps.length} (${ob.steps[ob.step]!.label.toLowerCase()} : ${ob.steps[ob.step]!.needs.map(needLabel).join(', ') || 'rien à apporter'}) · ${title}`;
      else if (ob.piece) title = `${label} · stabilité ${Math.round(ob.piece.support * 100)} % · état ${ob.piece.hp}/${maxHp(ob.piece)}${ob.piece.mat === 'torchis' ? ' · torchis' : ''}${ob.piece.iron ? ' · fixé au fer' : ''}${ob.piece.burning > 0 ? ' · EN FEU' : ''} · ${title}`;
    }
    const fire = this.otherFire();
    if (fire) {
      const f = fire.fire;
      let pot = '';
      if (f.pot?.item === 'pot_cru') pot = ` · pot en cuisson (${Math.min(100, Math.round((f.cook / 90) * 100))} %)`;
      else if (f.pot?.item === 'viande_crue') pot = ` · la viande grille (${Math.min(100, Math.round((f.cook / 45) * 100))} %)`;
      else if (f.pot?.item === 'viande_cuite') pot = ' · la viande est cuite : reprenez-la';
      else if (f.pot?.item === 'pot') pot = f.pot.w === 2 ? ' · l’eau bout' : f.pot.w === 1 ? ` · l’eau chauffe (${Math.min(100, Math.round((f.cook / 30) * 100))} %)` : ' · pot vide sur le feu';
      title = `${fire.def.kind === 'forge' ? 'Forge' : 'Foyer'} ${f.lit ? `allumé${fire.def.kind === 'forge' ? 'e' : ''} (${Math.ceil(f.fuel / 60)} min de bois)` : `éteint${fire.def.kind === 'forge' ? 'e' : ''}`}${pot} · ${title}`;
    }
    this.setText(this.el.title!, title);

    // Objet choisi.
    if (sel) {
      this.setText(this.el.itemName!, `${cap(sel.item ? itemName(sel.item, sel.count) : `${sel.kindLabel}`)} · ${fmtKg(sel.mass)}`);
      const tool = this.toolText(sel.st);
      this.setText(this.el.itemDesc!, `${tool ? `${cap(tool)}. ` : ''}${sel.item ? ITEMS[sel.item].description : 'Trop grand pour le sac : on le porte ou on le traîne.'}`);
    } else {
      this.setText(this.el.itemName!, other ? 'Choisissez un objet à prendre.' : 'Case vide.');
      this.setText(this.el.itemDesc!, sim.gesture ? sim.gesture.label : 'Touchez un objet, puis une action.');
    }
    this.buttons = this.itemButtons();
    this.renderButtons(this.el.itemActions!, 'item', this.buttons);

    // Corps.
    const meter = (label: string, value: number, color: string, text: string) =>
      `<span>${label}</span><span title="${text}"><span class="meter"><span style="width:${Math.max(0, Math.min(100, value)).toFixed(0)}%;background:${color}"></span></span></span>`;
    const notes: string[] = [];
    if (lim.bleeding > 0) notes.push('vous saignez');
    if (lim.fever > 0) notes.push('fièvre');
    if (v.posture === 'assis') notes.push('assis');
    this.setHtml(
      this.el.vitals!,
      [
        meter('Santé', v.health, '#c0503c', `${Math.round(v.health)} / 100`),
        meter('Énergie', v.energy, '#d9b54a', `${Math.round(v.energy)} / 100`),
        meter('Fatigue', v.fatigue, '#5a7fd0', `${Math.round(v.fatigue)} / 100`),
        `<span>Douleur</span><span>${painLabel(lim.pain)}${notes.length ? ` · ${notes.join(', ')}` : ''}</span>`,
      ].join(''),
    );
    for (const [zone, el] of this.zones) {
      const list = v.injuries.filter((i) => i.zone === zone);
      let cls = '';
      if (list.some((i) => bleedRate(i) > 0)) cls = 'saigne';
      else if (list.some((i) => i.infection > 0)) cls = 'infecte';
      else if (list.some((i) => i.kind === 'fracture' && !i.splinted)) cls = 'fracture';
      else if (list.some((i) => i.kind === 'entorse' && !i.bandaged)) cls = 'entorse';
      else if (list.some((i) => i.kind === 'contusion' || i.kind === 'commotion')) cls = 'contusion';
      else if (list.length) cls = 'soigne';
      const full = `${cls}${this.zone === zone ? ' sel' : ''}`;
      if (el.getAttribute('class') !== full) el.setAttribute('class', full);
    }
    const zone = this.zone ?? v.injuries[0]?.zone ?? null;
    if (zone) {
      const { lines, buttons } = this.zoneButtons(zone);
      this.setHtml(this.zoneLines, `<p><strong>${cap(ZONE_LABELS[zone])}</strong></p>${lines.map((l) => `<p>${l}</p>`).join('')}`);
      this.renderButtons(this.zoneButtons_, 'zone', buttons);
    } else {
      this.setHtml(this.zoneLines, '<p>Aucune blessure. Touchez une partie du corps pour l’examiner.</p>');
      this.renderButtons(this.zoneButtons_, 'zone', []);
    }
    this.renderButtons(this.el.bodyActions!, 'body', this.bodyButtons());
    this.refreshCraft();
    this.refreshBuild();
  }

  /** Plans connus, dans l'ordre : pièces puis installations. */
  private knownPlans(): PlanId[] {
    const k = this.sim!.knowledge.plans;
    return [...PIECE_PLANS, ...INSTALL_PLANS, ...VEHICLE_PLANS].filter((id) => k.includes(id));
  }

  /** Onglet « Construire » : les plans connus, leurs matériaux, et un bouton pour tracer chacun. */
  private refreshBuild(): void {
    const plans = this.knownPlans();
    if (this.planIndex >= plans.length) this.planIndex = Math.max(0, plans.length - 1);
    const total = (id: PlanId): Need[] => {
      const m = new Map<ItemId, number>();
      for (const st of PLANS[id].steps) for (const [item, n] of st.needs) m.set(item, (m.get(item) ?? 0) + n);
      return [...m];
    };
    const tools = (id: PlanId) => [...new Set(PLANS[id].steps.map((st) => st.tool).filter((t) => t !== null))].map((t) => TOOL_NEEDS[t!]);
    this.renderButtons(
      this.el.plans!,
      'plans',
      plans.map((id, i) => ({
        label: `${i === this.planIndex && this.deps.input.lastDevice === 'gamepad' ? '▶ ' : ''}Tracer : ${PLANS[id].label.toLowerCase()} (${total(id).map(needLabel).join(', ') || 'rien à apporter'})`,
        run: () => this.deps.onBuild(id),
      })),
    );
    const unknown = PLAN_IDS.length - plans.length;
    const withTools = plans.filter((id) => tools(id).length);
    this.setHtml(
      this.el.buildInfo!,
      `<p>Tracez un plan, puis apportez les matériaux (sur vous ou posés à côté du chantier) et faites chaque étape avec « Utiliser » en le visant. Les pièces s’accrochent les unes aux autres sur une grille de 2 m ; un plancher se pose sur pilotis au-dessus d’une pente ou de l’eau.</p>` +
        (withTools.length ? `<p>Outils : ${withTools.map((id) => `${PLANS[id].label.toLowerCase()} (${tools(id).join(', ')})`).join(' ; ')}.</p>` : '') +
        (unknown > 0 ? `<p class="note">${unknown} plan${unknown > 1 ? 's' : ''} encore inconnu${unknown > 1 ? 's' : ''} : de nouveaux matériaux donneront des idées.</p>` : ''),
    );
  }

  /** Onglets « Fabriquer » (plan de travail, étapes) et « Carnet » (recettes). */
  private refreshCraft(): void {
    const sim = this.sim!;
    const bench = sim.inventory.bench;
    this.renderButtons(
      this.el.benchList!,
      'bench',
      bench.map((st, index) => ({ label: `Reprendre ${itemName(st.item, st.count)}`, run: () => this.act({ type: 'etabli_reprendre', index }) })),
    );
    const info = sim.benchRecipe();
    const craft: ActionButton[] = [];
    if (bench.length === 0) {
      this.setHtml(this.el.recipe!, '<p>Le plan de travail est vide. Dans le sac, choisissez une pièce puis « Poser sur le plan de travail ».</p>');
      this.setText(this.el.craftHint!, '');
    } else if (!info) {
      this.setHtml(this.el.recipe!, '<p>Aucune recette connue ne correspond à ces pièces.</p>');
      this.setText(this.el.craftHint!, experimentHint(bench, sim.knowledge));
      craft.push({ label: 'Essayer d’assembler', run: () => this.act({ type: 'fabriquer' }) });
    } else {
      const r = info.recipe;
      const steps = r.steps
        .map((st, i) => {
          const mark = i < info.step ? '✓' : i === info.step ? '→' : '·';
          const tool = st.tool ? ` — ${TOOL_NEEDS[st.tool]} ${sim.hasTool(st.tool) ? '✓' : '✗'}` : '';
          return `<li>${mark} ${st.label}${tool}</li>`;
        })
        .join('');
      this.setHtml(this.el.recipe!, `<p><strong>${info.known ? r.label : 'Recette inconnue…'}</strong>${info.known ? '' : ' (essayez : elle se révélera)'}</p><ol class="steps">${steps}</ol>`);
      const next = r.steps[info.step];
      this.setText(this.el.craftHint!, r.boiledWater ? 'Il faut un pot d’eau bouillante dans le sac ou en main.' : '');
      craft.push({
        label: info.known && next ? `Faire : ${next.label.toLowerCase()} (${Math.round(next.seconds)} s)` : 'Essayer d’assembler',
        disabled: info.known && next ? !sim.hasTool(next.tool) : false,
        run: () => this.act({ type: 'fabriquer' }),
      });
    }
    if (sim.gesture) craft.push({ label: 'Interrompre', run: () => this.act({ type: 'interrompre' }) });
    this.renderButtons(this.el.craftActions!, 'craft', craft);
    // Carnet.
    const k = sim.knowledge;
    const lvl = skillLevel(k.xp);
    const known = k.known.map((id) => {
      const r = RECIPES[id];
      return `<li><strong>${r.label}</strong> : ${r.inputs.map(([item, n]) => itemName(item, n)).join(' + ')} · ${r.steps.length} étape${r.steps.length > 1 ? 's' : ''}</li>`;
    });
    const hinted = k.hinted.map((id) => `<li><em>${RECIPES[id].hint}</em></li>`);
    const unknown = RECIPE_IDS.length - k.known.length - k.hinted.length;
    this.setHtml(
      this.el.carnet!,
      `<p>Fabrication : niveau ${lvl} (${Math.round(k.xp)} points). Plus le niveau monte, meilleurs sont les objets et plus les gestes sont rapides.</p>` +
        `<h4>Recettes connues</h4><ul>${known.join('')}</ul>` +
        `<h4>Plans de construction</h4><ul>${this.knownPlans().map((id) => `<li><strong>${PLANS[id].label}</strong> : ${PLANS[id].description}</li>`).join('')}</ul>` +
        (hinted.length ? `<h4>Idées</h4><ul>${hinted.join('')}</ul>` : '') +
        (unknown > 0 ? `<p class="note">${unknown} recette${unknown > 1 ? 's' : ''} encore inconnue${unknown > 1 ? 's' : ''} : ramassez de nouveaux matériaux, expérimentez sur le plan de travail.</p>` : ''),
    );
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
      all: [...this.lists.item, ...this.lists.zone, ...this.lists.body, ...this.lists.bench, ...this.lists.craft, ...this.lists.plans].map((b) => (b.disabled ? `(${b.label})` : b.label)),
      build: this.otherBuild,
    };
  }

  /** Choisit une case (tests). */
  pick(slot: BagSlot): void {
    this.select(slot);
  }

  /** Clique une action par son libellé (tests). */
  run(label: string): boolean {
    const b = [...this.lists.item, ...this.lists.zone, ...this.lists.body, ...this.lists.bench, ...this.lists.craft, ...this.lists.plans].find((x) => x.label === label || (label.endsWith('…') && x.label.startsWith(label.slice(0, -1))));
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
