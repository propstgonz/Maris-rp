import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import { makeFakeNamedExports } from './helpers/mockDb.mjs';

const ACTOR = { source: 'discord', discordId: '1', username: 'rp' };
const logged = [];
let handler = () => undefined;

const fakeDb = {
  prepare(sql) {
    const q = sql.trim().replace(/\s+/g, ' ');
    return {
      get: (...p) => handler(q, p),
      all: (...p) => handler(q, p),
      run: (...p) => handler(q, p),
    };
  },
};

mock.module('../src/database/index.js', {
  namedExports: makeFakeNamedExports(fakeDb),
});
mock.module('../src/services/auditLogService.js', {
  namedExports: { logAction: async (entry) => { logged.push(entry); } },
});

const svc = await import('../src/services/propertyService.js');

test('categorías: los 10 valores del CHECK', () => {
  assert.deepEqual(svc.PROPERTY_CATEGORIES.map(c => c.value), [
    'vivienda', 'ganaderia', 'infraestructura', 'ocio', 'produccion',
    'extraccion', 'religion', 'educacion', 'naval', 'terreno',
  ]);
});

test('setLevel valida el rango antes de tocar la base de datos', async () => {
  handler = () => { throw new Error('no debe consultar'); };
  for (const bad of [0, 1001, 1.5, '3']) await assert.rejects(() => svc.setLevel(1, bad, ACTOR), /nivel/);
});

test('transferPropertyInTx rechaza cuando changes !== 1', async () => {
  handler = (q, p) => {
    if (q.includes('FROM rp_players.players')) return { id: p[0] };
    if (q.startsWith('UPDATE rp_world.properties')) return { changes: 0, lastInsertRowid: 0 };
  };
  await assert.rejects(() => svc.transferPropertyInTx(1, 2, 9), /ya no es tuya/);
});

test('transferPropertyInTx rechaza destino muerto o igual al origen', async () => {
  handler = () => undefined;
  await assert.rejects(() => svc.transferPropertyInTx(1, 2, 9), /muerto/);
  await assert.rejects(() => svc.transferPropertyInTx(1, 1, 9), /otro personaje/);
});

test('grantProperty rechaza ubicaciones largas y tipos inactivos', async () => {
  await assert.rejects(() => svc.grantProperty(1, 1, { location: 'x'.repeat(101) }, ACTOR), /ubicación/);
  handler = (q) => {
    if (q.includes('FROM rp_players.players')) return { id: 1 };
    if (q.includes('FROM rp_world.property_types')) return { id: 1, is_active: 0 };
  };
  await assert.rejects(() => svc.grantProperty(1, 1, {}, ACTOR), /desactivado/);
});

test('createType registra la acción y traduce duplicados', async () => {
  logged.length = 0;
  handler = (q) => {
    if (q.startsWith('INSERT INTO rp_world.property_types')) return { changes: 1, lastInsertRowid: 7 };
    if (q.startsWith('SELECT * FROM rp_world.property_types')) return { id: 7, display_name: "Casa" };
  };
  await svc.createType({ displayName: 'Casa', category: 'vivienda' }, ACTOR);
  assert.equal(logged[0].action, 'propiedades.tipo_creado');

  handler = () => { throw Object.assign(new Error('dup'), { code: 'ER_DUP_ENTRY' }); };
  await assert.rejects(() => svc.createType({ displayName: 'Casa', category: 'vivienda' }, ACTOR), /Ya existe/);
});
