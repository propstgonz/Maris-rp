import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { resetDatabase, createCharacter, ACTOR } from './helpers.mjs';

let db, T, svc, a, b;

before(async () => {
  ({ db, T } = await resetDatabase());
  svc = await import('../../src/services/npcHoldingService.js');
  a = await createCharacter(db, T);
  b = await createCharacter(db, T);
});

after(async () => { await db.closePool(); });

const total = async () => Number((await db.queryOne(`SELECT COUNT(*) AS n FROM ${T.player_npcs}`)).n);
const countOf = async (id, name) =>
  Number((await db.queryOne(`SELECT COUNT(*) AS n FROM ${T.player_npcs} WHERE owner_player_id = ? AND name = ?`, [id, name])).n);

test('alta, listado agrupado paginado y baja', async () => {
  assert.equal(await svc.addNpcs(a.id, 'Guardia', 5, ACTOR), 5);
  await svc.addNpcs(a.id, 'Unidad de Trabajo', 2, ACTOR);
  await svc.addNpcs(a.id, 'Zapatero', 1, ACTOR);
  const p1 = await svc.listGrouped(a.id, { page: 1, pageSize: 2 });
  assert.deepEqual(p1, { rows: [{ name: 'Guardia', count: 5 }, { name: 'Unidad de Trabajo', count: 2 }], total: 3 });
  const p2 = await svc.listGrouped(a.id, { page: 2, pageSize: 2 });
  assert.deepEqual(p2.rows, [{ name: 'Zapatero', count: 1 }]);
  assert.equal(await svc.removeNpcs(a.id, 'Zapatero', 1, ACTOR), 0);
});

test('baja de más de los que hay no borra ninguno', async () => {
  await assert.rejects(svc.removeNpcs(a.id, 'Guardia', 6, ACTOR), /Solo tiene 5/);
  assert.equal(await countOf(a.id, 'Guardia'), 5);
});

test('traspaso de 3 de 5 conserva el total', async () => {
  const before = await total();
  await db.withTransaction(() => svc.transferNpcsInTx(a.id, b.id, 'Guardia', 3));
  assert.equal(await countOf(a.id, 'Guardia'), 2);
  assert.equal(await countOf(b.id, 'Guardia'), 3);
  assert.equal(await total(), before);
  await assert.rejects(db.withTransaction(() => svc.transferNpcsInTx(a.id, b.id, 'Guardia', 3)), /Solo tiene 2/);
  assert.equal(await total(), before);
});

test('alta en personaje muerto rechazada', async () => {
  const dead = await createCharacter(db, T, { isAlive: false });
  await assert.rejects(svc.addNpcs(dead.id, 'Guardia', 1, ACTOR), /no está vivo/);
});

test('carrera: dos traspasos de 3 con 4 disponibles, pasa exactamente uno', async () => {
  const c = await createCharacter(db, T);
  const d = await createCharacter(db, T);
  await svc.addNpcs(c.id, 'Sirviente', 4, ACTOR);
  const before = await total();
  const res = await Promise.allSettled([
    db.withTransaction(() => svc.transferNpcsInTx(c.id, d.id, 'Sirviente', 3)),
    db.withTransaction(() => svc.transferNpcsInTx(c.id, d.id, 'Sirviente', 3)),
  ]);
  assert.equal(res.filter(r => r.status === 'fulfilled').length, 1);
  assert.equal(await countOf(c.id, 'Sirviente'), 1);
  assert.equal(await countOf(d.id, 'Sirviente'), 3);
  assert.equal(await total(), before);
});

test('carrera: dos bajas de 3 con 4 disponibles, pasa exactamente una', async () => {
  const e = await createCharacter(db, T);
  await svc.addNpcs(e.id, 'Mula', 4, ACTOR);
  const res = await Promise.allSettled([
    svc.removeNpcs(e.id, 'Mula', 3, ACTOR),
    svc.removeNpcs(e.id, 'Mula', 3, ACTOR),
  ]);
  assert.equal(res.filter(r => r.status === 'fulfilled').length, 1);
  assert.equal(await countOf(e.id, 'Mula'), 1);
});
