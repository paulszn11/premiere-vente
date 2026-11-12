import { Terrain } from '../../src/shared/terrain';
import type { InputCmd } from '../../src/shared/movement';

/** Terrain plat à l'altitude donnée, sans arbres. */
export class FlatTerrain extends Terrain {
  constructor(private readonly level = 10) {
    super(1);
  }
  override heightAt(): number {
    return this.level;
  }
  override forestDensity(): number {
    return -1;
  }
}

/** Terrain plat (altitude 0) pour x ≤ 0, puis pente de coefficient `slope` pour x > 0. */
export class SlopeTerrain extends Terrain {
  constructor(private readonly slope: number) {
    super(2);
  }
  override heightAt(x: number): number {
    return x > 0 ? x * this.slope : 0;
  }
  override forestDensity(): number {
    return -1;
  }
}

let seq = 0;
export function cmd(wx: number, wz: number, buttons = 0): InputCmd {
  seq++;
  return { seq, wx, wz, yaw: 0, pitch: 0, buttons };
}
