import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import { makeFakeDb, makeFakeNamedExports } from './helpers/mockDb.mjs';

const fakeDb = makeFakeDb();
const events = [];

const producer = {
  id: 1, name: 'Aserradero', tile_id: 10, current_health: 100, fuel_level: 0,
  last_production_at: null, created_at: '2020-01-01 00:00:00',
  built_by_player_id: 5, built_by_discord_id: 'duenyo', consecutive_unmaintained_days: 0,
  coord_x: 3, coord_y: 4,
  grants_resource_item_id: 7, grants_resource_rate: 5, ct_max_health: 100,
  production_interval_hours: 24, max_accrual_hours: 48, storage_capacity: 1000,
  fuel_item_id: null, fuel_consumption_rate: 0, fuel_capacity: null, maintenance_item_id: null,
  granted_item_name: 'madera', granted_item_display: 'Madera', granted_item_weight: 1,
  fuel_item_name: null, fuel_item_display: null,
};

mock.module('../src/database/index.js', {
  defaultExport: fakeDb,
  namedExports: {
    ...makeFakeNamedExports(fakeDb),
    queryOne: async (sql) => (/FOR UPDATE/.test(sql)
      ? { current_health: 100, fuel_level: 0, last_production_at: null, consecutive_unmaintained_days: 0 }
      : producer),
    execute: async (sql) => {
      if (/audit_log|INSERT INTO/.test(sql)) events.push('audit');
      return { changes: 1, lastInsertRowid: 0 };
    },
    withTransaction: async (fn) => {
      events.push('begin');
      try {
        const result = await fn();
        events.push('commit');
        return result;
      } catch (err) {
        events.push('rollback');
        throw err;
      }
    },
  },
});

mock.module('../src/services/storageService.js', {
  namedExports: {
    getStorageContents: async () => [],
    addToStorage: async () => { events.push('storage'); },
  },
});

mock.module('../src/services/auditLogService.js', {
  namedExports: {
    logAction: async () => {
      await new Promise(resolve => setImmediate(resolve));
      events.push('audit');
    },
  },
});

const { settleConstructionProduction } = await import('../src/services/productionService.js');

test('la fila de auditoría se escribe antes del commit, no después de soltar la conexión', async () => {
  events.length = 0;

  const result = await settleConstructionProduction(1, { audit: true });

  assert.ok(result.cyclesRun > 0, 'el escenario tiene que producir algo para que haya auditoría');
  assert.deepEqual(events, ['begin', 'storage', 'audit', 'commit'],
    'sin await, el INSERT de auditoría usaría la conexión ya devuelta al pool');
});

test('sin auditoría pedida, la producción sigue confirmándose igual', async () => {
  events.length = 0;

  await settleConstructionProduction(1);

  assert.deepEqual(events, ['begin', 'storage', 'commit']);
});
