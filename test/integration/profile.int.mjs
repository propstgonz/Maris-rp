import { test, mock, after } from 'node:test';
import assert from 'node:assert/strict';
import { resetDatabase, createCharacter, ACTOR } from './helpers.mjs';
import { ensureEndedByColumn } from './schemaPatch.mjs';

const { db, T } = await resetDatabase();
await ensureEndedByColumn(db);
const profile = await import('../../src/services/profileService.js');
const lifecycle = await import('../../src/services/characterLifecycleService.js');
const consent = await import('../../src/services/consentService.js');
const marriage = await import('../../src/services/marriageService.js');
const { STATS } = await import('../../src/domain/picarda.js');

after(async () => { await db.closePool(); });

async function setStats(playerId, stats, bonus = 0) {
  const sets = STATS.map(stat => `stat_${stat} = ${Number(stats[stat] ?? 0)}`).join(', ');
  await db.execute(`UPDATE ${T.players} SET ${sets}, stat_bonus_points = ? WHERE id = ?`, [bonus, playerId]);
}

async function reload(playerId) {
  return db.queryOne(`SELECT * FROM ${T.players} WHERE id = ?`, [playerId]);
}

const settle = promises => Promise.allSettled(promises);
const passed = results => results.filter(r => r.status === 'fulfilled').length;

test('doble gasto simultáneo del último punto: solo uno pasa', async () => {
  const player = await createCharacter(db, T);
  await setStats(player.id, { potencia: 4, intuicion: 3 });
  const results = await settle([
    profile.allocateStat(player.id, 'chiripa', 1, ACTOR),
    profile.allocateStat(player.id, 'agilidad', 1, ACTOR),
  ]);
  assert.equal(passed(results), 1);
  const row = await reload(player.id);
  assert.equal(row.stat_chiripa + row.stat_agilidad, 1);
  const refused = results.find(r => r.status === 'rejected');
  assert.match(refused.reason.message, /Solo te quedan 0 punto/);
});

test('8 asignaciones de 1 punto en paralelo con 7 libres: exactamente 7 pasan', async () => {
  const player = await createCharacter(db, T);
  await setStats(player.id, { potencia: 1 });
  const targets = [...STATS, 'potencia'];
  const results = await settle(targets.map(stat => profile.allocateStat(player.id, stat, 1, ACTOR)));
  assert.equal(passed(results), 7);
  const row = await reload(player.id);
  const sum = STATS.reduce((acc, stat) => acc + row[`stat_${stat}`], 0);
  assert.equal(sum, 8);
  assert.equal((await profile.getProfile(player.id)).freePoints, 0);
});

test('un punto extra concedido habilita justo un punto más', async () => {
  const player = await createCharacter(db, T);
  await setStats(player.id, { potencia: 6, intuicion: 2 });
  await assert.rejects(() => profile.allocateStat(player.id, 'agilidad', 1, ACTOR), /Solo te quedan 0/);
  await profile.grantBonusPoints(player.id, 1, ACTOR);
  await profile.allocateStat(player.id, 'agilidad', 1, ACTOR);
  const results = await settle([
    profile.allocateStat(player.id, 'chiripa', 1, ACTOR),
    profile.allocateStat(player.id, 'autismo', 1, ACTOR),
  ]);
  assert.equal(passed(results), 0);
});

test('el tope de 6 por estadística se aplica en el WHERE', async () => {
  const player = await createCharacter(db, T);
  await profile.allocateStat(player.id, 'potencia', 5, ACTOR);
  const results = await settle([
    profile.allocateStat(player.id, 'potencia', 2, ACTOR),
    profile.allocateStat(player.id, 'potencia', 2, ACTOR),
  ]);
  assert.equal(passed(results), 0);
  await profile.allocateStat(player.id, 'potencia', 1, ACTOR);
  assert.equal((await reload(player.id)).stat_potencia, 6);
});

test('correctStat no puede dejar la suma por encima de 8 + bonus', async () => {
  const player = await createCharacter(db, T);
  await setStats(player.id, { potencia: 6, intuicion: 2 });
  await assert.rejects(() => profile.correctStat(player.id, 'agilidad', 1, ACTOR), /pasaría de 8/);
  await profile.correctStat(player.id, 'potencia', 3, ACTOR);
  await profile.correctStat(player.id, 'agilidad', 3, ACTOR);
  assert.equal((await reload(player.id)).stat_agilidad, 3);
});

