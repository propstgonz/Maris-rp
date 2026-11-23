export const STATS = ['potencia', 'intuicion', 'chiripa', 'autismo', 'resistencia', 'donjuanismo', 'agilidad'];

export const STAT_LABELS = {
  potencia: 'Potencia',
  intuicion: 'Intuición',
  chiripa: 'Chiripa',
  autismo: 'Autismo',
  resistencia: 'Resistencia',
  donjuanismo: 'Donjuanismo',
  agilidad: 'Agilidad',
};

export const BASE_POINTS = 8;
export const MAX_BASE_PER_STAT = 6;
export const MAGIC_PER_AUTISMO = 25;
export const MAGIC_BASE_CAP = 150;
export const MENHIR_CHANGE_MONTHS = 6;

export function isStat(stat) {
  return STATS.includes(stat);
}

function pick(row, prefix) {
  return Object.fromEntries(STATS.map(stat => [stat, Number(row?.[`${prefix}${stat}`] ?? 0)]));
}

export function baseStats(playerRow) {
  return pick(playerRow, 'stat_');
}

export function modifiers(row) {
  return pick(row, 'mod_');
}

export function effectiveStats(playerRow, raceRow, menhirRow) {
  const base = baseStats(playerRow);
  const race = modifiers(raceRow);
  const menhir = modifiers(menhirRow);
  return Object.fromEntries(STATS.map(stat => [stat, base[stat] + race[stat] + menhir[stat]]));
}

export function spentPoints(playerRow) {
  return Object.values(baseStats(playerRow)).reduce((sum, n) => sum + n, 0);
}

export function freePoints(playerRow) {
  return BASE_POINTS + Number(playerRow?.stat_bonus_points ?? 0) - spentPoints(playerRow);
}

export function magicPoints(effective, menhirRow, raceRow) {
  const cap = MAGIC_BASE_CAP + MAGIC_PER_AUTISMO * Math.max(0, Number(raceRow?.mod_autismo ?? 0));
  const magia = Math.min(MAGIC_PER_AUTISMO * Math.max(0, effective.autismo), cap) + Number(menhirRow?.magic_bonus ?? 0);
  if (Number(menhirRow?.magic_to_life ?? 0) === 1) return { magia: 0, vidaExtra: magia / 100 };
  return { magia, vidaExtra: 0 };
}

export function validateAllocation(playerRow, stat, n) {
  if (!isStat(stat)) return 'Esa estadística no existe.';
  if (!Number.isInteger(n) || n < 1) return 'Tienes que asignar al menos 1 punto, en números enteros.';
  if (!playerRow?.is_alive) return 'Necesitas un personaje vivo.';
  const current = baseStats(playerRow)[stat];
  if (current + n > MAX_BASE_PER_STAT) {
    return `${STAT_LABELS[stat]} no puede pasar de ${MAX_BASE_PER_STAT} puntos asignados (tienes ${current}).`;
  }
  const free = freePoints(playerRow);
  if (n > free) return `Solo te quedan ${free} punto(s) libre(s).`;
  return null;
}

export function menhirChangeAvailableAt(playerRow) {
  if (!playerRow?.menhir_id || !playerRow?.menhir_chosen_at) return null;
  const chosen = new Date(`${String(playerRow.menhir_chosen_at).replace(' ', 'T')}Z`);
  chosen.setUTCMonth(chosen.getUTCMonth() + MENHIR_CHANGE_MONTHS);
  return chosen;
}

export function canChangeMenhir(playerRow, now = new Date()) {
  const availableAt = menhirChangeAvailableAt(playerRow);
  return availableAt === null || availableAt <= now;
}
