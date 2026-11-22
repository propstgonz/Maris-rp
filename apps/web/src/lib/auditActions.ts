export const FAMILY_LABEL: Record<string, string> = {
  player: 'Jugadores',
  backup: 'Backups',
  settings: 'Ajustes',
  terminal: 'Terminal',
  staff: 'Staff',
  modmail: 'Modmail',
};

const ACTION_PHRASE: Record<string, string> = {
  'player.kill': 'mató (permadeath) a',
  'player.revive': 'revivió a',
  'settings.sync_channels': 'sincronizó los canales de personaje',
  'terminal.command': 'ejecutó un comando en el terminal',
  'terminal.sql': 'ejecutó una consulta SQL',
  'staff.broadcast': 'mandó un broadcast a todos los jugadores',
  'modmail.category_created': 'registró la categoría de modmail',
};

export function actionFamily(action: string): string {
  return action.split('.')[0] ?? '';
}

export function actionPhrase(action: string): string {
  return ACTION_PHRASE[action] ?? action.replace(/[._]/g, ' ');
}

export function summarizeDetails(details: unknown, maxKeys = 3): string {
  if (details == null) return '';
  if (typeof details !== 'object') return String(details).slice(0, 120);
  const entries = Object.entries(details as Record<string, unknown>)
    .filter(([, v]) => v !== null && v !== undefined && v !== '');
  if (entries.length === 0) return '';
  const shown = entries.slice(0, maxKeys).map(([k, v]) => {
    const value = typeof v === 'object' ? JSON.stringify(v) : String(v);
    return `${k}: ${value.length > 60 ? `${value.slice(0, 60)}…` : value}`;
  });
  if (entries.length > maxKeys) shown.push(`+${entries.length - maxKeys} más`);
  return shown.join(' · ');
}

export function relativeTime(date: Date): string {
  const seconds = Math.round((Date.now() - date.getTime()) / 1000);
  if (seconds < 60) return 'hace un momento';
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `hace ${minutes} min`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `hace ${hours} h`;
  const days = Math.round(hours / 24);
  if (days <= 7) return `hace ${days} d`;
  return date.toLocaleDateString('es-ES');
}
