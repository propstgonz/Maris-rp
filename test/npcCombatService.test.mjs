import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mock } from 'node:test';
import { makeFakeDb, makeFakeNamedExports } from './helpers/mockDb.mjs';

const fakeDb = makeFakeDb();
mock.module('../src/database/index.js', { defaultExport: fakeDb, namedExports: makeFakeNamedExports(fakeDb) });

const { selectNpcCombatWeapon } = await import('../src/services/combatService.js');
const { pickHealTarget } = await import('../src/services/npcCombatService.js');

function meleeWeapon(damage = 3) {
  return { weapon_damage: damage, weapon_roll_1: null, weapon_roll_2: null, weapon_roll_3: null, weapon_roll_4: null, weapon_roll_5: null, weapon_roll_6: null };
}
function rangedWeapon(maxRange, damage = 2) {
  return { weapon_damage: damage, weapon_roll_1: null, weapon_roll_2: null, weapon_roll_3: null, weapon_roll_4: maxRange, weapon_roll_5: null, weapon_roll_6: null };
}

test('selectNpcCombatWeapon: prioriza la principal si llega a esta distancia', () => {
  const primary = rangedWeapon(4);
  const secondary = meleeWeapon();
  assert.equal(selectNpcCombatWeapon(primary, secondary, 3), primary);
});

test('selectNpcCombatWeapon: si la principal no llega, prueba la secundaria', () => {
  const primary = meleeWeapon();
  const secondary = rangedWeapon(5);
  assert.equal(selectNpcCombatWeapon(primary, secondary, 3), secondary);
});

test('selectNpcCombatWeapon: jinete/pirata — espada cuerpo a cuerpo preferida, arco de respaldo si el objetivo está lejos', () => {
  const espada = meleeWeapon();
  const arco = rangedWeapon(4);
  assert.equal(selectNpcCombatWeapon(espada, arco, 0), espada, 'adyacente, prefiere la espada aunque el arco también podría llegar');
  assert.equal(selectNpcCombatWeapon(espada, arco, 3), arco, 'a distancia, la espada no llega — usa el arco de respaldo');
});

test('selectNpcCombatWeapon: si ninguna llega, devuelve la principal igualmente (para que rollRangeCheckForNpcCombat reporte "fuera de alcance" con su propia tabla)', () => {
  const primary = rangedWeapon(2);
  const secondary = rangedWeapon(3);
  assert.equal(selectNpcCombatWeapon(primary, secondary, 10), primary);
});

test('selectNpcCombatWeapon: sin principal, ninguna llega → devuelve la secundaria', () => {
  const secondary = rangedWeapon(3);
  assert.equal(selectNpcCombatWeapon(null, secondary, 10), secondary);
});

test('selectNpcCombatWeapon: sin ninguna arma, devuelve null', () => {
  assert.equal(selectNpcCombatWeapon(null, null, 0), null);
});

function candidate(id, currentHp, maxHp) {
  return { id, current_hp: currentHp, type_max_hp: maxHp };
}

test('pickHealTarget: se cura a sí mismo si está por debajo del umbral y no hay aliados', () => {
  const self = candidate(1, 3, 10);
  assert.deepEqual(pickHealTarget(self, [], 50), self);
});

test('pickHealTarget: nadie por debajo del umbral → no cura (null)', () => {
  const self = candidate(1, 9, 10);
  const ally = candidate(2, 8, 10);
  assert.equal(pickHealTarget(self, [ally], 50), null);
});

test('pickHealTarget: prioriza al aliado con MENOR % de vida sobre uno mismo', () => {
  const self = candidate(1, 4, 10);
  const allyLow = candidate(2, 1, 10);
  const allyOk = candidate(3, 9, 10);
  assert.deepEqual(pickHealTarget(self, [allyLow, allyOk], 50), allyLow);
});

test('pickHealTarget: se prefiere a sí mismo antes que a un aliado con el MISMO % de vida', () => {
  const self = candidate(1, 2, 10);
  const ally = candidate(2, 2, 10);
  assert.deepEqual(pickHealTarget(self, [ally], 50), self);
});

test('pickHealTarget: ignora candidatos ya muertos (current_hp <= 0), aunque su % de vida "cero" pareciera el más urgente', () => {
  const self = candidate(1, 10, 10);
  const deadAlly = candidate(2, 0, 10);
  assert.equal(pickHealTarget(self, [deadAlly], 50), null);
});
