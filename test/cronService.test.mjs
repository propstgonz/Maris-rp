








import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import { makeFakeDb, makeFakeNamedExports } from './helpers/mockDb.mjs';

const fakeDb = makeFakeDb();
mock.module('../src/database/index.js', { defaultExport: fakeDb, namedExports: makeFakeNamedExports(fakeDb) });







const { config } = await import('../src/utils/permissions.js');
const { computeDailyOutcome } = await import('../src/services/cronService.js');

const MAX_HP     = config.game?.maxHp     ?? 10;
const MAX_HUNGER = config.game?.maxHunger ?? 10;

test('REGRESIÓN G1: hambre al máximo → regenera HP (antes nunca ocurría)', () => {



  const startHp = Math.max(0, MAX_HP - (config.game?.wellFedHpRegenPerDay ?? 4) - 1);
  const result = computeDailyOutcome({
    hp: startHp, hunger: MAX_HUNGER, isImmortal: false, hpDeltaFromFx: 0,
  });
  assert.ok(result.wellFedRegen > 0, 'wellFedRegen debería ser positivo con hambre al máximo');
  assert.equal(result.newHp, startHp + result.wellFedRegen);
  assert.equal(result.newHunger, MAX_HUNGER - 1);
  assert.equal(result.died, false);
});

test('hambre por debajo del máximo → sin regeneración', () => {
  const result = computeDailyOutcome({
    hp: MAX_HP - 3, hunger: MAX_HUNGER - 1, isImmortal: false, hpDeltaFromFx: 0,
  });
  assert.equal(result.wellFedRegen, 0);
  assert.equal(result.newHp, MAX_HP - 3);
});

test('hambre llega a 0 → daño de inanición, sin regeneración', () => {
  const result = computeDailyOutcome({
    hp: MAX_HP, hunger: 1, isImmortal: false, hpDeltaFromFx: 0,
  });
  assert.equal(result.newHunger, 0);
  assert.ok(result.starvDmg > 0, 'debería aplicar daño de inanición');
  assert.equal(result.wellFedRegen, 0);
  assert.equal(result.newHp, MAX_HP - result.starvDmg);
});

test('HP nunca supera MAX_HP aunque la regeneración lo empuje por encima', () => {
  const result = computeDailyOutcome({
    hp: MAX_HP, hunger: MAX_HUNGER, isImmortal: false, hpDeltaFromFx: 0,
  });
  assert.equal(result.newHp, MAX_HP);
});

test('jugador normal (no inmortal) muere si el HP resultante llega a 0', () => {
  const result = computeDailyOutcome({
    hp: 1, hunger: 0, isImmortal: false, hpDeltaFromFx: -10,
  });
  assert.equal(result.newHp, 0);
  assert.equal(result.died, true);
});

test('jugador inmortal se clampea a 1 HP en vez de morir', () => {
  const result = computeDailyOutcome({
    hp: 1, hunger: 0, isImmortal: true, hpDeltaFromFx: -10,
  });
  assert.equal(result.newHp, 1);
  assert.equal(result.died, false);
});

test('HP nunca baja de 0 aunque el daño combinado sea enorme', () => {
  const result = computeDailyOutcome({
    hp: 2, hunger: 0, isImmortal: false, hpDeltaFromFx: -50,
  });
  assert.equal(result.newHp, 0);
});
