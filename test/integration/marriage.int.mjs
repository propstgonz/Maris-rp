import { test, mock, after } from 'node:test';
import assert from 'node:assert/strict';
import { resetDatabase, createCharacter, ACTOR } from './helpers.mjs';
import { ensureEndedByColumn } from './schemaPatch.mjs';

const { db, T } = await resetDatabase();
await ensureEndedByColumn(db);
const marriage = await import('../../src/services/marriageService.js');
const consent = await import('../../src/services/consentService.js');
const profile = await import('../../src/services/profileService.js');
const lifecycle = await import('../../src/services/characterLifecycleService.js');
const npcs = await import('../../src/services/npcHoldingService.js');

after(async () => { await db.closePool(); });

const settle = promises => Promise.allSettled(promises);
const passed = results => results.filter(r => r.status === 'fulfilled').length;

async function openCount(playerId) {
  const row = await db.queryOne(`SELECT COUNT(*) AS n FROM ${T.marriage_members} WHERE player_id = ? AND open_slot = 1`, [playerId]);
  return Number(row.n);
}

async function marry(a, b) {
  const requestId = await marriage.propose(a.id, b.id, ACTOR);
  await consent.accept(requestId, b.id, ACTOR);
}

test('propuesta y aceptación: un matrimonio, ambos perfiles lo reflejan', async () => {
  const a = await createCharacter(db, T, { gender: 'hombre' });
  const b = await createCharacter(db, T, { gender: 'mujer' });
  const requestId = await marriage.propose(a.id, b.id, ACTOR);
  assert.equal((await consent.getRequest(requestId)).status, 'pending');
  await assert.rejects(() => consent.accept(requestId, a.id, ACTOR), /no es para ti/);
  await consent.accept(requestId, b.id, ACTOR);
  assert.equal((await consent.getRequest(requestId)).status, 'accepted');

  const [profileA, profileB] = await Promise.all([profile.getProfile(a.id), profile.getProfile(b.id)]);
  assert.equal(profileA.civil.label, 'Casado');
  assert.equal(profileB.civil.label, 'Casada');
  assert.equal(profileA.civil.spouse.id, b.id);
  assert.equal(profileB.civil.spouse.id, a.id);
  assert.equal(profileA.civil.spouse.characterName, b.character_name);

  const marriages = await db.query(`SELECT * FROM ${T.marriages} WHERE proposed_by_player_id = ?`, [a.id]);
  assert.equal(marriages.length, 1);
  assert.equal(marriages[0].accepted_by_player_id, b.id);
  assert.equal(marriages[0].ended_at, null);
  await assert.rejects(() => consent.accept(requestId, b.id, ACTOR), /resuelta/);
});

test('rechazos de propuesta: uno mismo, ya casado, muerto y duplicada', async () => {
  const a = await createCharacter(db, T);
  const b = await createCharacter(db, T);
  const c = await createCharacter(db, T);
  const dead = await createCharacter(db, T, { isAlive: false });
  await assert.rejects(() => marriage.propose(a.id, a.id, ACTOR), /contigo mismo/);
  await assert.rejects(() => marriage.propose(a.id, dead.id, ACTOR), /no tiene un personaje vivo/);
  await assert.rejects(() => marriage.propose(dead.id, a.id, ACTOR), /Necesitas un personaje vivo/);

  await marriage.propose(a.id, b.id, ACTOR);
  await assert.rejects(() => marriage.propose(a.id, b.id, ACTOR), /pendiente/);
  await assert.rejects(() => marriage.propose(b.id, a.id, ACTOR), /pendiente/);

  await marry(b, c);
  await assert.rejects(() => marriage.propose(a.id, b.id, ACTOR), /ya está casada/);
  await assert.rejects(() => marriage.propose(b.id, a.id, ACTOR), /Ya estás casado/);
});

