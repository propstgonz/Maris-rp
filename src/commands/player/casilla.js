



















import { SlashCommandBuilder, MessageFlags } from 'discord.js';
import { getPlayerByDiscordId } from '../../services/playerService.js';
import { getTileWithDetails } from '../../services/mapService.js';
import { getItemsAtTile } from '../../services/tileItemService.js';
import { requireCharacter, requireRolepriest } from '../../utils/permissions.js';
import { buildTileInfoEmbed } from '../../utils/embeds.js';

export default {
  data: new SlashCommandBuilder()
    .setName('casilla')
    .setDescription('Consulta la información de una casilla del mapa')


    .addSubcommand(sub =>
      sub
        .setName('info')
        .setDescription('Info de tu casilla actual (o de otra, solo Staff)')
        .addIntegerOption(opt => opt.setName('x').setDescription('[Staff] Coordenada X de otra casilla').setRequired(false))
        .addIntegerOption(opt => opt.setName('y').setDescription('[Staff] Coordenada Y de otra casilla').setRequired(false))
    ),


  async execute(interaction) {
    const sub = interaction.options.getSubcommand();




    if (sub === 'info') {
      const xOpt = interaction.options.getInteger('x');
      const yOpt = interaction.options.getInteger('y');
      const explicitCoords = xOpt !== null && yOpt !== null;

      let x, y;
      if (explicitCoords) {
        const player = await getPlayerByDiscordId(interaction.user.id);
        const isOwnTile = player && player.coord_x === xOpt && player.coord_y === yOpt;
        if (!isOwnTile) {
          if (!await requireRolepriest(interaction)) return;
        } else {
          if (!await requireCharacter(interaction)) return;
        }
        x = xOpt;
        y = yOpt;
      } else {
        if (!await requireCharacter(interaction)) return;
        const player = await getPlayerByDiscordId(interaction.user.id);
        x = player.coord_x;
        y = player.coord_y;
      }

      const tile = await getTileWithDetails(x, y);
      if (!tile) {
        return interaction.reply({
          content: `❌ No existe ninguna casilla registrada en **(${x}, ${y})**. Es territorio desconocido.`,
          flags: MessageFlags.Ephemeral,
        });
      }

      const tileItems = await getItemsAtTile(x, y);
      return interaction.reply({ embeds: [buildTileInfoEmbed(tile, tileItems)] });
    }
  },
};
