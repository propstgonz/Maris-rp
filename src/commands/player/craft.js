


















import { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, MessageFlags } from 'discord.js';
import { craftItem, RecipeChoiceNeededError } from '../../services/craftService.js';
import { requireCharacter, resolveGuild }    from '../../utils/permissions.js';
import { logAction }                         from '../../services/auditLogService.js';
import { COLORS }                            from '../../utils/embeds.js';
import { buildAssetUrl }                     from '../../utils/publicUrl.js';
import { handleItemAutocomplete }            from '../../utils/autocomplete.js';
import { buildCraftPickerMessage }           from '../../components/craftFlow.js';
import logger                                from '../../utils/logger.js';

const NUMBER_EMOJI = ['1️⃣', '2️⃣', '3️⃣', '4️⃣', '5️⃣', '6️⃣', '7️⃣', '8️⃣', '9️⃣'];
const CUSTOM_ID_PREFIX = 'craftchoose:';












const resolvingMessages = new Set();
const RESOLVED_TTL_MS = 5 * 60_000;


export function buildCraftResultEmbed(craftResult) {
  const { result, ingredients, recipe, laburoCost, laburoReduction, toolUsed } = craftResult;

  const embed = new EmbedBuilder()
    .setColor(COLORS.BLUE)
    .setTitle('⚒️ Crafteo completado')
    .setDescription(
      `${result.emoji} **${result.display_name}** ×${result.quantity} ` +
      `añadido${result.quantity !== 1 ? 's' : ''} a tu inventario.`
    )
    .setTimestamp();

  const ingredientLines = ingredients.map(
    ing => `${ing.emoji ?? '📦'} **${ing.display_name}** ×${ing.quantity_required}`
  );


  if (recipe.laburo_cost > 0) {
    ingredientLines.push(
      toolUsed
        ? `💪 **Laburo** ×${laburoCost} ~~${recipe.laburo_cost}~~ (${toolUsed.emoji ?? '🔧'} ${toolUsed.display_name}: -${laburoReduction})`
        : `💪 **Laburo** ×${laburoCost}`
    );
  }
  if (ingredientLines.length > 0) {
    embed.addFields({ name: '🧰 Materiales usados', value: ingredientLines.join('\n') });
  }

  if (recipe.required_construction_type) {
    embed.addFields({ name: '🏭 Fabricado en', value: `*${recipe.required_construction_type}*`, inline: true });
  }




  if (recipe.result_triggers_newspaper) {
    embed.addFields({ name: '🗞️ Periódico', value: 'Se está creando tu canal de periódico — aparecerá en unos segundos.' });
  }

  const itemThumb = buildAssetUrl(result.image_filename, '/craft');
  if (itemThumb) embed.setThumbnail(itemThumb);

  return embed;
}


function buildRecipeChoiceMessage(err, discordId) {
  const embed = new EmbedBuilder()
    .setColor(COLORS.PURPLE)
    .setTitle('⚒️ Varias recetas disponibles')
    .setDescription('Puedes permitirte más de una — elige cuál usar:')
    .setTimestamp();

  const rows = [];
  let currentRow = new ActionRowBuilder();

  err.candidates.forEach((cand, idx) => {
    const lines = cand.ingredients.map(ing => `\`${ing.name}\` ×${ing.quantity_required}`);
    if (cand.recipe.laburo_cost > 0) {
      lines.push(cand.hasTool ? `💪 Laburo ×${cand.effectiveLaburoCost} (con ${cand.recipe.tool_item_display})` : `💪 Laburo ×${cand.effectiveLaburoCost}`);
    }
    if (cand.recipe.required_construction_type) lines.push(`🏭 ${cand.recipe.required_construction_type}`);

    embed.addFields({
      name: `${NUMBER_EMOJI[idx] ?? `#${idx + 1}`} Receta ${idx + 1}`,
      value: lines.join('\n') || '*(sin ingredientes)*',
      inline: true,
    });

    if (currentRow.components.length === 5) {
      rows.push(currentRow);
      currentRow = new ActionRowBuilder();
    }
    currentRow.addComponents(
      new ButtonBuilder()
        .setCustomId(`${CUSTOM_ID_PREFIX}${cand.recipe.id}:${discordId}`)
        .setLabel(`Receta ${idx + 1}`)
        .setEmoji(NUMBER_EMOJI[idx] ?? '⚒️')
        .setStyle(ButtonStyle.Primary)
    );
  });
  if (currentRow.components.length > 0) rows.push(currentRow);

  return { embeds: [embed], components: rows.slice(0, 5) };
}

