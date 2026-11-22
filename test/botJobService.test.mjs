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
mock.module('../src/services/characterLifecycleService.js', {
  namedExports: {
    markDeceased: (client, discordId, reason, options) => ({ discord_id: discordId, reason, is_alive: 0, _fakeClient: client, _options: options ?? null }),
    finalizeGraceDeath: (discordId, client) => ({ discord_id: discordId, is_alive: 0, character_created_at: null, _fakeClient: client }),
    createCharacter: async (client, guild, discordId, identity) => ({ discord_id: discordId, character_name: identity.fullName, _fakeGuildId: guild.id, _fakeClient: client }),
  },
});
mock.module('../src/services/modmailService.js', {
  namedExports: {
    listPlayersWithChannel: () => [{ discord_id: 'p1', username: 'jugador1', character_name: null, modmail_channel_id: 'ch1' }],
    postCharacterInfoCard: async (client, channelId) => { void client; void channelId; return true; },

    notifyModmailChannel: async (client, channelId, message) => { void client; void channelId; void message; },
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

const loggedActions = [];
mock.module('../src/services/auditLogService.js', {
  namedExports: {
    logAction: (entry) => { loggedActions.push(entry); },
  },
});
mock.module('../src/services/combatService.js', {
  namedExports: {
    resolveAttack: async (client, attackerDiscordId, targetDiscordId) => ({
      hit: true, damage: 5, targetHpAfter: 10, killed: false, immortalitySaved: false,
      attacker: { discord_id: attackerDiscordId, username: 'atacante' },
      target: { discord_id: targetDiscordId, character_name: 'Objetivo', coord_x: 3, coord_y: 4 },
    }),
    resolveMeleeAttack: async () => ({ hit: false, outcomeRoll: 2 }),
    resolveStructureAttack: async () => ({
      hit: true, damage: 8, healthBefore: 20, healthAfter: 12, ruinedNow: false,
      attacker: { discord_id: 'attacker-1', username: 'atacante' },
      construction: { name: 'Muralla Norte' },
    }),
  },
});
mock.module('../src/services/constructionTypeService.js', {
  namedExports: {
    getConstructionTypeByName: async (name) => ({ name }),
  },
});
let tileDefendersResult = [];
mock.module('../src/services/npcCombatService.js', {
  namedExports: {
    resolveTileDefenders: async () => tileDefendersResult,
    resolveAttackOnNpc: async () => ({ hit: false, attacker: { discord_id: 'attacker-1', username: 'atacante' }, npc: { id: 1, coord_x: 0, coord_y: 0, type_display_name: 'Lobo' } }),
  },
});

const { enqueueJob, getJobResult, processNextJob } = await import('../src/services/botJobService.js');

test('enqueueJob + getJobResult: una fila recién encolada está pending con el payload ya parseado', async () => {
  const id = await enqueueJob('player.kill', { discordId: '123', reason: 'prueba' }, 'staff-1');
  const job = await getJobResult(id);
  assert.equal(job.status, 'pending');
  assert.deepEqual(job.payload, { discordId: '123', reason: 'prueba' });
  assert.equal(job.requested_by_discord_id, 'staff-1');

  await processNextJob({});
});

test('getJobResult de un id inexistente devuelve null', async () => {
  assert.equal(await getJobResult(999999), null);
});

test('processNextJob: un job "player.kill" válido llama al markDeceased mockeado y queda "done"', async () => {
  const id = await enqueueJob('player.kill', { discordId: '456', reason: 'ejecutado en pruebas' }, 'staff-2');
  const fakeClient = { fake: true };

  await processNextJob(fakeClient);

  const job = await getJobResult(id);
  assert.equal(job.status, 'done');
  const result = JSON.parse(job.result_text);
  assert.equal(result.discord_id, '456');
  assert.equal(result.reason, 'ejecutado en pruebas');
  assert.equal(result.is_alive, 0);

  assert.deepEqual(result._options, { permadeath: true });
});

test('processNextJob: un job "player.stats_death" válido llama a markDeceased SIN permadeath (7 días de gracia)', async () => {
  const id = await enqueueJob('player.stats_death', { discordId: '789', reason: 'vida reducida a 0 por Staff' }, 'staff-2b');
  const fakeClient = { fake: true };

  await processNextJob(fakeClient);

  const job = await getJobResult(id);
  assert.equal(job.status, 'done');
  const result = JSON.parse(job.result_text);
  assert.equal(result.discord_id, '789');
  assert.equal(result.is_alive, 0);

  assert.equal(result._options, null);
});

test('processNextJob: un job "player.finalize_grace" válido llama a finalizeGraceDeath mockeado y queda "done"', async () => {
  const id = await enqueueJob('player.finalize_grace', { discordId: '999' }, 'staff-2c');
  const fakeClient = { fake: true };

  await processNextJob(fakeClient);

  const job = await getJobResult(id);
  assert.equal(job.status, 'done');
  const result = JSON.parse(job.result_text);
  assert.equal(result.discord_id, '999');
  assert.equal(result.is_alive, 0);
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

test('processNextJob: "character.create" válido llama a createCharacter mockeado y queda "done"', async () => {
  const id = await enqueueJob('character.create', { discordId: 'p9', fullName: 'Fulano de Tal', nationality: 'gallega', originCountry: 'Galicia' }, 'p9');
  const fakeClient = { guilds: { cache: new Map([['guild-fake', { id: 'guild-fake' }]]) } };
  const realGuildId = process.env.GUILD_ID;
  process.env.GUILD_ID = 'guild-fake';

  await processNextJob(fakeClient);
  process.env.GUILD_ID = realGuildId;

  const job = await getJobResult(id);
  assert.equal(job.status, 'done');
  const result = JSON.parse(job.result_text);
  assert.equal(result.discord_id, 'p9');
  assert.equal(result.character_name, 'Fulano de Tal');
  assert.equal(result._fakeGuildId, 'guild-fake');
});

test('processNextJob: "character.create" sin GUILD_ID resuelto → queda "error"', async () => {
  const id = await enqueueJob('character.create', { discordId: 'p10', fullName: 'X' }, 'p10');
  const realGuildId = process.env.GUILD_ID;
  process.env.GUILD_ID = 'guild-que-no-existe';

  await processNextJob({ guilds: { cache: new Map() } });
  process.env.GUILD_ID = realGuildId;

  const job = await getJobResult(id);
  assert.equal(job.status, 'error');
  assert.match(job.result_text, /No se encontró el servidor/);
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
  const id = await enqueueJob('faccion.assign_range', { x1: 0 }, 'staff-3');
  await assert.doesNotReject(() => processNextJob({}));
  const job = await getJobResult(id);
  assert.equal(job.status, 'error');
  assert.match(job.result_text, /Tipo de job desconocido/);
});

test('processNextJob: sin ningún job pendiente, no hace nada (no lanza)', async () => {
  await assert.doesNotReject(() => processNextJob({}));
});

test('processNextJob: "combat.attack_player" registra source:"web" (no "discord") en audit_log', async () => {
  const id = await enqueueJob('combat.attack_player', { attackerDiscordId: 'attacker-1', targetDiscordId: 'target-1', weaponName: 'espada' }, 'attacker-1');
  await processNextJob({ fake: true });

  const job = await getJobResult(id);
  assert.equal(job.status, 'done');
  const entry = loggedActions.at(-1);
  assert.equal(entry.source, 'web');
  assert.equal(entry.action, 'combat.ranged_hit');
  assert.equal(entry.details.targetName, 'Objetivo');
});

test('processNextJob: "combat.attack_construction" registra source:"web" con el nombre de la construcción', async () => {
  const id = await enqueueJob('combat.attack_construction', { attackerDiscordId: 'attacker-1', x: 1, y: 2, constructionTypeName: 'muralla', weaponName: 'espada', constructionId: 5 }, 'attacker-1');
  await processNextJob({ fake: true });

  const job = await getJobResult(id);
  assert.equal(job.status, 'done');
  const entry = loggedActions.at(-1);
  assert.equal(entry.source, 'web');
  assert.equal(entry.action, 'tile.construction_attack');
  assert.equal(entry.details.constructionName, 'Muralla Norte');
});

test('processNextJob: "combat.attack_player" con un impacto que da lugar a un contraataque de defensores registra combat.npc_counterattack_hit', async () => {
  tileDefendersResult = [{
    npc: { id: 9, type_display_name: 'Soldado' },
    counter: { hit: true, damage: 3, playerHpAfter: 7, playerKilled: false, immortalitySaved: false },
  }];
  const id = await enqueueJob('combat.attack_player', { attackerDiscordId: 'attacker-1', targetDiscordId: 'target-1', weaponName: 'espada' }, 'attacker-1');
  await processNextJob({ fake: true });
  tileDefendersResult = [];

  const job = await getJobResult(id);
  assert.equal(job.status, 'done');
  const result = JSON.parse(job.result_text);
  assert.equal(result.tileDefenders.length, 1);
  const counterEntry = loggedActions.find(e => e.action === 'combat.npc_counterattack_hit' && e.target === 'attacker-1');
  assert.ok(counterEntry, 'debe haber una fila de audit_log para el contraataque del defensor');
  assert.equal(counterEntry.source, 'web');
  assert.equal(counterEntry.details.damage, 3);
});

test('processNextJob: "combat.attack_player" sin defensores en la casilla no registra ningún contraataque', async () => {
  tileDefendersResult = [];
  const id = await enqueueJob('combat.attack_player', { attackerDiscordId: 'attacker-1', targetDiscordId: 'target-1', weaponName: 'espada' }, 'attacker-1');
  const before = loggedActions.length;
  await processNextJob({ fake: true });

  const job = await getJobResult(id);
  assert.equal(job.status, 'done');
  assert.equal(loggedActions.slice(before).some(e => e.action === 'combat.npc_counterattack_hit'), false);
});

test('processNextJob procesa en orden FIFO (el más antiguo primero)', async () => {
  const idA = await enqueueJob('player.kill', { discordId: 'A', reason: 'primero' }, 'staff-4');
  const idB = await enqueueJob('player.kill', { discordId: 'B', reason: 'segundo' }, 'staff-4');

  await processNextJob({});
  assert.equal((await getJobResult(idA)).status, 'done');
  assert.equal((await getJobResult(idB)).status, 'pending');

  await processNextJob({});
  assert.equal((await getJobResult(idB)).status, 'done');
});
