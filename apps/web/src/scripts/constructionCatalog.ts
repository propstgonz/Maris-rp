import { escapeHtml, escapeAttr } from './html';
import { icon } from '../lib/icons';
import { renderAdminTable } from './adminTable';
import { deleteCatalogRow, wireSectionForm } from './catalogModal';
import { fieldHtml, type FieldSpec } from '../lib/formFields';
import { itemOptions, ingredientsSectionHtml, readIngredients, wireIngredientRows, wireIngredientAdd, formatRowWarnings } from './catalogWidgets';
import { openModal, closeAllModals, showToast } from './ui';
import { apiFetch } from './api';
import { initLiveUpdates } from './liveUpdates';
import type { ConstructionType, CatalogItem, IntegrityFinding } from '../lib/mapServerApi';
import { formatWarnings } from './worldHealth';

function identityFields(isEdit: boolean, items: CatalogItem[]): FieldSpec[] {
  return [
    { key: 'name', label: 'Nombre clave', type: 'text', disabled: isEdit, required: !isEdit },
    { key: 'displayName', label: 'Nombre para mostrar', type: 'text', required: true },
    { key: 'emoji', label: 'Emoji', type: 'text' },
    { key: 'description', label: 'Descripción', type: 'textarea' },
    { key: 'laburoCost', label: 'Coste en Laburo', type: 'number' },
    { key: 'requiresResourceType', label: 'Recurso de casilla requerido', type: 'text' },
    { key: 'maxHealth', label: 'Vida máxima (1-1000)', type: 'number' },
    { key: 'unlocksItemName', label: 'Desbloquea la receta de', type: 'select', options: itemOptions(items, [{ value: '', label: '(ninguno)' }]) },
    { key: 'grantsResourceItemName', label: 'Genera recurso', type: 'select', options: itemOptions(items, [{ value: '', label: '(ninguno)' }]) },
    { key: 'grantsResourceRate', label: 'Unidades/día generadas', type: 'number' },
  ];
}

function durabilityFields(items: CatalogItem[]): FieldSpec[] {
  return [
    { key: 'maxDurability', label: 'Durabilidad máxima (1-1000)', type: 'number' },
    { key: 'durabilityLossPerDay', label: 'Pérdida de durabilidad/día (vacío = sin desgaste)', type: 'number' },
    { key: 'durabilityRepairToolItemName', label: 'Herramienta para restaurarla (no se gasta)', type: 'select', options: itemOptions(items, [{ value: '', label: '(cualquiera puede)' }]) },
  ];
}

function fuelFields(items: CatalogItem[]): FieldSpec[] {
  return [
    { key: 'fuelItemName', label: 'Ítem-combustible', type: 'select', options: itemOptions(items, [{ value: '', label: '(ninguno)' }]) },
    { key: 'fuelConsumptionRate', label: 'Consumo/día', type: 'number' },
    { key: 'fuelCapacity', label: 'Capacidad del depósito', type: 'number' },
    { key: 'isLandingSite', label: '¿Sirve de aterrizaje para vehículos aéreos?', type: 'checkbox' },
  ];
}

function useFields(items: CatalogItem[]): FieldSpec[] {
  const fields: FieldSpec[] = [
    { key: 'toolItemName', label: 'Herramienta requerida', type: 'select', options: itemOptions(items, [{ value: '', label: '(ninguna)' }]) },
    { key: 'resultItemName', label: 'Ítem resultado', type: 'select', options: itemOptions(items, [{ value: '', label: '(sin configurar)' }]) },
  ];
  for (let i = 1; i <= 6; i++) fields.push({ key: `roll${i}`, label: `Dado ${i}`, type: 'number' });
  fields.push({ key: 'laburoCost', label: 'Coste en Laburo por uso', type: 'number' });
  fields.push({ key: 'cooldownHours', label: 'Cooldown (horas)', type: 'integer', min: 0 });
  return fields;
}

