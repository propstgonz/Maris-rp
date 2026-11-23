import { createConnection } from 'mysql2/promise';
import { readdirSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { runMigrations } from '../src/database/migrate.js';
import { SCHEMAS } from '../src/database/tables.js';

const LEGACY_LAST_FILE = '034_rp_world_npc_type_faction.sql';
const GHOST_PLAYER = 9999;
const GHOST_ITEM = 99999;
const GHOST_TYPE = 9999;

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
    'id', 'discord_id', 'username', 'character_name', 'avatar_filename', 'gender', 'age', 'race_id', 'menhir_id', 'menhir_chosen_at',
    'stat_potencia', 'stat_intuicion', 'stat_chiripa', 'stat_autismo', 'stat_resistencia', 'stat_donjuanismo',
    'stat_agilidad', 'stat_bonus_points', 'free_school_claimed_at', 'is_alive', 'died_at', 'character_created_at',
    'character_reset_at', 'modmail_channel_id', 'created_at', 'updated_at',
  ],
  'rp_players.marriages': ['id', 'proposed_by_player_id', 'accepted_by_player_id', 'created_at', 'ended_at', 'end_reason', 'ended_by_player_id'],
  'rp_economy.items': ['id', 'name', 'display_name', 'description', 'emoji', 'category_id', 'is_active', 'created_at'],
  'rp_economy.inventory': ['id', 'player_id', 'item_id', 'quantity'],
  'rp_world.properties': ['id', 'owner_player_id', 'property_type_id', 'name', 'level', 'location', 'created_at'],
  'rp_world.property_types': ['id', 'name', 'display_name', 'category', 'description', 'emoji', 'is_active', 'created_at'],
};

const EXPECTED_SPELLS = { destruccion: 21, alteracion: 15, restauracion: 11, ilusion: 14, conjuracion: 14 };

const SOURCE_LABELS = {
  inventario: 'inventario de jugadores',
  almacen_construccion: 'almacén de construcciones',
  almacen_npc: 'almacén de NPCs',
  inventario_npc: 'inventario de NPCs',
  almacen_faccion: 'almacén de facciones',
  herramienta_equipada: 'herramientas equipadas a NPCs',
  stock_mercado: 'stock de mercados de construcciones',
  combustible: 'combustible depositado en construcciones',
  suelo: 'objetos en el suelo del mapa',
};

const SOURCE_QUERIES = {
  inventario: 'SELECT player_id, item_id, quantity FROM rp_economy.inventory',
  almacen_construccion: `SELECT c.built_by_player_id AS player_id, cs.item_id, cs.quantity
    FROM rp_world.construction_storage cs LEFT JOIN rp_world.constructions c ON c.id = cs.construction_id`,
  almacen_npc: `SELECT n.owner_player_id AS player_id, ns.item_id, ns.quantity
    FROM rp_world.npc_storage ns LEFT JOIN rp_world.npcs n ON n.id = ns.npc_id`,
  inventario_npc: `SELECT n.owner_player_id AS player_id, ni.item_id, ni.quantity
    FROM rp_world.npc_inventory ni LEFT JOIN rp_world.npcs n ON n.id = ni.npc_id`,
  almacen_faccion: `SELECT f.owner_player_id AS player_id, fs.item_id, fs.quantity
    FROM rp_players.faction_storage fs LEFT JOIN rp_players.factions f ON f.id = fs.faction_id`,
  herramienta_equipada: `SELECT owner_player_id AS player_id, equipped_tool_item_id AS item_id, 1 AS quantity
    FROM rp_world.npcs WHERE equipped_tool_item_id IS NOT NULL`,
  stock_mercado: `SELECT c.built_by_player_id AS player_id, ml.item_id, ml.stock_quantity AS quantity
    FROM rp_economy.construction_market_listings ml LEFT JOIN rp_world.constructions c ON c.id = ml.construction_id`,
  combustible: `SELECT c.built_by_player_id AS player_id, ct.fuel_item_id AS item_id, c.fuel_level AS quantity
    FROM rp_world.constructions c JOIN rp_world.construction_types ct ON ct.id = c.construction_type_id
    WHERE ct.fuel_item_id IS NOT NULL AND c.fuel_level > 0`,
  suelo: 'SELECT NULL AS player_id, item_id, quantity FROM rp_world.tile_items',
};

