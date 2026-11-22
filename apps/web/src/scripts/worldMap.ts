import { withPassive, apiFetch, ApiError } from './api';
import { escapeAttr, emojiOr } from './html';
import { showToast, openModal, closeAllModals, showConfirm } from './ui';
import { formatDuration, formatTemperature, describeTemperature } from './format';
import { craftOptionsHtml, wireCraftButtons, type CraftOption } from './craft';
import { initPlayerLive } from './playerLive';
import { icon } from '../lib/icons';

interface VisibleTile {
  coord_x: number;
  coord_y: number;
  name: string;
  terrain_name?: string | null;
  terrain_display_name?: string | null;
  terrain_color?: string | null;
  faction_name?: string | null;
  faction_display_name?: string | null;
  faction_emoji?: string | null;
  resource_type?: string | null;
}

interface Marker {
  x: number;
  y: number;
  distance: number;
}

interface MyTileConstruction {
  id: number; typeName: string; name: string; emoji: string | null;
  health: number | null; maxHealth: number | null;
  isRuined: boolean; hasFuel: boolean; isMarket: boolean;
}
interface MyTileNpc { id: number; name: string; emoji: string | null; hp: number; factionName: string | null; factionEmoji: string | null }
interface InventoryItem { quantity: number; name: string; display_name: string; item_type: string; emoji: string | null; is_consumable?: boolean | number }

interface AttackWeapon {
  id: string; name: string; displayName: string; emoji: string | null;
  damage: number | null; structureDamage: boolean; range: number;
}
interface AttackTarget {
  kind: 'p' | 'n' | 'c'; id: string; label: string; detail: string; emoji: string; distance: number;
}
interface AttackResult {
  inRange?: boolean; hit: boolean; damage?: number; killed?: boolean;
  targetHpAfter?: number; npcHpAfter?: number; healthAfter?: number;
  npcDied?: boolean; ruinedNow?: boolean;
  selfDamage?: number; attackerKilled?: boolean;
  drops?: { display_name: string }[];
}
interface FleeResult {
  blocked: boolean; freed: boolean; success: boolean | null; label: string | null; lines: string[];
}
interface MyTile {
  terrainName: string | null;
  terrainEmoji: string | null;
  zoneName: string | null;
  temperature: number | null;
  resourceType: string | null;
  gatherable: { name: string; displayName: string; emoji: string | null }[];
  items: { name: string; displayName: string; emoji: string | null; quantity: number }[];
  constructions: MyTileConstruction[];
  npcs: MyTileNpc[];
  playersHere: (string | null)[];
  travel: {
    destX: number; destY: number; speedMultiplier: number; nextTickAt: string;
    etaHours: number; paused: boolean; arrivalAt: string | null;
  } | null;
}

interface WorldView {
  radius: number;
  me: {
    characterName: string | null;
    x: number;
    y: number;
    hp: number;
    hunger: number;
    isAlive: boolean;
    avatarUrl: string | null;
    laburoAvailable: number;
    laburoCooldownSeconds: number;
  };
  visible: VisibleTile[];
  players: (Marker & { characterName: string | null; isAlive: boolean; avatarUrl: string | null })[];
  constructions: (Marker & { id: number; typeName: string; name: string; emoji: string | null; health: number | null; maxHealth: number | null })[];
  npcs: (Marker & { id: number; name: string; emoji: string | null; hp: number; factionName: string | null; factionEmoji: string | null })[];
  outline: number[];
  myTile: MyTile | null;
}

const TILE = 34;
const MIN_ZOOM = 0.25;
const MAX_ZOOM = 3;
const PULSE_MS = 1600;
const FALLBACK_AVATAR = '/static/default-avatar.svg';
const ATTACK_TARGET_ICON: Record<AttackTarget['kind'], string> = { p: 'users', n: 'skull', c: 'building' };

function esc(value: unknown): string {
  return escapeAttr(String(value ?? ''));
}

function panelShell(panel: HTMLElement, iconName: string, title: string, bodyHtml: string): void {
  panel.innerHTML = `<div class="form-header"><h3>${icon(iconName, { size: 16 })} ${esc(title)}</h3><button type="button" class="btn-icon modal-close" aria-label="Cerrar">${icon('x', { size: 15 })}</button></div>
    ${bodyHtml}`;
  panel.querySelector<HTMLButtonElement>('.modal-close')!.onclick = () => closeAllModals();
}

const avatarCache = new Map<string, HTMLImageElement | null>();
function getAvatar(url: string | null, onLoad: () => void): HTMLImageElement | null {
  const src = url || FALLBACK_AVATAR;
  const cached = avatarCache.get(src);
  if (cached !== undefined) return cached;

  avatarCache.set(src, null);
  const img = new Image();
  img.crossOrigin = 'anonymous';
  img.onload = () => { avatarCache.set(src, img); onLoad(); };
  img.onerror = () => {
    if (src !== FALLBACK_AVATAR) { avatarCache.delete(src); getAvatar(null, onLoad); }
  };
  img.src = src;
  return null;
}