export default {
  data: new SlashCommandBuilder()
    .setName('craft')
    .setDescription('Fabrica un ítem usando tu inventario')
    .addStringOption(opt =>
      opt
        .setName('item')
        .setDescription('Ítem a fabricar. Si lo omites, se abre un menú con lo que puedes fabricar ahora')
        .setRequired(false)
        .setAutocomplete(true)
    ),


  async autocomplete(interaction) {
    await handleItemAutocomplete(interaction);
  },


  async execute(interaction) {

    if (!await requireCharacter(interaction)) return;

    const rawItem = interaction.options.getString('item');




    if (!rawItem) {
      return interaction.reply(await buildCraftPickerMessage(interaction.user.id));
    }

    const itemName = rawItem.toLowerCase().trim();








    let craftResult;
    try {
      craftResult = await craftItem(interaction.user.id, itemName, resolveGuild(interaction));
    } catch (err) {
      if (err instanceof RecipeChoiceNeededError) {
        return interaction.reply(buildRecipeChoiceMessage(err, interaction.user.id));
      }
      return interaction.reply({ content: `❌ ${err.message}`, flags: MessageFlags.Ephemeral });
    }

    logger.info(`[/craft] ${interaction.user.tag} fabricó x${craftResult.result.quantity} "${craftResult.result.display_name}"`);





    logAction({
      source: 'discord', actorDiscordId: interaction.user.id, actorUsername: interaction.user.tag,
      action: 'craft.done', target: craftResult.result.name,
      details: { recipeId: craftResult.recipe.id, quantity: craftResult.result.quantity },
    });

    return interaction.reply({ embeds: [buildCraftResultEmbed(craftResult)] });
  },
};


export function isCraftChoiceButton(customId) {
  return customId.startsWith(CUSTOM_ID_PREFIX);
}


export async function handleCraftChoiceButton(interaction) {
  const [, recipeIdRaw, ownerDiscordId] = interaction.customId.split(':');
  const recipeId = Number(recipeIdRaw);

  if (interaction.user.id !== ownerDiscordId) {
    return interaction.reply({ content: '❌ Esta elección no es tuya — usa `/craft` para pedir la tuya propia.', flags: MessageFlags.Ephemeral });
  }





  if (resolvingMessages.has(interaction.message.id)) {
    return interaction.reply({ content: '⏳ Ya se está procesando tu elección anterior — espera un segundo.', flags: MessageFlags.Ephemeral });
  }
  resolvingMessages.add(interaction.message.id);


  let craftResult;
  try {
    craftResult = await craftItem(ownerDiscordId, null, resolveGuild(interaction), recipeId);
  } catch (err) {
    resolvingMessages.delete(interaction.message.id);
    return interaction.update({ content: `❌ ${err.message}`, embeds: [], components: [] });
  }

  setTimeout(() => resolvingMessages.delete(interaction.message.id), RESOLVED_TTL_MS).unref();

  logger.info(`[/craft] ${interaction.user.tag} fabricó x${craftResult.result.quantity} "${craftResult.result.display_name}" (elegida por botón)`);

  logAction({
    source: 'discord', actorDiscordId: interaction.user.id, actorUsername: interaction.user.tag,
    action: 'craft.done', target: craftResult.result.name,
    details: { recipeId: craftResult.recipe.id, quantity: craftResult.result.quantity },
  });

  return interaction.update({ content: null, embeds: [buildCraftResultEmbed(craftResult)], components: [] });
}
