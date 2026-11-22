import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { resetDatabase, createCharacter, ACTOR } from './helpers.mjs';

const { db, T } = await resetDatabase();
const goods = await import('../../src/services/goodsService.js');
const npcs = await import('../../src/services/npcHoldingService.js');
const properties = await import('../../src/services/propertyService.js');
const ac = await import('../../src/utils/autocomplete.js');

after(() => db.closePool());

test('el autocompletado solo ofrece lo propio y escapa comodines', async () => {
  const a = await createCharacter(db, T);
  const b = await createCharacter(db, T);
  const madera = await goods.createType({ displayName: 'Madera 100%' }, ACTOR);
  await goods.addGoods(a.id, madera.id, 1.5, ACTOR);
  await goods.addGoods(b.id, madera.id, 9, ACTOR);
  await npcs.addNpcs(a.id, 'Guardia', 2, ACTOR);
  const casa = await properties.createType({ displayName: 'Casa', category: 'vivienda' }, ACTOR);
  const mia = await properties.grantProperty(a.id, casa.id, { name: 'Lago' }, ACTOR);
  await properties.grantProperty(b.id, casa.id, { name: 'Ajena' }, ACTOR);

  assert.deepEqual(await ac.ownGoodsChoices(a.discord_id, '100%'), [{ name: 'Madera 100% (tienes 1,5)', value: madera.id }]);
  assert.deepEqual(await ac.ownGoodsChoices(a.discord_id, '_'), []);
  assert.deepEqual(await ac.ownNpcNameChoices(a.discord_id, 'guar'), [{ name: 'Guardia ×2', value: 'Guardia' }]);
  assert.deepEqual((await ac.ownPropertyChoices(a.discord_id, '')).map(c => c.value), [mia.id]);
  assert.equal((await ac.goodsTypeChoices('madera')).length, 1);
  assert.equal((await ac.raceChoices('mer')).length, 4);
  assert.equal((await ac.menhirChoices('')).length, 11);
  assert.equal((await ac.schoolChoices('')).length, 5);
  assert.equal((await ac.schoolChoices('', { includeInactive: true })).length, 6);
});
