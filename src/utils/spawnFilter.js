export function resolveSpawnChance(baseChance, { terrainRows = [], zoneRows = [], terrainName = null, zoneName = null } = {}) {
  let chance = baseChance;

  if (terrainRows.length > 0) {
    const match = terrainRows.find(r => r.name === terrainName);
    if (!match) return null;
    if (match.spawn_chance_override_percent != null) chance = match.spawn_chance_override_percent;
  }

  if (zoneRows.length > 0) {
    if (zoneName == null) return null;
    const match = zoneRows.find(r => r.name === zoneName);
    if (!match) return null;
    if (match.spawn_chance_override_percent != null) chance = match.spawn_chance_override_percent;
  }

  return chance;
}
