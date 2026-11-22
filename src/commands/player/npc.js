import { SlashCommandBuilder, EmbedBuilder, MessageFlags } from 'discord.js';
import {
  getOwnedNpcs, collectNpcProduction, withdrawNpcStorage, relocateNpc,
  setNpcRole, equipNpcTool, unequipNpcTool,
} from '../../services/npcRecruitService.js';
import { getPlayerByDiscordId } from '../../services/playerService.js';
import { requireCharacter } from '../../utils/permissions.js';
import { handleInventoryItemAutocomplete } from '../../utils/autocomplete.js';
import { COLORS } from '../../utils/embeds.js';
import logger from '../../utils/logger.js';

const ROLE_LABELS = { producer: 'Productor', soldier: 'Soldado' };

export default {
  data: new SlashCommandBuilder()
    .setName('npc')
    .setDescription('Gestiona los NPCs que has reclutado')

    .addSubcommand(sub => sub.setName('list').setDescription('Lista los NPCs que has reclutado'))

    .addSubcommand(sub =>
      sub
        .setName('rol')
        .setDescription('Fija si un NPC reclutado es productor o soldado')
        .addIntegerOption(opt => opt.setName('id').setDescription('ID del NPC (ver /npc list)').setRequired(true).setMinValue(1))
        .addStringOption(opt => opt.setName('rol').setDescription('Nuevo rol').setRequired(true)
          .addChoices({ name: 'Productor', value: 'producer' }, { name: 'Soldado', value: 'soldier' }))
    )

    .addSubcommand(sub =>
      sub
        .setName('equipar')
        .setDescription('Asigna una herramienta (de tu inventario) a un NPC reclutado')
        .addIntegerOption(opt => opt.setName('id').setDescription('ID del NPC (ver /npc list)').setRequired(true).setMinValue(1))
        .addStringOption(opt => opt.setName('item').setDescription('Ítem de tu inventario a asignar').setRequired(true).setAutocomplete(true))
    )

    .addSubcommand(sub =>
      sub
        .setName('desequipar')
        .setDescription('Quita la herramienta de un NPC reclutado — vuelve a tu inventario')
        .addIntegerOption(opt => opt.setName('id').setDescription('ID del NPC (ver /npc list)').setRequired(true).setMinValue(1))
    )

    .addSubcommand(sub =>
      sub
        .setName('recoger')
        .setDescription('Cobra la producción pendiente de un NPC reclutado')
        .addIntegerOption(opt => opt.setName('id').setDescription('ID del NPC (ver /npc list)').setRequired(true).setMinValue(1))
    )

    .addSubcommand(sub =>
      sub
        .setName('reubicar')
        .setDescription('Traslada un NPC reclutado a tu casilla actual')
        .addIntegerOption(opt => opt.setName('id').setDescription('ID del NPC (ver /npc list)').setRequired(true).setMinValue(1))
    ),

  async autocomplete(interaction) {
    await handleInventoryItemAutocomplete(interaction);
  },

  async execute(interaction) {
    if (!await requireCharacter(interaction)) return;
    const sub = interaction.options.getSubcommand();

    if (sub === 'list') {
      const player = await getPlayerByDiscordId(interaction.user.id);
      const npcs = await getOwnedNpcs(player.id);

      const embed = new EmbedBuilder().setColor(COLORS.DARK).setTitle('👤 Tus NPCs reclutados').setTimestamp();

      if (npcs.length === 0) {
        embed.setDescription('*Todavía no has reclutado ningún NPC — ver `/build reclutar` en una oficina de reclutamiento.*');
      } else {
        for (const n of npcs) {
          const role = n.role ? ROLE_LABELS[n.role] : '*sin rol — fija uno con /npc rol*';
          const tool = n.equipped_tool_item_id
            ? `${n.tool_emoji ?? '🔧'} ${n.tool_display_name}`
            : '*sin herramienta*';
          embed.addFields({
            name: `${n.type_emoji ?? '👤'} ${n.type_display_name} (\`#${n.id}\`)`,
            value: `📍 (${n.coord_x}, ${n.coord_y}) · Rol: ${role} · Herramienta: ${tool}`,
          });
        }
      }

      return interaction.reply({ embeds: [embed] });
    }

    if (sub === 'rol') {
      const npcId = interaction.options.getInteger('id', true);
      const rol = interaction.options.getString('rol', true);

      let npc;
      try {
        npc = await setNpcRole(interaction.user.id, npcId, rol);
      } catch (err) {
        return interaction.reply({ content: `❌ ${err.message}`, flags: MessageFlags.Ephemeral });
      }

      logger.info(`[/npc rol] ${interaction.user.tag} fijó el rol de NPC #${npcId} → ${rol}`);

      return interaction.reply({
        content: `✅ **${npc.type_display_name}** ahora es **${ROLE_LABELS[rol]}**.`,
      });
    }

    if (sub === 'equipar') {
      const npcId = interaction.options.getInteger('id', true);
      const item = interaction.options.getString('item', true).toLowerCase().trim();

      let npc;
      try {
        npc = await equipNpcTool(interaction.user.id, npcId, item);
      } catch (err) {
        return interaction.reply({ content: `❌ ${err.message}`, flags: MessageFlags.Ephemeral });
      }

      logger.info(`[/npc equipar] ${interaction.user.tag} equipó "${item}" a NPC #${npcId}`);

      return interaction.reply({
        content: `✅ **${npc.type_display_name}** ahora lleva **${item}** como herramienta.`,
      });
    }

    if (sub === 'desequipar') {
      const npcId = interaction.options.getInteger('id', true);

      let npc;
      try {
        npc = await unequipNpcTool(interaction.user.id, npcId);
      } catch (err) {
        return interaction.reply({ content: `❌ ${err.message}`, flags: MessageFlags.Ephemeral });
      }

      logger.info(`[/npc desequipar] ${interaction.user.tag} desequipó a NPC #${npcId}`);

      return interaction.reply({
        content: `✅ Herramienta devuelta a tu inventario — **${npc.type_display_name}** ya no lleva ninguna.`,
      });
    }

    if (sub === 'recoger') {
      const npcId = interaction.options.getInteger('id', true);

      let result;
      try {
        result = await collectNpcProduction(interaction.user.id, npcId);
      } catch (err) {
        return interaction.reply({ content: `❌ ${err.message}`, flags: MessageFlags.Ephemeral });
      }

      const { npc, settlement, storage } = result;

      const withdrawn = [];
      let stopped = null;
      for (const row of storage) {
        if (row.quantity <= 0) continue;
        try {
          await withdrawNpcStorage(interaction.user.id, npcId, row.name, row.quantity);
        } catch (err) {
          stopped = err.message;
          break;
        }
        withdrawn.push({ display_name: row.display_name, emoji: row.emoji, quantity: row.quantity });
      }

      logger.info(`[/npc recoger] ${interaction.user.tag} cobró NPC #${npcId} — ${settlement.cyclesRun} ciclo(s), ${settlement.produced} ${settlement.kind ?? 'nada'}`);

      const embed = new EmbedBuilder().setColor(COLORS.GREEN).setTitle(`✅ Producción cobrada: ${npc.type_display_name}`).setTimestamp();

      if (settlement.cyclesRun === 0 && withdrawn.length === 0 && !stopped) {
        embed.setDescription('Nada pendiente que cobrar todavía.');
      } else if (settlement.kind === 'laburo') {
        embed.setDescription(`💪 **+${settlement.produced}** Laburo.`);
      } else if (withdrawn.length > 0) {
        embed.setDescription(withdrawn.map(w => `${w.emoji ?? '📦'} **${w.display_name}** ×${w.quantity}`).join('\n'));
      }

      if (stopped) {
        embed.addFields({ name: '⚠️ El resto sigue en el almacén del NPC', value: stopped });
      }

      return interaction.reply({ embeds: [embed] });
    }

    if (sub === 'reubicar') {
      const npcId = interaction.options.getInteger('id', true);

      let npc;
      try {
        npc = await relocateNpc(interaction.user.id, npcId);
      } catch (err) {
        return interaction.reply({ content: `❌ ${err.message}`, flags: MessageFlags.Ephemeral });
      }

      logger.info(`[/npc reubicar] ${interaction.user.tag} reubicó NPC #${npcId} a (${npc.coord_x},${npc.coord_y})`);

      return interaction.reply({
        content: `✅ **${npc.type_display_name}** se ha trasladado a **(${npc.coord_x}, ${npc.coord_y})**.`,
      });
    }
  },
};
