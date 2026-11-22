import { SlashCommandBuilder, EmbedBuilder, MessageFlags } from 'discord.js';
import { getPlayerByDiscordId } from '../../services/playerService.js';
import { getNpcsAtTile, setActiveMount, clearActiveMount, getActiveMount } from '../../services/npcService.js';
import { requireCharacter } from '../../utils/permissions.js';
import { COLORS } from '../../utils/embeds.js';
import { buildAssetUrl } from '../../utils/publicUrl.js';
import { logAction } from '../../services/auditLogService.js';
import logger from '../../utils/logger.js';

export default {
  data: new SlashCommandBuilder()
    .setName('montura')
    .setDescription('Gestiona cuál de tus animales domesticados llevas como montura')
    .addSubcommand(sub =>
      sub
        .setName('montar')
        .setDescription('Convierte en tu montura activa a un animal tuyo de tu casilla')
        .addIntegerOption(opt =>
          opt
            .setName('npc_id')
            .setDescription('Cuál, si tienes varios animales montables en tu casilla')
            .setRequired(false)
            .setMinValue(1)
        )
    )
    .addSubcommand(sub => sub.setName('desmontar').setDescription('Deja de llevar montura activa'))
    .addSubcommand(sub => sub.setName('estado').setDescription('Muestra tu montura activa, si llevas alguna')),

  async execute(interaction) {
    if (!await requireCharacter(interaction)) return;

    const sub = interaction.options.getSubcommand();
    const player = await getPlayerByDiscordId(interaction.user.id);

    if (sub === 'estado') {
      const mount = await getActiveMount(player.id);
      if (!mount) {
        return interaction.reply({ content: 'ℹ️ No llevas ninguna montura activa ahora mismo.', flags: MessageFlags.Ephemeral });
      }
      const embed = new EmbedBuilder()
        .setColor(COLORS.BLUE)
        .setTitle(`${mount.type_emoji ?? '🐾'} Tu montura: ${mount.type_display_name}`)
        .addFields(
          { name: '📍 Posición', value: `(${mount.coord_x}, ${mount.coord_y})`, inline: true },
          { name: '🚗 Categoría', value: mount.vehicle_category ?? '—', inline: true },
          { name: '⚡ Multiplicador', value: `×${mount.vehicle_speed_multiplier}`, inline: true }
        )
        .setTimestamp();
      const thumb = buildAssetUrl(mount.image_filename, '/montura');
      if (thumb) embed.setThumbnail(thumb);
      return interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
    }

    if (sub === 'desmontar') {
      await clearActiveMount(player.id);
      logAction({
        source: 'discord', actorDiscordId: interaction.user.id, actorUsername: interaction.user.tag,
        action: 'player.mount_dismount', target: interaction.user.id, details: null,
      });
      return interaction.reply({ content: '🐾 Desmontas — ya no llevas montura activa.', flags: MessageFlags.Ephemeral });
    }

    const npcId = interaction.options.getInteger('npc_id');
    const npcsHere = (await getNpcsAtTile(player.coord_x, player.coord_y))
      .filter(n => n.owner_player_id === player.id && n.vehicle_category != null);

    if (npcsHere.length === 0) {
      return interaction.reply({
        content: '❌ No tienes ningún animal montable en tu casilla — tiene que ser tuyo, domesticado, y capaz de servir de montura.',
        flags: MessageFlags.Ephemeral,
      });
    }

    let npc;
    if (npcsHere.length === 1) {
      npc = npcsHere[0];
    } else if (npcId) {
      npc = npcsHere.find(n => n.id === npcId);
      if (!npc) {
        return interaction.reply({
          content: `❌ Ninguno de tus animales montables de aquí tiene id ${npcId}. IDs disponibles: ${npcsHere.map(n => `${n.id} (${n.type_display_name})`).join(', ')}.`,
          flags: MessageFlags.Ephemeral,
        });
      }
    } else {
      return interaction.reply({
        content: `❌ Tienes ${npcsHere.length} animales montables aquí — indica \`npc_id\` para elegir cuál. IDs: ${npcsHere.map(n => `${n.id} (${n.type_display_name})`).join(', ')}.`,
        flags: MessageFlags.Ephemeral,
      });
    }

    if (!(await setActiveMount(npc.id, player.id))) {
      return interaction.reply({
        content: `❌ **${npc.type_display_name}** ya no es tuyo.`,
        flags: MessageFlags.Ephemeral,
      });
    }
    logger.info(`[/montura] ${interaction.user.tag} monta a "${npc.type_display_name}" #${npc.id}`);
    logAction({
      source: 'discord', actorDiscordId: interaction.user.id, actorUsername: interaction.user.tag,
      action: 'player.mount_ride', target: interaction.user.id,
      details: { npcId: npc.id, npcType: npc.type_display_name },
    });

    const embed = new EmbedBuilder()
      .setColor(COLORS.GREEN)
      .setTitle(`${npc.type_emoji ?? '🐾'} ¡A lomos de ${npc.type_display_name}!`)
      .setDescription(`Ahora viaja contigo casilla a casilla — cuenta como vehículo (×${npc.vehicle_speed_multiplier}, categoría **${npc.vehicle_category}**) mientras la lleves activa.`)
      .setTimestamp();
    const thumb = buildAssetUrl(npc.image_filename, '/montura');
    if (thumb) embed.setThumbnail(thumb);
    return interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
  },
};
