





import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mock } from 'node:test';
import { makeFakeDb, makeFakeNamedExports } from './helpers/mockDb.mjs';

const fakeDb = makeFakeDb();
mock.module('../src/database/index.js', { defaultExport: fakeDb, namedExports: makeFakeNamedExports(fakeDb) });

const { computeRepairCost, REPAIR_INGREDIENT_FRACTION } = await import('../src/services/constructionRepairService.js');

test('REPAIR_INGREDIENT_FRACTION es 0.5 — la mitad del coste de construir', () => {
  assert.equal(REPAIR_INGREDIENT_FRACTION, 0.5);
});

test('redondea cada ingrediente hacia ARRIBA por separado (nunca hacia abajo)', () => {
  const { ingredients } = computeRepairCost(
    { laburo_cost: 0 },
    [
      { name: 'madera', display_name: 'Madera', emoji: '🪵', quantity_required: 5 },
      { name: 'hierro', display_name: 'Hierro', emoji: '⛏️', quantity_required: 4 },
    ]
  );
  assert.equal(ingredients.find(i => i.name === 'madera').quantity_required, 3);
  assert.equal(ingredients.find(i => i.name === 'hierro').quantity_required, 2);
});

test('un ingrediente que costaba 1 nunca baja a 0 al reparar (mínimo 1)', () => {
  const { ingredients } = computeRepairCost(
    { laburo_cost: 0 },
    [{ name: 'piedra', display_name: 'Piedra', emoji: '🪨', quantity_required: 1 }]
  );
  assert.equal(ingredients[0].quantity_required, 1);
});

test('sin ingredientes (tipo sin coste de materiales), devuelve una lista vacía', () => {
  const { ingredients } = computeRepairCost({ laburo_cost: 0 }, []);
  assert.deepEqual(ingredients, []);
});

test('el coste de Laburo es la mitad, con decimales (sin redondear a entero)', () => {
  const { laburoCost } = computeRepairCost({ laburo_cost: 5 }, []);
  assert.equal(laburoCost, 2.5);
});

test('sin coste de Laburo en el tipo original (0), la reparación tampoco cuesta Laburo', () => {
  const { laburoCost } = computeRepairCost({ laburo_cost: 0 }, []);
  assert.equal(laburoCost, 0);
});

test('el Laburo se redondea a 2 decimales (round2), no se deja con más precisión de la que el juego usa', () => {
  const { laburoCost } = computeRepairCost({ laburo_cost: 3.33 }, []);
  assert.equal(laburoCost, 1.67);
});

test('no muta las filas de ingredientes originales que recibe (devuelve copias)', () => {
  const original = [{ name: 'madera', display_name: 'Madera', emoji: '🪵', quantity_required: 10 }];
  const { ingredients } = computeRepairCost({ laburo_cost: 0 }, original);
  assert.equal(original[0].quantity_required, 10);
  assert.equal(ingredients[0].quantity_required, 5);
});
