import { queryOne, execute } from '../database/index.js';
import { T } from '../database/tables.js';
import logger from '../utils/logger.js';
import { UserFacingError } from '../utils/errors.js';
import { startGuardedInterval } from '../utils/guardedInterval.js';
import { markDeceased, finalizeGraceDeath } from './characterLifecycleService.js';
import { listPlayersWithChannel, postCharacterInfoCard } from './modmailService.js';
import { getPlayerByDiscordId } from './playerService.js';
import { createAndRegisterCategory } from './modmailCategoryService.js';
import { sendBroadcast } from './broadcastService.js';

const POLL_INTERVAL_MS = 1000;

const SQL = {
  insert: `
    INSERT INTO ${T.bot_jobs} (job_type, payload, requested_by_discord_id) VALUES (?, ?, ?)
  `,
  getById: `SELECT * FROM ${T.bot_jobs} WHERE id = ?`,
  getOldestPending: `SELECT * FROM ${T.bot_jobs} WHERE status = 'pending' ORDER BY id ASC LIMIT 1`,
  markDone: `UPDATE ${T.bot_jobs} SET status = 'done', result_text = ?, completed_at = NOW() WHERE id = ?`,
  markError: `UPDATE ${T.bot_jobs} SET status = 'error', result_text = ?, completed_at = NOW() WHERE id = ?`,
  pruneOld: `DELETE FROM ${T.bot_jobs} WHERE created_at < DATE_SUB(NOW(), INTERVAL 1 DAY)`,
};

export async function enqueueJob(jobType, payload, requestedByDiscordId) {
  const result = await execute(SQL.insert, [jobType, JSON.stringify(payload ?? {}), requestedByDiscordId]);
  return result.lastInsertRowid;
}

export async function getJobResult(id) {
  const row = await queryOne(SQL.getById, [id]);
  if (!row) return null;
  return { ...row, payload: JSON.parse(row.payload) };
}

const DEFAULT_POLL_TIMEOUT_MS = 12_000;
const DEFAULT_POLL_INTERVAL_MS = 300;

export async function enqueueJobAndAwait(jobType, payload, requestedByDiscordId, { timeoutMs = DEFAULT_POLL_TIMEOUT_MS, intervalMs = DEFAULT_POLL_INTERVAL_MS } = {}) {
  const jobId = await enqueueJob(jobType, payload, requestedByDiscordId);

  const deadline = Date.now() + timeoutMs;
  let job = await getJobResult(jobId);
  while (job?.status === 'pending' && Date.now() < deadline) {
    await new Promise(resolve => setTimeout(resolve, intervalMs));
    job = await getJobResult(jobId);
  }

  if (!job || job.status === 'pending') {
    throw new UserFacingError('El bot está tardando más de lo normal en procesar esto — inténtalo de nuevo en un momento.');
  }
  if (job.status === 'error') {
    throw new UserFacingError(job.result_text);
  }
  return JSON.parse(job.result_text);
}

const handlers = {
  async 'player.kill'(client, payload) {
    const { discordId, reason } = payload;
    const updated = await markDeceased(client, discordId, reason, { permadeath: true });
    return JSON.stringify(updated);
  },
  async 'player.finalize_grace'(client, payload) {
    const { discordId } = payload;
    const updated = await finalizeGraceDeath(discordId, client);
    return JSON.stringify(updated);
  },
  async 'channels.sync_identity_cards'(client) {
    const players = await listPlayersWithChannel();
    let posted = 0, skipped = 0, errors = 0;
    for (const p of players) {
      try {
        const full = await getPlayerByDiscordId(p.discord_id);
        if (!full) { skipped++; continue; }
        const didPost = await postCharacterInfoCard(client, p.modmail_channel_id, full);
        if (didPost) posted++; else skipped++;
      } catch (err) {
        errors++;
        logger.warn(`[BotJobs] channels.sync_identity_cards: fallo con ${p.discord_id}: ${err.message}`);
      }
    }
    return JSON.stringify({ total: players.length, posted, skipped, errors });
  },
  async 'modmail.create_category'(client, payload) {
    const { name } = payload;
    const guild = client.guilds.cache.get(process.env.GUILD_ID);
    if (!guild) throw new Error('No se encontró el servidor (GUILD_ID) desde el proceso del bot.');
    const { category, clonedPermissions } = await createAndRegisterCategory(guild, name);
    return JSON.stringify({ id: category.id, name: category.name, clonedPermissions });
  },
  async 'staff.broadcast'(client, payload) {
    const { message, imageUrls } = payload;
    const result = await sendBroadcast(client, message, imageUrls ?? []);
    return JSON.stringify(result);
  },
};

export async function processNextJob(client) {
  const job = await queryOne(SQL.getOldestPending);
  if (!job) return;

  try {
    const handler = handlers[job.job_type];
    if (!handler) throw new Error(`Tipo de job desconocido: "${job.job_type}".`);

    const payload = JSON.parse(job.payload);
    const resultText = await handler(client, payload);

    await execute(SQL.markDone, [resultText, job.id]);
    logger.info(`[BotJobs] "${job.job_type}" #${job.id} (${job.requested_by_discord_id}) → ok`);
  } catch (err) {
    await execute(SQL.markError, [err.message, job.id]);
    logger.warn(`[BotJobs] "${job.job_type}" #${job.id} (${job.requested_by_discord_id}) → error: ${err.message}`);
  }
}

export function startBotJobPoller(client) {
  startGuardedInterval(async () => {
    try {
      await processNextJob(client);
    } catch (err) {
      logger.error(`[BotJobs] Error no capturado en el sondeo: ${err.message}`);
      console.error(err);
    }
  }, POLL_INTERVAL_MS);
  logger.info(`[BotJobs] ✔ Sondeo de bot_jobs iniciado (cada ${POLL_INTERVAL_MS / 1000}s).`);
}

export async function pruneOldBotJobs() {
  return (await execute(SQL.pruneOld)).changes;
}
