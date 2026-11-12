// Mesure du temps entre les images et statistiques (moyenne, médiane, 95e centile, « 1 % bas »).

export interface FrameStats {
  frames: number;
  fps: number;
  msMedian: number;
  msP95: number;
  /** Images par seconde des 1 % d'images les plus lentes. */
  fpsLow1: number;
}

export function computeStats(frameMs: ArrayLike<number>, count = frameMs.length): FrameStats {
  if (count === 0) return { frames: 0, fps: 0, msMedian: 0, msP95: 0, fpsLow1: 0 };
  const arr = Array.from({ length: count }, (_, i) => frameMs[i]!).sort((a, b) => a - b);
  const sum = arr.reduce((a, b) => a + b, 0);
  const pick = (q: number) => arr[Math.min(count - 1, Math.floor(q * count))]!;
  const p99 = pick(0.99);
  return {
    frames: count,
    fps: (1000 * count) / sum,
    msMedian: pick(0.5),
    msP95: pick(0.95),
    fpsLow1: p99 > 0 ? 1000 / p99 : 0,
  };
}

export class PerfMonitor {
  private readonly times = new Float32Array(300);
  private idx = 0;
  private count = 0;

  frame(ms: number): void {
    this.times[this.idx] = ms;
    this.idx = (this.idx + 1) % this.times.length;
    if (this.count < this.times.length) this.count++;
  }

  reset(): void {
    this.idx = 0;
    this.count = 0;
  }

  stats(): FrameStats {
    return computeStats(this.times, this.count);
  }
}

/**
 * Résolution adaptative : si la fluidité baisse, la résolution de rendu diminue par
 * paliers (jusqu'à 50 %), puis remonte doucement quand l'appareil suit.
 */
export class AdaptiveResolution {
  scale = 1;
  private windowStart = -1;
  private frames = 0;
  private sumMs = 0;
  private goodWindows = 0;

  constructor(
    private readonly min = 0.5,
    private readonly max = 1,
  ) {}

  reset(): void {
    this.scale = this.max;
    this.windowStart = -1;
    this.frames = 0;
    this.sumMs = 0;
    this.goodWindows = 0;
  }

  /** Retourne vrai si l'échelle a changé. */
  frame(ms: number, now: number): boolean {
    if (this.windowStart < 0) this.windowStart = now;
    this.frames++;
    this.sumMs += ms;
    if (now - this.windowStart < 2000) return false;
    const fps = (1000 * this.frames) / this.sumMs;
    this.windowStart = now;
    this.frames = 0;
    this.sumMs = 0;
    if (fps < 48 && this.scale > this.min) {
      this.scale = Math.max(this.min, Math.round((this.scale - 0.1) * 100) / 100);
      this.goodWindows = 0;
      return true;
    }
    if (fps > 57) {
      this.goodWindows++;
      if (this.goodWindows >= 3 && this.scale < this.max) {
        this.scale = Math.min(this.max, Math.round((this.scale + 0.05) * 100) / 100);
        this.goodWindows = 0;
        return true;
      }
    } else {
      this.goodWindows = 0;
    }
    return false;
  }
}
