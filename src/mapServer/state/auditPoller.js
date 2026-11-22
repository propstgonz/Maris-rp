import logger from '../../utils/logger.js';
import { listActionsSince, getMaxActionId } from '../../services/auditLogService.js';
import { describeActivity, describeActivityForTarget } from '../../services/activityFeed.js';
import { broadcastChange, broadcastToPlayer, ACTION_SECTION_MAP } from './sse.js';

const POLL_INTERVAL_MS = 2000;

let lastSeenId = 0;

export function selectSectionsToRefresh(rows, actionSectionMap) {
  const sections = new Set();
  const events = [];
  const notifications = [];
  const seenEventKeys = new Set();
  let maxId = 0;
  for (const row of rows) {
    maxId = Math.max(maxId, row.id);

    const text = describeActivity(row);
    if (row.source !== 'web' && row.actor_discord_id && text) {
      notifications.push({ discordId: row.actor_discord_id, text });
    }

    const targetText = describeActivityForTarget(row);
    if (targetText && row.target) {
      notifications.push({ discordId: row.target, text: targetText, action: 'open-attack' });
    }

    if (row.source === 'web') continue;
    const entity = row.action.split('.')[0];
    const id = row.target ?? null;
    const staffMessage = text ? `${row.actor_username}: ${text}` : null;

    const logKey = `log:${entity}:${id}`;
    if (!seenEventKeys.has(logKey)) {
      seenEventKeys.add(logKey);
      sections.add('log');
      events.push({ section: 'log', entity, id, message: staffMessage });
    }

    const section = actionSectionMap[entity];
    if (!section) continue;
    sections.add(section);
    const key = `${section}:${entity}:${id}`;
    if (!seenEventKeys.has(key)) {
      seenEventKeys.add(key);
      events.push({ section, entity, id, message: staffMessage });
    }
  }
  return { sections, events, notifications, maxId };
}

export async function startAuditPoller() {
  lastSeenId = await getMaxActionId();

  setInterval(async () => {
    try {
      const rows = await listActionsSince(lastSeenId);
      if (rows.length === 0) return;

      const { events, notifications, maxId } = selectSectionsToRefresh(rows, ACTION_SECTION_MAP);
      lastSeenId = Math.max(lastSeenId, maxId);
      for (const { section, entity, id, message } of events) broadcastChange(section, entity, id, message);
      for (const { discordId, text, action } of notifications) broadcastToPlayer(discordId, { text, action });
    } catch (err) {
      logger.error(`[AuditPoller] Error no capturado en el sondeo: ${err.message}`);
      console.error(err);
    }
  }, POLL_INTERVAL_MS);

  logger.info(`[AuditPoller] ✔ Sondeo de audit_log iniciado (cada ${POLL_INTERVAL_MS / 1000}s, desde id ${lastSeenId}).`);
}
