import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import { makeFakeDb, makeFakeNamedExports } from './helpers/mockDb.mjs';

const fakeDb = makeFakeDb();
let stock = [];
let lastDecrement = null;
let decrementChanges = 1;

mock.module('../src/database/index.js', {
  defaultExport: fakeDb,
  namedExports: {
    ...makeFakeNamedExports(fakeDb),
    query: async () => stock,
    execute: async (sql, params = []) => {
      if (/quantity - \?/.test(sql)) {
        lastDecrement = { sql, params };
        return { changes: decrementChanges, lastInsertRowid: 0 };
      }
      return { changes: 1, lastInsertRowid: 0 };
    },
  },
});

const { takeItem, takeRandomItem } = await import('../src/services/npcInventoryService.js');

const stockRow = (over = {}) => ({ item_id: 3, quantity: 1, name: 'municion', display_name: 'Munición', ...over });

test('la cantidad pedida se comprueba en el WHERE, no antes con un SELECT', async () => {
  stock = [stockRow()];
  decrementChanges = 1;
  lastDecrement = null;

  await takeItem(1, 3, 2);

  assert.match(lastDecrement.sql, /quantity >= \?/,
    'sin la guarda en el WHERE, dos compradores simultáneos dejan el stock en negativo');
  assert.deepEqual(lastDecrement.params, [2, 1, 3, 2]);
});

test('perder la carrera por el último ítem es un error, no una venta', async () => {
  decrementChanges = 0;

  await assert.rejects(() => takeItem(1, 3, 1), /existencias/);
});

test('el robo no entrega nada si otro se llevó antes el último ítem', async () => {
  stock = [stockRow()];
  decrementChanges = 0;

  assert.equal(await takeRandomItem(1), null,
    'devolver el ítem sin haberlo descontado lo duplicaría');
});

test('el robo entrega el ítem cuando el descuento sí se aplica', async () => {
  stock = [stockRow()];
  decrementChanges = 1;

  const taken = await takeRandomItem(1);

  assert.equal(taken.name, 'municion');
  assert.deepEqual(lastDecrement.params, [1, 1, 3, 1]);
});

test('un NPC sin existencias no intenta descontar nada', async () => {
  stock = [];
  lastDecrement = null;

  assert.equal(await takeRandomItem(1), null);
  assert.equal(lastDecrement, null);
});
