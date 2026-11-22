import { escapeHtml, escapeAttr } from './html';
import { icon } from '../lib/icons';
import { renderAdminTable } from './adminTable';
import { openCatalogForm, deleteCatalogRow, wireSectionForm } from './catalogModal';
import { fieldHtml, wireFieldDependencies, type FieldSpec } from '../lib/formFields';
import { openModal, closeAllModals, showToast } from './ui';
import { apiFetch } from './api';
import { initLiveUpdates } from './liveUpdates';
import type { Faction } from '../lib/mapServerApi';

interface FactionRank {
  id: number;
  name: string;
  display_name: string;
  emoji: string | null;
  rank_order: number;
  is_default: number;
  is_leader: number;
}
interface RankRequirement { action: string; required_rank_order: number }
interface RanksResponse { ranks: FactionRank[]; requirements: RankRequirement[]; actions: Record<string, string> }

function faccionFields(isEdit: boolean): FieldSpec[] {
  return [
    { key: 'name', label: 'Nombre clave', type: 'text', disabled: isEdit, required: !isEdit },
    { key: 'displayName', label: 'Nombre para mostrar', type: 'text', required: true },
    { key: 'emoji', label: 'Emoji', type: 'text' },
    { key: 'description', label: 'Descripción', type: 'textarea' },
    { key: 'isNpc', label: 'Facción NPC (la lleva el mundo: ningún jugador puede unirse a ella ni mandarla)', type: 'checkbox' },
  ];
}

