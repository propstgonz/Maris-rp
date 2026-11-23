export async function ensureEndedByColumn(db) {
  const present = await db.queryOne(
    `SELECT 1 AS present FROM information_schema.columns
     WHERE table_schema = 'rp_players' AND table_name = 'marriages' AND column_name = 'ended_by_player_id'`
  );
  if (!present) await db.execute('ALTER TABLE rp_players.marriages ADD COLUMN ended_by_player_id INT NULL');
}
