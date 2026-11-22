import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import { makeFakeDb, makeFakeNamedExports } from './helpers/mockDb.mjs';

const fakeDb = makeFakeDb();
let currentWeight = 0;
let addChanges = 2;
let lastAdd = null;

mock.module('../src/database/index.js', {
  defaultExport: fakeDb,
  namedExports: {
    ...makeFakeNamedExports(fakeDb),
    queryOne: async (sql) => {
      if (/inventory_capacity/.test(sql)) return { id: 5, username: 'Jugador', inventory_capacity: 10 };
      if (/SUM\(inv\.quantity/.test(sql)) return { total: currentWeight };
      if (/FROM items|\.items/.test(sql)) return { id: 7, weight: 1, display_name: 'Madera', name: 'madera' };
      return { quantity: 3 };
    },
    execute: async (sql, params = []) => {
      if (/INSERT INTO/.test(sql)) {
        lastAdd = { sql, params };
        return { changes: addChanges, lastInsertRowid: 0 };
      }
      return { changes: 1, lastInsertRowid: 0 };
    },
    withTransaction: async (fn) => fn(),
  },
});

const { addItem } = await import('../src/services/inventoryService.js');

test('la capacidad se comprueba también en el WHERE de la escritura', async () => {
  currentWeight = 0;
  addChanges = 2;

  await addItem('jugador', 'madera', 2);

  assert.match(lastAdd.sql, /inventory_capacity/,
    'el if previo no aguanta una carrera: la guarda decisiva va en la escritura');
  assert.deepEqual(lastAdd.params, [5, 7, 2, 5, 2, 5]);
});

test('perder la carrera por el último hueco no añade nada', async () => {
  currentWeight = 0;
  addChanges = 0;

  await assert.rejects(() => addItem('jugador', 'madera', 2), /no tiene espacio/,
    'si otro llenó la mochila entre la lectura y la escritura, el ítem no entra');
});

test('un inventario ya lleno se rechaza antes de escribir', async () => {
  currentWeight = 10;
  lastAdd = null;

  await assert.rejects(() => addItem('jugador', 'madera', 2), /no tiene espacio/);
  assert.equal(lastAdd, null);
});
