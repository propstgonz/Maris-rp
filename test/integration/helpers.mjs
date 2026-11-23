import { createConnection } from 'mysql2/promise';

const SCHEMAS = ['rp_players', 'rp_world', 'rp_economy', 'rp_ops'];
const PRODUCTION_PORTS = new Set(['3306', '3307', '3308']);

export const ACTOR = { discordId: '900000000000000001', username: 'rolepriest-test', source: 'discord' };

function connectionConfig() {
  return {
    host: process.env.DB_HOST ?? '127.0.0.1',
    port: Number(process.env.DB_PORT ?? 3399),
    user: process.env.DB_USER ?? 'root',
    password: process.env.DB_PASSWORD ?? 'testpw',
  };
}

export async function resetDatabase() {
  const port = String(process.env.DB_PORT ?? '3399');
  if (PRODUCTION_PORTS.has(port) && process.env.INTEGRATION_ALLOW_ANY_PORT !== '1') {
    throw new Error(`Los tests de integración borran los esquemas: se niegan a correr contra el puerto ${port}.`);
  }
  process.env.DB_HOST = connectionConfig().host;
  process.env.DB_PORT = port;
  process.env.DB_USER = connectionConfig().user;
  process.env.DB_PASSWORD = connectionConfig().password;

  const conn = await createConnection(connectionConfig());
  for (const schema of SCHEMAS) await conn.query(`DROP DATABASE IF EXISTS \`${schema}\``);
  await conn.end();

  const db = await import('../../src/database/index.js');
  await db.whenReady;
  const { T } = await import('../../src/database/tables.js');
  return { db, T };
}

let nextDiscordId = 100000000000000000n;

export async function createCharacter(db, T, overrides = {}) {
  nextDiscordId += 1n;
  const discordId = overrides.discordId ?? String(nextDiscordId);
  const race = await db.queryOne(`SELECT id FROM ${T.races} WHERE slug = ?`, [overrides.raceSlug ?? 'nordico']);
  const { lastInsertRowid } = await db.execute(
    `INSERT INTO ${T.players} (discord_id, username, character_name, gender, age, race_id, is_alive, character_created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, NOW())`,
    [
      discordId,
      overrides.username ?? `user${discordId.slice(-4)}`,
      overrides.characterName ?? `Personaje ${discordId.slice(-4)}`,
      overrides.gender ?? 'mujer',
      overrides.age ?? 30,
      race?.id ?? null,
      overrides.isAlive === false ? 0 : 1,
    ]
  );
  return db.queryOne(`SELECT * FROM ${T.players} WHERE id = ?`, [lastInsertRowid]);
}
