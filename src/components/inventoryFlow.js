




























import {
  EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle,
  StringSelectMenuBuilder,
} from 'discord.js';
import { getInventory } from '../services/inventoryService.js';
import { consumeItem } from '../services/consumeService.js';
import { buildCustomId } from '../utils/componentAuth.js';
import { UserFacingError } from '../utils/errors.js';
import { COLORS } from '../utils/embeds.js';
import { logAction } from '../services/auditLogService.js';
import logger from '../utils/logger.js';
import { componentEmoji } from '../utils/emoji.js';

export const INVENTORY_NS = 'inv';

const MAX_SELECT_OPTIONS = 25;


export async function buildInventoryActionRow(discordId) {
  const consumables = (await getInventory(discordId))
    .filter(row => row.item_type === 'consumible' && row.quantity > 0)
    .slice(0, MAX_SELECT_OPTIONS);

  if (consumables.length === 0) return null;

  const select = new StringSelectMenuBuilder()
    .setCustomId(buildCustomId({ ns: INVENTORY_NS, action: 'use', owner: discordId }))
    .setPlaceholder('Usar un objeto…')
    .addOptions(consumables.map(row => ({
      label: `${row.display_name} ×${row.quantity}`.slice(0, 100),
      value: row.name,
      emoji: componentEmoji(row.emoji, '🎒'),
    })));

  return new ActionRowBuilder().addComponents(select);
}


function buildConfirmMessage(discordId, row) {
  const embed = new EmbedBuilder()
    .setColor(COLORS.PURPLE)
    .setTitle(`${row.emoji ?? '🎒'} ¿Usar ${row.display_name}?`)
    .setDescription(`Se gastará **1** de **${row.display_name}** (llevas ${row.quantity}).`);

  const buttons = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(buildCustomId({ ns: INVENTORY_NS, action: 'go', owner: discordId, ctx: row.name }))
      .setLabel('Usar')
      .setStyle(ButtonStyle.Success),
    new ButtonBuilder()
      .setCustomId(buildCustomId({ ns: INVENTORY_NS, action: 'cancel', owner: discordId }))
      .setLabel('Cancelar')
      .setStyle(ButtonStyle.Secondary)
  );

  return { embeds: [embed], components: [buttons] };
}


function buildResultEmbed(row, result) {
  const embed = new EmbedBuilder()
    .setColor(result.died ? COLORS.BLACK : COLORS.GREEN)
    .setTitle(`${row.emoji ?? '🎒'} ${row.display_name} usado`)
    .setTimestamp();

  const lines = [];
  if (result.hpAfter !== result.hpBefore) lines.push(`❤️ **Vida:** ${result.hpBefore} → ${result.hpAfter}`);
  if (result.hungerAfter !== result.hungerBefore) lines.push(`🍗 **Hambre:** ${result.hungerBefore} → ${result.hungerAfter}`);
  embed.setDescription(lines.join('\n') || 'No ha cambiado nada en tus stats.');

  if (result.immortalitySaved) {
    embed.addFields({ name: '♾️ Inmortalidad', value: 'Te habría matado, pero eres inmortal — tu vida se ha quedado en 1.' });
  }
  if (result.died) {
    embed.addFields({ name: '💀 Has muerto', value: 'Consulta tu MD para saber qué puedes hacer ahora.' });
  }
  return embed;
}


export async function handleInventoryComponent(interaction, parsed) {
  const discordId = interaction.user.id;

  if (parsed.action === 'cancel') {
    return interaction.update({ content: 'Cancelado.', embeds: [], components: [] });
  }

  if (parsed.action === 'use') {
    const itemName = interaction.values[0];


    const row = (await getInventory(discordId)).find(r => r.name === itemName && r.quantity > 0);
    if (!row) {
      throw new UserFacingError('Ya no llevas ese objeto. Vuelve a abrir `/personaje inventario`.');
    }
    return interaction.update(buildConfirmMessage(discordId, row));
  }


  const itemName = parsed.ctx;
  const row = (await getInventory(discordId)).find(r => r.name === itemName);
  const result = await consumeItem(interaction.client, discordId, itemName);

  logger.info(`[/personaje inventario] ${interaction.user.tag} consumió "${itemName}" (flujo guiado)`);
  logAction({
    source: 'discord', actorDiscordId: discordId, actorUsername: interaction.user.tag,
    action: 'item.consume', target: itemName,
    details: { hpAfter: result.hpAfter, hungerAfter: result.hungerAfter, died: result.died, via: 'gui' },
  });

  return interaction.update({
    content: null,
    embeds: [buildResultEmbed(row ?? { display_name: itemName, emoji: null }, result)],
    components: [],
  });
}
