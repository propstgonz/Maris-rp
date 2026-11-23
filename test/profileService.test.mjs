import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import { makeFakeNamedExports } from './helpers/mockDb.mjs';

const normalize = sql => sql.trim().replace(/\s+/g, ' ');
const logged = [];
const executed = [];
let routes = () => undefined;

const fakeDb = {
  prepare(sql) {
    const q = normalize(sql);
    return {
      get: (...params) => routes(q, params, 'get'),
      all: (...params) => routes(q, params, 'all') ?? [],
      run: (...params) => {
        executed.push({ q, params });
        return routes(q, params, 'run') ?? { changes: 0, lastInsertRowid: 0 };
      },
    };
  },
};

mock.module('../src/database/index.js', { defaultExport: fakeDb, namedExports: makeFakeNamedExports(fakeDb) });
mock.module('../src/services/auditLogService.js', { namedExports: { logAction: async entry => { logged.push(entry); } } });
mock.module('../src/services/marriageService.js', {
  namedExports: { getCivilStatus: async () => ({ label: 'Soltera', spouse: null, marriageId: null }) },
});

const profile = await import('../src/services/profileService.js');
const { UserFacingError } = await import('../src/utils/errors.js');

const actor = { discordId: '1', username: 'rp', source: 'discord' };
const player = (extra = {}) => ({
  id: 5, discord_id: '55', is_alive: 1, character_created_at: '2026-01-01 00:00:00', stat_bonus_points: 0,
  stat_potencia: 0, stat_intuicion: 0, stat_chiripa: 0, stat_autismo: 0, stat_resistencia: 0, stat_donjuanismo: 0, stat_agilidad: 0,
  race_id: null, menhir_id: null, menhir_chosen_at: null, ...extra,
});

function reset(handler) {
  logged.length = 0;
  executed.length = 0;
  routes = handler;
}

test('allocateStat: estadística inexistente se rechaza antes de tocar la BD', async () => {
  reset(() => undefined);
  await assert.rejects(() => profile.allocateStat(5, 'drop table', 1, actor), /no existe/);
  assert.equal(executed.length, 0);
});

test('allocateStat: n inválido se rechaza antes de tocar la BD', async () => {
  reset(() => undefined);
  for (const n of [0, -1, 1.5, 7, '2']) {
    await assert.rejects(() => profile.allocateStat(5, 'potencia', n, actor), UserFacingError);
  }
  assert.equal(executed.length, 0);
});

test('allocateStat: un solo UPDATE con la guarda completa en el WHERE', async () => {
  reset((q, params, mode) => {
    if (mode === 'run') return { changes: 1 };
    if (q.startsWith('SELECT * FROM rp_players.players WHERE id')) return player({ stat_potencia: 3 });
  });
  await profile.allocateStat(5, 'potencia', 3, actor);
  assert.equal(executed.length, 1);
  assert.match(executed[0].q, /WHERE id = \? AND is_alive = 1 AND stat_potencia \+ \? <= 6 AND \(.*\) \+ \? <= 8 \+ stat_bonus_points$/);
  assert.deepEqual(executed[0].params, [3, 5, 3, 3]);
  assert.equal(logged[0].action, 'perfil.stat_asignada');
});

test('allocateStat: changes 0 explica el motivo con validateAllocation (sin puntos)', async () => {
  reset((q, params, mode) => (mode === 'run' ? { changes: 0 } : player({ stat_potencia: 6, stat_intuicion: 2 })));
  await assert.rejects(() => profile.allocateStat(5, 'agilidad', 1, actor), /Solo te quedan 0 punto/);
  assert.equal(logged.length, 0);
});

test('allocateStat: changes 0 por tope de 6 por estadística', async () => {
  reset((q, params, mode) => (mode === 'run' ? { changes: 0 } : player({ stat_potencia: 5 })));
  await assert.rejects(() => profile.allocateStat(5, 'potencia', 2, actor), /no puede pasar de 6/);
});

test('allocateStat: changes 0 con personaje muerto', async () => {
  reset((q, params, mode) => (mode === 'run' ? { changes: 0 } : player({ is_alive: 0 })));
  await assert.rejects(() => profile.allocateStat(5, 'potencia', 1, actor), /personaje vivo/);
});

test('grantBonusPoints: valida n y rechaza el tope', async () => {
  reset((q, params, mode) => (mode === 'run' ? { changes: 0 } : player({ stat_bonus_points: 100 })));
  await assert.rejects(() => profile.grantBonusPoints(5, 0, actor), UserFacingError);
  await assert.rejects(() => profile.grantBonusPoints(5, 1, actor), /más de 100/);
});

