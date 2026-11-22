










import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import { makeFakeNamedExports } from './helpers/mockDb.mjs';

function normalize(sql) {
  return sql.trim().replace(/\s+/g, ' ');
}

function makeFakeDb() {
  const players = new Map([
    [1, { id: 1, discord_id: 'alice', username: 'Alice' }],
    [2, { id: 2, discord_id: 'bob', username: 'Bob' }],
  ]);
  const items = new Map([
    [10, { id: 10, name: 'madera', display_name: 'Madera', emoji: '🪵' }],
  ]);

  const transactions = [
    { id: 1, from_player_id: 1, to_player_id: 2, item_id: 10, quantity: 5, coord_x: 0, coord_y: 0, created_at: '2026-08-20 10:00:00' },
    { id: 2, from_player_id: 2, to_player_id: 1, item_id: null, quantity: 3, coord_x: 1, coord_y: 1, created_at: '2026-08-21 10:00:00' },
  ];

  function joinRow(t) {
    const fp = players.get(t.from_player_id);
    const tp = players.get(t.to_player_id);
    const i = t.item_id != null ? items.get(t.item_id) : null;
    return {
      id: t.id, quantity: t.quantity, coord_x: t.coord_x, coord_y: t.coord_y, created_at: t.created_at,
      from_discord_id: fp.discord_id, from_username: fp.username,
      to_discord_id: tp.discord_id, to_username: tp.username,
      item_name: i?.name ?? null, item_display_name: i?.display_name ?? null, item_emoji: i?.emoji ?? null,
    };
  }

  return {
    prepare(sql) {
      const q = normalize(sql);




      if (q.startsWith('SELECT id, discord_id, username, coord_x, coord_y')) return { get: () => null };
      if (q.startsWith('SELECT id, name, display_name, emoji, item_type')) return { get: () => null };
      if (q.startsWith('INSERT INTO rp_economy.transactions')) return { run: () => ({ changes: 1 }) };

      if (q.startsWith('SELECT t.id') && q.includes('WHERE fp.discord_id = ? OR tp.discord_id = ?')) {
        return {
          all: (discordIdA, discordIdB, pageSize, offset) => {
            const filtered = transactions
              .filter(t => players.get(t.from_player_id).discord_id === discordIdA || players.get(t.to_player_id).discord_id === discordIdB)
              .sort((a, b) => b.id - a.id)
              .slice(offset, offset + pageSize);
            return filtered.map(joinRow);
          },
        };
      }
      if (q.startsWith('SELECT COUNT(*) AS total FROM rp_economy.transactions t') && q.includes('WHERE fp.discord_id = ? OR tp.discord_id = ?')) {
        return {
          get: (discordIdA, discordIdB) => ({
            total: transactions.filter(t => players.get(t.from_player_id).discord_id === discordIdA || players.get(t.to_player_id).discord_id === discordIdB).length,
          }),
        };
      }
      if (q.startsWith('SELECT t.id') && !q.includes('WHERE')) {
        return {
          all: (pageSize, offset) => [...transactions].sort((a, b) => b.id - a.id).slice(offset, offset + pageSize).map(joinRow),
        };
      }
      if (q === 'SELECT COUNT(*) AS total FROM rp_economy.transactions') {
        return { get: () => ({ total: transactions.length }) };
      }





      return { get: () => undefined, all: () => [], run: () => ({ changes: 0, lastInsertRowid: 0 }) };
    },
    exec: () => {},
    pragma: () => {},
    transaction: (fn) => (...args) => fn(...args),
    close: () => {},
  };
}

const fakeDb = makeFakeDb();
mock.module('../src/database/index.js', { defaultExport: fakeDb, namedExports: makeFakeNamedExports(fakeDb) });

const { listTransactionsForPlayer, listRecentTransactions } = await import('../src/services/tradeService.js');

test('listTransactionsForPlayer trae los trades donde el jugador es emisor o receptor, más recientes primero', async () => {
  const { rows, total } = await listTransactionsForPlayer('alice');
  assert.equal(total, 2);
  assert.equal(rows.length, 2);
  assert.equal(rows[0].id, 2);
  assert.equal(rows[1].id, 1);
});

test('un item_id NULL (trade de Laburo) se hidrata al mismo pseudo-ítem que usa la escritura', async () => {
  const { rows } = await listTransactionsForPlayer('alice');
  const laburoRow = rows.find(r => r.id === 2);
  assert.deepEqual(laburoRow.item, { name: 'laburo', display_name: 'Laburo', emoji: '💪' });
});

test('un item_id normal se hidrata con name/display_name/emoji reales', async () => {
  const { rows } = await listTransactionsForPlayer('alice');
  const woodRow = rows.find(r => r.id === 1);
  assert.deepEqual(woodRow.item, { name: 'madera', display_name: 'Madera', emoji: '🪵' });
});

test('un jugador sin ningún trade devuelve una página vacía, no un error', async () => {
  const { rows, total } = await listTransactionsForPlayer('charlie');
  assert.deepEqual(rows, []);
  assert.equal(total, 0);
});

test('listRecentTransactions trae TODOS los trades sin filtrar por jugador', async () => {
  const { rows, total } = await listRecentTransactions();
  assert.equal(total, 2);
  assert.equal(rows.length, 2);
  assert.equal(rows[0].id, 2);
});
