import { icon } from '../lib/icons';

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

export function escapeAttr(value: string): string {
  return escapeHtml(value)
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function emojiOr(value: string | null | undefined, iconName: string, size = 13): string {
  return value ? escapeAttr(value) : icon(iconName, { size });
}
