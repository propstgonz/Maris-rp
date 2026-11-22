import {
  EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle,
  StringSelectMenuBuilder, MessageFlags,
} from 'discord.js';
import {
  listConstructionTypes, getConstructionTypeByName, getIngredients, buildConstruction,
} from '../services/constructionTypeService.js';
import { countConstructionsAtTile, getTile } from '../services/mapService.js';
import { TILE_CONSTRUCTION_LIMITS } from '../services/constructionTypeService.js';
import { getItemQuantity } from '../services/inventoryService.js';
import { getAvailableLaburo } from '../services/laburoService.js';
import { getPlayerByDiscordId } from '../services/playerService.js';
import { useConstruction } from '../services/constructionUseService.js';
import { query } from '../database/index.js';
import { T } from '../database/tables.js';
import { isConstructionRuined } from '../utils/sql.js';
import { buildCustomId } from '../utils/componentAuth.js';
import { UserFacingError } from '../utils/errors.js';
import { COLORS } from '../utils/embeds.js';
import { logAction } from '../services/auditLogService.js';
import logger from '../utils/logger.js';
import { PRINTING_PRESS_TYPE_NAME, announcePrintingPressBuilt } from './printingPressFlow.js';
import { componentEmoji } from '../utils/emoji.js';

export const BUILD_NS = 'build';

const MAX_SELECT_OPTIONS = 25;

async function costLines(type) {
  const ingredients = await getIngredients(type.id);
  const lines = ingredients.map(
    ing => `${ing.emoji ?? '📦'} **${ing.display_name}** ×${ing.quantity_required}`
  );
  if (type.laburo_cost > 0) lines.push(`💪 **Laburo** ×${type.laburo_cost}`);
  return lines;
}

async function buildableHere(player, tile) {
  const results = [];
  for (const type of await listConstructionTypes()) {
    const { total, ofType } = await countConstructionsAtTile(player.coord_x, player.coord_y, type.id);
    if (total >= TILE_CONSTRUCTION_LIMITS.perTile) continue;
    if (ofType >= TILE_CONSTRUCTION_LIMITS.perTypePerTile) continue;
    if (type.requires_resource_type && tile?.resource_type !== type.requires_resource_type) continue;

    let hasIngredients = true;
    for (const ing of await getIngredients(type.id)) {
      if ((await getItemQuantity(player.discord_id, ing.name)) < ing.quantity_required) {
        hasIngredients = false;
        break;
      }
    }
    if (!hasIngredients) continue;
    if (type.laburo_cost > 0 && (await getAvailableLaburo(player.discord_id)) < type.laburo_cost) continue;
    results.push(type);
  }
  return results;
}

export async function buildPlacePickerMessage(discordId) {
  const player = await getPlayerByDiscordId(discordId);
  if (!player?.character_created_at) {
    throw new UserFacingError('Todavía no tienes un personaje. Usa `/personaje crear` para empezar.');
  }
  if (!player.is_alive) throw new UserFacingError('Tu personaje está muerto y no puede construir.');

  const tile = await getTile(player.coord_x, player.coord_y);
  if (!tile) {
    throw new UserFacingError(
      `No existe ninguna casilla en **(${player.coord_x}, ${player.coord_y})**. Debe crearla primero un Rolepriest con \`/map create\`.`
    );
  }

  const candidates = (await buildableHere(player, tile)).slice(0, MAX_SELECT_OPTIONS);
  if (candidates.length === 0) {
    throw new UserFacingError(
      `No puedes construir nada en **(${player.coord_x}, ${player.coord_y})** ahora mismo: ` +
      'o no tienes los materiales, o ya está construido aquí, o esta casilla no tiene el recurso que exigen. ' +
      'Usa `/build list` para ver el catálogo completo.'
    );
  }

  const options = await Promise.all(candidates.map(async type => {
    const cost = (await costLines(type)).join(', ').replace(/\*\*/g, '').slice(0, 100);
    return {
      label: type.display_name.slice(0, 100),
      ...(cost ? { description: cost } : {}),
      value: type.name,
      emoji: componentEmoji(type.emoji, '🏗️'),
    };
  }));

  const select = new StringSelectMenuBuilder()
    .setCustomId(buildCustomId({ ns: BUILD_NS, action: 'pick', owner: discordId }))
    .setPlaceholder('¿Qué quieres construir aquí?')
    .addOptions(options);

  const embed = new EmbedBuilder()
    .setColor(COLORS.BLUE)
    .setTitle('🏗️ Construir')
    .setDescription(`En tu casilla **(${player.coord_x}, ${player.coord_y})** puedes levantar:`);

  return {
    embeds: [embed],
    components: [new ActionRowBuilder().addComponents(select)],
    flags: MessageFlags.Ephemeral,
  };
}

