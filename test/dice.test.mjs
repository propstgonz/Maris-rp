import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rollDie } from '../src/utils/dice.js';

test('rollDie(6) siempre cae entre 1 y 6, ambos inclusive', () => {
  for (let i = 0; i < 500; i++) {
    const roll = rollDie(6);
    assert.ok(Number.isInteger(roll), `${roll} debería ser un entero`);
    assert.ok(roll >= 1 && roll <= 6, `${roll} fuera de rango 1-6`);
  }
});

test('rollDie(sides) respeta el número de caras indicado', () => {
  for (let i = 0; i < 200; i++) {
    const roll = rollDie(20);
    assert.ok(roll >= 1 && roll <= 20, `${roll} fuera de rango 1-20`);
  }
});

test('rollDie rechaza un número de caras no entero o menor que 2', () => {
  assert.throws(() => rollDie(1));
  assert.throws(() => rollDie(0));
  assert.throws(() => rollDie(-6));
  assert.throws(() => rollDie(3.5));
});

test('rollDie(6) por defecto si no se pasa nada', () => {
  const roll = rollDie();
  assert.ok(roll >= 1 && roll <= 6);
});

test('rollDie cubre los tipos de dado que usa /dado (D6, D10, D12, D20, D100)', () => {
  for (const sides of [6, 10, 12, 20, 100]) {
    for (let i = 0; i < 200; i++) {
      const roll = rollDie(sides);
      assert.ok(Number.isInteger(roll), `${roll} debería ser un entero`);
      assert.ok(roll >= 1 && roll <= sides, `${roll} fuera de rango 1-${sides}`);
    }
  }
});
