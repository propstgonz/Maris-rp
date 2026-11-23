import { query, queryOne } from '../database/index.js';
import { T } from '../database/tables.js';

const SQL = {
  findByDiscordId: `SELECT * FROM ${T.players} WHERE discord_id = ?`,
  findById: `SELECT * FROM ${T.players} WHERE id = ?`,
  list: `
    SELECT id, discord_id, username, character_name, is_alive, character_created_at,
           died_at, avatar_filename, gender, age
    FROM ${T.players}
    WHERE character_created_at IS NOT NULL
    ORDER BY character_name
  `,
};

export async function getPlayerByDiscordId(discordId) {
  return (await queryOne(SQL.findByDiscordId, [discordId])) ?? undefined;
}

export async function listPlayers() {
  return query(SQL.list);
}

export async function findPlayerById(id) {
  return (await queryOne(SQL.findById, [id])) ?? null;
}

export async function lockPlayersInTx(ids) {
  const unique = [...new Set(ids.filter(id => id != null).map(Number))].sort((a, b) => a - b);
  if (unique.length === 0) return [];
  return query(
    `SELECT id, discord_id, is_alive, character_created_at, died_at FROM ${T.players}
     WHERE id IN (${unique.map(() => '?').join(', ')}) ORDER BY id FOR UPDATE`,
    unique
  );
}
