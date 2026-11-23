import http from 'node:http';

let pass = 0, fail = 0;
function check(label, cond) {
  if (cond) { pass++; console.log(`✅ ${label}`); }
  else { fail++; console.error(`❌ ${label}`); }
}

process.env.CLIENT_ID = 'ci-fake-client-id';
process.env.DISCORD_CLIENT_SECRET = 'ci-fake-secret';
process.env.GUILD_ID = 'ci-fake-guild-id';
process.env.DISCORD_TOKEN = 'ci-fake-token';
process.env.API_PUBLIC_URL = 'http://localhost:3000';
process.env.API_SESSION_SECRET = 'ci-fake-session-secret';
process.env.API_PORT = '0';
process.env.NGINX_BASE_URL = 'https://rp-bucket.example.com';

let server;
try {
  const { app } = await import('../src/apiServer.js');
  check('src/apiServer.js se importa sin lanzar (migraciones + rutas OK)', true);

  const { whenReady } = await import('../src/database/index.js');
  await whenReady;

  server = app.listen(0);
  await new Promise((resolve, reject) => {
    server.once('listening', resolve);
    server.once('error', reject);
  });
  const port = server.address().port;

  function get(path) {
    return new Promise((resolve, reject) => {
      http.get({ hostname: '127.0.0.1', port, path }, (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => resolve({ statusCode: res.statusCode, body: Buffer.concat(chunks).toString() }));
      }).on('error', reject);
    });
  }

  const root = await get('/');
  check('GET / responde 404 (el panel vive en apps/web, aquí solo hay API)', root.statusCode === 404);

  const avatar = await get('/static/default-avatar.svg');
  check('GET /static/default-avatar.svg responde 200', avatar.statusCode === 200);

  const me = await get('/api/me');
  check('GET /api/me sin sesión responde 401', me.statusCode === 401);

  const ficha = await get('/api/players/123/ficha');
  check('GET /api/players/123/ficha sin sesión responde 401', ficha.statusCode === 401);

  const tiles = await get('/api/tiles');
  check('GET /api/tiles responde 404 (el mapa ya no existe)', tiles.statusCode === 404);

  const logoutGet = await get('/auth/logout');
  check('GET /auth/logout ya no cierra sesión (404)', logoutGet.statusCode === 404);

  const logoutPost = await new Promise((resolve, reject) => {
    const req = http.request({ hostname: '127.0.0.1', port, path: '/auth/logout', method: 'POST' }, res => {
      res.resume();
      res.on('end', () => resolve(res.statusCode));
    });
    req.on('error', reject);
    req.end();
  });
  check('POST /auth/logout sin token CSRF responde 403', logoutPost === 403);

  const mapa = await get('/api/mapamundi/vista');
  check('GET /api/mapamundi/vista responde 404', mapa.statusCode === 404);
} catch (err) {
  fail++;
  console.error('❌ El servidor no ha arrancado o ha lanzado una excepción:', err);
} finally {
  if (server) await new Promise((resolve) => server.close(resolve));
}

console.log(`\n${pass} pasaron, ${fail} fallaron.`);
process.exit(fail > 0 ? 1 : 0);
