import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import { makeFakeNamedExports } from './helpers/mockDb.mjs';

function makeStatefulFakeDb() {
  const rows = new Map();

  const handlers = {
    'SELECT session, expires_at FROM rp_ops.web_sessions WHERE sid = ?': {
      get: (sid) => (rows.has(sid) ? { ...rows.get(sid) } : undefined),
    },
    'INSERT INTO rp_ops.web_sessions (sid, session, expires_at) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE session = VALUES(session), expires_at = VALUES(expires_at)': {
      run: (sid, sessionJson, expiresAt) => { rows.set(sid, { session: sessionJson, expires_at: expiresAt }); return { changes: 1 }; },
    },
    'DELETE FROM rp_ops.web_sessions WHERE sid = ?': {
      run: (sid) => ({ changes: rows.delete(sid) ? 1 : 0 }),
    },
    'UPDATE rp_ops.web_sessions SET expires_at = ? WHERE sid = ?': {
      run: (expiresAt, sid) => {
        const row = rows.get(sid);
        if (!row) return { changes: 0 };
        row.expires_at = expiresAt;
        return { changes: 1 };
      },
    },
    'DELETE FROM rp_ops.web_sessions': {
      run: () => { const n = rows.size; rows.clear(); return { changes: n }; },
    },
    'SELECT COUNT(*) AS n FROM rp_ops.web_sessions': {
      get: () => ({ n: rows.size }),
    },
    'DELETE FROM rp_ops.web_sessions WHERE expires_at <= NOW()': {
      run: () => {
        let removed = 0;
        const now = Date.now();
        for (const [sid, row] of [...rows]) {
          if (new Date(`${row.expires_at.replace(' ', 'T')}Z`).getTime() <= now) { rows.delete(sid); removed++; }
        }
        return { changes: removed };
      },
    },
  };

  return {
    prepare(sql) {
      const key = sql.trim().replace(/\s+/g, ' ');
      const handler = handlers[key];
      if (!handler) throw new Error(`Sentencia SQL no reconocida en el stub de test: ${key}`);
      return handler;
    },
    exec: () => {},
    pragma: () => {},
    transaction: (fn) => (...args) => fn(...args),
    close: () => {},
    _rows: rows,
  };
}

const fakeDb = makeStatefulFakeDb();
mock.module('../src/database/index.js', { defaultExport: fakeDb, namedExports: makeFakeNamedExports(fakeDb) });

const { MysqlSessionStore, pruneExpiredSessions } = await import('../src/services/mysqlSessionStore.js');

function future(ms) { return new Date(Date.now() + ms).toISOString(); }
function past(ms) { return new Date(Date.now() - ms).toISOString(); }

test('set() guarda la sesión y get() la recupera igual', async () => {
  const store = new MysqlSessionStore();
  const sessionData = { cookie: { expires: future(3600_000) }, user: { id: '42' } };

  await store.set('sid-1', sessionData, (err) => assert.equal(err, null));
  await store.get('sid-1', (err, data) => {
    assert.equal(err, null);
    assert.deepEqual(data, sessionData);
  });
});

test('get() de un sid inexistente devuelve null, sin error', async () => {
  const store = new MysqlSessionStore();
  await store.get('no-existe', (err, data) => {
    assert.equal(err, null);
    assert.equal(data, null);
  });
});

test('destroy() borra la fila — un get() posterior ya no la encuentra', async () => {
  const store = new MysqlSessionStore();
  await store.set('sid-2', { cookie: { expires: future(3600_000) } }, () => {});
  await store.destroy('sid-2', (err) => assert.equal(err, null));
  await store.get('sid-2', (err, data) => assert.equal(data, null));
});

test('touch() actualiza la caducidad sin tocar el contenido de la sesión', async () => {
  const store = new MysqlSessionStore();
  const original = { cookie: { expires: future(1000) }, user: { id: '7' } };
  await store.set('sid-3', original, () => {});
  await store.touch('sid-3', { cookie: { expires: future(999_999) } }, (err) => assert.equal(err, null));
  await store.get('sid-3', (err, data) => {
    assert.deepEqual(data, original, 'touch no debe reescribir el contenido, solo la caducidad');
  });
});

test('get() de una sesión ya caducada la trata como inexistente y la limpia', async () => {
  const store = new MysqlSessionStore();
  await store.set('sid-4', { cookie: { expires: past(1000) } }, () => {});
  await store.get('sid-4', (err, data) => {
    assert.equal(err, null);
    assert.equal(data, null, 'una sesión con cookie.expires en el pasado no debe devolverse como válida');
  });
});

test('pruneExpiredSessions() elimina solo las sesiones caducadas, conserva las vivas', async () => {
  const store = new MysqlSessionStore();
  await store.set('vive',  { cookie: { expires: future(3600_000) } }, () => {});
  await store.set('murio', { cookie: { expires: past(1000) } }, () => {});

  const removed = await pruneExpiredSessions();
  assert.equal(removed, 1);

  await store.get('vive',  (err, data) => assert.ok(data, 'la sesión viva debe seguir ahí'));
  await store.get('murio', (err, data) => assert.equal(data, null, 'la sesión caducada debe haber desaparecido'));
});

test('sin cookie.expires, set() usa un TTL por defecto (no lanza, y la sesión es recuperable de inmediato)', async () => {
  const store = new MysqlSessionStore();
  const sessionData = { user: { id: '99' } };
  await assert.doesNotReject(() => store.set('sid-sin-cookie', sessionData, () => {}));
  await store.get('sid-sin-cookie', (err, data) => {
    assert.equal(err, null);
    assert.deepEqual(data, sessionData);
  });
});
