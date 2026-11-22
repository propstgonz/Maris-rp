import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import { makeFakeDb, makeFakeNamedExports } from './helpers/mockDb.mjs';

const fakeDb = makeFakeDb();
mock.module('../src/database/index.js', { defaultExport: fakeDb, namedExports: makeFakeNamedExports(fakeDb) });

const { selectSectionsToRefresh } = await import('../src/api/state/auditPoller.js');
const { ACTION_SECTION_MAP } = await import('../src/api/state/sse.js');

test('fila source="discord" con acción mapeada: su sección y "log" entran en el resultado', () => {
  const { sections, maxId } = selectSectionsToRefresh(
    [{ id: 5, source: 'discord', action: 'backup.run' }],
    ACTION_SECTION_MAP
  );
  assert.deepEqual([...sections].sort(), ['backups', 'log']);
  assert.equal(maxId, 5);
});

test('fila source="web" se ignora para las secciones: ya se refrescó al instante en auditWeb()', () => {
  const { sections, maxId } = selectSectionsToRefresh(
    [{ id: 7, source: 'web', action: 'player.kill' }],
    ACTION_SECTION_MAP
  );
  assert.equal(sections.size, 0);
  assert.equal(maxId, 7);
});

test('acción con prefijo sin mapear no dispara su propia sección, pero sí "log"', () => {
  const { sections, events, maxId } = selectSectionsToRefresh(
    [{ id: 3, source: 'discord', action: 'dado.roll', target: 'p1' }],
    ACTION_SECTION_MAP
  );
  assert.deepEqual([...sections], ['log']);
  assert.deepEqual(events, [{ section: 'log', entity: 'dado', id: 'p1', message: null }]);
  assert.equal(maxId, 3);
});

test('events trae una entrada por (sección, entidad, id) distinto y deduplica las repetidas', () => {
  const { events } = selectSectionsToRefresh(
    [
      { id: 30, source: 'discord', action: 'player.kill', target: 'a' },
      { id: 31, source: 'discord', action: 'player.revive', target: 'a' },
      { id: 32, source: 'discord', action: 'player.kill', target: 'b' },
    ],
    ACTION_SECTION_MAP
  );
  assert.deepEqual(events, [
    { section: 'log', entity: 'player', id: 'a', message: null },
    { section: 'players', entity: 'player', id: 'a', message: null },
    { section: 'log', entity: 'player', id: 'b', message: null },
    { section: 'players', entity: 'player', id: 'b', message: null },
  ]);
});

test('lote vacío devuelve secciones vacías y maxId en 0; maxId es el más alto aunque lleguen desordenadas', () => {
  assert.equal(selectSectionsToRefresh([], ACTION_SECTION_MAP).maxId, 0);
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
