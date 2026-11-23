import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { resetDatabase, createCharacter, ACTOR } from './helpers.mjs';
import { ensureEndedByColumn } from './schemaPatch.mjs';

const { db, T } = await resetDatabase();
await ensureEndedByColumn(db);
const lifecycle = await import('../../src/services/characterLifecycleService.js');
const consent = await import('../../src/services/consentService.js');
const marriage = await import('../../src/services/marriageService.js');
const goods = await import('../../src/services/goodsService.js');
const npcs = await import('../../src/services/npcHoldingService.js');
const properties = await import('../../src/services/propertyService.js');
const audit = await import('../../src/services/auditLogService.js');
const { UserFacingError } = await import('../../src/utils/errors.js');

after(() => db.closePool());

const ROUNDS = 10;
const settle = promises => Promise.allSettled(promises);
const fulfilled = results => results.filter(r => r.status === 'fulfilled').length;

function assertOnlyUserFacing(results) {
  for (const result of results) {
    if (result.status === 'rejected') {
      assert.ok(result.reason instanceof UserFacingError, `error no controlado: ${result.reason?.code ?? ''} ${result.reason?.message}`);
    }
  }
}

async function reload(playerId) {
  return db.queryOne(`SELECT * FROM ${T.players} WHERE id = ?`, [playerId]);
}

async function openMarriages(playerId) {
  const row = await db.queryOne(`SELECT COUNT(*) AS n FROM ${T.marriage_members} WHERE player_id = ? AND open_slot = 1`, [playerId]);
  return Number(row.n);
}

async function pendingFrom(playerId) {
  const row = await db.queryOne(`SELECT COUNT(*) AS n FROM ${T.consent_requests} WHERE from_player_id = ? AND status = 'pending'`, [playerId]);
  return Number(row.n);
}

async function marry(a, b) {
  const id = await marriage.propose(a.id, b.id, ACTOR);
  await consent.accept(id, b.id, ACTOR);
}

const wood = await goods.createType({ displayName: 'Madera Vida' }, ACTOR);
const house = await properties.createType({ displayName: 'Casa Vida', category: 'vivienda' }, ACTOR);

test('muerte en gracia: solo marca la muerte, conserva todo y revivir lo devuelve intacto', async () => {
  const a = await createCharacter(db, T, { gender: 'hombre' });
  const b = await createCharacter(db, T, { gender: 'mujer' });
  await marry(a, b);
  await goods.addGoods(a.id, wood.id, 4, ACTOR);
  await npcs.addNpcs(a.id, 'Guardia', 2, ACTOR);
  await properties.grantProperty(a.id, house.id, {}, ACTOR);
  const pendingId = await consent.createRequest({ kind: 'item', fromPlayerId: a.id, toPlayerId: b.id, itemId: wood.id, quantity: 1 });

  await lifecycle.markDeceased(null, a.discord_id, 'abandonó el servidor', { permadeath: false });
  const grace = await reload(a.id);
  assert.equal(grace.is_alive, 0);
  assert.ok(grace.died_at);
  assert.ok(grace.character_created_at);
  assert.equal((await consent.getRequest(pendingId)).status, 'cancelled');
  assert.equal(await openMarriages(a.id), 1);
  assert.equal((await marriage.getCivilStatus(b.id)).label, 'Casada');
  assert.equal((await goods.listInventory(a.id)).total, 1);

  const revived = await lifecycle.reviveCharacter(a.discord_id, ACTOR);
  assert.equal(revived.is_alive, 1);
  assert.equal(revived.character_name, a.character_name);
  assert.equal((await goods.listInventory(a.id)).rows[0].quantity, 4);
  assert.equal((await npcs.listGrouped(a.id)).rows[0].count, 2);
  assert.equal((await properties.listProperties(a.id)).total, 1);
  assert.equal((await marriage.getCivilStatus(a.id)).label, 'Casado');
  assert.equal((await marriage.getCivilStatus(b.id)).label, 'Casada');
});

test('volver dentro de los 7 días recupera el personaje; pasados los 7 días no, y la poda lo finaliza', async () => {
  const back = await createCharacter(db, T);
  await goods.addGoods(back.id, wood.id, 2, ACTOR);
  await lifecycle.markDeceased(null, back.discord_id, 'abandonó el servidor');
  const returned = await lifecycle.reviveOnReturn(back.discord_id);
  assert.equal(returned.is_alive, 1);
  assert.equal((await goods.listInventory(back.id)).rows[0].quantity, 2);

  const late = await createCharacter(db, T, { gender: 'mujer' });
  const widower = await createCharacter(db, T, { gender: 'hombre' });
  await marry(late, widower);
  await goods.addGoods(late.id, wood.id, 2, ACTOR);
  await lifecycle.markDeceased(null, late.discord_id, 'abandonó el servidor');
  await db.execute(`UPDATE ${T.players} SET died_at = NOW() - INTERVAL 8 DAY WHERE id = ?`, [late.id]);
  assert.equal(await lifecycle.reviveOnReturn(late.discord_id), null);
  assert.equal((await reload(late.id)).is_alive, 0);

  assert.ok(await lifecycle.pruneExpiredCharacters(null) >= 1);
  const gone = await reload(late.id);
  assert.equal(gone.character_created_at, null);
  assert.equal(gone.is_alive, 1);
  assert.equal((await goods.listInventory(late.id)).total, 0);
  assert.equal((await marriage.getCivilStatus(widower.id)).label, 'Viudo');
  await assert.rejects(() => lifecycle.reviveCharacter(late.discord_id, ACTOR), err => err instanceof UserFacingError && /murió definitivamente/.test(err.message));
  assert.equal(await lifecycle.reviveOnReturn(late.discord_id), null);
  const deaths = await db.query(`SELECT details FROM ${T.audit_log} WHERE action = 'personaje.muerte' AND target = ?`, [late.discord_id]);
  assert.equal(deaths.length, 1);
  assert.equal(JSON.parse(deaths[0].details).snapshot.goods[0].quantity, 2);
});

