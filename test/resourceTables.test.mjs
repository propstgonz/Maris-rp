import { test } from 'node:test';
import assert from 'node:assert/strict';

import { mergeResourceTables } from '../src/utils/resourceTables.js';

const madera = { name: 'madera', display_name: 'Madera', quantity: 2, drop_chance_percent: 40 };
const baya   = { name: 'baya',   display_name: 'Baya',   quantity: 1, drop_chance_percent: 20 };
const pieles = { name: 'pieles', display_name: 'Pieles', quantity: 1, drop_chance_percent: 15 };

test('sin zona devuelve los recursos del terreno tal cual', () => {
  const merged = mergeResourceTables([madera, baya], []);
  assert.deepEqual(merged.map(r => r.name), ['madera', 'baya']);
});

test('sin terreno devuelve solo los de la zona', () => {
  const merged = mergeResourceTables([], [pieles]);
  assert.deepEqual(merged.map(r => r.name), ['pieles']);
});

test('un item exclusivo de la zona se suma a los del terreno', () => {
  const merged = mergeResourceTables([madera, baya], [pieles]);
  assert.deepEqual(merged.map(r => r.name), ['madera', 'baya', 'pieles']);
});

test('la zona pisa al terreno en cantidad y probabilidad si repite item', () => {
  const bayaDeZona = { name: 'baya', display_name: 'Baya', quantity: 5, drop_chance_percent: 60 };
  const merged = mergeResourceTables([madera, baya], [bayaDeZona]);

  assert.equal(merged.length, 2);
  const resultado = merged.find(r => r.name === 'baya');
  assert.equal(resultado.quantity, 5);
  assert.equal(resultado.drop_chance_percent, 60);
});

test('el resultado queda ordenado por probabilidad descendente', () => {
  const bayaDeZona = { name: 'baya', display_name: 'Baya', quantity: 5, drop_chance_percent: 60 };
  const merged = mergeResourceTables([madera, baya], [bayaDeZona, pieles]);
  assert.deepEqual(merged.map(r => r.drop_chance_percent), [60, 40, 15]);
});

test('sin recursos por ninguna via devuelve lista vacia', () => {
  assert.deepEqual(mergeResourceTables([], []), []);
  assert.deepEqual(mergeResourceTables(), []);
});
