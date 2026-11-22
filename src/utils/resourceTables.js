export function mergeResourceTables(terrainResources = [], zoneResources = []) {
  const byName = new Map();
  for (const row of terrainResources) byName.set(row.name, row);
  for (const row of zoneResources) byName.set(row.name, row);
  return [...byName.values()].sort((a, b) => b.drop_chance_percent - a.drop_chance_percent);
}
