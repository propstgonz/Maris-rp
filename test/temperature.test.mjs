import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildTemperatureField, rawTemperature, temperatureNoise,
  validateTemperatureRange, formatTemperature, describeTemperature,
} from '../src/utils/temperature.js';

function grid(width, height, tempMin, tempMax) {
  const tiles = [];
  for (let x = 0; x < width; x++) {
    for (let y = 0; y < height; y++) tiles.push({ x, y, tempMin, tempMax });
  }
  return tiles;
}

function byCoord(field) {
  return new Map(field.map(t => [`${t.x},${t.y}`, t.temperature]));
}

function maxNeighbourJump(field) {
  const map = byCoord(field);
  let worst = 0;
  for (const tile of field) {
    for (const [dx, dy] of [[1, 0], [0, 1]]) {
      const neighbour = map.get(`${tile.x + dx},${tile.y + dy}`);
      if (neighbour === undefined) continue;
      worst = Math.max(worst, Math.abs(neighbour - tile.temperature));
    }
  }
  return worst;
}

test('el ruido siempre cae entre 0 y 1', () => {
  for (let x = -50; x <= 50; x += 7) {
    for (let y = -50; y <= 50; y += 7) {
      const n = temperatureNoise(x, y, 12345);
      assert.ok(n >= 0 && n <= 1, `ruido fuera de rango en (${x},${y}): ${n}`);
    }
  }
});

test('la misma casilla con la misma semilla da siempre la misma temperatura', () => {
  const a = rawTemperature(17, 42, -5, 5, 999);
  const b = rawTemperature(17, 42, -5, 5, 999);
  assert.equal(a, b);
});

test('semillas distintas reparten el clima de otra forma', () => {
  const conUna = buildTemperatureField(grid(20, 20, -10, 30), 1).map(t => t.temperature);
  const conOtra = buildTemperatureField(grid(20, 20, -10, 30), 2).map(t => t.temperature);
  assert.notDeepEqual(conUna, conOtra);
});

test('toda casilla se queda dentro del rango de su zona (con el margen de transición)', () => {
  const field = buildTemperatureField(grid(30, 30, -3, 7), 4242);
  for (const tile of field) {
    assert.ok(tile.temperature >= -3 - 2.5, `demasiado frío: ${tile.temperature}`);
    assert.ok(tile.temperature <= 7 + 2.5, `demasiado cálido: ${tile.temperature}`);
  }
});

test('casillas vecinas de la misma zona no dan saltos bruscos', () => {
  const field = buildTemperatureField(grid(40, 40, -3, 7), 7);
  assert.ok(maxNeighbourJump(field) <= 2, `salto entre vecinas demasiado grande: ${maxNeighbourJump(field)}`);
});

test('una zona ancha sí varía de un extremo al otro: no es un valor plano', () => {
  const field = buildTemperatureField(grid(60, 60, -10, 10), 31);
  const values = field.map(t => t.temperature);
  assert.ok(Math.max(...values) - Math.min(...values) > 5, 'el mapa ha salido casi plano');
});

test('dos zonas contiguas mantienen cada una su clima aunque se toquen', () => {
  const tiles = [];
  for (let x = 0; x < 40; x++) {
    for (let y = 0; y < 6; y++) {
      const fria = x < 20;
      tiles.push({ x, y, tempMin: fria ? -12 : 28, tempMax: fria ? -4 : 38 });
    }
  }
  const map = byCoord(buildTemperatureField(tiles, 5));
  assert.ok(map.get('2,3') < 0, 'la mitad fría debería seguir bajo cero');
  assert.ok(map.get('37,3') > 20, 'la mitad cálida debería seguir siendo tórrida');
});

test('el rango de una zona se valida antes de guardarse', () => {
  assert.deepEqual(validateTemperatureRange(-3, 7), { tempMin: -3, tempMax: 7 });
  assert.throws(() => validateTemperatureRange(10, 2), /mínima no puede ser mayor/);
  assert.throws(() => validateTemperatureRange('frío', 2), /deben ser números/);
  assert.throws(() => validateTemperatureRange(-500, 2), /entre -80 y 80/);
});

test('la temperatura se muestra con una décima y su etiqueta', () => {
  assert.equal(formatTemperature(-3.24), '-3.2 °C');
  assert.equal(formatTemperature(null), 'sin registrar');
  assert.equal(describeTemperature(-20).label, 'Gélido');
  assert.equal(describeTemperature(15).label, 'Templado');
  assert.equal(describeTemperature(50).label, 'Abrasador');
});
