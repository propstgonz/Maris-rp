import { query, queryOne, execute, withTransaction } from '../database/index.js';
import { T } from '../database/tables.js';
import logger from '../utils/logger.js';
import { UserFacingError } from '../utils/errors.js';
import { round2 } from '../utils/math.js';
import { toSqlDatetime } from '../utils/sqlDatetime.js';
import { getSetting, setSetting } from './settingsService.js';
import { getPlayerByDiscordId, getActiveEffectModifiers } from './playerService.js';

const BATCH_LIFETIME_MS  = 7 * 24 * 3_600_000;
const COOLDOWN_HOURS     = 23;
const DEFAULT_DAY_AMOUNT = 10;

const SQL = {
  getPlayer: `SELECT id, username FROM ${T.players} WHERE discord_id = ?`,

  getLiveBatches: `
    SELECT * FROM ${T.laburo_batches}
    WHERE player_id = ? AND expires_at > NOW()
    ORDER BY created_at ASC, id ASC
  `,

  getLiveBatchesForUpdate: `
    SELECT * FROM ${T.laburo_batches}
    WHERE player_id = ? AND expires_at > NOW()
    ORDER BY created_at ASC, id ASC
    FOR UPDATE
  `,

  insertBatch: `
    INSERT INTO ${T.laburo_batches} (player_id, quantity, expires_at) VALUES (?, ?, ?)
  `,

  updateBatchQuantity: `UPDATE ${T.laburo_batches} SET quantity = ? WHERE id = ?`,
  deleteBatch:         `DELETE FROM ${T.laburo_batches} WHERE id = ?`,
  deleteAllForPlayer:  `DELETE FROM ${T.laburo_batches} WHERE player_id = ?`,
  deleteExpired:       `DELETE FROM ${T.laburo_batches} WHERE expires_at <= NOW()`,


  updateLastLaburoAtIfEligible: `
    UPDATE ${T.players}
    SET last_laburo_at = NOW()
    WHERE discord_id = ?
      AND (last_laburo_at IS NULL OR DATE_ADD(last_laburo_at, INTERVAL ${COOLDOWN_HOURS} HOUR) <= NOW())
  `,

  getBatchesExpiringSoon: `
    SELECT lb.id, lb.quantity, lb.expires_at, p.discord_id
    FROM ${T.laburo_batches} lb
    JOIN ${T.players} p ON p.id = lb.player_id
    WHERE lb.expires_at > NOW()
      AND lb.expires_at <= DATE_ADD(NOW(), INTERVAL ? HOUR)
    ORDER BY lb.expires_at ASC
  `,

  getCooldownInfo: `
    SELECT
      last_laburo_at,
      (last_laburo_at IS NULL OR DATE_ADD(last_laburo_at, INTERVAL ${COOLDOWN_HOURS} HOUR) <= NOW()) AS can_laburar,
      TIMESTAMPDIFF(SECOND, NOW(), DATE_ADD(COALESCE(last_laburo_at, '1970-01-01'), INTERVAL ${COOLDOWN_HOURS} HOUR)) AS seconds_remaining
    FROM ${T.players} WHERE discord_id = ?
  `,
};

async function consumeBatchesFifo(batches, amount) {
  const taken = [];
  let remaining = amount;
  for (const batch of batches) {
    if (remaining <= 0) break;
    const take = Math.min(batch.quantity, remaining);
    remaining = round2(remaining - take);

    if (take >= batch.quantity) {
      await execute(SQL.deleteBatch, [batch.id]);
    } else {
      await execute(SQL.updateBatchQuantity, [round2(batch.quantity - take), batch.id]);
    }
    taken.push({ batchId: batch.id, taken: take, expiresAt: batch.expires_at });
  }
  return taken;
}

async function resolvePlayer(discordId) {
  const row = await queryOne(SQL.getPlayer, [discordId]);
  if (!row) throw new Error(`Jugador con Discord ID "${discordId}" no encontrado en la BD.`);
  return row;
}

function newExpiry() {
  return toSqlDatetime(new Date(Date.now() + BATCH_LIFETIME_MS));
}

export async function getLaburoCooldownRemaining(discordId) {
  const row = await queryOne(SQL.getCooldownInfo, [discordId]);
  return Math.max(0, row?.seconds_remaining ?? 0);
}

export async function earnLaburo(discordId, amount) {
  if (!Number.isFinite(amount) || amount <= 0) {
    throw new Error('La cantidad de Laburo ganada debe ser un número positivo.');
  }
  const player = await resolvePlayer(discordId);
  const expiresAt = newExpiry();

  await execute(SQL.insertBatch, [player.id, amount, expiresAt]);
  logger.info(`[Laburo] +${amount} para ${player.username} (caduca ${expiresAt})`);

  return { amount, expiresAt };
}

export async function tryLaburar(discordId, amount) {
  return withTransaction(async () => {
    if (!Number.isFinite(amount) || amount <= 0) {
      throw new UserFacingError('La cantidad de Laburo ganada debe ser un número positivo.');
    }
    const player = await resolvePlayer(discordId);

    const gate = await execute(SQL.updateLastLaburoAtIfEligible, [discordId]);
    if (gate.changes === 0) {
      const cooldown = await queryOne(SQL.getCooldownInfo, [discordId]);
      return { ok: false, remainingSeconds: Math.max(0, cooldown?.seconds_remaining ?? 0) };
    }

    const expiresAt = newExpiry();
    await execute(SQL.insertBatch, [player.id, amount, expiresAt]);
    logger.info(`[Laburo] +${amount} para ${player.username} (caduca ${expiresAt}) — vía tryLaburar (atómico)`);

    return { ok: true, amount, expiresAt };
  });
}

