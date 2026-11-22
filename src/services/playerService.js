import { query, queryOne, execute } from '../database/index.js';
import { T } from '../database/tables.js';
import logger from '../utils/logger.js';

const SQL = {
  findByDiscordId: `SELECT * FROM ${T.players} WHERE discord_id = ?`,
  findById: `SELECT * FROM ${T.players} WHERE id = ?`,
  list: `
    SELECT id, discord_id, username, character_name, is_alive, character_created_at,
           died_at, avatar_filename, gender
    FROM ${T.players}
    WHERE character_created_at IS NOT NULL
    ORDER BY character_name
  `,
  markDead: `
    UPDATE ${T.players}
    SET is_alive = 0, died_at = NOW(), updated_at = NOW()
    WHERE discord_id = ? AND is_alive = 1
  `,
  revive: `
    UPDATE ${T.players}
    SET is_alive = 1, died_at = NULL, updated_at = NOW()
    WHERE discord_id = ? AND is_alive = 0
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

export async function killPlayer(discordId) {
  const player = await queryOne(SQL.findByDiscordId, [discordId]);
  if (!player) throw new Error(`Jugador no encontrado: discord_id="${discordId}"`);

  const { changes } = await execute(SQL.markDead, [discordId]);
  if (changes === 0) throw new Error(`${player.username} ya estaba marcado como muerto.`);
  logger.info(`[PlayerService] Jugador marcado como muerto: ${player.username} (${discordId})`);

  return queryOne(SQL.findByDiscordId, [discordId]);
}

export async function revivePlayer(discordId) {
  const player = await queryOne(SQL.findByDiscordId, [discordId]);
  if (!player) throw new Error(`Jugador no encontrado: discord_id="${discordId}"`);

  const { changes } = await execute(SQL.revive, [discordId]);
  if (changes === 0) throw new Error(`${player.username} ya está vivo.`);
  logger.info(`[PlayerService] Jugador revivido: ${player.username} (${discordId})`);

  return queryOne(SQL.findByDiscordId, [discordId]);
}
