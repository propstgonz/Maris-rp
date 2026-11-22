import { test } from 'node:test';
import assert from 'node:assert/strict';
import { civilStatusLabel } from '../src/domain/civilStatus.js';

const cases = [
  [{ active: false, lastEndReason: null, gender: 'hombre' }, 'Soltero'],
  [{ active: false, lastEndReason: null, gender: 'mujer' }, 'Soltera'],
  [{ active: false, lastEndReason: null, gender: null }, 'Soltero/a'],
  [{ active: false, lastEndReason: undefined, gender: 'otro' }, 'Soltero/a'],
  [{ active: true, lastEndReason: null, gender: 'hombre' }, 'Casado'],
  [{ active: true, lastEndReason: null, gender: 'mujer' }, 'Casada'],
  [{ active: true, lastEndReason: null, gender: null }, 'Casado/a'],
  [{ active: false, lastEndReason: 'viudedad', gender: 'hombre' }, 'Viudo'],
  [{ active: false, lastEndReason: 'viudedad', gender: 'mujer' }, 'Viuda'],
  [{ active: false, lastEndReason: 'viudedad', gender: null }, 'Viudo/a'],
  [{ active: false, lastEndReason: 'divorcio', gender: 'mujer' }, 'Soltera'],
  [{ active: false, lastEndReason: 'anulacion', gender: 'hombre' }, 'Soltero'],
  [{ active: true, lastEndReason: 'viudedad', gender: 'mujer' }, 'Casada'],
];

for (const [input, expected] of cases) {
  test(`civilStatusLabel ${JSON.stringify(input)} -> ${expected}`, () => {
    assert.equal(civilStatusLabel(input), expected);
  });
}
