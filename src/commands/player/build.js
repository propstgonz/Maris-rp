import { SlashCommandBuilder, EmbedBuilder, MessageFlags } from 'discord.js';
import { getPlayerByDiscordId } from '../../services/playerService.js';
import {
  listConstructionTypes,
  getConstructionTypeByName,
  getIngredients,
  buildConstruction,
} from '../../services/constructionTypeService.js';
import {
  getTile,
  resolveConstructionAtTile,
  removeConstruction,
} from '../../services/mapService.js';
import { useConstruction } from '../../services/constructionUseService.js';
import { refuelConstruction } from '../../services/constructionFuelService.js';
import { repairConstruction } from '../../services/constructionRepairService.js';
import { restoreDurability } from '../../services/constructionDurabilityService.js';
import { stockMarketItem, listMarketItems, buyFromMarket } from '../../services/marketService.js';
import { depositItem, withdrawItem, getStorageContents } from '../../services/storageService.js';
import { grantPermission } from '../../services/permissionService.js';
import { PERMISSION_ACTIONS } from '../../utils/permissionActions.js';
import { requireCharacter, resolveMember, isRolepriest as isRolepriestMember } from '../../utils/permissions.js';
import { handleConstructionTypeAutocomplete, handleItemAutocomplete, handleRecruitableNpcTypeAutocomplete } from '../../utils/autocomplete.js';
import { recruitNpc } from '../../services/npcRecruitService.js';
import { buildPlacePickerMessage } from '../../components/buildFlow.js';
import { PRINTING_PRESS_TYPE_NAME, announcePrintingPressBuilt } from '../../components/printingPressFlow.js';
import { COLORS }        from '../../utils/embeds.js';
import logger              from '../../utils/logger.js';
import { logAction }       from '../../services/auditLogService.js';

const autocompleteConstructionType = handleConstructionTypeAutocomplete;

