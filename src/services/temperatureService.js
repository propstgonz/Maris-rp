import { query, queryOne, execute, withTransaction } from '../database/index.js';
import { T } from '../database/tables.js';
import logger from '../utils/logger.js';
import { getSetting, setSetting } from './settingsService.js';
import {
  buildTemperatureField, validateTemperatureRange, SMOOTH_MARGIN,
  DEFAULT_TEMP_MIN, DEFAULT_TEMP_MAX,
} from '../utils/temperature.js';

const SEED_KEY = 'world_temperature_seed';
const WORLD_MIN_KEY = 'world_temperature_min';
const WORLD_MAX_KEY = 'world_temperature_max';
const WRITE_CHUNK = 200;

const TILE_SELECT = `
  SELECT t.id, t.coord_x, t.coord_y,
         COALESCE(z.temp_min, ?) AS temp_min,
         COALESCE(z.temp_max, ?) AS temp_max
  FROM ${T.map_tiles} t
  LEFT JOIN ${T.zones} z ON t.zone_id = z.id
`;

const SQL = {
  allTiles: TILE_SELECT,
  tilesInRect: `${TILE_SELECT} WHERE t.coord_x BETWEEN ? AND ? AND t.coord_y BETWEEN ? AND ?`,
  zoneBounds: `
    SELECT MIN(coord_x) AS min_x, MAX(coord_x) AS max_x, MIN(coord_y) AS min_y, MAX(coord_y) AS max_y
    FROM ${T.map_tiles} WHERE zone_id = ?
  `,
};

export async function getWorldTemperatureRange() {
  const min = Number(await getSetting(WORLD_MIN_KEY, String(DEFAULT_TEMP_MIN)));
  const max = Number(await getSetting(WORLD_MAX_KEY, String(DEFAULT_TEMP_MAX)));
  if (!Number.isFinite(min) || !Number.isFinite(max) || min > max) {
    return { tempMin: DEFAULT_TEMP_MIN, tempMax: DEFAULT_TEMP_MAX };
  }
  return { tempMin: min, tempMax: max };
}

export async function setWorldTemperatureRange(tempMin, tempMax) {
  const range = validateTemperatureRange(tempMin, tempMax);
  await setSetting(WORLD_MIN_KEY, String(range.tempMin));
  await setSetting(WORLD_MAX_KEY, String(range.tempMax));
  return range;
}

export async function getTemperatureSeed() {
  const stored = Number(await getSetting(SEED_KEY, null));
  if (Number.isInteger(stored) && stored > 0) return stored;
  return rerollTemperatureSeed();
}

export async function rerollTemperatureSeed() {
  const seed = 1 + Math.floor(Math.random() * 2147483646);
  await setSetting(SEED_KEY, String(seed));
  return seed;
}

async function writeTemperatures(rows) {
  if (rows.length === 0) return 0;
  await withTransaction(async () => {
    for (let i = 0; i < rows.length; i += WRITE_CHUNK) {
      const chunk = rows.slice(i, i + WRITE_CHUNK);
      const cases = chunk.map(() => 'WHEN ? THEN ?').join(' ');
      const placeholders = chunk.map(() => '?').join(', ');
      const params = [
        ...chunk.flatMap(row => [row.id, row.temperature]),
        ...chunk.map(row => row.id),
      ];
      await execute(
        `UPDATE ${T.map_tiles} SET temperature = CASE id ${cases} END WHERE id IN (${placeholders})`,
        params
      );
    }
  });
  return rows.length;
}

export async function regenerateTemperatures(rect = null) {
  const [seed, world] = await Promise.all([getTemperatureSeed(), getWorldTemperatureRange()]);
  const rows = rect
    ? await query(SQL.tilesInRect, [
        world.tempMin, world.tempMax,
        rect.minX - SMOOTH_MARGIN, rect.maxX + SMOOTH_MARGIN,
        rect.minY - SMOOTH_MARGIN, rect.maxY + SMOOTH_MARGIN,
      ])
    : await query(SQL.allTiles, [world.tempMin, world.tempMax]);

  if (rows.length === 0) return 0;

  const field = buildTemperatureField(
    rows.map(row => ({
      id: row.id,
      x: row.coord_x,
      y: row.coord_y,
      tempMin: Number(row.temp_min),
      tempMax: Number(row.temp_max),
    })),
    seed
  );

  const target = rect
    ? field.filter(t => t.x >= rect.minX && t.x <= rect.maxX && t.y >= rect.minY && t.y <= rect.maxY)
    : field;

  return writeTemperatures(target);
}

export async function regenerateTemperaturesForRange(x1, y1, x2, y2) {
  return regenerateTemperatures({
    minX: Math.min(x1, x2), maxX: Math.max(x1, x2),
    minY: Math.min(y1, y2), maxY: Math.max(y1, y2),
  });
}

export async function regenerateZoneTemperatures(zoneId) {
  if (zoneId == null) return 0;
  const bounds = await queryOne(SQL.zoneBounds, [zoneId]);
  if (!bounds || bounds.min_x == null) return 0;
  return regenerateTemperatures({
    minX: bounds.min_x, maxX: bounds.max_x,
    minY: bounds.min_y, maxY: bounds.max_y,
  });
}

export async function regenerateWholeMapTemperatures({ reroll = false } = {}) {
  if (reroll) await rerollTemperatureSeed();
  const affected = await regenerateTemperatures();
  logger.info(`[Temperature] Temperaturas recalculadas en ${affected} casilla(s)${reroll ? ' con semilla nueva' : ''}`);
  return affected;
}
