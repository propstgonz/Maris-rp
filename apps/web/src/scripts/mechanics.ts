import { icon } from '../lib/icons';
import { escapeHtml } from './html';
import { fieldHtml, readField } from '../lib/formFields';
import { showToast, showConfirm } from './ui';
import { apiFetch } from './api';
import type { SpawnSettings, MechanicsSettings } from '../lib/mapServerApi';

const LOADING_HTML = '<div class="loading-state"><span class="spinner"></span> Cargando…</div>';

export async function initMechanics(container: HTMLElement) {
  container.innerHTML = LOADING_HTML;

  let spawn: SpawnSettings, mechanics: MechanicsSettings;
  try {
    [spawn, mechanics] = await Promise.all([
      apiFetch<SpawnSettings>('/api/settings/spawn'),
      apiFetch<MechanicsSettings>('/api/settings/mechanics'),
    ]);
  } catch (err) {
    container.innerHTML = `<p class="hint">❌ ${escapeHtml(err instanceof Error ? err.message : 'Error desconocido.')}</p>`;
    return;
  }

  container.innerHTML = `
    <div class="detail-grid detail-grid-even">
      <form id="mech-spawn-form" class="detail-card">
        <h4>${icon('crosshair', { size: 16 })} Casilla de aparición</h4>
        <p class="hint">Dónde aparecen los personajes nuevos. No mueve a los jugadores ya existentes. No puede ser negativa.</p>
        <div class="field-row field-row-compact">
          ${fieldHtml({ key: 'mechSpawnX', label: 'X', type: 'number' }, spawn.x)}
          ${fieldHtml({ key: 'mechSpawnY', label: 'Y', type: 'number' }, spawn.y)}
        </div>
        <button type="submit" class="btn-secondary">Guardar</button>
      </form>

      <form id="mech-move-form" class="detail-card">
        <h4>${icon('crosshair', { size: 16 })} Movimiento</h4>
        ${fieldHtml({ key: 'mechMoveFreedom', label: '¿Los jugadores pueden moverse por su cuenta con /move?', type: 'checkbox' }, mechanics.moveFreedom)}
        <p class="hint">Desactivado: solo Staff puede moverlos (<code>/tp</code>). Equivale a <code>/move-freedom</code>.</p>
        <button type="submit" class="btn-secondary">Guardar</button>
      </form>

      <form id="mech-character-form" class="detail-card">
        <h4>${icon('users', { size: 16 })} Creación de personajes</h4>
        ${fieldHtml({ key: 'mechCharCooldown', label: 'Cooldown entre creaciones (horas, 0 = sin cooldown)', type: 'number' }, mechanics.characterCreationCooldownHours)}
        <button type="submit" class="btn-secondary">Guardar</button>
      </form>

      <form id="mech-laburo-form" class="detail-card">
        <h4>${icon('sparkles', { size: 16 })} Laburo</h4>
        ${fieldHtml({ key: 'mechLaburoAmount', label: 'Cantidad base de /laburar', type: 'number' }, mechanics.laburoDayAmount)}
        <button type="submit" class="btn-secondary">Guardar</button>
      </form>

      <form id="mech-attack-form" class="detail-card">
        <h4>${icon('alert-triangle', { size: 16 })} Ataques</h4>
        <p class="hint">Un único límite compartido por <code>/attack jugador</code>, <code>/attack npc</code> y <code>/attack construccion</code> — atacar a cualquiera de los tres cuenta para el mismo cooldown y el mismo tope diario. 0 en cualquiera de los dos campos = sin límite.</p>
        <div class="field-row field-row-compact">
          ${fieldHtml({ key: 'mechAttackMaxPerDay', label: 'Máx. por día', type: 'number' }, mechanics.attackMaxPerDay)}
          ${fieldHtml({ key: 'mechAttackCooldown', label: 'Cooldown (horas)', type: 'number' }, mechanics.attackCooldownHours)}
        </div>
        <button type="submit" class="btn-secondary">Guardar</button>
      </form>

      <form id="mech-session-form" class="detail-card">
        <h4>${icon('settings', { size: 16 })} Sesión web</h4>
        <p class="hint">Minutos de inactividad antes de cerrar la sesión del panel automáticamente. Cualquier clic, tecla o movimiento del ratón la renueva.</p>
        ${fieldHtml({ key: 'mechIdleLogout', label: 'Minutos de inactividad', type: 'number' }, mechanics.idleLogoutMinutes)}
        <button type="submit" class="btn-secondary">Guardar</button>
      </form>

      <form id="mech-gather-form" class="detail-card">
        <h4>${icon('sparkles', { size: 16 })} Recolección</h4>
        <p class="hint">Cooldown de <code>/recolectar</code> — por casilla y jugador: recolectar en una no bloquea recolectar en otra distinta. Los recursos que da cada terreno se configuran en el catálogo de Terrenos.</p>
        ${fieldHtml({ key: 'mechGatherCooldown', label: 'Cooldown por casilla (horas)', type: 'number' }, mechanics.gatherCooldownHours)}
        <button type="submit" class="btn-secondary">Guardar</button>
      </form>

      <form id="mech-map-limit-form" class="detail-card">
        <h4>${icon('crosshair', { size: 16 })} Límite del mapa</h4>
        <p class="hint">Coordenada máxima (X e Y) hasta la que los jugadores pueden moverse con <code>/move</code> — un Rolepriest siempre puede llevarlos más allá con <code>/tp</code>, sin este límite.</p>
        ${fieldHtml({ key: 'mechMapMaxCoord', label: 'Coordenada máxima', type: 'number' }, mechanics.mapMaxCoordinate)}
        <button type="submit" class="btn-secondary">Guardar</button>
      </form>

      <form id="mech-temperature-form" class="detail-card">
        <h4>${icon('thermometer', { size: 16 })} Temperatura del mundo</h4>
        <p class="hint">Rango que se reparte entre las casillas que NO pertenecen a ninguna zona. Cada zona tiene el suyo propio, en el catálogo de <a href="/staff/zonas">Zonas</a>.</p>
        <p class="hint">Cada casilla recibe un valor propio dentro del rango de su zona, cercano al de sus vecinas: la temperatura cambia poco a poco por el mapa, no de golpe. Guardar recalcula el mapa entero.</p>
        <div class="field-row field-row-compact">
          ${fieldHtml({ key: 'mechWorldTempMin', label: 'Mínima (°C)', type: 'number', min: -80, max: 80 }, mechanics.worldTempMin)}
          ${fieldHtml({ key: 'mechWorldTempMax', label: 'Máxima (°C)', type: 'number', min: -80, max: 80 }, mechanics.worldTempMax)}
        </div>
        <button type="submit" class="btn-secondary">Guardar</button>
        <button type="button" id="mech-temperature-reroll" class="btn-secondary">Sortear un clima nuevo</button>
      </form>
    </div>
    <p id="mech-status" class="hint"></p>`;

  container.querySelector('#mech-spawn-form')!.addEventListener('submit', async evt => {
    evt.preventDefault();
    try {
      const x = readField({ key: 'mechSpawnX', type: 'number' }, container);
      const y = readField({ key: 'mechSpawnY', type: 'number' }, container);
      await apiFetch('/api/settings/spawn', { method: 'PATCH', body: { x, y } });
      showToast(`Casilla de aparición actualizada a (${x}, ${y}).`, 'success');
    } catch (err) { showToast(err instanceof Error ? err.message : 'Error desconocido.', 'error'); }
  });

  container.querySelector('#mech-move-form')!.addEventListener('submit', async evt => {
    evt.preventDefault();
    try {
      const moveFreedom = readField({ key: 'mechMoveFreedom', type: 'checkbox' }, container);
      await apiFetch('/api/settings/mechanics', { method: 'PATCH', body: { moveFreedom } });
      showToast(`Movimiento libre ${moveFreedom ? 'activado' : 'desactivado'}.`, 'success');
    } catch (err) { showToast(err instanceof Error ? err.message : 'Error desconocido.', 'error'); }
  });

  container.querySelector('#mech-character-form')!.addEventListener('submit', async evt => {
    evt.preventDefault();
    try {
      const characterCreationCooldownHours = readField({ key: 'mechCharCooldown', type: 'number' }, container);
      await apiFetch('/api/settings/mechanics', { method: 'PATCH', body: { characterCreationCooldownHours } });
      showToast('Cooldown de creación de personajes actualizado.', 'success');
    } catch (err) { showToast(err instanceof Error ? err.message : 'Error desconocido.', 'error'); }
  });

  container.querySelector('#mech-laburo-form')!.addEventListener('submit', async evt => {
    evt.preventDefault();
    try {
      const laburoDayAmount = readField({ key: 'mechLaburoAmount', type: 'number' }, container);
      await apiFetch('/api/settings/mechanics', { method: 'PATCH', body: { laburoDayAmount } });
      showToast('Cantidad base de Laburo actualizada.', 'success');
    } catch (err) { showToast(err instanceof Error ? err.message : 'Error desconocido.', 'error'); }
  });

  container.querySelector('#mech-attack-form')!.addEventListener('submit', async evt => {
    evt.preventDefault();
    try {
      const attackMaxPerDay = readField({ key: 'mechAttackMaxPerDay', type: 'number' }, container);
      const attackCooldownHours = readField({ key: 'mechAttackCooldown', type: 'number' }, container);
      await apiFetch('/api/settings/mechanics', { method: 'PATCH', body: { attackMaxPerDay, attackCooldownHours } });
      showToast('Límites de ataque actualizados.', 'success');
    } catch (err) { showToast(err instanceof Error ? err.message : 'Error desconocido.', 'error'); }
  });

  container.querySelector('#mech-session-form')!.addEventListener('submit', async evt => {
    evt.preventDefault();
    try {
      const idleLogoutMinutes = readField({ key: 'mechIdleLogout', type: 'number' }, container);
      await apiFetch('/api/settings/mechanics', { method: 'PATCH', body: { idleLogoutMinutes } });
      showToast('Sesión web actualizada.', 'success');
    } catch (err) { showToast(err instanceof Error ? err.message : 'Error desconocido.', 'error'); }
  });

  container.querySelector('#mech-gather-form')!.addEventListener('submit', async evt => {
    evt.preventDefault();
    try {
      const gatherCooldownHours = readField({ key: 'mechGatherCooldown', type: 'number' }, container);
      await apiFetch('/api/settings/mechanics', { method: 'PATCH', body: { gatherCooldownHours } });
      showToast('Cooldown de recolección actualizado.', 'success');
    } catch (err) { showToast(err instanceof Error ? err.message : 'Error desconocido.', 'error'); }
  });

  container.querySelector('#mech-temperature-form')!.addEventListener('submit', async evt => {
    evt.preventDefault();
    try {
      const worldTempMin = readField({ key: 'mechWorldTempMin', type: 'number' }, container);
      const worldTempMax = readField({ key: 'mechWorldTempMax', type: 'number' }, container);
      await apiFetch('/api/settings/mechanics', { method: 'PATCH', body: { worldTempMin, worldTempMax } });
      showToast('Temperatura del mundo actualizada y mapa recalculado.', 'success');
    } catch (err) { showToast(err instanceof Error ? err.message : 'Error desconocido.', 'error'); }
  });

  container.querySelector('#mech-temperature-reroll')!.addEventListener('click', async () => {
    const confirmed = await showConfirm({
      title: 'Sortear un clima nuevo',
      message: 'Cambia la temperatura de TODAS las casillas del mapa. Cada zona sigue respetando su rango, pero el reparto dentro de él será otro.',
      confirmLabel: 'Sortear',
    });
    if (!confirmed) return;
    try {
      const { tilesAffected } = await apiFetch<{ tilesAffected: number }>('/api/settings/temperatures/regenerate', { method: 'POST', body: { reroll: true } });
      showToast(`Clima nuevo repartido en ${tilesAffected} casilla(s).`, 'success');
    } catch (err) { showToast(err instanceof Error ? err.message : 'Error desconocido.', 'error'); }
  });

  container.querySelector('#mech-map-limit-form')!.addEventListener('submit', async evt => {
    evt.preventDefault();
    try {
      const mapMaxCoordinate = readField({ key: 'mechMapMaxCoord', type: 'number' }, container);
      await apiFetch('/api/settings/mechanics', { method: 'PATCH', body: { mapMaxCoordinate } });
      showToast('Límite del mapa actualizado.', 'success');
    } catch (err) { showToast(err instanceof Error ? err.message : 'Error desconocido.', 'error'); }
  });
}
