

import { withPassive } from './api';
import { showToast } from './ui';
import { formatClock } from '../lib/dates';

const AUTO_REFRESH_INTERVAL_MS = 30000;
const BASE_RECONNECT_DELAY_MS = 2000;
const MAX_RECONNECT_DELAY_MS = 30000;

export function connectEventSource<T>(url: string, onMessage: (data: T) => void) {
  let reconnectDelayMs = BASE_RECONNECT_DELAY_MS;
  let source: EventSource | null = null;

  function connect() {
    try {
      source = new EventSource(url);
    } catch (err) {
      console.warn(`[LiveUpdates] EventSource no disponible para ${url}, solo se usará el refresco periódico:`, err);
      return;
    }

    source.onopen = () => {
      reconnectDelayMs = BASE_RECONNECT_DELAY_MS;
    };

    source.onmessage = evt => {
      try { onMessage(JSON.parse(evt.data) as T); } catch {}
    };

    source.onerror = () => {
      console.warn(`[LiveUpdates] Conexión SSE a ${url} perdida — reintentando en ${reconnectDelayMs / 1000}s.`);
      source?.close();
      setTimeout(connect, reconnectDelayMs);
      reconnectDelayMs = Math.min(reconnectDelayMs * 2, MAX_RECONNECT_DELAY_MS);
    };
  }
  connect();
}

export function markRefreshed() {
  const label = document.getElementById('lastRefreshLabel');
  if (label) label.textContent = formatClock(new Date());
}

interface LiveEvent { section?: string | null; message?: string | null }

export function initLiveUpdates(section: string, onRefresh: () => Promise<void> | void) {
  async function refresh() {
    if (document.hidden) return;
    await withPassive(async () => {
      try {
        await onRefresh();
        markRefreshed();
      } catch (err) {
        console.error('[LiveUpdates] Error refrescando la página actual:', err);
      }
    });
  }

  connectEventSource<LiveEvent>('/api/events', data => {
    if (data.message) showToast(data.message, 'info');
    if (!data.section || data.section === section) refresh();
  });

  document.addEventListener('visibilitychange', () => { void refresh(); });
  setInterval(refresh, AUTO_REFRESH_INTERVAL_MS);
}