const failures = [];

function check(label, ok, detail = '') {
  console.log(`  [${ok ? 'OK' : 'FALLO'}] ${label}${detail ? ` ${detail}` : ''}`);
  if (!ok) failures.push(label);
}

function trunc2(value) {
  return Math.floor(Math.round(value * 1e6) / 1e4) / 100;
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
  const ledger = [];
  const record = (source, player, item, quantity) => ledger.push({ source, player, item, quantity: Number(quantity) });

  const p1 = await insertAndGetId(conn, "INSERT INTO rp_players.players (discord_id, username, character_name, full_name, nationality) VALUES ('1001', 'ana', 'Ana Vela', 'Ana Vela Ruiz', 'Nordica')");
  const p2 = await insertAndGetId(conn, "INSERT INTO rp_players.players (discord_id, username, character_name) VALUES ('1002', 'borja', 'Borja Ruz')");
  const p3 = await insertAndGetId(conn, "INSERT INTO rp_players.players (discord_id, username, character_name) VALUES ('1003', 'carla', 'Carla Sol')");
  const p4 = await insertAndGetId(conn, "INSERT INTO rp_players.players (discord_id, username, character_name) VALUES ('1004', 'dani', 'Dani Luz')");
  const validPlayers = new Set([p1, p2, p3, p4]);

  const f1 = await insertAndGetId(conn, `INSERT INTO rp_players.factions (name, display_name, owner_player_id) VALUES ('norte', 'Norte', ${p1})`);
  const f2 = await insertAndGetId(conn, "INSERT INTO rp_players.factions (name, display_name, owner_player_id) VALUES ('huerfana', 'Huerfana', NULL)");
  await conn.query(`UPDATE rp_players.players SET faction_id = ${f1} WHERE id IN (${p1}, ${p2})`);

  await conn.query("INSERT INTO rp_economy.item_categories (name, display_name) VALUES ('metales', 'Metales')");
  const itemIds = [];
  const item = async (name, type, category = null) => {
    const id = await insertAndGetId(conn,
      `INSERT INTO rp_economy.items (name, display_name, item_type, category_name) VALUES ('${name}', '${name}', '${type}', ${category ? `'${category}'` : 'NULL'})`);
    itemIds.push(id);
    return id;
  };
  const platas = await item('platas', 'dinero');
  const hierro = await item('hierro', 'recurso', 'metales');
  const martillo = await item('martillo', 'herramienta');
  const espada = await item('espada', 'arma');
  const pan = await item('pan', 'consumible');
  const carreta = await item('carreta', 'vehiculo');
  await item('puntos_laburo', 'laburo');
  const carbon = await item('carbon', 'recurso');
  const validItems = new Set(itemIds);

  const inv = async (player, itemId, qty) => {
    await conn.query(`INSERT INTO rp_economy.inventory (player_id, item_id, quantity, durability, slot_position) VALUES (${player}, ${itemId}, ${qty}, 5, 1)`);
    record('inventario', player, itemId, qty);
  };
  await inv(p1, platas, 120.5);
  await inv(p1, hierro, 10.004);
  await inv(p1, pan, 0.004);
  await inv(p2, platas, 40);
  await inv(p2, pan, 3);
  await inv(p3, espada, 1);
  await inv(p3, hierro, 0);
  await inv(p3, carreta, 1);

  const factionStock = async (faction, owner, itemId, qty) => {
    await conn.query(`INSERT INTO rp_players.faction_storage (faction_id, item_id, quantity) VALUES (${faction}, ${itemId}, ${qty})`);
    record('almacen_faccion', owner, itemId, qty);
  };
  await factionStock(f1, p1, platas, 15.25);
  await factionStock(f1, p1, hierro, 4);
  await factionStock(f2, null, platas, 99);

  const t1 = await insertAndGetId(conn, 'INSERT INTO rp_world.map_tiles (coord_x, coord_y, terrain_type_id) VALUES (1, 1, 1)');
  const t2 = await insertAndGetId(conn, 'INSERT INTO rp_world.map_tiles (coord_x, coord_y, terrain_type_id) VALUES (2, 1, 2)');
  await conn.query(`INSERT INTO rp_world.tile_items (tile_id, item_id, quantity) VALUES (${t1}, ${platas}, 77), (${t2}, ${hierro}, 5)`);
  record('suelo', null, platas, 77);
  record('suelo', null, hierro, 5);

  const ct = async (name) => insertAndGetId(conn, `INSERT INTO rp_world.construction_types (name, display_name) VALUES ('${name}', '${name}')`);
  const casa = await ct('casa');
  const granja = await ct('granja');
  await ct('fortin');
  await conn.query(`UPDATE rp_world.construction_types SET fuel_item_id = ${carbon} WHERE id = ${casa}`);

  const cons = async (tile, name, owner, type, fuel = 0) => insertAndGetId(conn,
    `INSERT INTO rp_world.constructions (tile_id, name, built_by_player_id, construction_type_id, fuel_level) VALUES (${tile}, '${name}', ${owner ?? 'NULL'}, ${type ?? 'NULL'}, ${fuel})`);
  const c1 = await cons(t1, 'Casa de Ana', p1, casa, 12.349);
  const c2 = await cons(t2, 'Granja de Borja', p2, granja);
  const c3 = await cons(t1, 'Casa abandonada', null, casa, 4);
  const c4 = await cons(t2, 'Obra sin tipo', p1, null, 9);
  const c5 = await cons(t1, 'Casa fantasma', GHOST_PLAYER, casa, 6);
  const c6 = await cons(t2, 'Granja de Dani', p4, granja);
  record('combustible', p1, carbon, 12.349);
  record('combustible', null, carbon, 4);
  record('combustible', GHOST_PLAYER, carbon, 6);

  const conStock = async (construction, owner, itemId, qty) => {
    await conn.query(`INSERT INTO rp_world.construction_storage (construction_id, item_id, quantity) VALUES (${construction}, ${itemId}, ${qty})`);
    record('almacen_construccion', owner, itemId, qty);
  };
  await conStock(c1, p1, hierro, 6.5);
  await conStock(c1, p1, GHOST_ITEM, 7);
  await conStock(c2, p2, pan, 8);
  await conStock(c3, null, platas, 500);
  await conStock(c4, p1, hierro, 2.001);
  await conStock(c5, GHOST_PLAYER, platas, 33);

  const listing = async (construction, owner, itemId, qty) => {
    await conn.query(`INSERT INTO rp_economy.construction_market_listings (construction_id, item_id, price_laburo, stock_quantity) VALUES (${construction}, ${itemId}, 2, ${qty})`);
    record('stock_mercado', owner, itemId, qty);
  };
  await listing(c1, p1, hierro, 3.456);
  await listing(c2, p2, espada, 0.004);
  await listing(c3, null, platas, 10);
  await listing(c4, p1, pan, 2);
  await listing(c6, p4, pan, 0.004);

  const nt1 = await insertAndGetId(conn, "INSERT INTO rp_world.npc_types (name, display_name) VALUES ('guardia', 'Guardia')");
  const nt2 = await insertAndGetId(conn, "INSERT INTO rp_world.npc_types (name, display_name) VALUES ('lobo', 'Lobo')");
  const npc = async (tile, type, owner, tool = null) => insertAndGetId(conn,
    `INSERT INTO rp_world.npcs (tile_id, npc_type_id, current_hp, owner_player_id, equipped_tool_item_id) VALUES (${tile}, ${type}, 5, ${owner ?? 'NULL'}, ${tool ?? 'NULL'})`);
  const n1 = await npc(t1, nt1, p1, martillo);
  await npc(t1, nt1, p1);
  const n3 = await npc(t2, nt1, p2, GHOST_ITEM);
  const n4 = await npc(t2, nt2, null);
  const n5 = await npc(t1, nt1, GHOST_PLAYER, martillo);
  await conn.query('SET FOREIGN_KEY_CHECKS = 0');
  const n6 = await npc(t2, GHOST_TYPE, p3, martillo);
  await conn.query('SET FOREIGN_KEY_CHECKS = 1');
  record('herramienta_equipada', p1, martillo, 1);
  record('herramienta_equipada', p2, GHOST_ITEM, 1);
  record('herramienta_equipada', GHOST_PLAYER, martillo, 1);
  record('herramienta_equipada', p3, martillo, 1);

  const npcStock = async (table, source, npcId, owner, itemId, qty) => {
    await conn.query(`INSERT INTO rp_world.${table} (npc_id, item_id, quantity) VALUES (${npcId}, ${itemId}, ${qty})`);
    record(source, owner, itemId, qty);
  };
  await npcStock('npc_storage', 'almacen_npc', n1, p1, platas, 2.999);
  await npcStock('npc_storage', 'almacen_npc', n4, null, platas, 1000);
  await npcStock('npc_storage', 'almacen_npc', n5, GHOST_PLAYER, platas, 5);
  await npcStock('npc_storage', 'almacen_npc', n6, p3, pan, 1.25);
  await npcStock('npc_inventory', 'inventario_npc', n3, p2, espada, 1);
  await npcStock('npc_inventory', 'inventario_npc', n3, p2, platas, 7.75);
  await npcStock('npc_inventory', 'inventario_npc', n4, null, hierro, 300);

  await conn.query("INSERT INTO rp_ops.system_state (`key`, value) VALUES ('character_creation_cooldown_hours', '0')");

  return { ledger, validPlayers, validItems, ownedNpcs: 3, properties: 3, players: validPlayers.size };
}

