// Physique des véhicules (phase 7). Les chariots roulent grâce au contrôleur de véhicule de Rapier
// (rayons de suspension, adhérence, force motrice, freins, direction) ; les bateaux flottent grâce
// à la poussée d'Archimède calculée en plusieurs points de la coque, freinés par l'eau et poussés
// par le courant. Comme les objets, un véhicule n'a de corps physique que près du joueur.

import { WATER_LEVEL } from './constants';
import { GROUP_OBSTACLE, GROUP_TERRAIN, type PhysicsWorld, RAPIER, VEHICLE_GROUPS, interactionGroups } from './physics';
import { chunkCoord, type Terrain } from './terrain';
import { FRAMES, type VehicleState, type WheelInfo, enginePower, massProps, onChocks, toWorld, uprightness, waterDrive, wheelsOf } from './vehicles';

/** Commande du conducteur : accélérer (−1 à 1), tourner (−1 gauche à 1 droite), freiner. */
export interface DriveInput {
  throttle: number;
  steer: number;
  brake: boolean;
  /** Le joueur court (chariot poussé) : plus vite, plus fatigant. */
  sprint: boolean;
  /** Force humaine disponible (0 à 1 : endurance). */
  effort: number;
}

/** Ce qu'a fait le véhicule pendant le pas : distance, vitesse, contact avec l'eau. */
export interface DriveResult {
  dist: number;
  speed: number;
  afloat: boolean;
  /** Travail humain fourni (J) : pour l'endurance. */
  work: number;
}

/** Choc à partir duquel un véhicule s'abîme (force de contact, N). */
export const VEHICLE_IMPACT = 6000;
const WHEEL_QUERY = interactionGroups(0xffff, GROUP_TERRAIN | GROUP_OBSTACLE);

interface Live {
  body: RAPIER.RigidBody;
  colliders: RAPIER.Collider[];
  ctl: RAPIER.DynamicRayCastVehicleController | null;
  wheels: WheelInfo[];
  sig: string;
  /** Corps tout juste créé : le contrôleur des roues attend un premier pas du monde. */
  fresh: boolean;
}

export class VehiclePhysics {
  private readonly live = new Map<string, Live>();
  private readonly byHandle = new Map<number, string>();

  constructor(
    private readonly phys: PhysicsWorld,
    private readonly terrain: Terrain,
  ) {}

  /** Véhicule auquel appartient un collisionneur, ou null. */
  vehicleOf(handle: number): string | null {
    return this.byHandle.get(handle) ?? null;
  }

  has(id: string): boolean {
    return this.live.has(id);
  }

  body(id: string): RAPIER.RigidBody | null {
    return this.live.get(id)?.body ?? null;
  }

  private signature(v: VehicleState, driver: boolean): string {
    const m = massProps(v, driver);
    return `${Math.round(m.mass)}|${v.parts.map((p) => `${p.slot}${p.broken ? 'x' : ''}`).join(',')}`;
  }

  /** Crée ou retire les corps selon la zone physique chargée ; reconstruit si les pièces ont changé. */
  sync(list: VehicleState[], driverOf: string | null): void {
    const keep = new Set<string>();
    for (const v of list) {
      const inside = this.phys.hasChunk(chunkCoord(v.x), chunkCoord(v.z));
      const lv = this.live.get(v.id);
      if (!inside) {
        if (lv) this.remove(v.id);
        continue;
      }
      keep.add(v.id);
      const sig = this.signature(v, driverOf === v.id);
      if (!lv) this.create(v, driverOf === v.id, null);
      else if (lv.sig !== sig) {
        const vel = lv.body.linvel();
        const ang = lv.body.angvel();
        this.remove(v.id);
        this.create(v, driverOf === v.id, { vel, ang });
      }
    }
    for (const id of [...this.live.keys()]) if (!keep.has(id)) this.remove(id);
  }

