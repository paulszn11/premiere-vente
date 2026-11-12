// Modules déjà écrits pour le multijoueur (phase 8), pas encore branchés au jeu.
// Testés dès maintenant pour qu'ils restent fiables d'ici là.

import { describe, expect, it } from 'vitest';
import { MemoryBackend, SaveStore, type WorldMeta, type WorldSave } from '../../src/server/save';
import { SAVE_FORMAT_VERSION, SAVE_GENERATIONS_KEPT } from '../../src/shared/constants';
import { parseClientMessage, sanitizePlayerName } from '../../src/shared/protocol';
import { AttemptLimiter } from '../../src/shared/ratelimit';
import { formatWorldCode, generateWorldCode, normalizeWorldCode, worldCodesEqual } from '../../src/shared/worldcode';

describe('code d’accès du monde', () => {
  it('16 caractères sans ambiguïté, saisie tolérante', () => {
    const codes = new Set<string>();
    for (let i = 0; i < 500; i++) {
      const c = generateWorldCode();
      expect(c).toMatch(/^[2-9A-HJ-NP-Z]{4}(-[2-9A-HJ-NP-Z]{4}){3}$/);
      codes.add(c);
    }
    expect(codes.size).toBe(500);
    const c = generateWorldCode();
    expect(normalizeWorldCode(` ${c.toLowerCase().replace(/-/g, ' ')} `)).toBe(c.replace(/-/g, ''));
    expect(worldCodesEqual(c, c.replace(/-/g, '').toLowerCase())).toBe(true);
    expect(worldCodesEqual(c, generateWorldCode())).toBe(false);
    expect(normalizeWorldCode('ABCD-EFGH-IJKL-MNOP')).toBeNull(); // I et O exclus
    expect(normalizeWorldCode('ABC')).toBeNull();
    expect(formatWorldCode('ABCDEFGHJKLMNPQR')).toBe('ABCD-EFGH-JKLM-NPQR');
  });
});

describe('protocole réseau', () => {
  const id = '123e4567-e89b-42d3-a456-426614174000';
  it('accepte les messages valides', () => {
    expect(parseClientMessage({ t: 'hello', protocol: 1, playerId: id, name: '  Paul  ', code: 'X' })).toEqual({ t: 'hello', protocol: 1, playerId: id, name: 'Paul', code: 'X' });
    expect(parseClientMessage({ t: 'input', cmds: [{ seq: 1, wx: 0.5, wz: -1, yaw: 3, pitch: 0.2, buttons: 3 }] })).not.toBeNull();
  });
  it('refuse les messages mal formés ou abusifs', () => {
    expect(parseClientMessage(null)).toBeNull();
    expect(parseClientMessage({ t: 'hello', protocol: 1, playerId: 'pas-un-uuid', name: 'A', code: 'X' })).toBeNull();
    expect(parseClientMessage({ t: 'hello', protocol: 1, playerId: id, name: '', code: 'X' })).toBeNull();
    expect(parseClientMessage({ t: 'input', cmds: [{ seq: 1, wx: Number.NaN, wz: 0, yaw: 0, pitch: 0, buttons: 0 }] })).toBeNull();
    expect(parseClientMessage({ t: 'input', cmds: [{ seq: 1, wx: 5, wz: 0, yaw: 0, pitch: 0, buttons: 0 }] })).toBeNull();
    expect(parseClientMessage({ t: 'input', cmds: Array(33).fill({ seq: 1, wx: 0, wz: 0, yaw: 0, pitch: 0, buttons: 0 }) })).toBeNull();
    expect(parseClientMessage({ t: 'teleport', x: 0 })).toBeNull();
  });
  it('nettoie les pseudonymes', () => {
    expect(sanitizePlayerName(`A${String.fromCharCode(0)}B${String.fromCharCode(0x200b)}C`)).toBe('ABC');
    expect(sanitizePlayerName('x'.repeat(21))).toBeNull();
  });
});

describe('limitation des tentatives', () => {
  it('bloque une source après 5 échecs, puis la libère', () => {
    const l = new AttemptLimiter();
    for (let i = 0; i < 4; i++) l.recordFailure('a', 1000 + i);
    expect(l.retryAfter('a', 1010)).toBe(0);
    l.recordFailure('a', 1010);
    expect(l.retryAfter('a', 1011)).toBeGreaterThan(0);
    expect(l.retryAfter('b', 1011)).toBe(0);
    expect(l.retryAfter('a', 1011 + 60000)).toBe(0);
  });
  it('blocage global si les échecs viennent de partout', () => {
    const l = new AttemptLimiter();
    for (let i = 0; i < 30; i++) l.recordFailure(`s${i}`, 5000);
    expect(l.retryAfter('nouvelle-source', 5001)).toBeGreaterThan(0);
  });
});

describe('sauvegardes', () => {
  const meta = (): WorldMeta => ({ id: 'w1', name: 'Test', code: 'ABCDEFGHJKLMNPQR', seed: 7, createdAt: 1, lastPlayedAt: 1, latestGen: 0 });
  const save = (tick: number): WorldSave => ({ format: SAVE_FORMAT_VERSION, worldId: 'w1', tick, savedAt: tick, players: {} });

  it('garde la dernière sauvegarde + 3 sauvegardes de sécurité', async () => {
    const backend = new MemoryBackend();
    const store = new SaveStore(backend);
    let m = await store.createWorld(meta());
    for (let t = 1; t <= 6; t++) {
      await store.writeSave(m, save(t * 100));
      m = (await store.getWorld('w1'))!;
    }
    const list = await store.listSaves('w1');
    expect(list.length).toBe(SAVE_GENERATIONS_KEPT);
    expect(list.every((s) => s.valid)).toBe(true);
    expect((await store.loadLatest('w1'))!.save.tick).toBe(600);
  });

  it('une sauvegarde corrompue est ignorée au profit de la précédente', async () => {
    const backend = new MemoryBackend();
    const store = new SaveStore(backend);
    const m = await store.createWorld(meta());
    await store.writeSave(m, save(100));
    await store.writeSave((await store.getWorld('w1'))!, save(200));
    const entries = backend.entries.get('w1')!;
    const latest = entries.reduce((a, b) => (a.gen > b.gen ? a : b));
    latest.data = latest.data.replace('200', '999');
    const loaded = await store.loadLatest('w1');
    expect(loaded!.save.tick).toBe(100);
    expect(loaded!.corrupted).toEqual([latest.gen]);
  });

  it('restaurer une ancienne sauvegarde la recopie comme plus récente', async () => {
    const store = new SaveStore(new MemoryBackend());
    const m = await store.createWorld(meta());
    const g1 = await store.writeSave(m, save(100));
    await store.writeSave((await store.getWorld('w1'))!, save(200));
    await store.restore('w1', g1, 300);
    const loaded = await store.loadLatest('w1');
    expect(loaded!.save.tick).toBe(100);
    expect(loaded!.save.savedAt).toBe(300);
  });
});