async function readLegacySources(conn) {
  const ledger = [];
  for (const [source, sql] of Object.entries(SOURCE_QUERIES)) {
    const [result] = await conn.query(sql);
    for (const r of result) {
      ledger.push({
        source,
        player: r.player_id === null ? null : Number(r.player_id),
        item: Number(r.item_id),
        quantity: Number(r.quantity),
      });
    }
  }
  const validPlayers = new Set((await conn.query('SELECT id FROM rp_players.players'))[0].map(r => Number(r.id)));
  const validItems = new Set((await conn.query('SELECT id FROM rp_economy.items'))[0].map(r => Number(r.id)));
  return {
    ledger,
    validPlayers,
    validItems,
    players: validPlayers.size,
    ownedNpcs: await scalar(conn, 'SELECT COUNT(*) FROM rp_world.npcs n JOIN rp_world.npc_types t ON t.id = n.npc_type_id JOIN rp_players.players p ON p.id = n.owner_player_id'),
    properties: await scalar(conn, 'SELECT COUNT(*) FROM rp_world.constructions c JOIN rp_world.construction_types t ON t.id = c.construction_type_id JOIN rp_players.players p ON p.id = c.built_by_player_id'),
  };
}

function evaluate({ ledger, validPlayers, validItems }) {
  const attributed = new Map();
  const discarded = [];
  const perSource = new Map();
  for (const row of ledger) {
    const entryKey = `${row.source}|${row.item}`;
    const entry = perSource.get(entryKey) ?? { source: row.source, item: row.item, owned: 0, discarded: 0 };
    const keeps = row.source !== 'suelo' && row.player !== null && validPlayers.has(row.player) && validItems.has(row.item) && row.quantity > 0;
    if (keeps) {
      const key = `${row.player}:${row.item}`;
      attributed.set(key, (attributed.get(key) ?? 0) + row.quantity);
      entry.owned += row.quantity;
    } else if (row.quantity > 0) {
      entry.discarded += row.quantity;
      discarded.push(row);
    }
    perSource.set(entryKey, entry);
  }
  const expected = new Map();
  const truncated = [];
  for (const [key, raw] of attributed) {
    const value = trunc2(raw);
    if (value !== raw) truncated.push({ key, raw, value });
    if (value > 0) expected.set(key, value);
  }
  return { expected, truncated, discarded, perSource: [...perSource.values()] };
}

