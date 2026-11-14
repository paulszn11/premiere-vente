// Rôles, droits et règles du monde partagé (phase 8, § 3.4 et 3.5 du cahier des charges).
// Proposition modifiable : trois rôles (hôte, membre, invité), chaque droit ajustable joueur par joueur ;
// chaque construction, installation et véhicule retient qui l'a fait, et son propriétaire en règle l'accès.

export type Role = 'hote' | 'membre' | 'invite';
export const ROLES: readonly Role[] = ['hote', 'membre', 'invite'];
export const ROLE_LABELS: Record<Role, string> = { hote: 'Hôte', membre: 'Membre', invite: 'Invité' };

export type Perm = 'construire' | 'demonter_autres' | 'ouvrir_autres' | 'conduire_autres' | 'gerer';
export const PERMS: readonly Perm[] = ['construire', 'demonter_autres', 'ouvrir_autres', 'conduire_autres', 'gerer'];
export const PERM_LABELS: Record<Perm, string> = {
  construire: 'Construire et installer',
  demonter_autres: 'Démonter les constructions des autres',
  ouvrir_autres: 'Ouvrir les coffres et installations partagés des autres',
  conduire_autres: 'Conduire les véhicules partagés des autres',
  gerer: 'Gérer les joueurs et les permissions',
};

export const ROLE_PERMS: Record<Role, Record<Perm, boolean>> = {
  hote: { construire: true, demonter_autres: true, ouvrir_autres: true, conduire_autres: true, gerer: true },
  membre: { construire: true, demonter_autres: false, ouvrir_autres: true, conduire_autres: true, gerer: false },
  invite: { construire: false, demonter_autres: false, ouvrir_autres: false, conduire_autres: false, gerer: false },
};

/** Accès à une chose possédée, choisi par son propriétaire. */
export type Access = 'prive' | 'partage' | 'public';
export const ACCESS_LABELS: Record<Access, string> = { prive: 'privé', partage: 'partagé', public: 'public' };

export interface Owned {
  /** Identifiant du joueur qui l'a fait. */
  owner?: string;
  access?: Access;
}

/** Relit le propriétaire et l'accès d'une chose sauvegardée (contrôle des valeurs). */
export function readOwned(o: Record<string, unknown>): Owned {
  const out: Owned = {};
  if (typeof o.owner === 'string' && o.owner.length > 0 && o.owner.length <= 64) out.owner = o.owner;
  if (o.access === 'prive' || o.access === 'partage' || o.access === 'public') out.access = o.access;
  return out;
}

/** Ce qu'on veut faire d'une chose (ou construire). */
export type Use = 'construire' | 'ouvrir' | 'demonter' | 'conduire' | 'gerer';

export interface Member {
  id: string;
  name: string;
  role: Role;
  /** Droits ajustés pour ce joueur (sinon ceux de son rôle). */
  overrides: Partial<Record<Perm, boolean>>;
  /** Empreinte de sa clé secrète (preuve d'identité). */
  verifier: string;
  lastSeen: number;
}

export interface WorldRules {
  /** Rôle donné à un joueur qui rejoint pour la première fois. */
  defaultRole: Role;
  /** Les joueurs peuvent-ils se frapper ? */
  pvp: boolean;
  /** Secondes pendant lesquelles un joueur déconnecté reste endormi dans le monde. */
  awaySeconds: number;
  /** Un joueur déconnecté près de ses constructions est protégé. */
  protectAtBase: boolean;
}

export const DEFAULT_RULES: WorldRules = { defaultRole: 'membre', pvp: false, awaySeconds: 120, protectAtBase: true };

export function hasPerm(m: Member | undefined, p: Perm): boolean {
  if (!m) return false;
  return m.overrides[p] ?? ROLE_PERMS[m.role][p];
}

/**
 * Le joueur `actor` peut-il faire `use` sur une chose de `owner` (accès `access`) ?
 * Renvoie le message de refus, ou null si c'est permis.
 */
export function permitUse(members: ReadonlyMap<string, Member>, actor: string, use: Use, owner?: string, access: Access = 'partage'): string | null {
  const m = members.get(actor);
  if (m?.role === 'hote') return null;
  if (use === 'construire') return hasPerm(m, 'construire') ? null : 'Vous n’avez pas le droit de construire dans ce monde (demandez à l’hôte).';
  if (use === 'gerer') return hasPerm(m, 'gerer') ? null : 'Seul l’hôte peut gérer cela.';
  if (!owner || owner === actor) return null;
  const who = members.get(owner)?.name || 'un autre joueur';
  if (use === 'demonter') return hasPerm(m, 'demonter_autres') ? null : `Cela appartient à ${who} : vous ne pouvez pas le démonter.`;
  if (access === 'prive') return `C’est privé : cela appartient à ${who}.`;
  if (access === 'public') return null;
  if (use === 'ouvrir') return hasPerm(m, 'ouvrir_autres') ? null : `Cela appartient à ${who} : vous n’avez pas le droit de l’ouvrir.`;
  if (use === 'conduire') return hasPerm(m, 'conduire_autres') ? null : `Ce véhicule appartient à ${who} : vous n’avez pas le droit de le conduire.`;
  return null;
}

/** Relit les règles du monde (contrôle des valeurs). */
export function readRules(raw: unknown): WorldRules {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  return {
    defaultRole: r.defaultRole === 'invite' || r.defaultRole === 'membre' ? r.defaultRole : DEFAULT_RULES.defaultRole,
    pvp: r.pvp === true,
    awaySeconds: typeof r.awaySeconds === 'number' && Number.isFinite(r.awaySeconds) ? Math.max(0, Math.min(1800, Math.round(r.awaySeconds))) : DEFAULT_RULES.awaySeconds,
    protectAtBase: r.protectAtBase !== false,
  };
}

/** Relit la liste des joueurs connus (contrôle des valeurs). */
export function readMembers(raw: unknown): Member[] {
  if (!Array.isArray(raw)) return [];
  const out: Member[] = [];
  for (const o of raw.slice(0, 500)) {
    if (!o || typeof o !== 'object') continue;
    const m = o as Record<string, unknown>;
    if (typeof m.id !== 'string' || m.id.length > 64 || typeof m.verifier !== 'string' || !/^[0-9a-f]{64}$/.test(m.verifier)) continue;
    const role = m.role === 'hote' || m.role === 'membre' || m.role === 'invite' ? m.role : 'membre';
    const overrides: Partial<Record<Perm, boolean>> = {};
    if (m.overrides && typeof m.overrides === 'object') for (const p of PERMS) if (typeof (m.overrides as Record<string, unknown>)[p] === 'boolean') overrides[p] = (m.overrides as Record<string, boolean>)[p];
    out.push({ id: m.id, name: typeof m.name === 'string' ? m.name.slice(0, 40) : '', role, overrides, verifier: m.verifier, lastSeen: typeof m.lastSeen === 'number' ? m.lastSeen : 0 });
  }
  return out;
}
