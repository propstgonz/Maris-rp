import { SlashCommandBuilder, EmbedBuilder, MessageFlags } from 'discord.js';
import USAR from '../../subcommands/item/consume.js';

import { getPlayerByDiscordId } from '../../services/playerService.js';
import { revokeItem }           from '../../services/inventoryService.js';
import { dropItem, grabItem }   from '../../services/tileItemService.js';
import { listItems }            from '../../services/itemService.js';
import { requireCharacter }     from '../../utils/permissions.js';
import { COLORS }               from '../../utils/embeds.js';
import { handleInventoryItemAutocomplete, handleTileItemAutocomplete } from '../../utils/autocomplete.js';
import { logAction }            from '../../services/auditLogService.js';
import logger                   from '../../utils/logger.js';

const FIELD_VALUE_LIMIT = 1024;
const MAX_EMBED_FIELDS  = 25;

function chunkLines(lines, maxLen = FIELD_VALUE_LIMIT) {
  const chunks = [];
  let current = [];
  let currentLen = 0;

  for (const line of lines) {
    const lineLen = line.length + 1;
    if (current.length > 0 && currentLen + lineLen > maxLen) {
      chunks.push(current);
      current = [];
      currentLen = 0;
    }
    current.push(line);
    currentLen += lineLen;
  }
  if (current.length > 0) chunks.push(current);
  return chunks;
}

const ITEM_TYPE_META = {
  dinero:      { emoji: '💰', label: 'Dinero' },
  consumible:  { emoji: '🎒', label: 'Consumible' },
  recurso:     { emoji: '⛏️', label: 'Recurso' },
  herramienta: { emoji: '🔧', label: 'Herramienta' },
  laburo:      { emoji: '💪', label: 'Laburo' },
  arma:        { emoji: '🔫', label: 'Arma' },
  vehiculo:    { emoji: '🚁', label: 'Vehículo' },
};

