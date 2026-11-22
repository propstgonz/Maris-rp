import { escapeHtml, escapeAttr } from './html';
import { icon } from '../lib/icons';

export interface AdminTableColumn<T> {
  key: keyof T & string;
  label: string;
  render?: (row: T) => string;
}

export interface AdminTableOptions<T> {
  columns: AdminTableColumn<T>[];
  rows: T[];
  onEdit: (row: T) => void;
  onDelete: (row: T) => void;
}

interface SortState { key: string; dir: 1 | -1 }

const sortByContainer = new WeakMap<HTMLElement, SortState>();

function plainText(html: string): string {
  return html.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim().toLowerCase();
}

function searchable(text: string): string {
  return text.normalize('NFD').replace(/\p{Diacritic}/gu, '');
}

function compareCells(a: unknown, b: unknown, aText: string, bText: string): number {
  if (typeof a === 'number' && typeof b === 'number') return a - b;
  return aText.localeCompare(bText, 'es', { numeric: true, sensitivity: 'base' });
}

export function renderAdminTable<T extends Record<string, unknown>>(
  container: HTMLElement,
  { columns, rows, onEdit, onDelete }: AdminTableOptions<T>
) {
  if (rows.length === 0) {
    container.innerHTML = '<p class="hint">No hay nada en este catálogo todavía.</p>';
    return;
  }

  const previousFilter = container.querySelector<HTMLInputElement>('.admin-table-filter');
  const filterValue = previousFilter?.value ?? '';
  const filterHadFocus = previousFilter === document.activeElement;
  const caret = previousFilter?.selectionStart ?? filterValue.length;

  const decorated = rows.map(row => {
    const cells = columns.map(c => (c.render ? c.render(row) : escapeHtml(String(row[c.key] ?? ''))));
    return { row, cells, haystack: searchable(cells.map(plainText).join(' ')) };
  });

  const needle = searchable(filterValue.trim().toLowerCase());
  const shown = needle ? decorated.filter(d => d.haystack.includes(needle)) : decorated.slice();

  const sort = sortByContainer.get(container);
  const sortIndex = sort ? columns.findIndex(c => c.key === sort.key) : -1;
  if (sort && sortIndex >= 0) {
    shown.sort((a, b) =>
      compareCells(a.row[sort.key], b.row[sort.key], plainText(a.cells[sortIndex]), plainText(b.cells[sortIndex])) * sort.dir
    );
  }

  const toolbarHtml = `
    <div class="admin-table-toolbar">
      <label class="admin-table-search">${icon('search', { size: 14 })}
        <input type="search" class="admin-table-filter" placeholder="Filtrar…" value="${escapeAttr(filterValue)}" aria-label="Filtrar la tabla">
      </label>
      <span class="hint admin-table-count">${shown.length} de ${rows.length}</span>
    </div>`;

  const thead = `<tr>${columns.map((c, i) => {
    const arrow = sortIndex === i ? ` ${icon(sort!.dir === 1 ? 'chevron-up' : 'chevron-down', { size: 12 })}` : '';
    return `<th data-sort-index="${i}" class="admin-table-sortable" role="button" tabindex="0" title="Ordenar por ${escapeAttr(c.label || 'esta columna')}">${escapeHtml(c.label)}${arrow}</th>`;
  }).join('')}<th></th></tr>`;

  const tbody = shown.map((d, i) => {
    const cells = d.cells.map(cell => `<td>${cell}</td>`).join('');
    return `<tr data-idx="${i}">${cells}<td class="row-actions">` +
      `<button type="button" class="btn-icon btn-edit-row" title="Editar">${icon('pencil', { size: 15 })}</button>` +
      `<button type="button" class="btn-icon btn-delete-row" title="Borrar">${icon('trash', { size: 15 })}</button></td></tr>`;
  }).join('');

  const bodyHtml = shown.length === 0
    ? `<p class="hint admin-table-empty">Nada coincide con «${escapeHtml(filterValue.trim())}».</p>`
    : `<div class="admin-table-scroll"><table class="admin-table"><thead>${thead}</thead><tbody>${tbody}</tbody></table></div>`;

  container.innerHTML = `${toolbarHtml}${bodyHtml}`;

  container.querySelectorAll<HTMLTableRowElement>('tbody tr').forEach(tr => {
    const { row } = shown[Number(tr.dataset.idx)];
    tr.querySelector<HTMLButtonElement>('.btn-edit-row')!.onclick = () => onEdit(row);
    tr.querySelector<HTMLButtonElement>('.btn-delete-row')!.onclick = () => onDelete(row);
  });

  const repaint = () => renderAdminTable(container, { columns, rows, onEdit, onDelete });

  const filterInput = container.querySelector<HTMLInputElement>('.admin-table-filter')!;
  filterInput.addEventListener('input', repaint);
  if (filterHadFocus) {
    filterInput.focus();
    filterInput.setSelectionRange(caret, caret);
  }

  container.querySelectorAll<HTMLTableCellElement>('.admin-table-sortable').forEach(th => {
    const toggle = () => {
      const key = columns[Number(th.dataset.sortIndex)].key;
      const current = sortByContainer.get(container);
      sortByContainer.set(container, { key, dir: current?.key === key && current.dir === 1 ? -1 : 1 });
      repaint();
    };
    th.onclick = toggle;
    th.onkeydown = evt => {
      if (evt.key === 'Enter' || evt.key === ' ') { evt.preventDefault(); toggle(); }
    };
  });
}
