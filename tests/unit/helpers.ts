import type { GeoSample } from '../../src/shared/geography';
import type { InputCmd } from '../../src/shared/movement';
import { Terrain } from '../../src/shared/terrain';

function plainSample(height: number): GeoSample {
  return { height, biome: 'plateau', valley: 0, east: 0, south: 0, west: 0, matobo: 0, border: 0, river: 0, bank: 0, wetland: 0, kopje: 0, forest: 0 };
}

/** Terrain de test défini par une fonction de hauteur, sans flore ni objets. */
export class FnTerrain extends Terrain {
  constructor(
    private readonly fn: (x: number, z: number) => number,
    private readonly biomeSample: Partial<GeoSample> = {},
  ) {
    super(1);
    this.floraEnabled = false;
  }
  override heightAt(x: number, z: number): number {
    return this.fn(x, z);
  }
  override sampleInto(x: number, z: number): GeoSample {
    return { ...plainSample(this.fn(x, z)), ...this.biomeSample };
  }
  override currentAt(_x: number, _z: number): { x: number; z: number } {
    return { x: 0, z: 0 };
  }
}

/** Terrain plat à l'altitude donnée. */
export class FlatTerrain extends FnTerrain {
  constructor(level = 10, biome: Partial<GeoSample> = {}) {
    super(() => level, biome);
  }
}

/** Terrain plat (altitude 0) pour x ≤ 0, puis pente de coefficient `slope` pour x > 0. */
export class SlopeTerrain extends FnTerrain {
  constructor(slope: number) {
    super((x) => (x > 0 ? x * slope : 0));
  }
}

/** Plat à `floor` pour x ≤ 0, falaise à 75° jusqu'à `floor + height`, puis plateau. */
export class CliffTerrain extends FnTerrain {
  constructor(floor = 5, height = 6) {
    super((x) => {
      if (x <= 0) return floor;
      const h = floor + x * 3.73;
      return h > floor + height ? floor + height : h;
    });
  }
}

let seq = 0;
export function cmd(wx: number, wz: number, buttons = 0, yaw = 0, pitch = 0): InputCmd {
  seq++;
  return { seq, wx, wz, yaw, pitch, buttons };
}