export default {
  data: new SlashCommandBuilder()
    .setName('build')
    .setDescription('Construye, destruye o consulta edificios del mapa')

    .addSubcommand(sub =>
      sub
        .setName('place')
        .setDescription('Construye un edificio en tu casilla actual')

        .addStringOption(opt => opt.setName('tipo').setDescription('Tipo de construcción. Si omites las tres opciones, se abre un menú').setRequired(false).setAutocomplete(true))
        .addIntegerOption(opt => opt.setName('x').setDescription('Coordenada X (debe ser tu posición actual)').setRequired(false))
        .addIntegerOption(opt => opt.setName('y').setDescription('Coordenada Y (debe ser tu posición actual)').setRequired(false))
    )
    .addSubcommand(sub =>
      sub
        .setName('destroy')
        .setDescription('Destruye una construcción por tipo y coordenadas')
        .addStringOption(opt => opt.setName('tipo').setDescription('Tipo de construcción').setRequired(true).setAutocomplete(true))
        .addIntegerOption(opt => opt.setName('x').setDescription('Coordenada X').setRequired(true))
        .addIntegerOption(opt => opt.setName('y').setDescription('Coordenada Y').setRequired(true))
        .addIntegerOption(opt => opt.setName('id').setDescription('Cuál, si hay varias del mismo tipo en la casilla (te lo dirá si hace falta)').setRequired(false).setMinValue(1))
    )
    .addSubcommand(sub =>
      sub
        .setName('usar')
        .setDescription('Interactúa con una construcción (ej. sacar recursos de una mina) — exige estar en su casilla')
        .addStringOption(opt => opt.setName('tipo').setDescription('Tipo de construcción').setRequired(true).setAutocomplete(true))
        .addIntegerOption(opt => opt.setName('x').setDescription('Coordenada X (debe ser tu posición actual)').setRequired(true))
        .addIntegerOption(opt => opt.setName('y').setDescription('Coordenada Y (debe ser tu posición actual)').setRequired(true))
        .addIntegerOption(opt => opt.setName('id').setDescription('Cuál, si hay varias del mismo tipo en la casilla (te lo dirá si hace falta)').setRequired(false).setMinValue(1))
    )
    .addSubcommand(sub =>
      sub
        .setName('repostar')
        .setDescription('Mete combustible en el depósito de una construcción que lo necesite')
        .addStringOption(opt => opt.setName('tipo').setDescription('Tipo de construcción').setRequired(true).setAutocomplete(true))
        .addIntegerOption(opt => opt.setName('x').setDescription('Coordenada X (debe ser tu posición actual)').setRequired(true))
        .addIntegerOption(opt => opt.setName('y').setDescription('Coordenada Y (debe ser tu posición actual)').setRequired(true))
        .addIntegerOption(opt => opt.setName('cantidad').setDescription('Unidades de combustible a meter').setRequired(true).setMinValue(1))
        .addIntegerOption(opt => opt.setName('id').setDescription('Cuál, si hay varias del mismo tipo en la casilla (te lo dirá si hace falta)').setRequired(false).setMinValue(1))
    )
    .addSubcommand(sub =>
      sub
        .setName('reparar')
        .setDescription('Repara una construcción en ruinas (mitad de sus ingredientes de construcción + Laburo)')
        .addStringOption(opt => opt.setName('tipo').setDescription('Tipo de construcción').setRequired(true).setAutocomplete(true))
        .addIntegerOption(opt => opt.setName('x').setDescription('Coordenada X (debe ser tu posición actual)').setRequired(true))
        .addIntegerOption(opt => opt.setName('y').setDescription('Coordenada Y (debe ser tu posición actual)').setRequired(true))
        .addIntegerOption(opt => opt.setName('id').setDescription('Cuál, si hay varias del mismo tipo en la casilla (te lo dirá si hace falta)').setRequired(false).setMinValue(1))
    )
    .addSubcommand(sub =>
      sub
        .setName('restaurar')
        .setDescription('Restaura al máximo la durabilidad de una construcción (exige tener la herramienta, si la hay)')
        .addStringOption(opt => opt.setName('tipo').setDescription('Tipo de construcción').setRequired(true).setAutocomplete(true))
        .addIntegerOption(opt => opt.setName('x').setDescription('Coordenada X (debe ser tu posición actual)').setRequired(true))
        .addIntegerOption(opt => opt.setName('y').setDescription('Coordenada Y (debe ser tu posición actual)').setRequired(true))
        .addIntegerOption(opt => opt.setName('id').setDescription('Cuál, si hay varias del mismo tipo en la casilla (te lo dirá si hace falta)').setRequired(false).setMinValue(1))
    )
    .addSubcommand(sub =>
      sub
        .setName('mercado_stock')
        .setDescription('[Dueño/Staff] Repone stock y fija el precio (en Laburo) de un ítem en un puesto de comercio')
        .addStringOption(opt => opt.setName('tipo').setDescription('Tipo de construcción').setRequired(true).setAutocomplete(true))
        .addIntegerOption(opt => opt.setName('x').setDescription('Coordenada X (debe ser tu posición actual)').setRequired(true))
        .addIntegerOption(opt => opt.setName('y').setDescription('Coordenada Y (debe ser tu posición actual)').setRequired(true))
        .addStringOption(opt => opt.setName('item').setDescription('Ítem a vender').setRequired(true).setAutocomplete(true))
        .addNumberOption(opt => opt.setName('precio').setDescription('Precio en Laburo por unidad').setRequired(true).setMinValue(0.01))
        .addNumberOption(opt => opt.setName('cantidad').setDescription('Unidades a añadir al stock (de tu propio inventario)').setRequired(true).setMinValue(0.01))
        .addIntegerOption(opt => opt.setName('id').setDescription('Cuál, si hay varias del mismo tipo en la casilla (te lo dirá si hace falta)').setRequired(false).setMinValue(1))
    )
    .addSubcommand(sub =>
      sub
        .setName('mercado_list')
        .setDescription('Consulta lo que hay en venta en un puesto de comercio')
        .addStringOption(opt => opt.setName('tipo').setDescription('Tipo de construcción').setRequired(true).setAutocomplete(true))
        .addIntegerOption(opt => opt.setName('x').setDescription('Coordenada X (debe ser tu posición actual)').setRequired(true))
        .addIntegerOption(opt => opt.setName('y').setDescription('Coordenada Y (debe ser tu posición actual)').setRequired(true))
        .addIntegerOption(opt => opt.setName('id').setDescription('Cuál, si hay varias del mismo tipo en la casilla (te lo dirá si hace falta)').setRequired(false).setMinValue(1))
    )
    .addSubcommand(sub =>
      sub
        .setName('comprar')
        .setDescription('Compra un ítem de un puesto de comercio — el Laburo va directo al dueño')
        .addStringOption(opt => opt.setName('tipo').setDescription('Tipo de construcción').setRequired(true).setAutocomplete(true))
        .addIntegerOption(opt => opt.setName('x').setDescription('Coordenada X (debe ser tu posición actual)').setRequired(true))
        .addIntegerOption(opt => opt.setName('y').setDescription('Coordenada Y (debe ser tu posición actual)').setRequired(true))
        .addStringOption(opt => opt.setName('item').setDescription('Ítem a comprar').setRequired(true).setAutocomplete(true))
        .addNumberOption(opt => opt.setName('cantidad').setDescription('Unidades a comprar').setRequired(true).setMinValue(0.01))
        .addIntegerOption(opt => opt.setName('id').setDescription('Cuál, si hay varias del mismo tipo en la casilla (te lo dirá si hace falta)').setRequired(false).setMinValue(1))
    )
    .addSubcommand(sub =>
      sub
        .setName('almacen_ver')
        .setDescription('Consulta lo que hay guardado en el almacén de una construcción')
        .addStringOption(opt => opt.setName('tipo').setDescription('Tipo de construcción').setRequired(true).setAutocomplete(true))
        .addIntegerOption(opt => opt.setName('x').setDescription('Coordenada X (debe ser tu posición actual)').setRequired(true))
        .addIntegerOption(opt => opt.setName('y').setDescription('Coordenada Y (debe ser tu posición actual)').setRequired(true))
        .addIntegerOption(opt => opt.setName('id').setDescription('Cuál, si hay varias del mismo tipo en la casilla (te lo dirá si hace falta)').setRequired(false).setMinValue(1))
    )
    .addSubcommand(sub =>
      sub
        .setName('almacen_depositar')
        .setDescription('Deposita ítems de tu inventario en el almacén de una construcción')
        .addStringOption(opt => opt.setName('tipo').setDescription('Tipo de construcción').setRequired(true).setAutocomplete(true))
        .addIntegerOption(opt => opt.setName('x').setDescription('Coordenada X (debe ser tu posición actual)').setRequired(true))
        .addIntegerOption(opt => opt.setName('y').setDescription('Coordenada Y (debe ser tu posición actual)').setRequired(true))
        .addStringOption(opt => opt.setName('item').setDescription('Ítem a depositar').setRequired(true).setAutocomplete(true))
        .addNumberOption(opt => opt.setName('cantidad').setDescription('Unidades a depositar').setRequired(true).setMinValue(0.01))
        .addIntegerOption(opt => opt.setName('id').setDescription('Cuál, si hay varias del mismo tipo en la casilla (te lo dirá si hace falta)').setRequired(false).setMinValue(1))
    )
    .addSubcommand(sub =>
      sub
        .setName('almacen_retirar')
        .setDescription('Retira ítems del almacén de una construcción a tu inventario')
        .addStringOption(opt => opt.setName('tipo').setDescription('Tipo de construcción').setRequired(true).setAutocomplete(true))
        .addIntegerOption(opt => opt.setName('x').setDescription('Coordenada X (debe ser tu posición actual)').setRequired(true))
        .addIntegerOption(opt => opt.setName('y').setDescription('Coordenada Y (debe ser tu posición actual)').setRequired(true))
        .addStringOption(opt => opt.setName('item').setDescription('Ítem a retirar').setRequired(true).setAutocomplete(true))
        .addNumberOption(opt => opt.setName('cantidad').setDescription('Unidades a retirar').setRequired(true).setMinValue(0.01))
        .addIntegerOption(opt => opt.setName('id').setDescription('Cuál, si hay varias del mismo tipo en la casilla (te lo dirá si hace falta)').setRequired(false).setMinValue(1))
    )
    .addSubcommand(sub =>
      sub
        .setName('reclutar')
        .setDescription('Recluta un NPC en una oficina de reclutamiento, pagado con recursos de tu facción')
        .addStringOption(opt => opt.setName('tipo').setDescription('Tipo de construcción (la oficina de reclutamiento)').setRequired(true).setAutocomplete(true))
        .addIntegerOption(opt => opt.setName('x').setDescription('Coordenada X (debe ser tu posición actual)').setRequired(true))
        .addIntegerOption(opt => opt.setName('y').setDescription('Coordenada Y (debe ser tu posición actual)').setRequired(true))
        .addStringOption(opt => opt.setName('npc_tipo').setDescription('Tipo de NPC a reclutar (solo se ofrecen los que tu facción puede pagar ahora)').setRequired(true).setAutocomplete(true))
        .addIntegerOption(opt => opt.setName('id').setDescription('Cuál, si hay varias del mismo tipo en la casilla (te lo dirá si hace falta)').setRequired(false).setMinValue(1))
    )
    .addSubcommand(sub =>
      sub
        .setName('ceder')
        .setDescription('Cede un permiso sobre esta construcción a otro jugador')
        .addStringOption(opt => opt.setName('tipo').setDescription('Tipo de construcción').setRequired(true).setAutocomplete(true))
        .addIntegerOption(opt => opt.setName('x').setDescription('Coordenada X (debe ser tu posición actual)').setRequired(true))
        .addIntegerOption(opt => opt.setName('y').setDescription('Coordenada Y (debe ser tu posición actual)').setRequired(true))
        .addUserOption(opt => opt.setName('jugador').setDescription('Jugador al que ceder el permiso').setRequired(true))
        .addStringOption(opt => opt.setName('accion').setDescription('Permiso a ceder').setRequired(true)
          .addChoices(
            { name: 'Usar', value: 'construction.use' },
            { name: 'Repostar', value: 'construction.refuel' },
            { name: 'Reparar', value: 'construction.repair' },
            { name: 'Destruir', value: 'construction.destroy' },
            { name: 'Gestionar mercado', value: 'construction.market_manage' },
          ))
        .addIntegerOption(opt => opt.setName('horas').setDescription('Caduca en tantas horas (vacío = para siempre)').setRequired(false).setMinValue(1))
        .addIntegerOption(opt => opt.setName('id').setDescription('Cuál, si hay varias del mismo tipo en la casilla (te lo dirá si hace falta)').setRequired(false).setMinValue(1))
    )
    .addSubcommand(sub => sub.setName('list').setDescription('Lista los tipos de construcción disponibles')),

  async autocomplete(interaction) {
    const focused = interaction.options.getFocused(true);
    if (focused.name === 'tipo') {
      await autocompleteConstructionType(interaction);
    } else if (focused.name === 'npc_tipo') {
      await handleRecruitableNpcTypeAutocomplete(interaction);
    } else {
      await handleItemAutocomplete(interaction);
    }
  },

  async execute(interaction) {
    const sub = interaction.options.getSubcommand();

    if (sub === 'list') {
      const types = await listConstructionTypes();
      const embed = new EmbedBuilder().setColor(COLORS.DARK).setTitle('🏗️ Edificios disponibles para construir').setTimestamp();

      if (types.length === 0) {
        embed.setDescription('*Staff todavía no ha definido ningún tipo de construcción.*');
      } else {
        for (const t of types) {
          const ingredients = await getIngredients(t.id);
          const lines = [];
          if (t.requires_resource_type) lines.push(`📍 Requiere recurso: **${t.requires_resource_type}**`);
          if (ingredients.length > 0) lines.push(ingredients.map(i => `${i.emoji ?? '📦'} ${i.display_name} ×${i.quantity_required}`).join(', '));
          if (t.laburo_cost > 0) lines.push(`💪 Laburo ×${t.laburo_cost}`);
          embed.addFields({ name: `${t.emoji} ${t.display_name} (\`${t.name}\`)`, value: lines.length > 0 ? lines.join('\n') : '*Sin requisitos*' });
        }
      }

      return interaction.reply({ embeds: [embed] });
    }

    if (!await requireCharacter(interaction)) return;

    const rawTipo = interaction.options.getString('tipo');
    const rawX    = interaction.options.getInteger('x');
    const rawY    = interaction.options.getInteger('y');

    const constructionId = interaction.options.getInteger('id');

    if (sub === 'place' && !rawTipo && rawX === null && rawY === null) {
      return interaction.reply(await buildPlacePickerMessage(interaction.user.id));
    }
    if (!rawTipo || rawX === null || rawY === null) {
      return interaction.reply({
        content: sub === 'place'
          ? '❌ Da las tres opciones (tipo, x, y) — o ninguna, para abrir el menú guiado.'
          : '❌ Faltan opciones: este subcomando necesita `tipo`, `x` e `y`.',
        flags: MessageFlags.Ephemeral,
      });
    }

    const tipo = rawTipo.toLowerCase().trim();
    const x    = rawX;
    const y    = rawY;

    const player = await getPlayerByDiscordId(interaction.user.id);
    if (!player.is_alive) {
      return interaction.reply({ content: '❌ Tu personaje está muerto y no puede construir.', flags: MessageFlags.Ephemeral });
    }

    const staffMember = await resolveMember(interaction);
    const actor = { isRolepriest: isRolepriestMember(staffMember) };
    if (player.coord_x !== x || player.coord_y !== y) {
      return interaction.reply({
        content:
          `❌ Tienes que estar físicamente en esa casilla para esto.\n` +
          `📍 Tu posición: **(${player.coord_x}, ${player.coord_y})** · Casilla indicada: **(${x}, ${y})**`,
        flags: MessageFlags.Ephemeral,
      });
    }

    const constructionType = await getConstructionTypeByName(tipo);
    if (!constructionType) {
      return interaction.reply({
        content: `❌ No existe ningún tipo de construcción llamado \`${tipo}\`. Usa \`/build list\`.`,
        flags: MessageFlags.Ephemeral,
      });
    }

    if (sub === 'place') {
      const tile = await getTile(x, y);
      if (!tile) {
        return interaction.reply({
          content: `❌ No existe ninguna casilla en **(${x}, ${y})**. Debe crearla primero un Rolepriest con \`/map create\`.`,
          flags: MessageFlags.Ephemeral,
        });
      }

      if (constructionType.requires_resource_type && tile.resource_type !== constructionType.requires_resource_type) {
        return interaction.reply({
          content:
            `❌ **${constructionType.display_name}** necesita una casilla con el recurso **${constructionType.requires_resource_type}**. ` +
            `Esta casilla tiene: ${tile.resource_type ?? '*ninguno*'}.`,
          flags: MessageFlags.Ephemeral,
        });
      }

      const construction = await buildConstruction(interaction.user.id, x, y, constructionType);

      logger.info(`[/build place] ${interaction.user.tag} construyó "${constructionType.name}" en (${x},${y}) [ID ${construction.id}]`);

      logAction({
        source: 'discord', actorDiscordId: interaction.user.id, actorUsername: interaction.user.tag,
        action: 'tile.construction_build', target: `(${x},${y})`,
        details: { constructionType: constructionType.name, constructionId: construction.id },
      });

      const embed = new EmbedBuilder()
        .setColor(COLORS.GREEN)
        .setTitle(`✅ Construido: ${constructionType.emoji} ${constructionType.display_name}`)
        .addFields(
          { name: '📍 Casilla', value: `(X: ${x}, Y: ${y})`, inline: true },
          { name: '🆔 ID', value: `\`${construction.id}\``, inline: true }
        )
        .setFooter({ text: `Construido por ${interaction.user.tag}` })
        .setTimestamp();

      await interaction.reply({ embeds: [embed] });

      if (constructionType.name === PRINTING_PRESS_TYPE_NAME) {
        await announcePrintingPressBuilt(interaction, interaction.user.id, construction.id);
      }
      return;
    }

    if (sub === 'destroy') {
      let existing;
      try {
        existing = await resolveConstructionAtTile(x, y, constructionType, constructionId);
      } catch (err) {
        return interaction.reply({ content: `❌ ${err.message}`, flags: MessageFlags.Ephemeral });
      }

      let removed;
      try {
        removed = await removeConstruction(existing.id, { discordId: interaction.user.id, isRolepriest: actor.isRolepriest }, { x: player.coord_x, y: player.coord_y });
      } catch (err) {
        return interaction.reply({ content: `❌ ${err.message}`, flags: MessageFlags.Ephemeral });
      }
      logger.info(`[/build destroy] ${interaction.user.tag} destruyó "${constructionType.name}" (ID ${existing.id}) en (${x},${y})`);
      logAction({
        source: 'discord', actorDiscordId: interaction.user.id, actorUsername: interaction.user.tag,
        action: 'tile.construction_destroy', target: `(${x},${y})`,
        details: { constructionType: constructionType.name, constructionId: existing.id },
      });

      return interaction.reply({
        embeds: [
          new EmbedBuilder()
            .setColor(COLORS.RED)
            .setTitle(`🗑️ Construcción destruida: ${constructionType.emoji} ${removed.name}`)
            .addFields({ name: '📍 Casilla', value: `(X: ${x}, Y: ${y})` })
            .setFooter({ text: `Destruida por ${interaction.user.tag}` })
            .setTimestamp(),
        ],
      });
    }

    if (sub === 'usar') {
      let result;
      try {
        result = await useConstruction(interaction.user.id, x, y, tipo, actor, constructionId);
      } catch (err) {
        return interaction.reply({ content: `❌ ${err.message}`, flags: MessageFlags.Ephemeral });
      }

      const { roll, yieldAmount, resultItem, laburoCost } = result;
      const hit = yieldAmount > 0;

      logAction({
        source: 'discord', actorDiscordId: interaction.user.id, actorUsername: interaction.user.tag,
        action: 'tile.construction_use', target: `(${x},${y})`,
        details: { constructionType: tipo, hit, yieldAmount, resultItem: resultItem.name },
      });

      logger.info(
        `[/build usar] ${interaction.user.tag} usó "${result.construction.name}" en (${x},${y}) ` +
        `→ tirada ${roll}, ${hit ? `+${yieldAmount} ${resultItem.name}` : 'sin resultado'}`
      );

      const embed = new EmbedBuilder()
        .setColor(hit ? COLORS.GREEN : COLORS.GREY)
        .setTitle(hit ? `${resultItem.emoji ?? '📦'} ¡Conseguiste algo!` : '🎲 Sin suerte esta vez')
        .addFields(
          { name: '🏗️ Construcción', value: `**${result.construction.name}** (${x}, ${y})`, inline: true },
          { name: '🎲 Tirada', value: `${roll} / 6`, inline: true }
        )
        .setTimestamp();

      if (hit) {
        embed.addFields({ name: '📦 Obtenido', value: `${resultItem.emoji ?? '📦'} **${resultItem.display_name}** ×${yieldAmount}` });
      } else {
        embed.setDescription('Esta vez no ha salido nada — puedes volver a intentarlo cuando pase el cooldown.');
      }

      if (laburoCost > 0) {
        embed.addFields({ name: '💪 Laburo gastado', value: `${laburoCost}`, inline: true });
      }

      return interaction.reply({ embeds: [embed] });
    }

    if (sub === 'repostar') {
      const cantidad = interaction.options.getInteger('cantidad', true);

      let result;
      try {
        result = await refuelConstruction(interaction.user.id, x, y, tipo, cantidad, actor, constructionId);
      } catch (err) {
        return interaction.reply({ content: `❌ ${err.message}`, flags: MessageFlags.Ephemeral });
      }

      const { fuelItem, added, requested, newLevel, capacity } = result;

      logAction({
        source: 'discord', actorDiscordId: interaction.user.id, actorUsername: interaction.user.tag,
        action: 'tile.construction_refuel', target: `(${x},${y})`,
        details: { constructionType: tipo, added, fuelItem: fuelItem.name },
      });

      logger.info(`[/build repostar] ${interaction.user.tag} repostó "${result.construction.name}" en (${x},${y}) con +${added} ${fuelItem.name}`);

      const embed = new EmbedBuilder()
        .setColor(COLORS.GREEN)
        .setTitle(`⛽ Depósito repostado: ${result.construction.name}`)
        .addFields(
          { name: '📍 Casilla', value: `(X: ${x}, Y: ${y})`, inline: true },
          { name: '➕ Añadido', value: `${fuelItem.emoji ?? '📦'} **${fuelItem.display_name}** ×${added}`, inline: true },
          { name: '⛽ Nivel del depósito', value: capacity != null ? `${newLevel} / ${capacity}` : `${newLevel}`, inline: true }
        )
        .setTimestamp();

      if (added < requested) {
        embed.setDescription(`El depósito ya iba a llenarse — solo se han usado **${added}** de las **${requested}** que llevabas, el resto se queda en tu inventario.`);
      }

      return interaction.reply({ embeds: [embed] });
    }

    if (sub === 'reparar') {
      let result;
      try {
        result = await repairConstruction(interaction.user.id, x, y, tipo, actor, constructionId);
      } catch (err) {
        return interaction.reply({ content: `❌ ${err.message}`, flags: MessageFlags.Ephemeral });
      }

      const { construction, ingredients, laburoCost } = result;

      logger.info(
        `[/build reparar] ${interaction.user.tag} reparó "${construction.name}" en (${x},${y}) — ` +
        `${ingredients.map(i => `${i.name}×${i.quantity_required}`).join(', ') || 'sin ingredientes'}${laburoCost > 0 ? `, Laburo×${laburoCost}` : ''}`
      );

      logAction({
        source: 'discord', actorDiscordId: interaction.user.id, actorUsername: interaction.user.tag,
        action: 'tile.construction_repair', target: `(${x},${y})`,
        details: { constructionType: tipo, ingredients: ingredients.map(i => ({ name: i.name, quantity: i.quantity_required })), laburoCost },
      });

      const embed = new EmbedBuilder()
        .setColor(COLORS.GREEN)
        .setTitle(`🔧 ¡Reparado! ${construction.name}`)
        .setDescription(`**${construction.name}** vuelve a estar en pie, a plena vida — ya funciona con normalidad (usar/repostar/generador de recursos).`)
        .addFields(
          { name: '📍 Casilla', value: `(X: ${x}, Y: ${y})`, inline: true },
          { name: '❤️ Vida', value: `${construction.current_health} / ${construction.ct_max_health ?? 10}`, inline: true }
        )
        .setTimestamp();

      if (ingredients.length > 0) {
        embed.addFields({ name: '📦 Ingredientes usados (mitad del coste de construirla)', value: ingredients.map(i => `${i.emoji ?? '📦'} ${i.display_name} ×${i.quantity_required}`).join('\n') });
      }
      if (laburoCost > 0) {
        embed.addFields({ name: '💪 Laburo gastado', value: `${laburoCost}`, inline: true });
      }

      return interaction.reply({ embeds: [embed] });
    }

    if (sub === 'restaurar') {
      let result;
      try {
        result = await restoreDurability(interaction.user.id, x, y, tipo, actor, constructionId);
      } catch (err) {
        return interaction.reply({ content: `❌ ${err.message}`, flags: MessageFlags.Ephemeral });
      }

      const { construction, maxDurability, previousDurability } = result;

      logger.info(
        `[/build restaurar] ${interaction.user.tag} restauró la durabilidad de "${construction.name}" en (${x},${y}): ${previousDurability} → ${maxDurability}`
      );
      logAction({
        source: 'discord', actorDiscordId: interaction.user.id, actorUsername: interaction.user.tag,
        action: 'tile.construction_durability_restore', target: `(${x},${y})`,
        details: { constructionType: tipo, previousDurability, maxDurability },
      });

      const embed = new EmbedBuilder()
        .setColor(COLORS.GREEN)
        .setTitle(`🛠️ ¡Restaurada! ${construction.name}`)
        .addFields(
          { name: '📍 Casilla', value: `(X: ${x}, Y: ${y})`, inline: true },
          { name: '🛠️ Durabilidad', value: `${previousDurability} → ${maxDurability}`, inline: true }
        )
        .setTimestamp();

      return interaction.reply({ embeds: [embed] });
    }

    if (sub === 'mercado_stock') {
      const item = interaction.options.getString('item', true).toLowerCase().trim();
      const precio = interaction.options.getNumber('precio', true);
      const cantidad = interaction.options.getNumber('cantidad', true);

      let result;
      try {
        result = await stockMarketItem(interaction.user.id, x, y, tipo, item, precio, cantidad, actor, constructionId);
      } catch (err) {
        return interaction.reply({ content: `❌ ${err.message}`, flags: MessageFlags.Ephemeral });
      }

      logger.info(`[/build mercado_stock] ${interaction.user.tag} repuso "${result.construction.name}" en (${x},${y}): +${cantidad} ${result.item.name} a ${precio}/u`);

      return interaction.reply({
        embeds: [
          new EmbedBuilder()
            .setColor(COLORS.GREEN)
            .setTitle(`🏪 Stock repuesto: ${result.construction.name}`)
            .addFields(
              { name: '📦 Ítem', value: `${result.item.emoji ?? '📦'} ${result.item.display_name}`, inline: true },
              { name: '💪 Precio', value: `${precio} Laburo/u`, inline: true },
              { name: '📊 Stock total ahora', value: `${result.newStock}`, inline: true }
            )
            .setTimestamp(),
        ],
      });
    }

    if (sub === 'mercado_list') {
      let result;
      try {
        result = await listMarketItems(x, y, tipo, constructionId);
      } catch (err) {
        return interaction.reply({ content: `❌ ${err.message}`, flags: MessageFlags.Ephemeral });
      }

      const embed = new EmbedBuilder()
        .setColor(COLORS.BLUE)
        .setTitle(`🏪 En venta: ${result.construction.name}`)
        .setTimestamp();

      if (result.listings.length === 0) {
        embed.setDescription('*Nada en venta todavía — el dueño (o Staff) puede reponer con `/build mercado_stock`.*');
      } else {
        embed.setDescription(
          result.listings
            .map(l => `${l.emoji ?? '📦'} **${l.display_name}** — ${l.price_laburo} Laburo/u (stock: ${l.stock_quantity})`)
            .join('\n')
        );
      }

      return interaction.reply({ embeds: [embed] });
    }

    if (sub === 'comprar') {
      const item = interaction.options.getString('item', true).toLowerCase().trim();
      const cantidad = interaction.options.getNumber('cantidad', true);

      let result;
      try {
        result = await buyFromMarket(interaction.user.id, x, y, tipo, item, cantidad, constructionId);
      } catch (err) {
        return interaction.reply({ content: `❌ ${err.message}`, flags: MessageFlags.Ephemeral });
      }

      logger.info(`[/build comprar] ${interaction.user.tag} compró ${cantidad} ${result.item.name} de "${result.construction.name}" en (${x},${y}) por ${result.totalCost} Laburo`);
      logAction({
        source: 'discord', actorDiscordId: interaction.user.id, actorUsername: interaction.user.tag,
        action: 'market.purchase', target: `(${x},${y})`,
        details: { constructionType: tipo, item: result.item.name, quantity: cantidad, totalCost: result.totalCost },
      });

      return interaction.reply({
        embeds: [
          new EmbedBuilder()
            .setColor(COLORS.GREEN)
            .setTitle(`🛒 ¡Comprado! ${result.item.emoji ?? '📦'} ${result.item.display_name} ×${cantidad}`)
            .addFields(
              { name: '🏪 Mercado', value: result.construction.name, inline: true },
              { name: '💪 Pagado', value: `${result.totalCost} Laburo`, inline: true },
              { name: '📊 Stock restante', value: `${result.remainingStock}`, inline: true }
            )
            .setTimestamp(),
        ],
      });
    }

    if (sub === 'almacen_ver') {
      let existing;
      try {
        existing = await resolveConstructionAtTile(x, y, constructionType, constructionId);
      } catch (err) {
        return interaction.reply({ content: `❌ ${err.message}`, flags: MessageFlags.Ephemeral });
      }

      const contents = await getStorageContents(existing.id);
      const embed = new EmbedBuilder()
        .setColor(COLORS.DARK)
        .setTitle(`📦 Almacén: ${existing.name}`)
        .addFields({ name: '📍 Casilla', value: `(X: ${x}, Y: ${y})`, inline: true })
        .setTimestamp();

      embed.setDescription(
        contents.length === 0
          ? '*Vacío.*'
          : contents.map(c => `${c.emoji ?? '📦'} **${c.display_name}** ×${c.quantity}`).join('\n')
      );
      if (existing.storage_capacity != null) {
        const usedWeight = contents.reduce((sum, c) => sum + c.quantity * c.weight, 0);
        embed.addFields({ name: '⚖️ Capacidad', value: `${usedWeight.toFixed(2)} / ${existing.storage_capacity}`, inline: true });
      }

      return interaction.reply({ embeds: [embed] });
    }

    if (sub === 'almacen_depositar') {
      const item = interaction.options.getString('item', true).toLowerCase().trim();
      const cantidad = interaction.options.getNumber('cantidad', true);

      let existing;
      try {
        existing = await resolveConstructionAtTile(x, y, constructionType, constructionId);
      } catch (err) {
        return interaction.reply({ content: `❌ ${err.message}`, flags: MessageFlags.Ephemeral });
      }

      let result;
      try {
        result = await depositItem(interaction.user.id, existing, item, cantidad, actor);
      } catch (err) {
        return interaction.reply({ content: `❌ ${err.message}`, flags: MessageFlags.Ephemeral });
      }

      logger.info(`[/build almacen_depositar] ${interaction.user.tag} depositó ${result.added} ${item} en "${existing.name}" (${x},${y})`);

      return interaction.reply({
        content: `✅ Depositaste **${result.added}** de **${item}** en **${existing.name}**` +
          (result.overflow > 0 ? ` (el almacén no tenía sitio para **${result.overflow}** más — se quedaron en tu inventario).` : '.'),
      });
    }

    if (sub === 'almacen_retirar') {
      const item = interaction.options.getString('item', true).toLowerCase().trim();
      const cantidad = interaction.options.getNumber('cantidad', true);

      let existing;
      try {
        existing = await resolveConstructionAtTile(x, y, constructionType, constructionId);
      } catch (err) {
        return interaction.reply({ content: `❌ ${err.message}`, flags: MessageFlags.Ephemeral });
      }

      let result;
      try {
        result = await withdrawItem(interaction.user.id, existing, item, cantidad, actor);
      } catch (err) {
        return interaction.reply({ content: `❌ ${err.message}`, flags: MessageFlags.Ephemeral });
      }

      logger.info(`[/build almacen_retirar] ${interaction.user.tag} retiró ${result.withdrawn} ${item} de "${existing.name}" (${x},${y})`);

      return interaction.reply({
        content: `✅ Retiraste **${result.withdrawn}** de **${item}** de **${existing.name}** (quedan **${result.remaining}**).`,
      });
    }

    if (sub === 'reclutar') {
      const npcTipo = interaction.options.getString('npc_tipo', true);

      let existing;
      try {
        existing = await resolveConstructionAtTile(x, y, constructionType, constructionId);
      } catch (err) {
        return interaction.reply({ content: `❌ ${err.message}`, flags: MessageFlags.Ephemeral });
      }

      let npc;
      try {
        npc = await recruitNpc(interaction.user.id, existing.id, npcTipo, actor);
      } catch (err) {
        return interaction.reply({ content: `❌ ${err.message}`, flags: MessageFlags.Ephemeral });
      }

      logger.info(`[/build reclutar] ${interaction.user.tag} reclutó "${npc.type_display_name}" (#${npc.id}) en "${existing.name}" (${x},${y})`);

      logAction({
        source: 'discord', actorDiscordId: interaction.user.id, actorUsername: interaction.user.tag,
        action: 'tile.npc_recruit', target: `(${x},${y})`,
        details: { npcType: npc.type_name, npcId: npc.id },
      });

      return interaction.reply({
        embeds: [
          new EmbedBuilder()
            .setColor(COLORS.GREEN)
            .setTitle(`✅ Reclutado: ${npc.type_emoji ?? '👤'} ${npc.type_display_name}`)
            .addFields(
              { name: '📍 Casilla', value: `(X: ${x}, Y: ${y})`, inline: true },
              { name: '🆔 ID', value: `\`${npc.id}\``, inline: true }
            )
            .setFooter({ text: 'Usa /npc list para ver tus NPCs, /npc recoger para cobrar su producción' })
            .setTimestamp(),
        ],
      });
    }

    if (sub === 'ceder') {
      const targetUser = interaction.options.getUser('jugador', true);
      const accion = interaction.options.getString('accion', true);
      const horas = interaction.options.getInteger('horas');

      let existing;
      try {
        existing = await resolveConstructionAtTile(x, y, constructionType, constructionId);
      } catch (err) {
        return interaction.reply({ content: `❌ ${err.message}`, flags: MessageFlags.Ephemeral });
      }

      const targetPlayer = await getPlayerByDiscordId(targetUser.id);
      if (!targetPlayer) {
        return interaction.reply({ content: `❌ **${targetUser.username}** no está registrado. Pídele que use \`/personaje crear\` primero.`, flags: MessageFlags.Ephemeral });
      }

      const scope = { type: 'construction', id: existing.id, factionId: existing.tile_faction_id, ownerPlayerId: existing.built_by_player_id };
      const expiresAt = horas ? new Date(Date.now() + horas * 3600_000) : null;
      try {
        await grantPermission({ discordId: interaction.user.id, isRolepriest: actor.isRolepriest }, targetPlayer.id, scope, accion, expiresAt);
      } catch (err) {
        return interaction.reply({ content: `❌ ${err.message}`, flags: MessageFlags.Ephemeral });
      }

      logger.info(`[/build ceder] ${interaction.user.tag} cedió "${accion}" sobre "${existing.name}" (${x},${y}) a ${targetUser.tag}${horas ? ` por ${horas}h` : ''}`);

      return interaction.reply({
        content: `✅ Has cedido **${PERMISSION_ACTIONS[accion]}** sobre **${existing.name}** a **${targetUser.username}**` +
          (horas ? ` durante **${horas}h**.` : ' (sin caducidad).'),
      });
    }
  },
};
