import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { resetDatabase, createCharacter, ACTOR } from './helpers.mjs';

let db;
let T;
let goods;
let wood;
let iron;

before(async () => {
  ({ db, T } = await resetDatabase());
  goods = await import('../../src/services/goodsService.js');
  await goods.createCategory({ name: 'materiales', displayName: 'Materiales' }, ACTOR);
  wood = await goods.createType({ displayName: 'Madera', categoryName: 'materiales' }, ACTOR);
  iron = await goods.createType({ displayName: 'Hierro Fundido', categoryName: 'Materiales' }, ACTOR);
});

after(async () => {
  await db.closePool();
});

async function rows(playerId) {
  return db.query(`SELECT item_id, quantity FROM ${T.inventory} WHERE player_id = ? ORDER BY item_id`, [playerId]);
}

async function total(itemId) {
  const r = await db.queryOne(`SELECT COALESCE(SUM(quantity), 0) AS s FROM ${T.inventory} WHERE item_id = ?`, [itemId]);
  return Number(r.s);
}

test('catálogo: slug derivado, búsqueda, desactivación', async () => {
  assert.equal(wood.name, 'madera');
  assert.equal(wood.category, 'Materiales');
  assert.equal((await goods.findTypeByName('HIERRO fundido')).id, iron.id);
  assert.equal((await goods.findTypeByName('madera')).id, wood.id);
  assert.deepEqual((await goods.searchTypes('hier')).map(t => t.id), [iron.id]);
  await assert.rejects(goods.createType({ displayName: 'Madera' }, ACTOR), /Ya existe/);
  const temp = await goods.createType({ displayName: 'Temporal' }, ACTOR);
  await goods.setTypeActive(temp.id, false, ACTOR);
  assert.equal((await goods.listTypes()).some(t => t.id === temp.id), false);
  assert.equal((await goods.listTypes({ includeInactive: true })).some(t => t.id === temp.id), true);
  const p = await createCharacter(db, T);
  await assert.rejects(goods.addGoods(p.id, temp.id, 1, ACTOR), /desactivado/);
  const edited = await goods.editType(temp.id, { displayName: 'Temporal 2', categoryName: 'materiales' }, ACTOR);
  assert.equal(edited.display_name, 'Temporal 2');
  assert.equal(edited.category, 'Materiales');
});

test('alta 0,5 + 0,25 = 0,75 y listado', async () => {
  const p = await createCharacter(db, T);
  assert.equal(await goods.addGoods(p.id, wood.id, 0.5, ACTOR), 0.5);
  assert.equal(await goods.addGoods(p.id, wood.id, 0.25, ACTOR), 0.75);
  const inv = await goods.listInventory(p.id);
  assert.equal(inv.total, 1);
  assert.deepEqual(inv.rows[0], { item_id: wood.id, display_name: 'Madera', emoji: wood.emoji, category: 'Materiales', quantity: 0.75 });
  await assert.rejects(goods.addGoods(p.id, wood.id, 0.001, ACTOR), /2 decimales/);
  await assert.rejects(goods.addGoods(p.id, wood.id, 0, ACTOR), /mayor que 0/);
  await assert.rejects(goods.addGoods(p.id, wood.id, -1, ACTOR), /mayor que 0/);
  const dead = await createCharacter(db, T, { isAlive: false });
  await assert.rejects(goods.addGoods(dead.id, wood.id, 1, ACTOR), /vivo/);
});

test('baja exacta borra la fila; baja de más no cambia nada', async () => {
  const p = await createCharacter(db, T);
  await goods.addGoods(p.id, wood.id, 2.5, ACTOR);
  await assert.rejects(goods.removeGoods(p.id, wood.id, 2.51, ACTOR), /solo hay 2.5/);
  assert.equal((await rows(p.id))[0].quantity, '2.50');
  assert.equal(await goods.removeGoods(p.id, wood.id, 0.5, ACTOR), 2);
  assert.equal(await goods.removeGoods(p.id, wood.id, 2, ACTOR), 0);
  assert.deepEqual(await rows(p.id), []);
  await assert.rejects(goods.removeGoods(p.id, wood.id, 1, ACTOR), /solo hay 0/);
});

