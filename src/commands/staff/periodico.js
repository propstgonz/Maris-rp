

import { SlashCommandBuilder, ChannelType, EmbedBuilder, MessageFlags } from 'discord.js';
import { getSetting, setSetting } from '../../services/settingsService.js';
import { requireRolepriest, resolveGuild } from '../../utils/permissions.js';
import { requireOtherTarget } from '../../utils/interactionContext.js';
import { createPrintingPressChannel } from '../../services/newspaperService.js';
import { UserFacingError } from '../../utils/errors.js';
import { COLORS }       from '../../utils/embeds.js';
import logger             from '../../utils/logger.js';
import { logAction }      from '../../services/auditLogService.js';

export default {
  data: new SlashCommandBuilder()
    .setName('periodico')
    .setDescription('[Staff] Gestiona los canales-periódico (Imprenta)')

    .addSubcommand(sub =>
      sub
        .setName('categoria')
        .setDescription('Fija la categoría de Discord donde se crean los canales-periódico')
        .addChannelOption(opt =>
          opt
            .setName('categoria')
            .setDescription('Categoría de Discord')
            .addChannelTypes(ChannelType.GuildCategory)
            .setRequired(true)
        )
    )
    .addSubcommand(sub =>
      sub
        .setName('abrir')
        .setDescription('Abre la imprenta de un jugador creándole su canal-periódico')
        .addUserOption(opt => opt.setName('jugador').setDescription('Jugador dueño del periódico').setRequired(true))
        .addStringOption(opt => opt.setName('nombre').setDescription('Nombre del canal').setRequired(true).setMaxLength(80))
    ),


  async execute(interaction) {
    if (!await requireRolepriest(interaction)) return;

    const sub = interaction.options.getSubcommand();

    if (sub === 'categoria') {
      const categoria = interaction.options.getChannel('categoria', true);
      const before = await getSetting('newspaper_category_id', process.env.NEWSPAPER_CATEGORY_ID ?? null);

      await setSetting('newspaper_category_id', categoria.id);
      logger.info(`[/periodico categoria] ${interaction.user.tag}: ${before ?? '(sin configurar)'} → ${categoria.id}`);
      logAction({ source: 'discord', actorDiscordId: interaction.user.id, actorUsername: interaction.user.tag, action: 'settings.newspaper_category', target: categoria.id, details: { before } });

      return interaction.reply({
        embeds: [
          new EmbedBuilder()
            .setColor(COLORS.BLUE)
            .setTitle('🗞️ Categoría de periódicos actualizada')
            .setDescription(`Los próximos canales-periódico se crearán en **${categoria.name}**.`)
            .setFooter({ text: `Cambiado por ${interaction.user.tag}` })
            .setTimestamp(),
        ],
      });
    }

    if (sub === 'abrir') {
      const player = await requireOtherTarget(interaction);
      const guild = resolveGuild(interaction);
      if (!guild) throw new UserFacingError('No se encontró el servidor donde crear el canal.');

      let channel;
      try {
        channel = await createPrintingPressChannel(guild, player, interaction.options.getString('nombre', true).trim());
      } catch (err) {
        throw err instanceof UserFacingError ? err : new UserFacingError(err.message);
      }

      logger.info(`[/periodico abrir] ${interaction.user.tag} abrió el periódico #${channel.name} (${channel.id}) de ${player.discord_id}`);
      await logAction({ source: 'discord', actorDiscordId: interaction.user.id, actorUsername: interaction.user.tag, action: 'staff.printing_press_channel', target: channel.id, details: { playerDiscordId: player.discord_id, channelName: channel.name } });

      return interaction.reply({
        embeds: [new EmbedBuilder().setColor(COLORS.GREEN).setTitle('🗞️ Periódico abierto').setDescription(`<#${channel.id}> es ahora el periódico de <@${player.discord_id}>.`)],
        flags: MessageFlags.Ephemeral,
      });
    }

    return interaction.reply({ content: '❌ Subcomando no reconocido.', flags: MessageFlags.Ephemeral });
  },
};
