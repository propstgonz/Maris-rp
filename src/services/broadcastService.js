

import { listPlayers } from './playerService.js';
import logger from '../utils/logger.js';

const DM_DELAY_MS = 300;
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

export async function sendBroadcast(client, message, imageUrls = []) {
  const targets = await listPlayers();
  const dmText = `📢 **Aviso de Staff**\n\n${message}`;

  let sent = 0;
  let failed = 0;
  for (const target of targets) {
    try {
      const user = await client.users.fetch(target.discord_id);
      await user.send({ content: dmText, files: imageUrls });
      sent++;
    } catch (err) {
      failed++;
      logger.warn(`[Broadcast] No se pudo mandar el MD a ${target.discord_id} (${target.username}): ${err.message}`);
    }
    await sleep(DM_DELAY_MS);
  }

  logger.info(`[Broadcast] → ${sent}/${targets.length} jugadores (${failed} fallidos, ${imageUrls.length} imagen(es))`);
  return { sent, failed, totalTargets: targets.length };
}
