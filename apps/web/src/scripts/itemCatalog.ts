import { escapeHtml, escapeAttr } from './html';
import { icon } from '../lib/icons';
import { renderAdminTable } from './adminTable';
import { deleteCatalogRow, wireSectionForm } from './catalogModal';
import { fieldHtml, wireFieldDependencies, validateFields, paintFieldErrors, clearFieldErrors, buildPayload, type FieldSpec, type FieldOption } from '../lib/formFields';
import { itemOptions, effectOptions, categoryOptions, ingredientRowHtml, wireIngredientRows, readIngredients, formatRowWarnings } from './catalogWidgets';
import { openModal, closeAllModals, showConfirm, showToast } from './ui';
import { apiFetch } from './api';
import { initLiveUpdates } from './liveUpdates';
import type { CatalogItem, EffectType, ConstructionType, Recipe, IntegrityFinding, ItemCategory } from '../lib/mapServerApi';
import { formatWarnings } from './worldHealth';

const LOADING_HTML = '<div class="loading-state"><span class="spinner"></span> Cargando…</div>';

const ITEM_TYPE_OPTIONS: FieldOption[] = [
  { value: 'dinero', label: '💰 Dinero' },
  { value: 'consumible', label: '🎒 Consumible' },
  { value: 'recurso', label: '⛏️ Recurso' },
  { value: 'herramienta', label: '🔧 Herramienta' },
  { value: 'laburo', label: '💪 Laburo' },
  { value: 'arma', label: '🔫 Arma' },
  { value: 'vehiculo', label: '🚁 Vehículo' },
];

const VEHICLE_ITEM_CATEGORY_OPTIONS: FieldOption[] = [
  { value: 'aereo', label: '✈️ Aéreo (sobrevuela cualquier terreno, exige aterrizaje)' },
  { value: 'maritimo', label: '🚤 Marítimo' },
  { value: 'terrestre', label: '🚙 Terrestre' },
];

function itemFields(isEdit: boolean, categories: ItemCategory[]): FieldSpec[] {
  return [
    { key: 'name', label: 'Nombre clave', type: 'text', disabled: isEdit, required: !isEdit },
    { key: 'displayName', label: 'Nombre para mostrar', type: 'text', required: true },
    { key: 'itemType', label: 'Tipo', type: 'select', options: ITEM_TYPE_OPTIONS, disabled: isEdit },
    { key: 'categoryName', label: 'Categoría (opcional)', type: 'select', options: categoryOptions(categories, [{ value: '', label: '(sin categoría)' }]) },
    { key: 'emoji', label: 'Emoji', type: 'text' },
    { key: 'description', label: 'Descripción', type: 'textarea' },
    { key: 'tradeValue', label: 'Valor de trueque (para que un NPC juzgue si un trato con /comerciar es justo — 0 = sin valor, nunca entra en un trato)', type: 'number' },
    { key: 'isConsumable', label: '¿Consumible?', type: 'checkbox' },
    { key: 'isFuel', label: '¿Puede usarse como combustible?', type: 'checkbox' },
    { key: 'consumeHpDelta', label: 'HP al consumir', type: 'number', dependsOn: 'isConsumable', emptyMeans: 'omit' },
    { key: 'consumeHungerDelta', label: 'Hambre al consumir', type: 'number', dependsOn: 'isConsumable', emptyMeans: 'omit' },
    {
      key: 'healRange', label: 'Alcance de curación como ítem de NPC (casillas, 0 = solo a sí mismo — ver Curación en NPCs)',
      type: 'number', dependsOn: 'isConsumable', emptyMeans: 'omit',
    },
    {
      key: 'mountHpBonus', label: 'Vida extra que da como montura de un NPC',
      type: 'number', dependsOn: 'itemType', dependsOnValue: 'vehiculo', emptyMeans: 'omit',
    },
    {
      key: 'mountDamageBonus', label: 'Daño extra que da como montura de un NPC',
      type: 'number', dependsOn: 'itemType', dependsOnValue: 'vehiculo', emptyMeans: 'omit',
    },
  ];
}

