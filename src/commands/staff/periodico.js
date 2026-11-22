









import { SlashCommandBuilder, ChannelType, EmbedBuilder, MessageFlags } from 'discord.js';
import { getSetting, setSetting } from '../../services/settingsService.js';
import { requireRolepriest } from '../../utils/permissions.js';
import { COLORS }       from '../../utils/embeds.js';
import logger             from '../../utils/logger.js';
import { logAction }      from '../../services/auditLogService.js';

export default {
  data: new SlashCommandBuilder()
    .setName('periodico')
    .setDescription('[Staff] Gestiona la categoría de canales-periódico (Imprenta)')

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

    return interaction.reply({ content: '❌ Subcomando no reconocido.', flags: MessageFlags.Ephemeral });
  },
};
