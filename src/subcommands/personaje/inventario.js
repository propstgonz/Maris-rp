









import { MessageFlags } from 'discord.js';
import { getPlayerByDiscordId } from '../../services/playerService.js';
import { getInventory, getInventoryWeight } from '../../services/inventoryService.js';
import { buildInventoryEmbed } from '../../utils/embeds.js';
import { getAvatarUrl }        from '../../utils/playerAvatar.js';
import { requireCharacter, requireRolepriest } from '../../utils/permissions.js';
import { buildInventoryActionRow } from '../../components/inventoryFlow.js';
import logger                  from '../../utils/logger.js';

export default {
  build: (sub) => sub
    .setName("inventario")
    .setDescription("Tu inventario, agrupado por tipo")
    .addUserOption(opt =>
      opt
        .setName('jugador')
        .setDescription('[Staff] Jugador a consultar (por defecto, tú mismo)')
        .setRequired(false)
    ),


  async execute(interaction) {
    const targetUser = interaction.options.getUser('jugador') ?? interaction.user;
    const isSelf     = targetUser.id === interaction.user.id;





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

    const items      = await getInventory(targetUser.id);
    const avatarUrl  = getAvatarUrl(player, '/personaje inventario');
    const weightInfo = await getInventoryWeight(targetUser.id);
    const embed      = buildInventoryEmbed(player.username, items, avatarUrl, weightInfo);

    logger.debug(
      `[/inventario] ${interaction.user.tag} consultó a ${targetUser.tag} ` +
      `(${items.length} tipos de ítem)`
    );





    const actionRow = isSelf ? await buildInventoryActionRow(targetUser.id) : null;

    return interaction.reply({ embeds: [embed], components: actionRow ? [actionRow] : [] });
  },
};
