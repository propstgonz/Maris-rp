import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import { makeFakeDb, makeFakeNamedExports } from './helpers/mockDb.mjs';

const fakeDb = makeFakeDb();
mock.module('../src/database/index.js', { defaultExport: fakeDb, namedExports: makeFakeNamedExports(fakeDb) });

let tamedWith = null;
let tameSucceeds = true;
let bredWith = null;
let offspringOwner = null;

mock.module('../src/services/npcService.js', {
  namedExports: {
    tameNpc: async (npcId, ownerId) => { tamedWith = { npcId, ownerId }; return tameSucceeds; },
    markBred: async (a, b) => { bredWith = [a, b]; },
    createOwnedNpc: async (tileId, typeId, ownerId) => { offspringOwner = ownerId; return { id: 99 }; },
  },
});
mock.module('../src/services/itemService.js', {
  namedExports: { getItemById: async () => ({ name: 'carne', display_name: 'Carne', emoji: null }) },
});
mock.module('../src/services/inventoryService.js', {
  namedExports: { removeItem: async () => ({ newQuantity: 0 }) },
});
mock.module('../src/services/playerService.js', {
  namedExports: { getPlayerByDiscordId: async () => ({ id: 7 }) },
});

const { attemptTame } = await import('../src/services/tameService.js');
const { attemptBreed } = await import('../src/services/breedingService.js');

const tameableNpc = (over = {}) => ({
  id: 1, type_display_name: 'Caballo', is_tameable: 1, owner_player_id: null,
  tame_bait_item_id: 5, tame_chance_percent: 100, ...over,
});

test('attemptTame rechaza un animal que ya tiene dueño', async () => {
  tamedWith = null;
  await assert.rejects(
    () => attemptTame('ladron', tameableNpc({ owner_player_id: 42 })),
    /ya tiene dueño/
  );
  assert.equal(tamedWith, null, 'no debe llegar a reasignar el dueño');
});

test('attemptTame domestica con normalidad un animal salvaje', async () => {
  tamedWith = null;
  tameSucceeds = true;
  const result = await attemptTame('jugador', tameableNpc());
  assert.equal(result.success, true);
  assert.deepEqual(tamedWith, { npcId: 1, ownerId: 7 });
});

test('attemptTame no da por buena la domesticación si el UPDATE no tocó ninguna fila', async () => {
  tameSucceeds = false;
  const result = await attemptTame('jugador', tameableNpc());
  assert.equal(result.success, false, 'perder la carrera contra otro no puede contar como éxito');
  tameSucceeds = true;
});

const player = { id: 7, coord_x: 3, coord_y: 4 };
const parent = (over = {}) => ({
  id: 1, owner_player_id: 7, npc_type_id: 2, coord_x: 3, coord_y: 4,
  tile_id: 10, last_bred_at: null, breed_chance_percent: 100,
  type_display_name: 'Caballo', ...over,
});

test('attemptBreed rechaza criar animales de otro jugador', async () => {
  bredWith = null;
  await assert.rejects(
    () => attemptBreed(player, parent({ owner_player_id: 42 }), parent({ id: 2, owner_player_id: 42 })),
    /tienen que ser tuyos/
  );
  assert.equal(bredWith, null, 'no debe quemar el cooldown de animales ajenos');
});

test('attemptBreed rechaza si solo uno de los dos es tuyo', async () => {
  bredWith = null;
  await assert.rejects(
    () => attemptBreed(player, parent(), parent({ id: 2, owner_player_id: 42 })),
    /tienen que ser tuyos/
  );
  assert.equal(bredWith, null);
});

test('attemptBreed exige que estés en la casilla de los animales', async () => {
  bredWith = null;
  await assert.rejects(
    () => attemptBreed({ ...player, coord_x: 50, coord_y: 50 }, parent(), parent({ id: 2 })),
    /Tienes que estar con ellos/
  );
  assert.equal(bredWith, null, 'no se puede criar a distancia');
});

test('attemptBreed cría con normalidad tus dos animales en tu casilla', async () => {
  bredWith = null;
  offspringOwner = null;
  const result = await attemptBreed(player, parent(), parent({ id: 2 }));
  assert.equal(result.success, true);
  assert.deepEqual(bredWith, [1, 2]);
  assert.equal(offspringOwner, 7);
});
