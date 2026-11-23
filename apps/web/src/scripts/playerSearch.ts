import { icon } from '../lib/icons';
import { formatDate } from '../lib/dates';
import { escapeHtml } from './html';
import { statusPillHtml } from './statusPill';
import { showConfirm, showToast } from './ui';
import { apiFetch } from './api';
import { initLiveUpdates } from './liveUpdates';
import type { PlayerRow } from '../lib/apiClient';


export function initPlayerSearch(root: HTMLElement) {
  const searchInput = root.querySelector<HTMLInputElement>('[data-player-search-input]')!;
  const results = root.querySelector<HTMLElement>('[data-player-search-results]')!;
  const syncBtn = root.querySelector<HTMLButtonElement>('[data-sync-channels-btn]')!;

  let players: PlayerRow[] = [];

  function render() {
    const q = searchInput.value.trim().toLowerCase();
    const rows = players.filter(p =>
      !q || p.username.toLowerCase().includes(q) || (p.character_name ?? '').toLowerCase().includes(q) || p.discord_id.includes(q));
    if (rows.length === 0) {
      results.innerHTML = '<p class="hint">Sin resultados.</p>';
      return;
    }
    const rowsHtml = rows.map(r => `
      <tr>
        <td><img class="player-avatar" src="/api/discord-avatar/${encodeURIComponent(r.discord_id)}" alt=""></td>
        <td>${escapeHtml(r.character_name ?? '—')}</td>
        <td>${escapeHtml(r.username)}</td>
        <td>${statusPillHtml(!!r.is_alive)}</td>
        <td>${escapeHtml(r.character_created_at ? formatDate(r.character_created_at) : '—')}</td>
        <td class="row-actions"><a class="btn-icon" href="/staff/players/${encodeURIComponent(r.discord_id)}" title="Ver">${icon('eye', { size: 15 })}</a></td>
      </tr>`).join('');
    results.innerHTML = `<div class="admin-table-scroll"><table class="admin-table"><thead><tr><th></th><th>Personaje</th><th>Usuario</th><th>Estado</th><th>Creado</th><th></th></tr></thead><tbody>${rowsHtml}</tbody></table></div>`;
  }

  async function load() {
    try {
      players = await apiFetch<PlayerRow[]>('/api/players');
    } catch (err) {
      results.innerHTML = `<p class="hint">${escapeHtml(err instanceof Error ? err.message : 'Error desconocido.')}</p>`;
      return;
    }
    render();
  }

  searchInput.addEventListener('input', render);

  syncBtn.addEventListener('click', async () => {
    const ok = await showConfirm({
      title: 'Sincronizar canales de personaje',
      message: 'Revisa TODOS los canales privados de personaje ya creados y les reaplica los permisos de la categoría (+ acceso de su dueño) y, si aún se llaman "md-...", los renombra a "rp-...". Puede tardar un momento.',
      confirmLabel: 'Sincronizar',
    });
    if (!ok) return;

    syncBtn.disabled = true;
    syncBtn.innerHTML = `${icon('refresh', { size: 15 })} Sincronizando…`;
    try {
      const result = await apiFetch<{ updated: number; total: number; renamed: number; skipped: number; errors: unknown[] }>('/api/staff/sync-channels', { method: 'POST' });
      const parts = [`${result.updated}/${result.total} actualizados`];
      if (result.renamed > 0) parts.push(`${result.renamed} renombrados`);
      if (result.skipped > 0) parts.push(`${result.skipped} sin canal (omitidos)`);
      if (result.errors.length > 0) parts.push(`${result.errors.length} con error`);
      showToast(parts.join(' · '), result.errors.length > 0 ? 'error' : 'success');
      if (result.errors.length > 0) console.warn('[Sincronizar canales] Errores:', result.errors);
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Error desconocido.', 'error');
    } finally {
      syncBtn.disabled = false;
      syncBtn.innerHTML = `${icon('refresh', { size: 15 })} Sincronizar canales`;
    }
  });

  load();
  initLiveUpdates('players', load);
}
