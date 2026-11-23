import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { resetDatabase, createCharacter, ACTOR } from './helpers.mjs';

let db, T, server, base;

before(async () => {
  ({ db, T } = await resetDatabase());
  const { createPlayersRouter } = await import('../../src/api/routes/players.js');
  const app = express();
  app.use((req, res, next) => {
    req.session = { user: { isRolepriest: req.get('x-role') !== 'none' }, lastActivity: Date.now() };
    next();
  });
  app.use(createPlayersRouter());
  server = app.listen(0);
  await new Promise(resolve => server.once('listening', resolve));
  base = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  await new Promise(resolve => server.close(resolve));
  await db.closePool();
});

const ficha = (discordId, headers = {}) => fetch(`${base}/api/players/${discordId}/ficha`, { headers });

test('ficha completa: perfil, NPCs, bienes, propiedades, escuelas y conjuros', async () => {
  const goods = await import('../../src/services/goodsService.js');
  const npcs = await import('../../src/services/npcHoldingService.js');
  const properties = await import('../../src/services/propertyService.js');
  const magic = await import('../../src/services/magicService.js');
  const p = await createCharacter(db, T, { characterName: 'Ficha Uno' });

  await goods.createCategory({ name: 'materiales', displayName: 'Materiales' }, ACTOR);
  const wood = await goods.createType({ displayName: 'Madera', categoryName: 'materiales' }, ACTOR);
  await goods.addGoods(p.id, wood.id, 1.5, ACTOR);
  await npcs.addNpcs(p.id, 'Guardia', 2, ACTOR);
  const type = await properties.createType({ displayName: 'Casa', category: 'vivienda' }, ACTOR);
  await properties.grantProperty(p.id, type.id, { name: 'Lago' }, ACTOR);
  await magic.setLevel(p.id, 'destruccion', 1, ACTOR);

  const res = await ficha(p.discord_id);
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.player.character_name, 'Ficha Uno');
  assert.equal(body.player.is_alive, true);
  assert.equal(body.profile.race.slug, 'nordico');
  assert.deepEqual(Object.keys(body.profile.base).length, 7);
  assert.equal(body.profile.civil.spouse, null);
  assert.deepEqual(body.npcs, [{ name: 'Guardia', count: 2 }]);
  assert.equal(body.goods.length, 1);
  assert.equal(body.goods[0].quantity, 1.5);
  assert.equal(body.properties.length, 1);
  assert.equal(body.schools.schools.length, 6);
  assert.ok(body.spells.length > 0);
  assert.ok(body.spells.every(s => s.school_slug === 'destruccion'));
});

test('muerto: devuelve la ficha con is_alive=false', async () => {
  const p = await createCharacter(db, T, { isAlive: false });
  const res = await ficha(p.discord_id);
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.player.is_alive, false);
  assert.deepEqual(body.goods, []);
});

test('sin personaje 404; sin Rolepriest 403', async () => {
  assert.equal((await ficha('999999999999999999')).status, 404);
  const p = await createCharacter(db, T);
  assert.equal((await ficha(p.discord_id, { 'x-role': 'none' })).status, 403);
});