const SQL = {
  getUsableAtTile: `
    SELECT c.id, c.name, c.current_health,
           ct.name AS type_name, ct.display_name AS type_display_name, ct.emoji AS type_emoji,
           ct.max_health AS ct_max_health, ct.use_tool_item_name
    FROM ${T.constructions} c
    JOIN ${T.construction_types} ct ON c.construction_type_id = ct.id
    JOIN ${T.map_tiles} t ON c.tile_id = t.id
    WHERE t.coord_x = ? AND t.coord_y = ? AND ct.use_result_item_id IS NOT NULL
    ORDER BY c.id ASC
  `,
};

export async function buildMenuMessage(discordId) {
  const player = await getPlayerByDiscordId(discordId);
  if (!player?.character_created_at) {
    throw new UserFacingError('Todavía no tienes un personaje. Usa `/personaje crear` para empezar.');
  }

  const embed = new EmbedBuilder()
    .setColor(COLORS.BLUE)
    .setTitle('🏗️ Construir')
    .setDescription(`En tu casilla **(${player.coord_x}, ${player.coord_y})**, ¿qué quieres hacer?`);

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(buildCustomId({ ns: BUILD_NS, action: 'menu_place', owner: discordId }))
      .setLabel('Construir nuevo')
      .setEmoji('🏗️')
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId(buildCustomId({ ns: BUILD_NS, action: 'menu_use', owner: discordId }))
      .setLabel('Usar algo de aquí')
      .setEmoji('⛏️')
      .setStyle(ButtonStyle.Secondary)
  );

  return { embeds: [embed], components: [row] };
}

export async function buildUsePickerMessage(discordId) {
  const player = await getPlayerByDiscordId(discordId);
  const usable = (await query(SQL.getUsableAtTile, [player.coord_x, player.coord_y]))
    .filter(c => !isConstructionRuined({ current_health: c.current_health, ct_max_health: c.ct_max_health }))
    .slice(0, MAX_SELECT_OPTIONS);

  if (usable.length === 0) {
    throw new UserFacingError(
      `No hay ninguna construcción usable en **(${player.coord_x}, ${player.coord_y})** ahora mismo — ` +
      'o no hay ninguna interactiva, o están todas en ruinas.'
    );
  }

  const select = new StringSelectMenuBuilder()
    .setCustomId(buildCustomId({ ns: BUILD_NS, action: 'use_pick', owner: discordId }))
    .setPlaceholder('¿Cuál usas?')
    .addOptions(usable.map(c => ({
      label: `${c.name}`.slice(0, 100),
      description: c.use_tool_item_name ? `Necesitas: ${c.use_tool_item_name}` : undefined,
      value: `${c.type_name}:${c.id}`,
      emoji: componentEmoji(c.type_emoji, '⛏️'),
    })));

  const embed = new EmbedBuilder()
    .setColor(COLORS.BLUE)
    .setTitle('⛏️ Usar')
    .setDescription(`En tu casilla **(${player.coord_x}, ${player.coord_y})** puedes usar:`);

  return { embeds: [embed], components: [new ActionRowBuilder().addComponents(select)] };
}

async function buildConfirmMessage(discordId, type) {
  const embed = new EmbedBuilder()
    .setColor(COLORS.BLUE)
    .setTitle(`🏗️ ¿Construir ${type.display_name}?`)
    .addFields({ name: '🧰 Te costará', value: (await costLines(type)).join('\n') || '*(nada)*' });

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(buildCustomId({ ns: BUILD_NS, action: 'go', owner: discordId, ctx: type.name }))
      .setLabel('Construir')
      .setEmoji('🏗️')
      .setStyle(ButtonStyle.Success),
    new ButtonBuilder()
      .setCustomId(buildCustomId({ ns: BUILD_NS, action: 'cancel', owner: discordId }))
      .setLabel('Cancelar')
      .setStyle(ButtonStyle.Secondary)
  );

  return { embeds: [embed], components: [row] };
}