  private create(v: VehicleState, driver: boolean, keepVel: { vel: RAPIER.Vector; ang: RAPIER.Vector } | null): void {
    const f = FRAMES[v.frame];
    const world = this.phys.world;
    const mp = massProps(v, driver);
    // Un châssis à roues incomplet reste calé (immobile) ; sinon le corps est mobile.
    const chocks = onChocks(v);
    const desc = (chocks ? RAPIER.RigidBodyDesc.fixed() : RAPIER.RigidBodyDesc.dynamic())
      .setTranslation(v.x, v.y, v.z)
      .setRotation({ x: v.qx, y: v.qy, z: v.qz, w: v.qw })
      .setAdditionalMassProperties(mp.mass, mp.com, mp.inertia, { x: 0, y: 0, z: 0, w: 1 })
      .setLinearDamping(f.medium === 'eau' ? 0.05 : 0.08)
      .setAngularDamping(f.medium === 'eau' ? 0.9 : 0.4)
      .setCcdEnabled(true)
      .setCanSleep(true);
    const body = world.createRigidBody(desc);
    if (keepVel && !chocks) {
      body.setLinvel(keepVel.vel, true);
      body.setAngvel(keepVel.ang, true);
    }
    const colliders: RAPIER.Collider[] = [];
    const c = world.createCollider(
      RAPIER.ColliderDesc.cuboid(f.half.x, f.half.y, f.half.z)
        .setTranslation(0, f.cy, 0)
        .setDensity(0)
        .setFriction(f.medium === 'eau' ? 0.6 : 0.5)
        .setCollisionGroups(VEHICLE_GROUPS)
        .setActiveEvents(RAPIER.ActiveEvents.CONTACT_FORCE_EVENTS)
        .setContactForceEventThreshold(VEHICLE_IMPACT),
      body,
    );
    colliders.push(c);
    this.byHandle.set(c.handle, v.id);
    // Machine à vapeur : un volume solide sur le plateau (on le heurte).
    const engine = v.parts.find((p) => p.kind === 'machine_vapeur');
    const slot = engine ? f.slots.find((s) => s.id === engine.slot) : undefined;
    if (slot) {
      const ec = world.createCollider(RAPIER.ColliderDesc.cylinder(0.45, 0.38).setTranslation(slot.x, slot.y, slot.z).setDensity(0).setCollisionGroups(VEHICLE_GROUPS), body);
      colliders.push(ec);
      this.byHandle.set(ec.handle, v.id);
    }
    let ctl: RAPIER.DynamicRayCastVehicleController | null = null;
    const wheels = f.medium === 'terre' && !chocks ? wheelsOf(v) : [];
    if (f.medium === 'terre' && f.wheel && wheels.length) {
      ctl = world.createVehicleController(body);
      ctl.indexUpAxis = 1;
      ctl.setIndexForwardAxis = 2;
      // Raideur (par kg de véhicule) : à vide, chaque suspension s'enfonce de 45 % de sa course.
      const rest = f.wheel.rest;
      const slots = f.slots.filter((s) => s.part === 'roue' || s.part === 'petite_roue').length;
      const stiff = 9.81 / (slots * 0.45 * rest);
      wheels.forEach((w, i) => {
        const r = w.broken ? f.wheel!.radius * 0.7 : f.wheel!.radius;
        ctl!.addWheel({ x: w.x, y: w.y + rest * 0.55, z: w.z }, { x: 0, y: -1, z: 0 }, { x: -1, y: 0, z: 0 }, rest, r);
        ctl!.setWheelSuspensionStiffness(i, stiff);
        ctl!.setWheelSuspensionCompression(i, 2.4);
        ctl!.setWheelSuspensionRelaxation(i, 2.8);
        ctl!.setWheelMaxSuspensionForce(i, mp.mass * 9.81 * 2);
        ctl!.setWheelFrictionSlip(i, w.broken ? 0.4 : 1.6);
        ctl!.setWheelSideFrictionStiffness(i, 1.2);
      });
    }
    this.live.set(v.id, { body, colliders, ctl, wheels, sig: this.signature(v, driver), fresh: true });
  }

  private remove(id: string): void {
    const lv = this.live.get(id);
    if (!lv) return;
    for (const c of lv.colliders) this.byHandle.delete(c.handle);
    if (lv.ctl) this.phys.world.removeVehicleController(lv.ctl);
    this.phys.world.removeRigidBody(lv.body);
    this.live.delete(id);
  }