export async function performLaburar(discordId) {
  const player = await getPlayerByDiscordId(discordId);
  if (!player) throw new UserFacingError('Tu perfil no está registrado. Usa `/personaje crear` para empezar a rolear.');
  if (!player.is_alive) throw new UserFacingError('Tu personaje está muerto y no puede laburar.');

  const activeEffects = await getActiveEffectModifiers(discordId);
  const blocker = activeEffects.find(e => e.blocks_laburo);
  if (blocker) throw new UserFacingError(`No puedes laburar: tienes el estado ${blocker.emoji} **${blocker.label}** activo.`);

  const modifierSum = activeEffects.reduce((sum, e) => sum + (e.laburo_modifier ?? 0), 0);
  const baseAmount = await getDayAmount();
  const finalAmount = Math.max(0, round2(baseAmount + modifierSum));
  if (finalAmount <= 0) throw new UserFacingError('Con los efectos activos, ganarías 0 de Laburo. No merece la pena laburar hoy.');

  const result = await tryLaburar(discordId, finalAmount);
  if (!result.ok) {
    throw new UserFacingError(`Ya laburaste hoy. Podrás volver a hacerlo en ${Math.ceil(result.remainingSeconds / 3600)}h.`);
  }

  return {
    amount: finalAmount,
    expiresAt: result.expiresAt,
    totalAvailable: await getAvailableLaburo(discordId),
    modifierSum,
    appliedEffects: activeEffects.filter(e => e.laburo_modifier !== 0),
  };
}

export async function getAvailableLaburo(discordId) {
  const player = await resolvePlayer(discordId);
  const batches = await query(SQL.getLiveBatches, [player.id]);
  const total = batches.reduce((sum, b) => sum + b.quantity, 0);
  return round2(total);
}

export async function spendLaburo(discordId, amount) {
  if (!Number.isFinite(amount) || amount <= 0) {
    throw new Error('La cantidad de Laburo a gastar debe ser un número positivo.');
  }

  const player = await resolvePlayer(discordId);

  return withTransaction(async () => {
    const batches = await query(SQL.getLiveBatchesForUpdate, [player.id]);
    const total   = round2(batches.reduce((sum, b) => sum + b.quantity, 0));

    if (total < amount) {
      throw new Error(
        `Saldo de Laburo insuficiente: se requieren **${amount}** pero ${player.username} solo tiene **${total}**.`
      );
    }

    await consumeBatchesFifo(batches, amount);
    const remainingTotal = round2(total - amount);
    logger.debug(`[Laburo] -${amount} de ${player.username} (restante: ${remainingTotal})`);

    return { spent: amount, remaining: remainingTotal };
  });
}

export async function transferLaburo(fromDiscordId, toDiscordId, amount) {
  if (!Number.isFinite(amount) || amount <= 0) {
    throw new Error('La cantidad a tradear debe ser un número positivo.');
  }

  const fromPlayer = await resolvePlayer(fromDiscordId);
  const toPlayer    = await resolvePlayer(toDiscordId);

  await withTransaction(async () => {
    const batches = await query(SQL.getLiveBatchesForUpdate, [fromPlayer.id]);
    const total   = round2(batches.reduce((sum, b) => sum + b.quantity, 0));

    if (total < amount) {
      throw new Error(
        `Saldo de Laburo insuficiente: se requieren **${amount}** pero ${fromPlayer.username} solo tiene **${total}**.`
      );
    }

    const taken = await consumeBatchesFifo(batches, amount);
    for (const { taken: qty, expiresAt } of taken) {
      await execute(SQL.insertBatch, [toPlayer.id, qty, expiresAt]);
    }
  });

  logger.info(`[Laburo] Trade: ${fromPlayer.username} → ${toPlayer.username}: ${amount}`);
  return { amount };
}

export async function adminSetLaburo(discordId, amount) {
  if (!Number.isFinite(amount) || amount < 0) {
    throw new Error('La cantidad no puede ser negativa.');
  }
  const player = await resolvePlayer(discordId);

  await withTransaction(async () => {
    await execute(SQL.deleteAllForPlayer, [player.id]);
    if (amount > 0) {
      await execute(SQL.insertBatch, [player.id, amount, newExpiry()]);
    }
  });

  logger.info(`[Laburo] Saldo de ${player.username} fijado administrativamente a ${amount}`);
  return { newQuantity: amount };
}

export async function pruneExpiredBatches() {
  const result = await execute(SQL.deleteExpired);
  if (result.changes > 0) {
    logger.debug(`[Laburo] ${result.changes} lote(s) caducado(s) eliminado(s).`);
  }
  return result.changes;
}

export async function getBatchesExpiringSoon(hours = 24) {
  return query(SQL.getBatchesExpiringSoon, [hours]);
}

export async function getDayAmount() {
  const raw = await getSetting('laburo_day_amount', String(DEFAULT_DAY_AMOUNT));
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? n : DEFAULT_DAY_AMOUNT;
}

export async function setDayAmount(amount) {
  if (!Number.isFinite(amount) || amount < 0) {
    throw new Error('La cantidad base debe ser un número ≥ 0.');
  }
  await setSetting('laburo_day_amount', String(amount));
}
