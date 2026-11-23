import { test, mock, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { resetDatabase, createCharacter, ACTOR } from './helpers.mjs';

const dice = { roll: 10 };
mock.module('../../src/utils/dice.js', { namedExports: { rollDie: () => dice.roll } });

let db, T, svc, UserFacingError;
before(async () => {
  ({ db, T } = await resetDatabase());
  ({ UserFacingError } = await import('../../src/utils/errors.js'));
  svc = await import('../../src/services/magicService.js');
});
after(async () => { await db.closePool(); });

async function makePlayer({ stats = {}, race = 'nordico', menhir = null, alive = true } = {}) {
  const p = await createCharacter(db, T, { raceSlug: race, isAlive: alive });
  const sets = Object.keys(stats).map(k => `stat_${k} = ?`);
  if (sets.length) await db.execute(`UPDATE ${T.players} SET ${sets.join(', ')} WHERE id = ?`, [...Object.values(stats), p.id]);
  if (menhir) {
    await db.execute(
      `UPDATE ${T.players} SET menhir_id = (SELECT id FROM ${T.menhirs} WHERE slug = ?) WHERE id = ?`, [menhir, p.id]
    );
  }
  return p.id;
}
const rank = async (pid, slug) => Number((await db.queryOne(
  `SELECT COALESCE(sp.level_rank, 0) AS r FROM ${T.schools} s
   LEFT JOIN ${T.school_progress} sp ON sp.school_id = s.id AND sp.player_id = ? WHERE s.slug = ?`, [pid, slug]
)).r);
const attempts = async pid => Number((await db.queryOne(
  `SELECT COUNT(*) AS n FROM ${T.magic_attempts} WHERE player_id = ?`, [pid])).n);
const expire = (pid, slug) => db.execute(
  `UPDATE ${T.school_progress} SET retry_after = NOW() - INTERVAL 1 DAY
   WHERE player_id = ? AND school_id = (SELECT id FROM ${T.schools} WHERE slug = ?)`, [pid, slug]);
const roll = (pid, slug, extra = {}) => svc.authorizedRoll({ playerId: pid, schoolSlug: slug, mentorLabel: 'NPC', actor: ACTOR, ...extra });
const userFacing = error => error instanceof UserFacingError;

test('catalogo: 6 escuelas, Encantamiento inactiva y sin conjuros; 21/15/11/14/14', async () => {
  assert.equal((await svc.listSchools({ includeInactive: true })).length, 6);
  const active = await svc.listSchools();
  assert.deepEqual(active.map(s => s.slug), ['destruccion', 'alteracion', 'restauracion', 'ilusion', 'conjuracion']);
  const counts = await db.query(
    `SELECT s.slug, COUNT(sp.id) AS n FROM ${T.schools} s LEFT JOIN ${T.spells} sp ON sp.school_id = s.id GROUP BY s.slug`);
  const bySlug = Object.fromEntries(counts.map(c => [c.slug, Number(c.n)]));
  assert.deepEqual(bySlug, { destruccion: 21, alteracion: 15, restauracion: 11, ilusion: 14, conjuracion: 14, encantamiento: 0 });
});

test('Encantamiento no se puede iniciar ni por tirada ni por escuela gratuita', async () => {
  const pid = await makePlayer({ stats: { autismo: 6 } });
  await assert.rejects(roll(pid, 'encantamiento'), /excluida/);
  await assert.rejects(svc.claimFreeSchool(pid, 'encantamiento', ACTOR), /excluida/);
  assert.equal((await db.queryOne(`SELECT free_school_claimed_at AS f FROM ${T.players} WHERE id = ?`, [pid])).f, null);
});

test('escuela gratuita: Aldmer 4+2 si, una sola vez; Bosmer 5 no; con Menhir del Aprendiz si', async () => {
  const aldmer = await makePlayer({ stats: { autismo: 4 }, race: 'aldmer' });
  assert.equal((await svc.getSchoolsOverview(aldmer)).canClaimFreeSchool, true);
  await svc.claimFreeSchool(aldmer, 'ilusion', ACTOR);
  assert.equal(await rank(aldmer, 'ilusion'), 1);
  await assert.rejects(svc.claimFreeSchool(aldmer, 'restauracion', ACTOR), /Ya reclamaste/);
  assert.equal(await rank(aldmer, 'restauracion'), 0);
  assert.equal((await svc.getSchoolsOverview(aldmer)).canClaimFreeSchool, false);

  const bosmer = await makePlayer({ stats: { autismo: 5 }, race: 'bosmer' });
  await assert.rejects(svc.claimFreeSchool(bosmer, 'ilusion', ACTOR), /Autismo efectivo/);
  const aprendiz = await makePlayer({ stats: { autismo: 5 }, race: 'bosmer', menhir: 'aprendiz' });
  await svc.claimFreeSchool(aprendiz, 'ilusion', ACTOR);
  assert.equal(await rank(aprendiz, 'ilusion'), 1);
});

test('escuela gratuita sobre escuela con nivel rechaza y no consume el derecho', async () => {
  const pid = await makePlayer({ stats: { autismo: 6 } });
  await svc.setLevel(pid, 'ilusion', 2, ACTOR);
  await assert.rejects(svc.claimFreeSchool(pid, 'ilusion', ACTOR), /Ya tienes nivel/);
  assert.equal((await db.queryOne(`SELECT free_school_claimed_at AS f FROM ${T.players} WHERE id = ?`, [pid])).f, null);
});

test('subida 0 a 5 con mentor NPC y mentor jugador', async () => {
  const pid = await makePlayer({ stats: { autismo: 6, intuicion: 6 } });
  const mentor = await makePlayer();
  await svc.setLevel(mentor, 'alteracion', 5, ACTOR);
  dice.roll = 20;
  await assert.rejects(roll(pid, 'alteracion', { mentorLabel: null }), /mentor/);
  await assert.rejects(roll(pid, 'alteracion', { mentorPlayerId: pid }), /propio mentor/);
  const weakMentor = await makePlayer();
  await assert.rejects(roll(pid, 'alteracion', { mentorLabel: null, mentorPlayerId: weakMentor }), /nivel 1/);
  const r1 = await roll(pid, 'alteracion');
  assert.equal(r1.success, true);
  assert.equal(r1.targetRank, 1);
  assert.equal(r1.levelName, 'Principiante');
  assert.equal(await rank(pid, 'alteracion'), 1);
  await assert.rejects(roll(pid, 'alteracion', { mentorLabel: null }), /mentor/);
  assert.equal(await attempts(pid), 1);
  const r2 = await roll(pid, 'alteracion', { mentorLabel: 'Maestro NPC' });
  assert.equal(r2.targetRank, 2);
  for (const expected of [3, 4, 5]) {
    const r = await roll(pid, 'alteracion', { mentorPlayerId: mentor });
    assert.equal(r.success, true);
    assert.equal(r.targetRank, expected);
  }
  assert.equal(await rank(pid, 'alteracion'), 5);
  await assert.rejects(roll(pid, 'alteracion', { mentorPlayerId: mentor }), /Maestro/);
  assert.equal(await attempts(pid), 5);
  const log = await db.queryOne(`SELECT COUNT(*) AS n FROM ${T.audit_log} WHERE action = 'magia.tirada'`);
  assert.ok(Number(log.n) >= 5);
});

test('mentor insuficiente rechaza y deshace el enfriamiento y el intento', async () => {
  const pid = await makePlayer({ stats: { autismo: 6 } });
  const weak = await makePlayer();
  await svc.setLevel(pid, 'restauracion', 1, ACTOR);
  await svc.setLevel(weak, 'restauracion', 1, ACTOR);
  dice.roll = 20;
  await assert.rejects(roll(pid, 'restauracion', { mentorPlayerId: weak }), /nivel 2/);
  assert.equal(await attempts(pid), 0);
  const row = await db.queryOne(`SELECT retry_after FROM ${T.school_progress} WHERE player_id = ?`, [pid]);
  assert.equal(row.retry_after, null);
  await assert.rejects(roll(pid, 'restauracion', { mentorPlayerId: pid }), /propio mentor/);
});

test('fallo fija retry_after a +28 dias y bloquea; al expirar se puede reintentar', async () => {
  const pid = await makePlayer({ stats: { autismo: 1 } });
  dice.roll = 1;
  const r = await roll(pid, 'conjuracion');
  assert.equal(r.success, false);
  assert.ok(r.retryAfter);
  const days = (await db.queryOne(
    `SELECT DATEDIFF(retry_after, NOW()) AS d FROM ${T.school_progress} WHERE player_id = ?`, [pid])).d;
  assert.ok([27, 28].includes(Number(days)));
  await assert.rejects(roll(pid, 'conjuracion'), /hasta el/);
  assert.equal(await attempts(pid), 1);
  assert.equal(await rank(pid, 'conjuracion'), 0);

  await expire(pid, 'conjuracion');
  dice.roll = 20;
  const ok = await roll(pid, 'conjuracion');
  assert.equal(ok.success, true);
  assert.equal(await rank(pid, 'conjuracion'), 1);
  assert.equal((await db.queryOne(`SELECT retry_after FROM ${T.school_progress} WHERE player_id = ?`, [pid])).retry_after, null);
});

test('Habil: total 20 falla y total 21 pasa (mas de 20)', async () => {
  const pid = await makePlayer({ stats: { autismo: 3, agilidad: 3 } });
  await svc.setLevel(pid, 'ilusion', 2, ACTOR);
  dice.roll = 14;
  const fail = await roll(pid, 'ilusion', { mentorLabel: 'NPC' });
  assert.equal(fail.total, 20);
  assert.equal(fail.threshold, 20.5);
  assert.equal(fail.success, false);
  await expire(pid, 'ilusion');
  dice.roll = 15;
  const pass = await roll(pid, 'ilusion', { mentorLabel: 'NPC' });
  assert.equal(pass.total, 21);
  assert.equal(pass.success, true);
  assert.equal(await rank(pid, 'ilusion'), 3);
});

test('Habil en Destruccion con Autismo 3 y D20 16 suma 20,5 y pasa', async () => {
  const pid = await makePlayer({ stats: { autismo: 3 } });
  await svc.setLevel(pid, 'destruccion', 2, ACTOR);
  dice.roll = 16;
  const r = await roll(pid, 'destruccion');
  assert.equal(r.total, 20.5);
  assert.equal(r.success, true);
  assert.equal(await rank(pid, 'destruccion'), 3);
});

test('Destruccion con Autismo 5 suma 7,5', async () => {
  const pid = await makePlayer({ stats: { autismo: 5 } });
  dice.roll = 12;
  const r = await roll(pid, 'destruccion');
  assert.equal(r.modifier, 7.5);
  assert.equal(r.total, 19.5);
  assert.equal(r.success, true);
  const row = await db.queryOne(`SELECT modifier, total FROM ${T.magic_attempts} WHERE player_id = ?`, [pid]);
  assert.equal(Number(row.modifier), 7.5);
  assert.equal(Number(row.total), 19.5);
});

test('conjuros desbloqueados exactos por nivel y setLevel hacia abajo los bloquea', async () => {
  const pid = await makePlayer({ stats: { autismo: 6 } });
  assert.equal((await svc.getUnlockedSpells(pid, {})).total, 0);
  for (let level = 1; level <= 5; level++) {
    await svc.setLevel(pid, 'destruccion', level, ACTOR);
    const res = await svc.getUnlockedSpells(pid, { schoolSlug: 'destruccion', pageSize: 100 });
    const real = Number((await db.queryOne(
      `SELECT COUNT(*) AS n FROM ${T.spells} sp JOIN ${T.schools} s ON s.id = sp.school_id
       WHERE s.slug = 'destruccion' AND sp.min_rank <= ?`, [level])).n);
    assert.equal(res.total, real);
    assert.equal(res.rows.length, real);
    assert.ok(res.rows.every(s => s.min_rank <= level));
    assert.equal(typeof res.rows[0].cost_amount, 'number');
  }
  assert.equal((await svc.getUnlockedSpells(pid, { schoolSlug: 'destruccion' })).total, 21);
  assert.equal((await svc.getUnlockedSpells(pid, { schoolSlug: 'destruccion', pageSize: 10 })).rows.length, 10);
  assert.equal((await svc.getUnlockedSpells(pid, { schoolSlug: 'destruccion', page: 3, pageSize: 10 })).rows.length, 1);

  await svc.setLevel(pid, 'destruccion', 2, ACTOR);
  const down = await svc.getUnlockedSpells(pid, { schoolSlug: 'destruccion', pageSize: 100 });
  assert.ok(down.rows.every(s => s.min_rank <= 2));
  assert.ok(down.total < 21);
  const next = await svc.getNextSpells(pid, 'destruccion');
  assert.ok(next.length > 0 && next.every(s => s.min_rank === 3));
  await svc.setLevel(pid, 'destruccion', 0, ACTOR);
  assert.equal((await svc.getUnlockedSpells(pid, {})).total, 0);
  await svc.setLevel(pid, 'destruccion', 5, ACTOR);
  assert.deepEqual(await svc.getNextSpells(pid, 'destruccion'), []);
  assert.deepEqual(await svc.getNextSpells(pid, 'encantamiento'), []);
  await assert.rejects(svc.setLevel(pid, 'destruccion', 6, ACTOR), /entre 0 y 5/);
});

test('overview: niveles, siguiente, magia con menhir y escuelas inactivas', async () => {
  const pid = await makePlayer({ stats: { autismo: 4 }, menhir: 'mago' });
  await svc.setLevel(pid, 'ilusion', 2, ACTOR);
  const ov = await svc.getSchoolsOverview(pid);
  assert.equal(ov.magic.magia, 150);
  assert.equal(ov.schools.length, 6);
  const ilusion = ov.schools.find(s => s.school.slug === 'ilusion');
  assert.equal(ilusion.levelName, 'Aprendiz');
  assert.deepEqual(ilusion.next, { rank: 3, name: 'Hábil', threshold: 20.5, requiresMentor: true });
  assert.ok(ilusion.retryAfter === null);
  const enc = ov.schools.find(s => s.school.slug === 'encantamiento');
  assert.equal(enc.active, false);
  assert.equal(enc.next, null);
});

test('carrera: dos tiradas simultaneas a la misma escuela, una tira y la otra recibe un error claro', async () => {
  const pid = await makePlayer({ stats: { autismo: 0 } });
  dice.roll = 1;
  const results = await Promise.allSettled([roll(pid, 'destruccion'), roll(pid, 'destruccion')]);
  assert.equal(results.filter(r => r.status === 'fulfilled').length, 1);
  const rejected = results.filter(r => r.status === 'rejected');
  assert.ok(rejected.every(r => userFacing(r.reason)), rejected.map(r => r.reason?.message).join('|'));
  assert.match(rejected[0].reason.message, /<t:\d+:D>/);
  assert.equal(await attempts(pid), 1);
  assert.equal(await rank(pid, 'destruccion'), 0);
});

test('carrera: tres tiradas con fallo a la vez dejan un solo intento', async () => {
  const pid = await makePlayer({ stats: { autismo: 0 } });
  dice.roll = 1;
  const results = await Promise.allSettled([roll(pid, 'ilusion'), roll(pid, 'ilusion'), roll(pid, 'ilusion')]);
  assert.equal(results.filter(r => r.status === 'fulfilled').length, 1);
  assert.ok(results.filter(r => r.status === 'rejected').every(r => userFacing(r.reason)));
  assert.equal(await attempts(pid), 1);
});

test('carrera: dos claimFreeSchool simultaneas, solo una', async () => {
  const pid = await makePlayer({ stats: { autismo: 6 } });
  const results = await Promise.allSettled([
    svc.claimFreeSchool(pid, 'ilusion', ACTOR),
    svc.claimFreeSchool(pid, 'conjuracion', ACTOR),
  ]);
  assert.equal(results.filter(r => r.status === 'fulfilled').length, 1);
  assert.ok(results.filter(r => r.status === 'rejected').every(r => userFacing(r.reason)));
  const total = Number((await db.queryOne(
    `SELECT COUNT(*) AS n FROM ${T.school_progress} WHERE player_id = ? AND level_rank >= 1`, [pid])).n);
  assert.equal(total, 1);
});

test('un personaje muerto no puede tirar ni reclamar', async () => {
  const pid = await makePlayer({ stats: { autismo: 6 }, alive: false });
  await assert.rejects(roll(pid, 'ilusion'), /muerto/);
  await assert.rejects(svc.claimFreeSchool(pid, 'ilusion', ACTOR), /muerto/);
});

test('carrera repetida: dos Rolepriest sobre una escuela nueva nunca dan error interno', async () => {
  for (let i = 0; i < 10; i++) {
    const pid = await makePlayer({ stats: { autismo: 0 } });
    dice.roll = 1;
    const results = await Promise.allSettled([roll(pid, 'alteracion'), roll(pid, 'alteracion')]);
    assert.equal(results.filter(r => r.status === 'fulfilled').length, 1);
    assert.ok(results.filter(r => r.status === 'rejected').every(r => userFacing(r.reason)),
      results.map(r => r.reason?.message).join('|'));
  }
});

test('setLevel rechaza escuelas inactivas y conserva el enfriamiento si el nivel no cambia', async () => {
  const pid = await makePlayer({ stats: { autismo: 0 } });
  await assert.rejects(svc.setLevel(pid, 'encantamiento', 1, ACTOR), /excluida/);
  dice.roll = 1;
  await roll(pid, 'conjuracion');
  const cooldown = () => db.queryOne(`SELECT retry_after FROM ${T.school_progress} WHERE player_id = ?`, [pid]);
  assert.ok((await cooldown()).retry_after);
  await svc.setLevel(pid, 'conjuracion', 0, ACTOR);
  assert.ok((await cooldown()).retry_after);
  const res = await svc.setLevel(pid, 'conjuracion', 2, ACTOR);
  assert.equal(res.levelName, 'Aprendiz');
  assert.equal((await cooldown()).retry_after, null);
});

test('escuela gratuita sin raza asignada (jugador heredado) se puede reclamar', async () => {
  const pid = await makePlayer({ stats: { autismo: 6 } });
  await db.execute(`UPDATE ${T.players} SET race_id = NULL WHERE id = ?`, [pid]);
  assert.equal((await svc.getSchoolsOverview(pid)).canClaimFreeSchool, true);
  await svc.claimFreeSchool(pid, 'ilusion', ACTOR);
  assert.equal(await rank(pid, 'ilusion'), 1);
});

test('tope de Magia: Aprendiz no rebasa el de la raza y conjuros avisa del Menhir Ritual', async () => {
  const human = await makePlayer({ stats: { autismo: 6 }, race: 'nordico', menhir: 'aprendiz' });
  assert.equal((await svc.getSchoolsOverview(human)).magic.magia, 150);
  const aldmer = await makePlayer({ stats: { autismo: 6 }, race: 'aldmer', menhir: 'aprendiz' });
  assert.equal((await svc.getSchoolsOverview(aldmer)).magic.magia, 200);
  const ritual = await makePlayer({ stats: { autismo: 2 }, menhir: 'ritual' });
  assert.equal((await svc.getUnlockedSpells(ritual, { schoolSlug: 'destruccion' })).magicToLife, true);
  assert.equal((await svc.getUnlockedSpells(aldmer, { schoolSlug: 'destruccion' })).schoolName, 'Destrucción');
});