test('muerte definitiva (/kill) desde la gracia: finaliza, viudedad y el muerto queda soltero/a', async () => {
  const a = await createCharacter(db, T, { gender: 'hombre' });
  const b = await createCharacter(db, T, { gender: 'mujer' });
  await marry(a, b);
  await lifecycle.markDeceased(null, a.discord_id, 'abandonó el servidor');
  const player = await lifecycle.markDeceased(null, a.discord_id, 'finalizado', { permadeath: true, actor: ACTOR });
  assert.equal(player.fromGrace, true);
  assert.equal((await marriage.getCivilStatus(b.id)).label, 'Viuda');
  assert.equal((await marriage.getCivilStatus(a.id)).label, 'Soltero/a');
  assert.equal(await openMarriages(b.id), 0);
  await assert.rejects(() => lifecycle.finalizeGraceDeath(a.discord_id), /ya murió definitivamente/);
});

test('/kill frente a una aceptación concurrente: la muerte siempre se aplica y nunca queda casado un muerto', async () => {
  for (let i = 0; i < ROUNDS; i += 1) {
    const a = await createCharacter(db, T);
    const b = await createCharacter(db, T);
    const requestId = await marriage.propose(a.id, b.id, ACTOR);
    const victim = i % 2 === 0 ? a : b;
    const results = await settle([consent.accept(requestId, b.id, ACTOR), lifecycle.killCharacter(victim.discord_id, 'test', ACTOR)]);
    assertOnlyUserFacing(results);
    assert.equal(results[1].status, 'fulfilled', `ronda ${i}: la muerte se perdió: ${results[1].reason?.message}`);
    assert.equal((await reload(victim.id)).character_created_at, null);
    assert.equal(await openMarriages(victim.id), 0);
    assert.equal(await openMarriages(victim === a ? b.id : a.id), 0);
    assert.equal(await pendingFrom(victim.id), 0);
  }
});

test('/kill frente a un divorcio concurrente: un matrimonio cerrado y la muerte aplicada', async () => {
  for (let i = 0; i < ROUNDS; i += 1) {
    const a = await createCharacter(db, T);
    const b = await createCharacter(db, T);
    await marry(a, b);
    const divorcing = i % 2 === 0 ? b : a;
    const results = await settle([lifecycle.killCharacter(a.discord_id, 'test', ACTOR), marriage.divorce(divorcing.id, ACTOR)]);
    assertOnlyUserFacing(results);
    assert.equal(results[0].status, 'fulfilled', `ronda ${i}: la muerte se perdió: ${results[0].reason?.message}`);
    assert.equal((await reload(a.id)).character_created_at, null);
    assert.equal(await openMarriages(a.id) + await openMarriages(b.id), 0);
  }
});

test('propuestas cruzadas aceptadas a la vez: una sola gana y queda un solo matrimonio', async () => {
  for (let i = 0; i < ROUNDS; i += 1) {
    const a = await createCharacter(db, T);
    const b = await createCharacter(db, T);
    const ab = await consent.createRequest({ kind: 'marriage', fromPlayerId: a.id, toPlayerId: b.id });
    const ba = await consent.createRequest({ kind: 'marriage', fromPlayerId: b.id, toPlayerId: a.id });
    const results = await settle([consent.accept(ab, b.id, ACTOR), consent.accept(ba, a.id, ACTOR)]);
    assertOnlyUserFacing(results);
    assert.equal(fulfilled(results), 1, `ronda ${i}`);
    assert.equal(await openMarriages(a.id), 1);
    assert.equal(await openMarriages(b.id), 1);
  }
});

test('crear una solicitud frente a la muerte del emisor no deja solicitudes de un muerto', async () => {
  for (let i = 0; i < ROUNDS; i += 1) {
    const a = await createCharacter(db, T);
    const b = await createCharacter(db, T);
    const results = await settle([
      consent.createRequest({ kind: 'marriage', fromPlayerId: a.id, toPlayerId: b.id }),
      lifecycle.killCharacter(a.discord_id, 'test', ACTOR),
    ]);
    assertOnlyUserFacing(results);
    assert.equal(results[1].status, 'fulfilled');
    assert.equal(await pendingFrom(a.id), 0);
  }
});

