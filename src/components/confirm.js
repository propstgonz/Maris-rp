import { ActionRowBuilder, ButtonBuilder, ButtonStyle, ComponentType, EmbedBuilder, MessageFlags } from 'discord.js';
import { COLORS } from '../utils/embeds.js';

export const FLOW_TIMEOUT_MS = 60_000;

export async function replyEphemeral(interaction, payload) {
  if (interaction.replied || interaction.deferred) return interaction.editReply(payload);
  await interaction.reply({ ...payload, flags: MessageFlags.Ephemeral });
  return interaction.fetchReply();
}

export async function awaitFrom(message, interaction, componentType, time = FLOW_TIMEOUT_MS) {
  try {
    return await message.awaitMessageComponent({
      componentType,
      filter: i => i.user.id === interaction.user.id,
      time,
    });
  } catch {
    await interaction.editReply({ content: '⌛ Se agotó el tiempo. Vuelve a empezar.', embeds: [], components: [] }).catch(() => {});
    return null;
  }
}

function normalizeConfirmSpec(spec) {
  if (typeof spec === 'string') {
    return {
      embed: new EmbedBuilder().setColor(COLORS.YELLOW).setTitle('⚠️ Confirma la acción').setDescription(spec),
      danger: true,
    };
  }
  if (spec instanceof EmbedBuilder) return { embed: spec };
  return spec;
}

export async function confirmAction(interaction, spec) {
  const { embed, confirmLabel = 'Confirmar', danger = false } = normalizeConfirmSpec(spec);
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`ok-${interaction.id}`)
      .setLabel(confirmLabel)
      .setStyle(danger ? ButtonStyle.Danger : ButtonStyle.Success),
    new ButtonBuilder()
      .setCustomId(`no-${interaction.id}`)
      .setLabel('Cancelar')
      .setStyle(ButtonStyle.Secondary),
  );
  const message = await replyEphemeral(interaction, { content: '', embeds: [embed], components: [row] });
  const click = await awaitFrom(message, interaction, ComponentType.Button);
  if (!click) return null;
  await click.deferUpdate();
  if (click.customId.startsWith('no-')) {
    await interaction.editReply({ content: 'Cancelado.', embeds: [], components: [] });
    return null;
  }
  return (payload) => interaction.editReply({ content: '', embeds: [], components: [], ...payload });
}
