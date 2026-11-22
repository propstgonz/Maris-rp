import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildCustomId, parseCustomId, assertComponentAccess,
  PUBLIC_OWNER, DEFAULT_COMPONENT_TTL_MS,
} from '../src/utils/componentAuth.js';

const OWNER = '1000141861333258393';

function fakeInteraction({ userId = OWNER, messageAgeMs = 0 } = {}) {
  return {
    user: { id: userId },
    message: { createdTimestamp: Date.now() - messageAgeMs },
  };
}

test('buildCustomId arma el formato posicional ns:action:owner:ctx', () => {
  assert.equal(buildCustomId({ ns: 'craft', action: 'go', owner: OWNER, ctx: '42' }), `craft:go:${OWNER}:42`);
});

test('buildCustomId admite ctx vacío (pasos sin datos, p.ej. cancelar)', () => {
  assert.equal(buildCustomId({ ns: 'craft', action: 'cancel', owner: OWNER }), `craft:cancel:${OWNER}:`);
});

test('buildCustomId exige owner explícito — omitirlo es un error de programación, no un "público"', () => {
  assert.throws(() => buildCustomId({ ns: 'atk', action: 'go' }), /falta "owner"/);
});

test('buildCustomId rechaza ":" en cualquier campo (rompería el parseo posicional)', () => {
  assert.throws(() => buildCustomId({ ns: 'a:b', action: 'go', owner: OWNER }), /no puede contener/);
  assert.throws(() => buildCustomId({ ns: 'atk', action: 'go', owner: OWNER, ctx: '1:2' }), /no puede contener/);
});

test('buildCustomId falla RÁPIDO si se pasa de los 100 chars de Discord', () => {
  assert.throws(
    () => buildCustomId({ ns: 'atk', action: 'go', owner: OWNER, ctx: 'x'.repeat(80) }),
    /Discord admite 100/
  );
});

test('buildCustomId: un ctx realista del flujo de ataque encadenado SÍ cabe', () => {
  const id = buildCustomId({ ns: 'atk', action: 'go', owner: OWNER, ctx: 'npc.123456.789' });
  assert.ok(id.length <= 100, `mide ${id.length}`);
});

test('parseCustomId deshace exactamente lo que hizo buildCustomId', () => {
  const id = buildCustomId({ ns: 'inv', action: 'page', owner: OWNER, ctx: '3' });
  assert.deepEqual(parseCustomId(id), { ns: 'inv', action: 'page', owner: OWNER, ctx: '3' });
});

test('parseCustomId devuelve null para los customId ANTIGUOS de otros flujos', () => {
  assert.equal(parseCustomId('craftchoose:42:123'), null);
  assert.equal(parseCustomId('trade_accept:7'), null);
  assert.equal(parseCustomId('npc_encounter_attack:9'), null);
});

test('parseCustomId devuelve null ante basura o tipos raros', () => {
  assert.equal(parseCustomId(''), null);
  assert.equal(parseCustomId(null), null);
  assert.equal(parseCustomId(undefined), null);
  assert.equal(parseCustomId('a:b:c:d:e'), null);
  assert.equal(parseCustomId('::x:'), null);
});

test('assertComponentAccess deja pasar al dueño', () => {
  const parsed = parseCustomId(buildCustomId({ ns: 'craft', action: 'go', owner: OWNER, ctx: '1' }));
  assert.doesNotThrow(() => assertComponentAccess(fakeInteraction(), parsed));
});

test('assertComponentAccess BLOQUEA a otro usuario — el fallo G16 que motivó este módulo', () => {
  const parsed = parseCustomId(buildCustomId({ ns: 'atk', action: 'go', owner: OWNER, ctx: 'npc.1.2' }));
  assert.throws(
    () => assertComponentAccess(fakeInteraction({ userId: '999999999999999999' }), parsed),
    /no es tuyo/
  );
});

test('assertComponentAccess deja pasar a cualquiera si el componente es PUBLIC_OWNER', () => {
  const parsed = parseCustomId(buildCustomId({ ns: 'help', action: 'page', owner: PUBLIC_OWNER, ctx: '2' }));
  assert.doesNotThrow(() => assertComponentAccess(fakeInteraction({ userId: '999999999999999999' }), parsed));
});

test('assertComponentAccess rechaza un menú caducado (por edad del MENSAJE, sin estado en memoria)', () => {
  const parsed = parseCustomId(buildCustomId({ ns: 'craft', action: 'go', owner: OWNER, ctx: '1' }));
  assert.throws(
    () => assertComponentAccess(fakeInteraction({ messageAgeMs: DEFAULT_COMPONENT_TTL_MS + 1000 }), parsed),
    /caducado/
  );
});

test('assertComponentAccess: la caducidad es configurable por flujo', () => {
  const parsed = parseCustomId(buildCustomId({ ns: 'atk', action: 'go', owner: OWNER, ctx: '1' }));
  const i = fakeInteraction({ messageAgeMs: 90_000 });
  assert.throws(() => assertComponentAccess(i, parsed, { ttlMs: 60_000 }), /caducado/);
  assert.doesNotThrow(() => assertComponentAccess(i, parsed, { ttlMs: 120_000 }));
});

test('assertComponentAccess: la autoría se comprueba ANTES que la caducidad', () => {
  const parsed = parseCustomId(buildCustomId({ ns: 'craft', action: 'go', owner: OWNER, ctx: '1' }));
  assert.throws(
    () => assertComponentAccess(fakeInteraction({ userId: '999999999999999999', messageAgeMs: 10 ** 9 }), parsed),
    /no es tuyo/
  );
});

test('assertComponentAccess no revienta si la interacción no trae mensaje (modales)', () => {
  const parsed = parseCustomId(buildCustomId({ ns: 'craft', action: 'go', owner: OWNER, ctx: '1' }));
  assert.doesNotThrow(() => assertComponentAccess({ user: { id: OWNER } }, parsed));
});
