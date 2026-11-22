import { query, queryOne, execute, withTransaction } from '../database/index.js';
import { T } from '../database/tables.js';
import { UserFacingError } from '../utils/errors.js';
import { logAction } from './auditLogService.js';
import { transferGoodsInTx } from './goodsService.js';
import { transferNpcsInTx } from './npcHoldingService.js';
import { transferPropertyInTx } from './propertyService.js';
import { acceptMarriageInTx } from './marriageService.js';

const KINDS = ['item', 'npc', 'property', 'marriage'];
const MAX_NPCS_PER_REQUEST = 50;
const NPC_NAME_MAX = 80;

const SQL = {
  livingPlayers: `
    SELECT id FROM ${T.players}
    WHERE id IN (?, ?) AND is_alive = 1 AND character_created_at IS NOT NULL
  `,
  insert: `
    INSERT INTO ${T.consent_requests}
      (kind, from_player_id, to_player_id, item_id, quantity, npc_name, npc_count, property_id, expires_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, DATE_ADD(NOW(), INTERVAL 24 HOUR))
  `,
  get: `SELECT * FROM ${T.consent_requests} WHERE id = ?`,
  claim: `
    UPDATE ${T.consent_requests}
    SET status = 'accepted', resolved_at = NOW()
    WHERE id = ? AND to_player_id = ? AND status = 'pending' AND expires_at > NOW()
  `,
  reject: `
    UPDATE ${T.consent_requests}
    SET status = 'rejected', resolved_at = NOW()
    WHERE id = ? AND to_player_id = ? AND status = 'pending'
  `,
  cancel: `
    UPDATE ${T.consent_requests}
    SET status = 'cancelled', resolved_at = NOW()
    WHERE id = ? AND from_player_id = ? AND status = 'pending'
  `,
  cancelUnfulfillable: `
    UPDATE ${T.consent_requests}
    SET status = 'cancelled', resolved_at = NOW()
    WHERE id = ? AND status = 'pending'
  `,
  cancelAllForPlayer: `
    UPDATE ${T.consent_requests}
    SET status = 'cancelled', resolved_at = NOW()
    WHERE status = 'pending' AND (from_player_id = ? OR to_player_id = ?)
  `,
  expire: `
    UPDATE ${T.consent_requests}
    SET status = 'expired', resolved_at = NOW()
    WHERE status = 'pending' AND expires_at <= NOW()
  `,
};

function isPositiveInt(n) {
  return Number.isInteger(n) && n > 0;
}

function hasAtMostTwoDecimals(n) {
  return Math.abs(n * 100 - Math.round(n * 100)) < 1e-6;
}

function validateKindFields({ kind, itemId, quantity, npcName, npcCount, propertyId }) {
  if (kind === 'item') {
    if (!isPositiveInt(itemId)) throw new UserFacingError('Indica qué bien quieres traspasar.');
    if (typeof quantity !== 'number' || !Number.isFinite(quantity) || quantity <= 0 || !hasAtMostTwoDecimals(quantity)) {
      throw new UserFacingError('La cantidad tiene que ser mayor que 0 y con 2 decimales como máximo.');
    }
    return [itemId, quantity, null, null, null];
  }
  if (kind === 'npc') {
    const name = typeof npcName === 'string' ? npcName.trim() : '';
    if (name.length === 0 || name.length > NPC_NAME_MAX) {
      throw new UserFacingError(`El nombre del NPC tiene que tener entre 1 y ${NPC_NAME_MAX} caracteres.`);
    }
    if (!Number.isInteger(npcCount) || npcCount < 1 || npcCount > MAX_NPCS_PER_REQUEST) {
      throw new UserFacingError(`El número de NPCs tiene que estar entre 1 y ${MAX_NPCS_PER_REQUEST}.`);
    }
    return [null, null, name, npcCount, null];
  }
  if (kind === 'property') {
    if (!isPositiveInt(propertyId)) throw new UserFacingError('Indica qué propiedad quieres traspasar.');
    return [null, null, null, null, propertyId];
  }
  return [null, null, null, null, null];
}

