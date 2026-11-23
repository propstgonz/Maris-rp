import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import { makeFakeNamedExports } from './helpers/mockDb.mjs';

const fakeDb = { prepare: () => ({ get: () => undefined, all: () => [], run: () => ({ changes: 0 }) }) };
const state = { rolepriest: false, rollCalls: [] };

mock.module('../src/database/index.js', { namedExports: makeFakeNamedExports(fakeDb) });
mock.module('../src/utils/permissions.js', {
  namedExports: {
    requireRolepriest: async () => state.rolepriest,
    resolveGuild: () => ({ id: 'g1' }),
    isRolepriest: () => state.rolepriest,
    resolveMember: async () => null,
    config: {},
    ROLE_ROLEPRIEST: [],
    PERMISSION_LEVELS: ['public', 'player', 'rolepriest'],
  },
});
mock.module('../src/utils/interactionContext.js', {
  namedExports: {
    actorFrom: () => ({ discordId: 'staff1', username: 'staff', source: 'discord' }),
    callerIsRolepriest: async () => state.rolepriest,
    requireLivingCharacter: async () => ({ id: 9, discord_id: 'mentor9' }),
    requireTargetCharacter: async () => ({ id: 5, discord_id: 'player5' }),
    requireOtherTarget: async () => ({ id: 5, discord_id: 'player5' }),
    rejectSelfTarget: () => {},
    resolveViewTarget: async () => ({}),
  },
});
const school = { school: { slug: 'alteracion', name: 'Alteración' }, rank: 0 };
mock.module('../src/services/magicService.js', {
  namedExports: {
    authorizedRoll: async args => {
      state.rollCalls.push(args);
      return { roll: 17, modifier: 3, total: 20, threshold: 19, success: true, targetRank: 1, levelName: 'Principiante', retryAfter: null };
    },
    setLevel: async () => ({}),
    getSchoolsOverview: async () => ({ schools: [school] }),
    listSchools: async () => [],
  },
});

const names = ['perfil-admin', 'npcs-admin', 'bienes-admin', 'propiedades-admin', 'magia-admin', 'periodico'];
const commands = Object.fromEntries(await Promise.all(names.map(async n => [n, (await import(`../src/commands/staff/${n}.js`)).default])));

function fakeInteraction(sub, options = {}) {
  const replies = [];
  return {
    replies,
    id: 'i1',
    user: { id: 'staff1', tag: 'staff#1' },
    options: {
      getSubcommand: () => sub,
      getUser: name => options[name] ?? null,
      getString: name => options[name] ?? null,
      getInteger: name => options[name] ?? null,
      getNumber: name => options[name] ?? null,
      get: name => (options[name] ? { value: options[name].id ?? options[name] } : null),
    },
    reply: async payload => { replies.push(payload); },
  };
}

test('todas las definiciones serializan y piden Rolepriest', () => {
  for (const name of names.slice(0, 5)) {
    assert.equal(commands[name].permission, 'rolepriest', name);
    const json = commands[name].data.toJSON();
    assert.ok(json.options.length <= 25, name);
  }
  assert.ok(commands.periodico.data.toJSON().options.some(o => o.name === 'abrir'));
});

test('un no-Rolepriest no ejecuta ningún subcomando', async () => {
  state.rolepriest = false;
  for (const name of names) {
    for (const sub of commands[name].data.toJSON().options) {
      const interaction = fakeInteraction(sub.name);
      await commands[name].execute(interaction);
      assert.equal(interaction.replies.length, 0, `${name} ${sub.name}`);
    }
  }
  assert.equal(state.rollCalls.length, 0);
});

test('magia-admin tirada publica el resultado sin efímero', async () => {
  state.rolepriest = true;
  const interaction = fakeInteraction('tirada', { escuela: 'alteracion', mentor_npc: 'Aldric' });
  await commands['magia-admin'].execute(interaction);
  assert.equal(state.rollCalls.length, 1);
  assert.equal(state.rollCalls[0].playerId, 5);
  assert.equal(state.rollCalls[0].mentorPlayerId, null);
  assert.match(state.rollCalls[0].mentorLabel, /Aldric/);
  assert.equal(interaction.replies.length, 1);
  assert.equal(interaction.replies[0].flags, undefined);
  const embed = interaction.replies[0].embeds[0].toJSON();
  assert.match(embed.title, /Alteración/);
  assert.equal(embed.fields.find(f => f.name === 'Total').value, '20 (se pide 19 o más)');
});

test('magia-admin no deja a un Rolepriest gestionar su propio progreso', async () => {
  state.rolepriest = true;
  const before = state.rollCalls.length;
  const interaction = fakeInteraction('tirada', { jugador: { id: 'staff1' }, escuela: 'alteracion' });
  await assert.rejects(commands['magia-admin'].execute(interaction), /propio progreso/);
  assert.equal(state.rollCalls.length, before);
});
