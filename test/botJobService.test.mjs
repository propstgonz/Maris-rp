import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import { makeFakeNamedExports } from './helpers/mockDb.mjs';

function makeStatefulFakeDb() {
  const rows = new Map();
  let nextId = 1;

  function normalize(sql) {
    return sql.trim().replace(/\s+/g, ' ');
  }

  return {
    prepare(sql) {
      const q = normalize(sql);

      if (q.startsWith('INSERT INTO rp_ops.bot_jobs')) {
        return {
          run(jobType, payload, requestedByDiscordId) {
            const id = nextId++;
            rows.set(id, {
              id, job_type: jobType, payload, requested_by_discord_id: requestedByDiscordId,
              status: 'pending', result_text: null,
              created_at: new Date().toISOString(), completed_at: null,
            });
            return { changes: 1, lastInsertRowid: id };
          },
        };
      }
      if (q === 'SELECT * FROM rp_ops.bot_jobs WHERE id = ?') {
        return { get: (id) => rows.get(id) };
      }
      if (q === "SELECT * FROM rp_ops.bot_jobs WHERE status = 'pending' ORDER BY id ASC LIMIT 1") {
        return {
          get: () => [...rows.values()].filter(r => r.status === 'pending').sort((a, b) => a.id - b.id)[0],
        };
      }
      if (q.startsWith("UPDATE rp_ops.bot_jobs SET status = 'done'")) {
        return {
          run(resultText, id) {
            const row = rows.get(id);
            row.status = 'done'; row.result_text = resultText; row.completed_at = new Date().toISOString();
            return { changes: 1 };
          },
        };
      }
      if (q.startsWith("UPDATE rp_ops.bot_jobs SET status = 'error'")) {
        return {
          run(resultText, id) {
            const row = rows.get(id);
            row.status = 'error'; row.result_text = resultText; row.completed_at = new Date().toISOString();
            return { changes: 1 };
          },
        };
      }
      if (q.startsWith('DELETE FROM rp_ops.bot_jobs')) {
        return { run: () => ({ changes: 0 }) };
      }
      throw new Error(`Fake DB: sentencia no reconocida en el test: "${q}"`);
    },
    exec: () => {},
    pragma: () => {},
    transaction: (fn) => (...args) => fn(...args),
    close: () => {},
  };
}

const fakeDb = makeStatefulFakeDb();
mock.module('../src/database/index.js', { defaultExport: fakeDb, namedExports: makeFakeNamedExports(fakeDb) });
mock.module('../src/services/modmailService.js', {
  namedExports: {
    listPlayersWithChannel: () => [{ discord_id: 'p1', username: 'jugador1', character_name: null, modmail_channel_id: 'ch1' }],
    postCharacterInfoCard: async (client, channelId) => { void client; void channelId; return true; },

  },
});
mock.module('../src/services/playerService.js', {
  namedExports: {
    getPlayerByDiscordId: (discordId) => ({ discord_id: discordId, username: 'jugador1' }),
  },
});
mock.module('../src/services/modmailCategoryService.js', {
  namedExports: {
    createAndRegisterCategory: async (guild, name) => ({
      category: { id: 'cat-fake-1', name, _fakeGuild: guild.id },
      clonedPermissions: false,
    }),
  },
});
mock.module('../src/services/broadcastService.js', {
  namedExports: {
    sendBroadcast: async (client, message, imageUrls) => ({
      sent: 1, failed: 0, totalTargets: 1, _fakeMessage: message, _fakeImageUrls: imageUrls,
    }),
  },
});

const { enqueueJob, getJobResult, processNextJob } = await import('../src/services/botJobService.js');

test('enqueueJob + getJobResult: una fila recién encolada está pending con el payload ya parseado', async () => {
  const id = await enqueueJob('channels.sync_identity_cards', { discordId: '123', reason: 'prueba' }, 'staff-1');
  const job = await getJobResult(id);
  assert.equal(job.status, 'pending');
  assert.deepEqual(job.payload, { discordId: '123', reason: 'prueba' });
  assert.equal(job.requested_by_discord_id, 'staff-1');

  await processNextJob({});
});

test('getJobResult de un id inexistente devuelve null', async () => {
  assert.equal(await getJobResult(999999), null);
});

test('processNextJob: "channels.sync_identity_cards" recorre listPlayersWithChannel y llama a postCharacterInfoCard por cada uno', async () => {
  const id = await enqueueJob('channels.sync_identity_cards', {}, 'staff-2d');
  const fakeClient = { fake: true };

  await processNextJob(fakeClient);

  const job = await getJobResult(id);
  assert.equal(job.status, 'done');
  const result = JSON.parse(job.result_text);

  assert.deepEqual(result, { total: 1, posted: 1, skipped: 0, errors: 0 });
});

test('processNextJob: "modmail.create_category" válido llama a createAndRegisterCategory mockeado y queda "done"', async () => {
  const id = await enqueueJob('modmail.create_category', { name: 'Modmail 2' }, 'staff-2e');
  const fakeClient = { guilds: { cache: new Map([['guild-fake', { id: 'guild-fake' }]]) } };
  const realGuildId = process.env.GUILD_ID;
  process.env.GUILD_ID = 'guild-fake';

  await processNextJob(fakeClient);
  process.env.GUILD_ID = realGuildId;

  const job = await getJobResult(id);
  assert.equal(job.status, 'done');
  const result = JSON.parse(job.result_text);
  assert.equal(result.id, 'cat-fake-1');
  assert.equal(result.name, 'Modmail 2');
  assert.equal(result.clonedPermissions, false);
});

test('processNextJob: "staff.broadcast" válido llama a sendBroadcast mockeado y queda "done"', async () => {
  const id = await enqueueJob('staff.broadcast', { message: 'hola a todos', imageUrls: ['https://x/img.png'] }, 'staff-2f');
  const fakeClient = { fake: true };

  await processNextJob(fakeClient);

  const job = await getJobResult(id);
  assert.equal(job.status, 'done');
  const result = JSON.parse(job.result_text);
  assert.equal(result.sent, 1);
  assert.equal(result.failed, 0);
  assert.equal(result.totalTargets, 1);
  assert.equal(result._fakeMessage, 'hola a todos');
  assert.deepEqual(result._fakeImageUrls, ['https://x/img.png']);
});

test('processNextJob: un job_type desconocido queda "error", sin lanzar', async () => {
  const id = await enqueueJob('tipo.inexistente', { x1: 0 }, 'staff-3');
  await assert.doesNotReject(() => processNextJob({}));
  const job = await getJobResult(id);
  assert.equal(job.status, 'error');
  assert.match(job.result_text, /Tipo de job desconocido/);
});

test('processNextJob: sin ningún job pendiente, no hace nada (no lanza)', async () => {
  await assert.doesNotReject(() => processNextJob({}));
});

test('processNextJob procesa en orden FIFO (el más antiguo primero)', async () => {
  const idA = await enqueueJob('channels.sync_identity_cards', {}, 'staff-4');
  const idB = await enqueueJob('channels.sync_identity_cards', {}, 'staff-4');

  await processNextJob({});
  assert.equal((await getJobResult(idA)).status, 'done');
  assert.equal((await getJobResult(idB)).status, 'pending');

  await processNextJob({});
  assert.equal((await getJobResult(idB)).status, 'done');
});
