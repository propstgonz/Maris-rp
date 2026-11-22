import type { IntegrityFinding } from '../lib/mapServerApi';

export function formatWarnings(warnings?: IntegrityFinding[]): string {
  if (!warnings || warnings.length === 0) return '';
  return ` ⚠ ${warnings.map(w => w.message).join(' ')}`;
}
