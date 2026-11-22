import { apiFetch, ApiError } from './api';
import { escapeHtml, escapeAttr } from './html';
import { icon } from '../lib/icons';
import { showToast, showConfirm, openModal, closeAllModals } from './ui';
import { statusPillHtml } from './statusPill';
import { initLiveUpdates } from './liveUpdates';
import { formatTemperature, describeTemperature } from './format';

interface TileLight {
  id: number; coord_x: number; coord_y: number; name: string;
  terrain_name: string; terrain_display_name: string; terrain_emoji: string; terrain_color: string;
  owner_username: string | null; resource_type: string | null; temperature: number | null;
  zone_id: number | null; zone_name: string | null; zone_display_name: string | null; zone_emoji: string | null; zone_color: string | null;
  item_count: number; construction_count: number; player_count: number; generator_count: number;
  player_avatars?: string[]; construction_thumbs?: { url: string | null; emoji: string | null }[]; generator_thumbs?: string[];
}
interface TileDetail extends TileLight {
  description: string | null;
  faction_display_name: string | null; faction_emoji: string | null;
  effect_type: string | null;
  players: { discord_id: string; username: string; character_name: string | null; is_alive: boolean; hp: number }[];
  constructions: { id: number; name: string; construction_type: string | null; current_health: number | null; fuel_level: number | null; durability: number | null; ct_emoji: string | null; ct_display_name: string | null; ct_max_health: number | null; ct_fuel_capacity: number | null; ct_fuel_item_name: string | null; ct_max_durability: number | null; ct_durability_loss_per_day: number | null }[];

  npcs: { id: number; type_emoji: string | null; type_display_name: string; current_hp: number; type_max_hp: number; is_wild: boolean; faction_display_name: string | null; faction_emoji: string | null }[];
  tileItems: { item_name: string; quantity: number }[];
  points_of_interest: { id: number; name: string; description: string | null; emoji: string | null }[];
}
interface TerrainType {
  name: string; display_name: string; emoji: string | null; color: string; requires_vehicle_category: string | null;
  resources: { name: string; display_name: string; emoji: string | null; quantity: number; drop_chance_percent: number }[];
}
interface FactionLite { name: string; display_name: string }
interface ZoneLite { name: string; display_name: string; emoji: string | null; color: string }
interface EffectTypeLite { name: string; label: string; emoji: string | null }
interface NpcTypeLite { id: number; display_name: string; emoji: string | null }
interface NpcGroupTypeLite { id: number; display_name: string; emoji: string | null }

export interface MapBootstrap {
  terrainTypes: TerrainType[];
  factions: FactionLite[];
  zones: ZoneLite[];
  effectTypes: EffectTypeLite[];
  npcTypes: NpcTypeLite[];
  npcGroupTypes: NpcGroupTypeLite[];
  mapMaxCoordinate: number;
}

const MIN_ZOOM = 6;
const MAX_ZOOM = 48;
const ZOOM_STEP = 1.25;
const THUMBNAIL_ZOOM_THRESHOLD = 32;
const MAX_GRID_THUMBNAILS = 9;
const TILE_LOAD_MARGIN = 4;

const FIT_MARGIN_TILES = 2;
const CHUNK_SIZE = 20;

function key(x: number, y: number) { return `${x},${y}`; }

function selectHtml(id: string, options: { value: string; label: string }[], selectedValue: string) {
  const opts = options.map(o => `<option value="${escapeAttr(o.value)}" ${o.value === selectedValue ? 'selected' : ''}>${escapeHtml(o.label)}</option>`).join('');
  return `<select id="${id}">${opts}</select>`;
}

