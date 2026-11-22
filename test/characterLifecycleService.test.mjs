import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import { makeFakeNamedExports } from './helpers/mockDb.mjs';

const normalize = sql => sql.trim().replace(/\s+/g, ' ');
const executed = [];
const logged = [];
const order = [];
let routes = () => undefined;

const fakeDb = {
  prepare(sql) {
    const q = normalize(sql);
    return {
      get: (...params) => routes(q, params, 'get'),
      all: (...params) => routes(q, params, 'all') ?? [],
      run: (...params) => {
        executed.push({ q, params });
        return routes(q, params, 'run') ?? { changes: 1, lastInsertRowid: 1 };
      },
    };
  },
};

mock.module('../src/database/index.js', { defaultExport: fakeDb, namedExports: makeFakeNamedExports(fakeDb) });
mock.module('../src/services/auditLogService.js', { namedExports: { logAction: async entry => { logged.push(entry); } } });
mock.module('../src/services/marriageService.js', {
  namedExports: { endMarriagesOnDeathInTx: async id => { order.push(`viudedad:${id}`); return null; } },
});
mock.module('../src/services/consentService.js', {
  namedExports: { cancelAllPendingForPlayerInTx: async id => { order.push(`cancelar:${id}`); return 0; } },
});
mock.module('../src/services/modmailService.js', {
  namedExports: {
    ensureModmailChannel: async () => ({ id: 'canal', name: 'canal' }),
    notifyDeath: async () => {},
    notifyModmailChannel: async () => {},
    buildDeathModmailNotice: () => 'aviso',
    closeModmailChannel: async () => {},
  },
});

const lifecycle = await import('../src/services/characterLifecycleService.js');
const { UserFacingError } = await import('../src/utils/errors.js');

const actor = { discordId: '1', username: 'rp', source: 'discord' };
const living = { id: 7, discord_id: 'vivo', username: 'u', character_name: 'Fulano', character_created_at: '2026-01-01 00:00:00', is_alive: 1, modmail_channel_id: null };

function reset(handler) {
  executed.length = 0;
  logged.length = 0;
  order.length = 0;
  routes = handler;
}

test('el cooldown de creación por defecto son 336 horas (2 semanas)', async () => {
  reset(() => undefined);
  assert.equal(await lifecycle.getCharacterCreationCooldownHours(), 336);
});

test('relinkModmailChannel: fija el canal, y lanza sin personaje o sin jugador', async () => {
  reset(q => (q.startsWith('SELECT * FROM rp_players.players WHERE discord_id') ? { ...living } : undefined));
  const updated = await lifecycle.relinkModmailChannel('vivo', 'canal-nuevo');
  assert.equal(updated.id, 7);
  assert.deepEqual(executed[0].params, ['canal-nuevo', 'vivo']);

  reset(q => (q.startsWith('SELECT * FROM') ? { ...living, character_created_at: null } : undefined));
  await assert.rejects(() => lifecycle.relinkModmailChannel('vivo', 'x'), /no tiene ningún personaje creado/);

  reset(() => undefined);
  await assert.rejects(() => lifecycle.relinkModmailChannel('fantasma', 'x'), /Jugador no encontrado/);
});

test('createCharacter: valida nombre, edad, género y raza antes de tocar la BD', async () => {
  reset(() => undefined);
  const ok = { characterName: 'Fulano', age: 30, gender: 'hombre', raceSlug: 'nordico' };
  await assert.rejects(() => lifecycle.createCharacter('d', 'u', { ...ok, characterName: ' ' }), UserFacingError);
  await assert.rejects(() => lifecycle.createCharacter('d', 'u', { ...ok, characterName: 'x'.repeat(81) }), UserFacingError);
  await assert.rejects(() => lifecycle.createCharacter('d', 'u', { ...ok, age: 0 }), /edad/);
  await assert.rejects(() => lifecycle.createCharacter('d', 'u', { ...ok, age: 30.5 }), /edad/);
  await assert.rejects(() => lifecycle.createCharacter('d', 'u', { ...ok, gender: 'otro' }), /género/);
  await assert.rejects(() => lifecycle.createCharacter('d', 'u', { ...ok, raceSlug: undefined }), /raza/);
  assert.equal(executed.length, 0);
});

test('createCharacter: raza inexistente', async () => {
  reset(() => undefined);
  await assert.rejects(
    () => lifecycle.createCharacter('d', 'u', { characterName: 'F', age: 30, gender: 'hombre', raceSlug: 'hobbit' }),
    /raza no existe/
  );
});

