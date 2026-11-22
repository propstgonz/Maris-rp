import { test } from 'node:test';
import assert from 'node:assert/strict';
import { startGuardedInterval } from '../src/utils/guardedInterval.js';

test('startGuardedInterval: una tarea más lenta que el intervalo nunca se solapa consigo misma', async () => {
  const TICK_MS = 15;
  const TASK_MS = 60;

  let running = 0;
  let maxConcurrent = 0;
  let starts = 0;

  const timer = startGuardedInterval(async () => {
    starts++;
    running++;
    maxConcurrent = Math.max(maxConcurrent, running);
    await new Promise(resolve => setTimeout(resolve, TASK_MS));
    running--;
  }, TICK_MS);

  await new Promise(resolve => setTimeout(resolve, TASK_MS * 5));
  clearInterval(timer);

  await new Promise(resolve => setTimeout(resolve, TASK_MS + 20));

  assert.equal(maxConcurrent, 1, `la tarea llegó a solaparse consigo misma (máximo ${maxConcurrent} a la vez) — la guarda no está funcionando`);
  assert.equal(running, 0, 'quedó una tarea "en marcha" tras esperar de sobra a que terminase');

  assert.ok(starts >= 2 && starts <= 8, `número de arranques fuera de lo esperado con guarda: ${starts}`);
});

test('startGuardedInterval: un error en la tarea no detiene los siguientes ticks', async () => {
  const TICK_MS = 15;
  let calls = 0;

  const timer = startGuardedInterval(() => {
    calls++;
    if (calls === 1) throw new Error('fallo simulado del primer tick');
  }, TICK_MS);

  await new Promise(resolve => setTimeout(resolve, TICK_MS * 5));
  clearInterval(timer);

  assert.ok(calls >= 2, `tras un error en el primer tick, deberían haber corrido más (llamadas: ${calls})`);
});

test('startGuardedInterval: una tarea SÍNCRONA (sin promesa) también respeta la guarda', async () => {
  const TICK_MS = 10;
  let calls = 0;

  const timer = startGuardedInterval(() => { calls++; }, TICK_MS);
  await new Promise(resolve => setTimeout(resolve, TICK_MS * 3 + 5));
  clearInterval(timer);

  assert.ok(calls >= 2, `una tarea síncrona rápida debería correr en varios ticks (llamadas: ${calls})`);
});