export function initFaccionCatalog(root: HTMLElement, initialFactions: Faction[]) {
  const table = root.querySelector<HTMLElement>('[data-facciones-table]')!;
  const panel = root.querySelector<HTMLElement>('[data-facciones-form-panel]')!;
  const newBtn = root.querySelector<HTMLButtonElement>('[data-facciones-new-btn]')!;

  async function reload() {
    const rows = await apiFetch<Faction[]>('/api/facciones');
    renderTable(rows);
    return rows;
  }

  function renderTable(rows: Faction[]) {
    renderAdminTable(table, {
      columns: [
        { key: 'emoji', label: '' },
        { key: 'display_name', label: 'Nombre' },
        { key: 'name', label: 'Clave' },
        { key: 'tile_count', label: 'Casillas' },
        { key: 'is_npc', label: 'Tipo', render: row => (row.is_npc ? 'NPC' : '') },
      ],
      rows,
      onEdit: row => openFaccionForm(row),
      onDelete: row => deleteCatalogRow('facciones', row, () => void reload()),
    });
  }

  function openFaccionForm(row: Faction | null) {
    const isEdit = Boolean(row);
    const fields = faccionFields(isEdit);
    const values: Record<string, unknown> = row
      ? { name: row.name, displayName: row.display_name, emoji: row.emoji, description: row.description, isNpc: !!row.is_npc }
      : { emoji: '🏳️', isNpc: false };

    if (!isEdit) {
      openCatalogForm(panel, {
        title: 'Nueva facción', fields, values,
        onSubmit: async payload => {
          await apiFetch('/api/facciones', { method: 'POST', body: payload });
          await reload();
        },
      });
      return;
    }

    const isNpcFaction = Boolean(row!.is_npc);
    const ownerFields: FieldSpec[] = [
      { key: 'ownerDiscordId', label: 'Discord ID del dueño (vacío = quitar)', type: 'text', placeholder: 'ej. 123456789012345678' },
    ];

    const gobiernoHtml = isNpcFaction
      ? '<p class="hint ct-section">La lleva el mundo: no tiene dueño ni rangos que repartir, y ningún jugador puede solicitar entrar. Desmarca «Facción NPC» y guarda la identidad para devolvérsela a los jugadores.</p>'
      : `
      <form id="faccion-owner-form" class="ct-section">
        <fieldset><legend>Dueño</legend>${ownerFields.map(f => fieldHtml(f, '')).join('')}</fieldset>
        <button type="submit" class="btn-secondary">Guardar dueño</button>
        <p id="faccion-owner-status" class="hint" role="status"></p>
      </form>
      <div id="faccion-ranks-section" class="ct-section"><p class="hint">Cargando rangos…</p></div>`;

    panel.innerHTML = `
      <div class="form-header"><h3>Editar facción: ${escapeHtml(row!.display_name)}</h3><button type="button" class="btn-icon modal-close" aria-label="Cerrar">${icon('x', { size: 15 })}</button></div>
      <form id="faccion-identity-form" class="ct-section">
        <fieldset><legend>Identidad</legend>${fields.map(f => fieldHtml(f, values[f.key])).join('')}</fieldset>
        <button type="submit" class="btn-secondary">Guardar identidad</button>
        <p id="faccion-identity-status" class="hint" role="status"></p>
      </form>
      ${gobiernoHtml}`;

    panel.querySelector<HTMLButtonElement>('.modal-close')!.onclick = () => closeAllModals();
    wireFieldDependencies(panel);
    if (!isNpcFaction) loadRanksSection(panel, row!.name);

    wireSectionForm({
      form: panel.querySelector('#faccion-identity-form')!,
      container: panel,
      status: panel.querySelector('#faccion-identity-status')!,
      fields,
      successLabel: 'Identidad guardada',
      submit: async payload => {
        await apiFetch(`/api/facciones/${encodeURIComponent(row!.name)}`, { method: 'PATCH', body: payload });
        const updated = (await reload()).find(f => f.name === row!.name);
        if (updated && Boolean(updated.is_npc) !== isNpcFaction) {
          showToast(Boolean(updated.is_npc) ? 'Ahora la lleva el mundo.' : 'Vuelve a ser una facción de jugadores.', 'success');
          openFaccionForm(updated);
        }
      },
    });

    if (!isNpcFaction) {
      wireSectionForm({
        form: panel.querySelector('#faccion-owner-form')!,
        container: panel,
        status: panel.querySelector('#faccion-owner-status')!,
        fields: ownerFields,
        successLabel: 'Dueño actualizado',
        submit: async payload => {
          await apiFetch(`/api/facciones/${encodeURIComponent(row!.name)}/owner`, { method: 'PATCH', body: { discordId: payload.ownerDiscordId } });
        },
      });
    }

    openModal(panel);
  }

  async function loadRanksSection(panel: HTMLElement, factionName: string) {
    const section = panel.querySelector<HTMLElement>('#faccion-ranks-section')!;
    let data: RanksResponse;
    try {
      data = await apiFetch<RanksResponse>(`/api/facciones/${encodeURIComponent(factionName)}/ranks`);
    } catch (err) {
      section.innerHTML = `<p class="hint">❌ ${escapeHtml(err instanceof Error ? err.message : 'No se pudieron cargar los rangos.')}</p>`;
      return;
    }

    const { ranks, requirements, actions } = data;
    const ladder = ranks
      .slice().sort((a, b) => a.rank_order - b.rank_order)
      .map(r => `${escapeHtml(r.emoji ?? '')} ${escapeHtml(r.display_name)}${r.is_leader ? ' 👑' : ''}${r.is_default ? ' <em>(por defecto)</em>' : ''}`)
      .join(' &rarr; ');

    const rankOptions = (selected: number | null) => [
      `<option value="" ${selected == null ? 'selected' : ''}>— solo dueño/Rolepriest —</option>`,
      ...ranks.slice().sort((a, b) => a.rank_order - b.rank_order).map(r =>
        `<option value="${r.rank_order}" ${selected === r.rank_order ? 'selected' : ''}>${escapeHtml(r.display_name)} y superior</option>`
      ),
    ].join('');

    const rows = Object.entries(actions).map(([action, label]) => {
      const req = requirements.find(r => r.action === action);
      return `<label>${escapeHtml(label)}<select data-permission-action="${escapeAttr(action)}">${rankOptions(req?.required_rank_order ?? null)}</select></label>`;
    }).join('');

    section.innerHTML = `
      <fieldset><legend>Rangos y permisos</legend>
        <p class="hint">${ladder || '*Sin rangos configurados.*'}</p>
        <form id="faccion-permissions-form">${rows}
          <button type="submit" class="btn-secondary">Guardar permisos</button>
          <p id="faccion-permissions-status" class="hint" role="status"></p>
        </form>
      </fieldset>`;

    wireSectionForm({
      form: section.querySelector('#faccion-permissions-form')!,
      container: section,
      status: section.querySelector('#faccion-permissions-status')!,
      fields: [],
      successLabel: 'Permisos guardados',
      submit: async () => {
        const selects = section.querySelectorAll<HTMLSelectElement>('select[data-permission-action]');
        for (const select of selects) {
          const action = select.dataset.permissionAction!;
          const requiredRankOrder = select.value === '' ? null : Number(select.value);
          await apiFetch(`/api/facciones/${encodeURIComponent(factionName)}/permisos`, { method: 'PATCH', body: { action, requiredRankOrder } });
        }
      },
    });
  }

  newBtn.onclick = () => openFaccionForm(null);
  renderTable(initialFactions);
  initLiveUpdates('facciones', () => void reload());
}
