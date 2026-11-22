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

export function fetchAuditLog(Astro: AstroGlobal, params: { page?: number; actor?: string; action?: string } = {}): Promise<AuditLogPage> {
  const qs = new URLSearchParams();
  if (params.page) qs.set('page', String(params.page));
  if (params.actor) qs.set('actor', params.actor);
  if (params.action) qs.set('action', params.action);
  const query = qs.toString();
  return getJson<AuditLogPage>(Astro, `/api/audit-log${query ? `?${query}` : ''}`);
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

export function fetchPlayer(Astro: AstroGlobal, discordId: string): Promise<PlayerRow> {
  return getJson<PlayerRow>(Astro, `/api/players/${encodeURIComponent(discordId)}`);
}

export function fetchStaffDocs(Astro: AstroGlobal): Promise<{ content: string }> {
  return getJson<{ content: string }>(Astro, '/api/docs/staff');
}
