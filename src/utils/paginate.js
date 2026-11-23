import { ActionRowBuilder, ButtonBuilder, ButtonStyle } from 'discord.js';
import { buildCustomId } from './componentAuth.js';

export const PAGINATION_NS = 'pag';
export const PAGE_SIZE = 10;

export function totalPages(total, pageSize = PAGE_SIZE) {
  return Math.max(1, Math.ceil(Number(total) / pageSize));
}

export function clampPage(page, pages) {
  const n = Math.trunc(Number(page)) || 1;
  return Math.min(Math.max(n, 1), pages);
}

export function buildPaginationCtx({ view, page, playerId, extra = null }) {
  return `${view}.${page}.${playerId}.${extra ?? '-'}`;
}

export function parsePaginationCtx(ctx) {
  const [view, page, playerId, extra] = String(ctx).split('.');
  const pageNumber = Number(page);
  const player = Number(playerId);
  if (!view || !Number.isInteger(pageNumber) || !Number.isInteger(player)) return null;
  return { view, page: pageNumber, playerId: player, extra: !extra || extra === '-' ? null : extra };
}

export function paginationRow({ owner, view, page, pages, playerId, extra = null }) {
  const ctx = buildPaginationCtx({ view, page, playerId, extra });
  const button = (action, label, disabled) => new ButtonBuilder()
    .setCustomId(buildCustomId({ ns: PAGINATION_NS, action, owner, ctx }))
    .setLabel(label)
    .setStyle(ButtonStyle.Secondary)
    .setDisabled(disabled);

  return new ActionRowBuilder().addComponents(
    button('prev', '◀', page <= 1),
    new ButtonBuilder()
      .setCustomId(buildCustomId({ ns: PAGINATION_NS, action: 'info', owner, ctx }))
      .setLabel(`Página ${page}/${pages}`)
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(true),
    button('next', '▶', page >= pages),
  );
}

export function targetPage(action, page, pages) {
  return clampPage(action === 'next' ? page + 1 : page - 1, pages);
}
