import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mock } from 'node:test';
import { makeFakeDb, makeFakeNamedExports } from './helpers/mockDb.mjs';

const fakeDb = makeFakeDb();
mock.module('../src/database/index.js', { defaultExport: fakeDb, namedExports: makeFakeNamedExports(fakeDb) });

const { rollGatherResult } = await import('../src/services/resourceGatherService.js');

test('con un único recurso al 100%, siempre lo consigue si es el buscado', () => {
  const resources = [{ name: 'madera', display_name: 'Madera', emoji: '🪵', quantity: 2, drop_chance_percent: 100 }];
  for (let i = 0; i < 50; i++) {
    const result = rollGatherResult(resources, 'madera');
    assert.equal(result.name, 'madera');
    assert.equal(result.wasTarget, true);
  }
});

test('con un único recurso al 0% (límite), nunca sale nada', () => {
  const resources = [{ name: 'madera', display_name: 'Madera', emoji: '🪵', quantity: 2, drop_chance_percent: 0 }];
  for (let i = 0; i < 50; i++) {
    assert.equal(rollGatherResult(resources, 'madera'), null);
  }
});

test('si el objetivo falla pero otro recurso al 100% sí sale, da ese otro marcado como "no era el buscado"', () => {
  const resources = [
    { name: 'oro', display_name: 'Oro', emoji: '🪙', quantity: 1, drop_chance_percent: 0 },
    { name: 'piedra', display_name: 'Piedra', emoji: '🪨', quantity: 3, drop_chance_percent: 100 },
  ];
  for (let i = 0; i < 50; i++) {
    const result = rollGatherResult(resources, 'oro');
    assert.equal(result.name, 'piedra');
    assert.equal(result.wasTarget, false);
  }
});

test('si el objetivo acierta, se prioriza sobre cualquier otro que también haya acertado', () => {
  const resources = [
    { name: 'oro', display_name: 'Oro', emoji: '🪙', quantity: 1, drop_chance_percent: 100 },
    { name: 'piedra', display_name: 'Piedra', emoji: '🪨', quantity: 3, drop_chance_percent: 100 },
  ];
  for (let i = 0; i < 50; i++) {
    const result = rollGatherResult(resources, 'oro');
    assert.equal(result.name, 'oro');
    assert.equal(result.wasTarget, true);
  }
});

test('sin ningún recurso configurado, devuelve null sin lanzar', () => {
  assert.equal(rollGatherResult([], 'madera'), null);
});