export default {
  data: new SlashCommandBuilder()
    .setName('item')
    .setDescription('Consulta el catálogo, usa objetos, o gestiona lo que hay en tu casilla')

    .addSubcommand(USAR.build)

    .addSubcommand(sub =>
      sub
        .setName('list')
        .setDescription('Muestra el catálogo de ítems')
        .addStringOption(opt =>
          opt
            .setName('tipo')
            .setDescription('Filtra por tipo de ítem')
            .setRequired(false)
            .addChoices(...Object.entries(ITEM_TYPE_META).map(([value, meta]) => ({ name: meta.label, value })))
        )
        .addStringOption(opt =>
          opt.setName('buscar').setDescription('Filtra por texto en el nombre').setRequired(false)
        )
    )

    .addSubcommand(sub =>
      sub
        .setName('destroy')
        .setDescription('Descarta ítems de tu propio inventario')
        .addStringOption(opt => opt.setName('item').setDescription('Ítem a descartar').setRequired(true).setAutocomplete(true))
        .addNumberOption(opt => opt.setName('cantidad').setDescription('Cantidad').setRequired(true).setMinValue(0.01))
    )

    .addSubcommand(sub =>
      sub
        .setName('drop')
        .setDescription('Deja ítems en el suelo de tu casilla actual')
        .addStringOption(opt => opt.setName('item').setDescription('Ítem a tirar').setRequired(true).setAutocomplete(true))
        .addNumberOption(opt => opt.setName('cantidad').setDescription('Cantidad').setRequired(true).setMinValue(0.01))
    )

    .addSubcommand(sub =>
      sub
        .setName('grab')
        .setDescription('Recoge ítems del suelo de tu casilla actual')
        .addStringOption(opt => opt.setName('item').setDescription('Ítem a recoger').setRequired(true).setAutocomplete(true))
        .addNumberOption(opt => opt.setName('cantidad').setDescription('Cantidad (omite para recoger todo)').setRequired(false).setMinValue(0.01))
    ),

  async autocomplete(interaction) {
    if (interaction.options.getSubcommand() === 'grab') {
      return handleTileItemAutocomplete(interaction);
    }
    await handleInventoryItemAutocomplete(interaction);
  },

  async execute(interaction) {
    const sub = interaction.options.getSubcommand();

    if (sub === 'usar') return USAR.execute(interaction);

    if (sub === 'list') {
      const tipoFilter   = interaction.options.getString('tipo');
      const buscarFilter = interaction.options.getString('buscar')?.toLowerCase().trim();

      let items = await listItems();
      if (tipoFilter) items = items.filter(it => it.item_type === tipoFilter);
      if (buscarFilter) {
        items = items.filter(it =>
          it.display_name.toLowerCase().includes(buscarFilter) || it.name.toLowerCase().includes(buscarFilter)
        );
      }

      const embed = new EmbedBuilder().setColor(COLORS.DARK).setTitle('📖 Catálogo de ítems').setTimestamp();

      if (items.length === 0) {
        embed.setDescription(
          tipoFilter || buscarFilter ? '*Ningún ítem coincide con ese filtro.*' : '*El catálogo está vacío.*'
        );
        return interaction.reply({ embeds: [embed] });
      }

      const groups = new Map();
      for (const it of items) {
        if (!groups.has(it.item_type)) groups.set(it.item_type, []);
        groups.get(it.item_type).push(it);
      }

      const allFields = [];
      for (const [type, typeItems] of groups.entries()) {
        const meta  = ITEM_TYPE_META[type] ?? { emoji: '📦', label: type };
        const lines = typeItems.map(it => `${it.emoji ?? '📦'} **${it.display_name}** (\`${it.name}\`)`);
        const chunks = chunkLines(lines);

        chunks.forEach((chunk, i) => {
          allFields.push({
            name:  chunks.length > 1 ? `${meta.emoji} ${meta.label} (${i + 1}/${chunks.length})` : `${meta.emoji} ${meta.label}`,
            value: chunk.join('\n'),
          });
        });
      }

      const shown = allFields.slice(0, MAX_EMBED_FIELDS);
      embed.addFields(shown);

      const footerParts = [`${items.length} ítem${items.length !== 1 ? 's' : ''} en total`];
      if (allFields.length > MAX_EMBED_FIELDS) {
        footerParts.push(`⚠️ catálogo muy grande, no caben todos los grupos en un solo embed`);
      }
      embed.setFooter({ text: footerParts.join(' · ') });

      return interaction.reply({ embeds: [embed] });
    }

    if (!await requireCharacter(interaction)) return;

    if (sub === 'destroy') {
      const itemName = interaction.options.getString('item', true).toLowerCase().trim();
      const cantidad = interaction.options.getNumber('cantidad', true);

      let result;
      try {
        result = await revokeItem(interaction.user.id, itemName, cantidad);
      } catch (err) {
        return interaction.reply({ content: `❌ ${err.message}`, flags: MessageFlags.Ephemeral });
      }

      logger.info(`[/item destroy] ${interaction.user.tag} descartó x${cantidad} "${itemName}"`);

      return interaction.reply({
        content: `🗑️ Descartaste **${cantidad}** de **${result.item.display_name}**.`,
      });
    }

    if (sub === 'drop') {
      const itemName = interaction.options.getString('item', true).toLowerCase().trim();
      const cantidad = interaction.options.getNumber('cantidad', true);
      const player = await getPlayerByDiscordId(interaction.user.id);

      let result;
      try {
        result = await dropItem(interaction.user.id, player.coord_x, player.coord_y, itemName, cantidad);
      } catch (err) {
        return interaction.reply({ content: `❌ ${err.message}`, flags: MessageFlags.Ephemeral });
      }

      logger.info(`[/item drop] ${interaction.user.tag} tiró x${cantidad} "${itemName}" en (${player.coord_x},${player.coord_y})`);

      logAction({
        source: 'discord', actorDiscordId: interaction.user.id, actorUsername: interaction.user.tag,
        action: 'tile.item_drop', target: `(${player.coord_x},${player.coord_y})`,
        details: { itemName, quantity: cantidad },
      });

      return interaction.reply({
        content:
          `📦 Dejaste **${cantidad}** de **${result.item.display_name}** en el suelo ` +
          `**(X: ${player.coord_x}, Y: ${player.coord_y})** (total ahí: ${result.tileQuantity}).`,
      });
    }

    if (sub === 'grab') {
      const itemName = interaction.options.getString('item', true).toLowerCase().trim();
      const cantidad = interaction.options.getNumber('cantidad') ?? undefined;
      const player = await getPlayerByDiscordId(interaction.user.id);

      let result;
      try {
        result = await grabItem(interaction.user.id, player.coord_x, player.coord_y, itemName, cantidad);
      } catch (err) {
        return interaction.reply({ content: `❌ ${err.message}`, flags: MessageFlags.Ephemeral });
      }

      logger.info(`[/item grab] ${interaction.user.tag} recogió x${result.grabbed} "${itemName}" en (${player.coord_x},${player.coord_y})`);

      logAction({
        source: 'discord', actorDiscordId: interaction.user.id, actorUsername: interaction.user.tag,
        action: 'tile.item_grab', target: `(${player.coord_x},${player.coord_y})`,
        details: { itemName, quantity: result.grabbed },
      });

      return interaction.reply({
        content: `✋ Recogiste **${result.grabbed}** de **${result.item.display_name}** del suelo.`,
      });
    }
  },
};
