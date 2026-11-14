// Stockage des sauvegardes du monde de l'hôte dans IndexedDB (phase 8) : transactions atomiques, donc une
// coupure ne laisse jamais une sauvegarde à moitié écrite. Implémente l'interface de src/server/save.ts.

import type { SaveBackend, SaveEntry, WorldMeta } from '../../server/save';

const DB_NAME = 'bienvenue-au-zimbabwe';
const DB_VERSION = 1;

function req<T>(r: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}

function done(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error ?? new Error('Transaction annulée'));
  });
}

export class IdbBackend implements SaveBackend {
  private dbp: Promise<IDBDatabase> | null = null;

  private db(): Promise<IDBDatabase> {
    if (!this.dbp) {
      this.dbp = new Promise((resolve, reject) => {
        const open = indexedDB.open(DB_NAME, DB_VERSION);
        open.onupgradeneeded = () => {
          const db = open.result;
          if (!db.objectStoreNames.contains('worlds')) db.createObjectStore('worlds', { keyPath: 'id' });
          if (!db.objectStoreNames.contains('saves')) {
            const st = db.createObjectStore('saves', { keyPath: ['worldId', 'gen'] });
            st.createIndex('world', 'worldId');
          }
        };
        open.onsuccess = () => resolve(open.result);
        open.onerror = () => reject(open.error);
      });
    }
    return this.dbp;
  }

  async listMeta(): Promise<WorldMeta[]> {
    const db = await this.db();
    return req(db.transaction('worlds').objectStore('worlds').getAll() as IDBRequest<WorldMeta[]>);
  }

  async getMeta(id: string): Promise<WorldMeta | null> {
    const db = await this.db();
    return ((await req(db.transaction('worlds').objectStore('worlds').get(id))) as WorldMeta | undefined) ?? null;
  }

  async putMeta(meta: WorldMeta): Promise<void> {
    const db = await this.db();
    const tx = db.transaction('worlds', 'readwrite');
    tx.objectStore('worlds').put(meta);
    await done(tx);
  }

  async listEntries(worldId: string): Promise<SaveEntry[]> {
    const db = await this.db();
    return req(db.transaction('saves').objectStore('saves').index('world').getAll(worldId) as IDBRequest<SaveEntry[]>);
  }

  async commit(meta: WorldMeta, entry: SaveEntry, removeGens: number[]): Promise<void> {
    const db = await this.db();
    const tx = db.transaction(['worlds', 'saves'], 'readwrite');
    tx.objectStore('worlds').put(meta);
    const saves = tx.objectStore('saves');
    saves.put(entry);
    for (const g of removeGens) saves.delete([meta.id, g]);
    await done(tx);
  }

  async deleteWorld(worldId: string): Promise<void> {
    const db = await this.db();
    const entries = await this.listEntries(worldId);
    const tx = db.transaction(['worlds', 'saves'], 'readwrite');
    tx.objectStore('worlds').delete(worldId);
    for (const e of entries) tx.objectStore('saves').delete([worldId, e.gen]);
    await done(tx);
  }
}
