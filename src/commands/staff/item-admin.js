import { SlashCommandBuilder, EmbedBuilder, MessageFlags } from 'discord.js';

import { getOrCreatePlayer }    from '../../services/playerService.js';
import { grantItem, revokeItem } from '../../services/inventoryService.js';
import { getEffectType }        from '../../services/effectTypesService.js';
import { getConstructionTypeByName } from '../../services/constructionTypeService.js';
import {
  getItemByName,
  createItem as createItemInCatalog, updateItem as updateItemInCatalog,
  deleteItem as deleteItemFromCatalog, setItemImage,
  configureItemWeapon, configureItemVehicle,
}                                from '../../services/itemService.js';
import { addRecipe, getRecipesForItem, removeRecipe } from '../../services/recipeService.js';
import { requireRolepriest, config } from '../../utils/permissions.js';
import { COLORS }               from '../../utils/embeds.js';
import { buildAssetUrl }        from '../../utils/publicUrl.js';
import {
  validateImageAttachment,
  downloadAndSaveImage,
  ALLOWED_IMAGE_TYPES_LABEL,
}                                from '../../utils/imageUpload.js';
import {
  handleItemAutocomplete,
  handleEffectTypeAutocomplete,
  handleConstructionTypeAutocomplete,
}                                from '../../utils/autocomplete.js';
import { parseIngredients }     from '../../utils/ingredients.js';
import logger                   from '../../utils/logger.js';
import { logAction }            from '../../services/auditLogService.js';

const ITEMS_WRITE_PATH = (config.images?.itemsHostPath ?? '/app/items')
  .replace(/\/$/, '');

const ITEM_TYPE_META = {
  dinero:      { emoji: '💰', label: 'Dinero' },
  consumible:  { emoji: '🎒', label: 'Consumible' },
  recurso:     { emoji: '⛏️', label: 'Recurso' },
  herramienta: { emoji: '🔧', label: 'Herramienta' },
  laburo:      { emoji: '💪', label: 'Laburo' },
  arma:        { emoji: '🔫', label: 'Arma' },
};

