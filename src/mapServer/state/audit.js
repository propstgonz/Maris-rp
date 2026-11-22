import { logAction } from '../../services/auditLogService.js';
import { broadcastChange, ACTION_SECTION_MAP } from './sse.js';

export function auditWeb(req, action, target, details) {
  logAction({ source: 'web', actorDiscordId: req.session.user.id, actorUsername: req.session.user.username, action, target, details });

  const entity = action.split('.')[0];
  broadcastChange(ACTION_SECTION_MAP[entity], entity, target ?? null);
  broadcastChange('log', entity, target ?? null);
}
