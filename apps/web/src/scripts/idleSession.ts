import { apiFetch, logout } from './api';
import { showToast } from './ui';

const HEARTBEAT_MIN_GAP_MS = 60_000;
const TIMER_RESET_MIN_GAP_MS = 1000;
const WARNING_LEAD_MS = 60_000;

export function initIdleSession(idleLogoutMinutes: number) {
  const idleLogoutMs = Math.max(idleLogoutMinutes, 1) * 60_000;
  const warningDelayMs = Math.max(idleLogoutMs - WARNING_LEAD_MS, 0);

  let warningTimer: ReturnType<typeof setTimeout> | null = null;
  let logoutTimer: ReturnType<typeof setTimeout> | null = null;
  let lastReset = 0;
  let lastHeartbeat = 0;

  function scheduleTimers() {
    if (warningTimer) clearTimeout(warningTimer);
    if (logoutTimer) clearTimeout(logoutTimer);
    if (warningDelayMs > 0) {
      warningTimer = setTimeout(
        () => showToast('Vas a salir por inactividad en 1 minuto — mueve el ratón o haz clic para seguir.', 'info'),
        warningDelayMs
      );
    }
    logoutTimer = setTimeout(logout, idleLogoutMs);
  }

  function onActivity() {
    const now = Date.now();
    if (now - lastReset >= TIMER_RESET_MIN_GAP_MS) {
      lastReset = now;
      scheduleTimers();
    }
    if (now - lastHeartbeat >= HEARTBEAT_MIN_GAP_MS) {
      lastHeartbeat = now;
      apiFetch('/api/me').catch(() => {});
    }
  }

  ['mousemove', 'keydown', 'click'].forEach(evt => window.addEventListener(evt, onActivity, { passive: true }));
  scheduleTimers();
}
