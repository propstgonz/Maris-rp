import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import { makeFakeNamedExports } from './helpers/mockDb.mjs';

const normalize = sql => sql.trim().replace(/\s+/g, ' ');
const logged = [];
const executed = [];
const dispatched = [];
let routes = () => undefined;
let dispatchError = null;

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

function recorder(name) {
  return async (...args) => {
    dispatched.push({ name, args });
    if (dispatchError) throw dispatchError;
  };
}

mock.module('../src/database/index.js', { defaultExport: fakeDb, namedExports: makeFakeNamedExports(fakeDb) });
mock.module('../src/services/auditLogService.js', { namedExports: { logAction: async entry => { logged.push(entry); } } });
mock.module('../src/services/goodsService.js', { namedExports: { transferGoodsInTx: recorder('goods') } });
mock.module('../src/services/npcHoldingService.js', { namedExports: { transferNpcsInTx: recorder('npcs') } });
mock.module('../src/services/propertyService.js', { namedExports: { transferPropertyInTx: recorder('property') } });
mock.module('../src/services/marriageService.js', { namedExports: { acceptMarriageInTx: recorder('marriage') } });

const consent = await import('../src/services/consentService.js');
const { UserFacingError } = await import('../src/utils/errors.js');

const actor = { discordId: '1', username: 'rp', source: 'discord' };

function reset(handler) {
  logged.length = 0;
  executed.length = 0;
  dispatched.length = 0;
  dispatchError = null;
  routes = handler;
}

const bothAlive = (q, params, mode) => (q.includes('is_alive = 1') && mode === 'all' ? [{ id: 1 }, { id: 2 }] : undefined);

test('createRequest: tipo desconocido, jugadores inválidos y auto-solicitud', async () => {
  reset(() => undefined);
  await assert.rejects(() => consent.createRequest({ kind: 'regalo', fromPlayerId: 1, toPlayerId: 2 }), /desconocido/);
  await assert.rejects(() => consent.createRequest({ kind: 'marriage', fromPlayerId: 0, toPlayerId: 2 }), /no válido/);
  await assert.rejects(() => consent.createRequest({ kind: 'marriage', fromPlayerId: 1, toPlayerId: 1 }), /a ti mismo/);
});

test('createRequest: valida los campos de cada tipo', async () => {
  reset(bothAlive);
  const base = { fromPlayerId: 1, toPlayerId: 2 };
  await assert.rejects(() => consent.createRequest({ ...base, kind: 'item', itemId: 3, quantity: 0 }), /cantidad/);
  await assert.rejects(() => consent.createRequest({ ...base, kind: 'item', itemId: 3, quantity: 1.234 }), /2 decimales/);
  await assert.rejects(() => consent.createRequest({ ...base, kind: 'item', quantity: 1 }), /qué bien/);
  await assert.rejects(() => consent.createRequest({ ...base, kind: 'npc', npcName: '', npcCount: 1 }), /nombre del NPC/);
  await assert.rejects(() => consent.createRequest({ ...base, kind: 'npc', npcName: 'Guardia', npcCount: 51 }), /entre 1 y 50/);
  await assert.rejects(() => consent.createRequest({ ...base, kind: 'property' }), /qué propiedad/);
  assert.equal(executed.length, 0);
});

test('createRequest: ambos deben tener personaje vivo', async () => {
  reset((q, params, mode) => (mode === 'all' ? [{ id: 1 }] : undefined));
  await assert.rejects(() => consent.createRequest({ kind: 'marriage', fromPlayerId: 1, toPlayerId: 2 }), /no tiene un personaje vivo/);
  reset((q, params, mode) => (mode === 'all' ? [{ id: 2 }] : undefined));
  await assert.rejects(() => consent.createRequest({ kind: 'marriage', fromPlayerId: 1, toPlayerId: 2 }), /Necesitas un personaje vivo/);
});

test('createRequest: inserta con TTL de 24 h y devuelve el id', async () => {
  reset((q, params, mode) => (mode === 'run' ? { changes: 1, lastInsertRowid: 12 } : bothAlive(q, params, mode)));
  const id = await consent.createRequest({ kind: 'item', fromPlayerId: 1, toPlayerId: 2, itemId: 3, quantity: 0.5 });
  assert.equal(id, 12);
  assert.match(executed[0].q, /INTERVAL 24 HOUR/);
  assert.deepEqual(executed[0].params, ['item', 1, 2, 3, 0.5, null, null, null]);
});

