import { escapeHtml, escapeAttr } from './html';
import { apiFetch } from './api';
import { initLiveUpdates } from './liveUpdates';
import { icon } from '../lib/icons';
import { actionPhrase, summarizeDetails, relativeTime } from '../lib/auditActions';
import type { AuditLogPage, AuditLogEntry } from '../lib/apiClient';

const SEARCH_DEBOUNCE_MS = 300;

function parseUtc(created: string): Date {
  return new Date(`${created.replace(' ', 'T')}Z`);
}

export function initAuditLog(root: HTMLElement) {
  const tableContainer = root.querySelector<HTMLElement>('[data-log-table]')!;
  const viewToggle = root.querySelector<HTMLButtonElement>('[data-log-view-toggle]')!;
  const resetBtn = root.querySelector<HTMLButtonElement>('[data-log-filter-reset]')!;

  const inputs = {
    q: root.querySelector<HTMLInputElement>('[data-log-filter-q]')!,
    prefix: root.querySelector<HTMLSelectElement>('[data-log-filter-prefix]')!,
    action: root.querySelector<HTMLSelectElement>('[data-log-filter-action]')!,
    source: root.querySelector<HTMLSelectElement>('[data-log-filter-source]')!,
    from: root.querySelector<HTMLInputElement>('[data-log-filter-from]')!,
    to: root.querySelector<HTMLInputElement>('[data-log-filter-to]')!,
  };

  let page = 1;
  let rawView = false;

  function currentParams(): URLSearchParams {
    const params = new URLSearchParams({ page: String(page) });
    for (const [name, el] of Object.entries(inputs)) {
      const value = el.value.trim();
      if (value) params.set(name, value);
    }
    return params;
  }

  function entryHtml(row: AuditLogEntry): string {
    const when = parseUtc(row.created_at);
    const sourceLabel = row.source === 'web' ? 'Web' : 'Discord';
    const summary = summarizeDetails(row.details);

    const target = row.target
      ? (/^\d{17,20}$/.test(row.target)
        ? `<a class="log-entry-target" href="/staff/players/${encodeURIComponent(row.target)}">${escapeHtml(row.target)}</a>`
        : `<span class="log-entry-target">${escapeHtml(row.target)}</span>`)
      : '';

    return `<li class="log-entry">
      <div class="log-entry-body">
        <p class="log-entry-title"><img class="player-avatar log-entry-avatar" src="/api/discord-avatar/${encodeURIComponent(row.actor_discord_id)}" alt="" loading="lazy"><b>${escapeHtml(row.actor_username)}</b> ${escapeHtml(actionPhrase(row.action))} ${target}</p>
        <p class="log-entry-meta">
          <span title="${escapeAttr(row.source === 'web' ? 'Hecho desde la web' : 'Hecho desde Discord')}">${sourceLabel}</span>
          <span title="${escapeAttr(when.toLocaleString('es-ES'))}">${escapeHtml(relativeTime(when))}</span>
          <code>${escapeHtml(row.action)}</code>
        </p>
        ${summary ? `<p class="log-entry-detail">${escapeHtml(summary)}</p>` : ''}
      </div>
    </li>`;
  }

  function rawRowHtml(row: AuditLogEntry): string {
    const when = parseUtc(row.created_at).toLocaleString('es-ES');
    const details = row.details == null ? '—' : JSON.stringify(row.details);
    return `<tr>
      <td title="${row.source === 'web' ? 'Desde la web' : 'Desde Discord'}">${row.source === 'web' ? 'Web' : 'Discord'}</td>
      <td>${escapeHtml(when)}</td>
      <td>${escapeHtml(row.actor_username)}</td>
      <td><code>${escapeHtml(row.action)}</code></td>
      <td>${escapeHtml(row.target ?? '—')}</td>
      <td class="log-raw-details">${escapeHtml(details)}</td>
    </tr>`;
  }

  function paginationHtml(total: number, pageSize: number): string {
    const totalPages = Math.max(1, Math.ceil(total / pageSize));
    return `<div class="pagination">
      <button type="button" data-log-prev-page ${page <= 1 ? 'disabled' : ''}>← Anterior</button>
      <span class="pagination-info">Página ${page} de ${totalPages} (${total} en total)</span>
      <button type="button" data-log-next-page ${page >= totalPages ? 'disabled' : ''}>Siguiente →</button>
    </div>`;
  }

  async function loadLogPage() {
    let data: AuditLogPage;
    try {
      data = await apiFetch<AuditLogPage>(`/api/audit-log?${currentParams()}`);
    } catch (err) {
      tableContainer.innerHTML = `<p class="hint">${escapeHtml(err instanceof Error ? err.message : 'Error desconocido.')}</p>`;
      return;
    }

    const { rows, total, pageSize } = data;
    page = data.page;

    if (rows.length === 0) {
      const anyFilter = [...currentParams().keys()].some(k => k !== 'page');
      tableContainer.innerHTML = anyFilter || page > 1
        ? '<p class="hint">Sin resultados con esos filtros.</p>'
        : '<p class="hint">Todavía no hay ninguna acción registrada.</p>';
      return;
    }

    tableContainer.innerHTML = rawView
      ? `<div class="admin-table-wrap"><div class="admin-table-scroll"><table class="admin-table">
           <thead><tr><th></th><th>Cuándo</th><th>Quién</th><th>Acción</th><th>Sobre qué</th><th>Detalles</th></tr></thead>
           <tbody>${rows.map(rawRowHtml).join('')}</tbody>
         </table></div>${paginationHtml(total, pageSize)}</div>`
      : `<ol class="log-list">${rows.map(entryHtml).join('')}</ol>${paginationHtml(total, pageSize)}`;

    tableContainer.querySelector<HTMLButtonElement>('[data-log-prev-page]')!.onclick = () => { page--; loadLogPage(); };
    tableContainer.querySelector<HTMLButtonElement>('[data-log-next-page]')!.onclick = () => { page++; loadLogPage(); };
  }

  function reload() { page = 1; loadLogPage(); }

  let searchTimer: ReturnType<typeof setTimeout> | undefined;
  inputs.q.addEventListener('input', () => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(reload, SEARCH_DEBOUNCE_MS);
  });
  for (const el of [inputs.prefix, inputs.action, inputs.source, inputs.from, inputs.to]) {
    el.addEventListener('change', reload);
  }

  inputs.prefix.addEventListener('change', () => { if (inputs.prefix.value) inputs.action.value = ''; });
  inputs.action.addEventListener('change', () => { if (inputs.action.value) inputs.prefix.value = ''; });

  resetBtn.addEventListener('click', () => {
    for (const el of Object.values(inputs)) el.value = '';
    reload();
  });

  function renderToggleLabel() {
    viewToggle.innerHTML = rawView
      ? `${icon('scroll', { size: 15 })} Ver vista simple`
      : `${icon('terminal', { size: 15 })} Ver datos raw`;
    viewToggle.title = rawView
      ? 'Volver a la vista legible'
      : 'Ver la tabla técnica con el nombre interno de cada acción y el JSON completo de sus detalles';
  }
  viewToggle.addEventListener('click', () => {
    rawView = !rawView;
    renderToggleLabel();
    loadLogPage();
  });

  renderToggleLabel();
  loadLogPage();
  initLiveUpdates('log', loadLogPage);
}
