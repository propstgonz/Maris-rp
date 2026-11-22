import { renderAdminTable } from './adminTable';
import { openCatalogForm, deleteCatalogRow } from './catalogModal';
import type { FieldSpec } from '../lib/formFields';
import { apiFetch } from './api';
import { initLiveUpdates } from './liveUpdates';
import type { EffectType } from '../lib/mapServerApi';

function effectFields(isEdit: boolean): FieldSpec[] {
  return [
    { key: 'name', label: 'Nombre clave', type: 'text', disabled: isEdit, required: !isEdit },
    { key: 'label', label: 'Nombre para mostrar', type: 'text', required: true },
    { key: 'emoji', label: 'Emoji', type: 'text' },
    { key: 'laburoModifier', label: 'Modificador de Laburo', type: 'number' },
    { key: 'hpDeltaPerDay', label: 'HP por día', type: 'number' },
    { key: 'blocksLaburo', label: '¿Bloquea /laburar por completo?', type: 'checkbox' },
    {
      key: 'preventsCombat', type: 'checkbox',
      label: '¿Impide pelear (atacar o ser atacado) en una casilla con este efecto de zona, o en quien lo tenga aplicado?',
    },
    { key: 'description', label: 'Descripción', type: 'textarea' },
  ];
}

export function initEffectCatalog(root: HTMLElement, initialEffects: EffectType[]) {
  const table = root.querySelector<HTMLElement>('[data-effects-table]')!;
  const panel = root.querySelector<HTMLElement>('[data-effects-form-panel]')!;
  const newBtn = root.querySelector<HTMLButtonElement>('[data-effects-new-btn]')!;

  async function reload() {
    const rows = await apiFetch<EffectType[]>('/api/effect-types');
    renderTable(rows);
  }

  function renderTable(rows: EffectType[]) {
    renderAdminTable(table, {
      columns: [
        { key: 'emoji', label: '' },
        { key: 'label', label: 'Nombre' },
        { key: 'name', label: 'Clave' },
        { key: 'laburo_modifier', label: 'Mod. Laburo' },
        { key: 'blocks_laburo', label: 'Bloquea Laburo', render: r => r.blocks_laburo ? 'Sí' : 'No' },
        { key: 'prevents_combat', label: 'Impide combate', render: r => r.prevents_combat ? 'Sí' : 'No' },
      ],
      rows,
      onEdit: row => openEffectForm(row),
      onDelete: row => deleteCatalogRow('effect-types', row, reload),
    });
  }

  function openEffectForm(row: EffectType | null) {
    const isEdit = Boolean(row);
    const fields = effectFields(isEdit);
    const values: Record<string, unknown> = row
      ? {
          name: row.name, label: row.label, emoji: row.emoji,
          laburoModifier: row.laburo_modifier, hpDeltaPerDay: row.hp_delta_per_day,
          blocksLaburo: !!row.blocks_laburo, preventsCombat: !!row.prevents_combat, description: row.description,
        }
      : { emoji: '🎭' };

    openCatalogForm(panel, {
      title: isEdit ? `Editar estado: ${row!.label}` : 'Nuevo estado',
      fields, values, isCreate: !isEdit,
      onSubmit: async payload => {
        if (isEdit) {
          await apiFetch(`/api/effect-types/${encodeURIComponent(row!.name)}`, { method: 'PATCH', body: payload });
        } else {
          await apiFetch('/api/effect-types', { method: 'POST', body: payload });
        }
        await reload();
      },
    });
  }

  newBtn.onclick = () => openEffectForm(null);
  renderTable(initialEffects);
  initLiveUpdates('effects', reload);
}
