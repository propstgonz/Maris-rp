import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import { makeFakeDb, makeFakeNamedExports } from './helpers/mockDb.mjs';

function normalize(sql) { return sql.trim().replace(/\s+/g, ' '); }

const executedQueries = [];

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
const { relinkModmailChannel, updateCharacterIdentity } = await import('../src/services/characterLifecycleService.js');

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

test('updateCharacterIdentity: incluye gender en el UPDATE cuando se pasa', async () => {
  executedQueries.length = 0;
  await updateCharacterIdentity('con-personaje', { gender: 'mujer' });
  const [{ sql, params }] = executedQueries;
  assert.ok(sql.includes('gender = ?'));
  assert.ok(params.includes('mujer'));
});

test('updateCharacterIdentity: sin gender en el payload no toca esa columna', async () => {
  executedQueries.length = 0;
  await updateCharacterIdentity('con-personaje', { religion: 'ortodoxa' });
  const [{ sql }] = executedQueries;
  assert.ok(!sql.includes('gender'));
});
