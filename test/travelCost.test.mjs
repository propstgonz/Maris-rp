














import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import { makeFakeDb, makeFakeNamedExports } from './helpers/mockDb.mjs';

function normalize(sql) {
  return sql.trim().replace(/\s+/g, ' ');
}


const MAP_TILES = new Map([
  ['0,0', { id: 100, coord_x: 0, coord_y: 0, terrain_type_id: 1 }],
  ['1,0', { id: 101, coord_x: 1, coord_y: 0, terrain_type_id: 1 }],
  ['2,0', { id: 102, coord_x: 2, coord_y: 0, terrain_type_id: 2 }],
]);
const TERRAIN_TYPES = new Map([
  [1, { id: 1, movement_cost: 1 }],
  [2, { id: 2, movement_cost: 3 }],
]);

const ROUTE_MULTIPLIER_BY_TILE_ID = new Map([[101, 0.5]]);

function makeTravelCostFakeDb() {
  const generic = makeFakeDb();
  return {
    ...generic,
    prepare(sql) {
      const q = normalize(sql);
      if (q === 'SELECT * FROM rp_world.map_tiles WHERE coord_x = ? AND coord_y = ?') {
        return { get: (x, y) => MAP_TILES.get(`${x},${y}`) };
      }
      if (q === 'SELECT * FROM rp_world.terrain_types WHERE id = ?') {
        return { get: (id) => TERRAIN_TYPES.get(id) };
      }
      if (q.startsWith('SELECT MIN(ct.travel_cost_multiplier) AS best')) {
        return {
          get: (x, y) => {
            const tile = MAP_TILES.get(`${x},${y}`);
            const best = tile ? ROUTE_MULTIPLIER_BY_TILE_ID.get(tile.id) ?? null : null;
            return { best };
          },
        };
      }
      return generic.prepare(sql);
    },
  };
}

const fakeDb = makeTravelCostFakeDb();
mock.module('../src/database/index.js', { defaultExport: fakeDb, namedExports: makeFakeNamedExports(fakeDb) });

const { computePathCost } = await import('../src/services/travelService.js');

test('un terreno más caro (montaña, coste 3) suma su coste completo', async () => {
  assert.equal(await computePathCost([{ x: 1, y: 0 }, { x: 2, y: 0 }]), 3);
});

test('una infraestructura de ruta abarata su casilla — multiplica, no resta', async () => {
  assert.equal(await computePathCost([{ x: 0, y: 0 }, { x: 1, y: 0 }]), 0.5);
});

test('una casilla sin crear (getTile → null) cuesta 1 por defecto, mismo criterio permisivo que canEnterTile', async () => {
  assert.equal(await computePathCost([{ x: 0, y: 0 }, { x: 99, y: 99 }]), 1);
});

test('el coste de un camino de varias casillas es la suma de cada una, terreno y ruta mezclados', async () => {

  assert.equal(await computePathCost([{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 2, y: 0 }]), 3.5);
});

test('con todo en su default (terreno normal, sin ruta), el coste total es igual al número de pasos — comportamiento idéntico al de antes de la Fase 4', async () => {
  const path = [{ x: -5, y: -5 }, { x: -4, y: -5 }, { x: -3, y: -5 }];
  assert.equal(await computePathCost(path), 2);
});
