const STAFF_ALERTS_CHANNEL_ID = process.env.STAFF_ALERTS_CHANNEL_ID;
const MAX_LENGTH = 2000;

let warnedMissingConfig = false;

const FLUSH_INTERVAL_MS = 2000;
let queue = [];
let queuedClient = null;
let flushTimer = null;

function scheduleFlush(client) {
  queuedClient = client;
  if (flushTimer) return;
  flushTimer = setTimeout(() => { flushTimer = null; flushQueue().catch(() => {}); }, FLUSH_INTERVAL_MS);
  flushTimer.unref?.();
}

async function flushQueue() {
  if (queue.length === 0) return;
  const client = queuedClient;

  if (!client?.isReady?.()) { queue = []; return; }
  const channel = client.channels.cache.get(STAFF_ALERTS_CHANNEL_ID);
  if (!channel?.isTextBased()) {
    console.warn(`[Alerts] Canal de avisos de Staff no encontrado o no es de texto (${STAFF_ALERTS_CHANNEL_ID}).`);
    queue = [];
    return;
  }

  const pending = queue;
  queue = [];
  let chunk = '';
  for (const line of pending) {
    if (chunk && (chunk.length + 1 + line.length) > MAX_LENGTH) {
      await channel.send(chunk).catch(err => console.warn(`[Alerts] No se pudo enviar aviso a Staff: ${err.message}`));
      chunk = '';
    }
    chunk = chunk ? `${chunk}\n${line}` : line;
  }
  if (chunk) {
    await channel.send(chunk).catch(err => console.warn(`[Alerts] No se pudo enviar aviso a Staff: ${err.message}`));
  }
}

export async function notifyStaff(client, message) {
  if (!STAFF_ALERTS_CHANNEL_ID) {
    if (!warnedMissingConfig) {
      warnedMissingConfig = true;
      console.warn('[Alerts] STAFF_ALERTS_CHANNEL_ID no configurado — los avisos a Staff no se enviarán a Discord.');
    }
    return;
  }

  if (!client?.isReady?.()) return;

  const truncated = message.length > MAX_LENGTH
    ? `${message.slice(0, MAX_LENGTH - 1)}…`
    : message;

  queue.push(truncated);
  scheduleFlush(client);
}

export async function notifyStaffNow(client, message) {
  await notifyStaff(client, message);
  if (flushTimer) { clearTimeout(flushTimer); flushTimer = null; }
  await flushQueue();
}
