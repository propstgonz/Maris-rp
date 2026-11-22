import { icon } from '../lib/icons';

export function statusPillHtml(isAlive: boolean, hp: number | null = null) {
  return isAlive
    ? `<span class="status-pill status-pill-alive">${icon('heart', { size: 13 })} ${hp ?? 'Vivo'}</span>`
    : `<span class="status-pill status-pill-dead">${icon('skull', { size: 13 })} Muerto</span>`;
}
