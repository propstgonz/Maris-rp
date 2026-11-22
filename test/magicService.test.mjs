import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import { makeFakeNamedExports } from './helpers/mockDb.mjs';

const state = { progress: { level_rank: 0, retry_after: null }, claimChanges: 1, roll: 15, attempts: [], logs: [], promotions: 0, mentor: null };
const fakeDb = {
  prepare: () => ({ get: () => undefined, all: () => [], run: () => ({ changes: 0 }) }),
};
const named = makeFakeNamedExports(fakeDb);

const school = { id: 2, slug: 'alteracion', name: 'Alteración', secondary_stat: 'intuicion', secondary_divisor: 1, is_active: 1 };
const levels = [1, 2, 3, 4, 5].map((rank, i) => ({ rank, name: `N${rank}`, threshold: [19, 19, 21, 24, 28][i] }));

async function queryOne(sql) {
  if (sql.includes('FROM rp_players.schools WHERE slug')) return school;
  if (sql.includes('SELECT p.*, r.mod_potencia')) return { id: 1, discord_id: 'd1', is_alive: 1, stat_autismo: 3, stat_intuicion: 2 };
  if (sql.includes('FROM rp_players.menhirs m')) return null;
  if (sql.includes('SELECT level_rank, retry_after')) return state.progress;
  if (sql.includes('SELECT p.id, COALESCE')) return state.mentor;
  if (sql.includes('COUNT(*)')) return { total: 0 };
  return undefined;
}
async function query(sql) {
  state.sqls?.push(sql);
  if (sql.includes('mastery_levels')) return levels;
  return [];
}
async function execute(sql) {
  if (sql.includes('SET sp.retry_after')) return { changes: state.claimChanges };
  if (sql.includes('SET level_rank')) { state.promotions++; return { changes: 1 }; }
  if (sql.includes('magic_attempts')) { state.attempts.push(1); return { changes: 1 }; }
  return { changes: 1 };
}

mock.module('../src/database/index.js', {
  namedExports: { ...named, query, queryOne, execute, withTransaction: fn => fn() },
});
mock.module('../src/utils/dice.js', { namedExports: { rollDie: () => state.roll } });
mock.module('../src/services/auditLogService.js', {
  namedExports: { logAction: async entry => { state.logs.push(entry); } },
});

const { authorizedRoll, getUnlockedSpells } = await import('../src/services/magicService.js');
const actor = { discordId: '9', username: 'rp', source: 'discord' };

test('tirada de entrada con éxito: 15 + 2 + 3 >= 19', async () => {
  const r = await authorizedRoll({ playerId: 1, schoolSlug: 'alteracion', actor });
  assert.equal(r.success, true);
  assert.equal(r.modifier, 5);
  assert.equal(r.total, 20);
  assert.equal(r.targetRank, 1);
  assert.equal(state.promotions, 1);
  assert.equal(state.attempts.length, 1);
  assert.equal(state.logs[0].action, 'magia.tirada');
});

test('subir a Aprendiz sin mentor se rechaza', async () => {
  state.progress = { level_rank: 1, retry_after: null };
  await assert.rejects(authorizedRoll({ playerId: 1, schoolSlug: 'alteracion', actor }), /mentor/);
});

test('mentor jugador de nivel insuficiente se rechaza', async () => {
  state.mentor = { id: 5, level_rank: 1 };
  await assert.rejects(
    authorizedRoll({ playerId: 1, schoolSlug: 'alteracion', mentorPlayerId: 5, actor }), /nivel 2/
  );
});

test('claim sin filas explica el enfriamiento', async () => {
  state.claimChanges = 0;
  state.progress = { level_rank: 0, retry_after: new Date(Date.now() + 86400000) };
  await assert.rejects(authorizedRoll({ playerId: 1, schoolSlug: 'alteracion', actor }), /hasta el/);
});

test('paginación inválida cae a valores seguros y se interpola como entero', async () => {
  state.sqls = [];
  const r = await getUnlockedSpells(1, { page: 'x; DROP', pageSize: -4 });
  assert.equal(r.total, 0);
  assert.match(state.sqls[0], /LIMIT 10 OFFSET 0$/);
});
