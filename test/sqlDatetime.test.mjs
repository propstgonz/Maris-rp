import { test } from 'node:test';
import assert from 'node:assert/strict';
import { toSqlDatetime, fromSqlDatetime } from '../src/utils/sqlDatetime.js';

test('toSqlDatetime formatea siempre en UTC, sin importar la hora local del proceso', () => {
  const d = new Date('2026-06-15T23:30:00.000Z');
  assert.equal(toSqlDatetime(d), '2026-06-15 23:30:00');
});

test('toSqlDatetime trunca los milisegundos', () => {
  const d = new Date('2026-06-15T23:30:00.789Z');
  assert.equal(toSqlDatetime(d), '2026-06-15 23:30:00');
});

test('toSqlDatetime sin argumento usa "ahora" (round-trip con fromSqlDatetime, margen de 1s)', () => {
  const before = Date.now();
  const sql = toSqlDatetime();
  const after = Date.now();
  const parsed = fromSqlDatetime(sql).getTime();
  assert.ok(parsed >= before - 1000 && parsed <= after + 1000, 'debe caer dentro de un segundo de "ahora"');
});

test('fromSqlDatetime interpreta el string como UTC, no como hora local', () => {
  assert.equal(fromSqlDatetime('2026-06-15 23:30:00').toISOString(), '2026-06-15T23:30:00.000Z');
});

test('fromSqlDatetime devuelve null ante null/undefined, sin lanzar', () => {
  assert.equal(fromSqlDatetime(null), null);
  assert.equal(fromSqlDatetime(undefined), null);
});

test('round-trip toSqlDatetime → fromSqlDatetime conserva el instante exacto (al segundo)', () => {
  const original = new Date('2025-12-31T00:00:00.000Z');
  const roundTripped = fromSqlDatetime(toSqlDatetime(original));
  assert.equal(roundTripped.getTime(), original.getTime());
});

test('round-trip conserva el instante también cruzando medianoche/año, no solo dentro del mismo día', () => {
  const original = new Date('2025-12-31T23:59:59.000Z');
  const roundTripped = fromSqlDatetime(toSqlDatetime(original));
  assert.equal(roundTripped.toISOString(), '2025-12-31T23:59:59.000Z');
});
