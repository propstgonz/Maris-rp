import { escapeHtml, escapeAttr } from './html';
import { icon } from '../lib/icons';
import type { CatalogItem, EffectType, ItemCategory, NpcType } from '../lib/mapServerApi';

export interface OptionItem { value: string; label: string }

export function itemOptions(items: CatalogItem[], extra: OptionItem[] = []): OptionItem[] {
  return [...extra, ...items.map(i => ({ value: i.name, label: `${i.emoji ?? '📦'} ${i.display_name}` }))];
}

export function weaponItemOptions(items: CatalogItem[], extra: OptionItem[] = []): OptionItem[] {
  return [...extra, ...items.filter(i => i.item_type === 'arma').map(i => ({ value: i.name, label: `${i.emoji ?? '🔫'} ${i.display_name}` }))];
}

export function healItemOptions(items: CatalogItem[], extra: OptionItem[] = []): OptionItem[] {
  return [...extra, ...items.filter(i => i.is_consumable).map(i => ({ value: i.name, label: `${i.emoji ?? '🎒'} ${i.display_name}${i.consume_hp_delta ? ` (+${i.consume_hp_delta} HP)` : ''}` }))];
}

export function mountItemOptions(items: CatalogItem[], extra: OptionItem[] = []): OptionItem[] {
  return [...extra, ...items.filter(i => i.item_type === 'vehiculo').map(i => ({ value: i.name, label: `${i.emoji ?? '🚁'} ${i.display_name}` }))];
}

export function effectOptions(effects: EffectType[], extra: OptionItem[] = []): OptionItem[] {
  return [...extra, ...effects.map(e => ({ value: e.name, label: `${e.emoji ?? '🎭'} ${e.label}` }))];
}

export function categoryOptions(categories: ItemCategory[], extra: OptionItem[] = []): OptionItem[] {
  return [...extra, ...categories.map(c => ({ value: c.name, label: `${c.emoji ?? '🏷️'} ${c.display_name}` }))];
}

export function npcTypeOptions(npcTypes: NpcType[], extra: OptionItem[] = []): OptionItem[] {
  return [...extra, ...npcTypes.map(t => ({ value: t.name, label: `${t.emoji ?? '👤'} ${t.display_name}` }))];
}

export interface RowsResult<T> { rows: T[]; invalidCount: number; duplicateNames: string[] }

function readRows<T extends { name: string }>(
  container: ParentNode,
  selector: string,
  build: (name: string, quantity: number, row: HTMLElement) => T | null
): RowsResult<T> {
  const rows: T[] = [];
  let invalidCount = 0;
  const counts = new Map<string, number>();
  for (const row of container.querySelectorAll<HTMLElement>(selector)) {
    const name = row.querySelector<HTMLSelectElement>('.ing-item')!.value;
    const quantityRaw = row.querySelector<HTMLInputElement>('.ing-qty')!.value.trim();
    if (!name && quantityRaw === '') continue;
    const built = build(name, parseFloat(quantityRaw), row);
    if (!built) { invalidCount++; continue; }
    rows.push(built);
    counts.set(built.name, (counts.get(built.name) ?? 0) + 1);
  }
  const duplicateNames = [...counts.entries()].filter(([, n]) => n > 1).map(([n]) => n);
  return { rows, invalidCount, duplicateNames };
}

export function formatRowWarnings({ invalidCount, duplicateNames }: RowsResult<unknown>): string {
  const parts: string[] = [];
  if (invalidCount > 0) parts.push(`se ${invalidCount === 1 ? 'ignoró 1 fila incompleta' : `ignoraron ${invalidCount} filas incompletas`}`);
  if (duplicateNames.length > 0) parts.push(`ítem repetido: ${duplicateNames.join(', ')}`);
  return parts.length > 0 ? ` ⚠ (${parts.join('; ')})` : '';
}

export function ingredientRowHtml(idx: number, items: CatalogItem[], name = '', quantity: number | string = ''): string {
  const opts = itemOptions(items).map(o => `<option value="${escapeAttr(o.value)}" ${o.value === name ? 'selected' : ''}>${escapeHtml(o.label)}</option>`).join('');
  return `<div class="ingredient-row" data-idx="${idx}">
    <select class="ing-item"><option value="">— ítem —</option>${opts}</select>
    <input type="number" class="ing-qty" placeholder="Cantidad" step="any" min="0" required value="${quantity}">
    <button type="button" class="btn-icon ing-remove" title="Quitar">${icon('x', { size: 15 })}</button>
  </div>`;
}

export function ingredientsSectionHtml(ingredients: { name: string; quantity_required?: number; quantity?: number }[], items: CatalogItem[]): string {
  const rows = ingredients.map((ing, i) => ingredientRowHtml(i, items, ing.name, ing.quantity_required ?? ing.quantity)).join('');
  return `<div id="ingredients-rows">${rows}</div><button type="button" class="btn-secondary" data-ingredient-add>+ Añadir ingrediente</button>`;
}

