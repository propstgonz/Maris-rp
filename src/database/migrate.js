import { createConnection } from 'mysql2/promise';
import { readFileSync, readdirSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { SCHEMAS } from './tables.js';
import logger from '../utils/logger.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = join(__dirname, 'migrations', 'mysql');

function splitStatements(sql) {
  return sql
    .split(/;\s*(?:\r?\n|$)/)
    .map(s => s.trim())
    .filter(Boolean);
}

export async function seedLegacyModmailCategory(conn) {
  const [[row]] = await conn.query(
    `SELECT COUNT(*) AS count FROM ${SCHEMAS.ops}.modmail_categories`
  );
  if (row.count > 0) return;

  const [[legacyRow]] = await conn.query(
    `SELECT value FROM ${SCHEMAS.ops}.system_state WHERE \`key\` = 'modmail_category_id'`
  );
  const legacyId = legacyRow?.value ?? process.env.MODMAIL_CATEGORY_ID ?? null;
  if (!legacyId) return;

  await conn.query(
    `INSERT IGNORE INTO ${SCHEMAS.ops}.modmail_categories (discord_category_id, display_name) VALUES (?, NULL)`,
    [legacyId]
  );
  logger.info(`[DB] Categoría de modmail legada (${legacyId}) migrada a la tabla modmail_categories.`);
}

export async function runMigrations(connectionConfig) {
  const conn = await createConnection({ ...connectionConfig, timezone: 'Z' });

  for (const schema of Object.values(SCHEMAS)) {
    await conn.query(`CREATE DATABASE IF NOT EXISTS \`${schema}\` CHARACTER SET utf8mb4`);
  }

  await conn.query(`
    CREATE TABLE IF NOT EXISTS ${SCHEMAS.ops}.schema_migrations (
      id INT PRIMARY KEY AUTO_INCREMENT,
      filename VARCHAR(191) NOT NULL UNIQUE,
      applied_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `);

  const files = readdirSync(MIGRATIONS_DIR).filter(f => f.endsWith('.sql')).sort();
  const FILE_SCHEMA = {
    '001_rp_players.sql':            SCHEMAS.players,
    '002_rp_world.sql':              SCHEMAS.world,
    '003_rp_economy.sql':            SCHEMAS.economy,
    '004_rp_ops.sql':                SCHEMAS.ops,
    '005_rp_players_faccion.sql':    SCHEMAS.players,
    '006_rp_world_faccion.sql':      SCHEMAS.world,
    '007_rp_players_faction_ranks.sql': SCHEMAS.players,
    '008_rp_world_storage.sql':         SCHEMAS.world,
    '009_rp_players_travel_alert.sql':  SCHEMAS.players,
    '010_rp_world_npc_work.sql':         SCHEMAS.world,
    '011_rp_players_faction_storage.sql': SCHEMAS.players,
    '012_rp_economy_npc_tools.sql':       SCHEMAS.economy,
    '013_rp_world_construction_maintenance.sql': SCHEMAS.world,
    '014_rp_world_construction_durability.sql':  SCHEMAS.world,
    '015_rp_world_terrain_resources.sql':        SCHEMAS.world,
    '016_rp_economy_ingredient_unique.sql':      SCHEMAS.economy,
    '017_rp_world_construction_ingredient_unique.sql': SCHEMAS.world,
    '018_rp_players_genero.sql':          SCHEMAS.players,
    '019_rp_economy_item_categories.sql': SCHEMAS.economy,
    '020_rp_world_npc_groups.sql':        SCHEMAS.world,
    '021_rp_world_npc_group_terrains.sql':      SCHEMAS.world,
    '022_rp_economy_healing_and_mounts.sql':    SCHEMAS.economy,
    '023_rp_world_npc_combat_kit.sql':          SCHEMAS.world,
    '024_rp_economy_trade_value.sql':           SCHEMAS.economy,
    '025_rp_world_npc_inventory.sql':           SCHEMAS.world,
    '026_rp_players_pending_robbery.sql':       SCHEMAS.players,
    '027_rp_world_taming_and_mounts.sql':       SCHEMAS.world,
    '028_rp_world_points_of_interest.sql':      SCHEMAS.world,
    '029_rp_players_web_echo.sql':              SCHEMAS.players,
    '030_rp_world_zones.sql':                   SCHEMAS.world,
    '031_rp_world_temperature.sql':             SCHEMAS.world,
    '032_rp_world_encounter_notified.sql':      SCHEMAS.world,
    '033_rp_players_faction_npc.sql':           SCHEMAS.players,
    '034_rp_world_npc_type_faction.sql':        SCHEMAS.world,
  };

  for (const file of files) {
    const [[{ count }]] = await conn.query(
      `SELECT COUNT(*) AS count FROM ${SCHEMAS.ops}.schema_migrations WHERE filename = ?`,
      [file]
    );
    if (count > 0) continue;

    await conn.query(`USE \`${FILE_SCHEMA[file]}\``);
    const statements = splitStatements(readFileSync(join(MIGRATIONS_DIR, file), 'utf-8'));
    for (const statement of statements) {
      await conn.query(statement);
    }
    await conn.query(
      `INSERT INTO ${SCHEMAS.ops}.schema_migrations (filename) VALUES (?)`,
      [file]
    );
    logger.info(`[DB] Migración aplicada: ${file}`);
  }

  await conn.end();
}
