




import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import { makeFakeDb, makeFakeNamedExports } from './helpers/mockDb.mjs';

const fakeDb = makeFakeDb();
mock.module('../src/database/index.js', { defaultExport: fakeDb, namedExports: makeFakeNamedExports(fakeDb) });

const { planPath } = await import('../src/services/travelService.js');

test('planPath en línea recta horizontal incluye origen y destino', () => {
  const path = planPath(0, 0, 3, 0);
  assert.deepEqual(path, [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 2, y: 0 }, { x: 3, y: 0 }]);
});

test('planPath en línea recta vertical', () => {
  const path = planPath(0, 0, 0, 3);
  assert.deepEqual(path, [{ x: 0, y: 0 }, { x: 0, y: 1 }, { x: 0, y: 2 }, { x: 0, y: 3 }]);
});

test('planPath diagonal 45° da un paso por casilla, en diagonal pura', () => {
  const path = planPath(0, 0, 3, 3);
  assert.deepEqual(path, [{ x: 0, y: 0 }, { x: 1, y: 1 }, { x: 2, y: 2 }, { x: 3, y: 3 }]);
});

test('planPath origen === destino devuelve un único punto', () => {
  const path = planPath(5, 5, 5, 5);
  assert.deepEqual(path, [{ x: 5, y: 5 }]);
});

test('planPath funciona igual en sentido inverso (destino antes que origen)', () => {
  const path = planPath(3, 0, 0, 0);
  assert.deepEqual(path, [{ x: 3, y: 0 }, { x: 2, y: 0 }, { x: 1, y: 0 }, { x: 0, y: 0 }]);
});

test('planPath siempre empieza en el origen y termina en el destino', () => {
  const path = planPath(2, 7, 9, 1);
  assert.deepEqual(path[0], { x: 2, y: 7 });
  assert.deepEqual(path[path.length - 1], { x: 9, y: 1 });
});

test('planPath nunca salta más de una casilla por eje entre pasos consecutivos (Bresenham real)', () => {
  const path = planPath(2, 7, 9, 1);
  for (let i = 1; i < path.length; i++) {
    const dx = Math.abs(path[i].x - path[i - 1].x);
    const dy = Math.abs(path[i].y - path[i - 1].y);
    assert.ok(dx <= 1 && dy <= 1, `paso ${i}: salto de (${path[i - 1].x},${path[i - 1].y}) a (${path[i].x},${path[i].y})`);
  }
});
