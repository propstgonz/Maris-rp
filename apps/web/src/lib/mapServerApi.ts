import type { AstroGlobal } from 'astro';

export class MapServerApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

const REQUEST_TIMEOUT_MS = 10000;

async function mapServerFetch(Astro: AstroGlobal, path: string, init: RequestInit = {}): Promise<Response> {
  const cookie = Astro.request.headers.get('cookie') ?? '';
  try {
    return await fetch(`${Astro.locals.apiBase}${path}`, {
      ...init,
      headers: { ...init.headers, cookie },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch (err) {
    const timedOut = (err as Error).name === 'TimeoutError';
    throw new MapServerApiError(504, timedOut
      ? `El servidor de mapa no respondió a tiempo (${path}).`
      : `No se pudo contactar con el servidor de mapa (${path}).`);
  }
}

async function getJson<T>(Astro: AstroGlobal, path: string): Promise<T> {
  const res = await mapServerFetch(Astro, path);
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    throw new MapServerApiError(res.status, body?.error ?? `Error ${res.status} llamando a ${path}.`);
  }
  return res.json();
}

export interface CatalogItem {
  id: number;
  name: string;
  display_name: string;
  item_type: string;
  emoji: string;
  description: string;
  image_url: string | null;
  is_consumable: number;
  is_fuel: number;
  consume_hp_delta: number | null;
  consume_hunger_delta: number | null;
  weapon_damage: number | null;
  weapon_structure_damage: number | null;
  weapon_roll_1: number | null;
  weapon_roll_2: number | null;
  weapon_roll_3: number | null;
  weapon_roll_4: number | null;
  weapon_roll_5: number | null;
  weapon_roll_6: number | null;
  weapon_max_durability: number | null;
  weapon_ammo_item_name: string | null;
  weapon_ammo_cost: number | null;
  weapon_area_damage: number;
  weapon_area_effect: string | null;
  weapon_area_effect_duration_hours: number | null;
  vehicle_category: string | null;
  vehicle_speed_multiplier: number | null;
  npc_tool_grants_item_id: number | null;
  npc_tool_grants_rate: number | null;
  npc_tool_produces_laburo_rate: number | null;
  category_name: string | null;
  heal_range: number;
  mount_hp_bonus: number;
  mount_damage_bonus: number;
  trade_value: number;
  [key: string]: unknown;
}

export function fetchItems(Astro: AstroGlobal): Promise<CatalogItem[]> {
  return getJson<CatalogItem[]>(Astro, '/api/items');
}

export interface ItemCategory {
  name: string;
  display_name: string;
  emoji: string;
  description: string;
  [key: string]: unknown;
}

export function fetchItemCategories(Astro: AstroGlobal): Promise<ItemCategory[]> {
  return getJson<ItemCategory[]>(Astro, '/api/item-categories');
}

export interface Recipe {
  id: number;
  ingredients: { name: string; quantity_required: number }[];
  laburo_cost: number;
  required_construction_type: string | null;
  tool: { name: string; display_name: string } | null;
  tool_laburo_reduction: number | null;
}

export interface TerrainType {
  name: string;
  display_name: string;
  emoji: string;
  color: string;
  requires_vehicle_category: string | null;
  description: string;
  resources: { name: string; display_name: string; emoji: string | null; quantity: number; drop_chance_percent: number }[];
  [key: string]: unknown;
}

export function fetchTerrainTypes(Astro: AstroGlobal): Promise<TerrainType[]> {
  return getJson<TerrainType[]>(Astro, '/api/terrain-types');
}

export interface Zone {
  id: number;
  name: string;
  display_name: string;
  emoji: string;
  color: string;
  description: string;
  tile_count: number;
  temp_min: number;
  temp_max: number;
  resources: { name: string; display_name: string; emoji: string | null; quantity: number; drop_chance_percent: number }[];
  [key: string]: unknown;
}

export function fetchZones(Astro: AstroGlobal): Promise<Zone[]> {
  return getJson<Zone[]>(Astro, '/api/zonas');
}

export interface EffectType {
  name: string;
  display_name?: string;
  label: string;
  emoji: string;
  laburo_modifier: number;
  hp_delta_per_day: number;
  blocks_laburo: number;
  prevents_combat: number;
  description: string;
  [key: string]: unknown;
}

export function fetchEffectTypes(Astro: AstroGlobal): Promise<EffectType[]> {
  return getJson<EffectType[]>(Astro, '/api/effect-types');
}

export interface Faction {
  id: number;
  name: string;
  display_name: string;
  emoji: string;
  description: string;
  owner_player_id: number | null;
  is_npc: number;
  tile_count: number;
  [key: string]: unknown;
}

export function fetchFactions(Astro: AstroGlobal): Promise<Faction[]> {
  return getJson<Faction[]>(Astro, '/api/facciones');
}

export interface ConstructionType {
  name: string;
  display_name: string;
  emoji: string;
  description: string;
  laburo_cost: number;
  max_health: number;
  max_durability: number;
  durability_loss_per_day: number | null;
  durability_repair_tool_item_name: string | null;
  requires_resource_type: string | null;
  unlocks_item_name: string | null;
  grants_resource_item_id: number | null;
  grants_resource_rate: number | null;
  fuel_item_id: number | null;
  fuel_consumption_rate: number | null;
  fuel_capacity: number | null;
  is_landing_site: number;
  use_tool_item_name: string | null;
  use_result_item_id: number | null;
  use_roll_1: number | null;
  use_roll_2: number | null;
  use_roll_3: number | null;
  use_roll_4: number | null;
  use_roll_5: number | null;
  use_roll_6: number | null;
  use_laburo_cost: number | null;
  use_cooldown_hours: number | null;
  image_url: string | null;
  ingredients: { name: string; quantity_required: number }[];
  [key: string]: unknown;
}

export function fetchConstructionTypes(Astro: AstroGlobal): Promise<ConstructionType[]> {
  return getJson<ConstructionType[]>(Astro, '/api/construction-types');
}

export interface NpcType {
  name: string;
  display_name: string;
  emoji: string;
  description: string;
  max_hp: number;
  spawn_chance_percent: number;
  weapon_item_id: number | null;
  secondary_weapon_item_id: number | null;
  heal_item_id: number | null;
  heal_threshold_percent: number;
  mount_item_id: number | null;
  is_aggressive: number;
  flee_chance_percent: number | null;
  image_url: string | null;
  terrains: { name: string; display_name: string; emoji: string | null; spawn_chance_override_percent: number | null }[];
  zones: { name: string; display_name: string; emoji: string | null; spawn_chance_override_percent: number | null }[];
  drops: { name: string; quantity: number; drop_chance_percent: number }[];
  is_recruitable: number;
  can_produce: number;
  can_soldier: number;
  production_interval_hours: number;
  max_accrual_hours: number;
  equipment: { name: string; quantity: number }[];
  theft_chance_percent: number;
  trade_margin_percent: number;
  surrender_chance_percent: number;
  is_tameable: number;
  tame_chance_percent: number;
  tame_bait_item_id: number | null;
  vehicle_category: string | null;
  vehicle_speed_multiplier: number;
  breed_chance_percent: number;
  faction_id: number | null;
  [key: string]: unknown;
}

export function fetchNpcTypes(Astro: AstroGlobal): Promise<NpcType[]> {
  return getJson<NpcType[]>(Astro, '/api/npc-types');
}

export interface NpcGroupType {
  id: number;
  name: string;
  display_name: string;
  emoji: string;
  description: string;
  spawn_chance_percent: number;
  is_aggressive: number;
  flee_chance_percent: number;
  surrender_chance_percent: number;
  members: { id: number; npc_type_id: number; name: string; display_name: string; emoji: string | null; quantity: number }[];
  terrains: { name: string; display_name: string; emoji: string | null; spawn_chance_override_percent: number | null }[];
  zones: { name: string; display_name: string; emoji: string | null; spawn_chance_override_percent: number | null }[];
  [key: string]: unknown;
}

export function fetchNpcGroupTypes(Astro: AstroGlobal): Promise<NpcGroupType[]> {
  return getJson<NpcGroupType[]>(Astro, '/api/npc-group-types');
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

export interface PlayerSearchRow {
  discord_id: string;
  username: string;
  character_name: string | null;
  is_alive: number;
  hp: number;
}

export interface PlayerSearchPage {
  rows: PlayerSearchRow[];
  total: number;
  page: number;
  pageSize: number;
}

export function searchPlayers(Astro: AstroGlobal, q: string, page = 1): Promise<PlayerSearchPage> {
  const qs = new URLSearchParams({ q, page: String(page) });
  return getJson<PlayerSearchPage>(Astro, `/api/players/search?${qs.toString()}`);
}

export interface PlayerEffect {
  effect_type: string;
  expires_at: string | null;
  laburo_modifier: number;
  hp_delta_per_day: number;
  meta: { emoji: string; label: string } | null;
}

export interface PlayerInventoryRow {
  name: string;
  display_name: string;
  item_type: string;
  emoji: string;
  quantity: number;
  [key: string]: unknown;
}

export interface PlayerActivityAuditEntry {
  kind: 'audit';
  at: string;
  source: 'web' | 'discord';
  action: string;
  target: string | null;
  details: unknown;
}
export interface PlayerActivityTradeEntry {
  kind: 'trade';
  at: string;
  direction: 'sent' | 'received';
  counterpart: { discordId: string; username: string };
  item: { name: string; display_name: string; emoji: string };
  quantity: number;
  coord: { x: number; y: number };
}
export type PlayerActivityEntry = PlayerActivityAuditEntry | PlayerActivityTradeEntry;

export interface PlayerDetail {
  discord_id: string;
  username: string;
  character_name: string | null;
  full_name: string | null;
  nationality: string | null;
  origin_country: string | null;
  gender: 'hombre' | 'mujer' | null;
  religion: string | null;
  description: string | null;
  hp: number;
  hunger: number;
  is_alive: number;
  is_immortal: number;
  coord_x: number;
  coord_y: number;
  faction_display_name: string | null;
  faction_emoji: string | null;
  effects: PlayerEffect[];
  inventory: PlayerInventoryRow[];
  activity: PlayerActivityEntry[];
  avatar_url: string | null;
  [key: string]: unknown;
}

export function fetchStaffDocs(Astro: AstroGlobal): Promise<{ content: string }> {
  return getJson<{ content: string }>(Astro, '/api/docs/staff');
}

export function fetchRoleplayDocs(Astro: AstroGlobal): Promise<{ content: string }> {
  return getJson<{ content: string }>(Astro, '/api/docs/roleo');
}

export interface SpawnSettings { x: number; y: number }
export interface MechanicsSettings {
  moveFreedom: boolean;
  characterCreationCooldownHours: number;
  laburoDayAmount: number;
  attackMaxPerDay: number;
  attackCooldownHours: number;
  idleLogoutMinutes: number;
  gatherCooldownHours: number;
  mapMaxCoordinate: number;
  worldTempMin: number;
  worldTempMax: number;
}

export function fetchMechanicsSettings(Astro: AstroGlobal): Promise<MechanicsSettings> {
  return getJson<MechanicsSettings>(Astro, '/api/settings/mechanics');
}

export type IntegritySeverity = 'error' | 'warning' | 'info';

export interface IntegrityFinding {
  rule: string;
  severity: IntegritySeverity;
  entity: 'item' | 'construction_type' | 'npc_type' | 'terrain_type' | 'recipe' | 'tile';
  entityName: string;
  message: string;
  hint?: string;
}

export interface IntegrityReport {
  findings: IntegrityFinding[];
  counts: { error: number; warning: number; info: number };
  generatedAt: string;
}

export function fetchWorldIntegrity(Astro: AstroGlobal): Promise<IntegrityReport> {
  return getJson<IntegrityReport>(Astro, '/api/world-integrity');
}
