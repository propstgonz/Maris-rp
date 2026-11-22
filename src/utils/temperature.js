export const DEFAULT_TEMP_MIN = 5;
export const DEFAULT_TEMP_MAX = 25;
export const TEMP_ABSOLUTE_MIN = -80;
export const TEMP_ABSOLUTE_MAX = 80;

const OCTAVES = [
  { cell: 9, weight: 0.7, salt: 0 },
  { cell: 3, weight: 0.3, salt: 7919 },
];
const SMOOTH_PASSES = 2;
const SELF_WEIGHT = 2;
const SLACK_RATIO = 0.25;
const MIN_SLACK = 1;
const NEIGHBOURS = [[1, 0], [-1, 0], [0, 1], [0, -1]];

export const SMOOTH_MARGIN = SMOOTH_PASSES;

function hash01(x, y, seed) {
  let h = Math.imul(x | 0, 0x27d4eb2d) ^ Math.imul(y | 0, 0x85ebca6b) ^ Math.imul(seed | 0, 0x165667b1);
  h ^= h >>> 15;
  h = Math.imul(h, 0x2c1b3c6d);
  h ^= h >>> 12;
  h = Math.imul(h, 0x297a2d39);
  h ^= h >>> 15;
  return (h >>> 0) / 4294967295;
}

function fade(t) {
  return t * t * (3 - 2 * t);
}

function octaveNoise(x, y, cell, seed) {
  const gx = Math.floor(x / cell);
  const gy = Math.floor(y / cell);
  const tx = fade(x / cell - gx);
  const ty = fade(y / cell - gy);
  const v00 = hash01(gx, gy, seed);
  const v10 = hash01(gx + 1, gy, seed);
  const v01 = hash01(gx, gy + 1, seed);
  const v11 = hash01(gx + 1, gy + 1, seed);
  const top = v00 * (1 - tx) + v10 * tx;
  const bottom = v01 * (1 - tx) + v11 * tx;
  return top * (1 - ty) + bottom * ty;
}

export function temperatureNoise(x, y, seed = 0) {
  let total = 0;
  for (const { cell, weight, salt } of OCTAVES) {
    total += weight * octaveNoise(x, y, cell, seed + salt);
  }
  return Math.min(1, Math.max(0, total));
}

export function roundTemperature(value) {
  return Math.round(value * 10) / 10;
}

export function rawTemperature(x, y, tempMin, tempMax, seed = 0) {
  const min = Math.min(tempMin, tempMax);
  const max = Math.max(tempMin, tempMax);
  return min + temperatureNoise(x, y, seed) * (max - min);
}

function key(x, y) {
  return `${x},${y}`;
}

export function buildTemperatureField(tiles, seed = 0) {
  let current = new Map();
  for (const tile of tiles) {
    current.set(key(tile.x, tile.y), rawTemperature(tile.x, tile.y, tile.tempMin, tile.tempMax, seed));
  }

  for (let pass = 0; pass < SMOOTH_PASSES; pass++) {
    const next = new Map();
    for (const tile of tiles) {
      let sum = current.get(key(tile.x, tile.y)) * SELF_WEIGHT;
      let weight = SELF_WEIGHT;
      for (const [dx, dy] of NEIGHBOURS) {
        const neighbour = current.get(key(tile.x + dx, tile.y + dy));
        if (neighbour === undefined) continue;
        sum += neighbour;
        weight += 1;
      }
      next.set(key(tile.x, tile.y), sum / weight);
    }
    current = next;
  }

  return tiles.map(tile => {
    const min = Math.min(tile.tempMin, tile.tempMax);
    const max = Math.max(tile.tempMin, tile.tempMax);
    const slack = Math.max(MIN_SLACK, (max - min) * SLACK_RATIO);
    const value = Math.min(max + slack, Math.max(min - slack, current.get(key(tile.x, tile.y))));
    return { ...tile, temperature: roundTemperature(value) };
  });
}

export function validateTemperatureRange(tempMin, tempMax) {
  const min = Number(tempMin);
  const max = Number(tempMax);
  if (!Number.isFinite(min) || !Number.isFinite(max)) {
    throw new Error('La temperatura mínima y la máxima deben ser números.');
  }
  if (min < TEMP_ABSOLUTE_MIN || max > TEMP_ABSOLUTE_MAX) {
    throw new Error(`Las temperaturas deben estar entre ${TEMP_ABSOLUTE_MIN} y ${TEMP_ABSOLUTE_MAX} °C.`);
  }
  if (min > max) {
    throw new Error('La temperatura mínima no puede ser mayor que la máxima.');
  }
  return { tempMin: roundTemperature(min), tempMax: roundTemperature(max) };
}

export function formatTemperature(value) {
  if (value == null || !Number.isFinite(Number(value))) return 'sin registrar';
  return `${roundTemperature(Number(value)).toFixed(1)} °C`;
}

const BANDS = [
  { limit: -15, label: 'Gélido', emoji: '🧊' },
  { limit: -2, label: 'Helado', emoji: '❄️' },
  { limit: 10, label: 'Frío', emoji: '🌬️' },
  { limit: 22, label: 'Templado', emoji: '🌤️' },
  { limit: 32, label: 'Cálido', emoji: '☀️' },
  { limit: 42, label: 'Sofocante', emoji: '🔥' },
];
const EXTREME_BAND = { label: 'Abrasador', emoji: '🌋' };

export function describeTemperature(value) {
  if (value == null || !Number.isFinite(Number(value))) return { label: 'Sin registrar', emoji: '🌡️' };
  return BANDS.find(band => Number(value) < band.limit) ?? EXTREME_BAND;
}
