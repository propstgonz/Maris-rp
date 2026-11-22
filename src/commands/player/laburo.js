import { SlashCommandBuilder, EmbedBuilder, MessageFlags } from 'discord.js';
import TRABAJAR from '../../subcommands/laburo/laburar.js';
import { tradeBetweenPlayers } from '../../services/tradeService.js';
import { requireCharacter, resolveGuild, config } from '../../utils/permissions.js';
import { COLORS }              from '../../utils/embeds.js';
import { getAvatarUrl }        from '../../utils/playerAvatar.js';
import { logAction }           from '../../services/auditLogService.js';
import logger                  from '../../utils/logger.js';

const TRANSACTIONS_CHANNEL = config.channels?.transactions;

export default {
  data: new SlashCommandBuilder()
    .setName('laburo')
    .setDescription('Trabaja para ganar Laburo, o tradéalo con otro jugador')
    .addSubcommand(TRABAJAR.build)
    .addSubcommand(sub =>
      sub
        .setName('trade')
        .setDescription('Dale parte de tu Laburo a otro jugador en tu misma casilla')
        .addUserOption(opt => opt.setName('jugador').setDescription('Jugador receptor').setRequired(true))
        .addNumberOption(opt => opt.setName('cantidad').setDescription('Cantidad a transferir').setRequired(true).setMinValue(0.01))
    ),

  async execute(interaction) {
    const sub = interaction.options.getSubcommand();

    if (sub === 'trabajar') return TRABAJAR.execute(interaction);

    if (sub === 'trade') {
      if (!await requireCharacter(interaction)) return;

      const targetUser = interaction.options.getUser('jugador', true);
      const cantidad    = interaction.options.getNumber('cantidad', true);

      if (targetUser.id === interaction.user.id) {
        return interaction.reply({ content: '❌ No puedes darte Laburo a ti mismo.', flags: MessageFlags.Ephemeral });
      }

      let tradeResult;
      try {
        tradeResult = await tradeBetweenPlayers(interaction.user.id, targetUser.id, 'laburo', cantidad);
      } catch (err) {
        return interaction.reply({ content: `❌ ${err.message}`, flags: MessageFlags.Ephemeral });
      }

      const { from, to, coord } = tradeResult;

      logger.info(`[/laburo trade] ${from.username} → ${to.username}: ${cantidad} Laburo @ (${coord.x},${coord.y})`);
      logAction({
        source: 'discord', actorDiscordId: interaction.user.id, actorUsername: interaction.user.tag,
        action: 'laburo.trade', target: to.discord_id,
        details: { toCharacterName: to.character_name ?? to.username, quantity: cantidad },
      });

      const embed = new EmbedBuilder()
        .setColor(COLORS.DARK)
        .setTitle('💪 Laburo transferido')
        .setDescription(`**${from.username}** le dio **${cantidad}** de Laburo a **${to.username}**.`)
        .addFields(
          { name: '📤 Emisor',   value: `<@${from.discord_id}>`, inline: true },
          { name: '📥 Receptor', value: `<@${to.discord_id}>`,   inline: true },
          { name: '📍 Casilla',  value: `**(X: ${coord.x}, Y: ${coord.y})**`, inline: true }
        )
        .setFooter({ text: 'Operación registrada en el log de transacciones' })
        .setTimestamp();

      const avatarUrl = getAvatarUrl(from, '/laburo trade');
      if (avatarUrl) embed.setThumbnail(avatarUrl);

      await interaction.reply({ embeds: [embed] });

      if (TRANSACTIONS_CHANNEL) {
        const guild   = resolveGuild(interaction);
        const channel = await guild?.channels.fetch(TRANSACTIONS_CHANNEL).catch(() => null);
        if (channel?.isTextBased() && channel.id !== interaction.channelId) {
          await channel.send({ embeds: [embed] }).catch(err =>
            logger.warn(`[/laburo trade] No se pudo enviar al canal de transacciones: ${err.message}`)
          );
        }
      }
      return;
    }
  },
};
