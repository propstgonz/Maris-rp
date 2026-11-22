import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import { makeFakeNamedExports } from './helpers/mockDb.mjs';

const construction = {
  id: 5, name: 'Muralla Norte', coord_x: 3, coord_y: 4, tile_faction_id: null,
  built_by_player_id: null, destroy_policy: 'any', granted_item_name: null,
};
const deletedIds = [];

const fakeDb = {
  prepare: (sql) => {
    const q = sql.trim().replace(/\s+/g, ' ');
    if (q.startsWith('SELECT c.*')) return { get: () => construction };
    if (q.startsWith('DELETE FROM')) return { run: (id) => { deletedIds.push(id); return { changes: 1 }; } };
    return { get: () => undefined, all: () => [], run: () => ({ changes: 0 }) };
  },
  exec: () => {},
  pragma: () => {},
  transaction: (fn) => (...args) => fn(...args),
  close: () => {},
};
mock.module('../src/database/index.js', { defaultExport: fakeDb, namedExports: makeFakeNamedExports(fakeDb) });
mock.module('../src/services/permissionService.js', {
  namedExports: { resolvePermission: async () => ({ allowed: true }) },
});

const { removeConstruction } = await import('../src/services/mapService.js');

test('removeConstruction sin actor (Staff, editor de mapa) no exige posición', async () => {
  const result = await removeConstruction(5);
  assert.equal(result.id, 5);
});

test('removeConstruction con actor pero sin playerPos no exige posición (compatibilidad hacia atrás)', async () => {
  const result = await removeConstruction(5, { discordId: 'p1', isRolepriest: false });
  assert.equal(result.id, 5);
});

test('removeConstruction con actor y playerPos que NO coincide con la construcción lanza, sin borrar nada', async () => {
  deletedIds.length = 0;
  await assert.rejects(
    () => removeConstruction(5, { discordId: 'p1', isRolepriest: false }, { x: 0, y: 0 }),
    /Tienes que estar físicamente en esa casilla/
  );
  assert.deepEqual(deletedIds, []);
});

test('removeConstruction con actor y playerPos que SÍ coincide procede con normalidad', async () => {
  deletedIds.length = 0;
  const result = await removeConstruction(5, { discordId: 'p1', isRolepriest: false }, { x: 3, y: 4 });
  assert.equal(result.id, 5);
  assert.deepEqual(deletedIds, [5]);
});
