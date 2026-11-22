// Exige que la tabla de construcciones esté aliasada como `c` en la consulta.
export const CONSTRUCTION_ALIVE_SQL = 'c.current_health IS NULL OR c.current_health > 0';

export function isConstructionRuined(row) {
  return (row.current_health ?? row.ct_max_health ?? 10) <= 0;
}