test('perfil: efectiva con raza y menhir, magia y puntos libres', async () => {
  const player = await createCharacter(db, T, { raceSlug: 'aldmer' });
  await setStats(player.id, { autismo: 6 });
  await profile.chooseMenhir(player.id, 'mago', ACTOR);
  const result = await profile.getProfile(player.id);
  assert.equal(result.effective.autismo, 8);
  assert.equal(result.effective.resistencia, -1);
  assert.equal(result.magic.magia, 250);
  assert.equal(result.freePoints, 2);
  assert.equal(result.civil.label, 'Soltera');
  assert.ok(result.menhirChangeAvailableAt instanceof Date);
});

test('menhir: 6 meses de espera, mismo menhir rechazado y elecciones simultáneas', async () => {
  const player = await createCharacter(db, T);
  const results = await settle([
    profile.chooseMenhir(player.id, 'guerrero', ACTOR),
    profile.chooseMenhir(player.id, 'ladron', ACTOR),
  ]);
  assert.equal(passed(results), 1);

  const chosen = await reload(player.id);
  await assert.rejects(() => profile.chooseMenhir(player.id, 'dama', ACTOR), /no puedes cambiarlo/);
  const sameSlug = chosen.menhir_id === (await db.queryOne(`SELECT id FROM ${T.menhirs} WHERE slug = 'guerrero'`)).id ? 'guerrero' : 'ladron';

  await db.execute(`UPDATE ${T.players} SET menhir_chosen_at = NOW() - INTERVAL 7 MONTH WHERE id = ?`, [player.id]);
  await assert.rejects(() => profile.chooseMenhir(player.id, sameSlug, ACTOR), /Ya tienes/);
  await profile.chooseMenhir(player.id, 'dama', ACTOR);
  assert.equal((await db.queryOne(`SELECT slug FROM ${T.menhirs} WHERE id = ?`, [(await reload(player.id)).menhir_id])).slug, 'dama');
  await assert.rejects(() => profile.chooseMenhir(player.id, 'torre', ACTOR), /no puedes cambiarlo/);
});

test('setMenhir del Rolepriest salta la espera y permite quitarlo', async () => {
  const player = await createCharacter(db, T);
  await profile.chooseMenhir(player.id, 'mago', ACTOR);
  await profile.setMenhir(player.id, 'ritual', ACTOR);
  const row = await reload(player.id);
  assert.ok(row.menhir_id);
  await profile.setMenhir(player.id, null, ACTOR);
  const cleared = await reload(player.id);
  assert.equal(cleared.menhir_id, null);
  assert.equal(cleared.menhir_chosen_at, null);
  await profile.chooseMenhir(player.id, 'torre', ACTOR);
});

test('setRace, updateIdentity y su registro', async () => {
  const player = await createCharacter(db, T);
  await profile.setRace(player.id, 'orsimer', ACTOR);
  const updated = await profile.updateIdentity(player.id, { characterName: 'Nuevo Nombre', age: 99, gender: 'hombre' }, ACTOR);
  assert.equal(updated.character_name, 'Nuevo Nombre');
  assert.equal(updated.age, 99);
  const history = await lifecycle.getCharacterHistory(player.discord_id);
  assert.equal(history[0].character_name, 'Nuevo Nombre');
  const audit = await db.query(`SELECT action FROM ${T.audit_log} WHERE target = ? ORDER BY id`, [player.discord_id]);
  assert.deepEqual(audit.map(a => a.action), ['perfil.raza_fijada', 'perfil.identidad_editada']);
});

test('creación simultánea con el mismo discordId: solo se crea un personaje', async () => {
  const discordId = '555000000000000001';
  const fields = { characterName: 'Gemelo', age: 25, gender: 'mujer', raceSlug: 'breton' };
  const results = await settle([
    lifecycle.createCharacter(discordId, 'cuenta', fields),
    lifecycle.createCharacter(discordId, 'cuenta', fields),
    lifecycle.createCharacter(discordId, 'cuenta', fields),
  ]);
  assert.equal(passed(results), 1);
  const rows = await db.query(`SELECT * FROM ${T.players} WHERE discord_id = ?`, [discordId]);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].character_name, 'Gemelo');
  const registry = await db.query(`SELECT * FROM ${T.character_registry} WHERE discord_id = ?`, [discordId]);
  assert.equal(registry.length, 1);
  await assert.rejects(() => lifecycle.createCharacter(discordId, 'cuenta', fields), /Ya tienes un personaje/);
});

