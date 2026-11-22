import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mock } from 'node:test';
import { makeFakeDb, makeFakeNamedExports } from './helpers/mockDb.mjs';

const fakeDb = makeFakeDb();
mock.module('../src/database/index.js', { defaultExport: fakeDb, namedExports: makeFakeNamedExports(fakeDb) });

const { computeDurabilityAfterDecay } = await import('../src/services/constructionDurabilityService.js');

test('resta la pérdida diaria de la durabilidad actual', () => {
  assert.equal(computeDurabilityAfterDecay(80, 5), 75);
});

test('nunca baja de 0 aunque la pérdida supere lo que quedaba', () => {
  assert.equal(computeDurabilityAfterDecay(3, 10), 0);
});

test('una pérdida de 0 (límite, aunque el CHECK de BD exige >0) deja la durabilidad igual', () => {
  assert.equal(computeDurabilityAfterDecay(50, 0), 50);
});

test('admite pérdidas fraccionarias (0.5/día)', () => {
  assert.equal(computeDurabilityAfterDecay(10, 0.5), 9.5);
});
