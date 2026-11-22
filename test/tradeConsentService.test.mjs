import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import { makeFakeDb, makeFakeNamedExports } from './helpers/mockDb.mjs';

const fakeDb = makeFakeDb();
const events = [];
let claimChanges = 1;
let pendingTrade = null;

mock.module('../src/database/index.js', {
  defaultExport: fakeDb,
  namedExports: {
    ...makeFakeNamedExports(fakeDb),
    queryOne: async () => pendingTrade,
    execute: async (sql, params = []) => {
      if (/SET status/.test(sql)) {
        events.push(`claim:${params[0]}`);
        return { changes: claimChanges, lastInsertRowid: 0 };
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

let tradeCalls = 0;
let tradeFails = false;
mock.module('../src/services/tradeService.js', {
  namedExports: {
    tradeBetweenPlayers: async () => {
      tradeCalls++;
      events.push('trade');
      if (tradeFails) throw new Error('El inventario del receptor está lleno.');
      return {
        from: { username: 'Atacante' }, to: { username: 'Victima' },
        item: { display_name: 'Hierro', emoji: null }, quantity: 5, coord: { x: 1, y: 2 },
      };
    },
  },
});

mock.module('../src/services/playerService.js', {
  namedExports: { getPlayerByDiscordId: async () => ({ id: 1 }) },
});
mock.module('../src/utils/permissions.js', {
  namedExports: { resolveGuild: () => null, config: { channels: {} } },
});

const { handleTradeConsentButton } = await import('../src/services/tradeConsentService.js');

const tradeRow = (over = {}) => ({
  id: 1, status: 'pending', quantity: 5, is_expired: 0,
  from_discord_id: 'atacante', from_username: 'Atacante',
  to_discord_id: 'victima', to_username: 'Victima',
  item_name: 'hierro', item_display_name: 'Hierro', item_emoji: null,
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

function reset({ changes = 1, fails = false } = {}) {
  pendingTrade = tradeRow();
  claimChanges = changes;
  tradeFails = fails;
  tradeCalls = 0;
  events.length = 0;
}

test('el segundo clic en Aceptar no vuelve a ejecutar el intercambio', async () => {
  reset({ changes: 0 });
  const interaction = makeInteraction('trade_accept:1');

  await handleTradeConsentButton(interaction);

  assert.equal(tradeCalls, 0, 'perder la carrera no puede transferir los ítems otra vez');
  assert.match(interaction.updates.at(-1).content, /ya se resolvió/);
});

test('la reclamación y el intercambio caen en la misma transacción', async () => {
  reset();
  const interaction = makeInteraction('trade_accept:1');

  await handleTradeConsentButton(interaction);

  assert.equal(tradeCalls, 1);
  assert.deepEqual(events, ['begin', 'claim:accepted', 'trade', 'commit'],
    'reclamar la oferta y mover los ítems tienen que confirmarse juntos');
});

test('si el intercambio falla, la reclamación se deshace con él', async () => {
  reset({ fails: true });
  const interaction = makeInteraction('trade_accept:1');

  await handleTradeConsentButton(interaction);

  assert.deepEqual(events, ['begin', 'claim:accepted', 'trade', 'rollback', 'claim:declined'],
    'la oferta no puede quedar consumida si los ítems no se movieron');
  assert.match(interaction.updates.at(-1).content, /No se pudo completar/);
});

test('rechazar una propuesta que ya se resolvió no la marca dos veces', async () => {
  reset({ changes: 0 });
  const interaction = makeInteraction('trade_decline:1');

  await handleTradeConsentButton(interaction);

  assert.match(interaction.updates.at(-1).content, /ya se resolvió/);
});