function printSources(evaluation) {
  console.log('Fuentes antiguas (suma por fuente e item; conservado = con dueño e item válidos):');
  const sorted = evaluation.perSource.sort((a, b) => a.source.localeCompare(b.source) || a.item - b.item);
  for (const e of sorted) {
    console.log(`  ${SOURCE_LABELS[e.source].padEnd(44)} item ${String(e.item).padEnd(6)} conservado=${e.owned} descartado=${e.discarded}`);
  }
  const lost = evaluation.discarded.reduce((acc, r) => acc.set(r.source, (acc.get(r.source) ?? 0) + 1), new Map());
  console.log(`Descartados (sin dueño, dueño inexistente, item inexistente o suelo): ${[...lost].map(([s, n]) => `${s}=${n}`).join(' ') || 'ninguno'}`);
  console.log(`Truncados a 2 decimales (jugador:item): ${evaluation.truncated.length === 0 ? 'ninguno' : evaluation.truncated.map(t => `${t.key} ${t.raw} -> ${t.value}`).join(' | ')}`);
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

async function checkConcurrentCleanInstall(conn, filesCount) {
  console.log('Instalación limpia con dos arranques concurrentes:');
  for (const schema of Object.values(SCHEMAS)) await conn.query(`DROP DATABASE IF EXISTS \`${schema}\``);
  await Promise.all([runMigrations(config), runMigrations(config)]);
  check('todas las migraciones registradas una vez', (await scalar(conn, 'SELECT COUNT(*) FROM rp_ops.schema_migrations')) === filesCount);
  check('10 razas sin duplicar', (await scalar(conn, 'SELECT COUNT(*) FROM rp_players.races')) === 10);
  check('75 conjuros sin duplicar', (await scalar(conn, 'SELECT COUNT(*) FROM rp_players.spells')) === 75);
}

async function main() {
  const conn = await createConnection({ ...config, timezone: 'Z' });
  try {
    let source = null;
    if (!currentMode) {
      if (config.port !== 3399 && process.env.REHEARSAL_ALLOW_ANY_PORT !== '1') {
        throw new Error(`El ensayo borra los esquemas: se niega a correr contra el puerto ${config.port} (usa 3399 o REHEARSAL_ALLOW_ANY_PORT=1).`);
      }
      for (const schema of Object.values(SCHEMAS)) await conn.query(`DROP DATABASE IF EXISTS \`${schema}\``);
      await runMigrations(config, { untilFilename: LEGACY_LAST_FILE });
      source = await seedLegacyFixture(conn);
      console.log('Fixture antiguo cargado (migraciones 001..034).');
    } else if ((await tableExists(conn, 'rp_world', 'npcs')) && (await tableExists(conn, 'rp_players', 'factions'))) {
      source = await readLegacySources(conn);
    }

    let evaluation = null;
    if (source) {
      evaluation = evaluate(source);
      console.log(`Antes: jugadores=${source.players} npcs_migrables=${source.ownedNpcs} construcciones_migrables=${source.properties} pares_jugador_item_esperados=${evaluation.expected.size}`);
      printSources(evaluation);
    } else {
      console.log('Antes: el esquema ya no tiene las tablas antiguas, no hay nada que medir.');
    }

    if (currentMode) await runMigrations(config);
    else await Promise.all([runMigrations(config), runMigrations(config)]);
    const files = readdirSync(join(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'database', 'migrations', 'mysql')).filter(f => f.endsWith('.sql'));
    const applied = await scalar(conn, 'SELECT COUNT(*) FROM rp_ops.schema_migrations');

    console.log('Después de migrar:');
    check('todas las migraciones registradas', applied === files.length, `(${applied}/${files.length})`);

    const players = await scalar(conn, 'SELECT COUNT(*) FROM rp_players.players');
    const playerNpcs = await scalar(conn, 'SELECT COUNT(*) FROM rp_players.player_npcs');
    const properties = await scalar(conn, 'SELECT COUNT(*) FROM rp_world.properties');
    console.log(`Después: jugadores=${players} player_npcs=${playerNpcs} properties=${properties}`);

    if (source) {
      check('jugadores sin pérdida', players === source.players, `(${source.players} -> ${players})`);
      check('player_npcs = NPCs con dueño y tipo (sin duplicar)', playerNpcs === source.ownedNpcs, `(${source.ownedNpcs} -> ${playerNpcs})`);
      check('properties = construcciones con dueño y tipo', properties === source.properties, `(${source.properties} -> ${properties})`);

      const [rows] = await conn.query('SELECT player_id, item_id, quantity FROM rp_economy.inventory');
      const actual = new Map(rows.map(r => [`${r.player_id}:${r.item_id}`, Number(r.quantity)]));
      const mismatches = [];
      for (const key of new Set([...evaluation.expected.keys(), ...actual.keys()])) {
        const want = evaluation.expected.get(key) ?? 0;
        const got = actual.get(key) ?? 0;
        if (want !== got) mismatches.push(`${key}: esperado ${want}, hay ${got}`);
      }
      check('inventario por (jugador, item) = suma de fuentes truncada a 2 decimales, sin tolerancia', mismatches.length === 0, mismatches.join(' | '));
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
    check('11 menhires', (await scalar(conn, 'SELECT COUNT(*) FROM rp_players.menhirs')) === 11);
    check('6 escuelas, 5 activas', (await scalar(conn, 'SELECT COUNT(*) FROM rp_players.schools')) === 6
      && (await scalar(conn, 'SELECT COUNT(*) FROM rp_players.schools WHERE is_active = 1')) === 5);
    check('5 niveles de dominio', (await scalar(conn, 'SELECT COUNT(*) FROM rp_players.mastery_levels')) === 5);
    check('Principiante exige mentor y Hábil arranca en 20,5',
      (await scalar(conn, "SELECT COUNT(*) FROM rp_players.mastery_levels WHERE (slug = 'principiante' AND requires_mentor = 1) OR (slug = 'habil' AND threshold = 20.5)")) === 2);
    const [spellRows] = await conn.query('SELECT s.slug, COUNT(*) AS total FROM rp_players.spells p JOIN rp_players.schools s ON s.id = p.school_id GROUP BY s.slug');
    const spellCounts = Object.fromEntries(spellRows.map(r => [r.slug, Number(r.total)]));
    check('conjuros por escuela', JSON.stringify(Object.entries(spellCounts).sort()) === JSON.stringify(Object.entries(EXPECTED_SPELLS).sort()), JSON.stringify(spellCounts));
    if (!currentMode) {
      const [[cooldown]] = await conn.query("SELECT value FROM rp_ops.system_state WHERE `key` = 'character_creation_cooldown_hours'");
      check('cooldown de creación 0 (valor antiguo por defecto) pasa a 336', cooldown?.value === '336', `(valor: ${cooldown?.value})`);
    }
    check('player_npcs.name distingue tildes y mayúsculas',
      (await scalar(conn, "SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = 'rp_players' AND TABLE_NAME = 'player_npcs' AND COLUMN_NAME = 'name' AND COLLATION_NAME = 'utf8mb4_0900_as_cs'")) === 1);
    const noCategory = await scalar(conn, 'SELECT COUNT(*) FROM rp_economy.items WHERE category_id IS NULL');
    check('todos los items tienen categoría', noCategory === 0, `(${noCategory} sin categoría)`);

    if (!currentMode) await checkConcurrentCleanInstall(conn, files.length);
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