  /** Forces et commandes avant le pas physique. input null : personne aux commandes. */
  preStep(v: VehicleState, input: DriveInput | null, dt: number): void {
    const lv = this.live.get(v.id);
    if (!lv) return;
    const f = FRAMES[v.frame];
    const body = lv.body;
    // Un véhicule garé dort ; on le réveille dès qu'on le conduit.
    if (input && body.isSleeping()) body.wakeUp();
    if (f.medium === 'terre') {
      const ctl = lv.ctl;
      if (!ctl) return;
      if (lv.fresh) {
        lv.fresh = false;
        return;
      }
      const speed = this.speedOf(v.id);
      const power = input ? enginePower(v) : 0;
      const upright = uprightness(v) > 0.5;
      const mass = massProps(v, !!input).mass;
      let force = 0;
      if (input && upright) {
        if (power > 0) {
          // Moteur : puissance constante, force limitée par l'adhérence ; marche arrière lente.
          if (input.throttle > 0 && speed < f.maxEngine) force = Math.min(3500, power / Math.max(1.2, Math.abs(speed))) * input.throttle;
          else if (input.throttle < 0 && speed > -1.5) force = 1200 * input.throttle;
        } else {
          // À la force des bras : on pousse (ou on tire) le chariot.
          const cap = f.maxHuman * (input.sprint ? 1.5 : 1);
          if ((input.throttle > 0 && speed < cap) || (input.throttle < 0 && speed > -cap * 0.6)) force = f.human * input.throttle * input.effort * (input.sprint ? 1.3 : 1);
        }
      }
      const n = lv.wheels.length;
      const driven = lv.wheels.filter((w) => !w.locked && (power > 0 ? !w.front : true)).length;
      // Frein (impulsion maximale par pas, N·s) : une fraction du poids porté par chaque roue.
      const perWheel = (mass * 9.81 * dt) / Math.max(1, n);
      for (let i = 0; i < n; i++) {
        const w = lv.wheels[i]!;
        const drives = force !== 0 && !w.locked && (power > 0 ? !w.front : true);
        ctl.setWheelEngineForce(i, drives ? force / Math.max(1, driven) : 0);
        ctl.setWheelSteering(i, w.front && input ? input.steer * f.steer : 0);
        // Freins : demandés, essieu cassé (la roue frotte), roues calées quand personne ne conduit ;
        // sinon la résistance au roulement (plus forte pour une roue cassée).
        let k = w.broken ? 0.3 : 0.05;
        if (w.locked) k = 0.45;
        if (input?.brake) k = Math.max(k, 0.55);
        if (!input) k = 0.9;
        ctl.setWheelBrake(i, perWheel * k);
      }
      ctl.updateVehicle(dt, undefined, WHEEL_QUERY);
      this.rollover(lv, v, !!input, dt);
      return;
    }
    // Bateau : flottaison point par point, traînée, courant, propulsion.
    const hull = f.hull!;
    body.resetForces(true);
    body.resetTorques(true);
    const share = (1000 * 9.81 * hull.volume) / hull.points.length;
    let submerged = 0;
    for (const [px, pz] of hull.points) {
      const p = toWorld(v, { x: px, y: hull.bottom, z: pz });
      const depth = WATER_LEVEL - p.y;
      if (depth <= 0) continue;
      const sub = Math.min(1, depth / hull.height);
      submerged += sub;
      body.addForceAtPoint({ x: 0, y: share * sub, z: 0 }, p, true);
    }
    if (submerged <= 0) return;
    const wet = Math.min(1, submerged / hull.points.length / 0.25);
    const lin = body.linvel();
    const cur = this.terrain.currentAt(v.x, v.z);
    // Vitesse par rapport à l'eau, dans le repère du bateau.
    const rx = lin.x - cur.x;
    const rz = lin.z - cur.z;
    const yawFx = 2 * (v.qx * v.qz + v.qw * v.qy);
    const yawFz = 1 - 2 * (v.qx * v.qx + v.qy * v.qy);
    const fl = Math.hypot(yawFx, yawFz) || 1;
    const fx = yawFx / fl;
    const fz = yawFz / fl;
    const along = rx * fx + rz * fz;
    const side = rx * fz - rz * fx;
    const dLong = -hull.dragLong * along * Math.abs(along) * wet;
    const dLat = -hull.dragLat * side * Math.abs(side) * wet;
    let thrust = 0;
    let turn = 0;
    if (input && uprightness(v) > 0.3) {
      if (waterDrive(v) && enginePower(v) > 0) {
        const p = enginePower(v);
        if (input.throttle > 0 && along < f.maxEngine) thrust = Math.min(900, p / Math.max(1, Math.abs(along))) * input.throttle;
        else if (input.throttle < 0) thrust = 400 * input.throttle;
      } else {
        const cap = f.maxHuman * (input.sprint ? 1.25 : 1);
        if ((input.throttle > 0 && along < cap) || (input.throttle < 0 && along > -cap * 0.5)) thrust = f.human * input.throttle * input.effort;
      }
      // Tourner : la pagaie (ou la barre) ; le gouvernail aide quand on avance.
      const rudder = v.parts.some((p) => p.kind === 'gouvernail' && !p.broken);
      turn = input.steer * (f.steer + (rudder ? Math.abs(along) * 220 : 0)) * (thrust !== 0 || Math.abs(along) > 0.2 || !rudder ? 1 : 0.4);
    }
    const tx = fx * (dLong + thrust) + fz * dLat;
    const tz = fz * (dLong + thrust) - fx * dLat;
    body.addForce({ x: tx, y: -lin.y * 900 * wet, z: tz }, true);
    // Sans pagayer, l'eau freine la rotation.
    const ang = body.angvel();
    body.addTorque({ x: 0, y: turn - ang.y * 400 * wet, z: 0 }, true);
  }

