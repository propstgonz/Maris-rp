import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import { makeFakeDb, makeFakeNamedExports } from './helpers/mockDb.mjs';

const fakeDb = makeFakeDb();
const calls = [];
const fakeNamed = {
  ...makeFakeNamedExports(fakeDb),
  query: async (sql, params) => { calls.push({ sql, params }); return []; },
  queryOne: async (sql, params) => { calls.push({ sql, params }); return undefined; },
  execute: async (sql, params) => { calls.push({ sql, params }); return { changes: 0, lastInsertRowid: 0 }; },
};
mock.module('../src/database/index.js', { defaultExport: fakeDb, namedExports: fakeNamed });
mock.module('../src/services/auditLogService.js', { namedExports: { logAction: async () => {} } });

const goods = await import('../src/services/goodsService.js');
const ACTOR = { discordId: '1', username: 'rp', source: 'discord' };

test('validateQuantity acepta hasta 2 decimales y redondea al céntimo', () => {
  assert.equal(goods.validateQuantity(0.5), 0.5);
  assert.equal(goods.validateQuantity('0.25'), 0.25);
  assert.equal(goods.validateQuantity(0.1 + 0.2), 0.3);
  assert.equal(goods.validateQuantity(999999999999.99), 999999999999.99);
});

test('validateQuantity rechaza cero, negativos, NaN, 3 decimales y excesos', () => {
  for (const bad of [0, -1, -0.5, NaN, 'abc', null, 0.001, 1.005, 1e13]) {
    assert.throws(() => goods.validateQuantity(bad), { name: 'UserFacingError' }, String(bad));
  }
});

test('addGoods y removeGoods validan la cantidad antes de tocar la base de datos', async () => {
  calls.length = 0;
  await assert.rejects(goods.addGoods(1, 1, 0.001, ACTOR), /2 decimales/);
  await assert.rejects(goods.removeGoods(1, 1, -2, ACTOR), /mayor que 0/);
  await assert.rejects(goods.transferGoodsInTx(1, 2, 1, 0), /mayor que 0/);
  assert.equal(calls.length, 0);
});

test('addGoods rechaza un jugador sin personaje vivo', async () => {
  await assert.rejects(goods.addGoods(1, 1, 1, ACTOR), /vivo/);
});

test('transferGoodsInTx rechaza origen igual al destino sin consultar', async () => {
  calls.length = 0;
  await assert.rejects(goods.transferGoodsInTx(3, 3, 1, 1), /mismo/);
  assert.equal(calls.length, 0);
});

test('removeGoods con tipo inexistente falla con UserFacingError', async () => {
  await assert.rejects(goods.removeGoods(1, 99, 1, ACTOR), /no existe/);
});

test('createType exige nombre y respeta el tope de longitud', async () => {
  await assert.rejects(goods.createType({ displayName: '  ' }, ACTOR), /obligatorio/);
  await assert.rejects(goods.createType({ displayName: 'x'.repeat(192) }, ACTOR), /191/);
  await assert.rejects(goods.createType({ displayName: 'Ok', emoji: 'e'.repeat(33) }, ACTOR), /32/);
});

test('createType con categoría inexistente falla', async () => {
  await assert.rejects(goods.createType({ displayName: 'Madera', categoryName: 'nada' }, ACTOR), /no existe/);
});

test('listInventory interpola paginación saneada', async () => {
  calls.length = 0;
  await goods.listInventory(1, { page: 3, pageSize: 10 }).catch(() => {});
  assert.match(calls[0].sql, /LIMIT 10 OFFSET 20/);
  calls.length = 0;
  await goods.listInventory(1, { page: -5, pageSize: 'x; DROP' }).catch(() => {});
  assert.match(calls[0].sql, /LIMIT 10 OFFSET 0/);
});
