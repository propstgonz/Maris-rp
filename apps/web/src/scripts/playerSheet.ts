import { escapeHtml, escapeAttr } from './html';
import { icon } from '../lib/icons';
import { statusPillHtml } from './statusPill';
import { fieldHtml, readField, type FieldOption } from '../lib/formFields';
import { itemOptions, effectOptions } from './catalogWidgets';
import { showConfirm, showToast } from './ui';
import { apiFetch } from './api';
import type { PlayerDetail, CatalogItem, EffectType } from '../lib/mapServerApi';

const LOADING_HTML = '<div class="loading-state"><span class="spinner"></span> Cargando…</div>';

const LABURO_ACTION_OPTIONS: FieldOption[] = [
  { value: 'add', label: 'Añadir' },
  { value: 'remove', label: 'Quitar' },
  { value: 'set', label: 'Fijar exactamente' },
  { value: 'reset', label: 'Poner a 0' },
];

const INVENTORY_ACTION_OPTIONS: FieldOption[] = [
  { value: 'add', label: 'Añadir' },
  { value: 'remove', label: 'Quitar' },
  { value: 'set', label: 'Fijar exactamente' },
];

function formatExpiry(isoString: string | null): string {
  if (!isoString) return 'permanente';
  const d = new Date(isoString);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(d.getUTCDate())}/${pad(d.getUTCMonth() + 1)}/${d.getUTCFullYear()} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())} UTC`;
}

export function initPlayerSheet(container: HTMLElement, discordId: string, items: CatalogItem[], effects: EffectType[]) {
  openPlayerDetail(container, discordId, items, effects);
}

async function openPlayerDetail(container: HTMLElement, discordId: string, items: CatalogItem[], effects: EffectType[]) {
  container.innerHTML = LOADING_HTML;
  let player: PlayerDetail;
  try {
    player = await apiFetch<PlayerDetail>(`/api/players/${encodeURIComponent(discordId)}`);
  } catch (err) {
    container.innerHTML = `<p class="hint">❌ ${escapeHtml(err instanceof Error ? err.message : 'Error desconocido.')} <a href="/staff/players">← Volver a la búsqueda</a></p>`;
    return;
  }

  const effectsHtml = player.effects.length === 0
    ? '<p class="hint">Ningún estado activo.</p>'
    : player.effects.map(e => {
        const meta = e.meta ?? { emoji: '', label: '' };
        const mods: string[] = [];
        if (e.laburo_modifier) mods.push(`Laburo ${e.laburo_modifier > 0 ? '+' : ''}${e.laburo_modifier}/laburar`);
        if (e.hp_delta_per_day) mods.push(`HP ${e.hp_delta_per_day > 0 ? '+' : ''}${e.hp_delta_per_day}/día`);
        return `<div class="tile-detail-row">
          <span class="tile-detail-row-main">
            <b>${escapeHtml(meta.emoji ?? '🎭')} ${escapeHtml(meta.label ?? e.effect_type)}</b>
            <span class="hint">${mods.join(' · ') || 'Sin modificadores'} · ${formatExpiry(e.expires_at)}</span>
          </span>
          <button type="button" class="btn-secondary player-remove-effect-btn" data-effect-type="${escapeAttr(e.effect_type)}">Quitar</button>
        </div>`;
      }).join('');

  const inventoryHtml = player.inventory.length === 0
    ? '<p class="hint">Inventario vacío.</p>'
    : player.inventory.map(i => `
      <div class="tile-detail-row">
        <span class="tile-detail-row-main">
          <b>${escapeHtml(i.emoji ?? '📦')} ${escapeHtml(i.display_name)}</b>
          <span class="hint">${escapeHtml(i.item_type)}</span>
        </span>
        <span class="hint">×${i.quantity}</span>
      </div>`).join('');

  container.innerHTML = `
    <a href="/staff/players" class="back-link">← Volver a la búsqueda</a>
    <div class="form-header">
      <div class="form-header-title">
        <img class="player-avatar player-avatar-lg" src="/api/discord-avatar/${encodeURIComponent(player.discord_id)}" alt="">
        <h3>${escapeHtml(player.character_name ?? player.username)}</h3>
      </div>
    </div>
    <div class="detail-card readonly-block">
      <div class="row"><span>Usuario</span><b>${escapeHtml(player.username)} (${escapeHtml(player.discord_id)})</b></div>
      <div class="row"><span>Estado</span><b>${statusPillHtml(!!player.is_alive, null)}${player.is_immortal ? ` <span class="status-pill status-pill-immortal">${icon('infinity', { size: 13 })} Inmortal</span>` : ''}</b></div>
      ${player.faction_display_name ? `<div class="row"><span>Facción</span><b>${escapeHtml(player.faction_emoji ?? '')} ${escapeHtml(player.faction_display_name)}</b></div>` : ''}
    </div>

    <div class="detail-grid">
      <form id="player-identity-form" class="detail-card detail-card-wide">
        <h4>${icon('users', { size: 16 })} Identidad</h4>
        <div class="field-row">
          ${fieldHtml({ key: 'fullName', label: 'Nombre completo', type: 'text', maxLength: 100 }, player.full_name ?? '')}
          ${fieldHtml({ key: 'originCountry', label: 'País de origen', type: 'text', maxLength: 56 }, player.origin_country ?? '')}
          ${fieldHtml({ key: 'nationality', label: 'Nacionalidad (gentilicio)', type: 'text', maxLength: 56 }, player.nationality ?? '')}
        </div>
        <div class="field-row">
          ${fieldHtml({ key: 'religion', label: 'Religión (opcional)', type: 'text', maxLength: 56 }, player.religion ?? '')}
          ${fieldHtml({ key: 'gender', label: 'Género', type: 'select', options: [{ value: '', label: '(sin especificar)' }, { value: 'hombre', label: 'Hombre' }, { value: 'mujer', label: 'Mujer' }] }, player.gender ?? '')}
          ${fieldHtml({ key: 'description', label: 'Descripción (opcional, máx. 50)', type: 'text', maxLength: 50 }, player.description ?? '')}
          <button type="submit" class="btn-secondary">Guardar identidad</button>
        </div>
        <p id="player-identity-status" class="hint"></p>
      </form>

      <div class="detail-card detail-card-wide">
        <h4>${icon('sparkles', { size: 16 })} Estados activos</h4>
        <div class="tile-detail-list" id="player-effects-list">${effectsHtml}</div>
        <form id="player-add-effect-form">
          <div class="field-row">
            ${fieldHtml({ key: 'effectName', label: 'Estado', type: 'select', options: effectOptions(effects, [{ value: '', label: '— elige uno —' }]) }, '')}
            ${fieldHtml({ key: 'effectDuration', label: 'Duración en horas (vacío = permanente)', type: 'number' }, '')}
            <button type="submit" class="btn-secondary">Aplicar</button>
          </div>
        </form>
        <p id="player-effect-status" class="hint"></p>
      </div>

      <div class="detail-card detail-card-wide">
        <h4>${icon('package', { size: 16 })} Inventario</h4>
        <div class="tile-detail-list" id="player-inventory-list">${inventoryHtml}</div>
        <form id="player-inventory-form">
          <div class="field-row">
            ${fieldHtml({ key: 'invItem', label: 'Ítem', type: 'select', options: itemOptions(items, [{ value: '', label: '— elige uno —' }]) }, '')}
            ${fieldHtml({ key: 'invAction', label: 'Acción', type: 'select', options: INVENTORY_ACTION_OPTIONS }, 'add')}
            ${fieldHtml({ key: 'invQuantity', label: 'Cantidad', type: 'number' }, '')}
            <button type="submit" class="btn-secondary">Aplicar</button>
          </div>
        </form>
        <p id="player-inventory-status" class="hint"></p>
      </div>

      <div class="detail-card">
        <h4>${icon('image', { size: 16 })} Foto de personaje</h4>
        <p class="hint">Distinta del avatar de Discord de arriba — esta es la que se sube con /setavatar o desde aquí.</p>
        <div class="avatar-upload">
          <img id="player-avatar-preview" class="avatar-preview" src="${escapeAttr(player.avatar_url ?? '/static/default-avatar.svg')}" alt="">
          <input type="file" id="player-avatar-input" accept="image/png,image/jpeg,image/webp,image/gif">
        </div>
        <p id="player-avatar-status" class="hint"></p>
      </div>

      <form id="player-stats-form" class="detail-card">
        <h4>${icon('heart', { size: 16 })} Editar stats</h4>
        <div class="field-row">
          ${fieldHtml({ key: 'hp', label: 'HP', type: 'number' }, player.hp)}
          ${fieldHtml({ key: 'hunger', label: 'Hambre', type: 'number' }, player.hunger)}
        </div>
        <button type="submit" class="btn-secondary">Guardar stats</button>
      </form>

      <form id="player-immortal-form" class="detail-card">
        <h4>${icon('infinity', { size: 16 })} Inmortalidad</h4>
        ${fieldHtml({ key: 'immortal', label: '¿Es inmortal? (anula muerte por vida a 0, hambre, /kill NO)', type: 'checkbox' }, !!player.is_immortal)}
        <button type="submit" class="btn-secondary">Guardar</button>
      </form>

      <form id="player-laburo-form" class="detail-card">
        <h4>${icon('sparkles', { size: 16 })} Laburo</h4>
        <div class="field-row">
          ${fieldHtml({ key: 'laburoAction', label: 'Acción', type: 'select', options: LABURO_ACTION_OPTIONS }, 'add')}
          ${fieldHtml({ key: 'laburoAmount', label: 'Cantidad (no aplica en "poner a 0")', type: 'number' }, '')}
        </div>
        <button type="submit" class="btn-secondary">Aplicar</button>
      </form>

      ${player.is_alive ? `
      <form id="player-kill-form" class="detail-card detail-card-danger">
        <h4>${icon('alert-triangle', { size: 16 })} Matar (PERMADEATH)</h4>
        <p class="hint">Sin ventana de gracia, no se puede deshacer.</p>
        ${fieldHtml({ key: 'killReason', label: 'Motivo', type: 'text' }, '')}
        <button type="submit" class="btn-primary btn-danger">${icon('skull', { size: 15 })} Matar (permadeath)</button>
      </form>` : `
      <form id="player-revive-form" class="detail-card">
        <h4>${icon('heart', { size: 16 })} Revivir</h4>
        ${fieldHtml({ key: 'reviveHp', label: 'HP al revivir (vacío = máximo)', type: 'number' }, '')}
        <button type="submit" class="btn-primary">${icon('heart', { size: 15 })} Revivir</button>
      </form>
      <form id="player-finalize-form" class="detail-card detail-card-danger">
        <h4>${icon('alert-triangle', { size: 16 })} Finalizar (PERMADEATH)</h4>
        <p class="hint">Está en periodo de gracia (7 días) — esto adelanta el borrado definitivo en vez de esperar a que venza solo. No se puede deshacer.</p>
        <button type="submit" class="btn-primary btn-danger">${icon('skull', { size: 15 })} Finalizar ya (permadeath)</button>
      </form>`}
    </div>

    <p id="player-status" class="hint"></p>`;

  const status = () => container.querySelector<HTMLElement>('#player-status')!;
  const reload = () => openPlayerDetail(container, discordId, items, effects);

  container.querySelector<HTMLInputElement>('#player-avatar-input')!.addEventListener('change', async evt => {
    const file = (evt.target as HTMLInputElement).files?.[0];
    if (!file) return;
    const avatarStatus = container.querySelector<HTMLElement>('#player-avatar-status')!;
    avatarStatus.textContent = 'Subiendo…';
    const formData = new FormData();
    formData.append('imagen', file);
    try {
      const body = await apiFetch<{ avatarUrl: string }>(`/api/players/${encodeURIComponent(discordId)}/avatar`, { method: 'POST', body: formData });
      container.querySelector<HTMLImageElement>('#player-avatar-preview')!.src = `${body.avatarUrl}?t=${Date.now()}`;
      avatarStatus.textContent = '✅ Foto actualizada.';
      showToast('Foto de personaje actualizada.', 'success');
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Error desconocido.';
      avatarStatus.textContent = `❌ ${message}`;
      showToast(message, 'error');
    } finally {
      (evt.target as HTMLInputElement).value = '';
    }
  });

  container.querySelector('#player-identity-form')!.addEventListener('submit', async evt => {
    evt.preventDefault();
    const identityStatus = container.querySelector<HTMLElement>('#player-identity-status')!;

    const body: Record<string, string> = {};
    for (const key of ['fullName', 'originCountry', 'nationality', 'religion', 'gender', 'description']) {
      const value = readField({ key, type: 'text' }, container) as string | null;
      if (value) body[key] = value;
    }
    if (Object.keys(body).length === 0) {
      identityStatus.textContent = 'No hay ningún campo con contenido para guardar.';
      return;
    }
    identityStatus.textContent = 'Guardando…';
    try {
      await apiFetch(`/api/players/${encodeURIComponent(discordId)}/identity`, { method: 'PATCH', body });
      identityStatus.textContent = '✅ Identidad guardada.';
      await reload();
    } catch (err) { identityStatus.textContent = `❌ ${err instanceof Error ? err.message : 'Error desconocido.'}`; }
  });

  container.querySelector('#player-stats-form')!.addEventListener('submit', async evt => {
    evt.preventDefault();
    status().textContent = 'Guardando…';
    try {
      const result = await apiFetch<{ diedNow: boolean }>(`/api/players/${encodeURIComponent(discordId)}/stats`, {
        method: 'PATCH',
        body: { hp: readField({ key: 'hp', type: 'number' }, container), hunger: readField({ key: 'hunger', type: 'number' }, container) },
      });
      status().textContent = result.diedNow ? '✅ Guardado — el HP llegó a 0, el personaje ha muerto (con ventana de gracia).' : '✅ Stats guardadas.';
      await reload();
    } catch (err) { status().textContent = `❌ ${err instanceof Error ? err.message : 'Error desconocido.'}`; }
  });

  container.querySelector('#player-immortal-form')!.addEventListener('submit', async evt => {
    evt.preventDefault();
    status().textContent = 'Guardando…';
    try {
      await apiFetch(`/api/players/${encodeURIComponent(discordId)}/immortal`, {
        method: 'POST', body: { immortal: readField({ key: 'immortal', type: 'checkbox' }, container) },
      });
      status().textContent = '✅ Guardado.';
    } catch (err) { status().textContent = `❌ ${err instanceof Error ? err.message : 'Error desconocido.'}`; }
  });

  container.querySelector('#player-laburo-form')!.addEventListener('submit', async evt => {
    evt.preventDefault();
    status().textContent = 'Aplicando…';
    try {
      const result = await apiFetch<{ balance: number }>(`/api/players/${encodeURIComponent(discordId)}/laburo`, {
        method: 'POST',
        body: {
          action: readField({ key: 'laburoAction', type: 'select' }, container),
          amount: readField({ key: 'laburoAmount', type: 'number' }, container),
        },
      });
      status().textContent = `✅ Hecho — saldo actual: ${result.balance}.`;
    } catch (err) { status().textContent = `❌ ${err instanceof Error ? err.message : 'Error desconocido.'}`; }
  });

  container.querySelector('#player-kill-form')?.addEventListener('submit', async evt => {
    evt.preventDefault();
    const ok = await showConfirm({
      title: 'Matar (PERMADEATH)',
      message: 'Esto es PERMADEATH: sin ventana de gracia, no se puede deshacer.',
      confirmLabel: 'Matar', danger: true,
    });
    if (!ok) return;
    status().textContent = 'Matando…';
    try {
      await apiFetch(`/api/players/${encodeURIComponent(discordId)}/kill`, {
        method: 'POST', body: { reason: readField({ key: 'killReason', type: 'text' }, container) },
      });
      status().textContent = '✅ Hecho.';
      await reload();
    } catch (err) { status().textContent = `❌ ${err instanceof Error ? err.message : 'Error desconocido.'}`; }
  });

  container.querySelector('#player-revive-form')?.addEventListener('submit', async evt => {
    evt.preventDefault();
    status().textContent = 'Reviviendo…';
    try {
      await apiFetch(`/api/players/${encodeURIComponent(discordId)}/revive`, {
        method: 'POST', body: { hp: readField({ key: 'reviveHp', type: 'number' }, container) },
      });
      status().textContent = '✅ Hecho.';
      await reload();
    } catch (err) { status().textContent = `❌ ${err instanceof Error ? err.message : 'Error desconocido.'}`; }
  });

  container.querySelector('#player-finalize-form')?.addEventListener('submit', async evt => {
    evt.preventDefault();
    const ok = await showConfirm({
      title: 'Finalizar (PERMADEATH)',
      message: 'Está en periodo de gracia — esto adelanta el borrado definitivo en vez de esperar a que venza solo. No se puede deshacer.',
      confirmLabel: 'Finalizar', danger: true,
    });
    if (!ok) return;
    status().textContent = 'Finalizando…';
    try {
      await apiFetch(`/api/players/${encodeURIComponent(discordId)}/finalize`, { method: 'POST', body: {} });
      status().textContent = '✅ Hecho.';
      await reload();
    } catch (err) { status().textContent = `❌ ${err instanceof Error ? err.message : 'Error desconocido.'}`; }
  });

  container.querySelector('#player-add-effect-form')!.addEventListener('submit', async evt => {
    evt.preventDefault();
    const effectStatus = container.querySelector<HTMLElement>('#player-effect-status')!;
    const effectName = readField({ key: 'effectName', type: 'select' }, container);
    if (!effectName) { effectStatus.textContent = 'Elige un estado.'; return; }
    effectStatus.textContent = 'Aplicando…';
    try {
      await apiFetch(`/api/players/${encodeURIComponent(discordId)}/effects`, {
        method: 'POST',
        body: { effectType: effectName, durationHours: readField({ key: 'effectDuration', type: 'number' }, container) },
      });
      showToast('Estado aplicado.', 'success');
      await reload();
    } catch (err) { effectStatus.textContent = `❌ ${err instanceof Error ? err.message : 'Error desconocido.'}`; }
  });

  container.querySelector('#player-effects-list')!.addEventListener('click', async evt => {
    const btn = (evt.target as HTMLElement).closest<HTMLButtonElement>('.player-remove-effect-btn');
    if (!btn) return;
    try {
      await apiFetch(`/api/players/${encodeURIComponent(discordId)}/effects/${encodeURIComponent(btn.dataset.effectType!)}`, { method: 'DELETE' });
      showToast('Estado quitado.', 'success');
      await reload();
    } catch (err) { showToast(err instanceof Error ? err.message : 'Error desconocido.', 'error'); }
  });

  container.querySelector('#player-inventory-form')!.addEventListener('submit', async evt => {
    evt.preventDefault();
    const invStatus = container.querySelector<HTMLElement>('#player-inventory-status')!;
    const itemName = readField({ key: 'invItem', type: 'select' }, container);
    const quantity = readField({ key: 'invQuantity', type: 'number' }, container) as number | null;
    if (!itemName || !quantity || quantity <= 0) { invStatus.textContent = 'Elige un ítem y una cantidad mayor que 0.'; return; }
    const action = readField({ key: 'invAction', type: 'select' }, container);
    if (action === 'set') {
      const ok = await showConfirm({
        title: 'Fijar cantidad',
        message: `Esto pisa la cantidad actual de "${itemName}" a ${quantity}, sin importar cuánto tuviera antes.`,
        confirmLabel: 'Fijar', danger: true,
      });
      if (!ok) return;
    }
    invStatus.textContent = 'Aplicando…';
    try {
      const result = await apiFetch<{ newQuantity: number }>(`/api/players/${encodeURIComponent(discordId)}/inventory`, {
        method: 'POST', body: { action, itemName, quantity },
      });
      showToast(`Inventario actualizado — ahora tiene ${result.newQuantity}.`, 'success');
      await reload();
    } catch (err) { invStatus.textContent = `❌ ${err instanceof Error ? err.message : 'Error desconocido.'}`; }
  });
}
