import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mock } from 'node:test';
import { makeFakeDb, makeFakeNamedExports } from './helpers/mockDb.mjs';

const fakeDb = makeFakeDb();
mock.module('../src/database/index.js', { defaultExport: fakeDb, namedExports: makeFakeNamedExports(fakeDb) });

const { computeProductionCycles, cyclesAvailableFor } = await import('../src/services/productionService.js');
const { toSqlDatetime } = await import('../src/utils/sqlDatetime.js');

function hoursAgo(hoursAgo) {
  return toSqlDatetime(new Date(Date.now() - hoursAgo * 3_600_000));
}

test('ciclo normal: con fuel y almacén de sobra, corre todos los ciclos disponibles', () => {
  const result = computeProductionCycles({
    cyclesAvailable: 3, fuelLevel: 100, fuelConsumptionRate: 1,
    storageUsedWeight: 0, storageCapacity: 1000, itemWeight: 1, ratePerCycle: 5,
  });
  assert.equal(result.cyclesRun, 3);
  assert.equal(result.producedQuantity, 15);
  assert.equal(result.fuelSpent, 3);
  assert.equal(result.stoppedReason, null);
});

test('sin combustible suficiente: para ANTES de correr el ciclo que no puede pagar', () => {
  const result = computeProductionCycles({
    cyclesAvailable: 5, fuelLevel: 2, fuelConsumptionRate: 1,
    storageUsedWeight: 0, storageCapacity: null, itemWeight: 1, ratePerCycle: 10,
  });
  assert.equal(result.cyclesRun, 2);
  assert.equal(result.fuelSpent, 2);
  assert.equal(result.stoppedReason, 'no_fuel');
});

test('sin ningún combustible desde el principio: cyclesRun 0, no revienta', () => {
  const result = computeProductionCycles({
    cyclesAvailable: 5, fuelLevel: 0, fuelConsumptionRate: 1,
    storageUsedWeight: 0, storageCapacity: null, itemWeight: 1, ratePerCycle: 10,
  });
  assert.equal(result.cyclesRun, 0);
  assert.equal(result.stoppedReason, 'no_fuel');
});

test('almacén lleno: parada seca — NO cobra combustible del ciclo que no cupo', () => {
  const result = computeProductionCycles({
    cyclesAvailable: 5, fuelLevel: 100, fuelConsumptionRate: 1,
    storageUsedWeight: 5, storageCapacity: 15, itemWeight: 1, ratePerCycle: 10,
  });
  assert.equal(result.cyclesRun, 1);
  assert.equal(result.fuelSpent, 1, 'el ciclo que SÍ corrió sí paga su combustible');
  assert.equal(result.stoppedReason, 'storage_full');
});

test('sin construcción sin capacidad configurada (storageCapacity null) nunca para por almacén', () => {
  const result = computeProductionCycles({
    cyclesAvailable: 10, fuelLevel: 100, fuelConsumptionRate: 1,
    storageUsedWeight: 999_999, storageCapacity: null, itemWeight: 50, ratePerCycle: 10,
  });
  assert.equal(result.cyclesRun, 10);
  assert.equal(result.stoppedReason, null);
});

test('sin combustible configurado (fuelConsumptionRate 0): nunca para por fuel, solo por almacén', () => {
  const result = computeProductionCycles({
    cyclesAvailable: 4, fuelLevel: 0, fuelConsumptionRate: 0,
    storageUsedWeight: 0, storageCapacity: 1000, itemWeight: 1, ratePerCycle: 5,
  });
  assert.equal(result.cyclesRun, 4);
  assert.equal(result.fuelSpent, 0);
  assert.equal(result.stoppedReason, null);
});

test('cyclesAvailable ya viene topado por max_accrual_hours desde el llamador — aquí solo se respeta el número recibido', () => {
  const result = computeProductionCycles({
    cyclesAvailable: 2, fuelLevel: 100, fuelConsumptionRate: 1,
    storageUsedWeight: 0, storageCapacity: null, itemWeight: 1, ratePerCycle: 5,
  });
  assert.equal(result.cyclesRun, 2);
  assert.equal(result.producedQuantity, 10);
});

test('itemWeight 0 (ítem sin peso) nunca llena el almacén, corre todos los ciclos', () => {
  const result = computeProductionCycles({
    cyclesAvailable: 100, fuelLevel: 1000, fuelConsumptionRate: 1,
    storageUsedWeight: 0, storageCapacity: 10, itemWeight: 0, ratePerCycle: 5,
  });
  assert.equal(result.cyclesRun, 100);
  assert.equal(result.stoppedReason, null);
});

test('cyclesAvailable 0 no corre nada ni gasta nada', () => {
  const result = computeProductionCycles({
    cyclesAvailable: 0, fuelLevel: 100, fuelConsumptionRate: 1,
    storageUsedWeight: 0, storageCapacity: 1000, itemWeight: 1, ratePerCycle: 5,
  });
  assert.equal(result.cyclesRun, 0);
  assert.equal(result.producedQuantity, 0);
  assert.equal(result.fuelSpent, 0);
  assert.equal(result.stoppedReason, null);
});

test('cyclesAvailableFor: recién creado (0h transcurridas) da 0 ciclos', () => {
  const n = cyclesAvailableFor({
    lastProductionAt: null, createdAt: hoursAgo(0), intervalHours: 24, maxAccrualHours: 48,
  });
  assert.equal(n, 0);
});

test('cyclesAvailableFor: sin last_production_at, cae a created_at', () => {
  const n = cyclesAvailableFor({
    lastProductionAt: null, createdAt: hoursAgo(30), intervalHours: 24, maxAccrualHours: 48,
  });
  assert.equal(n, 1, 'floor(30/24) = 1, cuenta desde created_at porque nunca produjo');
});

test('cyclesAvailableFor: con last_production_at, ignora created_at aunque sea mucho más viejo', () => {
  const n = cyclesAvailableFor({
    lastProductionAt: hoursAgo(30), createdAt: hoursAgo(1000), intervalHours: 24, maxAccrualHours: 48,
  });
  assert.equal(n, 1, 'floor(30/24) = 1 — el reloj cuenta desde el último devengo, no desde que se construyó');
});

test('cyclesAvailableFor: el resto fraccionario de un intervalo se descarta (floor, no round)', () => {
  const n = cyclesAvailableFor({
    lastProductionAt: hoursAgo(47), createdAt: hoursAgo(47), intervalHours: 24, maxAccrualHours: 48,
  });
  assert.equal(n, 1, 'floor(47/24) = 1, no 2 — el resto de casi un intervalo entero no cuenta como ciclo completo');
});

test('cyclesAvailableFor: las horas transcurridas se topan a maxAccrualHours ANTES de dividir', () => {
  const n = cyclesAvailableFor({
    lastProductionAt: hoursAgo(400), createdAt: hoursAgo(400), intervalHours: 24, maxAccrualHours: 48,
  });
  assert.equal(n, 2);
});

test('cyclesAvailableFor: exactamente maxAccrualHours da el máximo de ciclos posible con ese intervalo', () => {
  const n = cyclesAvailableFor({
    lastProductionAt: hoursAgo(48), createdAt: hoursAgo(48), intervalHours: 24, maxAccrualHours: 48,
  });
  assert.equal(n, 2);
});
