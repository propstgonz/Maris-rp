import { renderAdminTable } from './adminTable';
import { openCatalogForm, deleteCatalogRow, wireSectionForm } from './catalogModal';
import { escapeHtml, escapeAttr } from './html';
import { icon } from '../lib/icons';
import { fieldHtml, wireFieldDependencies, type FieldSpec } from '../lib/formFields';
import { dropsSectionHtml, readDrops, wireDropAdd, wireIngredientRows, formatRowWarnings } from './catalogWidgets';
import { openModal, closeAllModals } from './ui';
import { apiFetch } from './api';
import { initLiveUpdates } from './liveUpdates';
import type { TerrainType, CatalogItem, IntegrityFinding } from '../lib/mapServerApi';
import { formatWarnings } from './worldHealth';

const VEHICLE_CATEGORY_OPTIONS = [
  { value: '', label: '(a pie, sin vehículo)' },
  { value: 'aereo', label: '✈️ Aéreo' },
  { value: 'maritimo', label: '🚤 Marítimo' },
  { value: 'terrestre', label: '🚙 Terrestre' },
];

function identityFields(isEdit: boolean): FieldSpec[] {
  return [
    { key: 'name', label: 'Nombre clave', type: 'text', disabled: isEdit, required: !isEdit },
    { key: 'displayName', label: 'Nombre para mostrar', type: 'text', required: true },
    { key: 'emoji', label: 'Emoji', type: 'text' },
    { key: 'color', label: 'Color', type: 'color' },
    { key: 'requiresVehicleCategory', label: 'Exige vehículo de categoría', type: 'select', options: VEHICLE_CATEGORY_OPTIONS },
    { key: 'description', label: 'Descripción', type: 'textarea' },
  ];
}

export function initTerrainCatalog(root: HTMLElement, initialTerrains: TerrainType[], items: CatalogItem[]) {
  const table = root.querySelector<HTMLElement>('[data-terrains-table]')!;
  const panel = root.querySelector<HTMLElement>('[data-terrains-form-panel]')!;
  const newBtn = root.querySelector<HTMLButtonElement>('[data-terrains-new-btn]')!;

  async function reload() {
    const rows = await apiFetch<TerrainType[]>('/api/terrain-types');
    renderTable(rows);
  }

  function renderTable(rows: TerrainType[]) {
    renderAdminTable(table, {
      columns: [
        { key: 'color', label: '', render: r => `<span class="legend-swatch" style="background:${escapeAttr(r.color)}"></span>` },
        { key: 'emoji', label: '' },
        { key: 'display_name', label: 'Nombre' },
        { key: 'name', label: 'Clave' },
        { key: 'requires_vehicle_category', label: 'Exige vehículo' },
        { key: 'resources', label: 'Recursos', render: r => (r.resources as { name: string; quantity: number; drop_chance_percent: number }[]).map(res => `${res.name}×${res.quantity} (${res.drop_chance_percent}%)`).join(', ') || '—' },
      ],
      rows,
      onEdit: row => openTerrainForm(row),
      onDelete: row => deleteCatalogRow('terrain-types', row, reload),
    });
  }

  function openTerrainForm(row: TerrainType | null) {
    const isEdit = Boolean(row);
    const idFields = identityFields(isEdit);
    const idValues: Record<string, unknown> = row
      ? {
          name: row.name, displayName: row.display_name, emoji: row.emoji, color: row.color,
          requiresVehicleCategory: row.requires_vehicle_category ?? '', description: row.description,
        }
      : { emoji: '🗺️', color: '#888888' };

    if (!isEdit) {
      openCatalogForm(panel, {
        title: 'Nuevo terreno',
        fields: idFields, values: idValues,
        onSubmit: async payload => {
          await apiFetch('/api/terrain-types', { method: 'POST', body: payload });
          await reload();
        },
      });
      return;
    }

    const resources = row!.resources as { name: string; quantity: number; drop_chance_percent: number }[];

    panel.innerHTML = `
      <div class="form-header"><h3>Editar terreno: ${escapeHtml(row!.display_name)}</h3><button type="button" class="btn-icon modal-close" aria-label="Cerrar">${icon('x', { size: 15 })}</button></div>
      <form id="tt-identity-form" class="ct-section">
        <fieldset><legend>Identidad</legend>${idFields.map(f => fieldHtml(f, idValues[f.key])).join('')}</fieldset>
        <button type="submit" class="btn-secondary">Guardar identidad</button>
        <p class="hint" id="tt-identity-status" role="status"></p>
      </form>
      <form id="tt-resources-form" class="ct-section">
        <fieldset><legend>Recursos recolectables (/recolectar)</legend>${dropsSectionHtml(resources.map(r => ({ name: r.name, quantity: r.quantity, drop_chance_percent: r.drop_chance_percent })), items)}</fieldset>
        <p class="hint">% de que salga al intentar recolectarlo — cada recurso tira el suyo por separado.</p>
        <button type="submit" class="btn-secondary">Guardar recursos</button>
        <p class="hint" id="tt-resources-status" role="status"></p>
      </form>`;

    panel.querySelector<HTMLButtonElement>('.modal-close')!.onclick = () => closeAllModals();
    wireFieldDependencies(panel);
    wireIngredientRows(panel);
    wireDropAdd(panel, items);

    wireSectionForm({
      form: panel.querySelector('#tt-identity-form')!,
      container: panel,
      status: panel.querySelector('#tt-identity-status')!,
      fields: idFields,
      successLabel: 'Identidad guardada',
      submit: async payload => {
        const result = await apiFetch<{ warnings?: IntegrityFinding[] }>(`/api/terrain-types/${encodeURIComponent(row!.name)}`, { method: 'PATCH', body: payload });
        return formatWarnings(result.warnings);
      },
    });

    wireSectionForm({
      form: panel.querySelector('#tt-resources-form')!,
      container: panel,
      status: panel.querySelector('#tt-resources-status')!,
      fields: [],
      successLabel: 'Recursos guardados',
      submit: async () => {
        const resourcesResult = readDrops(panel);
        await apiFetch(`/api/terrain-types/${encodeURIComponent(row!.name)}/resources`, { method: 'PATCH', body: { resources: resourcesResult.rows } });
        return formatRowWarnings(resourcesResult);
      },
    });

    openModal(panel);
  }

  newBtn.onclick = () => openTerrainForm(null);
  renderTable(initialTerrains);
  initLiveUpdates('terrains', reload);
}
