import {
  ButtonBuilder, ButtonStyle, ActionRowBuilder,
  ModalBuilder, TextInputBuilder, TextInputStyle,
  EmbedBuilder,
} from 'discord.js';
import { getPlayerByDiscordId } from '../services/playerService.js';
import { createPrintingPressChannel } from '../services/newspaperService.js';
import { buildCustomId } from '../utils/componentAuth.js';
import { UserFacingError } from '../utils/errors.js';
import { COLORS } from '../utils/embeds.js';
import logger from '../utils/logger.js';
import { logAction } from '../services/auditLogService.js';

export const PRINTING_PRESS_NS = 'imprenta';

export async function announcePrintingPressBuilt(interaction, discordId, pressRef) {
  if (!interaction.guild) return;

  const button = new ButtonBuilder()
    .setCustomId(buildCustomId({ ns: PRINTING_PRESS_NS, action: 'open_modal', owner: discordId, ctx: String(pressRef) }))
    .setLabel('Crear periódico')
    .setEmoji('🗞️')
    .setStyle(ButtonStyle.Primary);

  await interaction.followUp({
    content: `<@${discordId}> — tu imprenta está lista. ¿Quieres crear tu canal de periódico?`,
    components: [new ActionRowBuilder().addComponents(button)],
  }).catch(err => logger.warn(`[PrintingPress] No se pudo anunciar la imprenta: ${err.message}`));
}

function _buildPeriodicoNameModal(discordId, pressRef) {
  return new ModalBuilder()
    .setCustomId(buildCustomId({ ns: PRINTING_PRESS_NS, action: 'submit', owner: discordId, ctx: String(pressRef) }))
    .setTitle('Nombre de tu periódico')
    .addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId('nombre')
          .setLabel('Nombre del canal')
          .setStyle(TextInputStyle.Short)
          .setPlaceholder('Ej. El Heraldo de Ricardana')
          .setMaxLength(80)
          .setRequired(true)
      )
    );
}

export async function handlePrintingPressComponent(interaction, parsed) {
  if (parsed.action === 'open_modal') {
    return interaction.showModal(_buildPeriodicoNameModal(parsed.owner, parsed.ctx));
  }

  const chosenName = interaction.fields.getTextInputValue('nombre').trim();
  if (!chosenName) {
    throw new UserFacingError('El nombre no puede estar vacío.');
  }

  const player = await getPlayerByDiscordId(interaction.user.id);
  if (!player) {
    throw new UserFacingError('Tu perfil no está registrado. Usa `/personaje crear` para empezar a rolear.');
  }

  const channel = await createPrintingPressChannel(interaction.guild, player, chosenName);

  logger.info(`[PrintingPress] ${interaction.user.tag} creó su periódico #${channel.name} (${channel.id})`);
  logAction({
    source: 'discord', actorDiscordId: interaction.user.id, actorUsername: interaction.user.tag,
    action: 'player.printing_press_channel', target: channel.id,
    details: { channelName: channel.name },
  });

  return interaction.reply({
    embeds: [
      new EmbedBuilder()
        .setColor(COLORS.GREEN)
        .setTitle('🗞️ Periódico creado')
        .setDescription(`<#${channel.id}> ya es tuyo — tienes todos los permisos sobre él.`)
        .setTimestamp(),
    ],
  });
}
