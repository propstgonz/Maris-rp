import { query, queryOne, execute, withTransaction } from '../database/index.js';
import { T } from '../database/tables.js';
import { UserFacingError } from '../utils/errors.js';
import { logAction } from './auditLogService.js';
import { transferGoodsInTx, validateQuantity } from './goodsService.js';
import { transferNpcsInTx } from './npcHoldingService.js';
import { transferPropertyInTx } from './propertyService.js';
import { acceptMarriageInTx } from './marriageService.js';
import { lockPlayersInTx } from './playerService.js';

const KINDS = ['item', 'npc', 'property', 'marriage'];
const MAX_NPCS_PER_REQUEST = 50;
const NPC_NAME_MAX = 80;
const MAX_PENDING_PER_PAIR = 5;
const LIST_LIMIT = 25;
const DEADLOCK_RETRIES = 3;

const SQL = {
  pendingBetween: `
    SELECT COUNT(*) AS n FROM ${T.consent_requests}
    WHERE from_player_id = ? AND to_player_id = ? AND status = 'pending' AND expires_at > NOW()
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
  cancelAllFrom: `
    UPDATE ${T.consent_requests}
    SET status = 'cancelled', resolved_at = NOW()
    WHERE from_player_id = ? AND status = 'pending'
  `,
  cancelAllTo: `
    UPDATE ${T.consent_requests}
    SET status = 'cancelled', resolved_at = NOW()
    WHERE to_player_id = ? AND status = 'pending'
  `,
  listSelect: `
    SELECT r.*, f.discord_id AS from_discord_id, f.character_name AS from_character_name,
           t.discord_id AS to_discord_id, t.character_name AS to_character_name,
           i.display_name AS item_display_name, pt.display_name AS property_type_display_name, pr.name AS property_name
    FROM ${T.consent_requests} r
    JOIN ${T.players} f ON f.id = r.from_player_id
    JOIN ${T.players} t ON t.id = r.to_player_id
    LEFT JOIN ${T.items} i ON i.id = r.item_id
    LEFT JOIN ${T.properties} pr ON pr.id = r.property_id
    LEFT JOIN ${T.property_types} pt ON pt.id = pr.property_type_id
  `,
  listIncoming: `
    WHERE r.status = 'pending' AND r.expires_at > NOW() AND r.to_player_id = ?
    ORDER BY r.created_at DESC LIMIT ${LIST_LIMIT}
  `,
  listOutgoing: `
    WHERE r.status = 'pending' AND r.expires_at > NOW() AND r.from_player_id = ?
    ORDER BY r.created_at DESC LIMIT ${LIST_LIMIT}
  `,
  countIncoming: `
    SELECT COUNT(*) AS n FROM ${T.consent_requests}
    WHERE status = 'pending' AND expires_at > NOW() AND to_player_id = ?
  `,
  countOutgoing: `
    SELECT COUNT(*) AS n FROM ${T.consent_requests}
    WHERE status = 'pending' AND expires_at > NOW() AND from_player_id = ?
  `,
};

function isPositiveInt(n) {
  return Number.isInteger(n) && n > 0;
}

function validateKindFields({ kind, itemId, quantity, npcName, npcCount, propertyId }) {
  if (kind === 'item') {
    if (!isPositiveInt(itemId)) throw new UserFacingError('Indica qué bien quieres traspasar.');
    return [itemId, validateQuantity(quantity), null, null, null];
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

export async function createRequest({ kind, fromPlayerId, toPlayerId, itemId, quantity, npcName, npcCount, propertyId }) {
  if (!KINDS.includes(kind)) throw new UserFacingError('Tipo de solicitud desconocido.');
  if (!isPositiveInt(fromPlayerId) || !isPositiveInt(toPlayerId)) throw new UserFacingError('Jugador no válido.');
  if (fromPlayerId === toPlayerId) throw new UserFacingError('No puedes hacerte una solicitud a ti mismo.');

  const fields = validateKindFields({ kind, itemId, quantity, npcName, npcCount, propertyId });

  const isLiving = row => Boolean(row?.is_alive && row.character_created_at);
  return withTransaction(async () => {
    const locked = await lockPlayersInTx([fromPlayerId, toPlayerId]);
    if (!isLiving(locked.find(row => row.id === fromPlayerId))) throw new UserFacingError('Necesitas un personaje vivo.');
    if (!isLiving(locked.find(row => row.id === toPlayerId))) throw new UserFacingError('Esa persona no tiene un personaje vivo.');

    const pending = await queryOne(SQL.pendingBetween, [fromPlayerId, toPlayerId]);
    if (Number(pending.n) >= MAX_PENDING_PER_PAIR) {
      throw new UserFacingError(`Ya tienes ${MAX_PENDING_PER_PAIR} solicitudes pendientes con esa persona. Espera a que las resuelva o cancela alguna.`);
    }

    const { lastInsertRowid } = await execute(SQL.insert, [kind, fromPlayerId, toPlayerId, ...fields]);
    return lastInsertRowid;
  }, { retryOnDeadlock: DEADLOCK_RETRIES });
}

export async function getRequest(requestId) {
  return (await queryOne(SQL.get, [requestId])) ?? null;
}

export async function accept(requestId, actorPlayerId, actor) {
  const unavailable = () => new UserFacingError('Esa solicitud ya está resuelta, ha caducado o no es para ti.');
  const preview = await getRequest(requestId);
  if (!preview || preview.to_player_id !== actorPlayerId) throw unavailable();

  let dispatchError = null;
  let request;
  try {
    request = await withTransaction(async () => {
      dispatchError = null;
      await lockPlayersInTx([preview.from_player_id, preview.to_player_id]);
      const claim = await execute(SQL.claim, [requestId, actorPlayerId]);
      if (claim.changes === 0) throw unavailable();
      const row = await queryOne(SQL.get, [requestId]);
      try {
        await dispatch(row);
      } catch (err) {
        dispatchError = err;
        throw err;
      }
      return row;
    }, { retryOnDeadlock: DEADLOCK_RETRIES });
  } catch (err) {
    if (err === dispatchError && err instanceof UserFacingError) {
      await execute(SQL.cancelUnfulfillable, [requestId]);
    }
    throw err;
  }

  await logAction({
    actor,
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
    actor, action: `consentimiento.${request.kind}_rechazado`, target: String(request.from_player_id),
    details: { requestId: request.id, kind: request.kind },
  });
  return request;
}

export async function cancel(requestId, actorPlayerId, actor) {
  const result = await execute(SQL.cancel, [requestId, actorPlayerId]);
  if (result.changes === 0) throw new UserFacingError('Esa solicitud ya está resuelta o no la hiciste tú.');
  const request = await getRequest(requestId);
  await logAction({
    actor, action: `consentimiento.${request.kind}_cancelado`, target: String(request.to_player_id),
    details: { requestId: request.id, kind: request.kind },
  });
  return request;
}

export async function cancelAllPendingForPlayerInTx(playerId) {
  const sent = await execute(SQL.cancelAllFrom, [playerId]);
  const received = await execute(SQL.cancelAllTo, [playerId]);
  return sent.changes + received.changes;
}

function shape(rows) {
  return rows.map(row => ({ ...row, quantity: row.quantity === null ? null : Number(row.quantity) }));
}

export async function listPendingForPlayer(playerId) {
  const incoming = await query(`${SQL.listSelect}${SQL.listIncoming}`, [playerId]);
  const outgoing = await query(`${SQL.listSelect}${SQL.listOutgoing}`, [playerId]);
  const incomingCount = await queryOne(SQL.countIncoming, [playerId]);
  const outgoingCount = await queryOne(SQL.countOutgoing, [playerId]);
  return {
    incoming: shape(incoming),
    outgoing: shape(outgoing),
    incomingTotal: Number(incomingCount.n),
    outgoingTotal: Number(outgoingCount.n),
  };
}
