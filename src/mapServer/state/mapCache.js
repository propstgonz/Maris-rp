import logger from '../../utils/logger.js';
import { getTilesInRegion } from '../../services/mapService.js';
import { buildAssetUrl } from '../../utils/publicUrl.js';
import { getAvatarUrl } from '../../utils/playerAvatar.js';

const DEFAULT_AVATAR_URL = '/static/default-avatar.svg';

function parseJsonAgg(value) {
  if (Array.isArray(value)) return value;
  if (typeof value === 'string') return JSON.parse(value);
  return [];
}

export function enrichTileMedia(tile) {
  const playerAvatars = parseJsonAgg(tile.player_avatars_json)
    .map(filename => getAvatarUrl({ avatar_filename: filename }, '/api/tiles') ?? DEFAULT_AVATAR_URL);
  const constructionThumbs = parseJsonAgg(tile.construction_thumbs_json)
    .map(({ image, emoji }) => ({ url: image ? buildAssetUrl(image, '/api/tiles') : null, emoji }));
  const generatorThumbs = parseJsonAgg(tile.generator_thumbs_json);

  const { player_avatars_json, construction_thumbs_json, generator_thumbs_json, ...rest } = tile;
  return { ...rest, player_avatars: playerAvatars, construction_thumbs: constructionThumbs, generator_thumbs: generatorThumbs };
}

export const MAP_CACHE_BOUND = 100;

export const MAP_CACHE_REFRESH_MS = 20_000;

export const MAX_TILES_READ = (MAP_CACHE_BOUND + 1) ** 2;

let mapCache = [];
let mapCacheReady = false;

export async function refreshMapCache() {
  try {
    const raw = await getTilesInRegion(0, 0, MAP_CACHE_BOUND, MAP_CACHE_BOUND, { withMedia: true });
    mapCache = raw.map(enrichTileMedia);
    mapCacheReady = true;
  } catch (err) {
    logger.error(`[MapServer] Error refrescando la caché del mapa: ${err.message}`);
  }
}

export async function getTilesInRegionCached(minX, minY, maxX, maxY, withMedia) {
  if (!mapCacheReady || minX < 0 || minY < 0 || maxX > MAP_CACHE_BOUND || maxY > MAP_CACHE_BOUND) {
    const tiles = await getTilesInRegion(minX, minY, maxX, maxY, { withMedia });
    return withMedia ? tiles.map(enrichTileMedia) : tiles;
  }
  const filtered = mapCache.filter(t => t.coord_x >= minX && t.coord_x <= maxX && t.coord_y >= minY && t.coord_y <= maxY);
  if (withMedia) return filtered;
  return filtered.map(({ player_avatars, construction_thumbs, generator_thumbs, ...rest }) => rest);
}