test('dos aceptaciones simultáneas de la misma propuesta: un solo matrimonio', async () => {
  const a = await createCharacter(db, T);
  const b = await createCharacter(db, T);
  const requestId = await marriage.propose(a.id, b.id, ACTOR);
  const results = await settle([
    consent.accept(requestId, b.id, ACTOR),
    consent.accept(requestId, b.id, ACTOR),
    consent.accept(requestId, b.id, ACTOR),
  ]);
  assert.equal(passed(results), 1);
  const rows = await db.query(`SELECT * FROM ${T.marriages} WHERE proposed_by_player_id = ?`, [a.id]);
  assert.equal(rows.length, 1);
  assert.equal(await openCount(a.id), 1);
  assert.equal(await openCount(b.id), 1);
});

test('matrimonios cruzados simultáneos A-B y A-C: A tiene como mucho uno vigente', async () => {
  const a = await createCharacter(db, T);
  const b = await createCharacter(db, T);
  const c = await createCharacter(db, T);
  const toB = await marriage.propose(a.id, b.id, ACTOR);
  const toC = await marriage.propose(a.id, c.id, ACTOR);
  const results = await settle([
    consent.accept(toB, b.id, ACTOR),
    consent.accept(toC, c.id, ACTOR),
  ]);
  assert.equal(passed(results), 1);
  assert.equal(await openCount(a.id), 1);
  assert.equal(await openCount(b.id) + await openCount(c.id), 1);
  const statuses = await db.query(`SELECT status FROM ${T.consent_requests} WHERE id IN (?, ?)`, [toB, toC]);
  assert.deepEqual(statuses.map(s => s.status).sort(), ['accepted', 'cancelled']);
});

test('aceptar una propuesta cancela las demás pendientes de ambos', async () => {
  const a = await createCharacter(db, T);
  const b = await createCharacter(db, T);
  const c = await createCharacter(db, T);
  const toB = await marriage.propose(a.id, b.id, ACTOR);
  const fromC = await marriage.propose(c.id, a.id, ACTOR);
  await consent.accept(toB, b.id, ACTOR);
  assert.equal((await consent.getRequest(fromC)).status, 'cancelled');
  await assert.rejects(() => consent.accept(fromC, a.id, ACTOR), /resuelta/);
});

test('divorcio: ambos perfiles vuelven a soltero y se puede volver a casar', async () => {
  const a = await createCharacter(db, T, { gender: 'hombre' });
  const b = await createCharacter(db, T, { gender: 'mujer' });
  await marry(a, b);
  const result = await marriage.divorce(b.id, ACTOR);
  assert.equal(result.spouse.id, a.id);

  const [profileA, profileB] = await Promise.all([profile.getProfile(a.id), profile.getProfile(b.id)]);
  assert.equal(profileA.civil.label, 'Soltero');
  assert.equal(profileB.civil.label, 'Soltera');
  assert.equal(profileA.civil.spouse, null);
  assert.equal(profileB.civil.spouse, null);

  const ended = await db.queryOne(`SELECT * FROM ${T.marriages} WHERE id = ?`, [result.marriageId]);
  assert.equal(ended.end_reason, 'divorcio');
  assert.ok(ended.ended_at);
  assert.equal(await openCount(a.id) + await openCount(b.id), 0);
  await assert.rejects(() => marriage.divorce(a.id, ACTOR), /No estás casado/);

  await marry(b, a);
  assert.equal((await marriage.getCivilStatus(a.id)).label, 'Casado');
});

test('divorcios simultáneos de los dos cónyuges: solo uno pasa', async () => {
  const a = await createCharacter(db, T);
  const b = await createCharacter(db, T);
  await marry(a, b);
  const results = await settle([marriage.divorce(a.id, ACTOR), marriage.divorce(b.id, ACTOR)]);
  assert.equal(passed(results), 1);
  assert.equal(await openCount(a.id) + await openCount(b.id), 0);
});

test('anulación del Rolepriest', async () => {
  const a = await createCharacter(db, T);
  const b = await createCharacter(db, T);
  await marry(a, b);
  const { marriageId } = await marriage.annul(a.id, ACTOR);
  assert.equal((await db.queryOne(`SELECT end_reason FROM ${T.marriages} WHERE id = ?`, [marriageId])).end_reason, 'anulacion');
  assert.equal((await marriage.getCivilStatus(b.id)).label, 'Soltera');
  await assert.rejects(() => marriage.annul(a.id, ACTOR), /no está casado/);
});