function categoryFields(isEdit: boolean): FieldSpec[] {
  return [
    { key: 'name', label: 'Nombre clave', type: 'text', disabled: isEdit, required: !isEdit },
    { key: 'displayName', label: 'Nombre para mostrar', type: 'text', required: true },
    { key: 'emoji', label: 'Emoji', type: 'text' },
    { key: 'description', label: 'Descripción', type: 'textarea' },
  ];
}

function npcToolFields(items: CatalogItem[]): FieldSpec[] {
  return [
    { key: 'npcToolProducesLaburoRate', label: 'Laburo que produce por ciclo (vacío = no da Laburo — usa esto O un recurso, no ambos)', type: 'number' },
    { key: 'npcToolGrantsItemName', label: 'Recurso que produce por ciclo (vacío = no da recurso)', type: 'select', options: itemOptions(items, [{ value: '', label: '(ninguno)' }]) },
    { key: 'npcToolGrantsRate', label: 'Unidades del recurso por ciclo', type: 'number' },
  ];
}

function vehicleFields(): FieldSpec[] {
  return [
    { key: 'category', label: 'Categoría de transporte', type: 'select', options: VEHICLE_ITEM_CATEGORY_OPTIONS },
    { key: 'speedMultiplier', label: 'Multiplicador de velocidad de viaje (1 = ritmo normal)', type: 'number' },
  ];
}

function weaponFields(items: CatalogItem[], effects: EffectType[]): FieldSpec[] {
  const fields: FieldSpec[] = [
    { key: 'damage', label: 'Daño a jugador (HP)', type: 'number' },
    { key: 'structureDamage', label: 'Daño a construcciones (vacío = no puede dañarlas)', type: 'number' },
  ];
  for (let i = 1; i <= 6; i++) fields.push({ key: `roll${i}`, label: `Dado ${i} — alcance máx. (vacío = falla)`, type: 'number' });
  fields.push({ key: 'maxDurability', label: 'Durabilidad — usos antes de romperse (vacío = irrompible)', type: 'number' });
  fields.push({ key: 'ammoItemName', label: 'Munición — ítem que consume por disparo', type: 'select', options: itemOptions(items, [{ value: '', label: '(no requiere munición)' }]) });
  fields.push({ key: 'ammoCost', label: 'Unidades de munición por disparo', type: 'number' });
  fields.push({ key: 'areaDamage', label: '¿Ataque de área (afecta a toda la casilla)?', type: 'checkbox' });
  fields.push({ key: 'areaEffect', label: 'Estado aplicado al área (exige área activada)', type: 'select', options: effectOptions(effects, [{ value: '', label: '(ninguno)' }]) });
  fields.push({ key: 'areaEffectDurationHours', label: 'Duración del estado de área (horas, vacío = permanente)', type: 'number' });
  return fields;
}

