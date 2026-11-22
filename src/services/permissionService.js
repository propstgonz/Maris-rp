import { query, queryOne, execute } from '../database/index.js';
import { T } from '../database/tables.js';
import { UserFacingError } from '../utils/errors.js';
import { checkConstructionPolicy, describeConstructionPolicy } from '../utils/constructionPolicy.js';
import { isValidPermissionAction } from '../utils/permissionActions.js';
import { toSqlDatetime } from '../utils/sqlDatetime.js';
import logger from '../utils/logger.js';

const SQL = {
  getPlayerForPermission: `SELECT id, faction_id, faction_rank_id FROM ${T.players} WHERE discord_id = ?`,
  getRankById:            `SELECT * FROM ${T.faction_ranks} WHERE id = ?`,
  getDefaultRank:         `SELECT * FROM ${T.faction_ranks} WHERE faction_id = ? AND is_default = 1`,
  getLeaderRank:          `SELECT * FROM ${T.faction_ranks} WHERE faction_id = ? AND is_leader = 1`,
  listRanksByFaction:     `SELECT * FROM ${T.faction_ranks} WHERE faction_id = ? ORDER BY rank_order ASC`,
  getRankByName:          `SELECT * FROM ${T.faction_ranks} WHERE faction_id = ? AND name = ?`,

  getValidGrant: `
    SELECT * FROM ${T.permission_grants}
    WHERE subject_player_id = ? AND scope_type = ? AND scope_id = ? AND action = ?
      AND (expires_at IS NULL OR expires_at > NOW())
  `,
  upsertGrant: `
    INSERT INTO ${T.permission_grants} (subject_player_id, scope_type, scope_id, action, granted_by_player_id, expires_at)
    VALUES (?, ?, ?, ?, ?, ?)
    ON DUPLICATE KEY UPDATE granted_by_player_id = VALUES(granted_by_player_id), expires_at = VALUES(expires_at), granted_at = NOW()
  `,
  deleteGrant: `
    DELETE FROM ${T.permission_grants} WHERE subject_player_id = ? AND scope_type = ? AND scope_id = ? AND action = ?
  `,
  pruneExpiredGrants: `DELETE FROM ${T.permission_grants} WHERE expires_at IS NOT NULL AND expires_at <= NOW()`,

  getRankRequirement: `
    SELECT required_rank_order FROM ${T.faction_rank_permissions} WHERE faction_id = ? AND action = ?
  `,
  listRequirementsByFaction: `
    SELECT action, required_rank_order FROM ${T.faction_rank_permissions} WHERE faction_id = ? ORDER BY action ASC
  `,
  upsertRequirement: `
    INSERT INTO ${T.faction_rank_permissions} (faction_id, action, required_rank_order)
    VALUES (?, ?, ?)
    ON DUPLICATE KEY UPDATE required_rank_order = VALUES(required_rank_order)
  `,
  deleteRequirement: `DELETE FROM ${T.faction_rank_permissions} WHERE faction_id = ? AND action = ?`,

  getFactionOwner: `SELECT owner_player_id FROM ${T.factions} WHERE id = ?`,
  setPlayerRank:   `UPDATE ${T.players} SET faction_rank_id = ? WHERE id = ?`,
};

export async function resolveActorRankOrder(playerId, factionId) {
  if (!playerId || !factionId) return null;
  const player = await queryOne(`SELECT faction_rank_id FROM ${T.players} WHERE id = ?`, [playerId]);
  if (!player) return null;

  const rank = player.faction_rank_id
    ? await queryOne(SQL.getRankById, [player.faction_rank_id])
    : await queryOne(SQL.getDefaultRank, [factionId]);

  return rank?.rank_order ?? null;
}

export async function getFactionRanks(factionId) {
  return query(SQL.listRanksByFaction, [factionId]);
}

export async function assertNotActingOnSuperior(actingPlayerId, targetPlayerId, factionId, message) {
  const actorRankOrder = await resolveActorRankOrder(actingPlayerId, factionId);
  const targetRankOrder = await resolveActorRankOrder(targetPlayerId, factionId);
  if (actorRankOrder == null || (targetRankOrder != null && targetRankOrder > actorRankOrder)) {
    throw new UserFacingError(message);
  }
}

export async function getPlayerRank(playerId, factionId) {
  if (!playerId || !factionId) return null;
  const player = await queryOne(`SELECT faction_rank_id FROM ${T.players} WHERE id = ?`, [playerId]);
  if (!player) return null;
  return player.faction_rank_id
    ? await queryOne(SQL.getRankById, [player.faction_rank_id])
    : await queryOne(SQL.getDefaultRank, [factionId]);
}

export async function getFactionRankByName(factionId, name) {
  return (await queryOne(SQL.getRankByName, [factionId, name])) ?? null;
}

export async function getRankRequirements(factionId) {
  return query(SQL.listRequirementsByFaction, [factionId]);
}

