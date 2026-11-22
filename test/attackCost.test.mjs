import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import { makeFakeDb, makeFakeNamedExports } from './helpers/mockDb.mjs';

const fakeDb = makeFakeDb();
const events = [];

mock.module('../src/database/index.js', {
  defaultExport: fakeDb,
  namedExports: {
    ...makeFakeNamedExports(fakeDb),
    execute: async (sql) => {
      if (/attacks_today_count/.test(sql)) {
        events.push('claimSlot');
        return { changes: 1, lastInsertRowid: 0 };
      }
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

mock.module('../src/services/settingsService.js', {
  namedExports: {
    getSetting: async (key) => (key === 'attack_max_per_day' ? '1' : '0'),
    setSetting: async () => {},
  },
});

let hasAmmo = true;
mock.module('../src/services/inventoryService.js', {
  namedExports: {
    hasEnough: async () => hasAmmo,
    removeItem: async () => { events.push('removeAmmo'); return { newQuantity: 4 }; },
    addItem: async () => ({ newQuantity: 1 }),
    getInventory: async () => [],
    setItemQuantity: async () => ({}),
    getItemQuantity: async () => 0,
    getInventoryWeight: async () => 0,
    setInventoryCapacity: async () => ({}),
    setInventorySlotOrder: async () => ({}),
    grantItem: async () => ({}),
    revokeItem: async () => ({}),
  },
});

const { _claimAttackCost } = await import('../src/services/combatService.js');

const attacker = { id: 7 };
const rifle = { display_name: 'Rifle', weapon_ammo_item_name: 'municion', weapon_ammo_cost: 1 };

test('quedarse sin munición no gasta el ataque del día', async () => {
  hasAmmo = false;
  events.length = 0;

  await assert.rejects(() => _claimAttackCost(attacker, 'jugador', rifle), /No te queda munición/);

  assert.deepEqual(events, ['begin', 'claimSlot', 'rollback'],
    'el cupo diario se reclama dentro de la transacción, así que un fallo de munición lo devuelve');
});

test('un ataque válido confirma cupo y munición a la vez', async () => {
  hasAmmo = true;
  events.length = 0;

  const ammo = await _claimAttackCost(attacker, 'jugador', rifle);

  assert.deepEqual(events, ['begin', 'claimSlot', 'removeAmmo', 'commit']);
  assert.equal(ammo.cost, 1);
});

test('un arma sin munición no toca el inventario pero sí reclama el cupo', async () => {
  events.length = 0;

  const ammo = await _claimAttackCost(attacker, 'jugador', { display_name: 'Machete' });

  assert.equal(ammo, null);
  assert.deepEqual(events, ['begin', 'claimSlot', 'commit']);
});