test('addGoods concurrente con la muerte no deja bienes huérfanos', async () => {
  for (let i = 0; i < ROUNDS; i += 1) {
    const a = await createCharacter(db, T);
    const results = await settle([goods.addGoods(a.id, wood.id, 3, ACTOR), lifecycle.killCharacter(a.discord_id, 'test', ACTOR)]);
    assertOnlyUserFacing(results);
    assert.equal(results[1].status, 'fulfilled');
    assert.equal((await goods.listInventory(a.id)).total, 0, `ronda ${i}`);
  }
});

test('traspasos de bienes de un administrador frente a la muerte del origen', async () => {
  for (let i = 0; i < ROUNDS; i += 1) {
    const a = await createCharacter(db, T);
    const b = await createCharacter(db, T);
    await goods.addGoods(a.id, wood.id, 5, ACTOR);
    const results = await settle([goods.adminTransferGoods(a.id, b.id, wood.id, 5, ACTOR), lifecycle.killCharacter(a.discord_id, 'test', ACTOR)]);
    assertOnlyUserFacing(results);
    assert.equal(results[1].status, 'fulfilled');
    const left = (await goods.listInventory(a.id)).total;
    const received = (await goods.listInventory(b.id)).rows[0]?.quantity ?? 0;
    assert.equal(left, 0);
    assert.ok(received === 0 || received === 5, `recibido ${received}`);
  }
});

test('traspasos de NPC y propiedades de un administrador frente a la muerte del origen', async () => {
  for (let i = 0; i < ROUNDS; i += 1) {
    const a = await createCharacter(db, T);
    const b = await createCharacter(db, T);
    await npcs.addNpcs(a.id, 'Peon', 2, ACTOR);
    const prop = await properties.grantProperty(a.id, house.id, {}, ACTOR);
    const results = await settle([
      npcs.adminTransferNpcs(a.id, b.id, 'Peon', 2, ACTOR),
      properties.adminTransferProperty(prop.id, b.id, ACTOR),
      lifecycle.killCharacter(a.discord_id, 'test', ACTOR),
    ]);
    assertOnlyUserFacing(results);
    assert.equal(results[2].status, 'fulfilled');
    assert.equal((await npcs.listGrouped(a.id)).total, 0);
    assert.equal((await properties.listProperties(a.id)).total, 0);
  }
});

test('tope de solicitudes pendientes por pareja', async () => {
  const a = await createCharacter(db, T);
  const b = await createCharacter(db, T);
  await goods.addGoods(a.id, wood.id, 10, ACTOR);
  const send = () => consent.createRequest({ kind: 'item', fromPlayerId: a.id, toPlayerId: b.id, itemId: wood.id, quantity: 1 });
  for (let i = 0; i < 5; i += 1) await send();
  await assert.rejects(send, err => err instanceof UserFacingError && /5 solicitudes pendientes/.test(err.message));
  const burst = await settle([send(), send(), send()]);
  assert.equal(fulfilled(burst), 0);
  const listed = await consent.listPendingForPlayer(b.id);
  assert.equal(listed.incomingTotal, 5);
  assert.equal(listed.outgoingTotal, 0);
});

test('la poda del registro de acciones conserva las instantáneas de muerte', async () => {
  const a = await createCharacter(db, T);
  await lifecycle.killCharacter(a.discord_id, 'test', ACTOR);
  await db.execute(`UPDATE ${T.audit_log} SET created_at = NOW() - INTERVAL 60 DAY`);
  await audit.logAction({ actor: ACTOR, action: 'otra.cosa', target: 'x' });
  await db.execute(`UPDATE ${T.audit_log} SET created_at = NOW() - INTERVAL 60 DAY WHERE action = 'otra.cosa'`);
  await audit.pruneOldAuditLog(30);
  const kept = await db.query(`SELECT action FROM ${T.audit_log} WHERE target = ?`, [a.discord_id]);
  assert.ok(kept.some(row => row.action === 'personaje.muerte'));
  assert.equal((await db.query(`SELECT id FROM ${T.audit_log} WHERE action = 'otra.cosa'`)).length, 0);
});

test('withTransaction con retryOnDeadlock reintenta el interbloqueo hasta completar ambas', async () => {
  const a = await createCharacter(db, T);
  const b = await createCharacter(db, T);
  const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
  const lockOne = id => db.query(`SELECT id FROM ${T.players} WHERE id = ? FOR UPDATE`, [id]);
  const crossing = (first, second) => db.withTransaction(async () => {
    await lockOne(first);
    await pause(150);
    await lockOne(second);
    return true;
  }, { retryOnDeadlock: 4 });
  const results = await settle([crossing(a.id, b.id), crossing(b.id, a.id)]);
  assert.equal(fulfilled(results), 2, results.map(r => r.reason?.message).join(' | '));
});