export async function handleBuildComponent(interaction, parsed) {
  const discordId = interaction.user.id;

  if (parsed.action === 'cancel') {
    return interaction.update({ content: 'Cancelado.', embeds: [], components: [] });
  }

  if (parsed.action === 'menu_place') {
    return interaction.update(await buildPlacePickerMessage(discordId));
  }

  if (parsed.action === 'menu_use') {
    return interaction.update(await buildUsePickerMessage(discordId));
  }

  if (parsed.action === 'use_pick') {
    const [typeName, constructionIdRaw] = interaction.values[0].split(':');
    const constructionId = Number(constructionIdRaw);
    const player = await getPlayerByDiscordId(discordId);

    let result;
    try {
      result = await useConstruction(discordId, player.coord_x, player.coord_y, typeName, {}, constructionId);
    } catch (err) {
      return interaction.update({ content: `❌ ${err.message}`, embeds: [], components: [] });
    }

    const { roll, yieldAmount, resultItem, laburoCost } = result;
    const hit = yieldAmount > 0;
    logger.info(
      `[/jugar Construir] ${interaction.user.tag} usó "${result.construction.name}" en (${player.coord_x},${player.coord_y}) ` +
      `→ tirada ${roll}, ${hit ? `+${yieldAmount} ${resultItem.name}` : 'sin resultado'} (flujo guiado)`
    );

    const embed = new EmbedBuilder()
      .setColor(hit ? COLORS.GREEN : COLORS.GREY)
      .setTitle(hit ? `${resultItem.emoji ?? '📦'} ¡Conseguiste algo!` : '🎲 Sin suerte esta vez')
      .addFields(
        { name: '🏗️ Construcción', value: `**${result.construction.name}**`, inline: true },
        { name: '🎲 Tirada', value: `${roll} / 6`, inline: true }
      )
      .setTimestamp();
    if (hit) embed.addFields({ name: '📦 Obtenido', value: `${resultItem.emoji ?? '📦'} **${resultItem.display_name}** ×${yieldAmount}` });
    if (laburoCost > 0) embed.addFields({ name: '💪 Laburo gastado', value: `${laburoCost}`, inline: true });

    return interaction.update({ content: null, embeds: [embed], components: [] });
  }

  if (parsed.action === 'pick') {
    const type = await getConstructionTypeByName(interaction.values[0]);
    if (!type) throw new UserFacingError('Ese tipo de construcción ya no existe — vuelve a lanzar `/build place`.');
    return interaction.update(await buildConfirmMessage(discordId, type));
  }

  const type = await getConstructionTypeByName(parsed.ctx);
  if (!type) throw new UserFacingError('Ese tipo de construcción ya no existe — vuelve a lanzar `/build place`.');

  const player = await getPlayerByDiscordId(discordId);

  const construction = await buildConstruction(discordId, player.coord_x, player.coord_y, type);

  logger.info(`[/build place] ${interaction.user.tag} construyó "${type.name}" en (${player.coord_x}, ${player.coord_y}) (flujo guiado)`);
  logAction({
    source: 'discord', actorDiscordId: discordId, actorUsername: interaction.user.tag,
    action: 'tile.construction_build', target: `(${player.coord_x},${player.coord_y})`,
    details: { type: type.name, via: 'gui' },
  });

  const embed = new EmbedBuilder()
    .setColor(COLORS.GREEN)
    .setTitle(`${type.emoji ?? '🏗️'} ${type.display_name} construido`)
    .setDescription(`Levantado en **(${player.coord_x}, ${player.coord_y})**.`)
    .setTimestamp();

  await interaction.update({ content: null, embeds: [embed], components: [] });

  if (type.name === PRINTING_PRESS_TYPE_NAME) {
    await announcePrintingPressBuilt(interaction, discordId, construction.id);
  }
}
