import { query, queryOne, execute } from '../database/index.js';
import { T } from '../database/tables.js';

const SQL = {
  getByTile: `SELECT * FROM ${T.points_of_interest} WHERE tile_id = ? ORDER BY created_at ASC`,
  getByTileAndName: `SELECT * FROM ${T.points_of_interest} WHERE tile_id = ? AND LOWER(name) = LOWER(?)`,
  insert: `INSERT INTO ${T.points_of_interest} (tile_id, name, description, emoji, created_by_player_id) VALUES (?, ?, ?, ?, ?)`,
  delete: `DELETE FROM ${T.points_of_interest} WHERE id = ?`,
};

export async function getPointsOfInterest(tileId) {
  return query(SQL.getByTile, [tileId]);
}

export async function addPointOfInterest(tileId, { name, description = null, emoji = '📍' }, createdByPlayerId = null) {
  if (await queryOne(SQL.getByTileAndName, [tileId, name])) {
    throw new Error(`Ya hay un lugar de interés llamado "${name}" en esta casilla.`);
  }
  const result = await execute(SQL.insert, [tileId, name, description, emoji, createdByPlayerId]);
  return queryOne(`SELECT * FROM ${T.points_of_interest} WHERE id = ?`, [result.lastInsertRowid]);
}

export async function removePointOfInterest(tileId, name) {
  const existing = await queryOne(SQL.getByTileAndName, [tileId, name]);
  if (!existing) {
    throw new Error(`No hay ningún lugar de interés llamado "${name}" en esta casilla.`);
  }
  await execute(SQL.delete, [existing.id]);
  return existing;
}
