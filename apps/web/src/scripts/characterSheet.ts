import { escapeHtml as esc, emojiOr } from './html';
import { icon } from '../lib/icons';
import { statusPillHtml } from './statusPill';
import { showToast, showPrompt } from './ui';
import { apiFetch, ApiError } from './api';
import { formatDuration } from './format';
import { craftOptionsHtml, wireCraftButtons, type CraftOption } from './craft';
import { initPlayerLive } from './playerLive';
import { withPassive } from './api';

interface EffectModifier {
  name: string;
  label: string;
  emoji: string;
  laburo_modifier: number;
  blocks_laburo: number;
}

interface TravelStatus { destX: number; destY: number; speedMultiplier: number; nextTickAt: string }

interface MeResponse {
  characterName: string | null;
  fullName: string | null;
  originCountry: string | null;
  nationality: string | null;
  religion: string | null;
  description: string | null;
  gender: string | null;
  hp: number;
  hunger: number;
  isAlive: boolean;
  isImmortal: boolean;
  x: number;
  y: number;
  avatarUrl: string | null;
  factionDisplayName: string | null;
  factionEmoji: string | null;
  effects: EffectModifier[];
  laburoAvailable: number;
  laburoCooldownSeconds: number;
  travel: TravelStatus | null;
}

interface InventoryItem { quantity: number; name: string; display_name: string; item_type: string; emoji: string | null; description: string | null; is_consumable?: boolean | number }
interface InventoryResponse { items: InventoryItem[]; weight: number; capacity: number }

interface EmpireConstruction {
  id: number; name: string; coord_x: number; coord_y: number;
  type_display_name: string; type_emoji: string | null;
  current_health: number | null; ct_max_health: number | null;
  granted_item_display: string | null; granted_item_emoji: string | null;
  ruined: boolean; hasProduction: boolean; needsFuel: boolean; fuelEmpty: boolean; cyclesReady: number;
}
interface EmpireNpc {
  id: number; role: string; coord_x: number; coord_y: number;
  type_display_name: string; type_emoji: string | null;
  tool_display_name: string | null; tool_emoji: string | null;
  granted_item_display: string | null; granted_item_emoji: string | null;
  hasTool: boolean; producesKind: 'laburo' | 'resource' | null; cyclesReady: number;
}
interface EmpireResponse { laburo: number; constructions: EmpireConstruction[]; npcs: EmpireNpc[] }

const GENDER_LABELS: Record<string, string> = { hombre: 'Hombre', mujer: 'Mujer' };
const LOADING_HTML = '<div class="loading-state"><span class="spinner"></span> Cargando…</div>';

const AUTO_REFRESH_INTERVAL_MS = 30_000;

let renderInFlight = false;

export function initCharacterSheet(root: HTMLElement): void {
  void render(root);

  const refresh = () => {
    if (document.hidden || renderInFlight) return;
    void withPassive(() => render(root));
  };
  setInterval(refresh, AUTO_REFRESH_INTERVAL_MS);
  document.addEventListener('visibilitychange', refresh);
  initPlayerLive(text => {
    showToast(text, 'info');
    refresh();
  });
}

