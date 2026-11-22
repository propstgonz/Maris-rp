import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import { makeFakeDb, makeFakeNamedExports } from './helpers/mockDb.mjs';

const fakeDb = makeFakeDb();
mock.module('../src/database/index.js', { defaultExport: fakeDb, namedExports: makeFakeNamedExports(fakeDb) });
mock.module('../src/services/activityFeed.js', {
  namedExports: {
    describeActivity: (row) => row._testText ?? null,
    describeActivityForTarget: (row) => row._testTargetText ?? null,
  },
});

const { selectSectionsToRefresh } = await import('../src/mapServer/state/auditPoller.js');
const { ACTION_SECTION_MAP } = await import('../src/mapServer/state/sse.js');

test('fila source="discord" con acción mapeada → su sección Y "log" entran en el resultado', () => {
  const { sections, maxId } = selectSectionsToRefresh(
    [{ id: 5, source: 'discord', action: 'tile.construction_place' }],
    ACTION_SECTION_MAP
  );
  assert.deepEqual([...sections].sort(), ['log', 'map']);
  assert.equal(maxId, 5);
});

test('fila source="web" se ignora para las secciones — ya se refrescó al instante en auditWeb()', () => {
  const { sections, maxId } = selectSectionsToRefresh(
    [{ id: 7, source: 'web', action: 'tile.update' }],
    ACTION_SECTION_MAP
  );
  assert.equal(sections.size, 0);

  assert.equal(maxId, 7);
});

test('acción con prefijo sin mapear en ACTION_SECTION_MAP no dispara su propia sección, pero SÍ "log"', () => {
  const { sections, events, maxId } = selectSectionsToRefresh(
    [{ id: 3, source: 'discord', action: 'craft.done', target: 'p1' }],
    ACTION_SECTION_MAP
  );
  assert.deepEqual([...sections], ['log']);
  assert.deepEqual(events, [{ section: 'log', entity: 'craft', id: 'p1', message: null }]);
  assert.equal(maxId, 3);
});

test('varias filas de distintas secciones en el mismo lote → todas presentes, sin duplicar (incluida "log")', () => {
  const { sections, maxId } = selectSectionsToRefresh(
    [
      { id: 10, source: 'discord', action: 'tile.range_create' },
      { id: 11, source: 'discord', action: 'item.create' },
      { id: 12, source: 'discord', action: 'tile.construction_remove' },
    ],
    ACTION_SECTION_MAP
  );
  assert.deepEqual([...sections].sort(), ['items', 'log', 'map']);
  assert.equal(maxId, 12);
});

test('lote vacío devuelve secciones vacías y maxId en 0', () => {
  const { sections, maxId } = selectSectionsToRefresh([], ACTION_SECTION_MAP);
  assert.equal(sections.size, 0);
  assert.equal(maxId, 0);
});

test('events (Fase "termina el plan", ver docs/plan.md §3.4) trae {section, entity, id, message} por cada fila con target distinto, más su "log" emparejado', () => {
  const { events } = selectSectionsToRefresh(
    [
      { id: 30, source: 'discord', action: 'item.update', target: 'rifle' },
      { id: 31, source: 'discord', action: 'item.update', target: 'pan' },
    ],
    ACTION_SECTION_MAP
  );
  assert.deepEqual(events, [
    { section: 'log', entity: 'item', id: 'rifle', message: null },
    { section: 'items', entity: 'item', id: 'rifle', message: null },
    { section: 'log', entity: 'item', id: 'pan', message: null },
    { section: 'items', entity: 'item', id: 'pan', message: null },
  ]);
});

test('events deduplica filas que apuntan a la MISMA (section, entity, id) — no repite el mismo aviso, ni el de "log"', () => {
  const { events } = selectSectionsToRefresh(
    [
      { id: 40, source: 'discord', action: 'item.update', target: 'rifle' },
      { id: 41, source: 'discord', action: 'item.update', target: 'rifle' },
      { id: 42, source: 'discord', action: 'construction.update', target: 'rifle' },
    ],
    ACTION_SECTION_MAP
  );
  assert.deepEqual(events, [
    { section: 'log', entity: 'item', id: 'rifle', message: null },
    { section: 'items', entity: 'item', id: 'rifle', message: null },
    { section: 'log', entity: 'construction', id: 'rifle', message: null },
    { section: 'constructions', entity: 'construction', id: 'rifle', message: null },
  ]);
});

test('maxId es el más alto del lote aunque las filas no lleguen ordenadas', () => {
  const { maxId } = selectSectionsToRefresh(
    [
      { id: 20, source: 'discord', action: 'player.kill' },
      { id: 18, source: 'discord', action: 'player.kill' },
      { id: 25, source: 'web', action: 'player.kill' },
    ],
    ACTION_SECTION_MAP
  );
  assert.equal(maxId, 25);
});

test('una fila con texto (describeActivity) y actor_discord_id genera una notificación para ese jugador', () => {
  const { notifications } = selectSectionsToRefresh(
    [{ id: 50, source: 'discord', action: 'combat.melee_hit', actor_discord_id: 'p1', _testText: 'Has atacado a X.' }],
    ACTION_SECTION_MAP
  );
  assert.deepEqual(notifications, [{ discordId: 'p1', text: 'Has atacado a X.' }]);
});

test('una fila source="web" NO genera notificación — quien actuó ya lo vio en la propia web', () => {
  const { notifications } = selectSectionsToRefresh(
    [{ id: 51, source: 'web', action: 'combat.melee_hit', actor_discord_id: 'p1', _testText: 'Has atacado a X.' }],
    ACTION_SECTION_MAP
  );
  assert.deepEqual(notifications, []);
});

test('el mensaje de un evento para Staff antepone el nombre del actor al texto de describeActivity', () => {
  const { events } = selectSectionsToRefresh(
    [{ id: 52, source: 'discord', action: 'tile.construction_place', actor_username: 'fulano', _testText: 'Ha construido algo.' }],
    ACTION_SECTION_MAP
  );
  assert.equal(events.find(e => e.section === 'map').message, 'fulano: Ha construido algo.');
});

test('una fila con texto de describeActivityForTarget y target genera una notificación accionable para el objetivo', () => {
  const { notifications } = selectSectionsToRefresh(
    [{ id: 60, source: 'discord', action: 'combat.melee_hit', target: 'victima', _testTargetText: 'Te han atacado.' }],
    ACTION_SECTION_MAP
  );
  assert.deepEqual(notifications, [{ discordId: 'victima', text: 'Te han atacado.', action: 'open-attack' }]);
});

test('la notificación al objetivo se genera también para filas source="web" — el objetivo no tiene otro aviso en la web', () => {
  const { notifications } = selectSectionsToRefresh(
    [{ id: 61, source: 'web', action: 'combat.melee_hit', target: 'victima', _testTargetText: 'Te han atacado.' }],
    ACTION_SECTION_MAP
  );
  assert.deepEqual(notifications, [{ discordId: 'victima', text: 'Te han atacado.', action: 'open-attack' }]);
});

test('una fila puede generar notificación de actor Y de objetivo a la vez, sin pisarse', () => {
  const { notifications } = selectSectionsToRefresh(
    [{
      id: 62, source: 'discord', action: 'combat.melee_hit',
      actor_discord_id: 'atacante', target: 'victima',
      _testText: 'Has atacado.', _testTargetText: 'Te han atacado.',
    }],
    ACTION_SECTION_MAP
  );
  assert.deepEqual(notifications, [
    { discordId: 'atacante', text: 'Has atacado.' },
    { discordId: 'victima', text: 'Te han atacado.', action: 'open-attack' },
  ]);
});