test('correctStat: valor fuera de rango y suma excedida', async () => {
  reset((q, params, mode) => (mode === 'run' ? { changes: 0 } : player({ stat_potencia: 6, stat_intuicion: 2 })));
  await assert.rejects(() => profile.correctStat(5, 'potencia', 7, actor), UserFacingError);
  await assert.rejects(() => profile.correctStat(5, 'agilidad', 3, actor), /pasaría de 8 puntos/);
});

test('correctStat: el WHERE lleva la guarda de suma', async () => {
  reset((q, params, mode) => (mode === 'run' ? { changes: 1 } : player()));
  await profile.correctStat(5, 'chiripa', 4, actor);
  assert.match(executed[0].q, /\) - stat_chiripa \+ \? <= 8 \+ stat_bonus_points$/);
  assert.deepEqual(executed[0].params, [4, 5, 4]);
});

test('setRace: raza inexistente', async () => {
  reset(() => undefined);
  await assert.rejects(() => profile.setRace(5, 'hobbit', actor), /raza no existe/);
});

test('chooseMenhir: menhir inexistente', async () => {
  reset(() => undefined);
  await assert.rejects(() => profile.chooseMenhir(5, 'nada', actor), /menhir no existe/);
});

test('chooseMenhir: el WHERE lleva la espera de 6 meses y el menhir distinto', async () => {
  reset((q, params, mode) => {
    if (mode === 'run') return { changes: 1 };
    if (q.includes('FROM rp_players.menhirs')) return { id: 3, name: 'El Menhir del Mago' };
    return player({ menhir_id: 3 });
  });
  await profile.chooseMenhir(5, 'mago', actor);
  assert.match(executed[0].q, /menhir_chosen_at <= NOW\(\) - INTERVAL 6 MONTH\) AND \(menhir_id IS NULL OR menhir_id <> \?\)$/);
});

test('chooseMenhir: dentro de la espera informa de la fecha', async () => {
  reset((q, params, mode) => {
    if (mode === 'run') return { changes: 0 };
    if (q.includes('FROM rp_players.menhirs')) return { id: 4, name: 'El Menhir del Atronach' };
    return player({ menhir_id: 3, menhir_chosen_at: '2999-01-15 10:00:00' });
  });
  await assert.rejects(() => profile.chooseMenhir(5, 'atronach', actor), /3000|julio/);
});

test('chooseMenhir: el mismo menhir se rechaza', async () => {
  reset((q, params, mode) => {
    if (mode === 'run') return { changes: 0 };
    if (q.includes('FROM rp_players.menhirs')) return { id: 3, name: 'El Menhir del Mago' };
    return player({ menhir_id: 3, menhir_chosen_at: '2020-01-01 00:00:00' });
  });
  await assert.rejects(() => profile.chooseMenhir(5, 'mago', actor), /Ya tienes/);
});

test('updateIdentity: valida campos', async () => {
  reset(() => player());
  await assert.rejects(() => profile.updateIdentity(5, {}, actor), /ningún campo/);
  await assert.rejects(() => profile.updateIdentity(5, { age: 0 }, actor), /edad/);
  await assert.rejects(() => profile.updateIdentity(5, { age: 1001 }, actor), /edad/);
  await assert.rejects(() => profile.updateIdentity(5, { gender: 'otro' }, actor), /género/);
  await assert.rejects(() => profile.updateIdentity(5, { characterName: '   ' }, actor), /nombre/);
});

test('getProfile: compone base, efectiva, puntos libres, magia y estado civil', async () => {
  reset(q => {
    if (q.includes('FROM rp_players.races')) return { id: 1, mod_autismo: 2 };
    if (q.includes('FROM rp_players.menhirs')) return { id: 3, magic_bonus: 50 };
    return player({ stat_autismo: 6, race_id: 1, menhir_id: 3, menhir_chosen_at: '2026-01-01 00:00:00' });
  });
  const result = await profile.getProfile(5);
  assert.equal(result.effective.autismo, 8);
  assert.equal(result.freePoints, 2);
  assert.equal(result.magic.magia, 250);
  assert.equal(result.civil.label, 'Soltera');
  assert.ok(result.menhirChangeAvailableAt instanceof Date);
});

test('getProfile: jugador inexistente', async () => {
  reset(() => undefined);
  await assert.rejects(() => profile.getProfile(99), /no existe/);
});
