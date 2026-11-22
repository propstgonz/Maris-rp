








import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import { makeFakeDb, makeFakeNamedExports } from './helpers/mockDb.mjs';

function normalize(sql) { return sql.trim().replace(/\s+/g, ' '); }



const state = new Map();

function makeStatefulDb() {
  const generic = makeFakeDb();
  return {
    ...generic,
    prepare(sql) {
      const q = normalize(sql);
      if (q === 'SELECT value FROM rp_ops.system_state WHERE `key` = ?') {
        return { get: (key) => (state.has(key) ? { value: state.get(key) } : undefined) };
      }
      if (q.startsWith('INSERT INTO rp_ops.system_state (`key`, value)')) {
        return { run: (key, value) => { state.set(key, value); return { changes: 1 }; } };
      }
      return generic.prepare(sql);
    },



    transaction: (fn) => (...args) => fn(...args),
  };
}

const fakeDb = makeStatefulDb();
mock.module('../src/database/index.js', { defaultExport: fakeDb, namedExports: makeFakeNamedExports(fakeDb) });
const { startInstanceGuard, listLiveInstances, INSTANCE_ID } =
  await import('../src/services/instanceGuardService.js');

const KEY = 'bot_instances';
const now = () => new Date().toISOString();

test('INSTANCE_ID identifica el proceso con hostname y pid (para localizar el contenedor)', () => {


  assert.match(INSTANCE_ID, /^.+:\d+:[0-9a-f]{8}$/);
});

test('con una sola instancia, solo se ve a sí misma', async () => {
  state.clear();
  clearInterval(await startInstanceGuard());
  const live = await listLiveInstances();
  assert.equal(live.length, 1);
  assert.equal(live[0].isSelf, true);
});

test('DETECTA una segunda instancia viva — el caso que motiva el servicio', async () => {
  state.clear();
  state.set(KEY, JSON.stringify({ 'otro-contenedor:99:deadbeef': now() }));

  clearInterval(await startInstanceGuard());

  const live = await listLiveInstances();
  assert.equal(live.length, 2, 'debería ver la suya y la ajena');
  assert.ok(live.some(i => i.isSelf), 'la propia');
  assert.ok(live.some(i => !i.isSelf && i.id.startsWith('otro-contenedor')), 'la ajena');
});

test('una instancia MUERTA (latido viejo) se limpia y no cuenta como duplicado', async () => {
  state.clear();

  const stale = new Date(Date.now() - 10 * 60_000).toISOString();
  state.set(KEY, JSON.stringify({ 'contenedor-muerto:1:aaaaaaaa': stale }));

  clearInterval(await startInstanceGuard());

  const live = await listLiveInstances();
  assert.equal(live.length, 1, 'la muerta no debe contar — si contara, un reinicio normal daría falso positivo para siempre');
  assert.equal(live[0].isSelf, true);
});

test('un valor corrupto en la BD no revienta: se trata como vacío y se reescribe', async () => {
  state.clear();
  state.set(KEY, 'esto no es JSON {{{');
  await assert.doesNotReject(async () => clearInterval(await startInstanceGuard()));
  const live = await listLiveInstances();
  assert.equal(live.length, 1);
  assert.doesNotThrow(() => JSON.parse(state.get(KEY)), 'debe haber quedado un JSON válido');
});

test('sin ninguna clave previa arranca limpio (primer arranque del bot)', async () => {
  state.clear();
  assert.deepEqual(await listLiveInstances(), []);
  await assert.doesNotReject(async () => clearInterval(await startInstanceGuard()));
  assert.equal((await listLiveInstances()).length, 1);
});
