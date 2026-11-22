import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import { makeFakeNamedExports } from './helpers/mockDb.mjs';

const state = { alive: true, changes: 0, have: 2, sql: [] };
const fakeDb = {
  prepare(sql) {
    const q = sql.trim().replace(/\s+/g, ' ');
    return {
      get: () => {
        if (q.includes('FOR UPDATE')) return state.alive ? { id: 1 } : undefined;
        return { n: state.have };
      },
      all: () => [],
      run: () => { state.sql.push(q); return { changes: state.changes, lastInsertRowid: 0 }; },
    };
  },
};

const audit = [];
mock.module('../src/database/index.js', {
  namedExports: makeFakeNamedExports(fakeDb),
});
mock.module('../src/services/auditLogService.js', {
  namedExports: { logAction: async (e) => { audit.push(e); } },
});

const svc = await import('../src/services/npcHoldingService.js');
const actor = { discordId: '1', username: 'rp', source: 'discord' };

test('validaciones de cantidad y nombre', async () => {
  for (const c of [0, 51, 1.5, '3']) await assert.rejects(svc.addNpcs(1, 'Guardia', c, actor), /cantidad/);
  await assert.rejects(svc.addNpcs(1, '   ', 1, actor), /nombre/);
  await assert.rejects(svc.addNpcs(1, 'a\nb', 1, actor), /nombre/);
  await assert.rejects(svc.addNpcs(1, 'x'.repeat(81), 1, actor), /nombre/);
});

test('alta: dueño muerto rechaza; vivo inserta y audita', async () => {
  state.alive = false;
  await assert.rejects(svc.addNpcs(1, 'Guardia', 2, actor), /no está vivo/);
  state.alive = true;
  state.changes = 2;
  assert.equal(await svc.addNpcs(1, ' Guardia ', 2, actor), 2);
  assert.match(state.sql.at(-1), /VALUES \(\?, \?, \?\), \(\?, \?, \?\)/);
  assert.equal(audit.at(-1).action, 'npcs.alta');
});

test('baja con changes !== n lanza y no audita', async () => {
  const before = audit.length;
  state.changes = 1;
  await assert.rejects(svc.removeNpcs(1, 'Guardia', 3, actor), /Solo tiene 1/);
  assert.equal(audit.length, before);
});

test('traspaso: mismo origen/destino, destino muerto y changes !== n', async () => {
  await assert.rejects(svc.transferNpcsInTx(1, 1, 'G', 1), /otro personaje/);
  state.alive = false;
  await assert.rejects(svc.transferNpcsInTx(1, 2, 'G', 1), /no está vivo/);
  state.alive = true; state.changes = 2;
  await assert.rejects(svc.transferNpcsInTx(1, 2, 'G', 3), /Solo tiene 2/);
  state.changes = 3;
  await svc.transferNpcsInTx(1, 2, 'G', 3);
  assert.match(state.sql.at(-1), /LIMIT 3$/);
});

test('adminTransferNpcs audita traspaso', async () => {
  state.changes = 1;
  await svc.adminTransferNpcs(1, 2, 'G', 1, actor);
  assert.equal(audit.at(-1).action, 'npcs.traspaso');
});
