import type { AstroGlobal } from 'astro';

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

const REQUEST_TIMEOUT_MS = 10000;

async function apiRequest(Astro: AstroGlobal, path: string, init: RequestInit = {}): Promise<Response> {
  const cookie = Astro.request.headers.get('cookie') ?? '';
  try {
    return await fetch(`${Astro.locals.apiBase}${path}`, {
      ...init,
      headers: { ...init.headers, cookie },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch (err) {
    const timedOut = (err as Error).name === 'TimeoutError';
    throw new ApiError(504, timedOut
      ? `La API no respondió a tiempo (${path}).`
      : `No se pudo contactar con la API (${path}).`);
  }
}

async function getJson<T>(Astro: AstroGlobal, path: string): Promise<T> {
  const res = await apiRequest(Astro, path);
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    throw new ApiError(res.status, body?.error ?? `Error ${res.status} llamando a ${path}.`);
  }
  return res.json();
}

export interface AuditLogEntry {
  id: number;
  source: 'web' | 'discord';
  actor_discord_id: string;
  actor_username: string;
  action: string;
  target: string | null;
  details: unknown;
  created_at: string;
}

export interface AuditLogPage {
  rows: AuditLogEntry[];
  total: number;
  page: number;
  pageSize: number;
}

export function fetchAuditLogActions(Astro: AstroGlobal): Promise<string[]> {
  return getJson<string[]>(Astro, '/api/audit-log/actions');
}

export type BackupKind = 'full' | 'legacy-db' | 'legacy-bucket';

export interface BackupFile {
  filename: string;
  kind: BackupKind;
  sizeBytes: number;
  createdAt: string;
}

export function fetchBackups(Astro: AstroGlobal): Promise<BackupFile[]> {
  return getJson<BackupFile[]>(Astro, '/api/backups');
}

export function fetchBackupSchedule(Astro: AstroGlobal): Promise<{ cron: string }> {
  return getJson<{ cron: string }>(Astro, '/api/backups/schedule');
}

export interface ModmailCategory {
  id: number;
  discordCategoryId: string;
  displayName: string;
  exists: boolean;
  channelCount: number;
  maxChannels: number;
  createdAt: string;
}

export function fetchModmailCategories(Astro: AstroGlobal): Promise<ModmailCategory[]> {
  return getJson<ModmailCategory[]>(Astro, '/api/modmail-categories');
}

export interface PlayerRow {
  id: number;
  discord_id: string;
  username: string;
  character_name: string | null;
  is_alive: number;
  character_created_at: string | null;
  died_at: string | null;
  avatar_filename: string | null;
  gender: 'hombre' | 'mujer' | null;
  avatar_url: string | null;
}

export function fetchStaffDocs(Astro: AstroGlobal): Promise<{ content: string }> {
  return getJson<{ content: string }>(Astro, '/api/docs/staff');
}

export type StatMap = Record<'potencia' | 'intuicion' | 'chiripa' | 'autismo' | 'resistencia' | 'donjuanismo' | 'agilidad', number>;

export interface FichaPlayer {
  id: number;
  discord_id: string;
  character_name: string | null;
  gender: 'hombre' | 'mujer' | null;
  age: number | null;
  character_created_at: string;
  is_alive: boolean;
  avatar_url: string | null;
}

export interface FichaRace {
  slug: string;
  name: string;
  description: string;
  traits: string | null;
}

export interface FichaMenhir {
  slug: string;
  name: string;
  description: string;
  magic_bonus: number;
  magic_to_life: number;
}

export interface FichaProfile {
  base: StatMap;
  effective: StatMap;
  freePoints: number;
  race: FichaRace | null;
  menhir: FichaMenhir | null;
  magic: { magia: number; vidaExtra: number };
  civil: { label: string; spouse: { id: number; discordId: string; characterName: string | null } | null };
}

export interface FichaNpc {
  name: string;
  count: number;
}

export interface FichaGood {
  item_id: number;
  display_name: string;
  emoji: string | null;
  category: string | null;
  quantity: number;
}

export interface FichaProperty {
  id: number;
  type_display_name: string;
  category: string;
  name: string | null;
  level: number;
  location: string | null;
  emoji: string | null;
}

export interface FichaSchool {
  school: { slug: string; name: string; description: string; is_active: number };
  rank: number;
  levelName: string | null;
  next: { rank: number; name: string; threshold: number } | null;
  retryAfter: string | null;
  active: boolean;
}

export interface FichaSchools {
  schools: FichaSchool[];
  magic: { magia: number; vidaExtra: number };
  canClaimFreeSchool: boolean;
}

export interface FichaSpell {
  school: string;
  school_slug: string;
  levelName: string;
  min_rank: number;
  name: string;
  cost_amount: number;
  cost_resource: string;
  description: string;
}

export interface Ficha {
  player: FichaPlayer;
  profile: FichaProfile;
  npcs: FichaNpc[];
  goods: FichaGood[];
  properties: FichaProperty[];
  schools: FichaSchools;
  spells: FichaSpell[];
}

export function fetchFicha(Astro: AstroGlobal, discordId: string): Promise<Ficha> {
  return getJson<Ficha>(Astro, `/api/players/${encodeURIComponent(discordId)}/ficha`);
}
