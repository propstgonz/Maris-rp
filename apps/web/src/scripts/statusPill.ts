import { icon } from '../lib/icons';

export function statusPillHtml(isAlive: boolean) {
  return isAlive
    ? `<span class="status-pill status-pill-alive">${icon('heart', { size: 13 })} Vivo</span>`
    : `<span class="status-pill status-pill-dead">${icon('skull', { size: 13 })} Muerto</span>`;
}
