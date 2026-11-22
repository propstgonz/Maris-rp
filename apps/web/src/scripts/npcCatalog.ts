import { escapeHtml, escapeAttr } from './html';
import { icon } from '../lib/icons';
import { renderAdminTable } from './adminTable';
import { deleteCatalogRow, wireSectionForm } from './catalogModal';
import { fieldHtml, wireFieldDependencies, type FieldSpec } from '../lib/formFields';
import {
  weaponItemOptions, healItemOptions, mountItemOptions, itemOptions, spawnCheckboxesHtml, wireSpawnCheckboxes, readSpawnCheckboxes,
  dropsSectionHtml, readDrops, wireIngredientRows, wireDropAdd,
  equipmentSectionHtml, readEquipment, wireEquipmentAdd, formatRowWarnings,
  groupMembersSectionHtml, readGroupMembers, wireGroupMemberAdd,
} from './catalogWidgets';
import { openModal, closeAllModals, showToast } from './ui';
import { apiFetch } from './api';
import { initLiveUpdates } from './liveUpdates';
import type { NpcType, CatalogItem, TerrainType, Zone, IntegrityFinding, NpcGroupType, Faction } from '../lib/mapServerApi';
import { formatWarnings } from './worldHealth';

function npcIdentityFields(isEdit: boolean, items: CatalogItem[], factions: Faction[]): FieldSpec[] {
  return [
    { key: 'name', label: 'Nombre clave', type: 'text', disabled: isEdit, required: !isEdit },
    { key: 'displayName', label: 'Nombre para mostrar', type: 'text', required: true },
    { key: 'emoji', label: 'Emoji', type: 'text' },
    { key: 'description', label: 'Descripción', type: 'textarea' },
    { key: 'factionName', label: 'Facción a la que pertenece (los jugadores la ven al encontrárselo)', type: 'select', options: [{ value: '', label: '(sin facción)' }, ...factions.map(f => ({ value: f.name, label: `${f.emoji ?? ''} ${f.display_name}${f.is_npc ? ' (NPC)' : ''}`.trim() }))] },
    { key: 'maxHp', label: 'Vida máxima', type: 'number' },
    { key: 'weaponItemName', label: 'Arma principal (siempre preferida si llega a la distancia — para un jinete/pirata pon aquí la de cuerpo a cuerpo)', type: 'select', options: weaponItemOptions(items, [{ value: '', label: '(desarmado)' }]) },
    { key: 'secondaryWeaponItemName', label: 'Arma secundaria — de respaldo, solo entra si la principal no llega (pon aquí la de alcance)', type: 'select', options: weaponItemOptions(items, [{ value: '', label: '(ninguna)' }]) },
    { key: 'mountItemName', label: 'Montura (ítem tipo Vehículo — da su bonus de vida/daño a TODO NPC de este tipo)', type: 'select', options: mountItemOptions(items, [{ value: '', label: '(a pie)' }]) },
    { key: 'healItemName', label: 'Ítem de curación (en vez de atacar, se cura o cura a un aliado de su mismo grupo cuando alguno está bajo de vida)', type: 'select', options: healItemOptions(items, [{ value: '', label: '(no cura)' }]) },
    { key: 'healThresholdPercent', label: '% de vida a partir del cual cura (solo aplica con ítem de curación elegido arriba)', type: 'number' },
    { key: 'spawnChancePercent', label: '% de aparición aleatoria (cada minuto viajando, ver terrenos para % por terreno)', type: 'number' },
    { key: 'isAggressive', label: '⚔️ Agresivo (pausa el viaje del jugador — sin esto, el encuentro es informativo y no bloquea nada)', type: 'checkbox' },
    { key: 'fleeChancePercent', label: '% de éxito al huir (solo aplica si es agresivo)', type: 'number', dependsOn: 'isAggressive' },
    { key: 'isRecruitable', label: '🚩 Reclutable (aparece en /build reclutar de una oficina de reclutamiento, pagado con el almacén de la facción)', type: 'checkbox' },
    { key: 'canProduce', label: '⚙️ Puede ser Productor (el jugador le asigna una herramienta con /npc equipar — qué produce y a qué ritmo lo decide ESA herramienta, no este tipo)', type: 'checkbox' },
    { key: 'canSoldier', label: '⚔️ Puede ser Soldado (defiende su casilla solo — el jugador le asigna un arma con /npc equipar)', type: 'checkbox' },
    { key: 'productionIntervalHours', label: 'Horas por ciclo de producción (solo aplica en rol Productor)', type: 'number' },
    { key: 'maxAccrualHours', label: 'Tope de horas acumulables sin recoger', type: 'number' },
    { key: 'theftChancePercent', label: '🤏 % de éxito al robarle (/robar, solo aplica si NO es agresivo)', type: 'number' },
    { key: 'tradeMarginPercent', label: '🤝 Margen de trueque (/comerciar) — % del valor pedido que exige como mínimo de lo ofrecido; 100 = trato justo, más alto = más avaro', type: 'number' },
    { key: 'surrenderChancePercent', label: '🏳️ % de perdonarte si te rindes (solo aplica si es agresivo)', type: 'number', dependsOn: 'isAggressive' },
    { key: 'isTameable', label: '🐾 Domesticable (/domesticar)', type: 'checkbox' },
    { key: 'tameChancePercent', label: '% de éxito al domesticar', type: 'number', dependsOn: 'isTameable' },
    { key: 'tameBaitItemName', label: 'Cebo necesario para domesticar (se consume en cada intento, acierte o no)', type: 'select', options: itemOptions(items, [{ value: '', label: '(ninguno)' }]), dependsOn: 'isTameable' },
    { key: 'vehicleCategory', label: '🐎 Categoría como montura (si un jugador lo domestica y lo monta con /montura, cuenta como vehículo de esta categoría)', type: 'select', options: [{ value: '', label: '(no sirve de montura)' }, { value: 'terrestre', label: 'Terrestre' }, { value: 'maritimo', label: 'Marítimo' }, { value: 'aereo', label: 'Aéreo' }] },
    { key: 'vehicleSpeedMultiplier', label: 'Multiplicador de velocidad como montura', type: 'number' },
    { key: 'breedChancePercent', label: '🐣 % de éxito al criar (/criar, dos domesticados del mismo tipo)', type: 'number' },
  ];
}

