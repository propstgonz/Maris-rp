import fs from 'node:fs';
import path from 'node:path';
import { queryOne, execute, whenReady } from '../src/database/index.js';
import { T } from '../src/database/tables.js';

await whenReady;

let pass = 0, fail = 0;
function check(label, cond, extra = '') {
  if (cond) { pass++; console.log(`OK   ${label}`); }
  else { fail++; console.error(`FALLA ${label} ${extra}`); }
}

const { requireAuth, requireSession, requirePlayer } = await import('../src/mapServer/middleware/auth.js');
const { buildWorldView, isWithinView, VIEW_RADIUS, NoCharacterError } =
  await import('../src/services/worldMapService.js');

async function runGuard(guard, user) {
  const req = {
    session: user ? { user, lastActivity: Date.now(), destroy: () => {} } : {},
    get: () => undefined,
  };
  let status = null, body = null, passed = false;
  const res = {
    status(code) { status = code; return this; },
    json(payload) { body = payload; return this; },
  };
  await guard(req, res, () => { passed = true; });
  return { passed, status, body };
}

const STAFF      = { id: '1', username: 'staff',   isRolepriest: true,  hasCharacter: false };
const PRIEST     = { id: '2', username: 'priest',  isRolepriest: true,  hasCharacter: false };
const JUGADOR    = { id: '3', username: 'jugador', isRolepriest: false, hasCharacter: true };
const SIN_PJ     = { id: '4', username: 'nuevo',   isRolepriest: false, hasCharacter: false };
const STAFF_CONPJ= { id: '5', username: 'staffpj', isRolepriest: true,  hasCharacter: true };

check('permisos: sin sesion, requireAuth responde 401', (await runGuard(requireAuth, null)).status === 401);
check('permisos: Staff pasa requireAuth', (await runGuard(requireAuth, STAFF)).passed);
check('permisos: Rolepriest pasa requireAuth', (await runGuard(requireAuth, PRIEST)).passed);

const escalada = await runGuard(requireAuth, JUGADOR);
check('permisos: un JUGADOR con sesion NO pasa requireAuth (no hereda el panel)',
      !escalada.passed && escalada.status === 403, JSON.stringify(escalada));

check('permisos: un jugador SI pasa requirePlayer', (await runGuard(requirePlayer, JUGADOR)).passed);
check('permisos: sin personaje NO pasa requirePlayer (403, no 401)',
      (await runGuard(requirePlayer, SIN_PJ)).status === 403);
check('permisos: Staff CON personaje pasa requirePlayer (puede rolear)',
      (await runGuard(requirePlayer, STAFF_CONPJ)).passed);
check('permisos: Staff SIN personaje no pasa requirePlayer (no hay desde donde mirar)',
      !(await runGuard(requirePlayer, STAFF)).passed);
check('permisos: requireSession deja pasar a cualquiera con sesion viva',
      (await runGuard(requireSession, JUGADOR)).passed && (await runGuard(requireSession, STAFF)).passed);
check('permisos: requireSession sigue rechazando sin sesion', (await runGuard(requireSession, null)).status === 401);