test('accept: el claim guarda destinatario, pendiente y caducidad en el WHERE', async () => {
  reset((q, params, mode) => (mode === 'run' ? { changes: 0 } : undefined));
  await assert.rejects(() => consent.accept(4, 2, actor), /resuelta, ha caducado o no es para ti/);
  assert.match(executed[0].q, /WHERE id = \? AND to_player_id = \? AND status = 'pending' AND expires_at > NOW\(\)$/);
  assert.equal(dispatched.length, 0);
});

test('accept: despacha por tipo y audita fuera de la transaccion', async () => {
  const rows = {
    item: { id: 1, kind: 'item', from_player_id: 1, to_player_id: 2, item_id: 3, quantity: '2.50' },
    npc: { id: 2, kind: 'npc', from_player_id: 1, to_player_id: 2, npc_name: 'Guardia', npc_count: 3 },
    property: { id: 3, kind: 'property', from_player_id: 1, to_player_id: 2, property_id: 8 },
    marriage: { id: 4, kind: 'marriage', from_player_id: 1, to_player_id: 2 },
  };
  for (const [kind, row] of Object.entries(rows)) {
    reset((q, params, mode) => (mode === 'run' ? { changes: 1 } : row));
    await consent.accept(row.id, 2, actor);
    assert.equal(dispatched.length, 1);
    assert.equal(logged[0].action, `consentimiento.${kind}_aceptado`);
  }
  reset((q, params, mode) => (mode === 'run' ? { changes: 1 } : rows.item));
  await consent.accept(1, 2, actor);
  assert.deepEqual(dispatched[0], { name: 'goods', args: [1, 2, 3, 2.5] });
});

test('accept: un rechazo de regla en el despacho cancela la solicitud y relanza', async () => {
  reset((q, params, mode) => (mode === 'run' ? { changes: 1 } : { id: 1, kind: 'npc', from_player_id: 1, to_player_id: 2, npc_name: 'G', npc_count: 1 }));
  dispatchError = new UserFacingError('No tiene tantos NPCs.');
  await assert.rejects(() => consent.accept(1, 2, actor), /No tiene tantos NPCs/);
  assert.match(executed.at(-1).q, /SET status = 'cancelled'.*WHERE id = \? AND status = 'pending'$/);
  assert.equal(logged.length, 0);
});

test('accept: un error inesperado en el despacho deja la solicitud pendiente', async () => {
  reset((q, params, mode) => (mode === 'run' ? { changes: 1 } : { id: 1, kind: 'npc', from_player_id: 1, to_player_id: 2, npc_name: 'G', npc_count: 1 }));
  dispatchError = new Error('deadlock');
  await assert.rejects(() => consent.accept(1, 2, actor), /deadlock/);
  assert.equal(executed.some(e => e.q.includes("SET status = 'cancelled'")), false);
});

test('reject y cancel: solo el destinatario / el emisor', async () => {
  reset((q, params, mode) => (mode === 'run' ? { changes: 0 } : undefined));
  await assert.rejects(() => consent.reject(1, 9, actor), /no es para ti/);
  await assert.rejects(() => consent.cancel(1, 9, actor), /no la hiciste tú/);
  assert.match(executed[0].q, /WHERE id = \? AND to_player_id = \? AND status = 'pending'$/);
  assert.match(executed[1].q, /WHERE id = \? AND from_player_id = \? AND status = 'pending'$/);
});

test('reject y cancel: resuelven y auditan', async () => {
  reset((q, params, mode) => (mode === 'run' ? { changes: 1 } : { id: 1, kind: 'item', from_player_id: 1, to_player_id: 2 }));
  await consent.reject(1, 2, actor);
  await consent.cancel(1, 1, actor);
  assert.deepEqual(logged.map(l => l.action), ['consentimiento.item_rechazado', 'consentimiento.item_cancelado']);
});

test('cancelAllPendingForPlayerInTx y markExpired devuelven las filas afectadas', async () => {
  reset((q, params, mode) => (mode === 'run' ? { changes: 3 } : undefined));
  assert.equal(await consent.cancelAllPendingForPlayerInTx(1), 3);
  assert.deepEqual(executed[0].params, [1, 1]);
  assert.equal(await consent.markExpired(), 3);
});