export function initMapCanvas(root: HTMLElement, bootstrap: MapBootstrap) {
  const canvas = root.querySelector<HTMLCanvasElement>('#mapCanvas');
  const coordHint = root.querySelector<HTMLElement>('#coordHint');
  const canvasWrap = root.querySelector<HTMLElement>('.canvas-wrap');
  if (!canvas || !coordHint || !canvasWrap) return;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  const MAP_VIEW_MAX = bootstrap.mapMaxCoordinate;

  const state = {
    viewX: 0, viewY: 0,
    zoom: 20,
    maxRangeTiles: 2500,
    tilesByKey: new Map<string, TileLight>(),
    loadedChunks: new Set<string>(),
    selected: new Set<string>(),
    dragging: false, dragMoved: false, shiftDrag: false,
    marqueeStart: null as { x: number; y: number } | null,
    marqueeCurrent: null as { x: number; y: number } | null,
    lastMarqueeBounds: null as { minX: number; maxX: number; minY: number; maxY: number } | null,
    marqueeMode: 'terrain' as 'terrain' | 'faccion' | 'zona',
    showZones: true,
    lastMouseX: 0, lastMouseY: 0,
    brushActive: false,
    painting: false,
    brushTerrain: '',
    paintedTiles: new Map<string, { x: number; y: number }>(),
  };

  const terrainByName = new Map(bootstrap.terrainTypes.map(t => [t.name, t]));

  function worldToScreen(x: number, y: number) {
    return { px: (x - state.viewX) * state.zoom + canvas!.width / (window.devicePixelRatio || 1) / 2, py: (y - state.viewY) * state.zoom + canvas!.height / (window.devicePixelRatio || 1) / 2 };
  }
  function screenToWorld(px: number, py: number) {
    const w = canvas!.width / (window.devicePixelRatio || 1), h = canvas!.height / (window.devicePixelRatio || 1);
    return { x: Math.floor((px - w / 2) / state.zoom + state.viewX), y: Math.floor((py - h / 2) / state.zoom + state.viewY) };
  }
  function pointerWorld(evt: MouseEvent) {
    const rect = canvas!.getBoundingClientRect();
    return screenToWorld(evt.clientX - rect.left, evt.clientY - rect.top);
  }

  function fitViewToWorld() {
    const tiles = state.tilesByKey;
    if (tiles.size === 0) return;

    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (const t of tiles.values()) {
      if (t.coord_x < minX) minX = t.coord_x;
      if (t.coord_x > maxX) maxX = t.coord_x;
      if (t.coord_y < minY) minY = t.coord_y;
      if (t.coord_y > maxY) maxY = t.coord_y;
    }

    const worldW = maxX - minX + 1 + FIT_MARGIN_TILES * 2;
    const worldH = maxY - minY + 1 + FIT_MARGIN_TILES * 2;
    const dpr = window.devicePixelRatio || 1;
    const viewW = canvas!.width / dpr, viewH = canvas!.height / dpr;
    if (viewW === 0 || viewH === 0) return;

    state.viewX = (minX + maxX + 1) / 2;
    state.viewY = (minY + maxY + 1) / 2;
    state.zoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, Math.min(viewW / worldW, viewH / worldH)));
    updateZoomLabel();
  }

  function visibleBounds() {
    const topLeft = screenToWorld(0, 0);
    const w = canvas!.width / (window.devicePixelRatio || 1), h = canvas!.height / (window.devicePixelRatio || 1);
    const bottomRight = screenToWorld(w, h);
    return {
      minX: Math.max(0, topLeft.x - TILE_LOAD_MARGIN), maxX: Math.min(MAP_VIEW_MAX, bottomRight.x + TILE_LOAD_MARGIN),
      minY: Math.max(0, topLeft.y - TILE_LOAD_MARGIN), maxY: Math.min(MAP_VIEW_MAX, bottomRight.y + TILE_LOAD_MARGIN),
    };
  }

  function resizeCanvas() {
    const dpr = window.devicePixelRatio || 1;
    const w = canvasWrap!.clientWidth, h = canvasWrap!.clientHeight;
    canvas!.width = w * dpr;
    canvas!.height = h * dpr;
    canvas!.style.width = `${w}px`;
    canvas!.style.height = `${h}px`;
    ctx!.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  let tileLoadTimer: ReturnType<typeof setTimeout> | null = null;
  function scheduleTileLoad(immediate = false) {
    if (tileLoadTimer) clearTimeout(tileLoadTimer);
    const run = () => loadVisibleTiles().then(render).catch(err => console.error('[Mapa] Error cargando casillas:', err));
    if (immediate) run();
    else tileLoadTimer = setTimeout(run, 150);
  }

  function chunkOf(coord: number) { return Math.floor(coord / CHUNK_SIZE); }
  function chunkKey(cx: number, cy: number, withMedia: boolean) { return `${cx},${cy},${withMedia}`; }

  let fullMapPreloadPromise: Promise<void> | null = null;
  function preloadFullMapLight(): Promise<void> {
    if (fullMapPreloadPromise) return fullMapPreloadPromise;
    fullMapPreloadPromise = apiFetch<{ tiles: TileLight[] }>(`/api/tiles?minX=0&maxX=${MAP_VIEW_MAX}&minY=0&maxY=${MAP_VIEW_MAX}&withMedia=false`)
      .then(data => {
        for (const t of data.tiles) state.tilesByKey.set(key(t.coord_x, t.coord_y), t);
        for (let cx = 0; cx <= chunkOf(MAP_VIEW_MAX); cx++) {
          for (let cy = 0; cy <= chunkOf(MAP_VIEW_MAX); cy++) state.loadedChunks.add(chunkKey(cx, cy, false));
        }
      })
      .catch(err => {
        console.error('[Mapa] Error precargando el mapa completo, se reintentará al entrar en la vista:', err);
        fullMapPreloadPromise = null;
      });
    return fullMapPreloadPromise;
  }

  async function loadVisibleTiles(forceRefresh = false) {
    await preloadFullMapLight();
    let { minX, maxX, minY, maxY } = visibleBounds();
    const area = (maxX - minX + 1) * (maxY - minY + 1);
    if (area > state.maxRangeTiles) {
      const side = Math.floor((Math.sqrt(state.maxRangeTiles) - 1) / 2);
      minX = Math.max(0, state.viewX - side); maxX = Math.min(MAP_VIEW_MAX, state.viewX + side);
      minY = Math.max(0, state.viewY - side); maxY = Math.min(MAP_VIEW_MAX, state.viewY + side);
    }
    const withMedia = state.zoom >= THUMBNAIL_ZOOM_THRESHOLD;

    let fetchMinX = minX, fetchMaxX = maxX, fetchMinY = minY, fetchMaxY = maxY;
    if (!forceRefresh) {
      let missMinCx: number | null = null, missMaxCx: number | null = null, missMinCy: number | null = null, missMaxCy: number | null = null;
      for (let cx = chunkOf(minX); cx <= chunkOf(maxX); cx++) {
        for (let cy = chunkOf(minY); cy <= chunkOf(maxY); cy++) {
          if (state.loadedChunks.has(chunkKey(cx, cy, withMedia))) continue;
          missMinCx = missMinCx === null ? cx : Math.min(missMinCx, cx);
          missMaxCx = missMaxCx === null ? cx : Math.max(missMaxCx, cx);
          missMinCy = missMinCy === null ? cy : Math.min(missMinCy, cy);
          missMaxCy = missMaxCy === null ? cy : Math.max(missMaxCy, cy);
        }
      }
      if (missMinCx === null) return;
      const alignedMinX = Math.max(0, missMinCx * CHUNK_SIZE);
      const alignedMaxX = Math.min(MAP_VIEW_MAX, (missMaxCx as number) * CHUNK_SIZE + CHUNK_SIZE - 1);
      const alignedMinY = Math.max(0, (missMinCy as number) * CHUNK_SIZE);
      const alignedMaxY = Math.min(MAP_VIEW_MAX, (missMaxCy as number) * CHUNK_SIZE + CHUNK_SIZE - 1);

      if ((alignedMaxX - alignedMinX + 1) * (alignedMaxY - alignedMinY + 1) <= state.maxRangeTiles) {
        fetchMinX = alignedMinX; fetchMaxX = alignedMaxX;
        fetchMinY = alignedMinY; fetchMaxY = alignedMaxY;
      } else {
        fetchMinX = Math.max(minX, missMinCx * CHUNK_SIZE);
        fetchMaxX = Math.min(maxX, (missMaxCx as number) * CHUNK_SIZE + CHUNK_SIZE - 1);
        fetchMinY = Math.max(minY, (missMinCy as number) * CHUNK_SIZE);
        fetchMaxY = Math.min(maxY, (missMaxCy as number) * CHUNK_SIZE + CHUNK_SIZE - 1);
      }
    }

    const data = await apiFetch<{ tiles: TileLight[] }>(`/api/tiles?minX=${fetchMinX}&maxX=${fetchMaxX}&minY=${fetchMinY}&maxY=${fetchMaxY}&withMedia=${withMedia}`);
    for (const t of data.tiles) state.tilesByKey.set(key(t.coord_x, t.coord_y), t);

    const chunkCovered = (c: number, from: number, to: number) =>
      Math.max(c * CHUNK_SIZE, 0) >= from && Math.min(c * CHUNK_SIZE + CHUNK_SIZE - 1, MAP_VIEW_MAX) <= to;

    for (let cx = chunkOf(fetchMinX); cx <= chunkOf(fetchMaxX); cx++) {
      if (!chunkCovered(cx, fetchMinX, fetchMaxX)) continue;
      for (let cy = chunkOf(fetchMinY); cy <= chunkOf(fetchMaxY); cy++) {
        if (chunkCovered(cy, fetchMinY, fetchMaxY)) state.loadedChunks.add(chunkKey(cx, cy, withMedia));
      }
    }
  }

  let pendingFrame: number | null = null;
  function scheduleRender() {
    if (pendingFrame !== null) return;
    pendingFrame = requestAnimationFrame(() => { pendingFrame = null; render(); });
  }

  const thumbnailImageCache = new Map<string, HTMLImageElement>();
  let pendingImageRender: ReturnType<typeof setTimeout> | null = null;
  function scheduleRenderOnImageLoad() {
    if (pendingImageRender) return;
    pendingImageRender = setTimeout(() => { pendingImageRender = null; render(); }, 80);
  }
  function getCachedImage(url: string | null | undefined): HTMLImageElement | null {
    if (!url) return null;
    let img = thumbnailImageCache.get(url);
    if (!img) {
      img = new Image();
      img.onload = scheduleRenderOnImageLoad;
      img.onerror = () => {};
      img.src = url;
      thumbnailImageCache.set(url, img);
    }
    return img.complete && img.naturalWidth > 0 ? img : null;
  }
  function drawImageThumbnail(url: string | null | undefined, x: number, y: number, w: number, h: number, circular: boolean) {
    const img = getCachedImage(url);
    if (!img) return;
    ctx!.save();
    ctx!.beginPath();
    if (circular) {
      const r = Math.min(w, h) / 2;
      ctx!.arc(x + w / 2, y + h / 2, r, 0, Math.PI * 2);
    } else {
      const r = Math.min(w, h) * 0.18;
      ctx!.moveTo(x + r, y);
      ctx!.arcTo(x + w, y, x + w, y + h, r);
      ctx!.arcTo(x + w, y + h, x, y + h, r);
      ctx!.arcTo(x, y + h, x, y, r);
      ctx!.arcTo(x, y, x + w, y, r);
      ctx!.closePath();
    }
    ctx!.clip();
    ctx!.drawImage(img, x, y, w, h);
    ctx!.restore();
  }
  function drawThumbnailGrid(items: { kind: string; url?: string | null; emoji?: string | null }[], px: number, py: number, size: number) {
    if (items.length === 0) return;
    const cols = Math.ceil(Math.sqrt(items.length));
    const rows = Math.ceil(items.length / cols);
    const cellW = size / cols, cellH = size / rows, pad = 1;
    items.forEach((item, i) => {
      const cx = px + (i % cols) * cellW;
      const cy = py + Math.floor(i / cols) * cellH;
      const w = Math.max(1, cellW - pad), h = Math.max(1, cellH - pad);
      if (item.kind === 'player') {
        drawImageThumbnail(item.url, cx, cy, w, h, true);
      } else if (item.url) {
        drawImageThumbnail(item.url, cx, cy, w, h, false);
      } else {
        ctx!.font = `${Math.floor(Math.min(w, h) * 0.75)}px sans-serif`;
        ctx!.textAlign = 'center'; ctx!.textBaseline = 'middle';
        ctx!.fillText(item.emoji ?? (item.kind === 'generator' ? '⚙️' : '🏗️'), cx + w / 2, cy + h / 2);
        ctx!.textAlign = 'left'; ctx!.textBaseline = 'alphabetic';
      }
    });
  }
  function drawTileMedia(tile: TileLight | undefined, px: number, py: number) {
    if (!tile || state.zoom < 12) return;
    const size = state.zoom;
    if (size < THUMBNAIL_ZOOM_THRESHOLD) {
      const glyphs: string[] = [];
      if (tile.player_count > 0) glyphs.push('👤');
      if (tile.construction_count > 0) glyphs.push('🏗️');
      if (tile.generator_count > 0) glyphs.push('⚙️');
      if (tile.item_count > 0) glyphs.push('📦');
      if (glyphs.length > 0) {
        ctx!.font = `${Math.floor(size * 0.55)}px sans-serif`;
        ctx!.textBaseline = 'top';
        ctx!.fillText(glyphs[0], px + 1, py + 1);
      }
      return;
    }
    const totalEntities = (tile.player_count ?? 0) + (tile.construction_count ?? 0) + (tile.generator_count ?? 0);
    if (totalEntities > 0) {
      if (totalEntities <= MAX_GRID_THUMBNAILS) {
        const items = [
          ...(tile.player_avatars ?? []).map(url => ({ kind: 'player', url })),
          ...(tile.construction_thumbs ?? []).map(t => ({ kind: 'construction', url: t.url, emoji: t.emoji })),
          ...(tile.generator_thumbs ?? []).map(emoji => ({ kind: 'generator', emoji })),
        ];
        drawThumbnailGrid(items, px, py, size);
      } else {
        const glyph = tile.player_count > 0 ? '👤' : tile.construction_count > 0 ? '🏗️' : '⚙️';
        ctx!.font = `${Math.floor(size * 0.5)}px sans-serif`;
        ctx!.textBaseline = 'top';
        ctx!.fillText(glyph, px + 2, py + 2);
        ctx!.font = `bold ${Math.max(9, Math.floor(size * 0.22))}px sans-serif`;
        ctx!.fillStyle = '#1a1a1a';
        ctx!.textBaseline = 'bottom';
        ctx!.fillText(String(totalEntities), px + 3, py + size - 2);
      }
    }
    if (tile.item_count > 0) {
      ctx!.font = `${Math.max(9, Math.floor(size * 0.3))}px sans-serif`;
      ctx!.textAlign = 'right'; ctx!.textBaseline = 'bottom';
      ctx!.fillText('📦', px + size - 2, py + size - 2);
      ctx!.textAlign = 'left';
    }
  }

  function render() {
    const w = canvas!.width / (window.devicePixelRatio || 1), h = canvas!.height / (window.devicePixelRatio || 1);
    ctx!.clearRect(0, 0, w, h);
    const { minX, maxX, minY, maxY } = visibleBounds();

    for (let x = minX; x <= maxX; x++) {
      for (let y = minY; y <= maxY; y++) {
        const { px, py } = worldToScreen(x, y);
        if (px < -state.zoom || py < -state.zoom || px > w + state.zoom || py > h + state.zoom) continue;
        const tile = state.tilesByKey.get(key(x, y));

        ctx!.fillStyle = !tile ? ((x + y) % 2 === 0 ? 'rgba(120,120,120,0.08)' : 'rgba(120,120,120,0.14)') : tile.terrain_color;
        ctx!.fillRect(px, py, state.zoom, state.zoom);

        drawTileMedia(tile, px, py);

        if (state.selected.has(key(x, y))) {
          ctx!.strokeStyle = '#ffcc00'; ctx!.lineWidth = 2;
          ctx!.strokeRect(px + 1, py + 1, state.zoom - 2, state.zoom - 2);
        } else if (state.zoom >= 8) {
          ctx!.strokeStyle = 'rgba(0,0,0,0.15)'; ctx!.lineWidth = 1;
          ctx!.strokeRect(px + 0.5, py + 0.5, state.zoom - 1, state.zoom - 1);
        }
      }
    }

    if (state.showZones) drawZoneBorders(minX, maxX, minY, maxY, w, h);

    if (state.marqueeStart && state.marqueeCurrent) {
      const x1 = Math.min(state.marqueeStart.x, state.marqueeCurrent.x);
      const y1 = Math.min(state.marqueeStart.y, state.marqueeCurrent.y);
      const x2 = Math.max(state.marqueeStart.x, state.marqueeCurrent.x) + 1;
      const y2 = Math.max(state.marqueeStart.y, state.marqueeCurrent.y) + 1;
      const a = worldToScreen(x1, y1), b = worldToScreen(x2, y2);
      ctx!.strokeStyle = '#ffcc00'; ctx!.lineWidth = 2; ctx!.setLineDash([6, 4]);
      ctx!.strokeRect(a.px, a.py, b.px - a.px, b.py - a.py);
      ctx!.setLineDash([]);
      ctx!.fillStyle = 'rgba(255,204,0,0.12)';
      ctx!.fillRect(a.px, a.py, b.px - a.px, b.py - a.py);
    }

    updateZoomLabel();
  }

  function drawZoneBorders(minX: number, maxX: number, minY: number, maxY: number, w: number, h: number) {
    const zoneAt = (x: number, y: number) => state.tilesByKey.get(key(x, y))?.zone_id ?? null;

    ctx!.lineWidth = Math.max(2, Math.round(state.zoom / 10));
    for (let x = minX; x <= maxX; x++) {
      for (let y = minY; y <= maxY; y++) {
        const tile = state.tilesByKey.get(key(x, y));
        if (!tile?.zone_id || !tile.zone_color) continue;
        const { px, py } = worldToScreen(x, y);
        if (px < -state.zoom || py < -state.zoom || px > w + state.zoom || py > h + state.zoom) continue;

        ctx!.strokeStyle = tile.zone_color;
        ctx!.beginPath();
        if (zoneAt(x, y - 1) !== tile.zone_id) { ctx!.moveTo(px, py); ctx!.lineTo(px + state.zoom, py); }
        if (zoneAt(x, y + 1) !== tile.zone_id) { ctx!.moveTo(px, py + state.zoom); ctx!.lineTo(px + state.zoom, py + state.zoom); }
        if (zoneAt(x - 1, y) !== tile.zone_id) { ctx!.moveTo(px, py); ctx!.lineTo(px, py + state.zoom); }
        if (zoneAt(x + 1, y) !== tile.zone_id) { ctx!.moveTo(px + state.zoom, py); ctx!.lineTo(px + state.zoom, py + state.zoom); }
        ctx!.stroke();
      }
    }
  }

  function updateZoomLabel() {
    const zoomLabel = ctl('#zoomLabel');
    if (zoomLabel) zoomLabel.textContent = `${Math.round((state.zoom / 20) * 100)}%`;
  }

  function paintTileLocally(x: number, y: number) {
    const tile = state.tilesByKey.get(key(x, y));
    const terrain = terrainByName.get(state.brushTerrain);
    if (!tile || !terrain || tile.terrain_name === terrain.name) return;
    tile.terrain_name = terrain.name;
    tile.terrain_display_name = terrain.display_name;
    tile.terrain_emoji = terrain.emoji ?? '';
    tile.terrain_color = terrain.color;
    state.paintedTiles.set(key(x, y), { x, y });
    render();
  }
  async function flushBrushPaint() {
    if (state.paintedTiles.size === 0) return;
    const tiles = [...state.paintedTiles.values()];
    const terrainType = state.brushTerrain;
    state.paintedTiles.clear();
    try {
      const result = await apiFetch<{ updated: number; errors: unknown[] }>('/api/tiles/bulk', { method: 'POST', body: { tiles, updates: { terrainType } } });
      showToast(`Terreno pintado en ${result.updated} casilla(s)${result.errors.length ? `, ${result.errors.length} con error` : ''}.`, 'success');
    } catch (err) {
      showToast(err instanceof ApiError ? err.message : 'Error al pintar.', 'error');
    }
    await loadVisibleTiles(true);
    render();
  }

  function onMouseDown(evt: MouseEvent) {
    if (state.brushActive && !evt.shiftKey) {
      state.painting = true;
      const { x, y } = pointerWorld(evt);
      paintTileLocally(x, y);
      return;
    }
    state.dragging = true;
    state.dragMoved = false;
    state.shiftDrag = evt.shiftKey;
    state.lastMouseX = evt.clientX;
    state.lastMouseY = evt.clientY;
    if (state.shiftDrag) {
      state.marqueeStart = pointerWorld(evt);
      state.marqueeCurrent = state.marqueeStart;
    }
  }
  function onMouseMove(evt: MouseEvent) {
    if (state.painting) {
      const { x, y } = pointerWorld(evt);
      paintTileLocally(x, y);
      coordHint!.textContent = `(${x}, ${y}) — pintando…`;
      return;
    }
    if (state.dragging) {
      const dx = evt.clientX - state.lastMouseX, dy = evt.clientY - state.lastMouseY;
      if (Math.abs(dx) > 2 || Math.abs(dy) > 2) state.dragMoved = true;
      if (state.dragMoved) {
        if (state.shiftDrag) {
          state.marqueeCurrent = pointerWorld(evt);
          scheduleRender();
        } else {
          state.viewX = Math.min(MAP_VIEW_MAX, Math.max(0, state.viewX - dx / state.zoom));
          state.viewY = Math.min(MAP_VIEW_MAX, Math.max(0, state.viewY - dy / state.zoom));
          state.lastMouseX = evt.clientX; state.lastMouseY = evt.clientY;
          scheduleRender();
        }
      }
    }
    const { x, y } = pointerWorld(evt);
    const tile = state.tilesByKey.get(key(x, y));
    coordHint!.textContent = tile ? `(${x}, ${y}) — ${tile.name}` : `(${x}, ${y}) — sin crear`;
  }
  function onMouseUp(evt: MouseEvent) {
    if (state.painting) {
      state.painting = false;
      void flushBrushPaint();
      return;
    }
    if (!state.dragging) return;
    const wasDrag = state.dragMoved;
    const wasShiftDrag = state.shiftDrag && wasDrag;
    state.dragging = false; state.dragMoved = false; state.shiftDrag = false;
    if (wasShiftDrag) {
      applyMarqueeSelection();
      state.marqueeStart = null; state.marqueeCurrent = null;
      render();
    } else if (wasDrag) {
      scheduleTileLoad();
    } else {
      onCanvasClick(evt);
    }
  }
  function applyMarqueeSelection() {
    const x1 = Math.min(state.marqueeStart!.x, state.marqueeCurrent!.x);
    const x2 = Math.max(state.marqueeStart!.x, state.marqueeCurrent!.x);
    const y1 = Math.min(state.marqueeStart!.y, state.marqueeCurrent!.y);
    const y2 = Math.max(state.marqueeStart!.y, state.marqueeCurrent!.y);
    for (let x = x1; x <= x2; x++) for (let y = y1; y <= y2; y++) state.selected.add(key(x, y));
    state.lastMarqueeBounds = { minX: x1, maxX: x2, minY: y1, maxY: y2 };
    refreshSelectionUI();
  }

  function zoomAt(px: number, py: number, factor: number) {
    const before = screenToWorld(px, py);
    state.zoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, state.zoom * factor));
    const w = canvas!.width / (window.devicePixelRatio || 1), h = canvas!.height / (window.devicePixelRatio || 1);
    state.viewX = Math.min(MAP_VIEW_MAX, Math.max(0, before.x - (px - w / 2) / state.zoom));
    state.viewY = Math.min(MAP_VIEW_MAX, Math.max(0, before.y - (py - h / 2) / state.zoom));
    render();
    scheduleTileLoad();
  }
  function onWheel(evt: WheelEvent) {
    evt.preventDefault();
    const rect = canvas!.getBoundingClientRect();
    const factor = evt.deltaY < 0 ? ZOOM_STEP : 1 / ZOOM_STEP;
    zoomAt(evt.clientX - rect.left, evt.clientY - rect.top, factor);
  }

  async function onCanvasClick(evt: MouseEvent) {
    const { x, y } = pointerWorld(evt);
    const k = key(x, y);
    if (evt.shiftKey) {
      if (state.selected.has(k)) state.selected.delete(k); else state.selected.add(k);
    } else {
      state.selected.clear();
      state.selected.add(k);
      state.lastMarqueeBounds = null;
    }
    refreshSelectionUI();
    render();
    if (state.selected.size === 1) await openDetail(x, y);
  }

  function refreshSelectionUI() {
    const detailPanel = root.querySelector('#detailPanel')!;
    const bulkPanel = root.querySelector('#bulkPanel')!;
    const rangeRepaintPanel = root.querySelector('#rangeRepaintPanel')!;
    const rangeCreatePanel = root.querySelector('#rangeCreatePanel')!;
    const faccionAssignPanel = root.querySelector('#faccionAssignPanel')!;
    const zonaAssignPanel = root.querySelector('#zonaAssignPanel')!;

    if (state.selected.size <= 1) {
      bulkPanel.classList.add('hidden');
      detailPanel.classList.remove('hidden');
      if (state.selected.size === 0) {
        root.querySelector('#detailHeading')!.textContent = 'Casilla';
        root.querySelector('#detailEmpty')!.classList.remove('hidden');
        root.querySelector('#createTileForm')!.classList.add('hidden');
        root.querySelector('#detailForm')!.classList.add('hidden');
        currentCreateCoords = null;
      }
    } else {
      detailPanel.classList.add('hidden');
      bulkPanel.classList.remove('hidden');
      root.querySelector('#bulkCount')!.textContent = String(state.selected.size);
    }
    const showTerrainRangePanels = !!state.lastMarqueeBounds && state.marqueeMode === 'terrain';
    rangeRepaintPanel.classList.toggle('hidden', !showTerrainRangePanels);
    rangeCreatePanel.classList.toggle('hidden', !showTerrainRangePanels);
    faccionAssignPanel.classList.toggle('hidden', !state.lastMarqueeBounds || state.marqueeMode !== 'faccion');
    zonaAssignPanel.classList.toggle('hidden', !state.lastMarqueeBounds || state.marqueeMode !== 'zona');
  }

  let currentDetailTile: TileDetail | null = null;
  let currentCreateCoords: { x: number; y: number } | null = null;

  async function openDetail(x: number, y: number) {
    closeAllModals();
    root.querySelector('#detailEmpty')!.classList.add('hidden');
    const createForm = root.querySelector('#createTileForm')!;
    const form = root.querySelector('#detailForm')!;
    const heading = root.querySelector('#detailHeading')!;
    (root.querySelector('#fStatus') as HTMLElement).textContent = '';
    (root.querySelector('#ctStatus') as HTMLElement).textContent = '';

    const lightTile = state.tilesByKey.get(key(x, y));
    if (!lightTile) {
      form.classList.add('hidden');
      currentDetailTile = null;
      heading.textContent = '➕ Crear casilla';
      currentCreateCoords = { x, y };
      (root.querySelector('#ctCoords') as HTMLInputElement).value = `(${x}, ${y})`;
      (root.querySelector('#ctName') as HTMLInputElement).value = '';
      (root.querySelector('#ctResource') as HTMLInputElement).value = '';
      (root.querySelector('#ctDescription') as HTMLTextAreaElement).value = '';
      createForm.classList.remove('hidden');
      return;
    }

    createForm.classList.add('hidden');
    currentCreateCoords = null;
    heading.textContent = 'Editar casilla';

    let tile: TileDetail;
    try {
      tile = await apiFetch<TileDetail>(`/api/tiles/detail?x=${x}&y=${y}`);
    } catch (err) {
      (root.querySelector('#fStatus') as HTMLElement).textContent = `❌ ${err instanceof ApiError ? err.message : 'Error'}`;
      return;
    }
    currentDetailTile = tile;

    form.classList.remove('hidden');
    (root.querySelector('#fCoords') as HTMLInputElement).value = `(${tile.coord_x}, ${tile.coord_y}) · id ${tile.id}`;
    (root.querySelector('#fName') as HTMLInputElement).value = tile.name ?? '';
    (root.querySelector('#fTerrain') as HTMLSelectElement).value = tile.terrain_name;
    refreshTerrainPalette('fTerrain');
    (root.querySelector('#fZona') as HTMLSelectElement).value = tile.zone_name ?? '';
    (root.querySelector('#fResource') as HTMLInputElement).value = tile.resource_type ?? '';
    (root.querySelector('#fDescription') as HTMLTextAreaElement).value = tile.description ?? '';

    const readonly = root.querySelector('#fReadonly')!;
    const lines: string[] = [];
    lines.push(`<div class="row"><span>Propietario</span><b>${escapeHtml(tile.owner_username ?? 'Neutral')}</b></div>`);
    if (tile.faction_display_name) lines.push(`<div class="row"><span>Facción</span><b>${escapeHtml(tile.faction_emoji ?? '')} ${escapeHtml(tile.faction_display_name)}</b></div>`);
    if (tile.temperature != null) lines.push(`<div class="row"><span>Temperatura</span><b>${escapeHtml(formatTemperature(tile.temperature))} · ${escapeHtml(describeTemperature(tile.temperature))}</b></div>`);
    if (tile.effect_type) lines.push(`<div class="row"><span>Efecto de zona</span><b>${escapeHtml(tile.effect_type)}</b></div>`);
    lines.push(`<div class="row"><span>Jugadores aquí</span><b>${tile.players.length}</b></div>`);
    lines.push(`<div class="row"><span>Construcciones</span><b>${tile.constructions.length}</b></div>`);
    lines.push(`<div class="row"><span>Ítems en el suelo</span><b>${tile.tileItems.length}</b></div>`);
    readonly.innerHTML = lines.join('');
  }

  function openTileDetailModal(tile: TileDetail) {
    const panel = root.querySelector('#tile-detail-panel') as HTMLElement;

    const terrainResources = terrainByName.get(tile.terrain_name)?.resources ?? [];
    const resourcesHtml = `
      <div class="ct-section">
        <h4>${icon('package', { size: 16 })} Recurso de la casilla</h4>
        <p class="hint">Etiqueta libre de esta casilla en concreto — solo sirve como requisito <code>requiere_recurso</code> al construir. Se edita en el panel de la izquierda.</p>
        <div class="row"><span>Valor actual</span><b>${tile.resource_type ? escapeHtml(tile.resource_type) : '(ninguno)'}</b></div>
      </div>
      <div class="ct-section">
        <h4>${icon('sparkles', { size: 16 })} Recolectable en este terreno</h4>
        <p class="hint">Lo que puede dar <code>/recolectar</code> aquí, según el TIPO de terreno (${escapeHtml(tile.terrain_display_name ?? tile.terrain_name)}) — se edita en <a href="/staff/terrain-types">Terrenos</a>, no desde el mapa.</p>
        ${terrainResources.length > 0
          ? `<div class="tile-detail-list">${terrainResources.map(r => `<div class="tile-detail-row"><span class="tile-detail-row-main"><b>${escapeHtml(r.emoji ?? '📦')} ${escapeHtml(r.display_name)}</b><span class="hint">${r.drop_chance_percent}% · ×${r.quantity}</span></span></div>`).join('')}</div>`
          : '<p class="hint">Este terreno no tiene ningún recurso recolectable configurado.</p>'}
      </div>`;

    const playersHtml = tile.players.length === 0
      ? '<p class="hint">No hay nadie aquí ahora mismo.</p>'
      : tile.players.map(p => `
        <div class="tile-detail-row">
          <img class="player-avatar" src="/api/discord-avatar/${encodeURIComponent(p.discord_id)}" alt="">
          <span class="tile-detail-row-main">
            <b>${escapeHtml(p.character_name ?? p.username)}</b>
            ${statusPillHtml(p.is_alive, p.hp)}
          </span>
          <button type="button" class="btn-icon btn-view-player" data-discord-id="${escapeAttr(p.discord_id)}" title="Ver ficha">${icon('eye', { size: 15 })}</button>
        </div>`).join('');

    const npcListHtml = tile.npcs.length === 0
      ? '<p class="hint">No hay ningún NPC aquí.</p>'
      : tile.npcs.map(n => `
        <div class="tile-detail-row" data-id="${n.id}">
          <span class="tile-detail-row-main">
            <b>${escapeHtml(n.type_emoji ?? '👹')} ${escapeHtml(n.type_display_name)}</b>
            <span class="hint">${n.current_hp} / ${n.type_max_hp} HP ${n.is_wild ? '· encuentro aleatorio' : '· colocado a mano'}${n.faction_display_name ? ` · ${escapeHtml(n.faction_emoji ?? '')} ${escapeHtml(n.faction_display_name)}` : ''}</span>
          </span>
          <button type="button" class="btn-icon btn-remove-npc" title="Quitar">${icon('trash', { size: 15 })}</button>
        </div>`).join('');

    const npcHtml = `
      <div class="tile-detail-list">${npcListHtml}</div>
      <form id="npc-place-form" class="tile-detail-add-form">
        <label>Tipo de NPC ${selectHtml('f_npcTypeName', [{ value: '', label: '— elige un tipo —' }, ...bootstrap.npcTypes.map(t => ({ value: String(t.id), label: `${t.emoji ?? '👹'} ${t.display_name}` }))], '')}</label>
        <button type="submit" class="btn-secondary">Añadir NPC aquí</button>
      </form>
      <form id="npc-group-place-form" class="tile-detail-add-form">
        <label>Grupo de NPC ${selectHtml('f_npcGroupTypeName', [{ value: '', label: '— elige un grupo —' }, ...bootstrap.npcGroupTypes.map(t => ({ value: String(t.id), label: `${t.emoji ?? '👥'} ${t.display_name}` }))], '')}</label>
        <button type="submit" class="btn-secondary">Añadir grupo aquí</button>
      </form>`;

    const poiListHtml = tile.points_of_interest.length === 0
      ? '<p class="hint">Sin lugares de interés todavía.</p>'
      : tile.points_of_interest.map(p => `
        <div class="tile-detail-row" data-id="${p.id}">
          <span class="tile-detail-row-main">
            <b>${escapeHtml(p.emoji ?? '📍')} ${escapeHtml(p.name)}</b>
            ${p.description ? `<span class="hint">${escapeHtml(p.description)}</span>` : ''}
          </span>
          <button type="button" class="btn-icon btn-remove-poi" title="Quitar">${icon('trash', { size: 15 })}</button>
        </div>`).join('');

    const poiHtml = `
      <div class="tile-detail-list">${poiListHtml}</div>
      <form id="poi-add-form" class="tile-detail-add-form">
        <label>Nombre <input type="text" id="f_poiName" maxlength="191" required></label>
        <label>Emoji <input type="text" id="f_poiEmoji" maxlength="8" placeholder="📍"></label>
        <label>Descripción <input type="text" id="f_poiDescription" maxlength="500"></label>
        <button type="submit" class="btn-secondary">Añadir lugar de interés</button>
      </form>`;

    const constructionsHtml = tile.constructions.length === 0
      ? '<p class="hint">No hay nada construido aquí.</p>'
      : tile.constructions.map(c => `
        <div class="tile-detail-row tile-detail-construction" data-id="${c.id}">
          <span class="tile-detail-row-main">
            <b>${escapeHtml(c.ct_emoji ?? '🏗️')} ${escapeHtml(c.name)}</b>
            <span class="hint">${escapeHtml(c.ct_display_name ?? c.construction_type ?? '—')}</span>
          </span>
          <label>Vida
            <input type="number" class="ct-health-input" value="${c.current_health ?? ''}" min="0" max="${c.ct_max_health ?? ''}">
            <span class="hint">/ ${c.ct_max_health ?? '—'}</span>
          </label>
          <label>Combustible
            <input type="number" class="ct-fuel-input" value="${c.fuel_level ?? 0}" min="0" max="${c.ct_fuel_capacity ?? ''}" step="any" ${c.ct_fuel_item_name ? '' : 'disabled'}>
            <span class="hint">/ ${c.ct_fuel_item_name ? (c.ct_fuel_capacity ?? '∞') : '—'}</span>
          </label>
          <label>Durabilidad
            <input type="number" class="ct-durability-input" value="${c.durability ?? c.ct_max_durability ?? ''}" min="0" max="${c.ct_max_durability ?? ''}" step="any" ${c.ct_durability_loss_per_day ? '' : 'disabled'}>
            <span class="hint">/ ${c.ct_durability_loss_per_day ? (c.ct_max_durability ?? '—') : '—'}</span>
          </label>
          <button type="button" class="btn-icon btn-save-construction" title="Guardar">${icon('save', { size: 15 })}</button>
          <button type="button" class="btn-icon btn-delete-construction" title="Borrar">${icon('trash', { size: 15 })}</button>
        </div>`).join('');

    panel.innerHTML = `
      <div class="form-header"><h3>Detalle de casilla (${tile.coord_x}, ${tile.coord_y})</h3><button type="button" class="btn-icon modal-close" aria-label="Cerrar">${icon('x', { size: 15 })}</button></div>
      <div class="readonly-block">
        <div class="row"><span>Nombre</span><b>${escapeHtml(tile.name)}</b></div>
        <div class="row"><span>Terreno</span><b>${escapeHtml(tile.terrain_display_name ?? tile.terrain_name)}</b></div>
        <div class="row"><span>Propietario</span><b>${escapeHtml(tile.owner_username ?? 'Neutral')}</b></div>
        ${tile.faction_display_name ? `<div class="row"><span>Facción</span><b>${escapeHtml(tile.faction_emoji ?? '')} ${escapeHtml(tile.faction_display_name)}</b></div>` : ''}
        ${tile.zone_display_name ? `<div class="row"><span>Zona</span><b>${escapeHtml(tile.zone_emoji ?? '')} ${escapeHtml(tile.zone_display_name)}</b></div>` : ''}
        ${tile.temperature != null ? `<div class="row"><span>Temperatura</span><b>${escapeHtml(formatTemperature(tile.temperature))} · ${escapeHtml(describeTemperature(tile.temperature))}</b></div>` : ''}
      </div>

      ${resourcesHtml}

      <form id="tile-effect-form" class="ct-section">
        <fieldset><legend>Efecto de zona (se aplica solo a quien esté parado aquí)</legend>
          <label>Efecto ${selectHtml('f_tileEffect', [{ value: '', label: '(ninguno)' }, ...bootstrap.effectTypes.map(e => ({ value: e.name, label: `${e.emoji ?? '🎭'} ${e.label}` }))], tile.effect_type ?? '')}</label>
        </fieldset>
        <button type="submit" class="btn-secondary">Guardar efecto</button>
      </form>

      <div class="ct-section">
        <h4>${icon('flag', { size: 16 })} Lugares de interés</h4>
        ${poiHtml}
      </div>

      <div class="ct-section">
        <h4>${icon('users', { size: 16 })} Jugadores presentes</h4>
        <div class="tile-detail-list">${playersHtml}</div>
      </div>

      <div class="ct-section">
        <h4>${icon('building', { size: 16 })} Construcciones</h4>
        <div class="tile-detail-list">${constructionsHtml}</div>
      </div>

      <div class="ct-section">
        <h4>${icon('skull', { size: 16 })} NPCs</h4>
        ${npcHtml}
      </div>

      <p id="tile-detail-status" class="hint"></p>`;

    panel.querySelector('.modal-close')?.addEventListener('click', () => closeAllModals());
    panel.querySelectorAll<HTMLButtonElement>('.btn-view-player').forEach(btn => {
      btn.onclick = () => { window.location.href = `/staff/players/${encodeURIComponent(btn.dataset.discordId!)}`; };
    });

    const status = () => panel.querySelector('#tile-detail-status') as HTMLElement;

    panel.querySelector('#tile-effect-form')?.addEventListener('submit', async evt => {
      evt.preventDefault();
      status().textContent = 'Guardando…';
      try {
        await apiFetch('/api/tiles', { method: 'PATCH', body: { x: tile.coord_x, y: tile.coord_y, effectType: (panel.querySelector('#f_tileEffect') as HTMLSelectElement).value || null } });
        status().textContent = '✅ Guardado.';
        showToast('Efecto de zona actualizado.', 'success');
        await reloadTileDetailModal(tile.coord_x, tile.coord_y);
      } catch (err) {
        status().textContent = `❌ ${err instanceof ApiError ? err.message : 'Error'}`;
      }
    });

    panel.querySelectorAll<HTMLElement>('.tile-detail-construction').forEach(rowEl => {
      const id = rowEl.dataset.id;
      rowEl.querySelector<HTMLButtonElement>('.btn-save-construction')!.onclick = async () => {
        status().textContent = 'Guardando…';
        try {
          const currentHealth = Number((rowEl.querySelector('.ct-health-input') as HTMLInputElement).value);
          const fuelLevel = Number((rowEl.querySelector('.ct-fuel-input') as HTMLInputElement).value);
          const durabilityInput = rowEl.querySelector('.ct-durability-input') as HTMLInputElement;
          const durability = durabilityInput.disabled ? undefined : Number(durabilityInput.value);
          await apiFetch(`/api/constructions/${id}`, { method: 'PATCH', body: { currentHealth, fuelLevel, durability } });
          status().textContent = '✅ Guardado.';
          showToast('Construcción actualizada.', 'success');
          await reloadTileDetailModal(tile.coord_x, tile.coord_y);
        } catch (err) {
          status().textContent = `❌ ${err instanceof ApiError ? err.message : 'Error'}`;
        }
      };
      rowEl.querySelector<HTMLButtonElement>('.btn-delete-construction')!.onclick = async () => {
        const ok = await showConfirm({ title: 'Borrar construcción', message: '¿Seguro que quieres borrar esta construcción? Esto no se puede deshacer.', confirmLabel: 'Borrar', danger: true });
        if (!ok) return;
        try {
          await apiFetch(`/api/constructions/${id}`, { method: 'DELETE' });
          showToast('Construcción eliminada.', 'success');
          await reloadTileDetailModal(tile.coord_x, tile.coord_y);
        } catch (err) {
          showToast(err instanceof ApiError ? err.message : 'Error', 'error');
        }
      };
    });

    panel.querySelector('#npc-place-form')?.addEventListener('submit', async evt => {
      evt.preventDefault();
      status().textContent = 'Añadiendo…';
      try {
        const npcTypeId = Number((panel.querySelector('#f_npcTypeName') as HTMLSelectElement).value);
        if (!npcTypeId) throw new Error('Elige un tipo de NPC.');
        await apiFetch('/api/npcs', { method: 'POST', body: { x: tile.coord_x, y: tile.coord_y, npcTypeId } });
        status().textContent = '✅ NPC añadido.';
        showToast('NPC añadido a la casilla.', 'success');
        await reloadTileDetailModal(tile.coord_x, tile.coord_y);
      } catch (err) {
        status().textContent = `❌ ${err instanceof Error ? err.message : 'Error'}`;
      }
    });

    panel.querySelector('#npc-group-place-form')?.addEventListener('submit', async evt => {
      evt.preventDefault();
      status().textContent = 'Añadiendo…';
      try {
        const groupTypeId = Number((panel.querySelector('#f_npcGroupTypeName') as HTMLSelectElement).value);
        if (!groupTypeId) throw new Error('Elige un grupo de NPC.');
        const created = await apiFetch<unknown[]>('/api/npcs/group', { method: 'POST', body: { x: tile.coord_x, y: tile.coord_y, groupTypeId } });
        status().textContent = '✅ Grupo añadido.';
        showToast(`Grupo añadido a la casilla (${created.length} NPC).`, 'success');
        await reloadTileDetailModal(tile.coord_x, tile.coord_y);
      } catch (err) {
        status().textContent = `❌ ${err instanceof Error ? err.message : 'Error'}`;
      }
    });

    panel.querySelector('#poi-add-form')?.addEventListener('submit', async evt => {
      evt.preventDefault();
      status().textContent = 'Añadiendo…';
      try {
        const name = (panel.querySelector('#f_poiName') as HTMLInputElement).value.trim();
        const emoji = (panel.querySelector('#f_poiEmoji') as HTMLInputElement).value.trim() || undefined;
        const description = (panel.querySelector('#f_poiDescription') as HTMLInputElement).value.trim() || undefined;
        if (!name) throw new Error('Ponle un nombre.');
        await apiFetch('/api/pois', { method: 'POST', body: { x: tile.coord_x, y: tile.coord_y, name, description, emoji } });
        status().textContent = '✅ Lugar de interés añadido.';
        showToast('Lugar de interés añadido.', 'success');
        await reloadTileDetailModal(tile.coord_x, tile.coord_y);
      } catch (err) {
        status().textContent = `❌ ${err instanceof ApiError ? err.message : (err instanceof Error ? err.message : 'Error')}`;
      }
    });

    panel.querySelectorAll<HTMLButtonElement>('.btn-remove-poi').forEach(btn => {
      btn.onclick = async () => {
        const id = btn.closest<HTMLElement>('[data-id]')!.dataset.id;
        const ok = await showConfirm({ title: 'Quitar lugar de interés', message: '¿Seguro que quieres quitarlo? Esto no se puede deshacer.', confirmLabel: 'Quitar', danger: true });
        if (!ok) return;
        try {
          await apiFetch(`/api/pois/${id}`, { method: 'DELETE', body: { x: tile.coord_x, y: tile.coord_y } });
          showToast('Lugar de interés quitado.', 'success');
          await reloadTileDetailModal(tile.coord_x, tile.coord_y);
        } catch (err) {
          showToast(err instanceof ApiError ? err.message : 'Error', 'error');
        }
      };
    });

    panel.querySelectorAll<HTMLButtonElement>('.btn-remove-npc').forEach(btn => {
      btn.onclick = async () => {
        const id = btn.closest<HTMLElement>('[data-id]')!.dataset.id;
        const ok = await showConfirm({ title: 'Quitar NPC', message: '¿Seguro que quieres quitar este NPC de la casilla? Esto no se puede deshacer.', confirmLabel: 'Quitar', danger: true });
        if (!ok) return;
        try {
          await apiFetch(`/api/npcs/${id}`, { method: 'DELETE' });
          showToast('NPC quitado.', 'success');
          await reloadTileDetailModal(tile.coord_x, tile.coord_y);
        } catch (err) {
          showToast(err instanceof ApiError ? err.message : 'Error', 'error');
        }
      };
    });

    openModal(panel);
  }

  async function reloadTileDetailModal(x: number, y: number) {
    const tile = await apiFetch<TileDetail>(`/api/tiles/detail?x=${x}&y=${y}`);
    currentDetailTile = tile;
    openTileDetailModal(tile);
    await loadVisibleTiles(true);
    render();
  }

  async function saveTileZone(tile: TileDetail) {
    const zoneName = (root.querySelector('#fZona') as HTMLSelectElement).value;
    if (zoneName === (tile.zone_name ?? '')) return;
    const range = { x1: tile.coord_x, y1: tile.coord_y, x2: tile.coord_x, y2: tile.coord_y };
    const path = zoneName ? `/api/zonas/${encodeURIComponent(zoneName)}/assign-range` : '/api/zonas/unassign-range';
    await apiFetch(path, { method: 'POST', body: range });
    tile.zone_name = zoneName || null;
  }

  async function onSaveDetail(evt: Event) {
    evt.preventDefault();
    if (!currentDetailTile) return;
    const status = root.querySelector('#fStatus') as HTMLElement;
    status.textContent = 'Guardando…';
    try {
      await apiFetch('/api/tiles', {
        method: 'PATCH',
        body: {
          x: currentDetailTile.coord_x, y: currentDetailTile.coord_y,
          name: (root.querySelector('#fName') as HTMLInputElement).value,
          terrainType: (root.querySelector('#fTerrain') as HTMLSelectElement).value,
          resource_type: (root.querySelector('#fResource') as HTMLInputElement).value || null,
          description: (root.querySelector('#fDescription') as HTMLTextAreaElement).value,
        },
      });
      await saveTileZone(currentDetailTile);
      status.textContent = '✅ Guardado.';
      await loadVisibleTiles(true);
      render();
    } catch (err) {
      status.textContent = `❌ ${err instanceof ApiError ? err.message : 'Error'}`;
    }
  }

  async function onCreateDetailTile(evt: Event) {
    evt.preventDefault();
    if (!currentCreateCoords) return;
    const { x, y } = currentCreateCoords;
    const status = root.querySelector('#ctStatus') as HTMLElement;
    const name = (root.querySelector('#ctName') as HTMLInputElement).value.trim();
    const terrainType = (root.querySelector('#ctTerrain') as HTMLSelectElement).value;
    if (!name || !terrainType) { status.textContent = 'Nombre y terreno son obligatorios.'; return; }
    status.textContent = 'Creando…';
    try {
      await apiFetch('/api/tiles/range', {
        method: 'POST',
        body: {
          x1: x, y1: y, x2: x, y2: y, name, terrainType,
          description: (root.querySelector('#ctDescription') as HTMLTextAreaElement).value.trim(),
          resourceType: (root.querySelector('#ctResource') as HTMLInputElement).value.trim() || null,
        },
      });
      await loadVisibleTiles(true);
      render();
      await openDetail(x, y);
    } catch (err) {
      status.textContent = `❌ ${err instanceof ApiError ? err.message : 'Error'}`;
    }
  }

  async function onDeleteDetailTile() {
    if (!currentDetailTile) return;
    const { coord_x: x, coord_y: y, name } = currentDetailTile;
    const ok = await showConfirm({ title: 'Eliminar casilla', message: `Esto borra (${x}, ${y}) — "${name}" — del mapa. No se puede deshacer.`, confirmLabel: 'Eliminar', danger: true });
    if (!ok) return;
    const status = root.querySelector('#fStatus') as HTMLElement;
    status.textContent = 'Eliminando…';
    try {
      await apiFetch('/api/tiles', { method: 'DELETE', body: { x, y } });
      state.tilesByKey.delete(key(x, y));
      state.selected.clear();
      currentDetailTile = null;
      refreshSelectionUI();
      render();
    } catch (err) {
      status.textContent = `❌ ${err instanceof ApiError ? err.message : 'Error'}`;
    }
  }

  async function onSaveBulk(evt: Event) {
    evt.preventDefault();
    const status = root.querySelector('#bStatus') as HTMLElement;
    const terrain = (root.querySelector('#bTerrain') as HTMLSelectElement).value;
    const resource = (root.querySelector('#bResource') as HTMLInputElement).value;
    const updates: Record<string, unknown> = {};
    if (terrain) updates.terrainType = terrain;
    if (resource) updates.resource_type = resource;
    if (Object.keys(updates).length === 0) { status.textContent = 'Elige al menos un campo a cambiar.'; return; }
    const tiles = [...state.selected].map(k => { const [x, y] = k.split(',').map(Number); return { x, y }; });
    status.textContent = 'Aplicando…';
    try {
      const result = await apiFetch<{ updated: number; errors: unknown[] }>('/api/tiles/bulk', { method: 'POST', body: { tiles, updates } });
      status.textContent = `✅ ${result.updated} casilla(s) actualizadas${result.errors.length ? `, ${result.errors.length} con error` : ''}.`;
      await loadVisibleTiles(true);
      render();
    } catch (err) {
      status.textContent = `❌ ${err instanceof ApiError ? err.message : 'Error'}`;
    }
  }

  async function onSaveRangeRepaint(evt: Event) {
    evt.preventDefault();
    const status = root.querySelector('#rrStatus') as HTMLElement;
    if (!state.lastMarqueeBounds) { status.textContent = 'Arrastra con Shift sobre el mapa para elegir un rectángulo primero.'; return; }
    const { minX, maxX, minY, maxY } = state.lastMarqueeBounds;
    const terrainType = (root.querySelector('#rrTerrain') as HTMLSelectElement).value;
    if (!terrainType) { status.textContent = 'Elige un terreno.'; return; }
    const tiles: { x: number; y: number }[] = [];
    for (let x = minX; x <= maxX; x++) for (let y = minY; y <= maxY; y++) if (state.tilesByKey.has(key(x, y))) tiles.push({ x, y });
    if (tiles.length === 0) { status.textContent = 'No hay ninguna casilla creada en este rectángulo — usa "Crear/rellenar" para crearlas.'; return; }
    status.textContent = 'Repintando…';
    try {
      const result = await apiFetch<{ updated: number; errors: unknown[] }>('/api/tiles/bulk', { method: 'POST', body: { tiles, updates: { terrainType } } });
      const empty = (maxX - minX + 1) * (maxY - minY + 1) - tiles.length;
      status.textContent = `✅ ${result.updated} casilla(s) repintadas${empty > 0 ? `, ${empty} vacía(s) sin tocar` : ''}${result.errors.length ? `, ${result.errors.length} con error` : ''}.`;
      await loadVisibleTiles(true);
      render();
    } catch (err) {
      status.textContent = `❌ ${err instanceof ApiError ? err.message : 'Error'}`;
    }
  }

  async function onSaveRangeCreate(evt: Event) {
    evt.preventDefault();
    const status = root.querySelector('#rcStatus') as HTMLElement;
    if (!state.lastMarqueeBounds) { status.textContent = 'Arrastra con Shift sobre el mapa para elegir un rectángulo primero.'; return; }
    const { minX, maxX, minY, maxY } = state.lastMarqueeBounds;
    const name = (root.querySelector('#rcName') as HTMLInputElement).value.trim();
    const terrainType = (root.querySelector('#rcTerrain') as HTMLSelectElement).value;
    const description = (root.querySelector('#rcDescription') as HTMLTextAreaElement).value.trim();
    const resource = (root.querySelector('#rcResource') as HTMLInputElement).value.trim();
    if (!name || !terrainType) { status.textContent = 'Nombre y terreno son obligatorios.'; return; }
    status.textContent = 'Creando…';
    try {
      const result = await apiFetch<{ created: number; skipped: number }>('/api/tiles/range', {
        method: 'POST', body: { x1: minX, y1: minY, x2: maxX, y2: maxY, name, terrainType, description, resourceType: resource || null },
      });
      status.textContent = `✅ ${result.created} casilla(s) nueva(s), ${result.skipped} ya existían y no se tocaron.`;
      await loadVisibleTiles(true);
      render();
    } catch (err) {
      status.textContent = `❌ ${err instanceof ApiError ? err.message : 'Error'}`;
    }
  }

  async function onSaveFaccionAssign(evt: Event) {
    evt.preventDefault();
    const status = root.querySelector('#naStatus') as HTMLElement;
    if (!state.lastMarqueeBounds) { status.textContent = 'Arrastra con Shift sobre el mapa para elegir un rectángulo primero.'; return; }
    const { minX, maxX, minY, maxY } = state.lastMarqueeBounds;
    const faccionName = (root.querySelector('#naFaccion') as HTMLSelectElement).value;
    if (!faccionName) { status.textContent = 'Elige una facción.'; return; }
    status.textContent = 'Asignando…';
    try {
      const result = await apiFetch<{ tilesAssigned: number }>(`/api/facciones/${encodeURIComponent(faccionName)}/assign-range`, { method: 'POST', body: { x1: minX, y1: minY, x2: maxX, y2: maxY } });
      status.textContent = `✅ Asignada a ${result.tilesAssigned} casilla(s).`;
      await loadVisibleTiles(true);
      render();
    } catch (err) {
      status.textContent = `❌ ${err instanceof ApiError ? err.message : 'Error'}`;
    }
  }

  async function onUnassignFaccion() {
    const status = root.querySelector('#naStatus') as HTMLElement;
    if (!state.lastMarqueeBounds) { status.textContent = 'Arrastra con Shift sobre el mapa para elegir un rectángulo primero.'; return; }
    const { minX, maxX, minY, maxY } = state.lastMarqueeBounds;
    status.textContent = 'Quitando…';
    try {
      const result = await apiFetch<{ tilesUnassigned: number }>('/api/facciones/unassign-range', { method: 'POST', body: { x1: minX, y1: minY, x2: maxX, y2: maxY } });
      status.textContent = `✅ Facción quitada de ${result.tilesUnassigned} casilla(s).`;
      await loadVisibleTiles(true);
      render();
    } catch (err) {
      status.textContent = `❌ ${err instanceof ApiError ? err.message : 'Error'}`;
    }
  }

  async function onSaveZonaAssign(evt: Event) {
    evt.preventDefault();
    const status = root.querySelector('#zaStatus') as HTMLElement;
    if (!state.lastMarqueeBounds) { status.textContent = 'Arrastra con Shift sobre el mapa para elegir un rectángulo primero.'; return; }
    const { minX, maxX, minY, maxY } = state.lastMarqueeBounds;
    const zoneName = (root.querySelector('#zaZona') as HTMLSelectElement).value;
    if (!zoneName) { status.textContent = 'Elige una zona.'; return; }
    status.textContent = 'Asignando…';
    try {
      const result = await apiFetch<{ tilesAffected: number }>(`/api/zonas/${encodeURIComponent(zoneName)}/assign-range`, { method: 'POST', body: { x1: minX, y1: minY, x2: maxX, y2: maxY } });
      status.textContent = `✅ Asignada a ${result.tilesAffected} casilla(s).`;
      await loadVisibleTiles(true);
      render();
    } catch (err) {
      status.textContent = `❌ ${err instanceof ApiError ? err.message : 'Error'}`;
    }
  }

  async function onUnassignZona() {
    const status = root.querySelector('#zaStatus') as HTMLElement;
    if (!state.lastMarqueeBounds) { status.textContent = 'Arrastra con Shift sobre el mapa para elegir un rectángulo primero.'; return; }
    const { minX, maxX, minY, maxY } = state.lastMarqueeBounds;
    status.textContent = 'Quitando…';
    try {
      const result = await apiFetch<{ tilesAffected: number }>('/api/zonas/unassign-range', { method: 'POST', body: { x1: minX, y1: minY, x2: maxX, y2: maxY } });
      status.textContent = `✅ Zona quitada de ${result.tilesAffected} casilla(s).`;
      await loadVisibleTiles(true);
      render();
    } catch (err) {
      status.textContent = `❌ ${err instanceof ApiError ? err.message : 'Error'}`;
    }
  }

  function buildLegend() {
    const list = root.querySelector('#legendList')!;
    list.innerHTML = '';
    for (const t of bootstrap.terrainTypes) {
      const row = document.createElement('div');
      row.className = 'legend-item';
      row.innerHTML = `<span class="legend-swatch" style="background:${escapeAttr(t.color)}"></span>${escapeHtml(t.emoji ?? '')} ${escapeHtml(t.display_name)}${t.requires_vehicle_category ? ` (🚧 ${escapeHtml(t.requires_vehicle_category)})` : ''}`;
      list.appendChild(row);
    }
    for (const z of bootstrap.zones ?? []) {
      const row = document.createElement('div');
      row.className = 'legend-item';
      row.innerHTML = `<span class="legend-swatch legend-swatch-outline" style="border-color:${escapeAttr(z.color)}"></span>${escapeHtml(z.emoji ?? '')} ${escapeHtml(z.display_name)}`;
      list.appendChild(row);
    }
  }

  function buildTerrainSelects() {
    const fTerrain = root.querySelector('#fTerrain')!, bTerrain = root.querySelector('#bTerrain')!;
    const rcTerrain = root.querySelector('#rcTerrain')!, ctTerrain = root.querySelector('#ctTerrain')!;
    const rrTerrain = root.querySelector('#rrTerrain')!, brushTerrainEl = root.querySelector('#brushTerrain')!;
    fTerrain.innerHTML = ''; bTerrain.innerHTML = '<option value="">— no cambiar —</option>';
    rcTerrain.innerHTML = ''; ctTerrain.innerHTML = ''; rrTerrain.innerHTML = ''; brushTerrainEl.innerHTML = '';
    for (const t of bootstrap.terrainTypes) {
      const opt = document.createElement('option');
      opt.value = t.name; opt.textContent = `${t.emoji ?? ''} ${t.display_name}`;
      fTerrain.appendChild(opt);
      bTerrain.appendChild(opt.cloneNode(true));
      rcTerrain.appendChild(opt.cloneNode(true));
      ctTerrain.appendChild(opt.cloneNode(true));
      rrTerrain.appendChild(opt.cloneNode(true));
      brushTerrainEl.appendChild(opt.cloneNode(true));
    }
    state.brushTerrain = (brushTerrainEl as HTMLSelectElement).value;
    [fTerrain, bTerrain, rcTerrain, ctTerrain, rrTerrain, brushTerrainEl].forEach(el => enhanceTerrainSelect(el as HTMLSelectElement));
  }

  const terrainPaletteRefresh = new Map<string, () => void>();
  function enhanceTerrainSelect(select: HTMLSelectElement) {
    select.classList.add('terrain-select-native');
    let palette = select.nextElementSibling as HTMLElement | null;
    if (!palette?.classList.contains('terrain-palette')) {
      palette = document.createElement('div');
      palette.className = 'terrain-palette';
      select.insertAdjacentElement('afterend', palette);
    }
    function build() {
      palette!.innerHTML = '';
      Array.from(select.options).forEach(opt => {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.title = opt.textContent ?? '';
        btn.className = 'terrain-swatch-btn' + (opt.value === select.value ? ' active' : '');
        if (opt.value === '') {
          btn.classList.add('terrain-swatch-none');
          btn.textContent = opt.textContent;
        } else {
          const terrain = terrainByName.get(opt.value);
          btn.innerHTML = `<span class="terrain-swatch-color" style="background:${escapeAttr(terrain?.color ?? '#888')}"></span><span>${escapeHtml((terrain?.emoji ?? '') + ' ' + (terrain?.display_name ?? opt.value))}</span>`;
        }
        btn.addEventListener('click', () => {
          select.value = opt.value;
          select.dispatchEvent(new Event('change'));
          build();
        });
        palette!.appendChild(btn);
      });
    }
    build();
    if (select.id) terrainPaletteRefresh.set(select.id, build);
  }
  function refreshTerrainPalette(selectId: string) {
    terrainPaletteRefresh.get(selectId)?.();
  }

  function ctl<T extends HTMLElement>(selector: string): T | null {
    return root.querySelector<T>(selector) ?? document.querySelector<T>(selector);
  }

  function initMapInteraction() {
    canvas!.addEventListener('mousedown', onMouseDown);
    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
    canvas!.addEventListener('mouseleave', () => { coordHint!.textContent = ''; });
    canvas!.addEventListener('wheel', onWheel, { passive: false });
    window.addEventListener('resize', () => { resizeCanvas(); render(); });

    ctl('#zoomIn')?.addEventListener('click', () => {
      const w = canvas!.width / (window.devicePixelRatio || 1), h = canvas!.height / (window.devicePixelRatio || 1);
      zoomAt(w / 2, h / 2, ZOOM_STEP);
    });
    ctl('#zoomOut')?.addEventListener('click', () => {
      const w = canvas!.width / (window.devicePixelRatio || 1), h = canvas!.height / (window.devicePixelRatio || 1);
      zoomAt(w / 2, h / 2, 1 / ZOOM_STEP);
    });

    ctl('#zoomCenter')?.addEventListener('click', () => {
      fitViewToWorld();
      render();
      scheduleTileLoad(true);
    });
    const gotoBtn = ctl<HTMLButtonElement>('#gotoBtn');
    gotoBtn?.addEventListener('click', () => {
      const x = parseInt(ctl<HTMLInputElement>('#gotoX')!.value, 10);
      const y = parseInt(ctl<HTMLInputElement>('#gotoY')!.value, 10);
      if (Number.isInteger(x) && Number.isInteger(y)) {
        state.viewX = Math.min(MAP_VIEW_MAX, Math.max(0, x));
        state.viewY = Math.min(MAP_VIEW_MAX, Math.max(0, y));
        render();
        scheduleTileLoad(true);
      }
    });
    ['gotoX', 'gotoY'].forEach(id => {
      ctl(`#${id}`)?.addEventListener('keydown', evt => {
        if ((evt as KeyboardEvent).key === 'Enter') gotoBtn?.click();
      });
    });

    root.querySelector('#detailForm')?.addEventListener('submit', onSaveDetail);
    root.querySelector('#fDelete')?.addEventListener('click', onDeleteDetailTile);
    root.querySelector('#createTileForm')?.addEventListener('submit', onCreateDetailTile);
    root.querySelector('#bulkForm')?.addEventListener('submit', onSaveBulk);
    root.querySelector('#bulkClear')?.addEventListener('click', () => { state.selected.clear(); state.lastMarqueeBounds = null; refreshSelectionUI(); render(); });
    root.querySelector('#rangeRepaintForm')?.addEventListener('submit', onSaveRangeRepaint);
    root.querySelector('#rangeCreateForm')?.addEventListener('submit', onSaveRangeCreate);
    root.querySelector('#fViewDetail')?.addEventListener('click', () => { if (currentDetailTile) openTileDetailModal(currentDetailTile); });

    const naFaccion = root.querySelector('#naFaccion') as HTMLSelectElement;
    if (naFaccion) {
      naFaccion.innerHTML = [{ value: '', label: '— elige una facción —' }, ...bootstrap.factions.map(n => ({ value: n.name, label: n.display_name }))]
        .map(o => `<option value="${escapeAttr(o.value)}">${escapeHtml(o.label)}</option>`).join('');
    }
    root.querySelector('#faccionAssignForm')?.addEventListener('submit', onSaveFaccionAssign);
    root.querySelector('#naUnassign')?.addEventListener('click', onUnassignFaccion);

    const zoneOptions = (placeholder: string) => [{ value: '', label: placeholder }, ...(bootstrap.zones ?? []).map(z => ({ value: z.name, label: z.display_name }))]
      .map(o => `<option value="${escapeAttr(o.value)}">${escapeHtml(o.label)}</option>`).join('');
    const zaZona = root.querySelector('#zaZona');
    if (zaZona) zaZona.innerHTML = zoneOptions('— elige una zona —');
    const fZona = root.querySelector('#fZona');
    if (fZona) fZona.innerHTML = zoneOptions('— sin zona —');
    root.querySelector('#zonaAssignForm')?.addEventListener('submit', onSaveZonaAssign);
    root.querySelector('#zaUnassign')?.addEventListener('click', onUnassignZona);

    const zoneOverlayToggle = ctl('#zoneOverlayToggle');
    zoneOverlayToggle?.classList.toggle('active', state.showZones);
    zoneOverlayToggle?.addEventListener('click', () => {
      state.showZones = !state.showZones;
      zoneOverlayToggle.classList.toggle('active', state.showZones);
      render();
    });

    const modeButtons: Record<string, HTMLElement | null> = {
      terrain: ctl('#marqueeModeTerrain'),
      faccion: ctl('#marqueeModeFaccion'),
      zona: ctl('#marqueeModeZona'),
    };
    for (const [mode, btn] of Object.entries(modeButtons)) {
      btn?.addEventListener('click', () => {
        state.marqueeMode = mode as 'terrain' | 'faccion' | 'zona';
        Object.values(modeButtons).forEach(b => b?.classList.remove('active'));
        btn.classList.add('active');
        refreshSelectionUI();
      });
    }

    const brushToggle = ctl('#brushToggle');
    const brushPanel = root.querySelector('#brushPanel');
    brushToggle?.addEventListener('click', () => {
      state.brushActive = !state.brushActive;
      brushToggle.classList.toggle('active', state.brushActive);
      brushPanel?.classList.toggle('hidden', !state.brushActive);
      canvas!.style.cursor = state.brushActive ? 'crosshair' : '';
    });
    root.querySelector('#brushTerrain')?.addEventListener('change', evt => {
      state.brushTerrain = (evt.target as HTMLSelectElement).value;
    });
  }

  buildLegend();
  buildTerrainSelects();
  initMapInteraction();
  resizeCanvas();

  loadVisibleTiles()
    .then(() => {
      fitViewToWorld();
      render();

      scheduleTileLoad(true);
    })
    .catch(err => console.error('[Mapa] Error cargando casillas:', err));

  initLiveUpdates('map', async () => {
    await loadVisibleTiles(true);
    render();
  });
}
