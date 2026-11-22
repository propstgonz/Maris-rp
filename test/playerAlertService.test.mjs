



import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import { makeFakeNamedExports } from './helpers/mockDb.mjs';

function normalize(sql) { return sql.trim().replace(/\s+/g, ' '); }

function makeFakeDb() {
  const players = new Map([
    ['alice', {
      discord_id: 'alice', alert_fuel_low: 1, alert_structure_attacked: 1, alert_citizenship_request: 1, alert_laburo_expiring: 0,
      alert_player_attacked: 1, alert_revived: 1, alert_channel_to_dm: 1, alert_travel_step: 0, alert_web_echo: 1,
    }],
  ]);

  const COLUMNS = [
    'alert_fuel_low', 'alert_structure_attacked', 'alert_citizenship_request', 'alert_laburo_expiring',
    'alert_player_attacked', 'alert_revived', 'alert_channel_to_dm', 'alert_travel_step', 'alert_web_echo',
  ];

  return {
    prepare(sql) {
      const q = normalize(sql);
      if (q.startsWith('SELECT alert_fuel_low')) {
        return { get: (discordId) => players.get(discordId) };
      }
      for (const col of COLUMNS) {
        if (q === `UPDATE rp_players.players SET ${col} = ? WHERE discord_id = ?`) {
          return { run: (v, id) => { const p = players.get(id); if (p) p[col] = v; return { changes: p ? 1 : 0 }; } };
        }
      }
      throw new Error(`Fake DB: sentencia no reconocida en el test: "${q}"`);
    },
    exec: () => {},
    pragma: () => {},
    transaction: (fn) => (...args) => fn(...args),
    close: () => {},
  };
}

const fakeDb = makeFakeDb();
mock.module('../src/database/index.js', { defaultExport: fakeDb, namedExports: makeFakeNamedExports(fakeDb) });
const { ALERT_TYPES, getAlertPreferences, setAlertPreference, sendPlayerAlert } = await import('../src/services/playerAlertService.js');

test('ALERT_TYPES expone las 9 claves válidas', () => {
  assert.deepEqual(
    Object.keys(ALERT_TYPES).sort(),
    ['channelToDm', 'citizenshipRequest', 'fuelLow', 'laburoExpiring', 'playerAttacked', 'revived', 'structureAttacked', 'travelStep', 'webEcho'].sort()
  );
});

test('getAlertPreferences devuelve las 9 preferencias como booleanos', async () => {
  const prefs = await getAlertPreferences('alice');
  assert.deepEqual(prefs, {
    fuelLow: true, structureAttacked: true, citizenshipRequest: true, laburoExpiring: false,
    playerAttacked: true, revived: true, channelToDm: true, travelStep: false, webEcho: true,
  });
});

test('travelStep viene DESACTIVADA por defecto, a diferencia del resto', async () => {
  const prefs = await getAlertPreferences('alice');
  assert.equal(prefs.travelStep, false);
});

test('getAlertPreferences de un jugador inexistente devuelve null', async () => {
  assert.equal(await getAlertPreferences('nadie'), null);
});

test('setAlertPreference actualiza solo la columna del tipo indicado', async () => {
  await setAlertPreference('alice', 'laburoExpiring', true);
  assert.deepEqual(await getAlertPreferences('alice'), {
    fuelLow: true, structureAttacked: true, citizenshipRequest: true, laburoExpiring: true,
    playerAttacked: true, revived: true, channelToDm: true, travelStep: false, webEcho: true,
  });
});

test('setAlertPreference con un tipo desconocido lanza en vez de fallar en silencio', async () => {
  await assert.rejects(() => setAlertPreference('alice', 'noExiste', true), /Tipo de alerta desconocido/);
});

test('sendPlayerAlert NO manda nada si el jugador tiene ese tipo desactivado', async () => {
  await setAlertPreference('alice', 'structureAttacked', false);
  let sent = false;
  const fakeClient = { users: { fetch: async () => ({ send: async () => { sent = true; } }) } };
  const result = await sendPlayerAlert(fakeClient, 'alice', 'structureAttacked', 'hola');
  assert.equal(result, false);
  assert.equal(sent, false);
});

test('sendPlayerAlert SÍ manda el MD si el tipo está activado', async () => {
  await setAlertPreference('alice', 'structureAttacked', true);
  let sentMessage = null;
  const fakeClient = { users: { fetch: async (id) => { assert.equal(id, 'alice'); return { send: async (msg) => { sentMessage = msg; } }; } } };
  const result = await sendPlayerAlert(fakeClient, 'alice', 'structureAttacked', 'tu muro ha sido atacado');
  assert.equal(result, true);
  assert.equal(sentMessage, 'tu muro ha sido atacado');
});

test('sendPlayerAlert con components manda un objeto {content, components}, no un string suelto', async () => {
  let sentMessage = null;
  const fakeClient = { users: { fetch: async () => ({ send: async (msg) => { sentMessage = msg; } }) } };
  const fakeRow = { fake: 'row' };
  await sendPlayerAlert(fakeClient, 'alice', 'structureAttacked', 'te han atacado', [fakeRow]);
  assert.deepEqual(sentMessage, { content: 'te han atacado', components: [fakeRow] });
});

test('sendPlayerAlert no lanza si el MD falla (DMs cerrados) — solo devuelve false', async () => {
  const fakeClient = { users: { fetch: async () => { throw new Error('Cannot send messages to this user'); } } };
  const result = await sendPlayerAlert(fakeClient, 'alice', 'structureAttacked', 'hola');
  assert.equal(result, false);
});

test('sendPlayerAlert no hace nada (ni intenta el MD) para un jugador que no existe', async () => {
  let attempted = false;
  const fakeClient = { users: { fetch: async () => { attempted = true; return { send: async () => {} }; } } };
  const result = await sendPlayerAlert(fakeClient, 'nadie', 'fuelLow', 'hola');
  assert.equal(result, false);
  assert.equal(attempted, false);
});
