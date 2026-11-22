import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import { makeFakeDb, makeFakeNamedExports } from './helpers/mockDb.mjs';

const fakeDb = makeFakeDb();
mock.module('../src/database/index.js', { defaultExport: fakeDb, namedExports: makeFakeNamedExports(fakeDb) });

const { describeReach, collectTargets, collectTargetsAtTile } = await import('../src/services/attackTargetingService.js');

const player = { discord_id: 'p1', coord_x: 0, coord_y: 0 };
const meleeWeapon = { weapon_roll_1: 0, weapon_roll_2: 0, weapon_roll_3: 0, weapon_roll_4: 0, weapon_roll_5: 0, weapon_roll_6: 0 };
const rangedWeapon = { weapon_roll_1: 1, weapon_roll_2: 1, weapon_roll_3: 2, weapon_roll_4: 2, weapon_roll_5: 3, weapon_roll_6: 5, weapon_structure_damage: 4, display_name: 'Rifle' };

test('describeReach cuenta cuántas caras del dado llegan a esa distancia', () => {
  assert.equal(describeReach(rangedWeapon, 5), 'a 5 casillas · 1/6 caras llegan');
  assert.equal(describeReach(rangedWeapon, 1), 'a 1 casilla · 6/6 caras llegan');
});

test('describeReach a distancia 0 dice "en tu casilla"', () => {
  assert.equal(describeReach(rangedWeapon, 0), 'en tu casilla · 6/6 caras llegan');
});

test('collectTargets no lanza sin arma (cuerpo a cuerpo) y devuelve un array', async () => {
  const targets = await collectTargets(player, null);
  assert.ok(Array.isArray(targets));
});

test('collectTargets no lanza con arma a distancia y devuelve un array', async () => {
  const targets = await collectTargets(player, rangedWeapon);
  assert.ok(Array.isArray(targets));
});

test('collectTargetsAtTile lanza si la casilla queda fuera del alcance del arma, sin llegar a consultar nada', async () => {
  await assert.rejects(
    () => collectTargetsAtTile(player, meleeWeapon, { x: 5, y: 5 }),
    /solo llega a/
  );
});

test('collectTargetsAtTile con la propia casilla y cuerpo a cuerpo no lanza (distancia 0 siempre en rango)', async () => {
  const targets = await collectTargetsAtTile(player, meleeWeapon, { x: 0, y: 0 });
  assert.ok(Array.isArray(targets));
});
