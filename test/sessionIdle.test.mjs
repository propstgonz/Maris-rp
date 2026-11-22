import { test, mock } from 'node:test';
import assert from 'node:assert/strict';

mock.module('../src/services/settingsService.js', {
  namedExports: {
    getSetting: async (_key, fallback) => fallback,
    setSetting: async () => {},
  },
});

const { isSessionActive } = await import('../src/api/middleware/auth.js');

function fakeReq(session) {
  let destroyed = false;
  return {
    session: {
      ...session,
      destroy(cb) { destroyed = true; cb?.(); },
    },
    get: () => undefined,
    wasDestroyed: () => destroyed,
  };
}

test('una sesión reciente sigue activa y se le renueva lastActivity', async () => {
  const req = fakeReq({ user: { id: '1' }, lastActivity: Date.now() - 1000 });
  assert.equal(await isSessionActive(req), true);
  assert.ok(Date.now() - req.session.lastActivity < 1000);
});

test('una sesión inactiva se rechaza SIN destruirla', async () => {
  const req = fakeReq({ user: { id: '1' }, lastActivity: Date.now() - 31 * 60 * 1000 });
  assert.equal(await isSessionActive(req), false);
  assert.equal(req.wasDestroyed(), false);
});

test('una sesión sin lastActivity se rechaza SIN destruirla', async () => {
  const req = fakeReq({ user: { id: '1' } });
  assert.equal(await isSessionActive(req), false);
  assert.equal(req.wasDestroyed(), false);
});

test('una sesión a medio login (sin user) se rechaza sin tocar el store', async () => {
  const req = fakeReq({ oauthState: 'abc' });
  assert.equal(await isSessionActive(req), false);
  assert.equal(req.wasDestroyed(), false);
});
