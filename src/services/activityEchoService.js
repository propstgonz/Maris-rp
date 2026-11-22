import logger from '../utils/logger.js';
import { startGuardedInterval } from '../utils/guardedInterval.js';
import { listActionsSince, getMaxActionId } from './auditLogService.js';
import { describeActivity } from './activityFeed.js';
import { getAlertPreferences } from './playerAlertService.js';
import { getPlayerByDiscordId } from './playerService.js';
import { notifyModmailChannel } from './modmailService.js';

const POLL_INTERVAL_MS = 2000;

let lastSeenId = 0;

export function selectEchoes(rows) {
  const byActor = new Map();
  for (const row of rows) {
    if (row.source !== 'web' || !row.actor_discord_id) continue;
    const text = describeActivity(row);
    if (!text) continue;
    const texts = byActor.get(row.actor_discord_id) ?? [];
    texts.push(text);
    byActor.set(row.actor_discord_id, texts);
  }
  return byActor;
}

async function deliverEcho(client, discordId, message) {
  const prefs = await getAlertPreferences(discordId);
  if (!prefs || !prefs.webEcho) return;

  const player = await getPlayerByDiscordId(discordId).catch(() => null);
  const user = await client.users.fetch(discordId).catch(() => null);
  if (user) await user.send(message).catch(() => {});
  if (player?.modmail_channel_id) {
    await notifyModmailChannel(client, player.modmail_channel_id, message);
  }
}

export async function startActivityEchoPoller(client) {
  lastSeenId = await getMaxActionId();

  startGuardedInterval(async () => {
    try {
      const rows = await listActionsSince(lastSeenId);
      if (rows.length === 0) return;
      lastSeenId = rows.reduce((max, row) => Math.max(max, row.id), lastSeenId);

      const echoes = selectEchoes(rows);
      for (const [discordId, texts] of echoes) {
        await deliverEcho(client, discordId, texts.join('\n'));
      }
    } catch (err) {
      logger.error(`[ActivityEcho] Error no capturado en el sondeo: ${err.message}`);
      console.error(err);
    }
  }, POLL_INTERVAL_MS);

  logger.info(`[ActivityEcho] ✔ Sondeo de audit_log iniciado (cada ${POLL_INTERVAL_MS / 1000}s, desde id ${lastSeenId}).`);
}
