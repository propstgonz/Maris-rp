import { icon } from '../lib/icons';
import { escapeHtml } from './html';
import { statusPillHtml } from './statusPill';
import { showConfirm, showToast } from './ui';
import { apiFetch } from './api';
import { initLiveUpdates } from './liveUpdates';
import type { PlayerSearchPage } from '../lib/mapServerApi';

export function initPlayerSearch(root: HTMLElement) {
  const searchInput = root.querySelector<HTMLInputElement>('[data-player-search-input]')!;
  const results = root.querySelector<HTMLElement>('[data-player-search-results]')!;
  const syncBtn = root.querySelector<HTMLButtonElement>('[data-sync-channels-btn]')!;

  let searchTimer: ReturnType<typeof setTimeout> | undefined;
  let searchPage = 1;

  async function runPlayerSearch(query: string, page = searchPage) {
    let data: PlayerSearchPage;
    try {
      data = await apiFetch<PlayerSearchPage>(`/api/players/search?q=${encodeURIComponent(query.trim())}&page=${page}`);
    } catch (err) {
      results.innerHTML = `<p class="hint">❌ ${escapeHtml(err instanceof Error ? err.message : 'Error desconocido.')}</p>`;
      return;
    }
    const { rows, total, pageSize } = data;
    searchPage = data.page;

    if (rows.length === 0) {
      results.innerHTML = searchPage > 1
        ? '<p class="hint">Esta página no tiene resultados.</p>'
        : '<p class="hint">Sin resultados.</p>';
      return;
    }

    const rowsHtml = rows.map((r, i) => `
      <tr data-idx="${i}">
        <td><img class="player-avatar" src="/api/discord-avatar/${encodeURIComponent(r.discord_id)}" alt=""></td>
        <td>${escapeHtml(r.username)}</td>
        <td>${escapeHtml(r.character_name ?? '—')}</td>
        <td>${statusPillHtml(!!r.is_alive, r.hp)}</td>
        <td class="row-actions"><button type="button" class="btn-icon btn-view-player" title="Ver">${icon('eye', { size: 15 })}</button></td>
      </tr>`).join('');

    const totalPages = Math.max(1, Math.ceil(total / pageSize));
    const paginationHtml = `
      <div class="pagination">
        <button type="button" data-players-prev-page ${searchPage <= 1 ? 'disabled' : ''}>← Anterior</button>
        <span class="pagination-info">Página ${searchPage} de ${totalPages} (${total} en total)</span>
        <button type="button" data-players-next-page ${searchPage >= totalPages ? 'disabled' : ''}>Siguiente →</button>
      </div>`;

    results.innerHTML = `<div class="admin-table-scroll"><table class="admin-table"><thead><tr><th></th><th>Usuario</th><th>Personaje</th><th>Estado</th><th></th></tr></thead><tbody>${rowsHtml}</tbody></table></div>${paginationHtml}`;
    results.querySelectorAll<HTMLButtonElement>('.btn-view-player').forEach(btn => {
      const row = rows[Number(btn.closest<HTMLElement>('tr')!.dataset.idx)];
      btn.onclick = () => { window.location.href = `/staff/players/${encodeURIComponent(row.discord_id)}`; };
    });

    const currentQuery = searchInput.value ?? query;
    results.querySelector<HTMLButtonElement>('[data-players-prev-page]')!.onclick = () => runPlayerSearch(currentQuery, searchPage - 1);
    results.querySelector<HTMLButtonElement>('[data-players-next-page]')!.onclick = () => runPlayerSearch(currentQuery, searchPage + 1);
  }

  searchInput.addEventListener('input', evt => {
    clearTimeout(searchTimer);
    const q = (evt.target as HTMLInputElement).value;
    searchTimer = setTimeout(() => { searchPage = 1; runPlayerSearch(q); }, 250);
  });

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

  runPlayerSearch('');
  initLiveUpdates('players', () => runPlayerSearch(searchInput.value));
}