export async function resolvePermission(actor, scope, action, fallbackPolicy = null) {
  if (actor.isRolepriest) return { allowed: true, reason: null };

  const player = await queryOne(SQL.getPlayerForPermission, [actor.discordId]);
  const playerId = player?.id ?? null;
  const factionId = player?.faction_id ?? null;

  if (scope.ownerPlayerId != null && playerId != null && scope.ownerPlayerId === playerId) {
    return { allowed: true, reason: null };
  }

  if (playerId != null && scope.id != null) {
    const grant = await queryOne(SQL.getValidGrant, [playerId, scope.type, scope.id, action]);
    if (grant) return { allowed: true, reason: null };
  }

  let requiredRankOrder = null;
  if (factionId != null && scope.factionId != null && scope.factionId === factionId) {
    const requirement = await queryOne(SQL.getRankRequirement, [factionId, action]);
    requiredRankOrder = requirement?.required_rank_order ?? null;
    if (requiredRankOrder != null) {
      const rankOrder = await resolveActorRankOrder(playerId, factionId);
      if (rankOrder != null && rankOrder >= requiredRankOrder) {
        return { allowed: true, reason: null };
      }
    }
  }

  if (fallbackPolicy != null) {
    const allowed = checkConstructionPolicy(
      fallbackPolicy,
      { builtByPlayerId: scope.ownerPlayerId, tileFactionId: scope.factionId },
      { playerId, factionId, isRolepriest: false }
    );
    if (allowed) return { allowed: true, reason: null };
    return { allowed: false, reason: `este tipo de construcción solo permite esto a ${describeConstructionPolicy(fallbackPolicy)}` };
  }

  if (requiredRankOrder != null) {
    const ranks = factionId != null ? await getFactionRanks(factionId) : [];
    const needed = ranks.find(r => r.rank_order === requiredRankOrder);
    return { allowed: false, reason: needed ? `necesitas rango ${needed.display_name} o superior` : 'tu rango no alcanza para esto' };
  }

  return { allowed: false, reason: 'no tienes permiso para esto' };
}

export async function grantPermission(granterActor, targetPlayerId, scope, action, expiresAt = null) {
  if (!isValidPermissionAction(action)) {
    throw new UserFacingError(`"${action}" no es una acción de permiso reconocida.`);
  }

  const granterHasAction = await resolvePermission(granterActor, scope, action);
  if (!granterHasAction.allowed && !granterActor.isRolepriest) {
    throw new UserFacingError(`No puedes ceder este permiso porque tú mismo no lo tienes.`);
  }

  const canManage = granterActor.isRolepriest
    || (scope.ownerPlayerId != null && (await queryOne(SQL.getPlayerForPermission, [granterActor.discordId]))?.id === scope.ownerPlayerId)
    || (await resolvePermission(granterActor, scope, 'faction.rank_manage')).allowed;

  if (!canManage) {
    throw new UserFacingError('Necesitas ser dueño de esto o tener "faction.rank_manage" para ceder permisos sobre ello.');
  }

  const granter = await queryOne(SQL.getPlayerForPermission, [granterActor.discordId]);
  await execute(SQL.upsertGrant, [
    targetPlayerId, scope.type, scope.id, action, granter?.id ?? null,
    expiresAt ? toSqlDatetime(expiresAt) : null,
  ]);
  logger.info(`[Permissions] ${granterActor.discordId} cedió "${action}" sobre ${scope.type}#${scope.id} a jugador #${targetPlayerId}`);
}

export async function setRankRequirement(actor, factionId, action, requiredRankOrder) {
  if (!isValidPermissionAction(action)) {
    throw new UserFacingError(`"${action}" no es una acción de permiso reconocida.`);
  }
  const scope = { type: 'faction', id: factionId, factionId, ownerPlayerId: (await queryOne(SQL.getFactionOwner, [factionId]))?.owner_player_id ?? null };
  const allowed = actor.isRolepriest || (await resolvePermission(actor, scope, 'faction.rank_manage')).allowed;
  if (!allowed) {
    throw new UserFacingError('Necesitas "faction.rank_manage" en esta facción para configurar sus permisos.');
  }
  if (requiredRankOrder == null) {
    await execute(SQL.deleteRequirement, [factionId, action]);
  } else {
    await execute(SQL.upsertRequirement, [factionId, action, requiredRankOrder]);
  }
}

export async function setPlayerRank(actor, targetPlayerId, factionId, rankId) {
  const rank = await queryOne(SQL.getRankById, [rankId]);
  if (!rank || rank.faction_id !== factionId) {
    throw new UserFacingError('Ese rango no existe en esta facción.');
  }

  const owner = await queryOne(SQL.getFactionOwner, [factionId]);
  const scope = { type: 'faction', id: factionId, factionId, ownerPlayerId: owner?.owner_player_id ?? null };
  const isOwner = scope.ownerPlayerId != null && (await queryOne(SQL.getPlayerForPermission, [actor.discordId]))?.id === scope.ownerPlayerId;

  if (!actor.isRolepriest && !isOwner) {
    const promoteCheck = await resolvePermission(actor, scope, 'faction.promote');
    if (!promoteCheck.allowed) {
      throw new UserFacingError(`No puedes ascender/descender miembros — ${promoteCheck.reason}.`);
    }
    const actingPlayer = await queryOne(SQL.getPlayerForPermission, [actor.discordId]);
    const actorRankOrder = await resolveActorRankOrder(actingPlayer?.id ?? null, factionId);
    if (actorRankOrder == null || rank.rank_order > actorRankOrder) {
      throw new UserFacingError('No puedes ascender a alguien por encima de tu propio rango.');
    }
    await assertNotActingOnSuperior(
      actingPlayer?.id ?? null, targetPlayerId, factionId,
      'No puedes cambiar el rango de alguien por encima de tu propio rango.'
    );
  }

  await execute(SQL.setPlayerRank, [rankId, targetPlayerId]);
}

export async function pruneExpiredGrants() {
  const result = await execute(SQL.pruneExpiredGrants);
  return result.changes ?? 0;
}