test('createCharacter: el cooldown activo lo rechaza', async () => {
  reset((q, params, mode) => {
    if (q.includes('FROM rp_players.races')) return { id: 1 };
    if (q.includes('seconds_remaining')) return { seconds_remaining: 3600 };
  });
  await assert.rejects(
    () => lifecycle.createCharacter('d', 'u', { characterName: 'F', age: 30, gender: 'hombre', raceSlug: 'nordico' }),
    /Todavía no puedes crear/
  );
  assert.equal(executed.length, 0);
});

test('createCharacter: la reclamación lleva character_created_at IS NULL y changes 0 lo rechaza', async () => {
  reset((q, params, mode) => {
    if (q.includes('FROM rp_players.races')) return { id: 1 };
    if (q.startsWith('UPDATE rp_players.players SET character_created_at')) return { changes: 0 };
  });
  await assert.rejects(
    () => lifecycle.createCharacter('d', 'u', { characterName: 'F', age: 30, gender: 'hombre', raceSlug: 'nordico' }),
    /Ya tienes un personaje/
  );
  const claim = executed.find(e => e.q.startsWith('UPDATE rp_players.players SET character_created_at'));
  assert.match(claim.q, /WHERE discord_id = \? AND character_created_at IS NULL$/);
  assert.equal(executed.some(e => e.q.includes('character_registry')), false);
});

test('createCharacter: crea el registro y audita', async () => {
  reset((q, params, mode) => {
    if (q.includes('FROM rp_players.races')) return { id: 1 };
    if (q.startsWith('SELECT * FROM rp_players.players')) return { ...living };
  });
  const row = await lifecycle.createCharacter('d', 'u', { characterName: ' Fulano ', age: 30, gender: 'hombre', raceSlug: 'nordico' });
  assert.equal(row.id, 7);
  const registry = executed.find(e => e.q.includes('character_registry'));
  assert.deepEqual(registry.params, ['d', 'Fulano']);
  assert.equal(logged[0].action, 'personaje.creado');
});

test('killCharacter: jugador inexistente, ya muerto y sin personaje', async () => {
  reset(() => undefined);
  await assert.rejects(() => lifecycle.killCharacter('nadie', 'x', actor), /no existe/);

  reset((q, params, mode) => {
    if (q.startsWith('SELECT * FROM rp_players.players')) return { ...living, is_alive: 0 };
    if (q.startsWith('UPDATE rp_players.players SET is_alive = 0')) return { changes: 0 };
  });
  await assert.rejects(() => lifecycle.killCharacter('vivo', 'x', actor), /ya estaba muerto/);
  assert.equal(executed.some(e => e.q.startsWith('DELETE')), false);
  assert.equal(logged.length, 0);

  reset((q, params, mode) => {
    if (q.startsWith('SELECT * FROM rp_players.players')) return { ...living, character_created_at: null };
    if (q.startsWith('UPDATE rp_players.players SET is_alive = 0')) return { changes: 0 };
  });
  await assert.rejects(() => lifecycle.killCharacter('vivo', 'x', actor), /no tiene ningún personaje/);
});

test('killCharacter: orden de la transacción y snapshot auditado', async () => {
  reset((q, params, mode) => {
    if (q.startsWith('SELECT * FROM rp_players.players')) return { ...living };
    if (q.startsWith('SELECT p.*')) return { ...living, age: 30, gender: 'hombre', race_slug: 'nordico', menhir_slug: 'mago', stat_potencia: 4, stat_bonus_points: 1 };
    if (q.startsWith('SELECT name FROM rp_players.player_npcs')) return [{ name: 'Guardia' }, { name: 'Guardia' }, { name: 'Cocinero' }];
    if (q.includes('FROM rp_economy.inventory')) return [{ item_id: 3, name: 'hierro', quantity: '2.50' }];
    if (q.includes('FROM rp_world.properties')) return [{ id: 9, type: 'granja', name: null, level: 2, location: 'Skingrad' }];
    if (q.includes('FROM rp_players.school_progress')) return [{ slug: 'destruccion', level_rank: 3 }];
    if (q.includes('FROM rp_players.marriage_members')) return { id: 8, discord_id: 'conyuge', character_name: 'Ella' };
  });
  const { player, snapshot } = await lifecycle.killCharacter('vivo', 'duelo', actor);
  assert.equal(player.id, 7);
  assert.deepEqual(order, ['cancelar:7', 'viudedad:7']);
  assert.deepEqual(snapshot.npcs, [{ name: 'Guardia', count: 2 }, { name: 'Cocinero', count: 1 }]);
  assert.deepEqual(snapshot.goods, [{ itemId: 3, name: 'hierro', quantity: 2.5 }]);
  assert.equal(snapshot.properties[0].type, 'granja');
  assert.deepEqual(snapshot.schools, [{ slug: 'destruccion', rank: 3 }]);
  assert.equal(snapshot.spouse.discordId, 'conyuge');
  assert.equal(snapshot.stats.potencia, 4);

  const statements = executed.map(e => e.q);
  assert.match(statements[0], /^UPDATE rp_players.players SET is_alive = 0.*WHERE id = \? AND is_alive = 1 AND character_created_at IS NOT NULL$/);
  assert.deepEqual(statements.slice(1).map(s => s.split(' ').slice(0, 3).join(' ')), [
    'DELETE FROM rp_players.player_npcs',
    'DELETE FROM rp_economy.inventory',
    'DELETE FROM rp_world.properties',
    'DELETE FROM rp_players.school_progress',
    'UPDATE rp_players.players SET',
  ]);
  assert.equal(logged[0].action, 'personaje.muerte');
  assert.equal(logged[0].details.reason, 'duelo');
});

