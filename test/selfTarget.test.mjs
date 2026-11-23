import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import { makeFakeNamedExports } from './helpers/mockDb.mjs';

const fakeDb = { prepare: () => ({ get: () => undefined, all: () => [], run: () => ({ changes: 0 }) }) };
const calls = [];

mock.module('../src/database/index.js', { namedExports: makeFakeNamedExports(fakeDb) });
mock.module('../src/utils/permissions.js', {
  namedExports: {
    requireRolepriest: async () => true,
    resolveGuild: () => null,
    isRolepriest: () => true,
    resolveMember: async () => null,
    config: {},
    ROLE_ROLEPRIEST: [],
  },
});
mock.module('../src/services/characterLifecycleService.js', {
  namedExports: {
    markDeceased: async (...args) => { calls.push(['kill', ...args]); return { fromGrace: false }; },
    reviveCharacter: async (...args) => { calls.push(['revive', ...args]); return {}; },
    reviveByCharacterId: async (...args) => { calls.push(['reviveById', ...args]); return {}; },
  },
});
mock.module('../src/services/playerService.js', {
  namedExports: {
    getPlayerByDiscordId: async () => undefined,
    findPlayerById: async id => ({ id, discord_id: 'staff1' }),
    listPlayers: async () => [],
    lockPlayersInTx: async () => [],
  },
});

const kill = (await import('../src/commands/staff/kill.js')).default;
const revive = (await import('../src/commands/staff/revive.js')).default;

function selfInteraction(sub) {
  return {
    user: { id: 'staff1', tag: 'staff#1' },
    client: {},
    options: {
      getSubcommand: () => sub,
      getUser: () => ({ id: 'staff1', tag: 'staff#1' }),
      getString: () => null,
      getInteger: () => 7,
    },
    reply: async () => {},
  };
}

test('un Rolepriest no puede matarse ni revivirse a sí mismo', async () => {
  await assert.rejects(kill.execute(selfInteraction()), /no se auto-rolea/);
  await assert.rejects(revive.execute(selfInteraction('jugador')), /no se auto-rolea/);
  await assert.rejects(revive.execute(selfInteraction('personaje_id')), /no se auto-rolea/);
  assert.deepEqual(calls, []);
});
