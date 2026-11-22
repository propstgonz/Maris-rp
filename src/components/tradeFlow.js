




























import {
  EmbedBuilder, ActionRowBuilder, StringSelectMenuBuilder, MessageFlags,
  ModalBuilder, TextInputBuilder, TextInputStyle,
} from 'discord.js';
import { getPlayerByDiscordId, getPlayersAtTile } from '../services/playerService.js';
import { getInventory } from '../services/inventoryService.js';
import { createPendingTrade } from '../services/tradeConsentService.js';
import { buildCustomId } from '../utils/componentAuth.js';
import { UserFacingError } from '../utils/errors.js';
import { COLORS } from '../utils/embeds.js';
import logger from '../utils/logger.js';
import { componentEmoji } from '../utils/emoji.js';

export const TRADE_NS = 'trade2';

const MAX_SELECT_OPTIONS = 25;
const QTY_INPUT_ID = 'cantidad';


export async function buildTradePickerMessage(discordId) {
  const player = await getPlayerByDiscordId(discordId);
  if (!player?.character_created_at) {
    throw new UserFacingError('Todavía no tienes un personaje. Usa `/personaje crear` para empezar.');
  }

  const others = (await getPlayersAtTile(player.coord_x, player.coord_y))
    .filter(p => p.discord_id !== discordId && p.is_alive)
    .slice(0, MAX_SELECT_OPTIONS);

  if (others.length === 0) {
    throw new UserFacingError(
      `No hay nadie más en tu casilla (${player.coord_x}, ${player.coord_y}) con quien comerciar — ` +
      'para intercambiar hay que estar en la misma casilla.'
    );
  }

  const select = new StringSelectMenuBuilder()
    .setCustomId(buildCustomId({ ns: TRADE_NS, action: 'who', owner: discordId }))
    .setPlaceholder('¿A quién le ofreces?')
    .addOptions(others.map(p => ({
      label: (p.character_name ?? p.username).slice(0, 100),
      value: p.discord_id,
      emoji: '🧑',
    })));

  const embed = new EmbedBuilder()
    .setColor(COLORS.BLUE)
    .setTitle('🤝 Ofrecer un intercambio')
    .setDescription(`Gente en tu casilla (${player.coord_x}, ${player.coord_y}):`);

  return {
    embeds: [embed],
    components: [new ActionRowBuilder().addComponents(select)],
    flags: MessageFlags.Ephemeral,
  };
}


async function buildItemMessage(discordId, toDiscordId) {
  const items = (await getInventory(discordId))
    .filter(row => row.quantity > 0 && row.name !== 'laburo')
    .slice(0, MAX_SELECT_OPTIONS);

  if (items.length === 0) throw new UserFacingError('No llevas nada que ofrecer.');

  const select = new StringSelectMenuBuilder()
    .setCustomId(buildCustomId({ ns: TRADE_NS, action: 'what', owner: discordId, ctx: toDiscordId }))
    .setPlaceholder('¿Qué ofreces?')
    .addOptions(items.map(row => ({
      label: `${row.display_name} (llevas ${row.quantity})`.slice(0, 100),
      value: row.name,
      emoji: componentEmoji(row.emoji, '📦'),
    })));

  const embed = new EmbedBuilder().setColor(COLORS.BLUE).setTitle('🤝 ¿Qué ofreces?');
  return { embeds: [embed], components: [new ActionRowBuilder().addComponents(select)] };
}


function buildQuantityModal(discordId, toDiscordId, itemName, maxQuantity) {
  return new ModalBuilder()
    .setCustomId(buildCustomId({ ns: TRADE_NS, action: 'qty', owner: discordId, ctx: `${toDiscordId}.${itemName}` }))
    .setTitle('¿Cuántas unidades?')
    .addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId(QTY_INPUT_ID)
          .setLabel(`Cantidad (llevas ${maxQuantity})`.slice(0, 45))
          .setStyle(TextInputStyle.Short)
          .setPlaceholder('1')
          .setRequired(true)
          .setMaxLength(10)
      )
    );
}


export async function handleTradeComponent(interaction, parsed) {
  const discordId = interaction.user.id;

  if (parsed.action === 'who') {
    return interaction.update(await buildItemMessage(discordId, interaction.values[0]));
  }

  if (parsed.action === 'what') {
    const itemName = interaction.values[0];
    const row = (await getInventory(discordId)).find(r => r.name === itemName && r.quantity > 0);
    if (!row) throw new UserFacingError('Ya no llevas ese objeto. Vuelve a lanzar `/trade`.');



    return interaction.showModal(buildQuantityModal(discordId, parsed.ctx, itemName, row.quantity));
  }


  const [toDiscordId, itemName] = parsed.ctx.split('.');
  const raw = interaction.fields.getTextInputValue(QTY_INPUT_ID).trim().replace(',', '.');
  const cantidad = Number(raw);



  if (!Number.isFinite(cantidad) || cantidad <= 0) {
    throw new UserFacingError(`\`${raw}\` no es una cantidad válida — tiene que ser un número mayor que 0.`);
  }

  const player = await getPlayerByDiscordId(discordId);


  const offer = await createPendingTrade(discordId, toDiscordId, itemName, cantidad, { x: player.coord_x, y: player.coord_y });

  logger.info(`[/trade] ${interaction.user.tag} propuso x${cantidad} "${itemName}" (oferta #${offer.id}, flujo guiado)`);



  return interaction.reply(offer.payload);
}
