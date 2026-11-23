import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import { makeFakeNamedExports } from './helpers/mockDb.mjs';
import { UserFacingError } from '../src/utils/errors.js';

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
function validateQuantity(quantity) {
  const q = Number(quantity);
  if (!Number.isFinite(q) || q <= 0) throw new UserFacingError('La cantidad debe ser mayor que 0.');
  if (Math.abs(q * 100 - Math.round(q * 100)) > 1e-6 * Math.max(1, Math.abs(q))) throw new UserFacingError('La cantidad admite como mucho 2 decimales.');
  return Math.round(q * 100) / 100;
}

mock.module('../src/services/goodsService.js', { namedExports: { transferGoodsInTx: recorder('goods'), validateQuantity } });
mock.module('../src/services/npcHoldingService.js', { namedExports: { transferNpcsInTx: recorder('npcs') } });
mock.module('../src/services/propertyService.js', { namedExports: { transferPropertyInTx: recorder('property') } });
mock.module('../src/services/marriageService.js', { namedExports: { acceptMarriageInTx: recorder('marriage') } });

const consent = await import('../src/services/consentService.js');

const actor = { discordId: '1', username: 'rp', source: 'discord' };

function reset(handler) {
  logged.length = 0;
  executed.length = 0;
  dispatched.length = 0;
  dispatchError = null;
  routes = handler;
}

const living = id => ({ id, is_alive: 1, character_created_at: '2026-01-01 00:00:00' });
const lockRoute = rows => (q, params, mode) => {
  if (q.includes('FOR UPDATE') && mode === 'all') return rows;
  if (q.startsWith('SELECT COUNT(*) AS n') && mode === 'get') return { n: 0 };
  return undefined;
};
const bothAlive = lockRoute([living(1), living(2)]);

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
  reset(lockRoute([living(1)]));
  await assert.rejects(() => consent.createRequest({ kind: 'marriage', fromPlayerId: 1, toPlayerId: 2 }), /no tiene un personaje vivo/);
  reset(lockRoute([living(2)]));
  await assert.rejects(() => consent.createRequest({ kind: 'marriage', fromPlayerId: 1, toPlayerId: 2 }), /Necesitas un personaje vivo/);
  reset(lockRoute([living(1), { id: 2, is_alive: 0, character_created_at: '2026-01-01 00:00:00' }]));
  await assert.rejects(() => consent.createRequest({ kind: 'marriage', fromPlayerId: 1, toPlayerId: 2 }), /no tiene un personaje vivo/);
});

test('createRequest: bloquea a los dos jugadores en orden ascendente de id', async () => {
  const locks = [];
  reset((q, params, mode) => {
    if (q.includes('FOR UPDATE')) locks.push(params);
    return bothAlive(q, params, mode);
  });
  await consent.createRequest({ kind: 'marriage', fromPlayerId: 2, toPlayerId: 1 });
  assert.deepEqual(locks[0], [1, 2]);
});

test('createRequest: tope de solicitudes pendientes por pareja', async () => {
  reset((q, params, mode) => (q.startsWith('SELECT COUNT(*) AS n') ? { n: 5 } : bothAlive(q, params, mode)));
  await assert.rejects(() => consent.createRequest({ kind: 'marriage', fromPlayerId: 1, toPlayerId: 2 }), /5 solicitudes pendientes/);
  assert.equal(executed.length, 0);
});

test('createRequest: la cantidad con 2 decimales admite tolerancia relativa', async () => {
  reset((q, params, mode) => (mode === 'run' ? { changes: 1, lastInsertRowid: 3 } : bothAlive(q, params, mode)));
  await consent.createRequest({ kind: 'item', fromPlayerId: 1, toPlayerId: 2, itemId: 3, quantity: 1234567.89 });
  assert.equal(executed[0].params[4], 1234567.89);
});

test('createRequest: inserta con TTL de 24 h y devuelve el id', async () => {
  reset((q, params, mode) => (mode === 'run' ? { changes: 1, lastInsertRowid: 12 } : bothAlive(q, params, mode)));
  const id = await consent.createRequest({ kind: 'item', fromPlayerId: 1, toPlayerId: 2, itemId: 3, quantity: 0.5 });
  assert.equal(id, 12);
  assert.match(executed[0].q, /INTERVAL 24 HOUR/);
  assert.deepEqual(executed[0].params, ['item', 1, 2, 3, 0.5, null, null, null]);
});

test('accept: el claim guarda destinatario, pendiente y caducidad en el WHERE', async () => {
  reset((q, params, mode) => (mode === 'run' ? { changes: 0 } : { id: 4, from_player_id: 1, to_player_id: 2 }));
  await assert.rejects(() => consent.accept(4, 2, actor), /resuelta, ha caducado o no es para ti/);
  assert.match(executed[0].q, /WHERE id = \? AND to_player_id = \? AND status = 'pending' AND expires_at > NOW\(\)$/);
  assert.equal(dispatched.length, 0);
});

test('accept: una solicitud ajena se rechaza sin tocar la base', async () => {
  reset((q, params, mode) => (mode === 'run' ? { changes: 1 } : { id: 4, from_player_id: 1, to_player_id: 2 }));
  await assert.rejects(() => consent.accept(4, 7, actor), /no es para ti/);
  assert.equal(executed.length, 0);
});

test('accept: bloquea a los dos jugadores antes de reclamar', async () => {
  const order = [];
  reset((q, params, mode) => {
    if (q.includes('FOR UPDATE')) order.push(`lock:${params}`);
    if (mode === 'run') { order.push('claim'); return { changes: 1 }; }
    return { id: 4, kind: 'marriage', from_player_id: 2, to_player_id: 1 };
  });
  await consent.accept(4, 1, actor);
  assert.deepEqual(order, ['lock:1,2', 'claim']);
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

test('cancelAllPendingForPlayerInTx cancela enviadas y recibidas con dos UPDATE indexables', async () => {
  reset((q, params, mode) => (mode === 'run' ? { changes: 3 } : undefined));
  assert.equal(await consent.cancelAllPendingForPlayerInTx(1), 6);
  assert.deepEqual(executed.map(e => e.params), [[1], [1]]);
  assert.match(executed[0].q, /WHERE from_player_id = \? AND status = 'pending'$/);
  assert.match(executed[1].q, /WHERE to_player_id = \? AND status = 'pending'$/);
  assert.equal(executed.some(e => e.q.includes(' OR ')), false);
});

test('listPendingForPlayer devuelve los recuentos reales de cada lado', async () => {
  reset((q, params, mode) => {
    if (q.startsWith('SELECT COUNT(*) AS n') && q.includes('to_player_id')) return { n: 40 };
    if (q.startsWith('SELECT COUNT(*) AS n')) return { n: 2 };
    return mode === 'all' ? [{ id: 1, quantity: null }] : undefined;
  });
  const listed = await consent.listPendingForPlayer(1);
  assert.equal(listed.incomingTotal, 40);
  assert.equal(listed.outgoingTotal, 2);
  assert.equal(listed.incoming.length, 1);
});