export function wireIngredientRows(container: ParentNode) {
  container.querySelectorAll<HTMLButtonElement>('.ing-remove').forEach(btn => {
    btn.onclick = () => btn.closest('.ingredient-row')?.remove();
  });
}

export function readIngredients(container: ParentNode): RowsResult<{ name: string; quantity: number }> {
  return readRows(container, '#ingredients-rows .ingredient-row', (name, quantity) =>
    name && quantity > 0 ? { name, quantity } : null
  );
}

export function wireIngredientAdd(container: HTMLElement, items: CatalogItem[]) {
  const addBtn = container.querySelector<HTMLButtonElement>('[data-ingredient-add]');
  if (!addBtn) return;
  addBtn.onclick = () => {
    const rows = container.querySelector<HTMLElement>('#ingredients-rows')!;
    const div = document.createElement('div');
    div.innerHTML = ingredientRowHtml(rows.children.length, items);
    rows.appendChild(div.firstElementChild!);
    wireIngredientRows(container);
  };
}

export function dropRowHtml(idx: number, items: CatalogItem[], name = '', quantity: number | string = '', chancePercent: number | string = 100): string {
  const opts = itemOptions(items).map(o => `<option value="${escapeAttr(o.value)}" ${o.value === name ? 'selected' : ''}>${escapeHtml(o.label)}</option>`).join('');
  return `<div class="ingredient-row" data-idx="${idx}">
    <select class="ing-item"><option value="">— ítem —</option>${opts}</select>
    <input type="number" class="ing-qty" placeholder="Cantidad" step="any" min="0" required value="${quantity}">
    <input type="number" class="ing-chance" placeholder="% caída" min="0" max="100" step="any" value="${chancePercent}">
    <button type="button" class="btn-icon ing-remove" title="Quitar">${icon('x', { size: 15 })}</button>
  </div>`;
}

export function dropsSectionHtml(drops: { name: string; quantity: number; drop_chance_percent: number }[], items: CatalogItem[]): string {
  const rows = drops.map((d, i) => dropRowHtml(i, items, d.name, d.quantity, d.drop_chance_percent)).join('');
  return `<div id="drops-rows">${rows}</div><button type="button" class="btn-secondary" data-drop-add>+ Añadir botín</button>`;
}

export function readDrops(container: ParentNode): RowsResult<{ name: string; quantity: number; dropChancePercent: number }> {
  return readRows(container, '#drops-rows .ingredient-row', (name, quantity, row) => {
    if (!name || !(quantity > 0)) return null;
    const chanceRaw = row.querySelector<HTMLInputElement>('.ing-chance')!.value.trim();
    const dropChancePercent = chanceRaw === '' ? 100 : parseFloat(chanceRaw);
    if (Number.isNaN(dropChancePercent) || dropChancePercent < 0 || dropChancePercent > 100) return null;
    return { name, quantity, dropChancePercent };
  });
}

export function wireDropAdd(container: HTMLElement, items: CatalogItem[]) {
  const addBtn = container.querySelector<HTMLButtonElement>('[data-drop-add]');
  if (!addBtn) return;
  addBtn.onclick = () => {
    const rows = container.querySelector<HTMLElement>('#drops-rows')!;
    const div = document.createElement('div');
    div.innerHTML = dropRowHtml(rows.children.length, items);
    rows.appendChild(div.firstElementChild!);
    wireIngredientRows(container);
  };
}

export function equipmentRowHtml(idx: number, items: CatalogItem[], name = '', quantity: number | string = ''): string {
  const opts = itemOptions(items).map(o => `<option value="${escapeAttr(o.value)}" ${o.value === name ? 'selected' : ''}>${escapeHtml(o.label)}</option>`).join('');
  return `<div class="ingredient-row" data-idx="${idx}">
    <select class="ing-item"><option value="">— ítem —</option>${opts}</select>
    <input type="number" class="ing-qty" placeholder="Cantidad" step="any" min="0" required value="${quantity}">
    <button type="button" class="btn-icon ing-remove" title="Quitar">${icon('x', { size: 15 })}</button>
  </div>`;
}

export function equipmentSectionHtml(equipment: { name: string; quantity: number }[], items: CatalogItem[]): string {
  const rows = equipment.map((e, i) => equipmentRowHtml(i, items, e.name, e.quantity)).join('');
  return `<div id="equipment-rows">${rows}</div><button type="button" class="btn-secondary" data-equipment-add>+ Añadir equipo</button>
    <p class="hint">Lo que hace falta tener en el almacén de la facción para reclutar uno — se descuenta de ahí al reclutar. Vacío = gratis.</p>`;
}

export function readEquipment(container: ParentNode): RowsResult<{ name: string; quantity: number }> {
  return readRows(container, '#equipment-rows .ingredient-row', (name, quantity) =>
    name && quantity > 0 ? { name, quantity } : null
  );
}

export function wireEquipmentAdd(container: HTMLElement, items: CatalogItem[]) {
  const addBtn = container.querySelector<HTMLButtonElement>('[data-equipment-add]');
  if (!addBtn) return;
  addBtn.onclick = () => {
    const rows = container.querySelector<HTMLElement>('#equipment-rows')!;
    const div = document.createElement('div');
    div.innerHTML = equipmentRowHtml(rows.children.length, items);
    rows.appendChild(div.firstElementChild!);
    wireIngredientRows(container);
  };
}

