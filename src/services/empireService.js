import { query } from '../database/index.js';
import { T } from '../database/tables.js';
import { UserFacingError } from '../utils/errors.js';
import { isConstructionRuined } from '../utils/sql.js';
import { getPlayerByDiscordId } from './playerService.js';
import { getAvailableLaburo } from './laburoService.js';
import { cyclesAvailableFor, settleConstructionProduction } from './productionService.js';
import { settleNpcProduction } from './npcProductionService.js';

const SQL = {
  getConstructions: `
    SELECT c.id, c.name, c.current_health, c.fuel_level, c.last_production_at, c.created_at,
           t.coord_x, t.coord_y,
           ct.display_name AS type_display_name, ct.emoji AS type_emoji, ct.max_health AS ct_max_health,
           ct.grants_resource_item_id, ct.grants_resource_rate,
           ct.production_interval_hours, ct.max_accrual_hours,
           ct.fuel_consumption_rate,
           gi.display_name AS granted_item_display, gi.emoji AS granted_item_emoji
    FROM ${T.constructions} c
    JOIN ${T.construction_types} ct ON c.construction_type_id = ct.id
    JOIN ${T.map_tiles} t ON c.tile_id = t.id
    LEFT JOIN ${T.items} gi ON ct.grants_resource_item_id = gi.id
    WHERE c.built_by_player_id = ?
    ORDER BY c.id ASC
  `,
  getNpcs: `
    SELECT n.id, n.role, n.equipped_tool_item_id, n.consecutive_hungry_days,
           n.last_production_at, n.created_at,
           t.coord_x, t.coord_y,
           nt.display_name AS type_display_name, nt.emoji AS type_emoji,
           nt.production_interval_hours, nt.max_accrual_hours,
           ti.display_name AS tool_display_name, ti.emoji AS tool_emoji,
           ti.npc_tool_produces_laburo_rate, ti.npc_tool_grants_item_id,
           gi.display_name AS granted_item_display, gi.emoji AS granted_item_emoji
    FROM ${T.npcs} n
    JOIN ${T.map_tiles} t ON n.tile_id = t.id
    JOIN ${T.npc_types} nt ON n.npc_type_id = nt.id
    LEFT JOIN ${T.items} ti ON n.equipped_tool_item_id = ti.id
    LEFT JOIN ${T.items} gi ON ti.npc_tool_grants_item_id = gi.id
    WHERE n.owner_player_id = ?
    ORDER BY n.id ASC
  `,
};

async function _resolvePlayer(discordId) {
  const player = await getPlayerByDiscordId(discordId);
  if (!player) throw new UserFacingError('Tu perfil no está registrado. Usa `/personaje crear` para empezar a rolear.');
  return player;
}

function _enrichConstruction(c) {
  const ruined = isConstructionRuined({ current_health: c.current_health, ct_max_health: c.ct_max_health });
  const hasProduction = c.grants_resource_item_id != null;
  const needsFuel = (c.fuel_consumption_rate ?? 0) > 0;
  const fuelEmpty = needsFuel && (c.fuel_level ?? 0) < c.fuel_consumption_rate;
  const cyclesReady = hasProduction && !ruined && !fuelEmpty
    ? cyclesAvailableFor({
        lastProductionAt: c.last_production_at, createdAt: c.created_at,
        intervalHours: c.production_interval_hours ?? 24, maxAccrualHours: c.max_accrual_hours ?? 48,
      })
    : 0;
  return { ...c, ruined, hasProduction, needsFuel, fuelEmpty, cyclesReady };
}

function _enrichNpc(n) {
  const hasTool = n.equipped_tool_item_id != null;
  const producesKind = n.npc_tool_produces_laburo_rate != null ? 'laburo' : (n.npc_tool_grants_item_id != null ? 'resource' : null);
  const cyclesReady = n.role === 'producer' && producesKind
    ? cyclesAvailableFor({
        lastProductionAt: n.last_production_at, createdAt: n.created_at,
        intervalHours: n.production_interval_hours ?? 24, maxAccrualHours: n.max_accrual_hours ?? 48,
      })
    : 0;
  return { ...n, hasTool, producesKind, cyclesReady };
}

export async function getEmpireSummary(discordId) {
  const player = await _resolvePlayer(discordId);
  const [laburo, constructionsRaw, npcsRaw] = await Promise.all([
    getAvailableLaburo(discordId),
    query(SQL.getConstructions, [player.id]),
    query(SQL.getNpcs, [player.id]),
  ]);

  return {
    player,
    laburo,
    constructions: constructionsRaw.map(_enrichConstruction),
    npcs: npcsRaw.map(_enrichNpc),
  };
}

export async function collectAllProduction(discordId) {
  const player = await _resolvePlayer(discordId);
  const [constructions, npcs] = await Promise.all([
    query(SQL.getConstructions, [player.id]),
    query(SQL.getNpcs, [player.id]),
  ]);

  const lines = [];
  for (const c of constructions) {
    try {
      const result = await settleConstructionProduction(c.id);
      if (result.cyclesRun > 0) {
        lines.push(`${c.type_emoji ?? '🏭'} **${c.name}**: +${result.produced} ${result.itemName}`);
      }
    } catch (err) {
      lines.push(`⚠️ **${c.name}**: ${err instanceof UserFacingError ? err.message : 'no se pudo cobrar su producción.'}`);
    }
  }
  for (const n of npcs) {
    try {
      const result = await settleNpcProduction(n.id);
      if (result.cyclesRun > 0) {
        lines.push(result.kind === 'laburo'
          ? `${n.type_emoji ?? '👤'} **${n.type_display_name}**: +${result.produced} Laburo`
          : `${n.type_emoji ?? '👤'} **${n.type_display_name}**: +${result.produced} ${result.itemName} (en su almacén — \`/npc recoger\`)`);
      }
    } catch (err) {
      lines.push(`⚠️ **${n.type_display_name}**: ${err instanceof UserFacingError ? err.message : 'no se pudo cobrar su producción.'}`);
    }
  }
  return lines;
}
