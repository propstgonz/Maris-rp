

















import { SlashCommandBuilder, EmbedBuilder, MessageFlags } from 'discord.js';
import { getTileWithDetails, removeConstruction } from '../../services/mapService.js';
import { clearTileItem, clearAllTileItems } from '../../services/tileItemService.js';
import { requireRolepriest } from '../../utils/permissions.js';
import { COLORS } from '../../utils/embeds.js';
import logger from '../../utils/logger.js';

export default {
  data: new SlashCommandBuilder()
    .setName('casilla-admin')
    .setDescription('[Staff] Limpia o resetea el contenido de una casilla del mapa')


    .addSubcommand(sub =>
      sub
        .setName('clean')
        .setDescription('Quita un ítem tirado o una construcción de una casilla')
        .addIntegerOption(opt => opt.setName('x').setDescription('Coordenada X').setRequired(true))
        .addIntegerOption(opt => opt.setName('y').setDescription('Coordenada Y').setRequired(true))
        .addStringOption(opt => opt.setName('item').setDescription('Nombre del ítem tirado a quitar').setRequired(false))
        .addIntegerOption(opt => opt.setName('construccion_id').setDescription('ID de la construcción a quitar').setRequired(false).setMinValue(1))
    )


    .addSubcommand(sub =>
      sub
        .setName('reset')
        .setDescription('Vacía por completo una casilla (ítems y construcciones)')
        .addIntegerOption(opt => opt.setName('x').setDescription('Coordenada X').setRequired(true))
        .addIntegerOption(opt => opt.setName('y').setDescription('Coordenada Y').setRequired(true))
    ),


  async execute(interaction) {
    if (!await requireRolepriest(interaction)) return;

    const sub = interaction.options.getSubcommand();
    const x = interaction.options.getInteger('x', true);
    const y = interaction.options.getInteger('y', true);




    if (sub === 'clean') {
      const itemName = interaction.options.getString('item');
      const constructionId = interaction.options.getInteger('construccion_id');

      if (!itemName && !constructionId) {
        return interaction.reply({
          content: '❌ Especifica `item` o `construccion_id` (o ambos).',
          flags: MessageFlags.Ephemeral,
        });
      }

      const results = [];
      try {
        if (itemName) {
          const changes = await clearTileItem(x, y, itemName);
          results.push(changes > 0 ? `🗑️ Ítem \`${itemName}\` quitado del suelo.` : `*No había \`${itemName}\` tirado ahí.*`);
        }
        if (constructionId) {
          const removed = await removeConstruction(constructionId);
          results.push(`🗑️ Construcción **${removed.name}** eliminada.`);
        }
      } catch (err) {
        return interaction.reply({ content: `❌ ${err.message}`, flags: MessageFlags.Ephemeral });
      }

      logger.info(`[/casilla-admin clean] ${interaction.user.tag} limpió (${x},${y}): ${results.join(' ')}`);

      return interaction.reply({
        embeds: [
          new EmbedBuilder()
            .setColor(COLORS.BLUE)
            .setTitle(`🧹 Casilla (${x}, ${y}) limpiada`)
            .setDescription(results.join('\n'))
            .setFooter({ text: `Operación de ${interaction.user.tag}` })
            .setTimestamp(),
        ],
      });
    }




    if (sub === 'reset') {
      const tile = await getTileWithDetails(x, y);
      if (!tile) {
        return interaction.reply({ content: `❌ No existe ninguna casilla en **(${x}, ${y})**.`, flags: MessageFlags.Ephemeral });
      }

      let itemsCleared = 0;
      try {
        itemsCleared = await clearAllTileItems(x, y);
      } catch (err) {
        return interaction.reply({ content: `❌ ${err.message}`, flags: MessageFlags.Ephemeral });
      }

      for (const c of tile.constructions) {
        await removeConstruction(c.id);
      }

      logger.info(`[/casilla-admin reset] ${interaction.user.tag} vació (${x},${y}): ${itemsCleared} ítem(s), ${tile.constructions.length} construcción(es)`);

      return interaction.reply({
        embeds: [
          new EmbedBuilder()
            .setColor(COLORS.RED)
            .setTitle(`🧹 Casilla (${x}, ${y}) reseteada por completo`)
            .addFields(
              { name: '📦 Ítems eliminados',          value: `${itemsCleared}`,                 inline: true },
              { name: '🏗️ Construcciones eliminadas', value: `${tile.constructions.length}`,    inline: true }
            )
            .setFooter({ text: `Operación de ${interaction.user.tag}` })
            .setTimestamp(),
        ],
      });
    }
  },
};
