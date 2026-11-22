import { SlashCommandBuilder, EmbedBuilder } from 'discord.js';
import { getSetting, setSetting } from '../../services/settingsService.js';
import { requireRolepriest } from '../../utils/permissions.js';
import { COLORS }       from '../../utils/embeds.js';
import logger             from '../../utils/logger.js';
import { logAction }      from '../../services/auditLogService.js';

export default {
  data: new SlashCommandBuilder()
    .setName('move-freedom')
    .setDescription('[Staff] Activa o desactiva el movimiento libre de los jugadores'),

  async execute(interaction) {
    if (!await requireRolepriest(interaction)) return;

    const current = (await getSetting('move_freedom', 'true')) !== 'false';
    const next = !current;
    await setSetting('move_freedom', next ? 'true' : 'false');

    logger.info(`[/move-freedom] ${interaction.user.tag}: ${current} → ${next}`);
    logAction({ source: 'discord', actorDiscordId: interaction.user.id, actorUsername: interaction.user.tag, action: 'settings.move_freedom', details: { enabled: next } });

    const embed = new EmbedBuilder()
      .setColor(next ? COLORS.GREEN : COLORS.RED)
      .setTitle(next ? '🟢 Movimiento libre ACTIVADO' : '🔴 Movimiento libre DESACTIVADO')
      .setDescription(
        next
          ? 'Los jugadores pueden volver a usar `/move` para desplazarse por su cuenta.'
          : 'Los jugadores ya no pueden usar `/move` por su cuenta — Staff puede seguir moviéndolos con `/tp`.'
      )
      .setFooter({ text: `Cambiado por ${interaction.user.tag}` })
      .setTimestamp();

    return interaction.reply({ embeds: [embed] });
  },
};
