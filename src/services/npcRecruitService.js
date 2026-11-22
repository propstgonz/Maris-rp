import { query, queryOne, execute, withTransaction } from '../database/index.js';
import { T } from '../database/tables.js';
import logger from '../utils/logger.js';
import { UserFacingError } from '../utils/errors.js';
import { resolvePermission } from './permissionService.js';
import { getFactionById } from './factionService.js';
import { getStorageContentsMap, spendFromStorage } from './factionStorageService.js';
import { listRecruitableNpcTypes, getNpcTypeByName, getNpcTypeById, getEquipment } from './npcTypeService.js';
import { createOwnedNpc, getNpcById } from './npcService.js';
import { settleNpcProduction, getNpcStorageContents, withdrawFromNpcStorage } from './npcProductionService.js';
import { getPlayerByDiscordId } from './playerService.js';
import { getItemByName, getItemById } from './itemService.js';
import { hasEnough, removeItem, addItem } from './inventoryService.js';

const ROLES = ['producer', 'soldier'];

const SQL = {
  getOffice: `
    SELECT c.id, c.tile_id, t.coord_x, t.coord_y, t.faction_id AS tile_faction_id,
           ct.is_recruitment_office, ct.display_name AS type_display_name
    FROM ${T.constructions} c
    JOIN ${T.construction_types} ct ON c.construction_type_id = ct.id
    JOIN ${T.map_tiles} t ON c.tile_id = t.id
    WHERE c.id = ?
  `,
  getTile: `SELECT id, coord_x, coord_y FROM ${T.map_tiles} WHERE coord_x = ? AND coord_y = ?`,
  getOwnedNpcs: `
    SELECT n.id, n.tile_id, n.owner_player_id, n.role, n.equipped_tool_item_id, t.coord_x, t.coord_y,
           nt.display_name AS type_display_name, nt.emoji AS type_emoji,
           ti.display_name AS tool_display_name, ti.emoji AS tool_emoji
    FROM ${T.npcs} n
    JOIN ${T.map_tiles} t ON n.tile_id = t.id
    JOIN ${T.npc_types} nt ON n.npc_type_id = nt.id
    LEFT JOIN ${T.items} ti ON n.equipped_tool_item_id = ti.id
    WHERE n.owner_player_id = ?
    ORDER BY n.id ASC
  `,
};

async function _resolveOffice(constructionId) {
  const office = await queryOne(SQL.getOffice, [constructionId]);
  if (!office) throw new UserFacingError(`No existe ninguna construcción con ID ${constructionId}.`);
  if (!office.is_recruitment_office) {
    throw new UserFacingError(`**${office.type_display_name}** no es una oficina de reclutamiento.`);
  }
  return office;
}

function _isAffordable(equipment, storageMap) {
  return equipment.every(eq => (storageMap.get(eq.item_id) ?? 0) >= eq.quantity);
}

export async function listRecruitableNpcTypesForOffice(constructionId) {
  const office = await queryOne(SQL.getOffice, [constructionId]);
  if (!office?.is_recruitment_office || !office.tile_faction_id) return [];

  const [storageMap, types] = await Promise.all([
    getStorageContentsMap(office.tile_faction_id),
    listRecruitableNpcTypes(),
  ]);

  const affordable = [];
  for (const type of types) {
    const equipment = await getEquipment(type.id);
    if (_isAffordable(equipment, storageMap)) affordable.push(type);
  }
  return affordable;
}

export async function recruitNpc(discordId, constructionId, npcTypeName, actor = {}) {
  const player = await getPlayerByDiscordId(discordId);
  if (!player) throw new UserFacingError('Tu perfil no está registrado. Usa `/personaje crear` para empezar a rolear.');

  const office = await _resolveOffice(constructionId);
  if (!office.tile_faction_id) {
    throw new UserFacingError('Esta casilla no pertenece a ninguna facción — no hay almacén del que reclutar.');
  }

  const faction = await getFactionById(office.tile_faction_id);
  const scope = { type: 'faction', id: faction.id, factionId: faction.id, ownerPlayerId: faction.owner_player_id };
  const permission = await resolvePermission({ discordId, isRolepriest: Boolean(actor.isRolepriest) }, scope, 'faction.npc_recruit');
  if (!permission.allowed) {
    throw new UserFacingError(`No puedes reclutar aquí — ${permission.reason}.`);
  }

  const npcType = await getNpcTypeByName(npcTypeName.toLowerCase().trim());
  if (!npcType || !npcType.is_recruitable) {
    throw new UserFacingError(`\`${npcTypeName}\` no es un tipo de NPC reclutable.`);
  }

  const equipment = await getEquipment(npcType.id);

  let npcId;
  await withTransaction(async () => {
    for (const eq of equipment) {
      await spendFromStorage(faction.id, eq.item_id, eq.quantity);
    }
    const npc = await createOwnedNpc(office.tile_id, npcType.id, player.id);
    npcId = npc.id;
  });

  logger.info(`[NpcRecruit] ${discordId} reclutó "${npcType.display_name}" (#${npcId}) en oficina #${constructionId} — facción "${faction.name}"`);
  return getNpcById(npcId);
}