async function seedHoldings(playerId) {
  const category = await db.execute(`INSERT INTO ${T.item_categories} (name, display_name) VALUES (?, ?)`, [`cat${playerId}`, 'Cat']);
  const item = await db.execute(`INSERT INTO ${T.items} (name, display_name, category_id) VALUES (?, ?, ?)`, [`hierro${playerId}`, 'Hierro', category.lastInsertRowid]);
  await db.execute(`INSERT INTO ${T.inventory} (player_id, item_id, quantity) VALUES (?, ?, ?)`, [playerId, item.lastInsertRowid, 2.5]);
  const type = await db.execute(`INSERT INTO ${T.property_types} (name, display_name) VALUES (?, ?)`, [`granja${playerId}`, 'Granja']);
  await db.execute(`INSERT INTO ${T.properties} (owner_player_id, property_type_id, name) VALUES (?, ?, ?)`, [playerId, type.lastInsertRowid, 'La Granja']);
  await db.execute(`INSERT INTO ${T.player_npcs} (owner_player_id, name) VALUES (?, ?), (?, ?), (?, ?)`, [playerId, 'Guardia', playerId, 'Guardia', playerId, 'Cocinero']);
  const school = await db.queryOne(`SELECT id FROM ${T.schools} WHERE slug = 'destruccion'`);
  await db.execute(`INSERT INTO ${T.school_progress} (player_id, school_id, level_rank) VALUES (?, ?, 2)`, [playerId, school.id]);
}

async function holdingsCount(playerId) {
  const counts = await Promise.all([
    db.queryOne(`SELECT COUNT(*) AS n FROM ${T.inventory} WHERE player_id = ?`, [playerId]),
    db.queryOne(`SELECT COUNT(*) AS n FROM ${T.properties} WHERE owner_player_id = ?`, [playerId]),
    db.queryOne(`SELECT COUNT(*) AS n FROM ${T.player_npcs} WHERE owner_player_id = ?`, [playerId]),
    db.queryOne(`SELECT COUNT(*) AS n FROM ${T.school_progress} WHERE player_id = ?`, [playerId]),
  ]);
  return counts.map(c => Number(c.n));
}

test('muerte: vacía inventarios, resetea perfil, viudedad del cónyuge y un solo efecto con kills simultáneos', async () => {
  const victim = await createCharacter(db, T, { gender: 'hombre' });
  const spouse = await createCharacter(db, T, { gender: 'mujer' });
  const stranger = await createCharacter(db, T);
  await setStats(victim.id, { potencia: 4, autismo: 3 }, 2);
  await profile.chooseMenhir(victim.id, 'mago', ACTOR);
  await db.execute(`UPDATE ${T.players} SET free_school_claimed_at = NOW() WHERE id = ?`, [victim.id]);
  await seedHoldings(victim.id);
  await seedHoldings(stranger.id);

  const requestId = await marriage.propose(victim.id, spouse.id, ACTOR);
  await consent.accept(requestId, spouse.id, ACTOR);
  await consent.createRequest({ kind: 'item', fromPlayerId: victim.id, toPlayerId: stranger.id, itemId: 1, quantity: 1 });
  assert.equal((await marriage.getCivilStatus(spouse.id)).label, 'Casada');

  const results = await settle([
    lifecycle.killCharacter(victim.discord_id, 'duelo', ACTOR),
    lifecycle.killCharacter(victim.discord_id, 'duelo', ACTOR),
    lifecycle.killCharacter(victim.discord_id, 'duelo', ACTOR),
  ]);
  assert.equal(passed(results), 1);

  assert.deepEqual(await holdingsCount(victim.id), [0, 0, 0, 0]);
  assert.deepEqual(await holdingsCount(stranger.id), [1, 1, 3, 1]);

  const dead = await reload(victim.id);
  assert.equal(dead.character_created_at, null);
  assert.ok(dead.died_at);
  assert.equal(dead.race_id, null);
  assert.equal(dead.menhir_id, null);
  assert.equal(dead.menhir_chosen_at, null);
  assert.equal(dead.free_school_claimed_at, null);
  assert.equal(dead.stat_bonus_points, 0);
  assert.equal(STATS.reduce((acc, stat) => acc + dead[`stat_${stat}`], 0), 0);

  assert.equal((await marriage.getCivilStatus(spouse.id)).label, 'Viuda');
  const pending = await db.query(`SELECT status FROM ${T.consent_requests} WHERE from_player_id = ?`, [victim.id]);
  assert.ok(pending.every(r => r.status !== 'pending'));

  const deaths = await db.query(`SELECT details FROM ${T.audit_log} WHERE action = 'personaje.muerte' AND target = ?`, [victim.discord_id]);
  assert.equal(deaths.length, 1);
  const { snapshot } = JSON.parse(deaths[0].details);
  assert.deepEqual(snapshot.npcs.sort((a, b) => a.name.localeCompare(b.name)), [{ name: 'Cocinero', count: 1 }, { name: 'Guardia', count: 2 }]);
  assert.equal(snapshot.goods[0].quantity, 2.5);
  assert.equal(snapshot.properties[0].name, 'La Granja');
  assert.deepEqual(snapshot.schools, [{ slug: 'destruccion', rank: 2 }]);
  assert.equal(snapshot.spouse.id, spouse.id);
  assert.equal(snapshot.stats.potencia, 4);
  assert.equal(snapshot.character.menhir, 'mago');
});

