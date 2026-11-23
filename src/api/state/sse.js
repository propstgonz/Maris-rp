export const sseClients = new Set();

export const ACTION_SECTION_MAP = {
  player: 'players', backup: 'backups', modmail: 'modmail',
  perfil: 'players', personaje: 'players', matrimonio: 'players', consentimiento: 'players',
  npcs: 'players', bienes: 'players', propiedades: 'players', magia: 'players',
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
  if (!section || sseClients.size === 0) return;
  const payload = `data: ${JSON.stringify({ section, entity, id, message })}\n\n`;
  for (const client of sseClients) {
    try { client.write(payload); } catch { sseClients.delete(client); }
  }
}