export function groupMemberRowHtml(idx: number, npcTypes: NpcType[], name = '', quantity: number | string = 1): string {
  const opts = npcTypeOptions(npcTypes).map(o => `<option value="${escapeAttr(o.value)}" ${o.value === name ? 'selected' : ''}>${escapeHtml(o.label)}</option>`).join('');
  return `<div class="ingredient-row" data-idx="${idx}">
    <select class="ing-item"><option value="">— tipo de NPC —</option>${opts}</select>
    <input type="number" class="ing-qty" placeholder="Cantidad" step="1" min="1" required value="${quantity}">
    <button type="button" class="btn-icon ing-remove" title="Quitar">${icon('x', { size: 15 })}</button>
  </div>`;
}

export function groupMembersSectionHtml(members: { name: string; quantity: number }[], npcTypes: NpcType[]): string {
  const rows = members.map((m, i) => groupMemberRowHtml(i, npcTypes, m.name, m.quantity)).join('');
  return `<div id="group-member-rows">${rows}</div><button type="button" class="btn-secondary" data-group-member-add>+ Añadir tipo de NPC</button>`;
}

export function readGroupMembers(container: ParentNode): RowsResult<{ name: string; quantity: number }> {
  return readRows(container, '#group-member-rows .ingredient-row', (name, quantity) =>
    name && quantity > 0 ? { name, quantity: Math.trunc(quantity) } : null
  );
}

export function wireGroupMemberAdd(container: HTMLElement, npcTypes: NpcType[]) {
  const addBtn = container.querySelector<HTMLButtonElement>('[data-group-member-add]');
  if (!addBtn) return;
  addBtn.onclick = () => {
    const rows = container.querySelector<HTMLElement>('#group-member-rows')!;
    const div = document.createElement('div');
    div.innerHTML = groupMemberRowHtml(rows.children.length, npcTypes);
    rows.appendChild(div.firstElementChild!);
    wireIngredientRows(container);
  };
}

export interface SpawnScopeOption { name: string; emoji?: string | null; display_name: string }
export interface SpawnScopeRow { name: string; spawn_chance_override_percent: number | null }

const SPAWN_HINT: Record<string, string> = {
  terrain: 'Ninguno marcado = puede aparecer en cualquier terreno, con el % general. Marcado = restringido a esos terrenos; cada uno puede fijar su propio % (vacío = usa el general).',
  zone: 'Ninguna marcada = puede aparecer en cualquier zona, y también fuera de toda zona. Marcada = solo aparece en esas zonas, y además debe cumplirse el filtro de terreno; el % de la zona manda sobre el del terreno.',
};

export function spawnCheckboxesHtml(kind: 'terrain' | 'zone', options: SpawnScopeOption[], selected: SpawnScopeRow[]): string {
  const byName = new Map(selected.map(t => [t.name, t]));
  const boxes = options.map(t => {
    const hit = byName.get(t.name);
    const overrideValue = hit?.spawn_chance_override_percent ?? '';
    return `
    <div class="npc-terrain-row" data-spawn-row="${kind}">
      <label class="field-check">
        <input type="checkbox" class="npc-terrain-cb" value="${escapeAttr(t.name)}" ${hit ? 'checked' : ''}>
        ${escapeHtml(t.emoji ?? '')} ${escapeHtml(t.display_name)}
      </label>
      <input type="number" class="npc-terrain-override" step="any" min="0" max="100" placeholder="% aquí (vacío = general)" value="${overrideValue}" ${hit ? '' : 'disabled'}>
    </div>`;
  }).join('');
  return `<div class="npc-terrain-grid">${boxes}</div>
    <p class="hint">${SPAWN_HINT[kind]}</p>`;
}

export function wireSpawnCheckboxes(container: ParentNode, kind: 'terrain' | 'zone') {
  container.querySelectorAll<HTMLElement>(`[data-spawn-row="${kind}"]`).forEach(row => {
    const cb = row.querySelector<HTMLInputElement>('.npc-terrain-cb')!;
    const override = row.querySelector<HTMLInputElement>('.npc-terrain-override')!;
    cb.addEventListener('change', () => { override.disabled = !cb.checked; if (!cb.checked) override.value = ''; });
  });
}

export function readSpawnCheckboxes(container: ParentNode, kind: 'terrain' | 'zone'): { name: string; overridePercent: number | null }[] {
  const rows = [...container.querySelectorAll<HTMLElement>(`[data-spawn-row="${kind}"]`)];
  return rows.flatMap(row => {
    const cb = row.querySelector<HTMLInputElement>('.npc-terrain-cb')!;
    if (!cb.checked) return [];
    const overrideRaw = row.querySelector<HTMLInputElement>('.npc-terrain-override')!.value.trim();
    return [{ name: cb.value, overridePercent: overrideRaw === '' ? null : Number(overrideRaw) }];
  });
}
