import { SlashCommandBuilder, EmbedBuilder, MessageFlags } from 'discord.js';
import { getPlayerByDiscordId } from '../../services/playerService.js';
import { getNpcsAtTile } from '../../services/npcService.js';
import { getNpcInventory } from '../../services/npcInventoryService.js';
import { executeNpcTrade } from '../../services/npcTradeService.js';
import { getItemByName } from '../../services/itemService.js';
import { requireCharacter } from '../../utils/permissions.js';
import { handleInventoryItemAutocomplete } from '../../utils/autocomplete.js';
import { COLORS } from '../../utils/embeds.js';
import { buildAssetUrl } from '../../utils/publicUrl.js';
import { logAction } from '../../services/auditLogService.js';
import logger from '../../utils/logger.js';

async function resolveTileNpc(interaction, player, npcId) {
  const npcsHere = await getNpcsAtTile(player.coord_x, player.coord_y);
  if (npcsHere.length === 0) return { error: '❌ No hay ningún NPC en tu casilla.' };

  if (npcsHere.length === 1) return { npc: npcsHere[0] };
  if (npcId) {
    const npc = npcsHere.find(n => n.id === npcId);
    return npc
      ? { npc }
      : { error: `❌ Ninguno de los NPCs de tu casilla tiene id ${npcId}. IDs disponibles: ${npcsHere.map(n => `${n.id} (${n.type_display_name})`).join(', ')}.` };
  }
  return { error: `❌ Hay ${npcsHere.length} NPCs en tu casilla — indica \`npc_id\` para elegir con cuál comerciar. IDs: ${npcsHere.map(n => `${n.id} (${n.type_display_name})`).join(', ')}.` };
}

export default {
  data: new SlashCommandBuilder()
    .setName('comerciar')
    .setDescription('Ofrece un trueque a un NPC amistoso de tu casilla')
    .addStringOption(opt => opt.setName('dar').setDescription('Ítem de tu inventario que ofreces').setRequired(true).setAutocomplete(true))
    .addIntegerOption(opt => opt.setName('dar_cantidad').setDescription('Cuánto ofreces').setRequired(true).setMinValue(1))
    .addStringOption(opt => opt.setName('pedir').setDescription('Ítem que quieres a cambio, del stock del NPC').setRequired(true).setAutocomplete(true))
    .addIntegerOption(opt => opt.setName('pedir_cantidad').setDescription('Cuánto pides').setRequired(true).setMinValue(1))
    .addIntegerOption(opt =>
      opt
        .setName('npc_id')
        .setDescription('Cuál, si hay varios NPCs en tu casilla (te lo dirá si hace falta)')
        .setRequired(false)
        .setMinValue(1)
    ),

  async autocomplete(interaction) {
    const focused = interaction.options.getFocused(true);
    if (focused.name === 'dar') return handleInventoryItemAutocomplete(interaction);

    const player = await getPlayerByDiscordId(interaction.user.id);
    if (!player) return interaction.respond([]).catch(() => {});
    const npcId = interaction.options.getInteger('npc_id');
    const { npc } = await resolveTileNpc(interaction, player, npcId);
    if (!npc) return interaction.respond([]).catch(() => {});

    const needle = focused.value.toLowerCase().trim();
    const stock = await getNpcInventory(npc.id);
    const choices = stock
      .filter(row => row.name.toLowerCase().includes(needle) || row.display_name.toLowerCase().includes(needle))
      .slice(0, 25)
      .map(row => ({ name: `${row.emoji ?? '📦'} ${row.display_name} ×${row.quantity}`.slice(0, 100), value: row.name }));
    return interaction.respond(choices).catch(() => {});
  },

  async execute(interaction) {
    if (!await requireCharacter(interaction)) return;

    const player = await getPlayerByDiscordId(interaction.user.id);
    const npcId = interaction.options.getInteger('npc_id');
    const giveName = interaction.options.getString('dar', true).toLowerCase().trim();
    const giveQty = interaction.options.getInteger('dar_cantidad', true);
    const getName = interaction.options.getString('pedir', true).toLowerCase().trim();
    const getQty = interaction.options.getInteger('pedir_cantidad', true);

    const { npc, error } = await resolveTileNpc(interaction, player, npcId);
    if (error) return interaction.reply({ content: error, flags: MessageFlags.Ephemeral });

    if (npc.is_aggressive) {
      return interaction.reply({
        content: `❌ **${npc.type_display_name}** es hostil — no comercia, solo puedes atacarlo con \`/attack\`.`,
        flags: MessageFlags.Ephemeral,
      });
    }

    const giveItem = await getItemByName(giveName);
    if (!giveItem) {
      return interaction.reply({ content: `❌ No existe ningún ítem llamado \`${giveName}\`.`, flags: MessageFlags.Ephemeral });
    }
    const getItem = await getItemByName(getName);
    if (!getItem) {
      return interaction.reply({ content: `❌ No existe ningún ítem llamado \`${getName}\`.`, flags: MessageFlags.Ephemeral });
    }

    const playerName = player.character_name ?? player.username;

    let verdict;
    try {
      verdict = await executeNpcTrade(interaction.user.id, npc, giveItem, giveQty, getItem, getQty);
    } catch (err) {
      logger.info(`[/comerciar] ${interaction.user.tag} propuso a "${npc.type_display_name}" #${npc.id}: ${giveQty}×${giveItem.name} por ${getQty}×${getItem.name} → RECHAZADO (${err.message})`);
      return interaction.reply({
        content: `❌ **${npc.type_display_name}** rechaza el trato: ${err.message}`,
        flags: MessageFlags.Ephemeral,
      });
    }

    logger.info(`[/comerciar] ${interaction.user.tag} ↔ "${npc.type_display_name}" #${npc.id}: ${giveQty}×${giveItem.name} por ${getQty}×${getItem.name} → ACEPTADO`);
    logAction({
      source: 'discord', actorDiscordId: interaction.user.id, actorUsername: interaction.user.tag,
      action: 'npc.trade', target: `(${npc.coord_x},${npc.coord_y})`,
      details: { npcId: npc.id, npcType: npc.type_display_name, gave: { item: giveItem.name, qty: giveQty }, got: { item: getItem.name, qty: getQty } },
    });

    const embed = new EmbedBuilder()
      .setColor(COLORS.GREEN)
      .setTitle('🤝 Trueque aceptado')
      .setDescription(
        `**${playerName}** le da a **${npc.type_display_name}** ${giveItem.emoji ?? '📦'} **${giveItem.display_name}** ×${giveQty}, ` +
        `y recibe a cambio ${getItem.emoji ?? '📦'} **${getItem.display_name}** ×${getQty}.`
      )
      .addFields({ name: '⚖️ Valoración', value: `Ofrecido: ${verdict.offeredValue} · Pedido: ${verdict.requestedValue}`, inline: true })
      .setTimestamp();
    const npcThumb = buildAssetUrl(npc.image_filename, '/comerciar');
    if (npcThumb) embed.setThumbnail(npcThumb);

    return interaction.reply({ embeds: [embed] });
  },
};