test('traspaso parcial y total', async () => {
  const a = await createCharacter(db, T);
  const b = await createCharacter(db, T);
  await goods.addGoods(a.id, iron.id, 5, ACTOR);
  await goods.adminTransferGoods(a.id, b.id, iron.id, 1.5, ACTOR);
  assert.equal((await goods.listInventory(a.id)).rows[0].quantity, 3.5);
  assert.equal((await goods.listInventory(b.id)).rows[0].quantity, 1.5);
  await goods.adminTransferGoods(a.id, b.id, iron.id, 3.5, ACTOR);
  assert.deepEqual(await rows(a.id), []);
  assert.equal((await goods.listInventory(b.id)).rows[0].quantity, 5);
  await assert.rejects(goods.adminTransferGoods(a.id, b.id, iron.id, 1, ACTOR), /No hay suficiente/);
  await assert.rejects(goods.adminTransferGoods(b.id, b.id, iron.id, 1, ACTOR), /mismo/);
  const dead = await createCharacter(db, T, { isAlive: false });
  await assert.rejects(goods.adminTransferGoods(b.id, dead.id, iron.id, 1, ACTOR), /vivo/);
  assert.equal((await goods.listInventory(b.id)).rows[0].quantity, 5);
});

test('un fallo del destino deshace la resta del origen', async () => {
  const a = await createCharacter(db, T);
  const b = await createCharacter(db, T);
  await goods.addGoods(a.id, wood.id, 3, ACTOR);
  await goods.addGoods(b.id, wood.id, 999999999999.5, ACTOR);
  await assert.rejects(goods.adminTransferGoods(a.id, b.id, wood.id, 3, ACTOR));
  assert.equal((await goods.listInventory(a.id)).rows[0].quantity, 3);
});

test('carrera: dos traspasos de 3 con 4 disponibles, pasa uno', async () => {
  const a = await createCharacter(db, T);
  const b = await createCharacter(db, T);
  const c = await createCharacter(db, T);
  await goods.addGoods(a.id, wood.id, 4, ACTOR);
  const results = await Promise.allSettled([
    goods.adminTransferGoods(a.id, b.id, wood.id, 3, ACTOR),
    goods.adminTransferGoods(a.id, c.id, wood.id, 3, ACTOR),
  ]);
  assert.equal(results.filter(r => r.status === 'fulfilled').length, 1);
  const sum = (await Promise.all([a, b, c].map(p => goods.listInventory(p.id)))).flatMap(i => i.rows).reduce((s, r) => s + r.quantity, 0);
  assert.equal(sum, 4);
});

test('carrera: diez bajas de 1 con 7 disponibles, pasan exactamente 7', async () => {
  const p = await createCharacter(db, T);
  await goods.addGoods(p.id, iron.id, 7, ACTOR);
  const results = await Promise.allSettled(Array.from({ length: 10 }, () => goods.removeGoods(p.id, iron.id, 1, ACTOR)));
  assert.equal(results.filter(r => r.status === 'fulfilled').length, 7);
  assert.deepEqual(await rows(p.id), []);
});

test('carrera: traspasos cruzados A->B y B->A no pierden bienes ni caen en deadlock', async () => {
  const a = await createCharacter(db, T);
  const b = await createCharacter(db, T);
  await goods.addGoods(a.id, wood.id, 10, ACTOR);
  await goods.addGoods(b.id, wood.id, 10, ACTOR);
  const jobs = [];
  for (let i = 0; i < 10; i++) {
    jobs.push(goods.adminTransferGoods(a.id, b.id, wood.id, 1, ACTOR));
    jobs.push(goods.adminTransferGoods(b.id, a.id, wood.id, 2, ACTOR));
  }
  const results = await Promise.allSettled(jobs);
  for (const f of results.filter(r => r.status === 'rejected')) assert.equal(f.reason.name, 'UserFacingError', f.reason.message);
  const [ra, rb] = await Promise.all([goods.listInventory(a.id), goods.listInventory(b.id)]);
  assert.equal((ra.rows[0]?.quantity ?? 0) + (rb.rows[0]?.quantity ?? 0), 20);
});
