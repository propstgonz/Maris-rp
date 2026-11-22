export function mergePlayerActivity(auditRows, transactionRows, discordId, limit = 30) {
  const fromAudit = auditRows.map(row => ({
    kind: 'audit',
    at: row.created_at,
    source: row.source,
    action: row.action,
    target: row.target,
    details: row.details,
  }));

  const fromTrades = transactionRows.map(row => {
    const sent = row.from_discord_id === discordId;
    return {
      kind: 'trade',
      at: row.created_at,
      direction: sent ? 'sent' : 'received',
      counterpart: sent
        ? { discordId: row.to_discord_id, username: row.to_username }
        : { discordId: row.from_discord_id, username: row.from_username },
      item: row.item,
      quantity: row.quantity,
      coord: { x: row.coord_x, y: row.coord_y },
    };
  });

  return [...fromAudit, ...fromTrades]
    .sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0))
    .slice(0, limit);
}
