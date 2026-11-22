
































import {
  EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle,
  StringSelectMenuBuilder, MessageFlags,
} from 'discord.js';
import { craftItem, listCraftableForPlayer } from '../services/craftService.js';
import { buildCustomId } from '../utils/componentAuth.js';
import { UserFacingError } from '../utils/errors.js';
import { resolveGuild } from '../utils/permissions.js';
import { COLORS } from '../utils/embeds.js';
import { logAction } from '../services/auditLogService.js';
import logger from '../utils/logger.js';
import { componentEmoji } from '../utils/emoji.js';

export const CRAFT_NS = 'craft2';




const MAX_SELECT_OPTIONS = 25;


function ingredientLines(evaluation) {
  const lines = evaluation.ingredients.map(
    ing => `${ing.emoji ?? '📦'} **${ing.display_name}** ×${ing.quantity_required}`
  );
  if (evaluation.effectiveLaburoCost > 0) {
    lines.push(
      evaluation.hasTool
        ? `💪 **Laburo** ×${evaluation.effectiveLaburoCost} ~~${evaluation.recipe.laburo_cost}~~ (${evaluation.recipe.tool_item_emoji ?? '🔧'} ${evaluation.recipe.tool_item_display})`
        : `💪 **Laburo** ×${evaluation.effectiveLaburoCost}`
    );
  }
  return lines;
}


export async function buildCraftPickerMessage(discordId) {
  const craftable = await listCraftableForPlayer(discordId);

  if (craftable.length === 0) {
    throw new UserFacingError(
      'Ahora mismo no puedes fabricar nada: no tienes los materiales (o el Laburo, o la construcción) de ninguna receta. ' +
      'Mira `/personaje inventario` para ver con qué cuentas.'
    );
  }

  const shown = craftable.slice(0, MAX_SELECT_OPTIONS);

  const select = new StringSelectMenuBuilder()
    .setCustomId(buildCustomId({ ns: CRAFT_NS, action: 'pick', owner: discordId }))
    .setPlaceholder('Elige qué fabricar…')
    .addOptions(shown.map(ev => {





      const cost = ingredientLines(ev).join(', ').replace(/\*\*|~~/g, '').slice(0, 100);
      return {
        label: `${ev.recipe.result_display_name}${ev.recipe.result_quantity > 1 ? ` ×${ev.recipe.result_quantity}` : ''}`.slice(0, 100),
        ...(cost ? { description: cost } : {}),
        value: String(ev.recipe.id),
        emoji: componentEmoji(ev.recipe.result_emoji, '📦'),
      };
    }));

  const embed = new EmbedBuilder()
    .setColor(COLORS.PURPLE)
    .setTitle('⚒️ Fabricar')
    .setDescription(
      craftable.length === 1
        ? 'Esto es lo único que puedes fabricar ahora mismo:'
        : `Puedes fabricar **${craftable.length}** cosas ahora mismo. Elige una:`
    );

  if (craftable.length > shown.length) {
    embed.setFooter({
      text: `Mostrando ${shown.length} de ${craftable.length} (Discord no admite más en un desplegable). Para el resto: /craft item:<nombre>`,
    });
  }

  return {
    embeds: [embed],
    components: [new ActionRowBuilder().addComponents(select)],
    flags: MessageFlags.Ephemeral,
  };
}


function buildConfirmMessage(discordId, evaluation) {
  const { recipe } = evaluation;

  const embed = new EmbedBuilder()
    .setColor(COLORS.PURPLE)
    .setTitle(`⚒️ ¿Fabricar ${recipe.result_display_name}?`)
    .setDescription(
      `${recipe.result_emoji ?? '📦'} **${recipe.result_display_name}** ×${recipe.result_quantity}`
    )
    .addFields({ name: '🧰 Te costará', value: ingredientLines(evaluation).join('\n') || '*(nada)*' });

  if (recipe.required_construction_type) {
    embed.addFields({ name: '🏭 Se fabrica en', value: `*${recipe.required_construction_type}*`, inline: true });
  }

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(buildCustomId({ ns: CRAFT_NS, action: 'go', owner: discordId, ctx: String(recipe.id) }))
      .setLabel('Fabricar')
      .setEmoji('⚒️')
      .setStyle(ButtonStyle.Success),
    new ButtonBuilder()
      .setCustomId(buildCustomId({ ns: CRAFT_NS, action: 'cancel', owner: discordId }))
      .setLabel('Cancelar')
      .setStyle(ButtonStyle.Secondary)
  );

  return { embeds: [embed], components: [row] };
}


export async function handleCraftComponent(interaction, parsed) {
  const discordId = interaction.user.id;

  if (parsed.action === 'cancel') {
    return interaction.update({ content: 'Cancelado.', embeds: [], components: [] });
  }

  if (parsed.action === 'pick') {
    const recipeId = Number(interaction.values[0]);


    const evaluation = (await listCraftableForPlayer(discordId)).find(ev => ev.recipe.id === recipeId);
    if (!evaluation) {
      throw new UserFacingError('Esa receta ya no está a tu alcance (te faltan materiales, o ha cambiado). Vuelve a lanzar `/craft`.');
    }
    return interaction.update(buildConfirmMessage(discordId, evaluation));
  }



  const recipeId = Number(parsed.ctx);
  const craftResult = await craftItem(discordId, null, resolveGuild(interaction), recipeId);

  logger.info(`[/craft] ${interaction.user.tag} fabricó x${craftResult.result.quantity} "${craftResult.result.display_name}" (flujo guiado)`);
  logAction({
    source: 'discord', actorDiscordId: discordId, actorUsername: interaction.user.tag,
    action: 'craft.done', target: craftResult.result.name,
    details: { recipeId: craftResult.recipe.id, quantity: craftResult.result.quantity, via: 'gui' },
  });



  const { buildCraftResultEmbed } = await import('../commands/player/craft.js');
  return interaction.update({ content: null, embeds: [buildCraftResultEmbed(craftResult)], components: [] });
}
