import { test } from 'node:test';
import assert from 'node:assert/strict';

import { componentEmoji } from '../src/utils/emoji.js';

test('un emoji suelto pasa tal cual', () => {
  assert.equal(componentEmoji('🔫', '🗡️'), '🔫');
});

test('varios emojis pegados se reducen al primero', () => {
  assert.equal(componentEmoji('👴🟦🟦', '🗡️'), '👴');
});

test('un emoji con variation selector se conserva entero', () => {
  assert.equal(componentEmoji('🗡️', '⚔️'), '🗡️');
  assert.equal(componentEmoji('⚔️', '🗡️'), '⚔️');
});

test('una familia con ZWJ cuenta como un solo grafema', () => {
  assert.equal(componentEmoji('👨‍👩‍👧', '🗡️'), '👨‍👩‍👧');
});

test('una bandera de indicadores regionales se conserva', () => {
  assert.equal(componentEmoji('🇪🇸', '🗡️'), '🇪🇸');
});

test('texto sin ningun emoji cae al valor por defecto', () => {
  assert.equal(componentEmoji('arma', '🗡️'), '🗡️');
  assert.equal(componentEmoji(':pistola:', '🗡️'), '🗡️');
});

test('vacio, espacios, null y no-cadenas caen al valor por defecto', () => {
  assert.equal(componentEmoji('', '🗡️'), '🗡️');
  assert.equal(componentEmoji('   ', '🗡️'), '🗡️');
  assert.equal(componentEmoji(null, '🗡️'), '🗡️');
  assert.equal(componentEmoji(undefined, '🗡️'), '🗡️');
  assert.equal(componentEmoji(42, '🗡️'), '🗡️');
});

test('sin valor por defecto devuelve null en vez de romper el componente', () => {
  assert.equal(componentEmoji('arma'), null);
});

test('un emoji personalizado de Discord pasa entero', () => {
  assert.equal(componentEmoji('<:pepe:123456789012345678>', '🗡️'), '<:pepe:123456789012345678>');
  assert.equal(componentEmoji('<a:baila:123456789012345678>', '🗡️'), '<a:baila:123456789012345678>');
});

test('texto con un emoji dentro extrae ese emoji', () => {
  assert.equal(componentEmoji('[Biden Blast] 👴', '🗡️'), '👴');
});
