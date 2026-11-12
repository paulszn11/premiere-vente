// Limitation des tentatives de connexion avec un mauvais code.
// Par source (onglet aujourd'hui, pair réseau en phase 8) et globalement.

import { JOIN_FAILURE_WINDOW_MS, JOIN_GLOBAL_MAX_FAILURES, JOIN_LOCKOUT_MS, JOIN_MAX_FAILURES } from './constants';

interface SourceState {
  failures: number[];
  lockedUntil: number;
}

export interface LimiterConfig {
  maxFailures: number;
  windowMs: number;
  lockoutMs: number;
  globalMaxFailures: number;
}

export const DEFAULT_LIMITER: LimiterConfig = {
  maxFailures: JOIN_MAX_FAILURES,
  windowMs: JOIN_FAILURE_WINDOW_MS,
  lockoutMs: JOIN_LOCKOUT_MS,
  globalMaxFailures: JOIN_GLOBAL_MAX_FAILURES,
};

export class AttemptLimiter {
  private readonly sources = new Map<string, SourceState>();
  private globalFailures: number[] = [];
  private globalLockedUntil = 0;

  constructor(private readonly cfg: LimiterConfig = DEFAULT_LIMITER) {}

  /** Temps d'attente restant (ms) avant qu'une source puisse réessayer ; 0 si autorisée. */
  retryAfter(source: string, now: number): number {
    const g = this.globalLockedUntil - now;
    const s = this.sources.get(source);
    const l = s ? s.lockedUntil - now : 0;
    return Math.max(0, g, l);
  }

  recordFailure(source: string, now: number): void {
    const cutoff = now - this.cfg.windowMs;
    let s = this.sources.get(source);
    if (!s) {
      s = { failures: [], lockedUntil: 0 };
      this.sources.set(source, s);
    }
    s.failures = s.failures.filter((t) => t > cutoff);
    s.failures.push(now);
    if (s.failures.length >= this.cfg.maxFailures) {
      s.lockedUntil = now + this.cfg.lockoutMs;
      s.failures = [];
    }
    this.globalFailures = this.globalFailures.filter((t) => t > cutoff);
    this.globalFailures.push(now);
    if (this.globalFailures.length >= this.cfg.globalMaxFailures) {
      this.globalLockedUntil = now + this.cfg.lockoutMs;
      this.globalFailures = [];
    }
  }

  recordSuccess(source: string): void {
    this.sources.delete(source);
  }
}
