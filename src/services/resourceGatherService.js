import { queryOne, withTransaction } from '../database/index.js';
import { T } from '../database/tables.js';
import logger from '../utils/logger.js';
import { UserFacingError } from '../utils/errors.js';
import { discordRelativeFromNow } from '../utils/embeds.js';
import { getSetting, setSetting } from './settingsService.js';
import { getPlayerByDiscordId } from './playerService.js';
import { claimCooldown } from './cooldownService.js';
import { getTile } from './mapService.js';
import { getTerrainTypeById, getResources } from './terrainTypeService.js';
import { getZoneById, getZoneResources } from './zoneService.js';
import { mergeResourceTables } from '../utils/resourceTables.js';
import { addItem } from './inventoryService.js';

const GATHER_COOLDOWN_SETTING_KEY = 'gather_cooldown_hours';
const DEFAULT_GATHER_COOLDOWN_HOURS = 4;

const SQL = {
  getCooldownStatus: `
    SELECT TIMESTAMPDIFF(SECOND, NOW(), DATE_ADD(last_used_at, INTERVAL ? SECOND)) AS seconds_remaining
    FROM ${T.tile_resource_cooldowns}
    WHERE tile_id = ? AND player_id = ?
  `,
};

export async function getGatherCooldownHours() {
  const raw = Number(await getSetting(GATHER_COOLDOWN_SETTING_KEY, String(DEFAULT_GATHER_COOLDOWN_HOURS)));
  return Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_GATHER_COOLDOWN_HOURS;
}

export async function setGatherCooldownHours(hours) {
  if (!Number.isFinite(hours) || hours <= 0) {
    throw new Error('El cooldown de recolección debe ser un número mayor que 0.');
  }
  await setSetting(GATHER_COOLDOWN_SETTING_KEY, String(hours));
}

export async function getTileGatherables(tile) {
  const [terrainResources, zoneResources] = await Promise.all([
    getResources(tile.terrain_type_id),
    getZoneResources(tile.zone_id),
  ]);
  return mergeResourceTables(terrainResources, zoneResources);
}

export function rollGatherResult(resources, targetItemName) {
  const hits = resources.filter(r => Math.random() * 100 < r.drop_chance_percent);
  if (hits.length === 0) return null;

  const target = hits.find(r => r.name === targetItemName);
  if (target) return { ...target, wasTarget: true };

  const surprise = hits[Math.floor(Math.random() * hits.length)];
  return { ...surprise, wasTarget: false };
}

export async function attemptGather(discordId, targetItemName) {
  const player = await getPlayerByDiscordId(discordId);
  if (!player) throw new UserFacingError('Tu perfil no está registrado. Usa `/personaje crear` para empezar a rolear.');
  if (!player.is_alive) throw new UserFacingError('Tu personaje está muerto y no puede recolectar nada.');

  const tile = await getTile(player.coord_x, player.coord_y);
  if (!tile) throw new UserFacingError('Tu casilla actual no existe en el mapa — avisa a Staff.');

  const [terrainType, zone] = await Promise.all([
    getTerrainTypeById(tile.terrain_type_id),
    getZoneById(tile.zone_id),
  ]);
  const place = zone
    ? `${terrainType?.display_name ?? 'Este terreno'} (${zone.display_name})`
    : (terrainType?.display_name ?? 'Este terreno');

  const resources = await getTileGatherables(tile);
  if (resources.length === 0) {
    throw new UserFacingError(`**${place}** no tiene ningún recurso configurado para recolectar.`);
  }

  const target = resources.find(r => r.name === targetItemName);
  if (!target) {
    const available = resources.map(r => `\`${r.name}\``).join(', ');
    throw new UserFacingError(`**${place}** no ofrece \`${targetItemName}\` — prueba con: ${available}.`);
  }

  const cooldownSeconds = Math.round((await getGatherCooldownHours()) * 3600);
  const result = rollGatherResult(resources, targetItemName);

  const claimed = await withTransaction(async () => {
    if (!(await claimCooldown(T.tile_resource_cooldowns, 'tile_id', tile.id, player.id, cooldownSeconds))) {
      return false;
    }
    if (result) await addItem(discordId, result.name, result.quantity);
    return true;
  });

  if (!claimed) {
    const status = await queryOne(SQL.getCooldownStatus, [cooldownSeconds, tile.id, player.id]);
    throw new UserFacingError(
      `Todavía no puedes recolectar aquí — podrás ${discordRelativeFromNow(Math.max(1, status?.seconds_remaining ?? 1))}.`
    );
  }

  logger.info(
    `[ResourceGather] ${discordId} recolectó en (${tile.coord_x},${tile.coord_y}) [${terrainType.name}${zone ? `/${zone.name}` : ''}], buscando "${targetItemName}": ` +
    `${result ? `${result.quantity}× ${result.name}${result.wasTarget ? '' : ' (no era lo buscado)'}` : 'nada'}`
  );

  return {
    x: tile.coord_x, y: tile.coord_y,
    terrainDisplayName: terrainType.display_name,
    zoneDisplayName: zone?.display_name ?? null,
    hit: Boolean(result),
    wasTarget: result?.wasTarget ?? false,
    grantedItemName: result?.name ?? null,
    grantedItemDisplay: result?.display_name ?? null,
    grantedItemEmoji: result?.emoji ?? null,
    grantedQuantity: result?.quantity ?? 0,
  };
}