export function initWorldMap(root: HTMLElement): void {
  const canvas = root.querySelector<HTMLCanvasElement>('[data-worldmap-canvas]');
  const status = root.querySelector<HTMLElement>('[data-worldmap-status]');
  const side   = root.querySelector<HTMLElement>('[data-worldmap-side]');
  const coordHint = root.querySelector<HTMLElement>('[data-worldmap-coordhint]');
  const goBtn = root.querySelector<HTMLButtonElement>('[data-worldmap-go-btn]');
  const attackPanel = root.querySelector<HTMLElement>('[data-worldmap-attack-panel]');
  const craftPanel = root.querySelector<HTMLElement>('[data-worldmap-craft-panel]');
  const tradePanel = root.querySelector<HTMLElement>('[data-worldmap-trade-panel]');
  if (!canvas || !status || !side) return;

  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  let view: WorldView | null = null;
  let inventory: InventoryItem[] = [];
  let attackStep: 'weapon' | 'target' | 'confirm' = 'weapon';
  let attackWeapons: AttackWeapon[] = [];
  let attackSelectedWeaponId: string | null = null;
  let attackTargets: AttackTarget[] = [];
  let attackSelectedTarget: AttackTarget | null = null;
  let attackInFlight = false;
  let actionInFlight = false;
  let selectedTile: { x: number; y: number } | null = null;
  let zoom = 1;
  let panX = 0;
  let panY = 0;
  let rafId = 0;
  let worldBounds: { minX: number; maxX: number; minY: number; maxY: number } | null = null;
  let viewW = 0;
  let viewH = 0;

  async function load(): Promise<void> {
    try {
      const res = await fetch('/api/mapamundi/vista', { headers: { Accept: 'application/json' } });
      if (res.status === 401) {
        status!.textContent = 'Tu sesión ha caducado. Vuelve a entrar con Discord.';
        return;
      }
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        status!.textContent = body.error ?? 'No se pudo cargar el mapa.';
        return;
      }
      view = await res.json() as WorldView;
      status!.textContent = '';
      status!.hidden = true;
      inventory = await apiFetch<{ items: InventoryItem[] }>('/api/game/inventory').then(r => r.items).catch(() => inventory);
      worldBounds = null;
      for (let i = 0; i < view.outline.length; i += 2) {
        const x = view.outline[i], y = view.outline[i + 1];
        if (!worldBounds) worldBounds = { minX: x, maxX: x, minY: y, maxY: y };
        else {
          if (x < worldBounds.minX) worldBounds.minX = x;
          if (x > worldBounds.maxX) worldBounds.maxX = x;
          if (y < worldBounds.minY) worldBounds.minY = y;
          if (y > worldBounds.maxY) worldBounds.maxY = y;
        }
      }
      fitToView();
      renderSide();
      updateGoButton();
      if (attackPanel?.classList.contains('open') && attackStep === 'weapon') void renderAttackWeaponStep();
      if (tradePanel?.classList.contains('open')) renderTradePanel();
      draw();
    } catch {
      status!.textContent = 'No se pudo contactar con el servidor.';
    }
  }

  function resize(): void {
    const rect = canvas!.getBoundingClientRect();
    viewW = rect.width;
    viewH = rect.height;
    const dpr = window.devicePixelRatio || 1;
    canvas!.width = Math.round(rect.width * dpr);
    canvas!.height = Math.round(rect.height * dpr);
    ctx!.setTransform(dpr, 0, 0, dpr, 0, 0);
    draw();
  }

  function fitToView(): void {
    if (!view) return;
    const lado = (2 * view.radius + 1) * TILE;
    const objetivo = Math.min(viewW, viewH) * 0.62;
    zoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, objetivo / lado));
    panX = 0;
    panY = 0;
  }

  function toScreen(x: number, y: number): { sx: number; sy: number } {
    const size = TILE * zoom;
    return {
      sx: viewW / 2 + (x - (view?.me.x ?? 0)) * size + panX,
      sy: viewH / 2 + (y - (view?.me.y ?? 0)) * size + panY,
    };
  }

  function toWorld(sx: number, sy: number): { x: number; y: number } {
    const size = TILE * zoom;
    return {
      x: Math.floor((sx - viewW / 2 - panX) / size + (view?.me.x ?? 0)),
      y: Math.floor((sy - viewH / 2 - panY) / size + (view?.me.y ?? 0)),
    };
  }

  function draw(): void {
    ctx!.clearRect(0, 0, viewW, viewH);
    if (!view) return;

    const size = TILE * zoom;
    const styles = getComputedStyle(document.documentElement);
    const fog = styles.getPropertyValue('--worldmap-fog').trim() || '#0e2418';
    const grid = styles.getPropertyValue('--worldmap-grid').trim() || '#2f7048';

    ctx!.fillStyle = fog;
    for (let i = 0; i < view.outline.length; i += 2) {
      const { sx, sy } = toScreen(view.outline[i], view.outline[i + 1]);
      if (sx < -size || sy < -size || sx > viewW || sy > viewH) continue;
      ctx!.fillRect(sx, sy, size - 1, size - 1);
    }

    for (const t of view.visible) {
      const { sx, sy } = toScreen(t.coord_x, t.coord_y);
      ctx!.fillStyle = t.terrain_color || '#5c6b52';
      ctx!.fillRect(sx, sy, size - 1, size - 1);
    }

    const r = view.radius;
    let x0 = view.me.x - r, x1 = view.me.x + r;
    let y0 = view.me.y - r, y1 = view.me.y + r;
    if (worldBounds) {
      x0 = Math.max(x0, worldBounds.minX);
      x1 = Math.min(x1, worldBounds.maxX);
      y0 = Math.max(y0, worldBounds.minY);
      y1 = Math.min(y1, worldBounds.maxY);
    }
    const tl = toScreen(x0, y0);
    ctx!.strokeStyle = grid;
    ctx!.lineWidth = 2;
    ctx!.strokeRect(tl.sx - 1, tl.sy - 1, size * (x1 - x0 + 1) + 1, size * (y1 - y0 + 1) + 1);

    const glyph = (x: number, y: number, text: string, color: string) => {
      const { sx, sy } = toScreen(x, y);
      if (size >= 18) {
        ctx!.font = `${Math.round(size * 0.55)}px system-ui, sans-serif`;
        ctx!.textAlign = 'center';
        ctx!.textBaseline = 'middle';
        ctx!.fillStyle = color;
        ctx!.fillText(text, sx + size / 2, sy + size / 2);
      } else {
        ctx!.fillStyle = color;
        ctx!.beginPath();
        ctx!.arc(sx + size / 2, sy + size / 2, Math.max(2, size * 0.2), 0, Math.PI * 2);
        ctx!.fill();
      }
    };

    const drawAvatar = (
      x: number, y: number, url: string | null, ring: string, fallback: string, scale = 0.78,
    ) => {
      const { sx, sy } = toScreen(x, y);
      const cx = sx + size / 2;
      const cy = sy + size / 2;
      const rad = (size * scale) / 2;

      if (size < 14) {
        ctx!.fillStyle = ring;
        ctx!.beginPath();
        ctx!.arc(cx, cy, Math.max(2, size * 0.22), 0, Math.PI * 2);
        ctx!.fill();
        return;
      }

      const img = getAvatar(url, () => {});
      if (img) {
        ctx!.save();
        ctx!.beginPath();
        ctx!.arc(cx, cy, rad, 0, Math.PI * 2);
        ctx!.closePath();
        ctx!.clip();
        const lado = Math.min(img.naturalWidth, img.naturalHeight) || 1;
        ctx!.drawImage(
          img,
          (img.naturalWidth - lado) / 2, (img.naturalHeight - lado) / 2, lado, lado,
          cx - rad, cy - rad, rad * 2, rad * 2,
        );
        ctx!.restore();
      } else {
        ctx!.fillStyle = 'rgba(0,0,0,0.35)';
        ctx!.beginPath();
        ctx!.arc(cx, cy, rad, 0, Math.PI * 2);
        ctx!.fill();
        glyph(x, y, fallback, '#fff');
      }

      ctx!.strokeStyle = ring;
      ctx!.lineWidth = Math.max(1.5, size * 0.07);
      ctx!.beginPath();
      ctx!.arc(cx, cy, rad, 0, Math.PI * 2);
      ctx!.stroke();
    };

    for (const c of view.constructions) glyph(c.x, c.y, c.emoji || '🏗️', '#e6c07b');
    for (const n of view.npcs)          glyph(n.x, n.y, n.emoji || '👹', '#d98b8b');
    for (const p of view.players) {
      drawAvatar(p.x, p.y, p.avatarUrl, p.isAlive ? '#2f8f52' : '#8a8a8a', '🧑', 0.76);
    }

    const me = toScreen(view.me.x, view.me.y);
    const cx = me.sx + size / 2;
    const cy = me.sy + size / 2;

    const ahora = performance.now();
    for (const desfase of [0, 0.5]) {
      const fase = ((ahora / PULSE_MS) + desfase) % 1;
      const radio = size * (0.45 + fase * 0.85);
      const alfa = (1 - fase) * 0.55;
      ctx!.strokeStyle = `rgba(255, 176, 32, ${alfa})`;
      ctx!.lineWidth = Math.max(1.5, size * 0.06) * (1 - fase * 0.5);
      ctx!.beginPath();
      ctx!.arc(cx, cy, radio, 0, Math.PI * 2);
      ctx!.stroke();
    }

    ctx!.fillStyle = 'rgba(255, 176, 32, 0.16)';
    ctx!.fillRect(me.sx, me.sy, size - 1, size - 1);
    ctx!.strokeStyle = '#ffb020';
    ctx!.lineWidth = Math.max(2, size * 0.075);
    ctx!.strokeRect(me.sx + 1, me.sy + 1, size - 3, size - 3);

    drawAvatar(view.me.x, view.me.y, view.me.avatarUrl, '#ffb020', '📍', 0.86);

    if (selectedTile) {
      const { sx, sy } = toScreen(selectedTile.x, selectedTile.y);
      ctx!.strokeStyle = '#5ab0ff';
      ctx!.lineWidth = Math.max(2, size * 0.08);
      ctx!.setLineDash([Math.max(3, size * 0.15), Math.max(2, size * 0.1)]);
      ctx!.strokeRect(sx + 1, sy + 1, size - 3, size - 3);
      ctx!.setLineDash([]);
    }
  }

  function renderSide(): void {
    if (!view) return;
    const { me, myTile } = view;

    const lista = (titulo: string, items: string[]) =>
      `<h3>${esc(titulo)}</h3>` +
      (items.length ? `<ul>${items.map(i => `<li>${i}</li>`).join('')}</ul>` : '<p class="worldmap-empty">Nada a la vista.</p>');

    const dist = (d: number) => (d === 0 ? 'aquí mismo' : `a ${d} ${d === 1 ? 'casilla' : 'casillas'}`);

    side!.innerHTML = [
      `<div class="worldmap-me">
         <h2>${esc(me.characterName ?? 'Tu personaje')}</h2>
         <p class="worldmap-coords">(${me.x}, ${me.y})${myTile?.terrainName ? ` · ${esc(myTile.terrainEmoji ?? '')} ${esc(myTile.terrainName)}` : ''}${myTile?.zoneName ? ` · ${esc(myTile.zoneName)}` : ''}</p>
         ${myTile?.temperature != null ? `<p class="worldmap-vitals">${icon('thermometer', { size: 13 })} ${esc(formatTemperature(myTile.temperature))} · ${esc(describeTemperature(myTile.temperature))}</p>` : ''}
         <p class="worldmap-vitals">${icon('heart', { size: 13 })} ${me.hp}/10 · ${icon('package', { size: 13 })} ${me.hunger}/10${me.isAlive ? '' : ` · ${icon('skull', { size: 13 })} muerto`}</p>
         <p class="worldmap-vitals">${icon('sparkles', { size: 13 })} ${me.laburoAvailable.toFixed(2)} Laburo${me.laburoCooldownSeconds > 0 ? ` · próximo laburo en ${formatDuration(me.laburoCooldownSeconds)}` : ''}</p>
       </div>`,
      renderActions(myTile, me.isAlive, me.laburoCooldownSeconds, me.hunger),
      lista('Jugadores cerca', view.players.map(p =>
        `${esc(p.characterName ?? 'Alguien')} <span class="worldmap-dist">${esc(dist(p.distance))}</span>`)),
      lista('Construcciones', view.constructions.map(c =>
        `${emojiOr(c.emoji, 'building')} ${esc(c.name)} <span class="worldmap-dist">${esc(dist(c.distance))}</span>` +
        (c.maxHealth ? ` <span class="worldmap-dist">${icon('heart', { size: 12 })} ${esc(c.health ?? c.maxHealth)}/${esc(c.maxHealth)}</span>` : ''))),
      (() => {
        const porFaccion = new Map<string, { emoji: string | null; casillas: number }>();
        for (const t of view!.visible) {
          const nombre = t.faction_display_name ?? t.faction_name;
          if (!nombre) continue;
          const y = porFaccion.get(nombre) ?? { emoji: t.faction_emoji ?? null, casillas: 0 };
          y.casillas += 1;
          porFaccion.set(nombre, y);
        }
        return lista('Facciones a la vista', [...porFaccion.entries()].map(([nombre, d]) =>
          `${emojiOr(d.emoji, 'flag')} ${esc(nombre)} <span class="worldmap-dist">${d.casillas} ${d.casillas === 1 ? 'casilla' : 'casillas'}</span>`));
      })(),
      lista('NPCs', view.npcs.map(n =>
        `${emojiOr(n.emoji, 'skull')} ${esc(n.name)}` +
        (n.factionName ? ` <span class="worldmap-dist">${emojiOr(n.factionEmoji, 'flag')} ${esc(n.factionName)}</span>` : '') +
        ` <span class="worldmap-dist">${esc(dist(n.distance))}</span>`)),
      `<p class="worldmap-note">Ves hasta <b>${view.radius}</b> casillas a la redonda. Lo gris es mundo conocido, pero no sabes qué hay ahí.</p>`,
    ].join('');

    wireActions();
  }

  function travelCountdownText(arrivalAt: string): string {
    const remainingSeconds = Math.round((new Date(arrivalAt).getTime() - Date.now()) / 1000);
    return remainingSeconds <= 0 ? 'llegando…' : `≈ ${formatDuration(remainingSeconds)}`;
  }

  function travelCountdownHtml(arrivalAt: string | null): string {
    if (!arrivalAt) return '—';
    return `<span data-travel-countdown data-arrival="${esc(arrivalAt)}">${esc(travelCountdownText(arrivalAt))}</span>`;
  }

  function updateTravelCountdowns(): void {
    document.querySelectorAll<HTMLElement>('[data-travel-countdown]').forEach(el => {
      const arrivalAt = el.dataset.arrival;
      if (arrivalAt) el.textContent = travelCountdownText(arrivalAt);
    });
  }

  function renderActions(myTile: MyTile | null, isAlive: boolean, laburoCooldownSeconds: number, hunger: number): string {
    if (!isAlive) {
      return '<div class="worldmap-actions"><h3>Acciones</h3><p class="worldmap-empty">Tu personaje está muerto — usa <code>/personaje rendirse</code> o espera a que Staff te reviva.</p></div>';
    }

    const travelBlock = myTile?.travel
      ? `<p class="worldmap-note">${
          myTile.travel.paused
            ? `${icon('alert-triangle', { size: 13 })} Viaje pausado por un encuentro.`
            : `${icon('map', { size: 13 })} Viajando hacia (${myTile.travel.destX}, ${myTile.travel.destY}) — llega en ${travelCountdownHtml(myTile.travel.arrivalAt)}.`
        }</p>
         <div class="worldmap-action-row">
           ${myTile.travel.paused ? `<button type="button" class="btn-secondary btn-danger" data-open-attack>${icon('crosshair', { size: 14 })} Atacar</button>
           <button type="button" class="btn-secondary" data-action-flee>${icon('play', { size: 14 })} Huir</button>` : ''}
           <button type="button" class="btn-secondary" data-action-cancel-travel>Cancelar viaje</button>
         </div>`
      : `<form data-action-travel class="worldmap-travel-form">
           <input type="number" name="x" placeholder="X" required>
           <input type="number" name="y" placeholder="Y" required>
           <button type="submit" class="btn-primary">Viajar</button>
         </form>`;

    const onCooldown = laburoCooldownSeconds > 0;
    const laburoButton = onCooldown
      ? `<button type="button" class="btn-secondary" disabled title="Disponible en ${esc(formatDuration(laburoCooldownSeconds))}">${icon('sparkles', { size: 14 })} Laburar (${esc(formatDuration(laburoCooldownSeconds))})</button>`
      : `<button type="button" class="btn-secondary" data-action-laburo>${icon('sparkles', { size: 14 })} Laburar</button>`;

    const gatherButtons = myTile && myTile.gatherable.length > 0
      ? myTile.gatherable.map(g => `<button type="button" class="btn-secondary" data-action-gather="${esc(g.name)}">${emojiOr(g.emoji, 'package')} Recolectar ${esc(g.displayName)}</button>`).join('')
      : '';

    const eatButtons = hunger / 10 <= 0.3
      ? inventory.filter(i => i.is_consumable).map(i => `<button type="button" class="btn-secondary" data-action-consume="${esc(i.name)}">${emojiOr(i.emoji, 'heart')} Comer ${esc(i.display_name)}</button>`).join('')
      : '';

    const grabButtons = myTile && myTile.items.length > 0
      ? myTile.items.map(i => `<button type="button" class="btn-secondary" data-action-grab="${esc(i.name)}">${emojiOr(i.emoji, 'package')} Coger ${esc(i.displayName)} ×${i.quantity}</button>`).join('')
      : '';

    const constructionBlocks = myTile && myTile.constructions.length > 0
      ? myTile.constructions.map(c => {
          const refuelForm = c.hasFuel && !c.isRuined
            ? `<form data-action-refuel="${esc(c.typeName)}" data-action-refuel-id="${c.id}" class="worldmap-inline-form">
                 <input type="number" name="quantity" placeholder="Repostar" min="0.01" step="0.01" required>
                 <button type="submit" class="btn-icon" title="Repostar">${icon('upload', { size: 14 })}</button>
               </form>`
            : '';
          return `<div class="worldmap-construction-row">
            <span>${emojiOr(c.emoji, 'building')} ${esc(c.name)}${c.maxHealth ? ` <span class="worldmap-dist">${icon('heart', { size: 12 })} ${esc(String(c.health ?? c.maxHealth))}/${esc(String(c.maxHealth))}${c.isRuined ? ' · en ruinas' : ''}</span>` : ''}</span>
            <span class="worldmap-construction-actions">
              ${c.isRuined ? '' : `<button type="button" class="btn-secondary" data-action-use="${esc(c.typeName)}" data-action-use-id="${c.id}">Usar</button>`}
              ${c.isRuined ? `<button type="button" class="btn-secondary" data-action-repair="${esc(c.typeName)}" data-action-repair-id="${c.id}">${icon('settings', { size: 14 })} Reparar</button>` : ''}
              ${refuelForm}
              <button type="button" class="btn-icon btn-danger" data-action-destroy="${c.id}" data-action-destroy-name="${esc(c.name)}" title="Destruir">${icon('trash', { size: 14 })}</button>
            </span>
          </div>`;
        }).join('')
      : '';

    return `<div class="worldmap-actions">
      <h3>Acciones</h3>
      ${travelBlock}
      <div class="worldmap-action-row">
        ${laburoButton}
        ${eatButtons}
        ${gatherButtons}
        ${grabButtons}
      </div>
      ${constructionBlocks}
      <div class="worldmap-action-row">
        <button type="button" class="btn-secondary btn-danger" data-open-attack>${icon('crosshair', { size: 15 })} Atacar</button>
        <button type="button" class="btn-secondary" data-open-craft>${icon('brush', { size: 15 })} Craftear</button>
        <button type="button" class="btn-secondary" data-open-trade>${icon('refresh', { size: 15 })} Intercambiar</button>
      </div>
    </div>`;
  }

  function openAttackPanel(): void {
    if (!attackPanel) return;
    attackStep = 'weapon';
    attackSelectedWeaponId = null;
    attackSelectedTarget = null;
    openModal(attackPanel);
    void renderAttackWeaponStep();
  }

  function paintAttackPanel(bodyHtml: string): void {
    if (!attackPanel) return;
    panelShell(attackPanel, 'crosshair', 'Atacar', `${bodyHtml}<p id="attack-status" class="hint" role="status"></p>`);
  }

  async function renderAttackWeaponStep(): Promise<void> {
    if (!attackPanel) return;
    paintAttackPanel('<p class="hint"><span class="spinner"></span> Cargando armas…</p>');

    try {
      attackWeapons = await apiFetch<AttackWeapon[]>('/api/game/attack/weapons');
    } catch (err) {
      if (!attackPanel) return;
      attackPanel.querySelector('#attack-status')!.textContent = err instanceof ApiError ? err.message : 'Error desconocido.';
      return;
    }
    if (!attackPanel) return;

    const weaponOptions = attackWeapons.map(w => {
      const parts = [w.range > 0 ? `Alcance máx. ${w.range}` : 'Sin alcance (solo tu casilla)'];
      if (w.damage) parts.push(`daño ${w.damage}`);
      if (w.structureDamage) parts.push('daña estructuras');
      return `<button type="button" class="worldmap-attack-option" data-weapon-id="${esc(w.id)}">
          <span class="worldmap-attack-option-label">${icon('crosshair', { size: 14 })} ${esc(w.displayName)}</span>
          <span class="worldmap-attack-option-detail">${esc(parts.join(' · '))}</span>
        </button>`;
    }).join('');

    const bodyHtml = `<p class="hint">Elige primero el arma — lo que puedas atacar depende de hasta dónde llegue.</p>
      <div class="worldmap-attack-list">
        ${weaponOptions}
        <button type="button" class="worldmap-attack-option" data-weapon-id="m">
          <span class="worldmap-attack-option-label">Cuerpo a cuerpo (sin arma)</span>
          <span class="worldmap-attack-option-detail">Solo contra jugadores de tu misma casilla</span>
        </button>
      </div>`;

    paintAttackPanel(bodyHtml);
    attackPanel.querySelectorAll<HTMLButtonElement>('[data-weapon-id]').forEach(btn => {
      btn.addEventListener('click', () => {
        attackSelectedWeaponId = btn.dataset.weaponId!;
        attackStep = 'target';
        void renderAttackTargetStep();
      });
    });
  }

  async function renderAttackTargetStep(): Promise<void> {
    if (!attackPanel || attackSelectedWeaponId === null) return;
    paintAttackPanel('<p class="hint"><span class="spinner"></span> Buscando objetivos…</p>');

    const weapon = attackWeapons.find(w => w.id === attackSelectedWeaponId) ?? null;
    const weaponLabel = weapon ? weapon.displayName : 'los puños';

    let range = 0;
    try {
      const data = await apiFetch<{ range: number; targets: AttackTarget[] }>(
        `/api/game/attack/targets?weaponId=${encodeURIComponent(attackSelectedWeaponId)}`
      );
      attackTargets = data.targets;
      range = data.range;
    } catch (err) {
      if (!attackPanel) return;
      paintAttackPanel(
        `<p class="worldmap-empty">${esc(err instanceof ApiError ? err.message : 'Error desconocido.')}</p>
         <button type="button" class="btn-secondary" data-attack-back>Volver</button>`
      );
      attackPanel.querySelector('[data-attack-back]')?.addEventListener('click', () => {
        attackStep = 'weapon';
        void renderAttackWeaponStep();
      });
      return;
    }
    if (!attackPanel) return;

    const bodyHtml = attackTargets.length === 0
      ? `<p class="worldmap-empty">No hay nada que atacar ${range > 0 ? `a menos de ${range} casillas` : 'en tu casilla'} con ${esc(weaponLabel)}.</p>
         <button type="button" class="btn-secondary" data-attack-back>Volver</button>`
      : `<p class="hint">Con ${esc(weaponLabel)}${range > 0 ? ` (alcance máx. ${range})` : ''}.</p>
         <div class="worldmap-attack-list">
           ${attackTargets.map(t => `<button type="button" class="worldmap-attack-option" data-target-kind="${t.kind}" data-target-id="${esc(t.id)}">
               <span class="worldmap-attack-option-label">${icon(ATTACK_TARGET_ICON[t.kind], { size: 14 })} ${esc(t.label)}</span>
               <span class="worldmap-attack-option-detail">${esc(t.detail)}</span>
             </button>`).join('')}
         </div>
         <button type="button" class="btn-secondary" data-attack-back>Volver</button>`;

    paintAttackPanel(bodyHtml);
    attackPanel.querySelector('[data-attack-back]')?.addEventListener('click', () => {
      attackStep = 'weapon';
      void renderAttackWeaponStep();
    });
    attackPanel.querySelectorAll<HTMLButtonElement>('[data-target-id]').forEach(btn => {
      btn.addEventListener('click', () => {
        const kind = btn.dataset.targetKind as AttackTarget['kind'];
        const id = btn.dataset.targetId!;
        attackSelectedTarget = attackTargets.find(t => t.kind === kind && t.id === id) ?? null;
        if (!attackSelectedTarget) return;
        attackStep = 'confirm';
        renderAttackConfirmStep();
      });
    });
  }

  function renderAttackConfirmStep(): void {
    if (!attackPanel || !attackSelectedTarget) return;
    const weapon = attackWeapons.find(w => w.id === attackSelectedWeaponId) ?? null;

    const bodyHtml = `<p class="hint">¿Confirmas el ataque?</p>
      <p>Vas a atacar a <strong>${esc(attackSelectedTarget.label)}</strong> ${weapon ? `con <strong>${esc(weapon.displayName)}</strong>` : 'a puño limpio'}.</p>
      <p class="hint">${esc(attackSelectedTarget.detail)}</p>
      <div class="worldmap-action-row">
        <button type="button" class="btn-secondary btn-danger" data-attack-confirm>Atacar</button>
        <button type="button" class="btn-secondary" data-attack-back>Volver</button>
      </div>`;

    paintAttackPanel(bodyHtml);
    attackPanel.querySelector('[data-attack-back]')?.addEventListener('click', () => {
      attackStep = 'target';
      void renderAttackTargetStep();
    });
    attackPanel.querySelector('[data-attack-confirm]')?.addEventListener('click', () => void submitAttack());
  }

  async function submitAttack(): Promise<void> {
    if (attackInFlight || !attackPanel || !attackSelectedTarget || attackSelectedWeaponId === null) return;
    attackInFlight = true;
    const statusEl = attackPanel.querySelector<HTMLElement>('#attack-status')!;
    const buttons = attackPanel.querySelectorAll<HTMLButtonElement>('button');
    buttons.forEach(btn => { btn.disabled = true; });
    statusEl.textContent = 'Atacando…';

    const target = attackSelectedTarget;
    try {
      const result = await apiFetch<AttackResult>('/api/game/attack', {
        method: 'POST',
        body: { weaponId: attackSelectedWeaponId, kind: target.kind, targetId: target.id },
      });
      showToast(formatAttackResult(target, result), 'success');
      attackStep = 'weapon';
      attackSelectedTarget = null;
      await load();
      await renderAttackWeaponStep();
    } catch (err) {
      statusEl.textContent = err instanceof ApiError ? err.message : 'Error desconocido.';
      buttons.forEach(btn => { btn.disabled = false; });
    } finally {
      attackInFlight = false;
    }
  }

  function formatAttackResult(target: AttackTarget, r: AttackResult): string {
    if (r.inRange === false) return `${target.label} está fuera de alcance.`;
    if (r.selfDamage) {
      return r.attackerKilled
        ? `¡Fallaste y te has matado a ti mismo! (-${r.selfDamage} HP)`
        : `Fallaste y te has hecho daño a ti mismo (-${r.selfDamage} HP).`;
    }
    if (!r.hit) return `Fallaste el ataque contra ${target.label}.`;
    if (target.kind === 'p') {
      if (r.killed) return `¡${target.label} ha muerto! (-${r.damage} HP)`;
      return `-${r.damage} HP a ${target.label} (le quedan ${r.targetHpAfter}).`;
    }
    if (target.kind === 'n') {
      const drops = r.drops?.length ? ` — botín: ${r.drops.map(d => d.display_name).join(', ')}` : '';
      if (r.npcDied) return `¡${target.label} derrotado! (-${r.damage} HP)${drops}`;
      return `-${r.damage} HP a ${target.label} (le quedan ${r.npcHpAfter}).`;
    }
    if (r.ruinedNow) return `¡${target.label} ha quedado en ruinas! (-${r.damage} HP)`;
    return `-${r.damage} HP a ${target.label} (le quedan ${r.healthAfter}).`;
  }

  async function renderCraftPanel(): Promise<void> {
    if (!craftPanel) return;
    panelShell(craftPanel, 'brush', 'Craftear', '<p class="hint"><span class="spinner"></span> Cargando…</p>');

    let craftOptions: CraftOption[];
    try {
      craftOptions = await apiFetch<CraftOption[]>('/api/game/craft/options');
    } catch (err) {
      panelShell(craftPanel, 'brush', 'Craftear', `<p class="hint">${icon('alert-circle', { size: 14 })} ${esc(err instanceof ApiError ? err.message : 'No se pudo cargar.')}</p>`);
      return;
    }

    panelShell(craftPanel, 'brush', 'Craftear', `<div class="tile-detail-list">${craftOptionsHtml(craftOptions)}</div><p id="craft-status" class="hint" role="status"></p>`);
    wireCraftButtons(craftPanel, async (recipeId, itemName) => {
      const statusEl = craftPanel!.querySelector<HTMLElement>('#craft-status')!;
      statusEl.textContent = 'Crafteando…';
      try {
        const body = await apiFetch<{ result: { display_name: string; quantity: number } }>('/api/game/craft', {
          method: 'POST', body: { itemName, recipeId },
        });
        showToast(`+${body.result.quantity} ${body.result.display_name}`, 'success');
        await load();
        await renderCraftPanel();
      } catch (err) {
        statusEl.textContent = err instanceof ApiError ? err.message : 'Error desconocido.';
      }
    });
  }

  function renderTradePanel(): void {
    if (!tradePanel || !view) return;
    const myTile = view.myTile;
    const othersHere = (myTile?.playersHere ?? []).filter((n): n is string => !!n);
    const tradeItemOptions = [
      '<option value="laburo">Laburo</option>',
      ...inventory.filter(i => i.item_type !== 'laburo').map(i => `<option value="${esc(i.name)}">${i.emoji ? esc(i.emoji) + ' ' : ''}${esc(i.display_name)} ×${i.quantity}</option>`),
    ].join('');

    const bodyHtml = othersHere.length > 0
      ? `<form data-action-trade class="worldmap-travel-form">
           <select name="characterName" required>
             <option value="" disabled selected>Comerciar con…</option>
             ${othersHere.map(n => `<option value="${esc(n)}">${esc(n)}</option>`).join('')}
           </select>
           <select name="itemName" required>${tradeItemOptions}</select>
           <input type="number" name="quantity" placeholder="Cantidad" min="0.01" step="0.01" required>
           <button type="submit" class="btn-secondary">${icon('refresh', { size: 14 })} Dar</button>
         </form>`
      : '<p class="worldmap-empty">No hay otros jugadores en tu casilla.</p>';

    panelShell(tradePanel, 'refresh', 'Intercambiar', `${bodyHtml}<p id="trade-status" class="hint" role="status"></p>`);

    tradePanel.querySelector('[data-action-trade]')?.addEventListener('submit', evt => {
      evt.preventDefault();
      const form = evt.target as HTMLFormElement;
      const characterName = (form.elements.namedItem('characterName') as HTMLSelectElement).value;
      const itemName = (form.elements.namedItem('itemName') as HTMLSelectElement).value;
      const quantity = Number((form.elements.namedItem('quantity') as HTMLInputElement).value);
      const isLaburo = itemName === 'laburo';
      const statusEl = tradePanel!.querySelector<HTMLElement>('#trade-status')!;
      statusEl.textContent = 'Enviando…';
      void (async () => {
        try {
          const r = await apiFetch<{ toCharacterName: string; quantity: number; item?: { display_name: string }; pending?: boolean }>(
            isLaburo ? '/api/game/laburo/trade' : '/api/game/trade',
            { method: 'POST', body: isLaburo ? { characterName, quantity } : { characterName, itemName, quantity } },
          );
          showToast(
            r.pending
              ? `Propuesta enviada: ${r.quantity} ${r.item?.display_name ?? ''} a ${r.toCharacterName} — esperando que la acepte por Discord.`
              : `Le diste ${r.quantity} ${r.item?.display_name ?? 'de Laburo'} a ${r.toCharacterName}.`,
            'success',
          );
          await load();
          renderTradePanel();
        } catch (err) {
          statusEl.textContent = err instanceof ApiError ? err.message : 'Error desconocido.';
        }
      })();
    });
  }

  async function runAction(fn: () => Promise<unknown>, successMessage?: (result: unknown) => string): Promise<void> {
    if (actionInFlight) return;
    actionInFlight = true;
    side!.classList.add('is-busy');
    try {
      const result = await fn();
      if (successMessage) showToast(successMessage(result), 'success');
      await load();
    } catch (err) {
      showToast(err instanceof ApiError ? err.message : 'Error desconocido.', 'error');
    } finally {
      actionInFlight = false;
      side!.classList.remove('is-busy');
    }
  }

  function wireActions(): void {
    side!.querySelector('[data-action-travel]')?.addEventListener('submit', evt => {
      evt.preventDefault();
      const form = evt.target as HTMLFormElement;
      const x = Number((form.elements.namedItem('x') as HTMLInputElement).value);
      const y = Number((form.elements.namedItem('y') as HTMLInputElement).value);
      void runAction(
        () => apiFetch('/api/game/travel', { method: 'POST', body: { x, y } }),
        () => `En marcha hacia (${x}, ${y}).`,
      );
    });

    side!.querySelector('[data-action-cancel-travel]')?.addEventListener('click', () => {
      void runAction(() => apiFetch('/api/game/travel/cancel', { method: 'POST' }), () => 'Viaje cancelado.');
    });

    side!.querySelector('[data-action-flee]')?.addEventListener('click', () => {
      void runAction(
        () => apiFetch<FleeResult>('/api/game/flee', { method: 'POST' }),
        (r) => {
          const result = r as FleeResult;
          if (!result.blocked) return result.freed ? 'Ya no hay nada reteniéndote.' : 'No hay ningún encuentro reteniéndote ahora mismo.';
          if (result.success) return `Escapaste de ${result.label}.`;
          if (result.success === false) {
            const detail = result.lines[0] ? ` ${result.lines[0].replace(/\*\*/g, '')}` : '';
            return `No consigues huir de ${result.label}.${detail}`;
          }
          return result.lines[0]?.replace(/\*\*/g, '') ?? 'Encuentro resuelto.';
        },
      );
    });

    side!.querySelector('[data-action-laburo]')?.addEventListener('click', () => {
      void runAction(
        () => apiFetch<{ amount: number; totalAvailable: number }>('/api/game/laburo', { method: 'POST' }),
        (r) => {
          const result = r as { amount: number; totalAvailable: number };
          return `+${result.amount} de Laburo (tienes ${result.totalAvailable}).`;
        },
      );
    });

    side!.querySelector('[data-open-attack]')?.addEventListener('click', openAttackPanel);

    side!.querySelector('[data-open-craft]')?.addEventListener('click', () => {
      if (!craftPanel) return;
      openModal(craftPanel);
      void renderCraftPanel();
    });

    side!.querySelector('[data-open-trade]')?.addEventListener('click', () => {
      if (!tradePanel) return;
      renderTradePanel();
      openModal(tradePanel);
    });

    side!.querySelectorAll<HTMLButtonElement>('[data-action-gather]').forEach(btn => {
      btn.addEventListener('click', () => {
        const itemName = btn.dataset.actionGather!;
        void runAction(
          () => apiFetch<{ hit: boolean; grantedItemDisplay: string | null; grantedQuantity: number }>('/api/game/gather', { method: 'POST', body: { itemName } }),
          (r) => {
            const result = r as { hit: boolean; grantedItemDisplay: string | null; grantedQuantity: number };
            return result.hit ? `+${result.grantedQuantity} ${result.grantedItemDisplay}` : 'Esta vez no has conseguido nada.';
          },
        );
      });
    });

    side!.querySelectorAll<HTMLButtonElement>('[data-action-consume]').forEach(btn => {
      btn.addEventListener('click', () => {
        const itemName = btn.dataset.actionConsume!;
        void runAction(
          () => apiFetch<{ item: { display_name: string }; died: boolean; hpAfter: number; hungerAfter: number }>('/api/game/consume', { method: 'POST', body: { itemName } }),
          (r) => {
            const result = r as { item: { display_name: string }; died: boolean; hpAfter: number; hungerAfter: number };
            return result.died
              ? `${result.item.display_name} te ha matado.`
              : `Comiste ${result.item.display_name} (HP ${result.hpAfter}/10, Hambre ${result.hungerAfter}/10).`;
          },
        );
      });
    });

    side!.querySelectorAll<HTMLButtonElement>('[data-action-grab]').forEach(btn => {
      btn.addEventListener('click', () => {
        const itemName = btn.dataset.actionGrab!;
        void runAction(() => apiFetch('/api/game/grab', { method: 'POST', body: { itemName } }), () => 'Recogido.');
      });
    });

    side!.querySelectorAll<HTMLButtonElement>('[data-action-use]').forEach(btn => {
      btn.addEventListener('click', () => {
        const typeName = btn.dataset.actionUse!;
        const constructionId = btn.dataset.actionUseId ? Number(btn.dataset.actionUseId) : null;
        void runAction(
          () => apiFetch<{ yieldAmount: number; resultItem: { display_name: string } }>('/api/game/construction/use', { method: 'POST', body: { typeName, constructionId } }),
          (r) => {
            const result = r as { yieldAmount: number; resultItem: { display_name: string } };
            return result.yieldAmount > 0 ? `+${result.yieldAmount} ${result.resultItem.display_name}` : 'Sin suerte esta vez.';
          },
        );
      });
    });

    side!.querySelectorAll<HTMLButtonElement>('[data-action-repair]').forEach(btn => {
      btn.addEventListener('click', () => {
        const typeName = btn.dataset.actionRepair!;
        const constructionId = btn.dataset.actionRepairId ? Number(btn.dataset.actionRepairId) : null;
        void runAction(
          () => apiFetch('/api/game/construction/repair', { method: 'POST', body: { typeName, constructionId } }),
          () => 'Construcción reparada.',
        );
      });
    });

    side!.querySelectorAll<HTMLFormElement>('[data-action-refuel]').forEach(form => {
      form.addEventListener('submit', evt => {
        evt.preventDefault();
        const typeName = form.dataset.actionRefuel!;
        const constructionId = form.dataset.actionRefuelId ? Number(form.dataset.actionRefuelId) : null;
        const quantity = Number((form.elements.namedItem('quantity') as HTMLInputElement).value);
        void runAction(
          () => apiFetch<{ added: number }>('/api/game/construction/refuel', { method: 'POST', body: { typeName, constructionId, quantity } }),
          (r) => `+${(r as { added: number }).added} de combustible.`,
        );
      });
    });

    side!.querySelectorAll<HTMLButtonElement>('[data-action-destroy]').forEach(btn => {
      btn.addEventListener('click', () => {
        const constructionId = Number(btn.dataset.actionDestroy);
        const name = btn.dataset.actionDestroyName ?? 'la construcción';
        void (async () => {
          const confirmed = await showConfirm({
            title: 'Destruir construcción', message: `¿Seguro que quieres destruir ${name}? No se puede deshacer.`,
            confirmLabel: 'Destruir', danger: true,
          });
          if (!confirmed) return;
          await runAction(
            () => apiFetch('/api/game/construction/destroy', { method: 'POST', body: { constructionId } }),
            () => `${name} destruida.`,
          );
        })();
      });
    });
  }

  function updateGoButton(): void {
    if (!goBtn) return;
    if (!selectedTile || (view && selectedTile.x === view.me.x && selectedTile.y === view.me.y)) {
      goBtn.hidden = true;
      return;
    }
    goBtn.hidden = false;
    goBtn.innerHTML = `${icon('map', { size: 14 })} Ir a (${selectedTile.x}, ${selectedTile.y})`;
  }

  function selectTile(tile: { x: number; y: number }): void {
    if (!view) return;
    selectedTile = selectedTile && selectedTile.x === tile.x && selectedTile.y === tile.y ? null : tile;
    updateGoButton();
    draw();
  }

  goBtn?.addEventListener('click', () => {
    if (!selectedTile) return;
    const { x, y } = selectedTile;
    void runAction(
      () => apiFetch('/api/game/travel', { method: 'POST', body: { x, y } }),
      () => `En marcha hacia (${x}, ${y}).`,
    );
    selectedTile = null;
    updateGoButton();
    draw();
  });

  const CLICK_DRAG_THRESHOLD = 6;
  let dragging = false;
  let lastX = 0;
  let lastY = 0;
  let dragDistance = 0;

  canvas.addEventListener('pointerdown', (e) => {
    dragging = true;
    lastX = e.clientX;
    lastY = e.clientY;
    dragDistance = 0;
    canvas.setPointerCapture(e.pointerId);
  });
  canvas.addEventListener('pointermove', (e) => {
    if (coordHint) {
      const rect = canvas.getBoundingClientRect();
      const { x, y } = toWorld(e.clientX - rect.left, e.clientY - rect.top);
      coordHint.textContent = `(${x}, ${y})`;
    }
    if (!dragging) return;
    const dx = e.clientX - lastX;
    const dy = e.clientY - lastY;
    dragDistance += Math.abs(dx) + Math.abs(dy);
    panX += dx;
    panY += dy;
    lastX = e.clientX;
    lastY = e.clientY;
    draw();
  });
  canvas.addEventListener('pointerleave', () => {
    if (coordHint) coordHint.textContent = '';
  });
  const stop = (e: PointerEvent) => {
    dragging = false;
    if (canvas.hasPointerCapture(e.pointerId)) canvas.releasePointerCapture(e.pointerId);
  };
  canvas.addEventListener('pointerup', (e) => {
    const wasClick = dragDistance < CLICK_DRAG_THRESHOLD;
    stop(e);
    if (wasClick) {
      const rect = canvas.getBoundingClientRect();
      selectTile(toWorld(e.clientX - rect.left, e.clientY - rect.top));
    }
  });
  canvas.addEventListener('pointercancel', stop);

  canvas.addEventListener('wheel', (e) => {
    e.preventDefault();
    zoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom * (e.deltaY < 0 ? 1.15 : 1 / 1.15)));
    draw();
  }, { passive: false });

  canvas.addEventListener('dblclick', () => {
    fitToView();
    draw();
  });

  const reduceMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
  const FRAME_INTERVAL_MS = 66;
  let lastFrameAt = 0;

  function frame(now: number): void {
    if (!document.hidden && now - lastFrameAt >= FRAME_INTERVAL_MS) {
      lastFrameAt = now;
      draw();
    }
    if (!reduceMotion) rafId = requestAnimationFrame(frame);
  }
  new ResizeObserver(resize).observe(canvas);
  resize();
  void load();
  rafId = requestAnimationFrame(frame);

  window.addEventListener('beforeunload', () => cancelAnimationFrame(rafId));

  const refreshIntervalId = setInterval(() => {
    if (!document.hidden) void withPassive(load);
  }, 15_000);
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) void withPassive(load);
  });
  window.addEventListener('beforeunload', () => clearInterval(refreshIntervalId));

  const travelCountdownIntervalId = setInterval(updateTravelCountdowns, 30_000);
  window.addEventListener('beforeunload', () => clearInterval(travelCountdownIntervalId));

  initPlayerLive((text, action) => {
    showToast(text, 'info', action === 'open-attack' ? openAttackPanel : undefined);
    if (!document.hidden) void withPassive(load);
  });
}