test('muerte: el cónyuge queda viudo/a, el muerto soltero/a y un personaje nuevo empieza soltero', async () => {
  const a = await createCharacter(db, T, { gender: 'hombre' });
  const b = await createCharacter(db, T, { gender: 'mujer' });
  await marry(a, b);
  await lifecycle.killCharacter(a.discord_id, 'duelo', ACTOR);

  const widow = await marriage.getCivilStatus(b.id);
  assert.equal(widow.label, 'Viuda');
  assert.equal(widow.spouse, null);
  assert.equal((await marriage.getCivilStatus(a.id)).label, 'Soltero/a');
  assert.equal(await openCount(a.id) + await openCount(b.id), 0);
  const ended = await db.queryOne(`SELECT end_reason, ended_by_player_id FROM ${T.marriages} WHERE proposed_by_player_id = ?`, [a.id]);
  assert.equal(ended.end_reason, 'viudedad');
  assert.equal(ended.ended_by_player_id, a.id);

  await db.execute(`UPDATE ${T.players} SET gender = 'hombre', character_created_at = '2000-01-01 00:00:00' WHERE id = ?`, [a.id]);
  assert.equal((await marriage.getCivilStatus(a.id)).label, 'Soltero');
  assert.equal((await marriage.getCivilStatus(b.id)).label, 'Viuda');
  await db.execute(`UPDATE ${T.players} SET gender = NULL, character_created_at = NULL WHERE id = ?`, [a.id]);

  await db.execute(`UPDATE ${T.players} SET died_at = NOW() - INTERVAL 400 HOUR WHERE id = ?`, [a.id]);
  const reborn = await lifecycle.createCharacter(a.discord_id, 'u', { characterName: 'Renacido', age: 20, gender: 'hombre', raceSlug: 'nordico' });
  assert.equal((await marriage.getCivilStatus(reborn.id)).label, 'Soltero');

  const remarry = await createCharacter(db, T);
  await marry(b, remarry);
  assert.equal((await marriage.getCivilStatus(b.id)).label, 'Casada');
});

test('las propuestas caducadas no se pueden aceptar', async () => {
  const a = await createCharacter(db, T);
  const b = await createCharacter(db, T);
  const requestId = await marriage.propose(a.id, b.id, ACTOR);
  await db.execute(`UPDATE ${T.consent_requests} SET expires_at = NOW() - INTERVAL 1 MINUTE WHERE id = ?`, [requestId]);
  await assert.rejects(() => consent.accept(requestId, b.id, ACTOR), /ha caducado/);
  await marriage.propose(a.id, b.id, ACTOR);
});

test('rechazar y cancelar: solo destinatario y emisor', async () => {
  const a = await createCharacter(db, T);
  const b = await createCharacter(db, T);
  const first = await marriage.propose(a.id, b.id, ACTOR);
  await assert.rejects(() => consent.reject(first, a.id, ACTOR), /no es para ti/);
  await consent.reject(first, b.id, ACTOR);
  const second = await marriage.propose(a.id, b.id, ACTOR);
  await assert.rejects(() => consent.cancel(second, b.id, ACTOR), /no la hiciste tú/);
  await consent.cancel(second, a.id, ACTOR);
  assert.equal((await consent.getRequest(second)).status, 'cancelled');
});

test('solicitud de NPCs: el despacho por tipo la deja aceptada', async () => {
  const a = await createCharacter(db, T);
  const b = await createCharacter(db, T);
  await npcs.addNpcs(a.id, 'Guardia', 2, ACTOR);
  const requestId = await consent.createRequest({ kind: 'npc', fromPlayerId: a.id, toPlayerId: b.id, npcName: 'Guardia', npcCount: 2 });
  await consent.accept(requestId, b.id, ACTOR);
  assert.equal((await consent.getRequest(requestId)).status, 'accepted');
});
