
















import { SlashCommandBuilder, MessageFlags } from 'discord.js';
import { getPlayerByDiscordId }              from '../../services/playerService.js';
import { createPendingTrade }                from '../../services/tradeConsentService.js';
import { requireCharacter }                  from '../../utils/permissions.js';
import { handleItemAutocomplete }            from '../../utils/autocomplete.js';
import { buildTradePickerMessage }           from '../../components/tradeFlow.js';
import logger                                from '../../utils/logger.js';

export default {
  data: new SlashCommandBuilder()
    .setName('trade')
    .setDescription('Intercambia ítems con otro jugador en tu misma casilla del mapa')




    .addUserOption(opt =>
      opt
        .setName('jugador')
        .setDescription('Jugador al que enviar los ítems. Si omites las tres opciones, se abre un menú guiado')
        .setRequired(false)
    )
    .addStringOption(opt =>
      opt
        .setName('item')
        .setDescription('Nombre del ítem a intercambiar (ej: hierro, pan, monedas)')
        .setRequired(false)
        .setAutocomplete(true)
    )
    .addIntegerOption(opt =>
      opt
        .setName('cantidad')
        .setDescription('Cantidad a transferir')
        .setRequired(false)
        .setMinValue(1)
    ),


  async autocomplete(interaction) {
    await handleItemAutocomplete(interaction);
  },


  async execute(interaction) {

    if (!await requireCharacter(interaction)) return;

    const rawTarget = interaction.options.getUser('jugador');
    const rawItem   = interaction.options.getString('item');
    const rawQty    = interaction.options.getInteger('cantidad');




    if (!rawTarget && !rawItem && rawQty === null) {
      return interaction.reply(await buildTradePickerMessage(interaction.user.id));
    }
    if (!rawTarget || !rawItem || rawQty === null) {
      return interaction.reply({
        content: '❌ Da las tres opciones (jugador, item, cantidad) — o ninguna, para abrir el menú guiado.',
        flags: MessageFlags.Ephemeral,
      });
    }

    const targetUser = rawTarget;
    const itemName   = rawItem.toLowerCase().trim();
    const cantidad   = rawQty;




    if (itemName === 'laburo') {
      return interaction.reply({
        content: '❌ El Laburo no se tradea con `/trade` — usa `/laburo trade jugador:@alguien cantidad:N`.',
        flags: MessageFlags.Ephemeral,
      });
    }


    if (targetUser.id === interaction.user.id) {
      return interaction.reply({
        content: '❌ No puedes comerciar contigo mismo.',
        flags: MessageFlags.Ephemeral,
      });
    }








    const player = await getPlayerByDiscordId(interaction.user.id);

    let offer;
    try {
      offer = await createPendingTrade(interaction.user.id, targetUser.id, itemName, cantidad, { x: player.coord_x, y: player.coord_y });
    } catch (err) {
      return interaction.reply({ content: `❌ ${err.message}`, flags: MessageFlags.Ephemeral });
    }

    logger.info(`[/trade] ${interaction.user.tag} propuso a ${targetUser.tag}: x${cantidad} "${itemName}" (oferta #${offer.id})`);

    return interaction.reply(offer.payload);
  },
};