function groupTypeFields(isEdit: boolean): FieldSpec[] {
  return [
    { key: 'name', label: 'Nombre clave', type: 'text', disabled: isEdit, required: !isEdit },
    { key: 'displayName', label: 'Nombre para mostrar', type: 'text', required: true },
    { key: 'emoji', label: 'Emoji', type: 'text' },
    { key: 'description', label: 'Descripción', type: 'textarea' },
    { key: 'spawnChancePercent', label: '% de aparición aleatoria (cada minuto viajando, ver terrenos para % por terreno)', type: 'number' },
    { key: 'isAggressive', label: '⚔️ Agresivo (pausa el viaje hasta acabar con el grupo entero — sin esto, el encuentro es informativo y no bloquea nada)', type: 'checkbox' },
    { key: 'fleeChancePercent', label: '% de éxito al huir del grupo entero (solo aplica si es agresivo)', type: 'number', dependsOn: 'isAggressive' },
    { key: 'surrenderChancePercent', label: '🏳️ % de perdonarte si te rindes ante el grupo entero (solo aplica si es agresivo)', type: 'number', dependsOn: 'isAggressive' },
  ];
}

export function initNpcCatalog(root: HTMLElement, initialNpcs: NpcType[], items: CatalogItem[], terrainTypes: TerrainType[], zones: Zone[] = [], initialGroupTypes: NpcGroupType[] = [], factions: Faction[] = []) {
  const table = root.querySelector<HTMLElement>('[data-npcs-table]')!;
  const panel = root.querySelector<HTMLElement>('[data-npcs-form-panel]')!;
  const newBtn = root.querySelector<HTMLButtonElement>('[data-npcs-new-btn]')!;
  const groupsBtn = root.querySelector<HTMLButtonElement>('[data-npc-groups-btn]')!;
  const groupsPanel = root.querySelector<HTMLElement>('[data-npc-groups-panel]')!;
  let groupTypes = initialGroupTypes;

  async function reload() {
    const [rows, groups] = await Promise.all([
      apiFetch<NpcType[]>('/api/npc-types'),
      apiFetch<NpcGroupType[]>('/api/npc-group-types'),
    ]);
    groupTypes = groups;
    renderTable(rows);
  }

  function renderTable(rows: NpcType[]) {
    renderAdminTable(table, {
      columns: [
        { key: 'emoji', label: '' },
        { key: 'display_name', label: 'Nombre' },
        { key: 'name', label: 'Clave' },
        { key: 'max_hp', label: 'Vida' },
        { key: 'spawn_chance_percent', label: '% aparición/min' },
        { key: 'terrains', label: 'Terrenos', render: r => r.terrains.map(t => t.emoji ?? t.name).join(' ') || 'Cualquiera' },
        { key: 'zones', label: 'Zonas', render: r => (r.zones ?? []).map(z => z.emoji ?? z.name).join(' ') || 'Cualquiera' },
        { key: 'faction_id', label: 'Facción', render: r => escapeHtml(factions.find(f => f.id === r.faction_id)?.display_name ?? '—') },
        { key: 'kit', label: 'Equipo', render: r => [
          r.secondary_weapon_item_id ? `🗡️ ${escapeHtml(items.find(i => i.id === r.secondary_weapon_item_id)?.display_name ?? '?')}` : '',
          r.heal_item_id ? `💊 ${escapeHtml(items.find(i => i.id === r.heal_item_id)?.display_name ?? '?')} (≤${r.heal_threshold_percent}%)` : '',
          r.mount_item_id ? `🐎 ${escapeHtml(items.find(i => i.id === r.mount_item_id)?.display_name ?? '?')}` : '',
        ].filter(Boolean).join(' · ') || '—' },
      ],
      rows,
      onEdit: row => openNpcForm(row),
      onDelete: row => deleteCatalogRow('npc-types', row, reload),
    });
  }

  const RECRUIT_FIELD_KEYS = ['isRecruitable', 'canProduce', 'canSoldier', 'productionIntervalHours', 'maxAccrualHours'];

  function openNpcForm(row: NpcType | null) {
    const isEdit = Boolean(row);
    const idFields = npcIdentityFields(isEdit, items, factions);
    const creatableIdFields = idFields.filter(f => !RECRUIT_FIELD_KEYS.includes(f.key));
    const idValues: Record<string, unknown> = row
      ? {
          name: row.name, displayName: row.display_name, emoji: row.emoji, description: row.description,
          maxHp: row.max_hp, spawnChancePercent: row.spawn_chance_percent,
          weaponItemName: items.find(i => i.id === row.weapon_item_id)?.name ?? '',
          secondaryWeaponItemName: items.find(i => i.id === row.secondary_weapon_item_id)?.name ?? '',
          healItemName: items.find(i => i.id === row.heal_item_id)?.name ?? '',
          healThresholdPercent: row.heal_threshold_percent,
          mountItemName: items.find(i => i.id === row.mount_item_id)?.name ?? '',
          isAggressive: !!row.is_aggressive, fleeChancePercent: row.flee_chance_percent,
          isRecruitable: !!row.is_recruitable, canProduce: !!row.can_produce, canSoldier: !!row.can_soldier,
          productionIntervalHours: row.production_interval_hours, maxAccrualHours: row.max_accrual_hours,
          theftChancePercent: row.theft_chance_percent, tradeMarginPercent: row.trade_margin_percent,
          surrenderChancePercent: row.surrender_chance_percent,
          isTameable: !!row.is_tameable, tameChancePercent: row.tame_chance_percent,
          tameBaitItemName: items.find(i => i.id === row.tame_bait_item_id)?.name ?? '',
          vehicleCategory: row.vehicle_category ?? '', vehicleSpeedMultiplier: row.vehicle_speed_multiplier,
          breedChancePercent: row.breed_chance_percent,
          factionName: factions.find(f => f.id === row.faction_id)?.name ?? '',
        }
      : {
          emoji: '👤', maxHp: 5, spawnChancePercent: 0, isAggressive: false, fleeChancePercent: 100,
          healThresholdPercent: 50,
          isRecruitable: false, productionIntervalHours: 24, maxAccrualHours: 48,
          theftChancePercent: 50, tradeMarginPercent: 100, surrenderChancePercent: 50,
          isTameable: false, tameChancePercent: 50, vehicleSpeedMultiplier: 1, breedChancePercent: 50,
        };

    if (!isEdit) {
      panel.innerHTML = `
        <div class="form-header"><h3>Nuevo NPC</h3><button type="button" class="btn-icon modal-close" aria-label="Cerrar">${icon('x', { size: 15 })}</button></div>
        <form id="npc-create-form">
          <fieldset><legend>Identidad</legend>${creatableIdFields.map(f => fieldHtml(f, idValues[f.key])).join('')}</fieldset>
          <fieldset><legend>Terrenos donde aparece</legend>${spawnCheckboxesHtml('terrain', terrainTypes, [])}</fieldset>
          <fieldset><legend>Zonas donde aparece</legend>${spawnCheckboxesHtml('zone', zones, [])}</fieldset>
          <fieldset><legend>Botín al morir</legend>${dropsSectionHtml([], items)}</fieldset>
          <button type="submit" class="btn-primary">Crear NPC</button>
          <p id="npc-status" class="hint" role="status"></p>
          <p class="hint">¿Va a ser reclutable? Termina de crearlo aquí y configura el resto (Laburo/recurso, equipo requerido…) editándolo después.</p>
        </form>`;
      panel.querySelector<HTMLButtonElement>('.modal-close')!.onclick = () => closeAllModals();
      wireIngredientRows(panel);
      wireFieldDependencies(panel);
      wireSpawnCheckboxes(panel, 'terrain');
    wireSpawnCheckboxes(panel, 'zone');
      wireDropAdd(panel, items);
      wireSectionForm({
        form: panel.querySelector('#npc-create-form')!,
        container: panel,
        status: panel.querySelector('#npc-status')!,
        fields: creatableIdFields,
        successLabel: 'Creado',
        submit: async payload => {
          payload.terrains = readSpawnCheckboxes(panel, 'terrain');
          payload.zones = readSpawnCheckboxes(panel, 'zone');
          const dropsResult = readDrops(panel);
          payload.drops = dropsResult.rows;
          await apiFetch('/api/npc-types', { method: 'POST', body: payload });
          await reload();
          return formatRowWarnings(dropsResult);
        },
      });
      openModal(panel);
      return;
    }

    panel.innerHTML = `
      <div class="form-header"><h3>Editar NPC: ${escapeHtml(row!.display_name)}</h3><button type="button" class="btn-icon modal-close" aria-label="Cerrar">${icon('x', { size: 15 })}</button></div>
      <div class="ct-section">
        <fieldset><legend>${icon('image', { size: 14 })} Imagen (grid de miniaturas del mapa y confirmaciones de Discord)</legend>
          <div class="avatar-upload">
            <img id="npc-image-preview" class="item-image-preview" src="${escapeAttr(row!.image_url ?? '/static/default-avatar.svg')}" alt="">
            <input type="file" id="npc-image-input" accept="image/png,image/jpeg,image/webp,image/gif">
          </div>
          <p id="npc-image-status" class="hint"></p>
        </fieldset>
      </div>
      <form id="npc-identity-form" class="ct-section">
        <fieldset><legend>Identidad</legend>${idFields.map(f => fieldHtml(f, idValues[f.key])).join('')}</fieldset>
        <button type="submit" class="btn-secondary">Guardar identidad</button>
        <p id="npc-identity-status" class="hint" role="status"></p>
      </form>
      <form id="npc-terrains-form" class="ct-section">
        <fieldset><legend>Terrenos donde aparece</legend>${spawnCheckboxesHtml('terrain', terrainTypes, row!.terrains)}</fieldset>
        <button type="submit" class="btn-secondary">Guardar terrenos</button>
        <p id="npc-terrains-status" class="hint" role="status"></p>
      </form>
      <form id="npc-zones-form" class="ct-section">
        <fieldset><legend>Zonas donde aparece</legend>${spawnCheckboxesHtml('zone', zones, row!.zones ?? [])}</fieldset>
        <button type="submit" class="btn-secondary">Guardar zonas</button>
        <p id="npc-zones-status" class="hint" role="status"></p>
      </form>
      <form id="npc-drops-form" class="ct-section">
        <fieldset><legend>Botín al morir</legend>${dropsSectionHtml(row!.drops, items)}</fieldset>
        <button type="submit" class="btn-secondary">Guardar botín</button>
        <p id="npc-drops-status" class="hint" role="status"></p>
      </form>
      <form id="npc-equipment-form" class="ct-section">
        <fieldset><legend>Equipo requerido para reclutar</legend>${equipmentSectionHtml(row!.equipment, items)}</fieldset>
        <button type="submit" class="btn-secondary">Guardar equipo</button>
        <p id="npc-equipment-status" class="hint" role="status"></p>
      </form>`;

    panel.querySelector<HTMLButtonElement>('.modal-close')!.onclick = () => closeAllModals();
    wireIngredientRows(panel);
    wireFieldDependencies(panel);
    wireSpawnCheckboxes(panel, 'terrain');
    wireSpawnCheckboxes(panel, 'zone');
    wireDropAdd(panel, items);
    wireEquipmentAdd(panel, items);

    panel.querySelector<HTMLInputElement>('#npc-image-input')!.addEventListener('change', async evt => {
      const file = (evt.target as HTMLInputElement).files?.[0];
      if (!file) return;
      const imageStatus = panel.querySelector<HTMLElement>('#npc-image-status')!;
      imageStatus.textContent = 'Subiendo…';
      const formData = new FormData();
      formData.append('imagen', file);
      try {
        const body = await apiFetch<{ image_url: string }>(`/api/npc-types/${encodeURIComponent(row!.name)}/image`, { method: 'POST', body: formData });
        panel.querySelector<HTMLImageElement>('#npc-image-preview')!.src = `${body.image_url}?t=${Date.now()}`;
        imageStatus.textContent = '✅ Imagen actualizada.';
        showToast('Imagen del NPC actualizada.', 'success');
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Error desconocido.';
        imageStatus.textContent = `❌ ${message}`;
        showToast(message, 'error');
      } finally {
        (evt.target as HTMLInputElement).value = '';
      }
    });

    wireSectionForm({
      form: panel.querySelector('#npc-identity-form')!,
      container: panel,
      status: panel.querySelector('#npc-identity-status')!,
      fields: idFields,
      successLabel: 'Identidad guardada',
      submit: async payload => {
        const result = await apiFetch<{ warnings?: IntegrityFinding[] }>(`/api/npc-types/${encodeURIComponent(row!.name)}`, { method: 'PATCH', body: payload });
        await reload();
        return formatWarnings(result.warnings);
      },
    });

    wireSectionForm({
      form: panel.querySelector('#npc-terrains-form')!,
      container: panel,
      status: panel.querySelector('#npc-terrains-status')!,
      fields: [],
      successLabel: 'Terrenos guardados',
      submit: async () => {
        const terrains = readSpawnCheckboxes(panel, 'terrain');
        await apiFetch(`/api/npc-types/${encodeURIComponent(row!.name)}/terrains`, { method: 'PATCH', body: { terrains } });
      },
    });

    wireSectionForm({
      form: panel.querySelector('#npc-zones-form')!,
      container: panel,
      status: panel.querySelector('#npc-zones-status')!,
      fields: [],
      successLabel: 'Zonas guardadas',
      submit: async () => {
        const zonesPayload = readSpawnCheckboxes(panel, 'zone');
        await apiFetch(`/api/npc-types/${encodeURIComponent(row!.name)}/zones`, { method: 'PATCH', body: { zones: zonesPayload } });
      },
    });

    wireSectionForm({
      form: panel.querySelector('#npc-drops-form')!,
      container: panel,
      status: panel.querySelector('#npc-drops-status')!,
      fields: [],
      successLabel: 'Botín guardado',
      submit: async () => {
        const dropsResult = readDrops(panel);
        await apiFetch(`/api/npc-types/${encodeURIComponent(row!.name)}/drops`, { method: 'PATCH', body: { drops: dropsResult.rows } });
        return formatRowWarnings(dropsResult);
      },
    });

    wireSectionForm({
      form: panel.querySelector('#npc-equipment-form')!,
      container: panel,
      status: panel.querySelector('#npc-equipment-status')!,
      fields: [],
      successLabel: 'Equipo guardado',
      submit: async () => {
        const equipmentResult = readEquipment(panel);
        await apiFetch(`/api/npc-types/${encodeURIComponent(row!.name)}/equipment`, { method: 'PATCH', body: { equipment: equipmentResult.rows } });
        return formatRowWarnings(equipmentResult);
      },
    });

    openModal(panel);
  }

  function renderGroupsList() {
    groupsPanel.innerHTML = `
      <div class="form-header"><h3>${icon('users', { size: 16 })} Grupos de NPC</h3><button type="button" class="btn-icon modal-close" aria-label="Cerrar">${icon('x', { size: 15 })}</button></div>
      <button type="button" class="btn-primary" id="group-new-btn">+ Nuevo grupo</button>
      <div id="groups-table" class="admin-table-wrap"></div>`;
    groupsPanel.querySelector<HTMLButtonElement>('.modal-close')!.onclick = () => closeAllModals();
    groupsPanel.querySelector<HTMLButtonElement>('#group-new-btn')!.onclick = () => renderGroupForm(null);
    renderAdminTable(groupsPanel.querySelector<HTMLElement>('#groups-table')!, {
      columns: [
        { key: 'emoji' as const, label: '' },
        { key: 'display_name' as const, label: 'Nombre' },
        { key: 'name' as const, label: 'Clave' },
        { key: 'members' as const, label: 'Composición', render: (g: NpcGroupType) => g.members.map(m => `${m.quantity}× ${escapeHtml(m.display_name)}`).join(', ') || '(vacío)' },
        { key: 'spawn_chance_percent' as const, label: '% aparición/min' },
        { key: 'terrains' as const, label: 'Terrenos', render: (g: NpcGroupType) => (g.terrains ?? []).map(t => t.emoji ?? t.name).join(' ') || 'Cualquiera' },
        { key: 'zones' as const, label: 'Zonas', render: (g: NpcGroupType) => (g.zones ?? []).map(z => z.emoji ?? z.name).join(' ') || 'Cualquiera' },
      ],
      rows: groupTypes,
      onEdit: row => renderGroupForm(row),
      onDelete: row => deleteCatalogRow('npc-group-types', row, async () => { await reload(); renderGroupsList(); }),
    });
  }

  function renderGroupForm(row: NpcGroupType | null) {
    const isEdit = Boolean(row);
    const fields = groupTypeFields(isEdit);
    const values: Record<string, unknown> = row
      ? {
          name: row.name, displayName: row.display_name, emoji: row.emoji, description: row.description,
          spawnChancePercent: row.spawn_chance_percent, isAggressive: !!row.is_aggressive, fleeChancePercent: row.flee_chance_percent,
          surrenderChancePercent: row.surrender_chance_percent,
        }
      : { emoji: '👥', spawnChancePercent: 0, isAggressive: false, fleeChancePercent: 100, surrenderChancePercent: 50 };

    groupsPanel.innerHTML = `
      <div class="form-header"><h3>${isEdit ? `Editar grupo: ${escapeHtml(row!.display_name)}` : 'Nuevo grupo'}</h3><button type="button" class="btn-icon modal-close" aria-label="Cerrar">${icon('x', { size: 15 })}</button></div>
      <button type="button" class="btn-secondary" id="group-back-btn">${icon('chevron-left', { size: 13 })} Volver a la lista</button>
      <form id="group-identity-form" class="ct-section">
        <fieldset><legend>Identidad</legend>${fields.map(f => fieldHtml(f, values[f.key])).join('')}</fieldset>
        <button type="submit" class="btn-primary">${isEdit ? 'Guardar identidad' : 'Crear grupo'}</button>
        <p id="group-identity-status" class="hint" role="status"></p>
      </form>
      ${isEdit ? `
      <form id="group-members-form" class="ct-section">
        <fieldset><legend>Composición</legend>${groupMembersSectionHtml(row!.members, initialNpcs)}</fieldset>
        <button type="submit" class="btn-secondary">Guardar composición</button>
        <p id="group-members-status" class="hint" role="status"></p>
      </form>
      <form id="group-terrains-form" class="ct-section">
        <fieldset><legend>Terrenos donde aparece</legend>${spawnCheckboxesHtml('terrain', terrainTypes, row!.terrains ?? [])}</fieldset>
        <button type="submit" class="btn-secondary">Guardar terrenos</button>
        <p id="group-terrains-status" class="hint" role="status"></p>
      </form>
      <form id="group-zones-form" class="ct-section">
        <fieldset><legend>Zonas donde aparece</legend>${spawnCheckboxesHtml('zone', zones, row!.zones ?? [])}</fieldset>
        <button type="submit" class="btn-secondary">Guardar zonas</button>
        <p id="group-zones-status" class="hint" role="status"></p>
      </form>` : `
      <div class="ct-section">
        <fieldset><legend>Composición inicial</legend>${groupMembersSectionHtml([], initialNpcs)}</fieldset>
      </div>
      <div class="ct-section">
        <fieldset><legend>Terrenos donde aparece</legend>${spawnCheckboxesHtml('terrain', terrainTypes, [])}</fieldset>
      </div>
      <div class="ct-section">
        <fieldset><legend>Zonas donde aparece</legend>${spawnCheckboxesHtml('zone', zones, [])}</fieldset>
      </div>`}`;

    groupsPanel.querySelector<HTMLButtonElement>('.modal-close')!.onclick = () => closeAllModals();
    groupsPanel.querySelector<HTMLButtonElement>('#group-back-btn')!.onclick = () => renderGroupsList();
    wireFieldDependencies(groupsPanel);
    wireIngredientRows(groupsPanel);
    wireGroupMemberAdd(groupsPanel, initialNpcs);
    wireSpawnCheckboxes(groupsPanel, 'terrain');
    wireSpawnCheckboxes(groupsPanel, 'zone');

    wireSectionForm({
      form: groupsPanel.querySelector('#group-identity-form')!,
      container: groupsPanel,
      status: groupsPanel.querySelector('#group-identity-status')!,
      fields,
      successLabel: isEdit ? 'Identidad guardada' : 'Grupo creado',
      submit: async payload => {
        if (isEdit) {
          await apiFetch(`/api/npc-group-types/${encodeURIComponent(row!.name)}`, { method: 'PATCH', body: payload });
          await reload();
          showToast('Grupo guardado.', 'success');
          renderGroupsList();
        } else {
          const membersResult = readGroupMembers(groupsPanel);
          payload.members = membersResult.rows;
          payload.terrains = readSpawnCheckboxes(groupsPanel, 'terrain');
          payload.zones = readSpawnCheckboxes(groupsPanel, 'zone');
          await apiFetch('/api/npc-group-types', { method: 'POST', body: payload });
          await reload();
          showToast(`Grupo creado.${formatRowWarnings(membersResult)}`, 'success');
          renderGroupsList();
        }
      },
    });

    const membersForm = groupsPanel.querySelector<HTMLFormElement>('#group-members-form');
    if (membersForm) {
      wireSectionForm({
        form: membersForm,
        container: groupsPanel,
        status: groupsPanel.querySelector('#group-members-status')!,
        fields: [],
        successLabel: 'Composición guardada',
        submit: async () => {
          const membersResult = readGroupMembers(groupsPanel);
          await apiFetch(`/api/npc-group-types/${encodeURIComponent(row!.name)}/members`, { method: 'PATCH', body: { members: membersResult.rows } });
          await reload();
          return formatRowWarnings(membersResult);
        },
      });
    }

    const zonesForm = groupsPanel.querySelector<HTMLFormElement>('#group-zones-form');
    if (zonesForm) {
      wireSectionForm({
        form: zonesForm,
        container: groupsPanel,
        status: groupsPanel.querySelector('#group-zones-status')!,
        fields: [],
        successLabel: 'Zonas guardadas',
        submit: async () => {
          await apiFetch(`/api/npc-group-types/${encodeURIComponent(row!.name)}/zones`, { method: 'PATCH', body: { zones: readSpawnCheckboxes(groupsPanel, 'zone') } });
        },
      });
    }

    const terrainsForm = groupsPanel.querySelector<HTMLFormElement>('#group-terrains-form');
    if (terrainsForm) {
      wireSectionForm({
        form: terrainsForm,
        container: groupsPanel,
        status: groupsPanel.querySelector('#group-terrains-status')!,
        fields: [],
        successLabel: 'Terrenos guardados',
        submit: async () => {
          await apiFetch(`/api/npc-group-types/${encodeURIComponent(row!.name)}/terrains`, { method: 'PATCH', body: { terrains: readSpawnCheckboxes(groupsPanel, 'terrain') } });
          await reload();
        },
      });
    }
  }

  groupsBtn.onclick = () => {
    renderGroupsList();
    openModal(groupsPanel);
  };

  newBtn.onclick = () => openNpcForm(null);
  renderTable(initialNpcs);
  initLiveUpdates('npcs', reload);
}
