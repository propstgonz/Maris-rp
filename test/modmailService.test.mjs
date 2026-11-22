



import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import { makeFakeDb, makeFakeNamedExports } from './helpers/mockDb.mjs';

const fakeDb = makeFakeDb();
mock.module('../src/database/index.js', { defaultExport: fakeDb, namedExports: makeFakeNamedExports(fakeDb) });

const { mergeChannelOverwrites } = await import('../src/services/modmailService.js');

test('sin overwrites de categoría, devuelve solo el del miembro', () => {
  const result = mergeChannelOverwrites([], '123', { allow: ['ViewChannel'] });
  assert.deepEqual(result, [{ id: '123', allow: ['ViewChannel'] }]);
});

test('conserva los overwrites heredados de la categoría que no son del miembro', () => {
  const category = [
    { id: 'role-staff', allow: ['ViewChannel'] },
    { id: 'role-everyone', deny: ['ViewChannel'] },
  ];
  const result = mergeChannelOverwrites(category, '123', { allow: ['ViewChannel', 'SendMessages'] });
  assert.equal(result.length, 3);
  assert.deepEqual(result[0], category[0]);
  assert.deepEqual(result[1], category[1]);
  assert.deepEqual(result[2], { id: '123', allow: ['ViewChannel', 'SendMessages'] });
});

test('si la categoría ya tenía un overwrite para ese mismo miembro, lo sustituye (no lo duplica)', () => {
  const category = [
    { id: '123', allow: ['ViewChannel'] },
    { id: 'role-staff', allow: ['ViewChannel'] },
  ];
  const result = mergeChannelOverwrites(category, '123', { allow: ['ViewChannel', 'SendMessages'] });
  const forMember = result.filter(o => o.id === '123');
  assert.equal(forMember.length, 1, 'no debe haber dos entradas para el mismo id');
  assert.deepEqual(forMember[0], { id: '123', allow: ['ViewChannel', 'SendMessages'] });
});

test('compara IDs como texto — un id numérico en la categoría no duplica al id string del miembro', () => {
  const category = [{ id: 123, allow: ['ViewChannel'] }];
  const result = mergeChannelOverwrites(category, '123', { deny: ['SendMessages'] });
  assert.equal(result.length, 1);
  assert.deepEqual(result[0], { id: '123', deny: ['SendMessages'] });
});

test('categoryOverwrites null/undefined no lanza — se trata como vacío', () => {
  assert.doesNotThrow(() => mergeChannelOverwrites(null, '123', {}));
  assert.doesNotThrow(() => mergeChannelOverwrites(undefined, '123', {}));
  assert.deepEqual(mergeChannelOverwrites(null, '123', { allow: ['X'] }), [{ id: '123', allow: ['X'] }]);
});
