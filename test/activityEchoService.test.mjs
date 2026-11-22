import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import { makeFakeDb, makeFakeNamedExports } from './helpers/mockDb.mjs';

const fakeDb = makeFakeDb();
mock.module('../src/database/index.js', { defaultExport: fakeDb, namedExports: makeFakeNamedExports(fakeDb) });

const { selectEchoes } = await import('../src/services/activityEchoService.js');

test('selectEchoes ignora filas source:"discord" (el jugador ya vio el resultado en el propio canal)', () => {
  const echoes = selectEchoes([
    { source: 'discord', actor_discord_id: 'p1', action: 'travel.cancel', target: null, details: null },
  ]);
  assert.equal(echoes.size, 0);
});

test('selectEchoes incluye filas source:"web"', () => {
  const echoes = selectEchoes([
    { source: 'web', actor_discord_id: 'p1', action: 'travel.cancel', target: null, details: null },
  ]);
  assert.deepEqual(echoes.get('p1'), ['Has cancelado tu viaje.']);
});

test('selectEchoes agrupa varias filas del mismo actor en un mismo tick, en orden', () => {
  const echoes = selectEchoes([
    { source: 'web', actor_discord_id: 'p1', action: 'combat.npc_hit', target: '(1,1)', details: { npcType: 'Lobo', damage: 4, npcDied: false, npcHpAfter: 6 } },
    { source: 'web', actor_discord_id: 'p1', action: 'combat.npc_counterattack_hit', target: 'p1', details: { npcType: 'Lobo', damage: 2, playerHpAfter: 8, playerKilled: false } },
  ]);
  assert.equal(echoes.get('p1').length, 2);
});

test('selectEchoes ignora acciones sin entrada en activityFeed (no rompe, no genera eco vacío)', () => {
  const echoes = selectEchoes([
    { source: 'web', actor_discord_id: 'p1', action: 'item.create', target: 'hierro', details: {} },
  ]);
  assert.equal(echoes.size, 0);
});

test('selectEchoes ignora filas sin actor_discord_id', () => {
  const echoes = selectEchoes([
    { source: 'web', actor_discord_id: null, action: 'travel.cancel', target: null, details: null },
  ]);
  assert.equal(echoes.size, 0);
});
