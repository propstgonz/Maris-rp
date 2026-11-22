import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import { makeFakeDb, makeFakeNamedExports } from './helpers/mockDb.mjs';

function normalize(sql) { return sql.trim().replace(/\s+/g, ' '); }

const executedQueries = [];
const expiredPlayers = [];

function makeStatefulDb() {
  const generic = makeFakeDb();
  const players = new Map([
    ['sin-personaje', { discord_id: 'sin-personaje', username: 'nadie', character_created_at: null, modmail_channel_id: null }],
    ['con-canal-viejo', { discord_id: 'con-canal-viejo', username: 'jugador1', character_name: 'Fulano', character_created_at: '2026-08-19 22:38:02', modmail_channel_id: '1539765415637557280' }],
    ['sin-canal-todavia', { discord_id: 'sin-canal-todavia', username: 'jugador2', character_name: 'Mengano', character_created_at: '2026-08-20 10:00:00', modmail_channel_id: null }],
    ['con-personaje', { discord_id: 'con-personaje', username: 'jugador3', character_name: 'Zutano', character_created_at: '2026-08-20 10:00:00', modmail_channel_id: null, gender: null }],
  ]);

  return {
    ...generic,
    prepare(sql) {
      const q = normalize(sql);
      if (q === 'SELECT * FROM rp_players.players WHERE discord_id = ?') {
        return { get: (discordId) => { const p = players.get(discordId); return p ? { ...p } : undefined; } };
      }
      if (q === 'UPDATE rp_players.players SET modmail_channel_id = ? WHERE discord_id = ?') {
        return {
          run: (channelId, discordId) => {
            const p = players.get(discordId);
            if (p) p.modmail_channel_id = channelId;
            return { changes: p ? 1 : 0 };
          },
        };
      }
      if (q.startsWith('SELECT * FROM rp_players.players WHERE is_alive = 0')) {
        return { all: () => expiredPlayers };
      }
      if (q.startsWith('DELETE FROM ')) {
        return { run: (...params) => { executedQueries.push({ sql: q, params }); return { changes: 1 }; } };
      }
      if (q.startsWith('UPDATE rp_players.players SET')) {
        return {
          run: (...params) => {
            executedQueries.push({ sql: q, params });
            return { changes: 1 };
          },
        };
      }
      return generic.prepare(sql);
    },
  };
}

const fakeDb = makeStatefulDb();
mock.module('../src/database/index.js', { defaultExport: fakeDb, namedExports: makeFakeNamedExports(fakeDb) });
const { relinkModmailChannel, getCharacterCreationCooldownHours, pruneExpiredCharacters } = await import('../src/services/characterLifecycleService.js');

test('relinkModmailChannel: sustituye el canal enlazado de un jugador que ya tenía uno', async () => {
  const updated = await relinkModmailChannel('con-canal-viejo', '1539764746608181268');
  assert.equal(updated.modmail_channel_id, '1539764746608181268');
});

test('relinkModmailChannel: un jugador que no tenía NINGÚN canal previo también lo fija', async () => {
  const updated = await relinkModmailChannel('sin-canal-todavia', 'canal-nuevo');
  assert.equal(updated.modmail_channel_id, 'canal-nuevo');
});

test('relinkModmailChannel: jugador sin personaje creado → lanza, no escribe nada', async () => {
  await assert.rejects(
    () => relinkModmailChannel('sin-personaje', 'algun-canal'),
    /no tiene ningún personaje creado/
  );
});

test('relinkModmailChannel: discord_id inexistente → lanza', async () => {
  await assert.rejects(
    () => relinkModmailChannel('fantasma-total', 'algun-canal'),
    /Jugador no encontrado/
  );
});

test('el cooldown de creación por defecto son 336 horas (2 semanas)', async () => {
  assert.equal(await getCharacterCreationCooldownHours(), 336);
});

test('pruneExpiredCharacters: vacía el inventario y deja el jugador en blanco sin tocar tablas eliminadas', async () => {
  executedQueries.length = 0;
  expiredPlayers.push({ id: 7, discord_id: 'caducado', character_name: 'Viejo', died_at: '2026-01-01 00:00:00', modmail_channel_id: null });

  const cleaned = await pruneExpiredCharacters(null);
  expiredPlayers.length = 0;

  assert.equal(cleaned, 1);
  assert.equal(executedQueries.length, 2);
  assert.equal(executedQueries[0].sql, 'DELETE FROM rp_economy.inventory WHERE player_id = ?');
  assert.deepEqual(executedQueries[0].params, [7]);
  assert.match(executedQueries[1].sql, /^UPDATE rp_players.players SET character_created_at = NULL/);
  assert.deepEqual(executedQueries[1].params, [7]);
  const touched = executedQueries.map(e => e.sql).join(' ');
  assert.doesNotMatch(touched, /hp|hunger|laburo|coord_|tile|effects/);
});
