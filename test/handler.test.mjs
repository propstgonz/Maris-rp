import { test } from 'node:test';
import assert from 'node:assert/strict';
import { handler } from '../src/api/utils/handler.js';
import { UserFacingError } from '../src/utils/errors.js';

function makeFakeRes() {
  const res = { statusCode: null, body: null };
  res.status = (code) => { res.statusCode = code; return res; };
  res.json = (body) => { res.body = body; return res; };
  return res;
}
const fakeReq = { method: 'POST', path: '/api/test' };

test('UserFacingError responde 400 con el mensaje literal', async () => {
  const wrapped = handler(async () => { throw new UserFacingError('Ese ítem no existe en el catálogo.'); });
  const res = makeFakeRes();
  await wrapped(fakeReq, res, () => {});
  assert.equal(res.statusCode, 400);
  assert.equal(res.body.error, 'Ese ítem no existe en el catálogo.');
});

test('un error MySQL con código conocido responde 400 con la traducción, no el mensaje crudo', async () => {
  const wrapped = handler(async () => {
    const err = new Error("Duplicate entry 'hierro' for key 'items.name'");
    err.code = 'ER_DUP_ENTRY';
    throw err;
  });
  const res = makeFakeRes();
  await wrapped(fakeReq, res, () => {});
  assert.equal(res.statusCode, 400);
  assert.equal(res.body.error, 'Ya existe un registro con ese nombre o clave única.');
});

test('un error MySQL sin traducción conocida responde 500 genérico, no el mensaje crudo', async () => {
  const wrapped = handler(async () => {
    const err = new Error('Unknown column x in field list');
    err.code = 'ER_BAD_FIELD_ERROR';
    throw err;
  });
  const res = makeFakeRes();
  await wrapped(fakeReq, res, () => {});
  assert.equal(res.statusCode, 500);
  assert.equal(res.body.error, 'Error interno del servidor.');
});

test('un TypeError (bug real) responde 500 genérico, no el mensaje crudo', async () => {
  const wrapped = handler(async () => {
    let x;
    x.foo();
  });
  const res = makeFakeRes();
  await wrapped(fakeReq, res, () => {});
  assert.equal(res.statusCode, 500);
  assert.equal(res.body.error, 'Error interno del servidor.');
});

test('un Error normal de servicio (sin código MySQL) sigue respondiendo 400 con su mensaje, como antes', async () => {
  const wrapped = handler(async () => { throw new Error('Debes especificar al menos un campo para editar.'); });
  const res = makeFakeRes();
  await wrapped(fakeReq, res, () => {});
  assert.equal(res.statusCode, 400);
  assert.equal(res.body.error, 'Debes especificar al menos un campo para editar.');
});
