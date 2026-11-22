import { refreshMapCache } from './mapCache.js';

export const sseClients = new Set();
export const playerSseClients = new Map();

export const ACTION_SECTION_MAP = {
  item: 'items', itemCategory: 'items', terrain: 'terrains', construction: 'constructions',
  effect: 'effects', nation: 'facciones', faccion: 'facciones', zona: 'zonas', tile: 'map', player: 'players',
  npc: 'npcs', npcGroup: 'npcs', combat: 'players', travel: 'map', backup: 'backups', modmail: 'modmail',
  settings: 'mechanics', gather: 'map', laburo: 'players',
};

const SSE_HEARTBEAT_MS = 20000;

export function openSseStream(res, onClose) {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
  });
  res.write('retry: 5000\n\n');

  const heartbeat = setInterval(() => {
    try { res.write(': ping\n\n'); } catch {  }
  }, SSE_HEARTBEAT_MS);

  res.req.on('close', () => {
    clearInterval(heartbeat);
    onClose();
  });
}

export function broadcastChange(section, entity = null, id = null, message = null) {
  if (section === 'map') refreshMapCache();
  if (!section || sseClients.size === 0) return;
  const payload = `data: ${JSON.stringify({ section, entity, id, message })}\n\n`;
  for (const client of sseClients) {
    try { client.write(payload); } catch { sseClients.delete(client); }
  }
}

export function broadcastToPlayer(discordId, payload) {
  const clients = playerSseClients.get(discordId);
  if (!clients || clients.size === 0) return;
  const data = `data: ${JSON.stringify(payload)}\n\n`;
  for (const client of clients) {
    try { client.write(data); } catch { clients.delete(client); }
  }
  if (clients.size === 0) playerSseClients.delete(discordId);
}
