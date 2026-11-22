import { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, MessageFlags } from 'discord.js';
import { callerIsRolepriest } from './interactionContext.js';
import { COLORS } from './embeds.js';

const CONFIRM_TIME_MS = 60_000;
const PAGE_TIME_MS = 120_000;
export const PAGE_SIZE = 25;

function button(id, label, emoji, style) {
  return new ButtonBuilder().setCustomId(id).setLabel(label).setEmoji(emoji).setStyle(style);
}

export function replyEphemeral(interaction) {
  return payload => interaction.reply({ ...payload, flags: MessageFlags.Ephemeral });
}

export async function confirmAction(interaction, description) {
  const confirmId = `staffui_ok_${interaction.id}`;
  const cancelId = `staffui_no_${interaction.id}`;
  const row = new ActionRowBuilder().addComponents(
    button(confirmId, 'Confirmar', '✅', ButtonStyle.Danger),
    button(cancelId, 'Cancelar', '✖️', ButtonStyle.Secondary),
  );
  const message = await interaction.reply({
    embeds: [new EmbedBuilder().setColor(COLORS.YELLOW).setTitle('⚠️ Confirma la acción').setDescription(description)],
    components: [row],
    flags: MessageFlags.Ephemeral,
    withResponse: true,
  }).then(response => response?.resource?.message ?? interaction.fetchReply());

  const click = await message.awaitMessageComponent({
    filter: i => i.user.id === interaction.user.id && [confirmId, cancelId].includes(i.customId),
    time: CONFIRM_TIME_MS,
  }).catch(() => null);

  if (click?.customId !== confirmId) {
    const payload = { embeds: [new EmbedBuilder().setColor(COLORS.GREY).setDescription('Acción cancelada.')], components: [] };
    if (click) await click.update(payload);
    else await interaction.editReply(payload).catch(() => {});
    return null;
  }

  await click.update({ components: [], embeds: [new EmbedBuilder().setColor(COLORS.GREY).setDescription('⏳ Procesando…')] });
  return payload => interaction.editReply({ content: null, components: [], ...payload });
}

export async function paginate(interaction, { title, lines, color = COLORS.BLUE, empty = 'No hay nada que mostrar.' }) {
  const pages = Math.max(1, Math.ceil(lines.length / PAGE_SIZE));
  const prevId = `staffui_prev_${interaction.id}`;
  const nextId = `staffui_next_${interaction.id}`;
  let page = 0;

  const render = () => ({
    embeds: [new EmbedBuilder()
      .setColor(color)
      .setTitle(title)
      .setDescription(lines.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE).join('\n') || empty)
      .setFooter({ text: `Página ${page + 1}/${pages} · ${lines.length} en total` })],
    components: pages > 1 ? [new ActionRowBuilder().addComponents(
      button(prevId, 'Anterior', '◀️', ButtonStyle.Secondary).setDisabled(page === 0),
      button(nextId, 'Siguiente', '▶️', ButtonStyle.Secondary).setDisabled(page === pages - 1),
    )] : [],
  });

  const message = await interaction.reply({ ...render(), flags: MessageFlags.Ephemeral, withResponse: true })
    .then(response => response?.resource?.message ?? interaction.fetchReply());
  if (pages === 1) return;

  const filter = i => i.user.id === interaction.user.id && [prevId, nextId].includes(i.customId);
  for (;;) {
    const click = await message.awaitMessageComponent({ filter, time: PAGE_TIME_MS }).catch(() => null);
    if (!click) break;
    page += click.customId === nextId ? 1 : -1;
    await click.update(render());
  }
  await interaction.editReply({ components: [] }).catch(() => {});
}

export function staffAutocomplete(handlers) {
  return async interaction => {
    if (!await callerIsRolepriest(interaction)) return interaction.respond([]);
    const focused = interaction.options.getFocused(true);
    const handler = handlers[focused.name];
    return interaction.respond(handler ? await handler(focused.value, interaction) : []);
  };
}

export function targetDiscordId(interaction, optionName = 'jugador') {
  return interaction.options.get(optionName)?.value ?? null;
}

export function includesText(text, ...values) {
  const needle = String(text ?? '').toLowerCase();
  return values.some(v => String(v ?? '').toLowerCase().includes(needle));
}

export function withDefined(entries) {
  return Object.fromEntries(Object.entries(entries).filter(([, v]) => v !== null && v !== undefined));
}
