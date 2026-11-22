import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import { makeFakeNamedExports } from './helpers/mockDb.mjs';

const normalize = sql => sql.trim().replace(/\s+/g, ' ');
const logged = [];
const created = [];
let routes = () => undefined;

const fakeDb = {
  prepare(sql) {
    const q = normalize(sql);
    return {
      get: (...params) => routes(q, params, 'get'),
      all: (...params) => routes(q, params, 'all') ?? [],
      run: (...params) => routes(q, params, 'run') ?? { changes: 0, lastInsertRowid: 0 },
    };
  },
};

mock.module('../src/database/index.js', { defaultExport: fakeDb, namedExports: makeFakeNamedExports(fakeDb) });
mock.module('../src/services/auditLogService.js', { namedExports: { logAction: async entry => { logged.push(entry); } } });
mock.module('../src/services/consentService.js', {
  namedExports: { createRequest: async request => { created.push(request); return 77; } },
});

const marriage = await import('../src/services/marriageService.js');
const { UserFacingError } = await import('../src/utils/errors.js');

const actor = { discordId: '1', username: 'rp', source: 'discord' };
const request = { id: 9, kind: 'marriage', from_player_id: 1, to_player_id: 2 };

function reset(handler) {
  logged.length = 0;
  created.length = 0;
  routes = handler;
}

test('propose: no a uno mismo', async () => {
  reset(() => undefined);
  await assert.rejects(() => marriage.propose(3, 3, actor), /contigo mismo/);
});

test('propose: el proponente ya casado', async () => {
  reset((q, params, mode) => (q.includes('open_slot = 1') && mode === 'all' ? [{ player_id: 1 }] : undefined));
  await assert.rejects(() => marriage.propose(1, 2, actor), /Ya estás casado/);
});

test('propose: el destinatario ya casado', async () => {
  reset((q, params, mode) => (q.includes('open_slot = 1') && mode === 'all' ? [{ player_id: 2 }] : undefined));
  await assert.rejects(() => marriage.propose(1, 2, actor), /Esa persona ya está casada/);
});

test('propose: propuesta pendiente entre ellos en cualquier sentido', async () => {
  reset((q, params, mode) => (q.includes("kind = 'marriage'") && mode === 'get' ? { id: 4 } : undefined));
  await assert.rejects(() => marriage.propose(1, 2, actor), /pendiente/);
  assert.equal(created.length, 0);
});

test('propose: crea la solicitud y audita', async () => {
  reset((q, params, mode) => (q.startsWith('SELECT id, discord_id') ? { id: params[0], discord_id: `d${params[0]}`, character_name: `P${params[0]}` } : undefined));
  const id = await marriage.propose(1, 2, actor);
  assert.equal(id, 77);
  assert.deepEqual(created[0], { kind: 'marriage', fromPlayerId: 1, toPlayerId: 2 });
  assert.equal(logged[0].action, 'matrimonio.propuesto');
});

test('acceptMarriageInTx: alguno ya no está vivo', async () => {
  reset((q, params, mode) => (q.includes('FOR UPDATE') ? [{ id: 1 }] : undefined));
  await assert.rejects(() => marriage.acceptMarriageInTx(request), /personaje vivo/);
});

test('acceptMarriageInTx: ER_DUP_ENTRY se traduce a UserFacingError', async () => {
  reset((q, params, mode) => {
    if (q.includes('FOR UPDATE')) return [{ id: 1 }, { id: 2 }];
    if (q.startsWith('INSERT INTO rp_players.marriages')) return { changes: 1, lastInsertRowid: 5 };
    if (q.startsWith('INSERT INTO rp_players.marriage_members')) throw Object.assign(new Error('dup'), { code: 'ER_DUP_ENTRY' });
  });
  await assert.rejects(() => marriage.acceptMarriageInTx(request), err => err instanceof UserFacingError && /ya está casado/.test(err.message));
});

test('acceptMarriageInTx: otro error de BD se propaga tal cual', async () => {
  reset((q, params, mode) => {
    if (q.includes('FOR UPDATE')) return [{ id: 1 }, { id: 2 }];
    throw new Error('conexión caída');
  });
  await assert.rejects(() => marriage.acceptMarriageInTx(request), /conexión caída/);
});

test('divorce: sin matrimonio abierto', async () => {
  reset(() => undefined);
  await assert.rejects(() => marriage.divorce(1, actor), /No estás casado/);
});

test('divorce: el UPDATE guardado por ended_at IS NULL sin filas lanza', async () => {
  reset((q, params, mode) => {
    if (q.startsWith('SELECT marriage_id')) return { marriage_id: 5 };
    if (q.startsWith('UPDATE rp_players.marriages')) return { changes: 0 };
  });
  await assert.rejects(() => marriage.divorce(1, actor), /No estás casado/);
  assert.equal(logged.length, 0);
});

test('annul: sin matrimonio abierto', async () => {
  reset(() => undefined);
  await assert.rejects(() => marriage.annul(1, actor), /no está casado/);
});

test('endMarriagesOnDeathInTx: sin matrimonio devuelve null', async () => {
  reset(() => undefined);
  assert.equal(await marriage.endMarriagesOnDeathInTx(1), null);
});

test('getCivilStatus: viudo con la forma de su género', async () => {
  reset((q, params, mode) => {
    if (q.startsWith('SELECT id, discord_id')) return { id: 1, gender: 'mujer' };
    if (q.includes('SELECT m.end_reason')) return { end_reason: 'viudedad' };
  });
  assert.deepEqual(await marriage.getCivilStatus(1), { label: 'Viuda', spouse: null, marriageId: null });
});

test('getCivilStatus: casado devuelve al cónyuge', async () => {
  reset((q, params, mode) => {
    if (q.startsWith('SELECT id, discord_id')) return { id: 1, gender: 'hombre' };
    if (q.includes('FROM rp_players.marriage_members mine')) return { marriage_id: 5, id: 2, discord_id: 'd2', character_name: 'Ella' };
  });
  assert.deepEqual(await marriage.getCivilStatus(1), {
    label: 'Casado', spouse: { id: 2, discordId: 'd2', characterName: 'Ella' }, marriageId: 5,
  });
});
