import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mock } from 'node:test';
import { makeFakeNamedExports } from './helpers/mockDb.mjs';

const executedQueries = [];
const fakeDb = {
  prepare: (sql) => ({
    run: (...params) => { executedQueries.push({ sql, params }); return { changes: 1, lastInsertRowid: 0 }; },
    get: () => ({ id: 1, coord_x: 0, coord_y: 0 }),
    all: () => [],
  }),
  exec: () => {},
  pragma: () => {},
  transaction: (fn) => (...args) => fn(...args),
  close: () => {},
};
mock.module('../src/database/index.js', { defaultExport: fakeDb, namedExports: makeFakeNamedExports(fakeDb) });

const { updateTile } = await import('../src/services/mapService.js');

test('updateTile sin resource_type en el payload no toca esa columna (undefined = no cambiar)', async () => {
  executedQueries.length = 0;
  await updateTile(0, 0, { name: 'Test' });
  const [{ sql }] = executedQueries;
  assert.ok(!sql.includes('resource_type'));
});

test('updateTile con resource_type: null SÍ incluye la columna, para poder borrarla', async () => {
  executedQueries.length = 0;
  await updateTile(0, 0, { resource_type: null });
  const [{ sql, params }] = executedQueries;
  assert.ok(sql.includes('resource_type = ?'));
  assert.equal(params[0], null);
});

test('updateTile con resource_type: "" (campo vaciado en el formulario) también borra, no lo ignora', async () => {
  executedQueries.length = 0;
  await updateTile(0, 0, { resource_type: '' });
  const [{ params }] = executedQueries;
  assert.equal(params[0], null);
});

test('updateTile normaliza resource_type a minúsculas/sin espacios', async () => {
  executedQueries.length = 0;
  await updateTile(0, 0, { resource_type: '  Petroleo  ' });
  const [{ params }] = executedQueries;
  assert.equal(params[0], 'petroleo');
});
