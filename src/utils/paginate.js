import { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, MessageFlags } from 'discord.js';
import { COLORS } from './embeds.js';
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

export const CATALOG_PAGE_SIZE = 25;
const CATALOG_PAGE_TIME_MS = 120_000;

export async function paginate(interaction, { title, lines, color = COLORS.BLUE, empty = 'No hay nada que mostrar.' }) {
  const pages = totalPages(lines.length, CATALOG_PAGE_SIZE);
  const prevId = `catalog_prev_${interaction.id}`;
  const nextId = `catalog_next_${interaction.id}`;
  let page = 0;

  const render = () => ({
    embeds: [new EmbedBuilder()
      .setColor(color)
      .setTitle(title)
      .setDescription(lines.slice(page * CATALOG_PAGE_SIZE, (page + 1) * CATALOG_PAGE_SIZE).join('\n') || empty)
      .setFooter({ text: `Página ${page + 1}/${pages} · ${lines.length} en total` })],
    components: pages > 1 ? [new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(prevId).setLabel('◀').setStyle(ButtonStyle.Secondary).setDisabled(page === 0),
      new ButtonBuilder().setCustomId(nextId).setLabel('▶').setStyle(ButtonStyle.Secondary).setDisabled(page === pages - 1),
    )] : [],
  });

  const message = await interaction.reply({ ...render(), flags: MessageFlags.Ephemeral, withResponse: true })
    .then(response => response?.resource?.message ?? interaction.fetchReply());
  if (pages === 1) return;

  const filter = i => i.user.id === interaction.user.id && [prevId, nextId].includes(i.customId);
  for (;;) {
    const click = await message.awaitMessageComponent({ filter, time: CATALOG_PAGE_TIME_MS }).catch(() => null);
    if (!click) break;
    page += click.customId === nextId ? 1 : -1;
    await click.update(render());
  }
  await interaction.editReply({ components: [] }).catch(() => {});
}
