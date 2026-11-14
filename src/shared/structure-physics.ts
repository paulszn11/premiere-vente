// Collisions des constructions (phase 5) : chaque pièce terminée devient un collisionneur fixe,
// seulement près du joueur (§ 14.5). Les échelles sont des surfaces escaladables (groupe du
// terrain) ; les murs, non. Les chocs violents d'objets sur une pièce sont signalés (dégâts).

import { type BuildState, PLANS, isDone, pieceBoxes, stiltPosts } from './building';
import { OBSTACLE_GROUPS, type PhysicsWorld, RAPIER, TERRAIN_GROUPS } from './physics';

/** Force de contact (N) au-delà de laquelle un choc abîme une pièce : un objet posé ne fait rien. */
export const IMPACT_THRESHOLD = 700;

export class StructurePhysics {
  private colliders: RAPIER.Collider[] = [];
  private readonly byHandle = new Map<number, { s: string; p: number }>();
  private builtVersion = -1;
  private centers: Array<{ x: number; z: number }> = [];

  constructor(
    private readonly phys: PhysicsWorld,
    private readonly bs: BuildState,
  ) {}

  /** Pièce correspondant à un collisionneur, ou null. */
  pieceOf(handle: number): { s: string; p: number } | null {
    return this.byHandle.get(handle) ?? null;
  }

  get count(): number {
    return this.colliders.length;
  }

  /** Reconstruit les collisions si les constructions ont changé ou si le joueur s'est éloigné. */
  sync(x: number, z: number, radius = 120): void {
    this.syncMany([{ x, z }], radius);
  }

  /** Même chose autour de plusieurs joueurs (phase 8) : les pièces proches de l'un d'eux ont leurs collisions. */
  syncMany(points: ReadonlyArray<{ x: number; z: number }>, radius = 120): void {
    const moved = points.length !== this.centers.length || points.some((q, i) => !(Math.hypot(q.x - this.centers[i]!.x, q.z - this.centers[i]!.z) < radius / 3));
    if (this.builtVersion === this.bs.version && !moved) return;
    this.clear();
    this.centers = points.map((q) => ({ x: q.x, z: q.z }));
    this.builtVersion = this.bs.version;
    const near = (sx: number, sz: number) => this.centers.some((c) => Math.hypot(sx - c.x, sz - c.z) <= radius);
    const world = this.phys.world;
    for (const s of this.bs.structures) {
      if (!near(s.x, s.z)) continue;
      for (const p of s.pieces) {
        if (!isDone(p)) continue;
        const ladder = PLANS[p.plan].piece === 'echelle';
        for (const b of pieceBoxes(s, p, true)) {
          const desc = RAPIER.ColliderDesc.cuboid(b.hx, b.hy, b.hz)
            .setTranslation(b.x, b.y, b.z)
            .setRotation({ x: 0, y: Math.sin(b.yaw / 2), z: 0, w: Math.cos(b.yaw / 2) })
            .setCollisionGroups(ladder ? TERRAIN_GROUPS : OBSTACLE_GROUPS)
            .setActiveEvents(RAPIER.ActiveEvents.CONTACT_FORCE_EVENTS)
            .setContactForceEventThreshold(IMPACT_THRESHOLD);
          const c = world.createCollider(desc);
          this.colliders.push(c);
          this.byHandle.set(c.handle, { s: s.id, p: p.id });
        }
        for (const post of stiltPosts(s, p, (px, pz) => this.phys.terrain.heightAt(px, pz))) {
          const half = (post.top - post.bottom) / 2;
          const c = world.createCollider(
            RAPIER.ColliderDesc.cylinder(half, 0.08)
              .setTranslation(post.x, post.bottom + half, post.z)
              .setCollisionGroups(OBSTACLE_GROUPS)
              .setActiveEvents(RAPIER.ActiveEvents.CONTACT_FORCE_EVENTS)
              .setContactForceEventThreshold(IMPACT_THRESHOLD),
          );
          this.colliders.push(c);
          this.byHandle.set(c.handle, { s: s.id, p: p.id });
        }
      }
    }
    this.phys.markDirty();
  }

  /** Force la reconstruction au prochain appel (par exemple après un rechargement). */
  invalidate(): void {
    this.builtVersion = -1;
  }

  private clear(): void {
    for (const c of this.colliders) this.phys.world.removeCollider(c, false);
    this.colliders = [];
    this.byHandle.clear();
  }

  dispose(): void {
    this.clear();
  }
}
