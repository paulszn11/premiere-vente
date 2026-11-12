// Sauvegardes du monde, gérées par l'hôte.
// Chaque sauvegarde est une « génération » numérotée, avec une empreinte SHA-256 qui
// permet de détecter une corruption. On garde la dernière + 3 sauvegardes de sécurité.
// Les écritures passent par une transaction atomique : une coupure ne laisse jamais
// une sauvegarde à moitié écrite.

import { SAVE_FORMAT_VERSION, SAVE_GENERATIONS_KEPT } from '../shared/constants';

export interface WorldMeta {
  id: string;
  name: string;
  code: string;
  seed: number;
  createdAt: number;
  lastPlayedAt: number;
  latestGen: number;
}

export interface PlayerRecord {
  name: string;
  x: number;
  y: number;
  z: number;
  yaw: number;
  pitch: number;
  lastSeen: number;
}

export interface WorldSave {
  format: number;
  worldId: string;
  tick: number;
  savedAt: number;
  /** Clé : identifiant local du joueur. */
  players: Record<string, PlayerRecord>;
}

export interface SaveEntry {
  worldId: string;
  gen: number;
  savedAt: number;
  data: string;
  sha256: string;
}

export interface SaveSummary {
  gen: number;
  savedAt: number;
  valid: boolean;
}

export interface LoadResult {
  save: WorldSave;
  gen: number;
  /** Générations plus récentes ignorées car corrompues. */
  corrupted: number[];
}

/** Stockage bas niveau (IndexedDB dans le navigateur, mémoire pour les tests, fichiers en phase 8). */
export interface SaveBackend {
  listMeta(): Promise<WorldMeta[]>;
  getMeta(id: string): Promise<WorldMeta | null>;
  putMeta(meta: WorldMeta): Promise<void>;
  listEntries(worldId: string): Promise<SaveEntry[]>;
  /** Écrit atomiquement la méta, une nouvelle génération et supprime les générations listées. */
  commit(meta: WorldMeta, entry: SaveEntry, removeGens: number[]): Promise<void>;
  deleteWorld(worldId: string): Promise<void>;
}

export async function sha256Hex(text: string): Promise<string> {
  const bytes = new TextEncoder().encode(text);
  const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
}

function isValidSave(v: unknown, worldId: string): v is WorldSave {
  if (typeof v !== 'object' || v === null) return false;
  const s = v as Partial<WorldSave>;
  return s.format === SAVE_FORMAT_VERSION && s.worldId === worldId && typeof s.tick === 'number' && typeof s.players === 'object' && s.players !== null;
}

export class SaveStore {
  constructor(private readonly backend: SaveBackend) {}

  listWorlds(): Promise<WorldMeta[]> {
    return this.backend.listMeta();
  }

  getWorld(id: string): Promise<WorldMeta | null> {
    return this.backend.getMeta(id);
  }

  async createWorld(meta: WorldMeta): Promise<WorldMeta> {
    const initial: WorldSave = { format: SAVE_FORMAT_VERSION, worldId: meta.id, tick: 0, savedAt: meta.createdAt, players: {} };
    await this.writeSave({ ...meta, latestGen: 0 }, initial);
    return (await this.backend.getMeta(meta.id))!;
  }

  /** Écrit une nouvelle génération et ne garde que les SAVE_GENERATIONS_KEPT plus récentes. */
  async writeSave(meta: WorldMeta, save: WorldSave): Promise<number> {
    const entries = await this.backend.listEntries(meta.id);
    const maxGen = entries.reduce((m, e) => Math.max(m, e.gen), meta.latestGen);
    const gen = maxGen + 1;
    const data = JSON.stringify(save);
    const entry: SaveEntry = { worldId: meta.id, gen, savedAt: save.savedAt, data, sha256: await sha256Hex(data) };
    const keep = new Set(
      [...entries.map((e) => e.gen), gen]
        .sort((a, b) => b - a)
        .slice(0, SAVE_GENERATIONS_KEPT),
    );
    const remove = entries.map((e) => e.gen).filter((g) => !keep.has(g));
    await this.backend.commit({ ...meta, latestGen: gen, lastPlayedAt: save.savedAt }, entry, remove);
    return gen;
  }

  private async verify(entry: SaveEntry): Promise<WorldSave | null> {
    if ((await sha256Hex(entry.data)) !== entry.sha256) return null;
    try {
      const parsed: unknown = JSON.parse(entry.data);
      return isValidSave(parsed, entry.worldId) ? parsed : null;
    } catch {
      return null;
    }
  }

  /** Charge la génération valide la plus récente (les générations corrompues sont ignorées). */
  async loadLatest(worldId: string): Promise<LoadResult | null> {
    const entries = (await this.backend.listEntries(worldId)).sort((a, b) => b.gen - a.gen);
    const corrupted: number[] = [];
    for (const e of entries) {
      const save = await this.verify(e);
      if (save) return { save, gen: e.gen, corrupted };
      corrupted.push(e.gen);
    }
    return null;
  }

  async listSaves(worldId: string): Promise<SaveSummary[]> {
    const entries = (await this.backend.listEntries(worldId)).sort((a, b) => b.gen - a.gen);
    const out: SaveSummary[] = [];
    for (const e of entries) out.push({ gen: e.gen, savedAt: e.savedAt, valid: (await this.verify(e)) !== null });
    return out;
  }

  /** Restaure une génération : elle est recopiée comme nouvelle sauvegarde la plus récente. */
  async restore(worldId: string, gen: number, now: number): Promise<number> {
    const meta = await this.backend.getMeta(worldId);
    if (!meta) throw new Error('Monde introuvable');
    const entry = (await this.backend.listEntries(worldId)).find((e) => e.gen === gen);
    if (!entry) throw new Error('Sauvegarde introuvable');
    const save = await this.verify(entry);
    if (!save) throw new Error('Cette sauvegarde est corrompue');
    return this.writeSave(meta, { ...save, savedAt: now });
  }

  /** Données brutes d'export (méta + dernière sauvegarde valide). */
  async exportWorld(worldId: string): Promise<{ meta: WorldMeta; save: WorldSave } | null> {
    const meta = await this.backend.getMeta(worldId);
    const latest = await this.loadLatest(worldId);
    if (!meta || !latest) return null;
    return { meta, save: latest.save };
  }

  deleteWorld(worldId: string): Promise<void> {
    return this.backend.deleteWorld(worldId);
  }
}

/** Stockage en mémoire (tests et mode sans persistance). */
export class MemoryBackend implements SaveBackend {
  readonly metas = new Map<string, WorldMeta>();
  readonly entries = new Map<string, SaveEntry[]>();

  async listMeta(): Promise<WorldMeta[]> {
    return [...this.metas.values()].map((m) => ({ ...m }));
  }
  async getMeta(id: string): Promise<WorldMeta | null> {
    const m = this.metas.get(id);
    return m ? { ...m } : null;
  }
  async putMeta(meta: WorldMeta): Promise<void> {
    this.metas.set(meta.id, { ...meta });
  }
  async listEntries(worldId: string): Promise<SaveEntry[]> {
    return (this.entries.get(worldId) ?? []).map((e) => ({ ...e }));
  }
  async commit(meta: WorldMeta, entry: SaveEntry, removeGens: number[]): Promise<void> {
    this.metas.set(meta.id, { ...meta });
    const list = (this.entries.get(meta.id) ?? []).filter((e) => !removeGens.includes(e.gen));
    list.push({ ...entry });
    this.entries.set(meta.id, list);
  }
  async deleteWorld(worldId: string): Promise<void> {
    this.metas.delete(worldId);
    this.entries.delete(worldId);
  }
}