async function render(root: HTMLElement): Promise<void> {
  if (!root.dataset.loaded) root.innerHTML = LOADING_HTML;

  let me: MeResponse, inventory: InventoryResponse, empire: EmpireResponse, craftOptions: CraftOption[];
  renderInFlight = true;
  try {
    [me, inventory, empire, craftOptions] = await Promise.all([
      apiFetch<MeResponse>('/api/game/me'),
      apiFetch<InventoryResponse>('/api/game/inventory'),
      apiFetch<EmpireResponse>('/api/game/empire'),
      apiFetch<CraftOption[]>('/api/game/craft/options'),
    ]);
  } catch (err) {
    root.innerHTML = `<p class="hint">${icon('alert-circle', { size: 14 })} ${esc(err instanceof Error ? err.message : 'No se pudo cargar tu ficha.')}</p>`;
    return;
  } finally {
    renderInFlight = false;
  }

  const effectsHtml = me.effects.length === 0
    ? '<p class="hint">Ningún estado activo.</p>'
    : me.effects.map(e => `
      <div class="tile-detail-row">
        <span class="tile-detail-row-main">
          <b>${emojiOr(e.emoji, 'sparkles')} ${esc(e.label)}</b>
          <span class="hint">${e.laburo_modifier ? `Laburo ${e.laburo_modifier > 0 ? '+' : ''}${e.laburo_modifier}/laburar` : 'Sin modificadores'}${e.blocks_laburo ? ' · bloquea laburar' : ''}</span>
        </span>
      </div>`).join('');

  const inventoryHtml = inventory.items.length === 0
    ? '<p class="hint">Inventario vacío.</p>'
    : inventory.items.map(i => {
      const isCurrency = i.item_type === 'laburo';
      const actionsHtml = isCurrency ? '' : `
        <span class="worldmap-construction-actions">
          ${i.is_consumable ? `<button type="button" class="btn-secondary" data-action-consume="${esc(i.name)}">${icon('heart', { size: 14 })} Comer</button>` : ''}
          <button type="button" class="btn-icon" data-action-drop="${esc(i.name)}" data-action-drop-name="${esc(i.display_name)}" title="Soltar">${icon('download', { size: 14 })}</button>
        </span>`;
      return `
      <div class="tile-detail-row">
        <span class="tile-detail-row-main">
          <b>${emojiOr(i.emoji, 'package')} ${esc(i.display_name)}</b>
          <span class="hint">${esc(i.item_type)}</span>
        </span>
        <span class="hint">×${i.quantity}</span>
        ${actionsHtml}
      </div>`;
    }).join('');

  const constructionsHtml = empire.constructions.length === 0
    ? '<p class="hint">Sin construcciones propias.</p>'
    : empire.constructions.map(c => `
      <div class="tile-detail-row">
        <span class="tile-detail-row-main">
          <b>${emojiOr(c.type_emoji, 'building')} ${esc(c.name)}</b>
          <span class="hint">(${c.coord_x}, ${c.coord_y})${c.ct_max_health ? ` · ${icon('heart', { size: 12 })} ${c.current_health ?? c.ct_max_health}/${c.ct_max_health}` : ''}${c.ruined ? ' · en ruinas' : ''}${c.fuelEmpty ? ' · sin combustible' : ''}</span>
        </span>
        <span class="hint">${c.cyclesReady > 0 ? `${emojiOr(c.granted_item_emoji, 'package')} listo ×${c.cyclesReady}` : ''}</span>
      </div>`).join('');

  const npcsHtml = empire.npcs.length === 0
    ? '<p class="hint">Sin NPCs propios.</p>'
    : empire.npcs.map(n => `
      <div class="tile-detail-row">
        <span class="tile-detail-row-main">
          <b>${emojiOr(n.type_emoji, 'users')} ${esc(n.type_display_name)}</b>
          <span class="hint">(${n.coord_x}, ${n.coord_y}) · ${esc(n.role)}${n.hasTool ? ` · ${emojiOr(n.tool_emoji, 'settings')} ${esc(n.tool_display_name ?? '')}` : ''}</span>
        </span>
        <span class="hint">${n.cyclesReady > 0 ? `listo ×${n.cyclesReady}` : ''}</span>
      </div>`).join('');

  const craftHtml = craftOptionsHtml(craftOptions);

  const hungerWarningHtml = me.hunger <= 0
    ? `<span class="inline-alert text-danger">${icon('alert-triangle', { size: 13 })} Te estás muriendo de hambre</span>`
    : me.hunger / 10 <= 0.3
      ? `<span class="inline-alert text-warning">${icon('alert-triangle', { size: 13 })} Tienes hambre</span>`
      : '';

  root.innerHTML = `
    <div class="detail-card readonly-block">
      <div class="row"><span>Personaje</span><b>${esc(me.characterName ?? '—')}</b></div>
      <div class="row"><span>Estado</span><b>${statusPillHtml(me.isAlive, me.hp)}${me.isImmortal ? ` <span class="status-pill status-pill-immortal">${icon('infinity', { size: 13 })} Inmortal</span>` : ''}</b></div>
      <div class="row"><span>Posición</span><b>(${me.x}, ${me.y})</b></div>
      <div class="row"><span>Hambre</span><b>${me.hunger}/10${hungerWarningHtml ? ` ${hungerWarningHtml}` : ''}</b></div>
      ${me.factionDisplayName ? `<div class="row"><span>Facción</span><b>${esc(me.factionEmoji ?? '')} ${esc(me.factionDisplayName)}</b></div>` : ''}
      <div class="row"><span>Laburo disponible</span><b>${me.laburoAvailable.toFixed(2)}</b></div>
      ${me.laburoCooldownSeconds > 0 ? `<div class="row"><span>Próximo laburo</span><b>${formatDuration(me.laburoCooldownSeconds)}</b></div>` : ''}
      ${me.travel ? `<div class="row"><span>Viajando hacia</span><b>(${me.travel.destX}, ${me.travel.destY})</b></div>` : ''}
    </div>

    <div class="detail-grid">
      <div class="detail-card detail-card-wide">
        <h4>${icon('users', { size: 16 })} Identidad</h4>
        <div class="readonly-block">
          <div class="row"><span>Nombre completo</span><b>${esc(me.fullName ?? '—')}</b></div>
          <div class="row"><span>País de origen</span><b>${esc(me.originCountry ?? '—')}</b></div>
          <div class="row"><span>Nacionalidad</span><b>${esc(me.nationality ?? '—')}</b></div>
          <div class="row"><span>Género</span><b>${esc(me.gender ? (GENDER_LABELS[me.gender] ?? me.gender) : '—')}</b></div>
          ${me.religion ? `<div class="row"><span>Religión</span><b>${esc(me.religion)}</b></div>` : ''}
          ${me.description ? `<div class="row"><span>Descripción</span><b>${esc(me.description)}</b></div>` : ''}
        </div>
      </div>

      <div class="detail-card detail-card-wide">
        <h4>${icon('sparkles', { size: 16 })} Estados activos</h4>
        <div class="tile-detail-list">${effectsHtml}</div>
      </div>

      <div class="detail-card detail-card-wide">
        <h4>${icon('package', { size: 16 })} Inventario</h4>
        <p class="hint">Peso: ${inventory.weight.toFixed(1)} / ${inventory.capacity}</p>
        <div class="tile-detail-list">${inventoryHtml}</div>
      </div>

      <div class="detail-card detail-card-wide">
        <h4>${icon('building', { size: 16 })} Tu imperio</h4>
        <p class="hint">Construcciones</p>
        <div class="tile-detail-list">${constructionsHtml}</div>
        <p class="hint">NPCs</p>
        <div class="tile-detail-list">${npcsHtml}</div>
        <button type="button" class="btn-secondary" data-collect-production>Cobrar toda la producción</button>
        <p id="empire-status" class="hint"></p>
      </div>

      <div class="detail-card detail-card-wide">
        <h4>${icon('brush', { size: 16 })} Craftear</h4>
        <div class="tile-detail-list">${craftHtml}</div>
        <p id="craft-status" class="hint"></p>
      </div>
    </div>`;

  root.dataset.loaded = '1';

  root.querySelector('[data-collect-production]')?.addEventListener('click', async () => {
    const status = root.querySelector<HTMLElement>('#empire-status')!;
    status.textContent = 'Cobrando…';
    try {
      const { lines } = await apiFetch<{ lines: string[] }>('/api/game/empire/collect', { method: 'POST' });
      status.textContent = lines.length > 0 ? 'Cobrado.' : 'No había nada listo para cobrar.';
      if (lines.length > 0) showToast(`Producción cobrada: ${lines.length} ${lines.length === 1 ? 'línea' : 'líneas'}.`, 'success');
      await render(root);
    } catch (err) {
      status.textContent = err instanceof ApiError ? err.message : 'Error desconocido.';
    }
  });

  wireCraftButtons(root, async (recipeId, itemName) => {
    const status = root.querySelector<HTMLElement>('#craft-status')!;
    status.textContent = 'Crafteando…';
    try {
      const body = await apiFetch<{ result: { display_name: string; quantity: number } }>('/api/game/craft', {
        method: 'POST', body: { itemName, recipeId },
      });
      showToast(`+${body.result.quantity} ${body.result.display_name}`, 'success');
      await render(root);
    } catch (err) {
      status.textContent = err instanceof ApiError ? err.message : 'Error desconocido.';
    }
  });

  root.querySelectorAll<HTMLButtonElement>('[data-action-consume]').forEach(btn => {
    btn.addEventListener('click', async () => {
      const itemName = btn.dataset.actionConsume!;
      try {
        const result = await apiFetch<{ item: { display_name: string }; died: boolean; hpAfter: number; hungerAfter: number }>('/api/game/consume', {
          method: 'POST', body: { itemName },
        });
        showToast(
          result.died
            ? `${result.item.display_name} te ha matado.`
            : `Comiste ${result.item.display_name} (HP ${result.hpAfter}/10, Hambre ${result.hungerAfter}/10).`,
          result.died ? 'error' : 'success',
        );
        await render(root);
      } catch (err) {
        showToast(err instanceof ApiError ? err.message : 'Error desconocido.', 'error');
      }
    });
  });

  root.querySelectorAll<HTMLButtonElement>('[data-action-drop]').forEach(btn => {
    btn.addEventListener('click', async () => {
      const itemName = btn.dataset.actionDrop!;
      const displayName = btn.dataset.actionDropName ?? 'el ítem';
      const item = inventory.items.find(i => i.name === itemName);
      const quantity = item?.quantity ?? 1;
      const answer = await showPrompt({
        title: 'Soltar objeto',
        message: `¿Cuánto ${displayName} sueltas en el suelo de tu casilla? Tienes ${quantity}.`,
        confirmLabel: 'Soltar', type: 'number', defaultValue: String(quantity), min: 0.01, max: quantity, step: 0.01,
      });
      if (answer === null) return;
      const amount = Number(answer);
      if (!Number.isFinite(amount) || amount <= 0 || amount > quantity) {
        showToast(`Cantidad no válida — tienes ${quantity}.`, 'error');
        return;
      }
      try {
        await apiFetch('/api/game/drop', { method: 'POST', body: { itemName, quantity: amount } });
        showToast(`Soltaste ${amount}× ${displayName}.`, 'success');
        await render(root);
      } catch (err) {
        showToast(err instanceof ApiError ? err.message : 'Error desconocido.', 'error');
      }
    });
  });
}
