import { renderAdminTable } from './adminTable';
import { openCatalogForm, deleteCatalogRow, wireSectionForm } from './catalogModal';
import { escapeHtml, escapeAttr } from './html';
import { formatTemperatureRange } from './format';
import { icon } from '../lib/icons';
import { fieldHtml, wireFieldDependencies, type FieldSpec } from '../lib/formFields';
import { dropsSectionHtml, readDrops, wireDropAdd, wireIngredientRows, formatRowWarnings } from './catalogWidgets';
import { openModal, closeAllModals } from './ui';
import { apiFetch } from './api';
import { initLiveUpdates } from './liveUpdates';
import type { Zone, CatalogItem } from '../lib/mapServerApi';

function identityFields(isEdit: boolean): FieldSpec[] {
  return [
    { key: 'name', label: 'Nombre clave', type: 'text', disabled: isEdit, required: !isEdit },
    { key: 'displayName', label: 'Nombre para mostrar', type: 'text', required: true },
    { key: 'emoji', label: 'Emoji', type: 'text' },
    { key: 'color', label: 'Color', type: 'color' },
    { key: 'tempMin', label: 'Temperatura mínima (°C)', type: 'number', min: -80, max: 80 },
    { key: 'tempMax', label: 'Temperatura máxima (°C)', type: 'number', min: -80, max: 80 },
    { key: 'description', label: 'Descripción', type: 'textarea' },
  ];
}

export function initZoneCatalog(root: HTMLElement, initialZones: Zone[], items: CatalogItem[]) {
  const table = root.querySelector<HTMLElement>('[data-zones-table]')!;
  const panel = root.querySelector<HTMLElement>('[data-zones-form-panel]')!;
  const newBtn = root.querySelector<HTMLButtonElement>('[data-zones-new-btn]')!;

  async function reload() {
    renderTable(await apiFetch<Zone[]>('/api/zonas'));
  }

  function renderTable(rows: Zone[]) {
    renderAdminTable(table, {
      columns: [
        { key: 'color', label: '', render: r => `<span class="legend-swatch" style="background:${escapeAttr(r.color)}"></span>` },
        { key: 'emoji', label: '' },
        { key: 'display_name', label: 'Nombre' },
        { key: 'name', label: 'Clave' },
        { key: 'tile_count', label: 'Casillas', render: r => String(r.tile_count ?? 0) },
        { key: 'temp_min', label: 'Temperatura', render: r => formatTemperatureRange(r.temp_min, r.temp_max) },
        { key: 'resources', label: 'Recursos propios', render: r => r.resources.map(res => `${res.name}×${res.quantity} (${res.drop_chance_percent}%)`).join(', ') || '—' },
      ],
      rows,
      onEdit: row => openZoneForm(row),
      onDelete: row => deleteCatalogRow('zonas', row, reload),
    });
  }

  function openZoneForm(row: Zone | null) {
    const isEdit = Boolean(row);
    const idFields = identityFields(isEdit);
    const idValues: Record<string, unknown> = row
      ? {
          name: row.name, displayName: row.display_name, emoji: row.emoji, color: row.color,
          tempMin: row.temp_min, tempMax: row.temp_max, description: row.description,
        }
      : { emoji: '🧭', color: '#5cc0b0', tempMin: 5, tempMax: 25 };

    if (!isEdit) {
      openCatalogForm(panel, {
        title: 'Nueva zona',
        fields: idFields, values: idValues,
        onSubmit: async payload => {
          await apiFetch('/api/zonas', { method: 'POST', body: payload });
          await reload();
        },
      });
      return;
    }

    panel.innerHTML = `
      <div class="form-header"><h3>Editar zona: ${escapeHtml(row!.display_name)}</h3><button type="button" class="btn-icon modal-close" aria-label="Cerrar">${icon('x', { size: 15 })}</button></div>
      <form id="zone-identity-form" class="ct-section">
        <fieldset><legend>Identidad</legend>${idFields.map(f => fieldHtml(f, idValues[f.key])).join('')}</fieldset>
        <button type="submit" class="btn-secondary">Guardar identidad</button>
        <p class="hint" id="zone-identity-status" role="status"></p>
      </form>
      <form id="zone-resources-form" class="ct-section">
        <fieldset><legend>Recursos propios de la zona (/recolectar)</legend>${dropsSectionHtml(row!.resources.map(r => ({ name: r.name, quantity: r.quantity, drop_chance_percent: r.drop_chance_percent })), items)}</fieldset>
        <p class="hint">Se suman a los del terreno de cada casilla. Si repites un ítem que ya da el terreno, mandan la cantidad y el % de aquí.</p>
        <button type="submit" class="btn-secondary">Guardar recursos</button>
        <p class="hint" id="zone-resources-status" role="status"></p>
      </form>
      <p class="hint">Las casillas se asignan por rectángulo desde el mapa de Staff o con <code>/zona asignar</code>. Esta zona cubre ahora ${row!.tile_count ?? 0} casilla(s).</p>
      <p class="hint">Al cambiar el rango de temperatura se recalcula la de todas sus casillas: cada una recibe un valor propio dentro del rango, cercano al de sus vecinas.</p>`;

    panel.querySelector<HTMLButtonElement>('.modal-close')!.onclick = () => closeAllModals();
    wireFieldDependencies(panel);
    wireIngredientRows(panel);
    wireDropAdd(panel, items);

    wireSectionForm({
      form: panel.querySelector('#zone-identity-form')!,
      container: panel,
      status: panel.querySelector('#zone-identity-status')!,
      fields: idFields,
      successLabel: 'Identidad guardada',
      submit: async payload => {
        await apiFetch(`/api/zonas/${encodeURIComponent(row!.name)}`, { method: 'PATCH', body: payload });
        await reload();
      },
    });

    wireSectionForm({
      form: panel.querySelector('#zone-resources-form')!,
      container: panel,
      status: panel.querySelector('#zone-resources-status')!,
      fields: [],
      successLabel: 'Recursos guardados',
      submit: async () => {
        const resourcesResult = readDrops(panel);
        await apiFetch(`/api/zonas/${encodeURIComponent(row!.name)}/resources`, { method: 'PATCH', body: { resources: resourcesResult.rows } });
        return formatRowWarnings(resourcesResult);
      },
    });

    openModal(panel);
  }

  newBtn.onclick = () => openZoneForm(null);
  renderTable(initialZones);
  initLiveUpdates('zonas', reload);
}