{
  const dir = 'src/mapServer/routes';
  const sospechosas = [];
  for (const file of fs.readdirSync(dir)) {
    if (!file.endsWith('.js')) continue;
    const src = fs.readFileSync(path.join(dir, file), 'utf8');
    for (const line of src.split('\n')) {
      if (!/router\.(get|post|patch|put|delete)\(/.test(line)) continue;
      if (!line.includes('requireSession')) continue;
      if (line.includes('/api/me')) continue;
      if (line.includes('/api/game/character')) continue;
      sospechosas.push(`${file}: ${line.trim()}`);
    }
  }
  check('permisos: solo /api/me y /api/game/character usan el guard sin rol', sospechosas.length === 0, sospechosas.join(' | '));

  const tiles = fs.readFileSync(path.join(dir, 'tiles.js'), 'utf8');
  const escrituras = tiles.split('\n').filter(l => /router\.(post|patch|delete)\(/.test(l));
  check('permisos: toda escritura de casillas lleva guard de rol',
        escrituras.length > 0 && escrituras.every(l => l.includes('requireAuth') || l.includes('requireRole')),
        escrituras.filter(l => !l.includes('require')).join(' | '));
}

const terr = (await queryOne(`SELECT id FROM ${T.terrain_types} LIMIT 1`))?.id;
if (!terr) {
  console.error('FALLA vista: no hay terrain_types sembrados');
  fail++;
} else {
  const tile = async (x, y, name) => {
    await execute(`INSERT IGNORE INTO ${T.map_tiles} (coord_x, coord_y, name, terrain_type_id) VALUES (?, ?, ?, ?)`,
      [x, y, name, terr]);
    return (await queryOne(`SELECT id FROM ${T.map_tiles} WHERE coord_x=? AND coord_y=?`, [x, y])).id;
  };
  for (let dx = -6; dx <= 6; dx++) for (let dy = -6; dy <= 6; dy++) await tile(50 + dx, 50 + dy, `wm ${dx},${dy}`);
  const lejana = await tile(90, 90, 'SECRETO_LEJANO');

  const jugador = async (id, name, x, y) => {
    await execute(`INSERT IGNORE INTO ${T.players} (discord_id, username, character_name, character_created_at, is_alive, coord_x, coord_y)
                VALUES (?, ?, ?, NOW(), 1, ?, ?)`, [id, name, name, x, y]);
    await execute(`UPDATE ${T.players} SET coord_x=?, coord_y=? WHERE discord_id=?`, [x, y, id]);
  };
  await jugador('900000000000000001', 'wmYo',    50, 50);
  await jugador('900000000000000002', 'wmCerca', 52, 51);
  await jugador('900000000000000003', 'wmBorde', 54, 50);
  await jugador('900000000000000004', 'wmLejos', 60, 50);
  await jugador('900000000000000005', 'wmSecreto', 90, 90);

  await execute(`INSERT IGNORE INTO ${T.construction_types} (name, display_name, emoji, laburo_cost, max_health)
              VALUES ('bunker_wm','Búnker secreto','🕳️',0,10)`);
  const ctId = (await queryOne(`SELECT id FROM ${T.construction_types} WHERE name='bunker_wm'`)).id;
  await execute(`INSERT INTO ${T.constructions} (tile_id, name, construction_type_id, current_health) VALUES (?, 'Búnker secreto', ?, 10)`,
    [lejana, ctId]);

  const vista = await buildWorldView('900000000000000001');
  const json = JSON.stringify(vista);

  check('vista: el radio por defecto es 4', vista.radius === VIEW_RADIUS && VIEW_RADIUS === 4);
  check('vista: te centra en TU posicion real', vista.me.x === 50 && vista.me.y === 50);
  check('vista: las casillas visibles son exactamente el disco de radio 4',
        vista.visible.every(t => isWithinView({ x: 50, y: 50 }, { x: t.coord_x, y: t.coord_y })));
  check('vista: no se cuela ninguna casilla de fuera del radio',
        !vista.visible.some(t => t.coord_x === 90 && t.coord_y === 90));

  const nombres = vista.players.map(p => p.characterName);
  check('vista: aparece quien esta a 2 casillas', nombres.includes('wmCerca'));
  check('vista: aparece quien esta justo en el borde (4)', nombres.includes('wmBorde'));
  check('vista: NO aparece quien esta a 10 casillas', !nombres.includes('wmLejos'));
  check('vista: NO aparece quien esta al otro lado del mapa', !nombres.includes('wmSecreto'));
  check('vista: no te incluye a ti mismo en la lista de otros', !nombres.includes('wmYo'));

  check('vista: NO se filtra la construccion lejana', !vista.constructions.some(c => c.name === 'Búnker secreto'));
  check('vista: el nombre del bunker no aparece en NINGUN sitio del payload',
        !json.includes('Búnker secreto'));
  check('vista: el nombre de la casilla lejana tampoco', !json.includes('SECRETO_LEJANO'));

  check('vista: la silueta es un array plano de enteros',
        Array.isArray(vista.outline) && vista.outline.every(Number.isInteger));
  check('vista: la silueta incluye la casilla lejana (se ve que EXISTE)',
        (() => { for (let i = 0; i < vista.outline.length; i += 2)
                   if (vista.outline[i] === 90 && vista.outline[i + 1] === 90) return true;
                 return false; })());
  check('vista: la silueta tiene un par por casilla del mundo',
        vista.outline.length === 2 * (await queryOne(`SELECT COUNT(*) n FROM ${T.map_tiles}`)).n);

  check('vista: no viaja ningun discord_id de otra persona',
        !json.includes('900000000000000002') && !json.includes('900000000000000005'));
  check('vista: no viaja ningun @usuario de Discord', !/"username"/.test(json));

  await execute(`UPDATE ${T.players} SET coord_x=90, coord_y=90 WHERE discord_id=?`, ['900000000000000001']);
  const movida = await buildWorldView('900000000000000001');
  check('vista: al moverse el personaje, la vista se mueve con el',
        movida.me.x === 90 && movida.me.y === 90);
  check('vista: desde alli SI se ve el bunker (la visibilidad depende de donde estas)',
        movida.constructions.some(c => c.name === 'Búnker secreto'));
  check('vista: y ya NO se ve a quien quedo en (50,50)',
        !movida.players.map(p => p.characterName).includes('wmCerca'));

  let sinPj = null;
  try { await buildWorldView('999999999999999999'); } catch (err) { sinPj = err; }
  check('vista: sin personaje lanza NoCharacterError', sinPj instanceof NoCharacterError);
}

console.log(`\n${pass} pasaron, ${fail} fallaron.`);
process.exit(fail > 0 ? 1 : 0);