  /**
   * Renversement. Le modèle à rayons garde les roues collées au sol : il ne fait pas basculer un
   * véhicule. On ajoute donc le couple qui manque quand la force latérale (dévers, virage serré)
   * dépasse ce que la voie peut retenir : centre de gravité haut et voie étroite → il se renverse.
   */
  private rollover(lv: Live, v: VehicleState, driver: boolean, dt: number): void {
    const ctl = lv.ctl!;
    let contact = 0;
    for (let i = 0; i < lv.wheels.length; i++) if (ctl.wheelIsInContact(i)) contact++;
    if (contact < 2) return;
    const { x: qx, y: qy, z: qz, w: qw } = lv.body.rotation();
    const right = { x: 1 - 2 * (qy * qy + qz * qz), y: 2 * (qx * qy + qw * qz), z: 2 * (qx * qz - qw * qy) };
    const up = { x: 2 * (qx * qy - qw * qz), y: 1 - 2 * (qx * qx + qz * qz), z: 2 * (qy * qz + qw * qx) };
    const fwd = { x: 2 * (qx * qz + qw * qy), y: 2 * (qy * qz - qw * qx), z: 1 - 2 * (qx * qx + qy * qy) };
    const l = lv.body.linvel();
    const a = lv.body.angvel();
    // Gravité apparente : la pesanteur moins l'accélération centripète (ω × v).
    const gx = -(a.y * l.z - a.z * l.y);
    const gy = -9.81 - (a.z * l.x - a.x * l.z);
    const gz = -(a.x * l.y - a.y * l.x);
    const lateral = gx * right.x + gy * right.y + gz * right.z;
    const vertical = -(gx * up.x + gy * up.y + gz * up.z);
    const mp = massProps(v, driver);
    const track = Math.max(...lv.wheels.map((w) => Math.abs(w.x)));
    const excess = Math.abs(lateral) * Math.max(0.2, mp.com.y) - Math.max(0, vertical) * track;
    if (excess <= 0) return;
    const k = mp.mass * excess * dt * Math.sign(lateral);
    lv.body.applyTorqueImpulse({ x: -fwd.x * k, y: -fwd.y * k, z: -fwd.z * k }, true);
  }