async function dispatch(request) {
  switch (request.kind) {
    case 'item':
      return transferGoodsInTx(request.from_player_id, request.to_player_id, request.item_id, Number(request.quantity));
    case 'npc':
      return transferNpcsInTx(request.from_player_id, request.to_player_id, request.npc_name, request.npc_count);
    case 'property':
      return transferPropertyInTx(request.from_player_id, request.to_player_id, request.property_id);
    case 'marriage':
      return acceptMarriageInTx(request);
    default:
      throw new UserFacingError('Tipo de solicitud desconocido.');
  }
}

function actorFields(actor) {
  return { source: actor.source, actorDiscordId: actor.discordId, actorUsername: actor.username };
}

export async function createRequest({ kind, fromPlayerId, toPlayerId, itemId, quantity, npcName, npcCount, propertyId }) {
  if (!KINDS.includes(kind)) throw new UserFacingError('Tipo de solicitud desconocido.');
  if (!isPositiveInt(fromPlayerId) || !isPositiveInt(toPlayerId)) throw new UserFacingError('Jugador no válido.');
  if (fromPlayerId === toPlayerId) throw new UserFacingError('No puedes hacerte una solicitud a ti mismo.');

  const fields = validateKindFields({ kind, itemId, quantity, npcName, npcCount, propertyId });

  const living = await query(SQL.livingPlayers, [fromPlayerId, toPlayerId]);
  if (!living.some(row => row.id === fromPlayerId)) throw new UserFacingError('Necesitas un personaje vivo.');
  if (!living.some(row => row.id === toPlayerId)) throw new UserFacingError('Esa persona no tiene un personaje vivo.');

  const { lastInsertRowid } = await execute(SQL.insert, [kind, fromPlayerId, toPlayerId, ...fields]);
  return lastInsertRowid;
}

export async function getRequest(requestId) {
  return (await queryOne(SQL.get, [requestId])) ?? null;
}

export async function accept(requestId, actorPlayerId, actor) {
  let dispatching = false;
  let request;
  try {
    request = await withTransaction(async () => {
      const claim = await execute(SQL.claim, [requestId, actorPlayerId]);
      if (claim.changes === 0) {
        throw new UserFacingError('Esa solicitud ya está resuelta, ha caducado o no es para ti.');
      }
      const row = await queryOne(SQL.get, [requestId]);
      dispatching = true;
      await dispatch(row);
      return row;
    });
  } catch (err) {
    if (dispatching && err instanceof UserFacingError) {
      await execute(SQL.cancelUnfulfillable, [requestId]);
    }
    throw err;
  }

  await logAction({
    ...actorFields(actor),
    action: `consentimiento.${request.kind}_aceptado`,
    target: String(request.from_player_id),
    details: {
      requestId: request.id, kind: request.kind, fromPlayerId: request.from_player_id, toPlayerId: request.to_player_id,
      itemId: request.item_id, quantity: request.quantity === null ? null : Number(request.quantity),
      npcName: request.npc_name, npcCount: request.npc_count, propertyId: request.property_id,
    },
  });
  return request;
}

export async function reject(requestId, actorPlayerId, actor) {
  const result = await execute(SQL.reject, [requestId, actorPlayerId]);
  if (result.changes === 0) throw new UserFacingError('Esa solicitud ya está resuelta o no es para ti.');
  const request = await getRequest(requestId);
  await logAction({
    ...actorFields(actor), action: `consentimiento.${request.kind}_rechazado`, target: String(request.from_player_id),
    details: { requestId: request.id, kind: request.kind },
  });
  return request;
}

export async function cancel(requestId, actorPlayerId, actor) {
  const result = await execute(SQL.cancel, [requestId, actorPlayerId]);
  if (result.changes === 0) throw new UserFacingError('Esa solicitud ya está resuelta o no la hiciste tú.');
  const request = await getRequest(requestId);
  await logAction({
    ...actorFields(actor), action: `consentimiento.${request.kind}_cancelado`, target: String(request.to_player_id),
    details: { requestId: request.id, kind: request.kind },
  });
  return request;
}

export async function cancelAllPendingForPlayerInTx(playerId) {
  const result = await execute(SQL.cancelAllForPlayer, [playerId, playerId]);
  return result.changes;
}

export async function markExpired() {
  const result = await execute(SQL.expire);
  return result.changes;
}
