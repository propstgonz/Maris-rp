import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkConstructionPolicy, describeConstructionPolicy } from '../src/utils/constructionPolicy.js';

const construction = { builtByPlayerId: 42, tileFactionId: 7 };

test("'any' siempre permite, sea quien sea el actor", () => {
  assert.equal(checkConstructionPolicy('any', construction, { playerId: 999, factionId: 999, isRolepriest: false }), true);
});

test("'owner' permite solo a quien la construyó", () => {
  assert.equal(checkConstructionPolicy('owner', construction, { playerId: 42, factionId: null, isRolepriest: false }), true);
  assert.equal(checkConstructionPolicy('owner', construction, { playerId: 43, factionId: null, isRolepriest: false }), false);
});

test("'owner' con builtByPlayerId null (instancia antigua sin dueño registrado) rechaza a todo el mundo salvo Rolepriest", () => {
  const orphan = { builtByPlayerId: null, tileFactionId: 7 };
  assert.equal(checkConstructionPolicy('owner', orphan, { playerId: 1, factionId: null, isRolepriest: false }), false);
});

test("'faccion' permite solo a jugadores de la misma facción que la casilla", () => {
  assert.equal(checkConstructionPolicy('faccion', construction, { playerId: 1, factionId: 7, isRolepriest: false }), true);
  assert.equal(checkConstructionPolicy('faccion', construction, { playerId: 1, factionId: 8, isRolepriest: false }), false);
});

test("'faccion' rechaza a un jugador SIN facción (factionId null), aunque la casilla sí tenga una", () => {
  assert.equal(checkConstructionPolicy('faccion', construction, { playerId: 1, factionId: null, isRolepriest: false }), false);
});

test("'faccion' rechaza si la CASILLA no tiene facción (territorio neutral), aunque el jugador sí tenga una", () => {
  const neutral = { builtByPlayerId: 42, tileFactionId: null };
  assert.equal(checkConstructionPolicy('faccion', neutral, { playerId: 1, factionId: 7, isRolepriest: false }), false);
});

test("'rolepriest' rechaza a cualquier jugador normal, sea quien sea", () => {
  assert.equal(checkConstructionPolicy('rolepriest', construction, { playerId: 42, factionId: 7, isRolepriest: false }), false);
});

test('Rolepriest se salta CUALQUIER política, incluida owner/faccion/rolepriest', () => {
  const actor = { playerId: 999, factionId: 999, isRolepriest: true };
  assert.equal(checkConstructionPolicy('owner', construction, actor), true);
  assert.equal(checkConstructionPolicy('faccion', construction, actor), true);
  assert.equal(checkConstructionPolicy('rolepriest', construction, actor), true);
});

test('un valor de política desconocido en BD falla ABIERTO a "any" en vez de bloquear el juego', () => {
  assert.equal(checkConstructionPolicy('algo-que-no-deberia-existir', construction, { playerId: 1, factionId: 1, isRolepriest: false }), true);
});

test('describeConstructionPolicy da un texto legible para cada política', () => {
  assert.equal(describeConstructionPolicy('owner'), 'solo quien la construyó');
  assert.equal(describeConstructionPolicy('faccion'), 'solo jugadores de la misma facción que esta casilla');
  assert.equal(describeConstructionPolicy('rolepriest'), 'solo un Rolepriest');
});
