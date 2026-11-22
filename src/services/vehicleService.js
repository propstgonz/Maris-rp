import { queryOne, query } from '../database/index.js';
import { T } from '../database/tables.js';

const SQL = {
  countMatching: `
    SELECT COUNT(*) AS cnt
    FROM ${T.inventory} inv
    JOIN ${T.items} i          ON inv.item_id = i.id
    JOIN ${T.players} p        ON inv.player_id = p.id
    WHERE p.discord_id = ? AND i.item_type = 'vehiculo' AND i.vehicle_category = ? AND inv.quantity > 0
  `,

  getOwnedVehicles: `
    SELECT i.vehicle_category, i.vehicle_speed_multiplier
    FROM ${T.inventory} inv
    JOIN ${T.items} i   ON inv.item_id = i.id
    JOIN ${T.players} p ON inv.player_id = p.id
    WHERE p.discord_id = ? AND i.item_type = 'vehiculo' AND inv.quantity > 0
  `,





  getActiveMountVehicle: `
    SELECT nt.vehicle_category, nt.vehicle_speed_multiplier
    FROM ${T.npcs} n
    JOIN ${T.npc_types} nt ON n.npc_type_id = nt.id
    JOIN ${T.players} p    ON n.owner_player_id = p.id
    WHERE p.discord_id = ? AND n.is_active_mount = 1 AND nt.vehicle_category IS NOT NULL
    LIMIT 1
  `,
};

export async function hasVehicleOfCategory(discordId, category) {
  const { cnt } = await queryOne(SQL.countMatching, [discordId, category]);
  if (cnt > 0) return true;

  const mount = await queryOne(SQL.getActiveMountVehicle, [discordId]);
  return mount?.vehicle_category === category;
}

export async function getBestVehicleSpeedMultiplier(discordId, relevantCategories = []) {
  const relevant = new Set(['terrestre', 'aereo', ...relevantCategories]);
  const vehicles = await query(SQL.getOwnedVehicles, [discordId]);

  let best = 1;
  for (const v of vehicles) {
    if (relevant.has(v.vehicle_category) && v.vehicle_speed_multiplier > best) {
      best = v.vehicle_speed_multiplier;
    }
  }

  const mount = await queryOne(SQL.getActiveMountVehicle, [discordId]);
  if (mount && relevant.has(mount.vehicle_category) && mount.vehicle_speed_multiplier > best) {
    best = mount.vehicle_speed_multiplier;
  }
  return best;
}