test('permadeath: el jugador queda en blanco y la espera de 336 h cuenta desde la muerte', async () => {
  const player = await createCharacter(db, T);
  await seedHoldings(player.id);
  await lifecycle.markDeceased(null, player.discord_id, 'prueba', { permadeath: true, actor: ACTOR });
  const blank = await reload(player.id);
  assert.equal(blank.character_created_at, null);
  assert.equal(blank.is_alive, 1);
  assert.ok(blank.died_at);
  assert.deepEqual(await holdingsCount(player.id), [0, 0, 0, 0]);

  const fields = { characterName: 'Otro', age: 20, gender: 'hombre', raceSlug: 'nordico' };
  await assert.rejects(() => lifecycle.createCharacter(player.discord_id, 'u', fields), /Todavía no puedes crear/);

  await db.execute(`UPDATE ${T.players} SET died_at = NOW() - INTERVAL 335 HOUR WHERE id = ?`, [player.id]);
  assert.ok(await lifecycle.getCreationWaitSeconds(player.discord_id) > 0);
  await assert.rejects(() => lifecycle.createCharacter(player.discord_id, 'u', fields), /Todavía no puedes crear/);

  await db.execute(`UPDATE ${T.players} SET died_at = NOW() - INTERVAL 337 HOUR WHERE id = ?`, [player.id]);
  assert.equal(await lifecycle.getCreationWaitSeconds(player.discord_id), 0);
  const created = await lifecycle.createCharacter(player.discord_id, 'u', fields);
  assert.equal(created.character_name, 'Otro');
});

test('el cambio del cooldown de creación se audita con el actor', async () => {
  await lifecycle.setCharacterCreationCooldownHours(100, ACTOR);
  await lifecycle.setCharacterCreationCooldownHours(336, ACTOR);
  const rows = await db.query(`SELECT actor_discord_id, details FROM ${T.audit_log} WHERE action = 'personaje.cooldown_creacion'`);
  assert.ok(rows.length >= 2);
  assert.equal(rows[0].actor_discord_id, ACTOR.discordId);
  assert.equal(JSON.parse(rows[0].details).hours, 100);
});

test('setMenhir conserva menhir_chosen_at si ya había menhir y lo fija a ahora si no', async () => {
  const player = await createCharacter(db, T);
  await profile.setMenhir(player.id, 'mago', ACTOR);
  const first = await reload(player.id);
  assert.ok(first.menhir_chosen_at);
  await db.execute(`UPDATE ${T.players} SET menhir_chosen_at = NOW() - INTERVAL 5 MONTH WHERE id = ?`, [player.id]);
  const aged = await reload(player.id);
  await profile.setMenhir(player.id, 'guerrero', ACTOR);
  const changed = await reload(player.id);
  assert.notEqual(changed.menhir_id, first.menhir_id);
  assert.equal(changed.menhir_chosen_at, aged.menhir_chosen_at);

  await profile.setMenhir(player.id, null, ACTOR);
  await profile.setMenhir(player.id, 'mago', ACTOR);
  assert.notEqual((await reload(player.id)).menhir_chosen_at, aged.menhir_chosen_at);
});

test('setAvatar actualiza la foto de un personaje vivo y rechaza nombres raros', async () => {
  const p = await createCharacter(db, T);
  const updated = await profile.setAvatar(p.id, 'avatars/player_123_1700000000.png', ACTOR);
  assert.equal(updated.avatar_filename, 'avatars/player_123_1700000000.png');
  await assert.rejects(profile.setAvatar(p.id, '../../etc/passwd', ACTOR), /no válido/);
  const dead = await createCharacter(db, T, { isAlive: false });
  await assert.rejects(profile.setAvatar(dead.id, 'avatars/x.png', ACTOR), /personaje vivo/);
});