export function initConstructionCatalog(root: HTMLElement, initialTypes: ConstructionType[], items: CatalogItem[]) {
  const table = root.querySelector<HTMLElement>('[data-constructions-table]')!;
  const panel = root.querySelector<HTMLElement>('[data-constructions-form-panel]')!;
  const newBtn = root.querySelector<HTMLButtonElement>('[data-constructions-new-btn]')!;

  async function reload() {
    const rows = await apiFetch<ConstructionType[]>('/api/construction-types');
    renderTable(rows);
  }

  function renderTable(rows: ConstructionType[]) {
    renderAdminTable(table, {
      columns: [
        { key: 'emoji', label: '' },
        { key: 'display_name', label: 'Nombre' },
        { key: 'name', label: 'Clave' },
        { key: 'laburo_cost', label: 'Laburo' },
        { key: 'ingredients', label: 'Ingredientes', render: r => r.ingredients.map(i => `${i.name}×${i.quantity_required}`).join(', ') || '—' },
      ],
      rows,
      onEdit: row => openConstructionForm(row),
      onDelete: row => deleteCatalogRow('construction-types', row, reload),
    });
  }

  function openConstructionForm(row: ConstructionType | null) {
    const isEdit = Boolean(row);
    const idFields = identityFields(isEdit, items);
    const idValues: Record<string, unknown> = row
      ? {
          name: row.name, displayName: row.display_name, emoji: row.emoji, description: row.description,
          laburoCost: row.laburo_cost, requiresResourceType: row.requires_resource_type, maxHealth: row.max_health,
          grantsResourceRate: row.grants_resource_rate,
        }
      : { emoji: '🏗️', maxHealth: 10 };

    const fuelVals: Record<string, unknown> = row
      ? { fuelConsumptionRate: row.fuel_consumption_rate, fuelCapacity: row.fuel_capacity, isLandingSite: !!row.is_landing_site }
      : {};

    const durabilityVals: Record<string, unknown> = row
      ? { maxDurability: row.max_durability, durabilityLossPerDay: row.durability_loss_per_day, durabilityRepairToolItemName: row.durability_repair_tool_item_name }
      : { maxDurability: 100 };

    if (!isEdit) {
      panel.innerHTML = `
        <div class="form-header"><h3>Nueva construcción</h3><button type="button" class="btn-icon modal-close" aria-label="Cerrar">${icon('x', { size: 15 })}</button></div>
        <form id="ct-create-form">
          <fieldset><legend>Identidad</legend>${idFields.map(f => fieldHtml(f, idValues[f.key])).join('')}</fieldset>
          <fieldset><legend>Ingredientes</legend>${ingredientsSectionHtml([], items)}</fieldset>
          <fieldset><legend>Combustible y aterrizaje</legend>${fuelFields(items).map(f => fieldHtml(f, fuelVals[f.key])).join('')}</fieldset>
          <fieldset><legend>Durabilidad</legend>${durabilityFields(items).map(f => fieldHtml(f, durabilityVals[f.key])).join('')}</fieldset>
          <button type="submit" class="btn-primary">Crear construcción</button>
          <p id="ct-status" class="hint" role="status"></p>
        </form>`;
      panel.querySelector<HTMLButtonElement>('.modal-close')!.onclick = () => closeAllModals();
      wireIngredientRows(panel);
      wireIngredientAdd(panel, items);
      wireSectionForm({
        form: panel.querySelector('#ct-create-form')!,
        container: panel,
        status: panel.querySelector('#ct-status')!,
        fields: [...idFields, ...fuelFields(items), ...durabilityFields(items)],
        successLabel: 'Creada',
        submit: async payload => {
          const ingredientsResult = readIngredients(panel);
          payload.ingredients = ingredientsResult.rows;
          await apiFetch('/api/construction-types', { method: 'POST', body: payload });
          await reload();
          return formatRowWarnings(ingredientsResult);
        },
      });
      openModal(panel);
      return;
    }

    const useVals: Record<string, unknown> = {
      toolItemName: row!.use_tool_item_name, resultItemName: items.find(i => i.id === row!.use_result_item_id)?.name,
      roll1: row!.use_roll_1, roll2: row!.use_roll_2, roll3: row!.use_roll_3,
      roll4: row!.use_roll_4, roll5: row!.use_roll_5, roll6: row!.use_roll_6,
      laburoCost: row!.use_laburo_cost, cooldownHours: row!.use_cooldown_hours,
    };
    fuelVals.fuelItemName = items.find(i => i.id === row!.fuel_item_id)?.name;
    idValues.unlocksItemName = row!.unlocks_item_name;
    idValues.grantsResourceItemName = items.find(i => i.id === row!.grants_resource_item_id)?.name;

    panel.innerHTML = `
      <div class="form-header"><h3>Editar construcción: ${escapeHtml(row!.display_name)}</h3><button type="button" class="btn-icon modal-close" aria-label="Cerrar">${icon('x', { size: 15 })}</button></div>
      <div class="ct-section">
        <fieldset><legend>${icon('image', { size: 14 })} Imagen (miniatura en el grid del mapa web y confirmaciones de Discord)</legend>
          <div class="avatar-upload">
            <img id="ct-image-preview" class="item-image-preview" src="${escapeAttr(row!.image_url ?? '/static/default-avatar.svg')}" alt="">
            <input type="file" id="ct-image-input" accept="image/png,image/jpeg,image/webp,image/gif">
          </div>
          <p id="ct-image-status" class="hint"></p>
        </fieldset>
      </div>
      <form id="ct-identity-form" class="ct-section">
        <fieldset><legend>Identidad</legend>${idFields.map(f => fieldHtml(f, idValues[f.key])).join('')}</fieldset>
        <button type="submit" class="btn-secondary">Guardar identidad</button>
        <p id="ct-identity-status" class="hint" role="status"></p>
      </form>
      <form id="ct-ingredients-form" class="ct-section">
        <fieldset><legend>Ingredientes</legend>${ingredientsSectionHtml(row!.ingredients, items)}</fieldset>
        <button type="submit" class="btn-secondary">Guardar ingredientes</button>
        <p id="ct-ingredients-status" class="hint" role="status"></p>
      </form>
      <form id="ct-fuel-form" class="ct-section">
        <fieldset><legend>Combustible y aterrizaje</legend>${fuelFields(items).map(f => fieldHtml(f, fuelVals[f.key])).join('')}</fieldset>
        <button type="submit" class="btn-secondary">Guardar combustible</button>
        <p id="ct-fuel-status" class="hint" role="status"></p>
      </form>
      <form id="ct-durability-form" class="ct-section">
        <fieldset><legend>Durabilidad</legend>${durabilityFields(items).map(f => fieldHtml(f, durabilityVals[f.key])).join('')}</fieldset>
        <button type="submit" class="btn-secondary">Guardar durabilidad</button>
        <p id="ct-durability-status" class="hint" role="status"></p>
      </form>
      <form id="ct-use-form" class="ct-section">
        <fieldset><legend>Uso interactivo (/build usar)</legend>${useFields(items).map(f => fieldHtml(f, useVals[f.key])).join('')}</fieldset>
        <button type="submit" class="btn-secondary">Guardar uso interactivo</button>
        <p id="ct-use-status" class="hint" role="status"></p>
      </form>`;

    panel.querySelector<HTMLButtonElement>('.modal-close')!.onclick = () => closeAllModals();
    wireIngredientRows(panel);
    wireIngredientAdd(panel, items);

    panel.querySelector<HTMLInputElement>('#ct-image-input')!.addEventListener('change', async evt => {
      const file = (evt.target as HTMLInputElement).files?.[0];
      if (!file) return;
      const imageStatus = panel.querySelector<HTMLElement>('#ct-image-status')!;
      imageStatus.textContent = 'Subiendo…';
      const formData = new FormData();
      formData.append('imagen', file);
      try {
        const body = await apiFetch<{ image_url: string }>(`/api/construction-types/${encodeURIComponent(row!.name)}/image`, { method: 'POST', body: formData });
        panel.querySelector<HTMLImageElement>('#ct-image-preview')!.src = `${body.image_url}?t=${Date.now()}`;
        imageStatus.textContent = '✅ Imagen actualizada.';
        showToast('Imagen de la construcción actualizada.', 'success');
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Error desconocido.';
        imageStatus.textContent = `❌ ${message}`;
        showToast(message, 'error');
      } finally {
        (evt.target as HTMLInputElement).value = '';
      }
    });

    wireSectionForm({
      form: panel.querySelector('#ct-identity-form')!,
      container: panel,
      status: panel.querySelector('#ct-identity-status')!,
      fields: idFields,
      successLabel: 'Identidad guardada',
      submit: async payload => {
        const result = await apiFetch<{ warnings?: IntegrityFinding[] }>(`/api/construction-types/${encodeURIComponent(row!.name)}`, { method: 'PATCH', body: payload });
        return formatWarnings(result.warnings);
      },
    });

    wireSectionForm({
      form: panel.querySelector('#ct-fuel-form')!,
      container: panel,
      status: panel.querySelector('#ct-fuel-status')!,
      fields: fuelFields(items),
      successLabel: 'Combustible guardado',
      submit: async payload => {
        const result = await apiFetch<{ warnings?: IntegrityFinding[] }>(`/api/construction-types/${encodeURIComponent(row!.name)}`, { method: 'PATCH', body: payload });
        return formatWarnings(result.warnings);
      },
    });

    wireSectionForm({
      form: panel.querySelector('#ct-durability-form')!,
      container: panel,
      status: panel.querySelector('#ct-durability-status')!,
      fields: durabilityFields(items),
      successLabel: 'Durabilidad guardada',
      submit: async payload => {
        const result = await apiFetch<{ warnings?: IntegrityFinding[] }>(`/api/construction-types/${encodeURIComponent(row!.name)}`, { method: 'PATCH', body: payload });
        return formatWarnings(result.warnings);
      },
    });

    wireSectionForm({
      form: panel.querySelector('#ct-ingredients-form')!,
      container: panel,
      status: panel.querySelector('#ct-ingredients-status')!,
      fields: [],
      successLabel: 'Ingredientes guardados',
      submit: async () => {
        const ingredientsResult = readIngredients(panel);
        await apiFetch(`/api/construction-types/${encodeURIComponent(row!.name)}/ingredients`, { method: 'PATCH', body: { ingredients: ingredientsResult.rows } });
        return formatRowWarnings(ingredientsResult);
      },
    });

    wireSectionForm({
      form: panel.querySelector('#ct-use-form')!,
      container: panel,
      status: panel.querySelector('#ct-use-status')!,
      fields: useFields(items),
      successLabel: 'Uso interactivo guardado',
      submit: async payload => {
        await apiFetch(`/api/construction-types/${encodeURIComponent(row!.name)}/usar`, { method: 'PATCH', body: payload });
      },
    });

    openModal(panel);
  }

  newBtn.onclick = () => openConstructionForm(null);
  renderTable(initialTypes);
  initLiveUpdates('constructions', reload);
}
