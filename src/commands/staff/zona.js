import { SlashCommandBuilder, EmbedBuilder, MessageFlags } from 'discord.js';
import {
  listZones, createZone, updateZone, deleteZone, getZoneResources, assignRange, unassignRange,
} from '../../services/zoneService.js';
import { requireRolepriest } from '../../utils/permissions.js';
import { COLORS } from '../../utils/embeds.js';
import { handleZoneAutocomplete } from '../../utils/autocomplete.js';
import { formatTemperature, TEMP_ABSOLUTE_MIN, TEMP_ABSOLUTE_MAX } from '../../utils/temperature.js';
import logger from '../../utils/logger.js';
import { logAction } from '../../services/auditLogService.js';

function rangeOptions(sub) {
  return sub
    .addIntegerOption(opt => opt.setName('x1').setDescription('Coordenada X de una esquina').setRequired(true))
    .addIntegerOption(opt => opt.setName('y1').setDescription('Coordenada Y de esa esquina').setRequired(true))
    .addIntegerOption(opt => opt.setName('x2').setDescription('Coordenada X de la esquina opuesta').setRequired(true))
    .addIntegerOption(opt => opt.setName('y2').setDescription('Coordenada Y de la esquina opuesta').setRequired(true));
}

export default {
  data: new SlashCommandBuilder()
    .setName('zona')
    .setDescription('Gestiona las zonas del mapa (recursos y fauna por área)')

    .addSubcommand(sub =>
      sub
        .setName('crear')
        .setDescription('[Rolepriest] Crea una zona nueva')
        .addStringOption(opt => opt.setName('nombre').setDescription('Nombre clave único (ej: pantano_norte)').setRequired(true))
        .addStringOption(opt => opt.setName('display').setDescription('Nombre para mostrar (ej: Pantano del Norte)').setRequired(true))
        .addStringOption(opt => opt.setName('color').setDescription('Color hex del contorno en el mapa (ej: #5CC0B0)').setRequired(false))
        .addStringOption(opt => opt.setName('emoji').setDescription('Emoji (ej: 🧭)').setRequired(false))
        .addStringOption(opt => opt.setName('descripcion').setDescription('Descripción corta').setRequired(false))
        .addNumberOption(opt => opt.setName('temp_min').setDescription('Temperatura mínima de la zona en °C').setRequired(false).setMinValue(TEMP_ABSOLUTE_MIN).setMaxValue(TEMP_ABSOLUTE_MAX))
        .addNumberOption(opt => opt.setName('temp_max').setDescription('Temperatura máxima de la zona en °C').setRequired(false).setMinValue(TEMP_ABSOLUTE_MIN).setMaxValue(TEMP_ABSOLUTE_MAX))
    )

    .addSubcommand(sub =>
      sub
        .setName('editar')
        .setDescription('[Rolepriest] Edita una zona existente')
        .addStringOption(opt => opt.setName('nombre').setDescription('Zona a editar').setRequired(true).setAutocomplete(true))
        .addStringOption(opt => opt.setName('display').setDescription('Nuevo nombre para mostrar').setRequired(false))
        .addStringOption(opt => opt.setName('color').setDescription('Nuevo color hex').setRequired(false))
        .addStringOption(opt => opt.setName('emoji').setDescription('Nuevo emoji').setRequired(false))
        .addStringOption(opt => opt.setName('descripcion').setDescription('Nueva descripción').setRequired(false))
        .addNumberOption(opt => opt.setName('temp_min').setDescription('Nueva temperatura mínima en °C').setRequired(false).setMinValue(TEMP_ABSOLUTE_MIN).setMaxValue(TEMP_ABSOLUTE_MAX))
        .addNumberOption(opt => opt.setName('temp_max').setDescription('Nueva temperatura máxima en °C').setRequired(false).setMinValue(TEMP_ABSOLUTE_MIN).setMaxValue(TEMP_ABSOLUTE_MAX))
    )

    .addSubcommand(sub =>
      sub
        .setName('borrar')
        .setDescription('[Rolepriest] Elimina una zona sin casillas asignadas')
        .addStringOption(opt => opt.setName('nombre').setDescription('Zona a eliminar').setRequired(true).setAutocomplete(true))
    )

    .addSubcommand(sub =>
      sub.setName('listar').setDescription('Lista las zonas del mapa y lo que aporta cada una')
    )

    .addSubcommand(sub =>
      rangeOptions(
        sub
          .setName('asignar')
          .setDescription('[Rolepriest] Asigna una zona a un rectángulo de casillas')
          .addStringOption(opt => opt.setName('zona').setDescription('Zona a asignar').setRequired(true).setAutocomplete(true))
      )
    )

    .addSubcommand(sub =>
      rangeOptions(
        sub
          .setName('desasignar')
          .setDescription('[Rolepriest] Quita la zona de un rectángulo de casillas')
      )
    ),

  async autocomplete(interaction) {
    return handleZoneAutocomplete(interaction);
  },

  async execute(interaction) {
    const sub = interaction.options.getSubcommand();

    if (sub === 'listar') {
      const zones = await listZones();
      const embed = new EmbedBuilder()
        .setColor(COLORS.BLUE)
        .setTitle('🧭 Zonas del mapa')
        .setTimestamp();

      if (zones.length === 0) {
        embed.setDescription('Todavía no hay ninguna zona. Créala con `/zona crear` y píntala con `/zona asignar`.');
      } else {
        for (const z of zones) {
          const lines = [
            `🗺️ Casillas: **${z.tile_count}**`,
            `🎨 Color: \`${z.color}\``,
            `🌡️ Temperatura: **${formatTemperature(z.temp_min)}** a **${formatTemperature(z.temp_max)}**`,
          ];
          if (z.description) lines.push(z.description);
          const resources = await getZoneResources(z.id);
          if (resources.length > 0) {
            lines.push(`⛏️ Recursos propios: ${resources.map(r => `${r.emoji ?? '📦'} ${r.display_name} (${r.drop_chance_percent}%)`).join(', ')}`);
          }
          embed.addFields({ name: `${z.emoji} ${z.display_name} (\`${z.name}\`)`, value: lines.join('\n') });
        }
      }

      return interaction.reply({ embeds: [embed] });
    }

    if (!await requireRolepriest(interaction)) return;

    if (sub === 'crear') {
      const nombre = interaction.options.getString('nombre', true).toLowerCase().trim();
      const display = interaction.options.getString('display', true).trim();
      const color = interaction.options.getString('color')?.trim() ?? '#5CC0B0';
      const emoji = interaction.options.getString('emoji') ?? '🧭';
      const descripcion = interaction.options.getString('descripcion') ?? '';
      const tempMin = interaction.options.getNumber('temp_min') ?? undefined;
      const tempMax = interaction.options.getNumber('temp_max') ?? undefined;

      if (!/^[a-z0-9_-]+$/.test(nombre)) {
        return interaction.reply({
          content: '❌ El nombre solo puede contener minúsculas, números, guiones y guiones bajos.',
          flags: MessageFlags.Ephemeral,
        });
      }

      let created;
      try {
        created = await createZone({ name: nombre, displayName: display, emoji, color, description: descripcion, tempMin, tempMax });
      } catch (err) {
        return interaction.reply({ content: `❌ ${err.message}`, flags: MessageFlags.Ephemeral });
      }

      logger.info(`[/zona crear] ${interaction.user.tag} creó la zona "${nombre}"`);
      logAction({ source: 'discord', actorDiscordId: interaction.user.id, actorUsername: interaction.user.tag, action: 'zona.create', target: nombre });

      return interaction.reply({
        embeds: [new EmbedBuilder()
          .setColor(parseInt(color.replace('#', ''), 16) || COLORS.BLUE)
          .setTitle(`${created.emoji} Zona creada: ${created.display_name}`)
          .setDescription(
            `Clima: de **${formatTemperature(created.temp_min)}** a **${formatTemperature(created.temp_max)}**.\n` +
            'Aún no cubre ninguna casilla — asígnale un rectángulo con `/zona asignar`, y dale recursos propios desde el panel web.'
          )
          .setTimestamp()],
      });
    }

    if (sub === 'editar') {
      const nombre = interaction.options.getString('nombre', true).toLowerCase().trim();
      const updates = {};
      const display = interaction.options.getString('display');
      const color = interaction.options.getString('color');
      const emoji = interaction.options.getString('emoji');
      const descripcion = interaction.options.getString('descripcion');
      const tempMin = interaction.options.getNumber('temp_min');
      const tempMax = interaction.options.getNumber('temp_max');
      if (display !== null) updates.displayName = display.trim();
      if (color !== null) updates.color = color.trim();
      if (emoji !== null) updates.emoji = emoji;
      if (descripcion !== null) updates.description = descripcion;
      if (tempMin !== null) updates.tempMin = tempMin;
      if (tempMax !== null) updates.tempMax = tempMax;

      let updated;
      try {
        updated = await updateZone(nombre, updates);
      } catch (err) {
        return interaction.reply({ content: `❌ ${err.message}`, flags: MessageFlags.Ephemeral });
      }

      logger.info(`[/zona editar] ${interaction.user.tag} editó la zona "${nombre}"`);
      logAction({ source: 'discord', actorDiscordId: interaction.user.id, actorUsername: interaction.user.tag, action: 'zona.update', target: nombre, details: updates });

      return interaction.reply({
        embeds: [new EmbedBuilder()
          .setColor(COLORS.GREEN)
          .setTitle(`${updated.emoji} Zona actualizada: ${updated.display_name}`)
          .setDescription(`Clima: de **${formatTemperature(updated.temp_min)}** a **${formatTemperature(updated.temp_max)}**.`)
          .setTimestamp()],
      });
    }

    if (sub === 'borrar') {
      const nombre = interaction.options.getString('nombre', true).toLowerCase().trim();

      let deleted;
      try {
        deleted = await deleteZone(nombre);
      } catch (err) {
        return interaction.reply({ content: `❌ ${err.message}`, flags: MessageFlags.Ephemeral });
      }

      logger.info(`[/zona borrar] ${interaction.user.tag} eliminó la zona "${nombre}"`);
      logAction({ source: 'discord', actorDiscordId: interaction.user.id, actorUsername: interaction.user.tag, action: 'zona.delete', target: nombre });

      return interaction.reply({ content: `🗑️ Zona **${deleted.display_name}** eliminada.` });
    }

    const x1 = interaction.options.getInteger('x1', true);
    const y1 = interaction.options.getInteger('y1', true);
    const x2 = interaction.options.getInteger('x2', true);
    const y2 = interaction.options.getInteger('y2', true);

    if (sub === 'asignar') {
      const zona = interaction.options.getString('zona', true).toLowerCase().trim();

      let result;
      try {
        result = await assignRange(zona, x1, y1, x2, y2);
      } catch (err) {
        return interaction.reply({ content: `❌ ${err.message}`, flags: MessageFlags.Ephemeral });
      }

      logger.info(`[/zona asignar] ${interaction.user.tag} asignó "${zona}" a ${result.tilesAffected} casilla(s)`);
      logAction({
        source: 'discord', actorDiscordId: interaction.user.id, actorUsername: interaction.user.tag,
        action: 'zona.assign_range', target: zona,
        details: { x1, y1, x2, y2, tilesAffected: result.tilesAffected },
      });

      return interaction.reply({
        content: `${result.zone.emoji} **${result.zone.display_name}** ahora cubre **${result.tilesAffected}** casilla(s) en (${result.minX},${result.minY})-(${result.maxX},${result.maxY}).`,
      });
    }

    let result;
    try {
      result = await unassignRange(x1, y1, x2, y2);
    } catch (err) {
      return interaction.reply({ content: `❌ ${err.message}`, flags: MessageFlags.Ephemeral });
    }

    logger.info(`[/zona desasignar] ${interaction.user.tag} quitó la zona de ${result.tilesAffected} casilla(s)`);
    logAction({
      source: 'discord', actorDiscordId: interaction.user.id, actorUsername: interaction.user.tag,
      action: 'zona.unassign_range', target: null,
      details: { x1, y1, x2, y2, tilesAffected: result.tilesAffected },
    });

    return interaction.reply({
      content: `🧭 Zona retirada de **${result.tilesAffected}** casilla(s) en (${result.minX},${result.minY})-(${result.maxX},${result.maxY}).`,
    });
  },
};