export default {
  data: new SlashCommandBuilder()
    .setName('item-admin')
    .setDescription('[Staff] Gestiona el catálogo de ítems y el inventario de otros jugadores')

    .addSubcommand(sub =>
      sub
        .setName('add')
        .setDescription('Añade ítems al inventario de un jugador')
        .addUserOption(opt => opt.setName('jugador').setDescription('Jugador receptor').setRequired(true))
        .addStringOption(opt => opt.setName('item').setDescription('Ítem').setRequired(true).setAutocomplete(true))
        .addNumberOption(opt => opt.setName('cantidad').setDescription('Cantidad a añadir').setRequired(true).setMinValue(0.01))
    )

    .addSubcommand(sub =>
      sub
        .setName('remove')
        .setDescription('Elimina ítems del inventario de un jugador')
        .addUserOption(opt => opt.setName('jugador').setDescription('Jugador').setRequired(true))
        .addStringOption(opt => opt.setName('item').setDescription('Ítem').setRequired(true).setAutocomplete(true))
        .addNumberOption(opt => opt.setName('cantidad').setDescription('Cantidad a eliminar').setRequired(true).setMinValue(0.01))
    )

    .addSubcommand(sub =>
      sub
        .setName('create')
        .setDescription('Crea un ítem — usa /item-admin receta y /item-admin arma para configurarlo después')
        .addStringOption(opt => opt.setName('nombre').setDescription('Nombre clave único (ej: pico_hierro)').setRequired(true))
        .addStringOption(opt => opt.setName('display').setDescription('Nombre para mostrar').setRequired(true))
        .addStringOption(opt =>
          opt.setName('tipo').setDescription('Tipo de ítem').setRequired(true)
            .addChoices(
              { name: '💰 Dinero',       value: 'dinero'      },
              { name: '🎒 Consumible',   value: 'consumible'  },
              { name: '⛏️ Recurso',      value: 'recurso'     },
              { name: '🔧 Herramienta',  value: 'herramienta' },
              { name: '💪 Laburo',       value: 'laburo'      },
              { name: '🔫 Arma',         value: 'arma'        },
              { name: '🚁 Vehículo',     value: 'vehiculo'    }
            )
        )
        .addStringOption(opt => opt.setName('emoji').setDescription('Emoji del ítem').setRequired(false))
        .addStringOption(opt => opt.setName('descripcion').setDescription('Descripción corta').setRequired(false))
        .addAttachmentOption(opt =>
          opt.setName('imagen').setDescription(`Imagen (${ALLOWED_IMAGE_TYPES_LABEL} · máx. 2 MB)`).setRequired(false)
        )
        .addBooleanOption(opt => opt.setName('consumible').setDescription('¿Puede ser consumido con /item usar?').setRequired(false))
        .addNumberOption(opt => opt.setName('hp_delta').setDescription('HP al consumir').setRequired(false))
        .addNumberOption(opt => opt.setName('hunger_delta').setDescription('Hambre al consumir').setRequired(false))
        .addStringOption(opt => opt.setName('efecto').setDescription('Estado que aplica al consumir').setRequired(false).setAutocomplete(true))
        .addIntegerOption(opt => opt.setName('efecto_horas').setDescription('Duración del efecto (horas, omitir=permanente)').setRequired(false).setMinValue(1))
        .addBooleanOption(opt => opt.setName('combustible').setDescription('¿Puede usarse como combustible de construcciones? (ver /construction create/modify)').setRequired(false))
        .addNumberOption(opt => opt.setName('peso').setDescription('Peso por unidad, para la capacidad de inventario del jugador (por defecto 1)').setRequired(false).setMinValue(0))
    )

    .addSubcommand(sub =>
      sub
        .setName('arma')
        .setDescription('Configura o edita las estadísticas de combate de un ítem de tipo arma')
        .addStringOption(opt => opt.setName('item').setDescription('Ítem de tipo arma a configurar').setRequired(true).setAutocomplete(true))
        .addNumberOption(opt => opt.setName('dano').setDescription('Daño en HP por impacto a un jugador').setRequired(false).setMinValue(0))
        .addNumberOption(opt => opt.setName('dano_estructura').setDescription('Daño a construcciones con /attack construccion (vacío = no puede dañarlas)').setRequired(false).setMinValue(0))
        .addIntegerOption(opt => opt.setName('dado_1').setDescription('Alcance máximo si sale un 1: llega de 0 hasta N casillas (vacío=falla)').setRequired(false).setMinValue(0))
        .addIntegerOption(opt => opt.setName('dado_2').setDescription('Alcance máximo si sale un 2: llega de 0 hasta N casillas (vacío=falla)').setRequired(false).setMinValue(0))
        .addIntegerOption(opt => opt.setName('dado_3').setDescription('Alcance máximo si sale un 3: llega de 0 hasta N casillas (vacío=falla)').setRequired(false).setMinValue(0))
        .addIntegerOption(opt => opt.setName('dado_4').setDescription('Alcance máximo si sale un 4: llega de 0 hasta N casillas (vacío=falla)').setRequired(false).setMinValue(0))
        .addIntegerOption(opt => opt.setName('dado_5').setDescription('Alcance máximo si sale un 5: llega de 0 hasta N casillas (vacío=falla)').setRequired(false).setMinValue(0))
        .addIntegerOption(opt => opt.setName('dado_6').setDescription('Alcance máximo si sale un 6: llega de 0 hasta N casillas (vacío=falla)').setRequired(false).setMinValue(0))
        .addIntegerOption(opt => opt.setName('durabilidad').setDescription('Usos antes de romperse (vacío = irrompible)').setRequired(false).setMinValue(1))
        .addStringOption(opt => opt.setName('municion').setDescription('Ítem que consume por disparo (vacío = no requiere munición)').setRequired(false).setAutocomplete(true))
        .addIntegerOption(opt => opt.setName('municion_coste').setDescription('Unidades de munición gastadas por disparo (por defecto: 1)').setRequired(false).setMinValue(1))
        .addBooleanOption(opt => opt.setName('area').setDescription('¿Al impactar afecta a TODA la casilla (otros jugadores + construcciones)? Ej. explosivos').setRequired(false))
        .addStringOption(opt => opt.setName('area_efecto').setDescription('Estado del catálogo de /effect a aplicar a toda la casilla afectada (exige area:true)').setRequired(false).setAutocomplete(true))
        .addIntegerOption(opt => opt.setName('area_efecto_horas').setDescription('Duración de area_efecto en horas (vacío = permanente hasta que Staff lo quite)').setRequired(false).setMinValue(1))
    )

    .addSubcommand(sub =>
      sub
        .setName('vehiculo')
        .setDescription('Configura la categoría de transporte de un ítem de tipo vehículo')
        .addStringOption(opt => opt.setName('item').setDescription('Ítem de tipo vehículo a configurar').setRequired(true).setAutocomplete(true))
        .addStringOption(opt =>
          opt.setName('categoria').setDescription('Categoría de transporte').setRequired(true)
            .addChoices(
              { name: '✈️ Aéreo (sobrevuela cualquier terreno, exige aterrizaje)', value: 'aereo' },
              { name: '🚤 Marítimo',  value: 'maritimo'  },
              { name: '🚙 Terrestre', value: 'terrestre' },
            )
        )
        .addNumberOption(opt =>
          opt.setName('velocidad').setDescription('Multiplicador de velocidad del viaje gradual (omite = 1, ritmo normal)').setRequired(false).setMinValue(0.1)
        )
    )

    .addSubcommand(sub =>
      sub
        .setName('modify')
        .setDescription('Edita identidad/consumible de un ítem — usa /item-admin arma o receta para esos campos')
        .addStringOption(opt => opt.setName('item').setDescription('Ítem a editar').setRequired(true).setAutocomplete(true))
        .addStringOption(opt => opt.setName('display').setDescription('Nuevo nombre para mostrar').setRequired(false))
        .addStringOption(opt => opt.setName('emoji').setDescription('Nuevo emoji').setRequired(false))
        .addStringOption(opt => opt.setName('descripcion').setDescription('Nueva descripción').setRequired(false))
        .addBooleanOption(opt => opt.setName('consumible').setDescription('¿Consumible?').setRequired(false))
        .addBooleanOption(opt => opt.setName('combustible').setDescription('¿Puede usarse como combustible de construcciones?').setRequired(false))
        .addNumberOption(opt => opt.setName('hp_delta').setDescription('Nuevo HP al consumir').setRequired(false))
        .addNumberOption(opt => opt.setName('hunger_delta').setDescription('Nueva hambre al consumir').setRequired(false))
        .addStringOption(opt => opt.setName('efecto').setDescription('Nuevo estado al consumir').setRequired(false).setAutocomplete(true))
        .addNumberOption(opt => opt.setName('peso').setDescription('Nuevo peso por unidad, para la capacidad de inventario del jugador').setRequired(false).setMinValue(0))
        .addIntegerOption(opt => opt.setName('alcance_curacion').setDescription('Casillas a las que un NPC con este ítem puede curar a un aliado (0 = solo a sí mismo)').setRequired(false).setMinValue(0))
        .addNumberOption(opt => opt.setName('montura_vida').setDescription('Vida extra que da como montura de un NPC (solo tiene efecto en ítems tipo vehículo)').setRequired(false).setMinValue(0))
        .addNumberOption(opt => opt.setName('montura_dano').setDescription('Daño extra que da como montura de un NPC (solo tiene efecto en ítems tipo vehículo)').setRequired(false).setMinValue(0))
    )

    .addSubcommand(sub =>
      sub
        .setName('receta')
        .setDescription('Añade una receta de crafteo a un ítem ya existente (puede tener varias)')
        .addStringOption(opt => opt.setName('item').setDescription('Ítem a recetar').setRequired(true).setAutocomplete(true))
        .addStringOption(opt => opt.setName('ingredientes').setDescription('Receta: "item:cant,item:cant" (omite = sin ingredientes)').setRequired(false))
        .addNumberOption(opt => opt.setName('laburo_coste').setDescription('Coste en Laburo para craftear (omite = 0)').setRequired(false).setMinValue(0))
        .addStringOption(opt =>
          opt.setName('construccion').setDescription('Construcción necesaria (omite = ninguna)').setRequired(false).setAutocomplete(true)
        )
        .addBooleanOption(opt => opt.setName('periodico').setDescription('¿Craftearlo crea un canal-periódico? Exige construccion en esta misma llamada (ver Imprenta)').setRequired(false))
        .addStringOption(opt => opt.setName('herramienta_reduccion').setDescription('Ítem que, si lo tienes, abarata el Laburo de esta receta (no se consume)').setRequired(false).setAutocomplete(true))
        .addNumberOption(opt => opt.setName('reduccion_laburo').setDescription('Cuánto Laburo se resta si tienes herramienta_reduccion (nunca baja de 0)').setRequired(false).setMinValue(0))
    )

    .addSubcommand(sub =>
      sub
        .setName('recetas')
        .setDescription('Lista todas las recetas de crafteo de un ítem, numeradas')
        .addStringOption(opt => opt.setName('item').setDescription('Ítem a consultar').setRequired(true).setAutocomplete(true))
    )

    .addSubcommand(sub =>
      sub
        .setName('quitar-receta')
        .setDescription('Borra una receta de crafteo de un ítem (el ítem en sí no se toca)')
        .addStringOption(opt => opt.setName('item').setDescription('Ítem cuya receta quieres borrar').setRequired(true).setAutocomplete(true))
        .addIntegerOption(opt =>
          opt.setName('indice').setDescription('Número de receta a borrar (ver recetas) — solo hace falta si tiene más de una').setRequired(false).setMinValue(1)
        )
    )

    .addSubcommand(sub =>
      sub
        .setName('delete')
        .setDescription('Elimina un ítem del catálogo (si no está en uso)')
        .addStringOption(opt => opt.setName('item').setDescription('Ítem a eliminar').setRequired(true).setAutocomplete(true))
    )

    .addSubcommand(sub =>
      sub
        .setName('setimage')
        .setDescription('Añade o reemplaza la imagen de un ítem ya existente')
        .addStringOption(opt => opt.setName('item').setDescription('Ítem').setRequired(true).setAutocomplete(true))
        .addAttachmentOption(opt => opt.setName('imagen').setDescription(`Imagen (${ALLOWED_IMAGE_TYPES_LABEL} · máx. 2 MB)`).setRequired(true))
    ),

  async autocomplete(interaction) {
    const focused = interaction.options.getFocused(true);
    if (focused.name === 'efecto' || focused.name === 'area_efecto') {
      await handleEffectTypeAutocomplete(interaction);
    } else if (focused.name === 'construccion') {
      await handleConstructionTypeAutocomplete(interaction);
    } else {
      await handleItemAutocomplete(interaction);
    }
  },

  async execute(interaction) {
    if (!await requireRolepriest(interaction)) return;

    const sub = interaction.options.getSubcommand();

    if (sub === 'add') {
      const targetUser = interaction.options.getUser('jugador', true);
      const itemName   = interaction.options.getString('item', true).toLowerCase().trim();
      const cantidad   = interaction.options.getNumber('cantidad', true);

      await getOrCreatePlayer(targetUser.id, targetUser.username);

      let result;
      try {
        result = await grantItem(targetUser.id, itemName, cantidad);
      } catch (err) {
        return interaction.reply({ content: `❌ ${err.message}`, flags: MessageFlags.Ephemeral });
      }

      logger.info(`[/item-admin add] ${interaction.user.tag} → +${cantidad} "${itemName}" a ${targetUser.tag}`);
      logAction({ source: 'discord', actorDiscordId: interaction.user.id, actorUsername: interaction.user.tag, action: 'inventory.add', target: targetUser.id, details: { itemName, cantidad } });

      const embed = new EmbedBuilder()
        .setColor(COLORS.GREEN)
        .setTitle('✅ Ítem añadido')
        .addFields(
          { name: '👤 Jugador',  value: `<@${targetUser.id}>`, inline: true },
          { name: '📦 Ítem',     value: `${result.item.emoji ?? '📦'} **${result.item.display_name}**`, inline: true },
          { name: '➕ Cantidad', value: `+${cantidad}${result.newQuantity != null ? ` (total: ${result.newQuantity})` : ''}`, inline: true }
        )
        .setFooter({ text: `Operación realizada por ${interaction.user.tag}` })
        .setTimestamp();

      const itemThumb = buildAssetUrl(result.item.image_filename, '/item-admin add');
      if (itemThumb) embed.setThumbnail(itemThumb);

      return interaction.reply({ embeds: [embed] });
    }

    if (sub === 'remove') {
      const targetUser = interaction.options.getUser('jugador', true);
      const itemName   = interaction.options.getString('item', true).toLowerCase().trim();
      const cantidad   = interaction.options.getNumber('cantidad', true);

      await getOrCreatePlayer(targetUser.id, targetUser.username);

      let result;
      try {
        result = await revokeItem(targetUser.id, itemName, cantidad);
      } catch (err) {
        return interaction.reply({ content: `❌ ${err.message}`, flags: MessageFlags.Ephemeral });
      }

      logger.info(`[/item-admin remove] ${interaction.user.tag} → -${cantidad} "${itemName}" a ${targetUser.tag}`);
      logAction({ source: 'discord', actorDiscordId: interaction.user.id, actorUsername: interaction.user.tag, action: 'inventory.remove', target: targetUser.id, details: { itemName, cantidad } });

      const embed = new EmbedBuilder()
        .setColor(COLORS.RED)
        .setTitle('🗑️ Ítem eliminado')
        .addFields(
          { name: '👤 Jugador',  value: `<@${targetUser.id}>`, inline: true },
          { name: '📦 Ítem',     value: `${result.item.emoji ?? '📦'} **${result.item.display_name}**`, inline: true },
          { name: '➖ Cantidad', value: `-${cantidad}${result.newQuantity != null ? ` (restante: ${result.newQuantity})` : ''}`, inline: true }
        )
        .setFooter({ text: `Operación realizada por ${interaction.user.tag}` })
        .setTimestamp();

      const itemThumb = buildAssetUrl(result.item.image_filename, '/item-admin remove');
      if (itemThumb) embed.setThumbnail(itemThumb);

      return interaction.reply({ embeds: [embed] });
    }

    if (sub === 'create') {
      await interaction.deferReply();

      const nombre       = interaction.options.getString('nombre', true).toLowerCase().trim();
      const display      = interaction.options.getString('display', true).trim();
      const tipo         = interaction.options.getString('tipo', true);
      const emoji        = interaction.options.getString('emoji')        ?? '📦';
      const descripcion  = interaction.options.getString('descripcion')  ?? '';
      const esConsumible = interaction.options.getBoolean('consumible')  ?? false;
      const hpDelta      = interaction.options.getNumber('hp_delta')     ?? 0;
      const hungerDelta  = interaction.options.getNumber('hunger_delta') ?? 0;
      const efecto       = interaction.options.getString('efecto')       ?? null;
      const efectoHoras  = interaction.options.getInteger('efecto_horas') ?? null;
      const esCombustible = interaction.options.getBoolean('combustible') ?? false;
      const peso         = interaction.options.getNumber('peso') ?? 1;
      const imagenAttachment = interaction.options.getAttachment('imagen') ?? null;

      if (!/^[a-z0-9_-]+$/.test(nombre)) {
        return interaction.editReply({
          content:
            '❌ El nombre solo puede contener **letras minúsculas**, **números**, ' +
            '**guiones** (`-`) y **guiones bajos** (`_`).\nEjemplos válidos: `pico`, `pico_hierro`, `pan-tostado`',
        });
      }

      if (efecto && !(await getEffectType(efecto))) {
        return interaction.editReply({ content: `❌ No existe ningún tipo de estado llamado \`${efecto}\`. Usa \`/effect list\`.` });
      }

      let imageFilename = null;
      if (imagenAttachment) {
        const validation = validateImageAttachment(imagenAttachment);
        if (!validation.ok) return interaction.editReply({ content: `❌ ${validation.error}` });
        try {
          const { filename } = await downloadAndSaveImage(imagenAttachment, validation.ext, ITEMS_WRITE_PATH, `item_${nombre}`);
          imageFilename = `items/${filename}`;
        } catch (err) {
          return interaction.editReply({ content: `❌ Error al guardar la imagen: ${err.message}` });
        }
      }

      let newItem;
      try {
        newItem = await createItemInCatalog({
          name: nombre, displayName: display, itemType: tipo, description: descripcion,
          emoji, imageFilename,
          consumeHpDelta: hpDelta, consumeHungerDelta: hungerDelta,
          consumeEffect: efecto, consumeEffectDurationHours: efectoHoras,
          isConsumable: esConsumible, isFuel: esCombustible, weight: peso,
        });
      } catch (err) {
        const isDuplicate = err.message.toLowerCase().includes('unique constraint');
        return interaction.editReply({
          content: isDuplicate
            ? `❌ Ya existe un ítem con el nombre \`${nombre}\`. Elige un nombre diferente.`
            : `❌ Error al crear el ítem: ${err.message}`,
        });
      }

      logger.info(`[/item-admin create] ${interaction.user.tag} creó "${nombre}" (${tipo})`);
      logAction({ source: 'discord', actorDiscordId: interaction.user.id, actorUsername: interaction.user.tag, action: 'item.create', target: nombre, details: { tipo } });

      const embed = new EmbedBuilder()
        .setColor(COLORS.PURPLE)
        .setTitle(`✅ Ítem creado: ${emoji} ${display}`)
        .addFields(
          { name: '🔑 Nombre clave', value: `\`${nombre}\``, inline: true },
          { name: '🗂️ Tipo',         value: ITEM_TYPE_META[tipo]?.label ?? tipo, inline: true },
          { name: '🎒 Consumible',   value: esConsumible ? 'Sí' : 'No', inline: true }
        );

      if (esCombustible) embed.addFields({ name: '⛽ Combustible', value: 'Sí — puede configurarse en `/construction create combustible_item`', inline: true });

      if (esConsumible && (hpDelta !== 0 || hungerDelta !== 0 || efecto)) {
        const lines = [];
        if (hpDelta !== 0) lines.push(`❤️ HP: ${hpDelta > 0 ? '+' : ''}${hpDelta}`);
        if (hungerDelta !== 0) lines.push(`🍖 Hambre: ${hungerDelta > 0 ? '+' : ''}${hungerDelta}`);
        if (efecto) lines.push(`🎭 Efecto: ${efecto}${efectoHoras ? ` (${efectoHoras}h)` : ' (permanente)'}`);
        embed.addFields({ name: '⚗️ Efectos al consumir', value: lines.join('\n') });
      }

      const nextSteps = [];
      if (tipo === 'arma') nextSteps.push(`🔫 \`/item-admin arma item:${nombre}\` para configurar daño, alcance y munición`);
      nextSteps.push(`⚒️ \`/item-admin receta item:${nombre}\` si se puede craftear`);
      embed.addFields({ name: '👉 Siguiente paso', value: nextSteps.join('\n') });

      embed.setFooter({ text: `Creado por ${interaction.user.tag}` }).setTimestamp();

      const itemThumb = buildAssetUrl(imageFilename, '/item-admin create');
      if (itemThumb) embed.setThumbnail(itemThumb);

      return interaction.editReply({ embeds: [embed] });
    }

    if (sub === 'arma') {
      const itemName = interaction.options.getString('item', true).toLowerCase().trim();
      const existing = await getItemByName(itemName);
      if (!existing) {
        return interaction.reply({ content: `❌ No existe ningún ítem \`${itemName}\` en el catálogo.`, flags: MessageFlags.Ephemeral });
      }
      if (existing.item_type !== 'arma') {
        return interaction.reply({
          content: `❌ **${existing.display_name}** no es de tipo arma (es \`${existing.item_type}\`) — no se le puede configurar daño/munición. Créalo con \`tipo:arma\` en \`/item-admin create\`.`,
          flags: MessageFlags.Ephemeral,
        });
      }

      const municion = interaction.options.getString('municion')?.toLowerCase().trim() || null;
      const area = interaction.options.getBoolean('area');
      const areaEfecto = interaction.options.getString('area_efecto')?.toLowerCase().trim() || null;

      const weaponUpdates = {
        damage: interaction.options.getNumber('dano') ?? undefined,
        structureDamage: interaction.options.getNumber('dano_estructura') ?? undefined,
        roll1: interaction.options.getInteger('dado_1') ?? undefined,
        roll2: interaction.options.getInteger('dado_2') ?? undefined,
        roll3: interaction.options.getInteger('dado_3') ?? undefined,
        roll4: interaction.options.getInteger('dado_4') ?? undefined,
        roll5: interaction.options.getInteger('dado_5') ?? undefined,
        roll6: interaction.options.getInteger('dado_6') ?? undefined,
        maxDurability: interaction.options.getInteger('durabilidad') ?? undefined,
        ammoItemName: municion ?? undefined,
        ammoCost: interaction.options.getInteger('municion_coste') ?? undefined,
        areaDamage: area ?? undefined,
        areaEffect: areaEfecto ?? undefined,
        areaEffectDurationHours: interaction.options.getInteger('area_efecto_horas') ?? undefined,
      };

      let updated;
      try {
        updated = await configureItemWeapon(itemName, weaponUpdates);
      } catch (err) {
        return interaction.reply({ content: `❌ ${err.message}`, flags: MessageFlags.Ephemeral });
      }

      logger.info(`[/item-admin arma] ${interaction.user.tag} configuró "${itemName}"`);
      logAction({ source: 'discord', actorDiscordId: interaction.user.id, actorUsername: interaction.user.tag, action: 'item.configure_weapon', target: itemName });

      const dadoLines = [1, 2, 3, 4, 5, 6].map(n => {
        const d = updated[`weapon_roll_${n}`];
        return `🎲 ${n}: ${d != null ? `alcanza de 0 a ${d} casilla(s)` : 'falla'}`;
      });

      const embed = new EmbedBuilder()
        .setColor(COLORS.BLUE)
        .setTitle(`🔫 Arma configurada: ${updated.emoji ?? '🔫'} ${updated.display_name}`)
        .addFields(
          { name: '💥 Daño (jugador)', value: `${updated.weapon_damage ?? 0} HP`, inline: true },
          { name: '🏚️ Daño (construcción)', value: updated.weapon_structure_damage ? `${updated.weapon_structure_damage}` : 'No puede dañarlas', inline: true },
          { name: '🔧 Durabilidad', value: updated.weapon_max_durability ? `${updated.weapon_max_durability} usos` : 'Irrompible', inline: true },
          { name: '🎯 Tabla de tirada de alcance (1d6)', value: dadoLines.join('\n') }
        )
        .setFooter({ text: `Configurada por ${interaction.user.tag}` })
        .setTimestamp();

      if (updated.weapon_ammo_item_name) {
        embed.addFields({ name: '🔹 Munición', value: `${updated.weapon_ammo_cost ?? 1}× \`${updated.weapon_ammo_item_name}\` por disparo` });
      }

      if (updated.weapon_area_damage) {
        const areaLines = ['✅ Afecta a toda la casilla del objetivo al impactar (otros jugadores + construcciones)'];
        if (updated.weapon_area_effect) {
          areaLines.push(
            `🎭 Aplica el estado \`${updated.weapon_area_effect}\` a todos los afectados` +
            (updated.weapon_area_effect_duration_hours ? ` (${updated.weapon_area_effect_duration_hours}h)` : ' (permanente)')
          );
        }
        embed.addFields({ name: '💥 Ataque de área', value: areaLines.join('\n') });
      }

      const itemThumb = buildAssetUrl(updated.image_filename, '/item-admin arma');
      if (itemThumb) embed.setThumbnail(itemThumb);

      return interaction.reply({ embeds: [embed] });
    }

    if (sub === 'vehiculo') {
      const itemName = interaction.options.getString('item', true).toLowerCase().trim();
      const categoria = interaction.options.getString('categoria', true);
      const velocidad = interaction.options.getNumber('velocidad') ?? 1;

      let updated;
      try {
        updated = await configureItemVehicle(itemName, categoria, velocidad);
      } catch (err) {
        return interaction.reply({ content: `❌ ${err.message}`, flags: MessageFlags.Ephemeral });
      }

      logger.info(`[/item-admin vehiculo] ${interaction.user.tag} configuró "${itemName}" como vehículo ${categoria} (×${velocidad})`);
      logAction({ source: 'discord', actorDiscordId: interaction.user.id, actorUsername: interaction.user.tag, action: 'item.configure_vehicle', target: itemName, details: { categoria, velocidad } });

      const embed = new EmbedBuilder()
        .setColor(COLORS.BLUE)
        .setTitle(`🚁 Vehículo configurado: ${updated.emoji ?? '🚁'} ${updated.display_name}`)
        .addFields(
          { name: 'Categoría de transporte', value: categoria, inline: true },
          { name: 'Velocidad de viaje', value: `×${velocidad}`, inline: true },
        )
        .setFooter({ text: `Configurado por ${interaction.user.tag}` })
        .setTimestamp();

      if (categoria === 'aereo') {
        embed.setDescription('Sobrevuela cualquier terreno — pero la casilla destino necesita una construcción marcada como aterrizaje (`/construction create|modify aterrizaje:true`).');
      }

      const itemThumb = buildAssetUrl(updated.image_filename, '/item-admin vehiculo');
      if (itemThumb) embed.setThumbnail(itemThumb);

      return interaction.reply({ embeds: [embed] });
    }

    if (sub === 'modify') {
      const itemName = interaction.options.getString('item', true).toLowerCase().trim();
      const existing = await getItemByName(itemName);
      if (!existing) {
        return interaction.reply({ content: `❌ No existe ningún ítem \`${itemName}\` en el catálogo.`, flags: MessageFlags.Ephemeral });
      }

      const efecto = interaction.options.getString('efecto');
      if (efecto && !(await getEffectType(efecto))) {
        return interaction.reply({ content: `❌ No existe ningún tipo de estado llamado \`${efecto}\`.`, flags: MessageFlags.Ephemeral });
      }

      const updates = {
        displayName:        interaction.options.getString('display')       ?? undefined,
        emoji:               interaction.options.getString('emoji')         ?? undefined,
        description:         interaction.options.getString('descripcion')   ?? undefined,
        isConsumable:        interaction.options.getBoolean('consumible')   ?? undefined,
        isFuel:               interaction.options.getBoolean('combustible') ?? undefined,
        consumeHpDelta:      interaction.options.getNumber('hp_delta')      ?? undefined,
        consumeHungerDelta:  interaction.options.getNumber('hunger_delta')  ?? undefined,
        consumeEffect:       efecto ?? undefined,
        weight:              interaction.options.getNumber('peso') ?? undefined,
        healRange:           interaction.options.getInteger('alcance_curacion') ?? undefined,
        mountHpBonus:        interaction.options.getNumber('montura_vida') ?? undefined,
        mountDamageBonus:    interaction.options.getNumber('montura_dano') ?? undefined,
      };
      const changedFields = Object.keys(updates).filter(k => updates[k] !== undefined);

      if (changedFields.length === 0) {
        return interaction.reply({ content: '❌ Debes especificar al menos un campo para editar.', flags: MessageFlags.Ephemeral });
      }

      const updated = await updateItemInCatalog(itemName, updates);

      logger.info(`[/item-admin modify] ${interaction.user.tag} editó "${itemName}": ${changedFields.join(', ')}`);
      logAction({ source: 'discord', actorDiscordId: interaction.user.id, actorUsername: interaction.user.tag, action: 'item.update', target: itemName, details: { changedFields } });

      const embed = new EmbedBuilder()
        .setColor(COLORS.BLUE)
        .setTitle(`✏️ Ítem actualizado: ${updated.emoji ?? '📦'} ${updated.display_name}`)
        .setFooter({ text: `Editado por ${interaction.user.tag}` })
        .setTimestamp();

      const itemThumb = buildAssetUrl(updated.image_filename, '/item-admin modify');
      if (itemThumb) embed.setThumbnail(itemThumb);

      return interaction.reply({ embeds: [embed] });
    }

    if (sub === 'receta') {
      const itemName = interaction.options.getString('item', true).toLowerCase().trim();
      const existing = await getItemByName(itemName);
      if (!existing) {
        return interaction.reply({ content: `❌ No existe ningún ítem \`${itemName}\` en el catálogo.`, flags: MessageFlags.Ephemeral });
      }

      const ingredientesRaw = interaction.options.getString('ingredientes') ?? null;
      const laboroCost      = interaction.options.getNumber('laburo_coste') ?? 0;
      const construccion    = interaction.options.getString('construccion')?.toLowerCase().trim() || null;
      const periodico       = interaction.options.getBoolean('periodico');
      const herramientaReduccion = interaction.options.getString('herramienta_reduccion')?.toLowerCase().trim() || null;
      const reduccionLaburo      = interaction.options.getNumber('reduccion_laburo') ?? null;

      if (construccion && !(await getConstructionTypeByName(construccion))) {
        return interaction.reply({ content: `❌ No existe ningún tipo de construcción llamado \`${construccion}\`. Usa \`/construction list\`.`, flags: MessageFlags.Ephemeral });
      }

      let toolItem = null;
      if (herramientaReduccion) {
        if (herramientaReduccion === 'laburo') {
          return interaction.reply({ content: '❌ El Laburo no puede ser la herramienta que abarata el Laburo — usa un ítem normal.', flags: MessageFlags.Ephemeral });
        }
        toolItem = await getItemByName(herramientaReduccion);
        if (!toolItem) {
          return interaction.reply({ content: `❌ El ítem \`${herramientaReduccion}\` (herramienta) no existe en el catálogo.`, flags: MessageFlags.Ephemeral });
        }
        if (reduccionLaburo === null) {
          return interaction.reply({
            content: '❌ `herramienta_reduccion` exige especificar también `reduccion_laburo` en esta misma llamada — sin eso nunca se descontaría nada.',
            flags: MessageFlags.Ephemeral,
          });
        }
      }

      if (periodico === true && !construccion) {
        return interaction.reply({
          content: '❌ `periodico:true` requiere especificar también `construccion` en esta misma llamada (la Imprenta u otra que definas) — sin eso, cualquiera podría craftearlo desde cualquier sitio.',
          flags: MessageFlags.Ephemeral,
        });
      }

      let ingredients = [];
      if (ingredientesRaw) {
        try {
          ingredients = parseIngredients(ingredientesRaw);
        } catch (err) {
          return interaction.reply({ content: `❌ Error en ingredientes: ${err.message}`, flags: MessageFlags.Ephemeral });
        }
      }

      const hasRecipe = ingredients.length > 0 || laboroCost > 0 || Boolean(construccion);
      if (!hasRecipe) {
        return interaction.reply({
          content: '❌ No especificaste ni ingredientes, ni coste de Laburo, ni construcción — no hay ninguna receta que añadir.',
          flags: MessageFlags.Ephemeral,
        });
      }

      const recipesBefore = await getRecipesForItem(existing.id);

      let newRecipeId;
      try {
        newRecipeId = await addRecipe(existing.id, {
          resultQty: 1, laboroCost, constructionType: construccion, ingredients,
          toolItemId: toolItem?.id ?? null, toolLaburoReduction: reduccionLaburo,
        });
      } catch (err) {
        return interaction.reply({ content: `❌ ${err.message}`, flags: MessageFlags.Ephemeral });
      }

      if (periodico !== null) {
        await updateItemInCatalog(itemName, { triggersNewspaperChannel: periodico });
      }

      const totalRecipes = recipesBefore.length + 1;
      logger.info(`[/item-admin receta] ${interaction.user.tag} añadió la receta #${newRecipeId} de "${itemName}" (ahora tiene ${totalRecipes})`);
      logAction({ source: 'discord', actorDiscordId: interaction.user.id, actorUsername: interaction.user.tag, action: 'item.add_recipe', target: itemName, details: { recipeId: newRecipeId } });

      const recipeLines = ingredients.map(ing => `\`${ing.name}\` ×${ing.quantity}`);
      if (laboroCost > 0) recipeLines.push(`💪 Laburo ×${laboroCost}`);
      if (construccion) recipeLines.push(`🏭 Requiere: ${construccion}`);
      if (periodico) recipeLines.push(`🗞️ Craftearlo crea un canal-periódico para el jugador`);
      if (toolItem) recipeLines.push(`🔧 Con ${toolItem.emoji ?? '📦'} ${toolItem.display_name}: -${reduccionLaburo} Laburo`);

      const embed = new EmbedBuilder()
        .setColor(COLORS.PURPLE)
        .setTitle(`⚒️ Receta #${totalRecipes} añadida: ${existing.emoji ?? '📦'} ${existing.display_name}`)
        .addFields({ name: 'Ingredientes/coste', value: recipeLines.join('\n') })
        .setFooter({ text: `Añadida por ${interaction.user.tag}` })
        .setTimestamp();

      if (recipesBefore.length > 0) {
        embed.setDescription(
          `**${existing.display_name}** ahora tiene **${totalRecipes} recetas** distintas. ` +
          `Si en \`/craft\` el jugador puede permitirse más de una, elegirá con un selector. ` +
          `Usa \`/item-admin recetas item:${itemName}\` para ver todas.`
        );
      }

      return interaction.reply({ embeds: [embed] });
    }

    if (sub === 'recetas') {
      const itemName = interaction.options.getString('item', true).toLowerCase().trim();
      const existing = await getItemByName(itemName);
      if (!existing) {
        return interaction.reply({ content: `❌ No existe ningún ítem \`${itemName}\` en el catálogo.`, flags: MessageFlags.Ephemeral });
      }

      const recipes = await getRecipesForItem(existing.id);
      if (recipes.length === 0) {
        return interaction.reply({
          content: `❌ **${existing.display_name}** no tiene ninguna receta de crafteo configurada. Usa \`/item-admin receta\` para añadirle una.`,
          flags: MessageFlags.Ephemeral,
        });
      }

      const embed = new EmbedBuilder()
        .setColor(COLORS.PURPLE)
        .setTitle(`⚒️ Recetas de ${existing.emoji ?? '📦'} ${existing.display_name}`)
        .setTimestamp();

      recipes.forEach((recipe, idx) => {
        const lines = recipe.ingredients.map(ing => `\`${ing.name}\` ×${ing.quantity_required}`);
        if (recipe.laburo_cost > 0) lines.push(`💪 Laburo ×${recipe.laburo_cost}`);
        if (recipe.required_construction_type) lines.push(`🏭 Requiere: ${recipe.required_construction_type}`);
        if (recipe.tool) {
          lines.push(`🔧 Con ${recipe.tool.emoji ?? '📦'} ${recipe.tool.display_name}: -${recipe.tool_laburo_reduction} Laburo`);
        }
        if (lines.length === 0) lines.push('*(sin ingredientes ni coste)*');

        embed.addFields({ name: `#${idx + 1} — receta ${recipe.id}`, value: lines.join('\n') });
      });

      if (recipes.length > 1) {
        embed.setDescription(`Usa el número (#1, #2...) como \`indice\` en \`/item-admin quitar-receta\` si quieres borrar una en concreto.`);
      }

      return interaction.reply({ embeds: [embed] });
    }

    if (sub === 'quitar-receta') {
      const itemName = interaction.options.getString('item', true).toLowerCase().trim();
      const existing = await getItemByName(itemName);
      if (!existing) {
        return interaction.reply({ content: `❌ No existe ningún ítem \`${itemName}\` en el catálogo.`, flags: MessageFlags.Ephemeral });
      }

      const recipes = await getRecipesForItem(existing.id);
      if (recipes.length === 0) {
        return interaction.reply({
          content: `❌ **${existing.display_name}** no tiene ninguna receta de crafteo configurada — no hay nada que quitar.`,
          flags: MessageFlags.Ephemeral,
        });
      }

      const indice = interaction.options.getInteger('indice');

      let recipe;
      if (recipes.length === 1) {
        recipe = recipes[0];
      } else if (indice === null) {
        return interaction.reply({
          content:
            `❌ **${existing.display_name}** tiene **${recipes.length} recetas** — especifica cuál con \`indice\`.\n` +
            `Usa \`/item-admin recetas item:${itemName}\` para verlas numeradas.`,
          flags: MessageFlags.Ephemeral,
        });
      } else if (indice < 1 || indice > recipes.length) {
        return interaction.reply({
          content: `❌ Índice fuera de rango — **${existing.display_name}** tiene ${recipes.length} receta(s) (1-${recipes.length}).`,
          flags: MessageFlags.Ephemeral,
        });
      } else {
        recipe = recipes[indice - 1];
      }

      await removeRecipe(recipe.id);
      const remaining = recipes.length - 1;
      logger.info(`[/item-admin quitar-receta] ${interaction.user.tag} quitó la receta #${recipe.id} de "${itemName}" (quedan ${remaining})`);
      logAction({ source: 'discord', actorDiscordId: interaction.user.id, actorUsername: interaction.user.tag, action: 'item.remove_recipe', target: itemName, details: { recipeId: recipe.id } });

      return interaction.reply({
        embeds: [
          new EmbedBuilder()
            .setColor(COLORS.RED)
            .setTitle(`🗑️ Receta quitada: ${existing.emoji ?? '📦'} ${existing.display_name}`)
            .setDescription(
              remaining > 0
                ? `Quitada — **${existing.display_name}** todavía tiene **${remaining}** receta(s) más, sigue siendo crafteable con \`/craft\`.`
                : `**${existing.display_name}** ya no se puede craftear con \`/craft\` — el ítem en sí sigue existiendo en el catálogo. Usa \`/item-admin receta\` si quieres darle otra receta más adelante.`
            )
            .setFooter({ text: `Quitada por ${interaction.user.tag}` })
            .setTimestamp(),
        ],
      });
    }

    if (sub === 'delete') {
      const itemName = interaction.options.getString('item', true).toLowerCase().trim();
      const existing = await getItemByName(itemName);
      if (!existing) {
        return interaction.reply({ content: `❌ No existe ningún ítem \`${itemName}\` en el catálogo.`, flags: MessageFlags.Ephemeral });
      }

      try {
        await deleteItemFromCatalog(itemName);
      } catch (err) {
        return interaction.reply({ content: `❌ ${err.message}`, flags: MessageFlags.Ephemeral });
      }

      logger.info(`[/item-admin delete] ${interaction.user.tag} eliminó "${itemName}" del catálogo`);
      logAction({ source: 'discord', actorDiscordId: interaction.user.id, actorUsername: interaction.user.tag, action: 'item.delete', target: itemName });

      return interaction.reply({
        embeds: [
          new EmbedBuilder()
            .setColor(COLORS.RED)
            .setTitle(`🗑️ Ítem eliminado del catálogo: ${existing.emoji ?? '📦'} ${existing.display_name}`)
            .setFooter({ text: `Eliminado por ${interaction.user.tag}` })
            .setTimestamp(),
        ],
      });
    }

    if (sub === 'setimage') {
      const itemName   = interaction.options.getString('item', true).toLowerCase().trim();
      const attachment = interaction.options.getAttachment('imagen', true);

      const item = await getItemByName(itemName);
      if (!item) {
        return interaction.reply({
          content: `❌ El ítem \`${itemName}\` no existe en el catálogo. Créalo primero con \`/item-admin create\`.`,
          flags: MessageFlags.Ephemeral,
        });
      }

      const validation = validateImageAttachment(attachment);
      if (!validation.ok) {
        return interaction.reply({ content: `❌ ${validation.error}`, flags: MessageFlags.Ephemeral });
      }

      await interaction.deferReply();

      let relativeFilename;
      try {
        const { filename } = await downloadAndSaveImage(attachment, validation.ext, ITEMS_WRITE_PATH, `item_${itemName}`);
        relativeFilename = `items/${filename}`;
      } catch (err) {
        return interaction.editReply({ content: `❌ Error al guardar la imagen: ${err.message}` });
      }

      await setItemImage(itemName, relativeFilename);
      logger.info(`[/item-admin setimage] ${interaction.user.tag} → imagen de "${itemName}" actualizada`);
      logAction({ source: 'discord', actorDiscordId: interaction.user.id, actorUsername: interaction.user.tag, action: 'item.set_image', target: itemName });

      const embed = new EmbedBuilder()
        .setColor(COLORS.PURPLE)
        .setTitle(`✅ Imagen actualizada: ${item.emoji ?? '📦'} ${item.display_name}`)
        .setDescription('Se mostrará como miniatura en confirmaciones de este ítem. No cambia cómo se ve en `/item list`.')
        .setFooter({ text: `Actualizado por ${interaction.user.tag}` })
        .setTimestamp();

      const itemThumb = buildAssetUrl(relativeFilename, '/item-admin setimage');
      if (itemThumb) embed.setThumbnail(itemThumb);

      return interaction.editReply({ embeds: [embed] });
    }
  },
};
