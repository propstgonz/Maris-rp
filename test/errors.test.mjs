import { test } from 'node:test';
import assert from 'node:assert/strict';
import { UserFacingError } from '../src/utils/errors.js';

test('UserFacingError es una Error de verdad (instanceof Error también)', () => {
  const err = new UserFacingError('mensaje de prueba');
  assert.ok(err instanceof Error);
  assert.ok(err instanceof UserFacingError);
});

test('UserFacingError conserva el mensaje y el nombre', () => {
  const err = new UserFacingError('no tienes suficiente Laburo');
  assert.equal(err.message, 'no tienes suficiente Laburo');
  assert.equal(err.name, 'UserFacingError');
});

test('un Error normal NO es instanceof UserFacingError (para el catch central)', () => {
  const err = new Error('fallo interno cualquiera');
  assert.equal(err instanceof UserFacingError, false);
});

test('UserFacingError se puede lanzar y capturar como cualquier Error', () => {
  function fnQueLanza() {
    throw new UserFacingError('validación de negocio');
  }
  assert.throws(fnQueLanza, UserFacingError);
  assert.throws(fnQueLanza, /validación de negocio/);
});