test('reviveCharacter: el claim exige muerto con personaje; si no, lanza', async () => {
  reset((q, params, mode) => {
    if (q.startsWith('SELECT * FROM')) return { ...living };
    if (q.startsWith('UPDATE rp_players.players SET is_alive = 1')) return { changes: 0 };
  });
  await assert.rejects(() => lifecycle.reviveCharacter('vivo', actor), /ya está vivo/);
  assert.match(executed[0].q, /WHERE discord_id = \? AND is_alive = 0 AND character_created_at IS NOT NULL$/);
});

test('reviveByCharacterId: id inexistente, vivo o ya borrado', async () => {
  reset(() => undefined);
  await assert.rejects(() => lifecycle.reviveByCharacterId(99), /No existe ningún personaje/);
  reset(() => ({ ...living }));
  await assert.rejects(() => lifecycle.reviveByCharacterId(7), /ya está vivo/);
  reset(() => ({ ...living, is_alive: 0, character_created_at: null }));
  await assert.rejects(() => lifecycle.reviveByCharacterId(7), /ya no existe/);
});

test('pruneExpiredCharacters: deja el jugador en blanco con guarda is_alive = 0 y vacía todo', async () => {
  reset((q, params, mode) => {
    if (q.startsWith('SELECT * FROM rp_players.players WHERE is_alive = 0')) {
      return [{ id: 7, discord_id: 'caducado', character_name: 'Viejo', died_at: '2026-01-01 00:00:00', modmail_channel_id: null }];
    }
  });
  const cleaned = await lifecycle.pruneExpiredCharacters(null);
  assert.equal(cleaned, 1);
  assert.match(executed[0].q, /^UPDATE rp_players.players SET character_created_at = NULL.*WHERE id = \? AND is_alive = 0$/);
  assert.deepEqual(executed.slice(1).map(e => e.q.split(' ').slice(0, 3).join(' ')), [
    'DELETE FROM rp_players.player_npcs',
    'DELETE FROM rp_economy.inventory',
    'DELETE FROM rp_world.properties',
    'DELETE FROM rp_players.school_progress',
    'UPDATE rp_players.players SET',
  ]);
  assert.doesNotMatch(executed.map(e => e.q).join(' '), /hp|hunger|laburo|coord_|tile|effects/);
});

test('pruneExpiredCharacters: si el jugador fue revivido entre medias no se toca nada más', async () => {
  reset((q, params, mode) => {
    if (q.startsWith('SELECT * FROM rp_players.players WHERE is_alive = 0')) return [{ id: 7, discord_id: 'x', died_at: '2026-01-01 00:00:00' }];
    if (q.startsWith('UPDATE rp_players.players SET character_created_at = NULL')) return { changes: 0 };
  });
  await lifecycle.pruneExpiredCharacters(null);
  assert.equal(executed.length, 1);
});

test('finalizeGraceDeath: solo sobre un personaje muerto', async () => {
  reset(() => undefined);
  await assert.rejects(() => lifecycle.finalizeGraceDeath('nadie'), /Jugador no encontrado/);
  reset(() => ({ ...living }));
  await assert.rejects(() => lifecycle.finalizeGraceDeath('vivo'), /sigue vivo/);
  reset(() => ({ ...living, is_alive: 0, character_created_at: null }));
  await assert.rejects(() => lifecycle.finalizeGraceDeath('vivo'), /nada que finalizar/);
});
