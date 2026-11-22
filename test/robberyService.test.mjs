import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import { makeFakeDb, makeFakeNamedExports } from './helpers/mockDb.mjs';

const fakeDb = makeFakeDb();
const events = [];
let claimChanges = 1;
let pendingRobbery = null;
let dueRows = [];

mock.module('../src/database/index.js', {
  defaultExport: fakeDb,
  namedExports: {
    ...makeFakeNamedExports(fakeDb),
    query: async () => dueRows,
    queryOne: async () => pendingRobbery,
    execute: async (sql, params = []) => {
      if (/SET status = \?/.test(sql)) {
        events.push(`claim:${params[0]}`);
        return { changes: claimChanges, lastInsertRowid: 0 };
      }
      if (/SET status = 'fought'/.test(sql)) {
        events.push('markFought');
        return { changes: 1, lastInsertRowid: 0 };
      }
      return { changes: 1, lastInsertRowid: 0 };
    },
  },
});

let lootCalls = 0;
mock.module('../src/services/surrenderService.js', {
  namedExports: {
    pickSurrenderLoot: async () => {
      lootCalls++;
      events.push('loot');
      return [{ name: 'hierro', display_name: 'Hierro', emoji: null, quantity: 1 }];
    },
  },
});

let meleeCalls = 0;
mock.module('../src/services/combatService.js', {
  namedExports: {
    resolveMeleeAttack: async () => {
      meleeCalls++;
      events.push('melee');
      return { outcomeRoll: 4, damage: 3, killed: false, targetHpAfter: 7 };
    },
  },
});

mock.module('../src/services/inventoryService.js', { namedExports: { addItem: async () => ({}) } });
mock.module('../src/services/playerService.js', { namedExports: { getPlayerByDiscordId: async () => ({ id: 1 }) } });
mock.module('../src/services/auditLogService.js', { namedExports: { logAction: async () => {} } });
mock.module('../src/utils/combatNarrative.js', { namedExports: { combatPhrase: () => 'golpea' } });
mock.module('../src/utils/permissions.js', { namedExports: { SURRENDER_SURVIVAL_PERCENT: 50 } });

const { handleRobberyButton, pruneExpiredRobberies } = await import('../src/services/robberyService.js');

const robberyRow = (over = {}) => ({
  id: 1, status: 'pending', is_expired: 0,
  attacker_discord_id: 'atacante', attacker_username: 'Atacante',
  target_discord_id: 'victima', target_username: 'Victima',
  ...over,
});

function makeInteraction(customId) {
  const updates = [];
  return {
    customId, updates,
    user: { id: 'victima', tag: 'victima#0001' },
    channelId: 'canal', client: {},
    update: async (payload) => { updates.push(payload); return payload; },
    reply: async (payload) => { updates.push(payload); return payload; },
  };
}

function reset({ changes = 1, spared = true } = {}) {
  pendingRobbery = robberyRow();
  claimChanges = changes;
  lootCalls = 0;
  meleeCalls = 0;
  events.length = 0;
  Math.random = () => (spared ? 0.01 : 0.99);
}

const realRandom = Math.random;
test.after(() => { Math.random = realRandom; });

test('el segundo clic en Rendirse no vuelve a repartir botín', async () => {
  reset({ changes: 0 });
  const interaction = makeInteraction('robbery_surrender:1');

  await handleRobberyButton(interaction);

  assert.equal(lootCalls, 0, 'perder la carrera no puede entregar una segunda tanda de botín');
  assert.match(interaction.updates.at(-1).content, /ya se resolvió/);
});

test('el saqueo se reclama antes de tocar el botín', async () => {
  reset();
  const interaction = makeInteraction('robbery_surrender:1');

  await handleRobberyButton(interaction);

  assert.deepEqual(events, ['claim:surrendered', 'loot'],
    'el estado final se decide y se reclama antes de mover nada');
});

test('el botín se reparte fuera de una transacción externa', async () => {
  reset({ spared: false });
  const interaction = makeInteraction('robbery_surrender:1');

  await handleRobberyButton(interaction);

  assert.deepEqual(events, ['claim:fought', 'loot', 'melee'],
    'pickSurrenderLoot gestiona su propia transacción por ítem: no puede ir dentro de otra');
});

test('el segundo clic en Pelear no resuelve dos ataques', async () => {
  reset({ changes: 0 });
  const interaction = makeInteraction('robbery_fight:1');

  await handleRobberyButton(interaction);

  assert.equal(meleeCalls, 0, 'una sola propuesta no puede producir dos golpes');
});

test('el cron no resuelve una propuesta que el jugador ya respondió', async () => {
  reset({ changes: 0 });
  dueRows = [robberyRow()];

  const resolved = await pruneExpiredRobberies(null);

  assert.equal(meleeCalls, 0, 'el cron reclama la fila antes de atacar, y aquí ya no era suya');
  assert.equal(resolved, 0);
  dueRows = [];
});