export function initItemCatalog(root: HTMLElement, initialItems: CatalogItem[], initialEffects: EffectType[], initialCategories: ItemCategory[] = []) {
  const table = root.querySelector<HTMLElement>('[data-items-table]')!;
  const panel = root.querySelector<HTMLElement>('[data-items-form-panel]')!;
  const newBtn = root.querySelector<HTMLButtonElement>('[data-items-new-btn]')!;
  const chipsContainer = root.querySelector<HTMLElement>('[data-items-category-chips]')!;
  const searchInput = root.querySelector<HTMLInputElement>('[data-items-search-input]')!;
  const categoriesBtn = root.querySelector<HTMLButtonElement>('[data-items-categories-btn]')!;
  const categoriesPanel = root.querySelector<HTMLElement>('[data-items-categories-panel]')!;

  let items = initialItems;
  let effects = initialEffects;
  let categories = initialCategories;

  async function reload() {
    [items, effects, categories] = await Promise.all([
      apiFetch<CatalogItem[]>('/api/items'),
      apiFetch<EffectType[]>('/api/effect-types'),
      apiFetch<ItemCategory[]>('/api/item-categories'),
    ]);
    renderItemsGroupedByType(items);
  }

  function categoryLabel(categoryName: string | null): string {
    if (!categoryName) return '—';
    const cat = categories.find(c => c.name === categoryName);
    return cat ? `${cat.emoji ?? '🏷️'} ${escapeHtml(cat.display_name)}` : categoryName;
  }

  function renderCategoriesList() {
    categoriesPanel.innerHTML = `
      <div class="form-header"><h3>${icon('folder', { size: 16 })} Categorías de ítems</h3><button type="button" class="btn-icon modal-close" aria-label="Cerrar">${icon('x', { size: 15 })}</button></div>
      <button type="button" class="btn-primary" id="category-new-btn">+ Nueva categoría</button>
      <div id="categories-table" class="admin-table-wrap"></div>`;
    categoriesPanel.querySelector<HTMLButtonElement>('.modal-close')!.onclick = () => closeAllModals();
    categoriesPanel.querySelector<HTMLButtonElement>('#category-new-btn')!.onclick = () => renderCategoryForm(null);
    renderAdminTable(categoriesPanel.querySelector<HTMLElement>('#categories-table')!, {
      columns: [
        { key: 'emoji' as const, label: '' },
        { key: 'display_name' as const, label: 'Nombre' },
        { key: 'name' as const, label: 'Clave' },
      ],
      rows: categories,
      onEdit: row => renderCategoryForm(row),
      onDelete: row => deleteCatalogRow('item-categories', row, async () => {
        await reload();
        renderCategoriesList();
      }),
    });
  }

  function renderCategoryForm(row: ItemCategory | null) {
    const isEdit = Boolean(row);
    const fields = categoryFields(isEdit);
    const values: Record<string, unknown> = row
      ? { name: row.name, displayName: row.display_name, emoji: row.emoji, description: row.description }
      : { emoji: '🏷️' };

    categoriesPanel.innerHTML = `
      <div class="form-header"><h3>${isEdit ? `Editar categoría: ${escapeHtml(row!.display_name)}` : 'Nueva categoría'}</h3><button type="button" class="btn-icon modal-close" aria-label="Cerrar">${icon('x', { size: 15 })}</button></div>
      <button type="button" class="btn-secondary" id="category-back-btn">${icon('chevron-left', { size: 13 })} Volver a la lista</button>
      <form id="category-form">
        ${fields.map(f => fieldHtml(f, values[f.key])).join('')}
        <button type="submit" class="btn-primary">Guardar</button>
        <p id="category-form-status" class="hint" role="status"></p>
      </form>`;
    categoriesPanel.querySelector<HTMLButtonElement>('.modal-close')!.onclick = () => closeAllModals();
    categoriesPanel.querySelector<HTMLButtonElement>('#category-back-btn')!.onclick = () => renderCategoriesList();

    wireSectionForm({
      form: categoriesPanel.querySelector('#category-form')!,
      container: categoriesPanel,
      status: categoriesPanel.querySelector('#category-form-status')!,
      fields,
      successLabel: isEdit ? 'Categoría guardada' : 'Categoría creada',
      submit: async payload => {
        if (isEdit) {
          await apiFetch(`/api/item-categories/${encodeURIComponent(row!.name)}`, { method: 'PATCH', body: payload });
        } else {
          await apiFetch('/api/item-categories', { method: 'POST', body: payload });
        }
        await reload();
        showToast(isEdit ? 'Categoría guardada.' : 'Categoría creada.', 'success');
        renderCategoriesList();
      },
    });
  }

  categoriesBtn.onclick = () => {
    renderCategoriesList();
    openModal(categoriesPanel);
  };

  function renderItemsGroupedByType(rows: CatalogItem[]) {
    const columns = [
      { key: 'emoji' as const, label: '' },
      { key: 'display_name' as const, label: 'Nombre' },
      { key: 'name' as const, label: 'Clave' },
      { key: 'category_name' as const, label: 'Categoría', render: (r: CatalogItem) => categoryLabel(r.category_name) },
    ];
    const groups = ITEM_TYPE_OPTIONS
      .map(t => ({ ...t, rows: rows.filter(r => r.item_type === t.value) }))
      .filter(g => g.rows.length > 0);

    if (groups.length === 0) {
      table.innerHTML = '<p class="hint">No hay nada en este catálogo todavía.</p>';
      chipsContainer.innerHTML = '';
      return;
    }

    table.innerHTML = groups.map(g => `
      <div class="item-type-group" id="item-group-${g.value}">
        <div class="item-type-heading">${escapeHtml(g.label)} <span class="item-type-count">${g.rows.length}</span></div>
        <div id="items-table-${g.value}" class="admin-table-wrap"></div>
      </div>`).join('');

    for (const g of groups) {
      renderAdminTable(table.querySelector<HTMLElement>(`#items-table-${g.value}`)!, {
        columns,
        rows: g.rows,
        onEdit: row => openItemForm(row),
        onDelete: row => deleteCatalogRow('items', row, reload),
      });
    }

    chipsContainer.innerHTML = groups.map(g =>
      `<button type="button" class="category-chip" data-target="item-group-${g.value}">${escapeHtml(g.label)}</button>`
    ).join('');
    chipsContainer.querySelectorAll<HTMLButtonElement>('.category-chip').forEach(chip => {
      chip.onclick = () => {
        document.getElementById(chip.dataset.target!)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      };
    });

    filterItemsBySearch(searchInput.value);
    searchInput.oninput = () => filterItemsBySearch(searchInput.value);
  }

  function filterItemsBySearch(query: string) {
    const q = query.trim().toLowerCase();
    table.querySelectorAll<HTMLElement>('.item-type-group').forEach(group => {
      let visibleCount = 0;
      group.querySelectorAll<HTMLElement>('tbody tr').forEach(tr => {
        const matches = !q || (tr.textContent ?? '').toLowerCase().includes(q);
        tr.classList.toggle('hidden', !matches);
        if (matches) visibleCount++;
      });
      group.classList.toggle('hidden', visibleCount === 0);
    });
  }

  function extraItemFieldsFor(itemType: string): FieldSpec[] {
    if (itemType === 'arma') return weaponFields(items, effects);
    if (itemType === 'herramienta') return npcToolFields(items);
    if (itemType === 'vehiculo') return vehicleFields();
    return [];
  }

  function extraItemLegendFor(itemType: string): string {
    if (itemType === 'arma') return 'Arma';
    if (itemType === 'herramienta') return 'Herramienta de NPC reclutado';
    if (itemType === 'vehiculo') return 'Vehículo';
    return '';
  }

  const EXTRA_ITEM_DEFAULT_VALUES: Record<string, Record<string, unknown>> = {
    vehiculo: { category: 'terrestre', speedMultiplier: 1 },
  };

  function renderCreateItemForm(fields: FieldSpec[], values: Record<string, unknown>) {
    function extraSectionHtml(itemType: string): string {
      const extraFields = extraItemFieldsFor(itemType);
      if (extraFields.length === 0) return '';
      const extraValues = EXTRA_ITEM_DEFAULT_VALUES[itemType] ?? {};
      return `<fieldset id="item-create-extra-fieldset"><legend>${escapeHtml(extraItemLegendFor(itemType))}</legend>${extraFields.map(f => fieldHtml(f, extraValues[f.key])).join('')}</fieldset>`;
    }

    panel.innerHTML = `
      <div class="form-header"><h3>Nuevo ítem</h3><button type="button" class="btn-icon modal-close" aria-label="Cerrar">${icon('x', { size: 15 })}</button></div>
      <form id="item-create-form">
        <fieldset><legend>Identidad</legend>${fields.map(f => fieldHtml(f, values[f.key])).join('')}</fieldset>
        <div id="item-create-extra">${extraSectionHtml(String(values.itemType))}</div>
        <fieldset><legend>${icon('image', { size: 14 })} Imagen (opcional — miniatura en confirmaciones de Discord)</legend>
          <input type="file" id="item-create-image-input" accept="image/png,image/jpeg,image/webp,image/gif">
        </fieldset>
        <button type="submit" class="btn-primary">Guardar</button>
        <p id="item-create-status" class="hint form-status" role="status"></p>
      </form>`;
    panel.querySelector<HTMLButtonElement>('.modal-close')!.onclick = () => closeAllModals();
    wireFieldDependencies(panel);

    const typeSelect = panel.querySelector<HTMLSelectElement>('#f_itemType')!;
    const extraContainer = panel.querySelector<HTMLElement>('#item-create-extra')!;
    typeSelect.addEventListener('change', () => {
      extraContainer.innerHTML = extraSectionHtml(typeSelect.value);
      wireFieldDependencies(panel);
    });

    const form = panel.querySelector<HTMLFormElement>('#item-create-form')!;
    const status = panel.querySelector<HTMLElement>('#item-create-status')!;
    const submitBtn = form.querySelector<HTMLButtonElement>('button[type="submit"]')!;

    form.addEventListener('submit', async evt => {
      evt.preventDefault();
      clearFieldErrors(panel);
      const errors = validateFields(fields, panel);
      if (errors.length > 0) {
        paintFieldErrors(errors, panel);
        status.textContent = `❌ Revisa los campos marcados (${errors.length}).`;
        return;
      }
      submitBtn.disabled = true;
      status.textContent = 'Guardando…';

      let created: CatalogItem;
      try {
        created = await apiFetch<CatalogItem>('/api/items', { method: 'POST', body: buildPayload(fields, panel) });
      } catch (err) {
        status.textContent = `❌ ${err instanceof Error ? err.message : 'Error desconocido.'}`;
        submitBtn.disabled = false;
        return;
      }

      await reload();
      showToast('Ítem creado.', 'success');

      try {
        const itemType = typeSelect.value;
        const extraFields = extraItemFieldsFor(itemType);
        if (extraFields.length > 0) {
          const extraPayload = buildPayload(extraFields, panel);
          if (itemType === 'arma') {
            await apiFetch(`/api/items/${encodeURIComponent(created.name)}/arma`, { method: 'PATCH', body: extraPayload });
          } else if (itemType === 'herramienta') {
            await apiFetch(`/api/items/${encodeURIComponent(created.name)}`, { method: 'PATCH', body: extraPayload });
          } else if (itemType === 'vehiculo') {
            extraPayload.speedMultiplier = extraPayload.speedMultiplier ?? 1;
            await apiFetch(`/api/items/${encodeURIComponent(created.name)}/vehiculo`, { method: 'PATCH', body: extraPayload });
          }
        }
        const imageFile = panel.querySelector<HTMLInputElement>('#item-create-image-input')?.files?.[0];
        if (imageFile) {
          const formData = new FormData();
          formData.append('imagen', imageFile);
          await apiFetch(`/api/items/${encodeURIComponent(created.name)}/image`, { method: 'POST', body: formData });
        }
        await reload();
      } catch (err) {
        showToast(
          `"${created.display_name}" se creó, pero falló su configuración adicional: ${err instanceof Error ? err.message : 'Error desconocido.'} Ábrelo para editarla.`,
          'error',
        );
      }
      closeAllModals();
    });

    openModal(panel);
  }

  function openItemForm(row: CatalogItem | null) {
    const isEdit = Boolean(row);
    const fields = itemFields(isEdit, categories);
    const values: Record<string, unknown> = row
      ? {
          name: row.name, displayName: row.display_name, itemType: row.item_type, emoji: row.emoji,
          categoryName: row.category_name ?? '', description: row.description, isConsumable: !!row.is_consumable, isFuel: !!row.is_fuel,
          consumeHpDelta: row.consume_hp_delta, consumeHungerDelta: row.consume_hunger_delta,
          healRange: row.heal_range, mountHpBonus: row.mount_hp_bonus, mountDamageBonus: row.mount_damage_bonus,
          tradeValue: row.trade_value,
        }
      : { emoji: '📦', itemType: 'consumible', tradeValue: 0 };

    if (!isEdit) {
      renderCreateItemForm(fields, values);
      return;
    }

    let extraSectionHtml = '';
    if (row!.item_type === 'arma') {
      const wFields = weaponFields(items, effects);
      const wValues: Record<string, unknown> = {
        damage: row!.weapon_damage, structureDamage: row!.weapon_structure_damage,
        roll1: row!.weapon_roll_1, roll2: row!.weapon_roll_2, roll3: row!.weapon_roll_3,
        roll4: row!.weapon_roll_4, roll5: row!.weapon_roll_5, roll6: row!.weapon_roll_6,
        maxDurability: row!.weapon_max_durability, ammoItemName: row!.weapon_ammo_item_name,
        ammoCost: row!.weapon_ammo_cost, areaDamage: !!row!.weapon_area_damage,
        areaEffect: row!.weapon_area_effect, areaEffectDurationHours: row!.weapon_area_effect_duration_hours,
      };
      extraSectionHtml = `
        <form id="item-weapon-form" class="ct-section">
          <fieldset><legend>Arma</legend>${wFields.map(f => fieldHtml(f, wValues[f.key])).join('')}</fieldset>
          <button type="submit" class="btn-secondary">Guardar arma</button>
          <p id="item-weapon-status" class="hint" role="status"></p>
        </form>`;
    } else if (row!.item_type === 'herramienta') {
      const tFields = npcToolFields(items);
      const tValues: Record<string, unknown> = {
        npcToolProducesLaburoRate: row!.npc_tool_produces_laburo_rate ?? '',
        npcToolGrantsItemName: items.find(i => i.id === row!.npc_tool_grants_item_id)?.name ?? '',
        npcToolGrantsRate: row!.npc_tool_grants_rate ?? '',
      };
      extraSectionHtml = `
        <form id="item-npc-tool-form" class="ct-section">
          <fieldset><legend>Herramienta de NPC reclutado</legend>${tFields.map(f => fieldHtml(f, tValues[f.key])).join('')}</fieldset>
          <button type="submit" class="btn-secondary">Guardar herramienta</button>
          <p id="item-npc-tool-status" class="hint" role="status"></p>
        </form>`;
    } else if (row!.item_type === 'vehiculo') {
      const vFields = vehicleFields();
      const vValues: Record<string, unknown> = { category: row!.vehicle_category ?? 'terrestre', speedMultiplier: row!.vehicle_speed_multiplier ?? 1 };
      extraSectionHtml = `
        <form id="item-vehicle-form" class="ct-section">
          <fieldset><legend>Vehículo</legend>${vFields.map(f => fieldHtml(f, vValues[f.key])).join('')}</fieldset>
          <button type="submit" class="btn-secondary">Guardar vehículo</button>
          <p id="item-vehicle-status" class="hint" role="status"></p>
        </form>`;
    }

    panel.innerHTML = `
      <div class="form-header"><h3>Editar ítem: ${escapeHtml(row!.display_name)}</h3><button type="button" class="btn-icon modal-close" aria-label="Cerrar">${icon('x', { size: 15 })}</button></div>
      <div class="ct-section">
        <fieldset><legend>${icon('image', { size: 14 })} Imagen (miniatura en confirmaciones de Discord)</legend>
          <div class="avatar-upload">
            <img id="item-image-preview" class="item-image-preview" src="${escapeAttr(row!.image_url ?? '/static/default-avatar.svg')}" alt="">
            <input type="file" id="item-image-input" accept="image/png,image/jpeg,image/webp,image/gif">
          </div>
          <p id="item-image-status" class="hint"></p>
        </fieldset>
      </div>
      <form id="item-identity-form" class="ct-section">
        <fieldset><legend>Identidad</legend>${fields.map(f => fieldHtml(f, values[f.key])).join('')}</fieldset>
        <button type="submit" class="btn-secondary">Guardar identidad</button>
        <p id="item-identity-status" class="hint" role="status"></p>
      </form>
      ${extraSectionHtml}
      <div id="item-recipes-section" class="ct-section">${LOADING_HTML}</div>`;
    panel.querySelector<HTMLButtonElement>('.modal-close')!.onclick = () => closeAllModals();
    wireFieldDependencies(panel);
    renderItemRecipesSection(row!.name);

    panel.querySelector<HTMLInputElement>('#item-image-input')!.addEventListener('change', async evt => {
      const file = (evt.target as HTMLInputElement).files?.[0];
      if (!file) return;
      const imageStatus = panel.querySelector<HTMLElement>('#item-image-status')!;
      imageStatus.textContent = 'Subiendo…';
      const formData = new FormData();
      formData.append('imagen', file);
      try {
        const body = await apiFetch<{ image_url: string }>(`/api/items/${encodeURIComponent(row!.name)}/image`, { method: 'POST', body: formData });
        panel.querySelector<HTMLImageElement>('#item-image-preview')!.src = `${body.image_url}?t=${Date.now()}`;
        imageStatus.textContent = '✅ Imagen actualizada.';
        showToast('Imagen del ítem actualizada.', 'success');
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Error desconocido.';
        imageStatus.textContent = `❌ ${message}`;
        showToast(message, 'error');
      } finally {
        (evt.target as HTMLInputElement).value = '';
      }
    });

    wireSectionForm({
      form: panel.querySelector('#item-identity-form')!,
      container: panel,
      status: panel.querySelector('#item-identity-status')!,
      fields,
      successLabel: 'Identidad guardada',
      submit: async payload => {
        const result = await apiFetch<{ warnings?: IntegrityFinding[] }>(`/api/items/${encodeURIComponent(row!.name)}`, { method: 'PATCH', body: payload });
        return formatWarnings(result.warnings);
      },
    });

    const weaponForm = panel.querySelector<HTMLFormElement>('#item-weapon-form');
    if (weaponForm) {
      wireSectionForm({
        form: weaponForm,
        container: panel,
        status: panel.querySelector('#item-weapon-status')!,
        fields: weaponFields(items, effects),
        successLabel: 'Arma guardada',
        submit: async payload => {
          await apiFetch(`/api/items/${encodeURIComponent(row!.name)}/arma`, { method: 'PATCH', body: payload });
        },
      });
    }

    const npcToolForm = panel.querySelector<HTMLFormElement>('#item-npc-tool-form');
    if (npcToolForm) {
      wireSectionForm({
        form: npcToolForm,
        container: panel,
        status: panel.querySelector('#item-npc-tool-status')!,
        fields: npcToolFields(items),
        successLabel: 'Herramienta guardada',
        submit: async payload => {
          const result = await apiFetch<{ warnings?: IntegrityFinding[] }>(`/api/items/${encodeURIComponent(row!.name)}`, { method: 'PATCH', body: payload });
          return formatWarnings(result.warnings);
        },
      });
    }

    const vehicleForm = panel.querySelector<HTMLFormElement>('#item-vehicle-form');
    if (vehicleForm) {
      wireSectionForm({
        form: vehicleForm,
        container: panel,
        status: panel.querySelector('#item-vehicle-status')!,
        fields: vehicleFields(),
        successLabel: 'Vehículo guardado',
        submit: async payload => {
          payload.speedMultiplier = payload.speedMultiplier ?? 1;
          await apiFetch(`/api/items/${encodeURIComponent(row!.name)}/vehiculo`, { method: 'PATCH', body: payload });
        },
      });
    }

    openModal(panel);
  }

  async function renderItemRecipesSection(itemName: string) {
    const container = panel.querySelector<HTMLElement>('#item-recipes-section');
    if (!container) return;

    let recipes: Recipe[], constructionTypes: ConstructionType[];
    try {
      [recipes, constructionTypes] = await Promise.all([
        apiFetch<Recipe[]>(`/api/items/${encodeURIComponent(itemName)}/recipes`),
        apiFetch<ConstructionType[]>('/api/construction-types'),
      ]);
    } catch (err) {
      container.innerHTML = `<p class="hint">❌ ${escapeHtml(err instanceof Error ? err.message : 'Error desconocido.')}</p>`;
      return;
    }
    if (!panel.querySelector('#item-recipes-section')) return;

    const constructionOptions: FieldOption[] = [{ value: '', label: '(ninguna)' }, ...constructionTypes.map(c => ({ value: c.name, label: `${c.emoji ?? '🏗️'} ${c.display_name}` }))];

    const recipesHtml = recipes.length === 0
      ? '<p class="hint">Todavía no tiene ninguna receta de crafteo.</p>'
      : recipes.map((r, i) => {
          const lines = r.ingredients.map(ing => `${escapeHtml(ing.name)} ×${ing.quantity_required}`);
          if (r.laburo_cost > 0) lines.push(`💪 Laburo ×${r.laburo_cost}`);
          if (r.required_construction_type) lines.push(`🏭 ${escapeHtml(r.required_construction_type)}`);
          if (r.tool) lines.push(`🔧 ${escapeHtml(r.tool.display_name)}: -${r.tool_laburo_reduction} Laburo`);
          return `
            <div class="tile-detail-row" data-recipe-id="${r.id}">
              <span class="tile-detail-row-main"><b>Receta #${i + 1}</b><span class="hint">${lines.join(' · ') || '(sin ingredientes ni coste)'}</span></span>
              <button type="button" class="btn-icon btn-delete-recipe" title="Borrar">${icon('trash', { size: 15 })}</button>
            </div>`;
        }).join('');

    const recipeFields: FieldSpec[] = [
      { key: 'recipeLaburoCost', label: 'Coste en Laburo (0 = ninguno)', type: 'number' },
      { key: 'recipeConstruction', label: 'Construcción necesaria', type: 'select', options: constructionOptions },
      { key: 'recipeTool', label: 'Herramienta que abarata el Laburo (opcional)', type: 'select', options: itemOptions(items, [{ value: '', label: '(ninguna)' }]) },
      { key: 'recipeToolReduction', label: 'Laburo que resta esa herramienta (solo si elegiste una arriba)', type: 'number' },
    ];
    const recipeValues: Record<string, unknown> = { recipeLaburoCost: 0 };

    container.innerHTML = `
      <fieldset><legend>Recetas de crafteo</legend>
        <div class="tile-detail-list">${recipesHtml}</div>
      </fieldset>
      <form id="item-new-recipe-form" class="ct-section">
        <fieldset><legend>+ Nueva receta</legend>
          <div id="ingredients-rows"></div>
          <button type="button" id="ingredient-add" class="btn-secondary">+ Añadir ingrediente</button>
          ${recipeFields.map(f => fieldHtml(f, recipeValues[f.key])).join('')}
        </fieldset>
        <button type="submit" class="btn-secondary">Añadir receta</button>
        <p id="item-recipe-status" class="hint" role="status"></p>
      </form>`;

    wireIngredientRows(container);
    container.querySelector<HTMLButtonElement>('#ingredient-add')!.onclick = () => {
      const rows = container.querySelector<HTMLElement>('#ingredients-rows')!;
      const div = document.createElement('div');
      div.innerHTML = ingredientRowHtml(rows.children.length, items);
      rows.appendChild(div.firstElementChild!);
      wireIngredientRows(container);
    };

    container.querySelectorAll<HTMLButtonElement>('.btn-delete-recipe').forEach(btn => {
      btn.onclick = async () => {
        const recipeId = btn.closest<HTMLElement>('[data-recipe-id]')!.dataset.recipeId;
        const ok = await showConfirm({
          title: 'Borrar receta', message: '¿Seguro que quieres borrar esta receta? El ítem en sí no se toca.',
          confirmLabel: 'Borrar', danger: true,
        });
        if (!ok) return;
        try {
          await apiFetch(`/api/recipes/${recipeId}`, { method: 'DELETE' });
          showToast('Receta eliminada.', 'success');
          await renderItemRecipesSection(itemName);
        } catch (err) {
          showToast(err instanceof Error ? err.message : 'Error desconocido.', 'error');
        }
      };
    });

    wireSectionForm({
      form: container.querySelector('#item-new-recipe-form')!,
      container,
      status: container.querySelector('#item-recipe-status')!,
      fields: recipeFields,
      successLabel: 'Receta añadida',
      submit: async payload => {
        const ingredientsResult = readIngredients(container);
        const toolItemName = (payload.recipeTool as string | null) ?? null;
        await apiFetch(`/api/items/${encodeURIComponent(itemName)}/recipes`, {
          method: 'POST',
          body: {
            ingredients: ingredientsResult.rows,
            laboroCost: payload.recipeLaburoCost ?? 0,
            constructionType: payload.recipeConstruction,
            toolItemName,
            toolLaburoReduction: toolItemName ? payload.recipeToolReduction : null,
          },
        });
        showToast(`Receta añadida.${formatRowWarnings(ingredientsResult)}`, 'success');
        await renderItemRecipesSection(itemName);
      },
    });
  }

  newBtn.onclick = () => openItemForm(null);
  renderItemsGroupedByType(items);
  initLiveUpdates('items', reload);
}
