import { createConnection } from 'mysql2/promise';
import { readdirSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { runMigrations } from '../src/database/migrate.js';
import { SCHEMAS } from '../src/database/tables.js';

const LEGACY_LAST_FILE = '034_rp_world_npc_type_faction.sql';
const TOLERANCE = 0.01;

const config = {
  host:     process.env.DB_HOST ?? '127.0.0.1',
  port:     Number(process.env.DB_PORT ?? 3306),
  user:     process.env.DB_USER ?? 'root',
  password: process.env.DB_PASSWORD ?? '',
};

const currentMode = process.argv.includes('--current');

const CONTRACT_TABLES = {
  rp_players: [
    'players', 'character_registry', 'newspapers', 'races', 'menhirs', 'marriages', 'marriage_members',
    'player_npcs', 'consent_requests', 'schools', 'mastery_levels', 'school_progress', 'magic_attempts', 'spells',
  ],
  rp_world: ['property_types', 'properties'],
  rp_economy: ['items', 'item_categories', 'inventory'],
};

const CONTRACT_COLUMNS = {
  'rp_players.players': [
    'id', 'discord_id', 'username', 'character_name', 'avatar_filename', 'gender', 'age', 'race_id', 'menhir_id',
    'stat_potencia', 'stat_intuicion', 'stat_chiripa', 'stat_autismo', 'stat_resistencia', 'stat_donjuanismo',
    'stat_agilidad', 'stat_bonus_points', 'free_school_claimed_at', 'is_alive', 'died_at', 'character_created_at',
    'character_reset_at', 'modmail_channel_id', 'created_at', 'updated_at',
  ],
  'rp_economy.items': ['id', 'name', 'display_name', 'description', 'emoji', 'category_id', 'is_active', 'created_at'],
  'rp_economy.inventory': ['id', 'player_id', 'item_id', 'quantity'],
  'rp_world.properties': ['id', 'owner_player_id', 'property_type_id', 'name', 'level', 'location', 'created_at'],
  'rp_world.property_types': ['id', 'name', 'display_name', 'category', 'description', 'emoji', 'is_active', 'created_at'],
};

const EXPECTED_SPELLS = { destruccion: 21, alteracion: 15, restauracion: 11, ilusion: 14, conjuracion: 14 };

const failures = [];

function check(label, ok, detail = '') {
  console.log(`  [${ok ? 'OK' : 'FALLO'}] ${label}${detail ? ` ${detail}` : ''}`);
  if (!ok) failures.push(label);
}

async function scalar(conn, sql) {
  const [[row]] = await conn.query(sql);
  return Number(Object.values(row)[0]);
}

async function tableExists(conn, schema, table) {
  return (await scalar(conn, `SELECT COUNT(*) FROM information_schema.TABLES WHERE TABLE_SCHEMA = '${schema}' AND TABLE_NAME = '${table}'`)) > 0;
}

async function insertAndGetId(conn, sql) {
  const [result] = await conn.query(sql);
  return result.insertId;
}

async function seedLegacyFixture(conn) {
  const p1 = await insertAndGetId(conn, "INSERT INTO rp_players.players (discord_id, username, character_name, full_name, nationality) VALUES ('1001', 'ana', 'Ana Vela', 'Ana Vela Ruiz', 'Nordica')");
  const p2 = await insertAndGetId(conn, "INSERT INTO rp_players.players (discord_id, username, character_name) VALUES ('1002', 'borja', 'Borja Ruz')");
  const p3 = await insertAndGetId(conn, "INSERT INTO rp_players.players (discord_id, username, character_name) VALUES ('1003', 'carla', 'Carla Sol')");

  const f1 = await insertAndGetId(conn, `INSERT INTO rp_players.factions (name, display_name, owner_player_id) VALUES ('norte', 'Norte', ${p1})`);
  const f2 = await insertAndGetId(conn, 'INSERT INTO rp_players.factions (name, display_name, owner_player_id) VALUES (\'huerfana\', \'Huerfana\', NULL)');
  await conn.query(`UPDATE rp_players.players SET faction_id = ${f1} WHERE id IN (${p1}, ${p2})`);

  await conn.query("INSERT INTO rp_economy.item_categories (name, display_name) VALUES ('metales', 'Metales')");
  const item = async (name, type, category = null) => insertAndGetId(conn,
    `INSERT INTO rp_economy.items (name, display_name, item_type, category_name) VALUES ('${name}', '${name}', '${type}', ${category ? `'${category}'` : 'NULL'})`);
  const platas = await item('platas', 'dinero');
  const hierro = await item('hierro', 'recurso', 'metales');
  const martillo = await item('martillo', 'herramienta');
  const espada = await item('espada', 'arma');
  const pan = await item('pan', 'consumible');
  const carreta = await item('carreta', 'vehiculo');
  const puntos = await item('puntos_laburo', 'laburo');

  const inv = (player, itemId, qty) => conn.query(`INSERT INTO rp_economy.inventory (player_id, item_id, quantity, durability, slot_position) VALUES (${player}, ${itemId}, ${qty}, 5, 1)`);
  await inv(p1, platas, 120.5);
  await inv(p1, hierro, 10);
  await inv(p2, platas, 40);
  await inv(p2, pan, 3);
  await inv(p3, espada, 1);
  await inv(p3, hierro, 0);
  await inv(p3, carreta, 1);

  await conn.query(`INSERT INTO rp_players.faction_storage (faction_id, item_id, quantity) VALUES (${f1}, ${platas}, 15.25), (${f1}, ${hierro}, 4), (${f2}, ${platas}, 99)`);

  const t1 = await insertAndGetId(conn, "INSERT INTO rp_world.map_tiles (coord_x, coord_y, terrain_type_id) VALUES (1, 1, 1)");
  const t2 = await insertAndGetId(conn, "INSERT INTO rp_world.map_tiles (coord_x, coord_y, terrain_type_id) VALUES (2, 1, 2)");
  await conn.query(`INSERT INTO rp_world.tile_items (tile_id, item_id, quantity) VALUES (${t1}, ${platas}, 77), (${t2}, ${hierro}, 5)`);

  const ct = async (name) => insertAndGetId(conn, `INSERT INTO rp_world.construction_types (name, display_name) VALUES ('${name}', '${name}')`);
  const casa = await ct('casa');
  const granja = await ct('granja');
  await ct('fortin');

  const cons = async (tile, name, owner, type) => insertAndGetId(conn,
    `INSERT INTO rp_world.constructions (tile_id, name, built_by_player_id, construction_type_id) VALUES (${tile}, '${name}', ${owner ?? 'NULL'}, ${type ?? 'NULL'})`);
  const c1 = await cons(t1, 'Casa de Ana', p1, casa);
  const c2 = await cons(t2, 'Granja de Borja', p2, granja);
  const c3 = await cons(t1, 'Casa abandonada', null, casa);
  const c4 = await cons(t2, 'Obra sin tipo', p1, null);
  await conn.query(`INSERT INTO rp_world.construction_storage (construction_id, item_id, quantity) VALUES
    (${c1}, ${hierro}, 6.5), (${c2}, ${pan}, 8), (${c3}, ${platas}, 500), (${c4}, ${hierro}, 2)`);

  const nt1 = await insertAndGetId(conn, "INSERT INTO rp_world.npc_types (name, display_name) VALUES ('guardia', 'Guardia')");
  const nt2 = await insertAndGetId(conn, "INSERT INTO rp_world.npc_types (name, display_name) VALUES ('lobo', 'Lobo')");
  const npc = async (tile, type, owner) => insertAndGetId(conn,
    `INSERT INTO rp_world.npcs (tile_id, npc_type_id, current_hp, owner_player_id) VALUES (${tile}, ${type}, 5, ${owner ?? 'NULL'})`);
  const n1 = await npc(t1, nt1, p1);
  await npc(t1, nt1, p1);
  const n3 = await npc(t2, nt1, p2);
  const n4 = await npc(t2, nt2, null);
  await conn.query(`INSERT INTO rp_world.npc_storage (npc_id, item_id, quantity) VALUES (${n1}, ${platas}, 2), (${n4}, ${platas}, 1000)`);
  await conn.query(`INSERT INTO rp_world.npc_inventory (npc_id, item_id, quantity) VALUES (${n3}, ${espada}, 1), (${n3}, ${platas}, 7.75), (${n4}, ${hierro}, 300)`);

  return { puntos, martillo };
}

async function measure(conn) {
  if (!(await tableExists(conn, 'rp_world', 'npcs')) || !(await tableExists(conn, 'rp_players', 'factions'))) return null;
  const players = await scalar(conn, 'SELECT COUNT(*) FROM rp_players.players');
  const ownedNpcs = await scalar(conn, `SELECT COUNT(*) FROM rp_world.npcs n JOIN rp_players.players p ON p.id = n.owner_player_id`);
  const ownedConstructions = await scalar(conn, `SELECT COUNT(*) FROM rp_world.constructions WHERE built_by_player_id IS NOT NULL AND construction_type_id IS NOT NULL`);
  const [rows] = await conn.query(`
    SELECT x.item_id, SUM(x.quantity) AS total FROM (
      SELECT inv.item_id, inv.quantity FROM rp_economy.inventory inv
      UNION ALL
      SELECT cs.item_id, cs.quantity FROM rp_world.construction_storage cs
        JOIN rp_world.constructions c ON c.id = cs.construction_id
        JOIN rp_players.players p ON p.id = c.built_by_player_id
      UNION ALL
      SELECT ns.item_id, ns.quantity FROM rp_world.npc_storage ns
        JOIN rp_world.npcs n ON n.id = ns.npc_id
        JOIN rp_players.players p ON p.id = n.owner_player_id
      UNION ALL
      SELECT ni.item_id, ni.quantity FROM rp_world.npc_inventory ni
        JOIN rp_world.npcs n ON n.id = ni.npc_id
        JOIN rp_players.players p ON p.id = n.owner_player_id
      UNION ALL
      SELECT fs.item_id, fs.quantity FROM rp_players.faction_storage fs
        JOIN rp_players.factions f ON f.id = fs.faction_id
        JOIN rp_players.players p ON p.id = f.owner_player_id
    ) x GROUP BY x.item_id`);
  const sums = new Map(rows.map(r => [r.item_id, Number(r.total)]));
  return { players, ownedNpcs, ownedConstructions, sums };
}

async function columnsOf(conn, qualified) {
  const [schema, table] = qualified.split('.');
  const [rows] = await conn.query(
    'SELECT COLUMN_NAME AS name FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?', [schema, table]);
  return rows.map(r => r.name).sort();
}

async function tablesOf(conn, schema) {
  const [rows] = await conn.query('SELECT TABLE_NAME AS name FROM information_schema.TABLES WHERE TABLE_SCHEMA = ?', [schema]);
  return rows.map(r => r.name).sort();
}

function report(label, m) {
  console.log(`${label}: jugadores=${m.players} npcs_con_dueño=${m.ownedNpcs} construcciones_con_dueño_y_tipo=${m.ownedConstructions} items_distintos=${m.sums.size}`);
}

async function main() {
  const conn = await createConnection({ ...config, timezone: 'Z' });
  try {
    if (!currentMode) {
      if (config.port !== 3399 && process.env.REHEARSAL_ALLOW_ANY_PORT !== '1') {
        throw new Error(`El ensayo borra los esquemas: se niega a correr contra el puerto ${config.port} (usa 3399 o REHEARSAL_ALLOW_ANY_PORT=1).`);
      }
      for (const schema of Object.values(SCHEMAS)) await conn.query(`DROP DATABASE IF EXISTS \`${schema}\``);
      await runMigrations(config, { untilFilename: LEGACY_LAST_FILE });
      await seedLegacyFixture(conn);
      console.log('Fixture antiguo cargado (migraciones 001..034).');
    }

    const before = await measure(conn);
    if (before) report('Antes', before);
    else console.log('Antes: el esquema ya no tiene las tablas antiguas, no hay nada que medir.');

    await runMigrations(config);
    const files = readdirSync(join(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'database', 'migrations', 'mysql')).filter(f => f.endsWith('.sql'));
    const applied = await scalar(conn, 'SELECT COUNT(*) FROM rp_ops.schema_migrations');

    console.log('Después de migrar:');
    check('todas las migraciones registradas', applied === files.length, `(${applied}/${files.length})`);

    const players = await scalar(conn, 'SELECT COUNT(*) FROM rp_players.players');
    const playerNpcs = await scalar(conn, 'SELECT COUNT(*) FROM rp_players.player_npcs');
    const properties = await scalar(conn, 'SELECT COUNT(*) FROM rp_world.properties');
    console.log(`Después: jugadores=${players} player_npcs=${playerNpcs} properties=${properties}`);

    if (before) {
      check('jugadores sin pérdida', players === before.players, `(${before.players} -> ${players})`);
      check('player_npcs = NPCs con dueño', playerNpcs === before.ownedNpcs, `(${before.ownedNpcs} -> ${playerNpcs})`);
      check('properties = construcciones con dueño y tipo', properties === before.ownedConstructions, `(${before.ownedConstructions} -> ${properties})`);

      const [rows] = await conn.query('SELECT item_id, SUM(quantity) AS total FROM rp_economy.inventory GROUP BY item_id');
      const after = new Map(rows.map(r => [r.item_id, Number(r.total)]));
      const itemIds = new Set([...before.sums.keys(), ...after.keys()]);
      const mismatches = [];
      for (const id of itemIds) {
        const expected = before.sums.get(id) ?? 0;
        const actual = after.get(id) ?? 0;
        if (Math.abs(expected - actual) > TOLERANCE) mismatches.push(`item ${id}: esperado ${expected}, hay ${actual}`);
      }
      check('suma por item_id del inventario = inventario + almacenes con dueño', mismatches.length === 0, mismatches.join(' | '));
    }

    for (const [schema, tables] of Object.entries(CONTRACT_TABLES)) {
      const actual = await tablesOf(conn, schema);
      const expected = [...tables].sort();
      check(`tablas de ${schema} = contrato`, JSON.stringify(actual) === JSON.stringify(expected),
        JSON.stringify(actual) === JSON.stringify(expected) ? '' : `hay [${actual}] y se esperaba [${expected}]`);
    }

    for (const [table, columns] of Object.entries(CONTRACT_COLUMNS)) {
      const actual = await columnsOf(conn, table);
      const expected = [...columns].sort();
      check(`columnas de ${table} = contrato`, JSON.stringify(actual) === JSON.stringify(expected),
        JSON.stringify(actual) === JSON.stringify(expected) ? '' : `hay [${actual}]`);
    }

    check('10 razas', (await scalar(conn, 'SELECT COUNT(*) FROM rp_players.races')) === 10);
    check('6 escuelas, 5 activas', (await scalar(conn, 'SELECT COUNT(*) FROM rp_players.schools')) === 6
      && (await scalar(conn, 'SELECT COUNT(*) FROM rp_players.schools WHERE is_active = 1')) === 5);
    check('5 niveles de dominio', (await scalar(conn, 'SELECT COUNT(*) FROM rp_players.mastery_levels')) === 5);
    const [spellRows] = await conn.query('SELECT s.slug, COUNT(*) AS total FROM rp_players.spells p JOIN rp_players.schools s ON s.id = p.school_id GROUP BY s.slug');
    const spellCounts = Object.fromEntries(spellRows.map(r => [r.slug, Number(r.total)]));
    check('conjuros por escuela', JSON.stringify(Object.entries(spellCounts).sort()) === JSON.stringify(Object.entries(EXPECTED_SPELLS).sort()), JSON.stringify(spellCounts));
    check('cooldown de creación = 336 si no estaba fijado', (await scalar(conn, "SELECT COUNT(*) FROM rp_ops.system_state WHERE `key` = 'character_creation_cooldown_hours'")) === 1);
    const noCategory = await scalar(conn, 'SELECT COUNT(*) FROM rp_economy.items WHERE category_id IS NULL');
    check('todos los items tienen categoría', noCategory === 0, `(${noCategory} sin categoría)`);
  } finally {
    await conn.end();
  }

  console.log(failures.length === 0 ? '\nENSAYO SUPERADO' : `\nENSAYO FALLIDO (${failures.length}): ${failures.join('; ')}`);
  process.exit(failures.length === 0 ? 0 : 1);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
