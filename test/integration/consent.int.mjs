import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { resetDatabase, createCharacter, ACTOR } from './helpers.mjs';

const { db, T } = await resetDatabase();
const consent = await import('../../src/services/consentService.js');
const goods = await import('../../src/services/goodsService.js');
const npcs = await import('../../src/services/npcHoldingService.js');
const properties = await import('../../src/services/propertyService.js');
const lifecycle = await import('../../src/services/characterLifecycleService.js');

after(() => db.closePool());

const settle = promises => Promise.allSettled(promises);
const fulfilled = results => results.filter(r => r.status === 'fulfilled').length;

async function quantityOf(playerId, itemId) {
  const row = await db.queryOne(`SELECT quantity FROM ${T.inventory} WHERE player_id = ? AND item_id = ?`, [playerId, itemId]);
  return row ? Number(row.quantity) : 0;
}

async function status(requestId) {
  return (await consent.getRequest(requestId)).status;
}

const madera = await goods.createType({ displayName: 'Madera Test' }, ACTOR);
const tipoCasa = await properties.createType({ displayName: 'Casa Test', category: 'vivienda' }, ACTOR);

test('traspaso de bienes aceptado mueve la cantidad exacta', async () => {
  const a = await createCharacter(db, T);
  const b = await createCharacter(db, T);
  await goods.addGoods(a.id, madera.id, 10, ACTOR);
  const id = await consent.createRequest({ kind: 'item', fromPlayerId: a.id, toPlayerId: b.id, itemId: madera.id, quantity: 2.5 });
  await consent.accept(id, b.id, ACTOR);
  assert.equal(await quantityOf(a.id, madera.id), 7.5);
  assert.equal(await quantityOf(b.id, madera.id), 2.5);
  assert.equal(await status(id), 'accepted');
});

test('solo el destinatario puede aceptar y una solicitud solo se acepta una vez', async () => {
  const a = await createCharacter(db, T);
  const b = await createCharacter(db, T);
  const c = await createCharacter(db, T);
  await goods.addGoods(a.id, madera.id, 5, ACTOR);
  const id = await consent.createRequest({ kind: 'item', fromPlayerId: a.id, toPlayerId: b.id, itemId: madera.id, quantity: 1 });
  await assert.rejects(consent.accept(id, c.id, ACTOR), /no es para ti/);
  const results = await settle([1, 2, 3, 4].map(() => consent.accept(id, b.id, ACTOR)));
  assert.equal(fulfilled(results), 1);
  assert.equal(await quantityOf(a.id, madera.id), 4);
  assert.equal(await quantityOf(b.id, madera.id), 1);
});

test('dos ofertas aceptadas a la vez sobre el mismo stock: solo pasa la que cabe y la otra se cancela', async () => {
  const a = await createCharacter(db, T);
  const b = await createCharacter(db, T);
  const c = await createCharacter(db, T);
  await goods.addGoods(a.id, madera.id, 4, ACTOR);
  const toB = await consent.createRequest({ kind: 'item', fromPlayerId: a.id, toPlayerId: b.id, itemId: madera.id, quantity: 3 });
  const toC = await consent.createRequest({ kind: 'item', fromPlayerId: a.id, toPlayerId: c.id, itemId: madera.id, quantity: 3 });
  const results = await settle([consent.accept(toB, b.id, ACTOR), consent.accept(toC, c.id, ACTOR)]);
  assert.equal(fulfilled(results), 1);
  const total = await quantityOf(a.id, madera.id) + await quantityOf(b.id, madera.id) + await quantityOf(c.id, madera.id);
  assert.equal(total, 4);
  assert.deepEqual([await status(toB), await status(toC)].sort(), ['accepted', 'cancelled']);
});

test('traspaso de NPCs aceptado y concurrente sin duplicar ni perder', async () => {
  const a = await createCharacter(db, T);
  const b = await createCharacter(db, T);
  const c = await createCharacter(db, T);
  await npcs.addNpcs(a.id, 'Guardia', 4, ACTOR);
  const toB = await consent.createRequest({ kind: 'npc', fromPlayerId: a.id, toPlayerId: b.id, npcName: 'Guardia', npcCount: 3 });
  const toC = await consent.createRequest({ kind: 'npc', fromPlayerId: a.id, toPlayerId: c.id, npcName: 'Guardia', npcCount: 3 });
  const results = await settle([consent.accept(toB, b.id, ACTOR), consent.accept(toC, c.id, ACTOR)]);
  assert.equal(fulfilled(results), 1);
  const { n } = await db.queryOne(`SELECT COUNT(*) AS n FROM ${T.player_npcs} WHERE owner_player_id IN (?, ?, ?)`, [a.id, b.id, c.id]);
  assert.equal(Number(n), 4);
});

test('la misma propiedad ofrecida a dos jugadores acaba con un solo dueño', async () => {
  const a = await createCharacter(db, T);
  const b = await createCharacter(db, T);
  const c = await createCharacter(db, T);
  const casa = await properties.grantProperty(a.id, tipoCasa.id, { name: 'Casa del lago' }, ACTOR);
  const toB = await consent.createRequest({ kind: 'property', fromPlayerId: a.id, toPlayerId: b.id, propertyId: casa.id });
  const toC = await consent.createRequest({ kind: 'property', fromPlayerId: a.id, toPlayerId: c.id, propertyId: casa.id });
  const results = await settle([consent.accept(toB, b.id, ACTOR), consent.accept(toC, c.id, ACTOR)]);
  assert.equal(fulfilled(results), 1);
  const owner = (await properties.getProperty(casa.id)).owner_player_id;
  assert.ok([b.id, c.id].includes(owner));
});

test('una solicitud caducada no se puede aceptar', async () => {
  const a = await createCharacter(db, T);
  const b = await createCharacter(db, T);
  await goods.addGoods(a.id, madera.id, 1, ACTOR);
  const id = await consent.createRequest({ kind: 'item', fromPlayerId: a.id, toPlayerId: b.id, itemId: madera.id, quantity: 1 });
  await db.execute(`UPDATE ${T.consent_requests} SET expires_at = NOW() - INTERVAL 1 MINUTE WHERE id = ?`, [id]);
  await assert.rejects(consent.accept(id, b.id, ACTOR), /caducado/);
  assert.equal(await quantityOf(a.id, madera.id), 1);
});

test('morir mientras se acepta un traspaso no deja bienes huérfanos ni duplicados', async () => {
  for (let i = 0; i < 5; i += 1) {
    const a = await createCharacter(db, T);
    const b = await createCharacter(db, T);
    await goods.addGoods(a.id, madera.id, 6, ACTOR);
    const id = await consent.createRequest({ kind: 'item', fromPlayerId: a.id, toPlayerId: b.id, itemId: madera.id, quantity: 6 });
    await settle([consent.accept(id, b.id, ACTOR), lifecycle.killCharacter(a.discord_id, 'test', ACTOR)]);
    const left = await quantityOf(a.id, madera.id);
    const received = await quantityOf(b.id, madera.id);
    assert.equal(left, 0);
    assert.ok(received === 0 || received === 6, `recibido ${received}`);
  }
});