  /** Lit la position après le pas physique ; renvoie le chemin parcouru. */
  postStep(v: VehicleState, input: DriveInput | null): DriveResult {
    const lv = this.live.get(v.id);
    if (!lv) return { dist: 0, speed: 0, afloat: false, work: 0 };
    const t = lv.body.translation();
    const r = lv.body.rotation();
    const dist = Math.hypot(t.x - v.x, t.z - v.z);
    v.x = t.x;
    v.y = t.y;
    v.z = t.z;
    v.qx = r.x;
    v.qy = r.y;
    v.qz = r.z;
    v.qw = r.w;
    const lin = lv.body.linvel();
    const speed = Math.hypot(lin.x, lin.z);
    const f = FRAMES[v.frame];
    const afloat = f.medium === 'eau' && WATER_LEVEL - toWorld(v, { x: 0, y: f.hull!.bottom, z: 0 }).y > 0.02;
    // Effort humain : force × distance (pousser, pagayer).
    const human = input && !(f.medium === 'terre' ? enginePower(v) > 0 : waterDrive(v) && enginePower(v) > 0);
    const work = human ? f.human * Math.abs(input!.throttle) * input!.effort * dist : 0;
    return { dist, speed, afloat, work };
  }

  /** Vitesse dans le sens de la marche (m/s ; négative en marche arrière). */
  speedOf(id: string): number {
    const lv = this.live.get(id);
    if (!lv) return 0;
    const l = lv.body.linvel();
    const r = lv.body.rotation();
    const fx = 2 * (r.x * r.z + r.w * r.y);
    const fy = 2 * (r.y * r.z - r.w * r.x);
    const fz = 1 - 2 * (r.x * r.x + r.y * r.y);
    return l.x * fx + l.y * fy + l.z * fz;
  }

  /** Vitesse (m/s) et vitesse de rotation (rad/s) du corps. */
  motion(id: string): { vx: number; vy: number; vz: number; spin: number } | null {
    const lv = this.live.get(id);
    if (!lv) return null;
    const l = lv.body.linvel();
    return { vx: l.x, vy: l.y, vz: l.z, spin: lv.body.angvel().y };
  }

  /** Roues pour l'affichage : rotation, braquage, longueur de suspension. */
  wheelStates(id: string): Array<{ slot: string; spin: number; steer: number; susp: number }> {
    const lv = this.live.get(id);
    if (!lv?.ctl) return [];
    const ctl = lv.ctl;
    return lv.wheels.map((w, i) => ({ slot: w.slot, spin: ctl.wheelRotation(i) ?? 0, steer: ctl.wheelSteering(i) ?? 0, susp: ctl.wheelSuspensionLength(i) ?? 0 }));
  }

  /** Remet le véhicule d'aplomb (renversé, chaviré), en gardant son cap. */
  rightUp(v: VehicleState): void {
    const yaw = Math.atan2(2 * (v.qx * v.qz + v.qw * v.qy), 1 - 2 * (v.qx * v.qx + v.qy * v.qy));
    v.qx = 0;
    v.qy = Math.sin(yaw / 2);
    v.qz = 0;
    v.qw = Math.cos(yaw / 2);
    const f = FRAMES[v.frame];
    v.y = f.medium === 'eau' ? Math.max(WATER_LEVEL + 0.1, this.terrain.heightAt(v.x, v.z) + 0.4) : this.terrain.heightAt(v.x, v.z) + 0.3;
    const lv = this.live.get(v.id);
    if (lv) {
      lv.body.setTranslation({ x: v.x, y: v.y, z: v.z }, true);
      lv.body.setRotation({ x: 0, y: v.qy, z: 0, w: v.qw }, true);
      lv.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
      lv.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
    }
  }

  /** Freine brutalement (collision) : la vitesse est multipliée par k. */
  damp(id: string, k: number): void {
    const lv = this.live.get(id);
    if (!lv || lv.body.isFixed()) return;
    const l = lv.body.linvel();
    lv.body.setLinvel({ x: l.x * k, y: l.y, z: l.z * k }, true);
  }

  /** Pousse un véhicule (bateau échoué) dans une direction. */
  shove(id: string, dx: number, dz: number, impulse: number): void {
    const lv = this.live.get(id);
    if (!lv) return;
    lv.body.applyImpulse({ x: dx * impulse, y: impulse * 0.1, z: dz * impulse }, true);
  }

  dispose(): void {
    for (const id of [...this.live.keys()]) this.remove(id);
  }
}
