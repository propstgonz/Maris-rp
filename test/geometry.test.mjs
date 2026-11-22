






import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import { makeFakeDb, makeFakeNamedExports } from './helpers/mockDb.mjs';
import { chebyshevGridDistance } from '../src/utils/geometry.js';



const fakeDb = makeFakeDb();
mock.module('../src/database/index.js', { defaultExport: fakeDb, namedExports: makeFakeNamedExports(fakeDb) });
const { planPath } = await import('../src/services/travelService.js');

function tile(x, y) { return { coord_x: x, coord_y: y }; }

test('distancia 0 entre la misma casilla', () => {
  assert.equal(chebyshevGridDistance(tile(5, 5), tile(5, 5)), 0);
});

test('línea recta horizontal: la distancia es el número de casillas de diferencia', () => {
  assert.equal(chebyshevGridDistance(tile(0, 0), tile(10, 0)), 10);
});

test('diagonal pura 45°: 100 casillas, NO ~141 (la línea recta de antes)', () => {
  assert.equal(chebyshevGridDistance(tile(0, 0), tile(100, 100)), 100);
});

test('simétrica: da igual qué punto se pase primero', () => {
  assert.equal(chebyshevGridDistance(tile(3, 7), tile(9, 1)), chebyshevGridDistance(tile(9, 1), tile(3, 7)));
});

test('coincide EXACTAMENTE con los pasos que planPath() (Bresenham, viajar) tarda en recorrer la misma línea', () => {
  const cases = [
    [0, 0, 100, 100],
    [0, 0, 10, 0],
    [0, 0, 0, 10],
    [2, 3, 9, 4],
    [5, 5, 1, 20],
    [-3, -3, 4, 2],
  ];
  for (const [x0, y0, x1, y1] of cases) {
    const bresenhamSteps = planPath(x0, y0, x1, y1).length - 1;
    const combatDistance = chebyshevGridDistance(tile(x0, y0), tile(x1, y1));
    assert.equal(combatDistance, bresenhamSteps, `(${x0},${y0})→(${x1},${y1}): combate=${combatDistance}, viaje=${bresenhamSteps}`);
  }
});
