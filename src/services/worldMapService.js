import { query } from '../database/index.js';
import { T } from '../database/tables.js';
import { getPlayerByDiscordId, getPlayersInRadius } from './playerService.js';
import { getTilesInRegion, getConstructionsInRadius, getTile } from './mapService.js';
import { getNpcsInRadius } from './npcService.js';
import { getTerrainTypeById } from './terrainTypeService.js';
import { getZoneById } from './zoneService.js';
import { getTileGatherables } from './resourceGatherService.js';
import { getItemsAtTile } from './tileItemService.js';
import { getTravelStatus } from './travelService.js';
import { getAvailableLaburo, getLaburoCooldownRemaining } from './laburoService.js';
import { buildAssetUrl } from '../utils/publicUrl.js';

export const VIEW_RADIUS = 4;

const SQL = {
  worldOutline: `SELECT coord_x, coord_y FROM ${T.map_tiles}`,
  myTileConstructions: `
    SELECT c.id, c.current_health,
           ct.name AS ct_name, ct.display_name AS ct_display_name, ct.emoji AS ct_emoji,
           ct.max_health AS ct_max_health,
           (ct.fuel_item_id IS NOT NULL) AS has_fuel,
           ct.is_market
    FROM ${T.constructions} c
    JOIN ${T.map_tiles} t ON c.tile_id = t.id
    LEFT JOIN ${T.construction_types} ct ON c.construction_type_id = ct.id
    WHERE t.coord_x = ? AND t.coord_y = ? AND ct.name IS NOT NULL
  `,
};

export class NoCharacterError extends Error {}

export async function buildWorldView(discordId, radius = VIEW_RADIUS) {
  const me = await getPlayerByDiscordId(discordId);
  if (!me?.character_created_at) {
    throw new NoCharacterError('Tu personaje ya no existe. Crea uno nuevo en Discord con `/personaje crear`.');
  }

  const x = me.coord_x;
  const y = me.coord_y;
  const r = Math.max(0, Math.trunc(radius));

  const visible = await getTilesInRegion(x - r, y - r, x + r, y + r, { withMedia: true });

  const players = (await getPlayersInRadius(x, y, r, discordId)).map(p => ({
    characterName: p.character_name,
    x: p.coord_x,
    y: p.coord_y,
    distance: p.distance,
    isAlive: Boolean(p.is_alive),
    avatarUrl: buildAssetUrl(p.avatar_filename, 'mapamundi'),
  }));

  const constructions = (await getConstructionsInRadius(x, y, r)).map(c => ({
    id: c.id,
    typeName: c.ct_name,
    name: c.ct_display_name ?? c.name,
    emoji: c.ct_emoji,
    x: c.coord_x,
    y: c.coord_y,
    distance: c.distance,
    health: c.current_health,
    maxHealth: c.ct_max_health,
  }));

  const npcs = (await getNpcsInRadius(x, y, r)).map(n => ({
    id: n.id,
    name: n.type_display_name,
    emoji: n.type_emoji,
    x: n.coord_x,
    y: n.coord_y,
    distance: n.distance,
    hp: n.current_hp,
    factionName: n.faction_display_name ?? null,
    factionEmoji: n.faction_emoji ?? null,
  }));

  const outline = [];
  for (const t of await query(SQL.worldOutline)) outline.push(t.coord_x, t.coord_y);

  const myTileRaw = await getTile(x, y);
  let myTile = null;
  if (myTileRaw) {
    const terrainType = await getTerrainTypeById(myTileRaw.terrain_type_id);
    const [zone, resources, tileItems, travel, myTileConstructionsRaw] = await Promise.all([
      getZoneById(myTileRaw.zone_id),
      getTileGatherables(myTileRaw),
      getItemsAtTile(x, y),
      getTravelStatus(discordId),
      query(SQL.myTileConstructions, [x, y]),
    ]);
    myTile = {
      terrainName: terrainType?.display_name ?? null,
      terrainEmoji: terrainType?.emoji ?? null,
      zoneName: zone?.display_name ?? null,
      zoneColor: zone?.color ?? null,
      temperature: myTileRaw.temperature == null ? null : Number(myTileRaw.temperature),
      resourceType: myTileRaw.resource_type,
      gatherable: resources.map(r => ({ name: r.name, displayName: r.display_name, emoji: r.emoji })),
      items: tileItems.map(i => ({ name: i.name, displayName: i.display_name, emoji: i.emoji, quantity: i.quantity })),
      constructions: myTileConstructionsRaw.map(c => ({
        id: c.id,
        typeName: c.ct_name,
        name: c.ct_display_name,
        emoji: c.ct_emoji,
        health: c.current_health,
        maxHealth: c.ct_max_health,
        isRuined: (c.current_health ?? c.ct_max_health ?? 10) <= 0,
        hasFuel: Boolean(c.has_fuel),
        isMarket: Boolean(c.is_market),
      })),
      npcs: npcs.filter(n => n.distance === 0),
      playersHere: players.filter(p => p.distance === 0).map(p => p.characterName),
      travel,
    };
  }

  const [laburoAvailable, laburoCooldownSeconds] = await Promise.all([
    getAvailableLaburo(discordId),
    getLaburoCooldownRemaining(discordId),
  ]);

  return {
    radius: r,
    me: {
      characterName: me.character_name,
      x, y,
      hp: me.hp,
      hunger: me.hunger,
      isAlive: Boolean(me.is_alive),
      avatarUrl: buildAssetUrl(me.avatar_filename, 'mapamundi'),
      laburoAvailable,
      laburoCooldownSeconds,
    },
    visible,
    players,
    constructions,
    npcs,
    outline,
    myTile,
  };
}

export function isWithinView(from, to, radius = VIEW_RADIUS) {
  return Math.max(Math.abs(to.x - from.x), Math.abs(to.y - from.y)) <= radius;
}
