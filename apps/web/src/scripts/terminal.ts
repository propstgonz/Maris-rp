

import { escapeHtml } from './html';
import { apiFetch } from './api';

interface SqlResult {
  rows: Record<string, unknown>[];
  totalRows: number;
  truncated: boolean;
}

function sqlResultTableHtml(result: SqlResult): string {
  if (result.rows.length === 0) return '<p class="hint">Sin filas.</p>';
  const columns = Object.keys(result.rows[0]);
  const thead = columns.map(c => `<th>${escapeHtml(c)}</th>`).join('');
  const rowsHtml = result.rows.map(row =>
    `<tr>${columns.map(c => `<td>${escapeHtml(row[c] === null ? 'NULL' : String(row[c]))}</td>`).join('')}</tr>`
  ).join('');
  const truncatedNote = result.truncated
    ? `<p class="hint">Mostrando las primeras ${result.rows.length} de ${result.totalRows} filas.</p>`
    : `<p class="hint">${result.totalRows} fila(s).</p>`;
  return `<div class="admin-table-scroll"><table class="admin-table"><thead><tr>${thead}</tr></thead><tbody>${rowsHtml}</tbody></table></div>${truncatedNote}`;
}

export function initTerminal(root: HTMLElement) {
  const cmdForm = root.querySelector<HTMLFormElement>('[data-terminal-command-form]')!;
  const cmdInput = root.querySelector<HTMLInputElement>('[data-terminal-command-input]')!;
  const cmdOutput = root.querySelector<HTMLElement>('[data-terminal-command-output]')!;
  cmdForm.addEventListener('submit', async evt => {
    evt.preventDefault();
    const commandLine = cmdInput.value.trim();
    if (!commandLine) return;
    cmdOutput.textContent = 'Ejecutando… (el bot tarda menos de un segundo normalmente)';
    try {
      const result = await apiFetch<{ output: string }>('/api/terminal/command', { method: 'POST', body: { commandLine } });
      cmdOutput.textContent = `$ ${commandLine}\n\n${result.output}`;
    } catch (err) {
      cmdOutput.textContent = `$ ${commandLine}\n\n${err instanceof Error ? err.message : 'Error desconocido.'}`;
    }
  });

  const sqlForm = root.querySelector<HTMLFormElement>('[data-terminal-sql-form]')!;
  const sqlInput = root.querySelector<HTMLTextAreaElement>('[data-terminal-sql-input]')!;
  const sqlOutput = root.querySelector<HTMLElement>('[data-terminal-sql-output]')!;
  sqlForm.addEventListener('submit', async evt => {
    evt.preventDefault();
    const query = sqlInput.value.trim();
    if (!query) return;
    sqlOutput.innerHTML = '<p class="hint">Ejecutando…</p>';
    try {
      const result = await apiFetch<SqlResult>('/api/terminal/sql', { method: 'POST', body: { query } });
      sqlOutput.innerHTML = sqlResultTableHtml(result);
    } catch (err) {
      sqlOutput.innerHTML = `<p class="hint">${escapeHtml(err instanceof Error ? err.message : 'Error desconocido.')}</p>`;
    }
  });

  const MAX_BROADCAST_IMAGES = 4;
  const broadcastForm = root.querySelector<HTMLFormElement>('[data-broadcast-form]');
  const broadcastMessage = root.querySelector<HTMLTextAreaElement>('[data-broadcast-message]');
  const broadcastImages = root.querySelector<HTMLInputElement>('[data-broadcast-images]');
  const broadcastOutput = root.querySelector<HTMLElement>('[data-broadcast-output]');
  if (broadcastForm && broadcastMessage && broadcastImages && broadcastOutput) {
    broadcastForm.addEventListener('submit', async evt => {
      evt.preventDefault();
      const message = broadcastMessage.value.trim();
      if (!message) return;
      const images = [...(broadcastImages.files ?? [])];
      if (images.length > MAX_BROADCAST_IMAGES) {
        broadcastOutput.textContent = `Como mucho ${MAX_BROADCAST_IMAGES} imágenes (has seleccionado ${images.length}).`;
        return;
      }

      const submitBtn = broadcastForm.querySelector<HTMLButtonElement>('button[type="submit"]')!;
      submitBtn.disabled = true;
      broadcastOutput.textContent = 'Enviando… (puede tardar unos segundos con muchos jugadores)';
      try {
        const body = new FormData();
        body.append('message', message);
        for (const img of images) body.append('imagenes', img);
        const result = await apiFetch<{ sent: number; failed: number; totalTargets: number }>('/api/broadcast', { method: 'POST', body });
        broadcastOutput.textContent = `Entregados: ${result.sent}/${result.totalTargets}${result.failed > 0 ? ` (${result.failed} fallidos)` : ''}`;
        broadcastForm.reset();
      } catch (err) {
        broadcastOutput.textContent = `${err instanceof Error ? err.message : 'Error desconocido.'}`;
      } finally {
        submitBtn.disabled = false;
      }
    });
  }
}
