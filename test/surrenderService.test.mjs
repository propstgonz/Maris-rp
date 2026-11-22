import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import { makeFakeDb, makeFakeNamedExports } from './helpers/mockDb.mjs';

const fakeDb = makeFakeDb();
const events = [];

mock.module('../src/database/index.js', {
  defaultExport: fakeDb,
  namedExports: {
    ...makeFakeNamedExports(fakeDb),
    withTransaction: async (fn) => {
      events.push('begin');
      try {
        const result = await fn();
        events.push('commit');
        return result;
      } catch (err) {
        events.push('rollback');
        throw err;
      }
    },
  },
});

let inventory = [];
mock.module('../src/services/inventoryService.js', {
  namedExports: {
    getInventory: async () => inventory,
    removeItem: async (discordId, name) => { events.push(`remove:${name}`); },
  },
});

const { pickSurrenderLoot } = await import('../src/services/surrenderService.js');

const item = (name) => ({ name, display_name: name, emoji: null, item_type: 'recurso', quantity: 5 });

test('un ítem que no se puede entregar se queda con su dueño, no se destruye', async () => {
  inventory = [item('hierro')];
  events.length = 0;

  const loot = await pickSurrenderLoot('victima', async () => {
    events.push('deliver:fallo');
    throw new Error('El inventario del atacante está lleno.');
  });

  assert.deepEqual(loot, [], 'no puede reportarse como botín entregado');
  assert.deepEqual(events, ['begin', 'remove:hierro', 'deliver:fallo', 'rollback'],
    'quitarlo y entregarlo tienen que ir en la MISMA transacción, y deshacerse juntos');
});

test('un fallo de entrega no aborta el resto del botín', async () => {
  inventory = [item('hierro'), item('madera'), item('piedra')];
  events.length = 0;

  const realRandom = Math.random;
  Math.random = () => 0.99;
  let loot;
  try {
    loot = await pickSurrenderLoot('victima', async ({ name }) => {
      if (name === 'madera') throw new Error('no cabe');
    });
  } finally {
    Math.random = realRandom;
  }

  assert.deepEqual(loot.map(i => i.name), ['hierro', 'piedra'],
    'el que falló se queda con su dueño, los otros dos siguen entregándose');
  assert.equal(events.filter(e => e === 'rollback').length, 1);
  assert.equal(events.filter(e => e === 'commit').length, 2);
});

test('el botín entregado sale del inventario y se reporta', async () => {
  inventory = [item('hierro')];
  events.length = 0;

  const entregado = [];
  const loot = await pickSurrenderLoot('victima', async ({ name, quantity }) => {
    entregado.push({ name, quantity });
  });

  assert.deepEqual(loot.map(i => i.name), ['hierro']);
  assert.deepEqual(entregado, [{ name: 'hierro', quantity: 1 }]);
  assert.deepEqual(events, ['begin', 'remove:hierro', 'commit']);
});

test('el Laburo y los vehículos nunca entran en el botín', async () => {
  inventory = [
    { name: 'laburo', display_name: 'Laburo', emoji: null, item_type: 'laburo', quantity: 50 },
    { name: 'coche', display_name: 'Coche', emoji: null, item_type: 'vehiculo', quantity: 1 },
  ];
  const loot = await pickSurrenderLoot('victima', async () => {});
  assert.deepEqual(loot, []);
});
