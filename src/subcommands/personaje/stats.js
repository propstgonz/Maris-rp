














import { MessageFlags } from 'discord.js';
import { getPlayerStats, getPlayerByDiscordId } from '../../services/playerService.js';
import { getAvailableLaburo, getLaburoCooldownRemaining } from '../../services/laburoService.js';
import { getTravelStatus, planPath }      from '../../services/travelService.js';
import { buildStatsEmbed }     from '../../utils/embeds.js';
import { requireCharacter, requireRolepriest, MAX_HP, MAX_HUNGER } from '../../utils/permissions.js';
import { getAvatarUrl }        from '../../utils/playerAvatar.js';
import logger                  from '../../utils/logger.js';

export default {
  build: (sub) => sub
    .setName("ficha")
    .setDescription("Tu perfil completo: vida, hambre, Laburo, estados y posición")
    .addUserOption(opt =>
      opt
        .setName('jugador')
        .setDescription('[Staff] Jugador a consultar (por defecto, tú mismo)')
        .setRequired(false)
    ),


  async execute(interaction) {
    const targetUser = interaction.options.getUser('jugador') ?? interaction.user;
    const isSelf      = targetUser.id === interaction.user.id;


    if (isSelf) {
      if (!await requireCharacter(interaction)) return;
    } else {
      if (!await requireRolepriest(interaction)) return;
    }

    const player = await getPlayerByDiscordId(targetUser.id);
    if (!player?.character_created_at) {
      return interaction.reply({
        content: `❌ **${targetUser.username}** todavía no ha creado un personaje.`,
        flags: MessageFlags.Ephemeral,
      });
    }

    const stats = await getPlayerStats(targetUser.id);
    const ephemeralFlags = isSelf ? MessageFlags.Ephemeral : undefined;






    const avatarUrl = getAvatarUrl(stats, '/personaje ficha');


    const laburo = {
      available:       await getAvailableLaburo(targetUser.id),
      cooldownSeconds: await getLaburoCooldownRemaining(targetUser.id),
    };




    let travel = null;
    const travelStatus = await getTravelStatus(targetUser.id);
    if (travelStatus) {
      const path = planPath(stats.coord_x, stats.coord_y, travelStatus.destX, travelStatus.destY);
      const stepsLeft = path.length - 1;
      travel = {
        destX: travelStatus.destX, destY: travelStatus.destY,
        stepsLeft, speedMultiplier: travelStatus.speedMultiplier,
        etaHours: Math.ceil(stepsLeft / travelStatus.speedMultiplier),
      };
    }


    const embed = await buildStatsEmbed(stats, avatarUrl, MAX_HP, MAX_HUNGER, laburo, travel);

    logger.debug(
      `[/stats] ${interaction.user.tag} consultó a ${targetUser.tag}`
    );




    try {
      return await interaction.reply({ embeds: [embed], flags: ephemeralFlags });
    } catch (err) {
      if (avatarUrl) {
        logger.warn(`[/stats] Discord rechazó el embed con miniatura (${err.message}); reintentando sin ella.`);
        const fallbackEmbed = await buildStatsEmbed(stats, null, MAX_HP, MAX_HUNGER, laburo, travel);
        return interaction.reply({ embeds: [fallbackEmbed], flags: ephemeralFlags });
      }
      throw err;
    }
  },
};