async function _returnEquippedTool(discordId, npc) {
  if (npc.equipped_tool_item_id == null) return;
  const tool = await getItemById(npc.equipped_tool_item_id);
  if (tool) await addItem(discordId, tool.name, 1);
  await execute(`UPDATE ${T.npcs} SET equipped_tool_item_id = NULL WHERE id = ?`, [npc.id]);
}

async function _resolveOwnedNpc(discordId, npcId) {
  const player = await getPlayerByDiscordId(discordId);
  if (!player) throw new UserFacingError('Tu perfil no está registrado. Usa `/personaje crear` para empezar a rolear.');

  const npc = await getNpcById(npcId);
  if (!npc) throw new UserFacingError(`No existe ningún NPC con ID ${npcId}.`);
  if (npc.owner_player_id !== player.id) {
    throw new UserFacingError('Ese NPC no es tuyo.');
  }
  return { player, npc };
}

export async function setNpcRole(discordId, npcId, role) {
  if (!ROLES.includes(role)) {
    throw new UserFacingError(`Rol inválido — debe ser ${ROLES.join(' o ')}.`);
  }
  const { npc } = await _resolveOwnedNpc(discordId, npcId);

  const npcType = await getNpcTypeById(npc.npc_type_id);
  const allowed = role === 'producer' ? npcType.can_produce : npcType.can_soldier;
  if (!allowed) {
    throw new UserFacingError(`**${npcType.display_name}** no puede ser ${role === 'producer' ? 'productor' : 'soldado'}.`);
  }

  if (npc.role !== role) {
    await _returnEquippedTool(discordId, npc);
  }
  await execute(`UPDATE ${T.npcs} SET role = ? WHERE id = ?`, [role, npcId]);

  logger.info(`[NpcRecruit] ${discordId} fijó el rol de su NPC #${npcId} → ${role}`);
  return getNpcById(npcId);
}

export async function equipNpcTool(discordId, npcId, itemName) {
  const { npc } = await _resolveOwnedNpc(discordId, npcId);
  if (!npc.role) {
    throw new UserFacingError('Fija primero el rol de este NPC con `/npc rol`.');
  }

  const item = await getItemByName(itemName.toLowerCase().trim());
  if (!item) throw new UserFacingError(`No existe ningún ítem "${itemName}" en el catálogo.`);

  if (npc.role === 'producer') {
    if (item.npc_tool_grants_item_id == null && item.npc_tool_produces_laburo_rate == null) {
      throw new UserFacingError(`**${item.display_name}** no sirve como herramienta de producción.`);
    }
  } else if (item.item_type !== 'arma') {
    throw new UserFacingError(`**${item.display_name}** no es un arma — un soldado necesita una.`);
  }

  if (!(await hasEnough(discordId, item.name, 1))) {
    throw new UserFacingError(`No tienes **${item.display_name}** en tu inventario.`);
  }

  await withTransaction(async () => {
    await _returnEquippedTool(discordId, npc);
    await removeItem(discordId, item.name, 1);
    await execute(`UPDATE ${T.npcs} SET equipped_tool_item_id = ? WHERE id = ?`, [item.id, npcId]);
  });

  logger.info(`[NpcRecruit] ${discordId} equipó "${item.name}" a su NPC #${npcId} (${npc.role})`);
  return getNpcById(npcId);
}

export async function unequipNpcTool(discordId, npcId) {
  const { npc } = await _resolveOwnedNpc(discordId, npcId);
  if (npc.equipped_tool_item_id == null) {
    throw new UserFacingError('Ese NPC no lleva ninguna herramienta puesta.');
  }

  await _returnEquippedTool(discordId, npc);

  logger.info(`[NpcRecruit] ${discordId} desequipó la herramienta de su NPC #${npcId}`);
  return getNpcById(npcId);
}

export async function relocateNpc(discordId, npcId) {
  const { player } = await _resolveOwnedNpc(discordId, npcId);

  const tile = await queryOne(SQL.getTile, [player.coord_x, player.coord_y]);
  if (!tile) throw new UserFacingError('Tu casilla actual no existe en el mapa — avisa a Staff.');
  await execute(`UPDATE ${T.npcs} SET tile_id = ? WHERE id = ?`, [tile.id, npcId]);

  logger.info(`[NpcRecruit] ${discordId} reubicó su NPC #${npcId} a (${player.coord_x},${player.coord_y})`);
  return getNpcById(npcId);
}

export async function collectNpcProduction(discordId, npcId) {
  const { npc } = await _resolveOwnedNpc(discordId, npcId);

  const settlement = await settleNpcProduction(npcId);
  const storage = await getNpcStorageContents(npcId);
  return { npc, settlement, storage };
}

export async function withdrawNpcStorage(discordId, npcId, itemName, quantity) {
  await _resolveOwnedNpc(discordId, npcId);
  return withdrawFromNpcStorage(discordId, npcId, itemName, quantity);
}

export async function getOwnedNpcs(playerId) {
  return query(SQL.getOwnedNpcs, [playerId]);
}
