import { SlashCommandBuilder, EmbedBuilder, MessageFlags } from 'discord.js';
import {
  listTerrainTypes,
  createTerrainType,
  updateTerrainType,
  deleteTerrainType,
  getResources,
} from '../../services/terrainTypeService.js';
import { requireRolepriest } from '../../utils/permissions.js';
import { COLORS }           from '../../utils/embeds.js';
import { handleTerrainTypeAutocomplete } from '../../utils/autocomplete.js';
import logger                from '../../utils/logger.js';
import { logAction }          from '../../services/auditLogService.js';

const VEHICLE_CATEGORY_CHOICES = [
  { name: '✈️ Aéreo',     value: 'aereo'     },
  { name: '🚤 Marítimo',  value: 'maritimo'  },
  { name: '🚙 Terrestre', value: 'terrestre' },
];

export default {
  data: new SlashCommandBuilder()
    .setName('terrain')
    .setDescription('Gestiona el catálogo de tipos de terreno')

    .addSubcommand(sub =>
      sub
        .setName('create')
        .setDescription('[Rolepriest] Crea un nuevo tipo de terreno en el catálogo')
        .addStringOption(opt => opt.setName('nombre').setDescription('Nombre clave único (ej: mar_profundo)').setRequired(true))
        .addStringOption(opt => opt.setName('display').setDescription('Nombre para mostrar (ej: Mar Profundo)').setRequired(true))
        .addStringOption(opt => opt.setName('color').setDescription('Color hex para el mapa/embeds (ej: #1B4F72)').setRequired(true))
        .addStringOption(opt => opt.setName('emoji').setDescription('Emoji (ej: 🌊)').setRequired(false))
        .addStringOption(opt =>
          opt.setName('vehiculo_categoria').setDescription('¿Exige un vehículo para cruzarlo? (vacío = se cruza a pie)').setRequired(false)
            .addChoices(...VEHICLE_CATEGORY_CHOICES)
        )
        .addStringOption(opt => opt.setName('descripcion').setDescription('Descripción corta').setRequired(false))
        .addNumberOption(opt => opt.setName('coste_movimiento').setDescription('Coste de viaje al cruzarlo (por defecto 1 — más alto = más lento)').setRequired(false).setMinValue(0.01))
    )

    .addSubcommand(sub =>
      sub
        .setName('modify')
        .setDescription('[Rolepriest] Edita un tipo de terreno ya existente')
        .addStringOption(opt => opt.setName('nombre').setDescription('Tipo a editar').setRequired(true).setAutocomplete(true))
        .addStringOption(opt => opt.setName('display').setDescription('Nuevo nombre para mostrar').setRequired(false))
        .addStringOption(opt => opt.setName('color').setDescription('Nuevo color hex').setRequired(false))
        .addStringOption(opt => opt.setName('emoji').setDescription('Nuevo emoji').setRequired(false))
        .addStringOption(opt =>
          opt.setName('vehiculo_categoria').setDescription('Nueva categoría de vehículo exigida (elige "Ninguno" para quitarlo)').setRequired(false)
            .addChoices(...VEHICLE_CATEGORY_CHOICES, { name: '🚶 Ninguno (se cruza a pie)', value: 'ninguno' })
        )
        .addStringOption(opt => opt.setName('descripcion').setDescription('Nueva descripción').setRequired(false))
        .addNumberOption(opt => opt.setName('coste_movimiento').setDescription('Nuevo coste de viaje al cruzarlo').setRequired(false).setMinValue(0.01))
    )

    .addSubcommand(sub =>
      sub
        .setName('delete')
        .setDescription('[Rolepriest] Elimina un tipo de terreno (si ninguna casilla lo usa)')
        .addStringOption(opt => opt.setName('nombre').setDescription('Tipo a eliminar').setRequired(true).setAutocomplete(true))
    )

    .addSubcommand(sub => sub.setName('list').setDescription('Lista el catálogo de tipos de terreno')),

  async autocomplete(interaction) {
    await handleTerrainTypeAutocomplete(interaction);
  },

  async execute(interaction) {
    const sub = interaction.options.getSubcommand();

    if (sub === 'list') {
      const types = await listTerrainTypes();
      const embed = new EmbedBuilder().setColor(COLORS.DARK).setTitle('🗺️ Catálogo de tipos de terreno').setTimestamp();

      if (types.length === 0) {
        embed.setDescription('*Todavía no hay ningún tipo de terreno definido.*');
      } else {
        for (const t of types) {
          const lines = [`Color: \`${t.color}\``];
          if (t.requires_vehicle_category) lines.push(`🚧 Exige vehículo **${t.requires_vehicle_category}**`);
          else lines.push('🚶 Se cruza a pie');
          if (t.movement_cost !== 1) lines.push(`🐢 Coste de viaje: **×${t.movement_cost}**`);
          const resources = await getResources(t.id);
          if (resources.length > 0) {
            lines.push(`⛏️ Recolectable: ${resources.map(r => `${r.emoji ?? '📦'} ${r.display_name} (${r.drop_chance_percent}%)`).join(', ')}`);
          }
          embed.addFields({ name: `${t.emoji} ${t.display_name} (\`${t.name}\`)`, value: lines.join('\n') });
        }
      }

      return interaction.reply({ embeds: [embed] });
    }

    if (!await requireRolepriest(interaction)) return;

    if (sub === 'create') {
      const nombre  = interaction.options.getString('nombre', true).toLowerCase().trim();
      const display = interaction.options.getString('display', true).trim();
      const color   = interaction.options.getString('color', true).trim();
      const emoji   = interaction.options.getString('emoji') ?? '🗺️';
      const vehiculoCategoria = interaction.options.getString('vehiculo_categoria') ?? null;
      const descripcion = interaction.options.getString('descripcion') ?? '';
      const costeMovimiento = interaction.options.getNumber('coste_movimiento') ?? 1;

      if (!/^[a-z0-9_-]+$/.test(nombre)) {
        return interaction.reply({
          content: '❌ El nombre solo puede contener minúsculas, números, guiones y guiones bajos.',
          flags: MessageFlags.Ephemeral,
        });
      }

      let created;
      try {
        created = await createTerrainType({
          name: nombre, displayName: display, emoji, color,
          requiresVehicleCategory: vehiculoCategoria, description: descripcion,
          movementCost: costeMovimiento,
        });
      } catch (err) {
        return interaction.reply({ content: `❌ ${err.message}`, flags: MessageFlags.Ephemeral });
      }

      logger.info(`[/terrain create] ${interaction.user.tag} creó el tipo "${nombre}"`);
      logAction({ source: 'discord', actorDiscordId: interaction.user.id, actorUsername: interaction.user.tag, action: 'terrain.create', target: nombre });

      const embed = new EmbedBuilder()
        .setColor(parseInt(color.replace('#', ''), 16) || COLORS.BLUE)
        .setTitle(`✅ Tipo de terreno creado: ${emoji} ${display}`)
        .addFields(
          { name: '🔑 Nombre clave', value: `\`${nombre}\``, inline: true },
          { name: '🎨 Color',        value: `\`${color}\``, inline: true }
        )
        .setFooter({ text: `Creado por ${interaction.user.tag}` })
        .setTimestamp();

      if (vehiculoCategoria) embed.addFields({ name: '🚧 Exige vehículo', value: vehiculoCategoria, inline: true });

      return interaction.reply({ embeds: [embed] });
    }

    if (sub === 'modify') {
      const nombre = interaction.options.getString('nombre', true).toLowerCase().trim();

      const updates = {};
      const display = interaction.options.getString('display');
      const color   = interaction.options.getString('color');
      const emoji   = interaction.options.getString('emoji');
      const vehiculoCategoriaRaw = interaction.options.getString('vehiculo_categoria');
      const descripcion = interaction.options.getString('descripcion');
      const costeMovimiento = interaction.options.getNumber('coste_movimiento');

      if (display !== null) updates.displayName = display;
      if (color !== null) updates.color = color;
      if (emoji !== null) updates.emoji = emoji;
      if (descripcion !== null) updates.description = descripcion;
      if (vehiculoCategoriaRaw !== null) updates.requiresVehicleCategory = vehiculoCategoriaRaw === 'ninguno' ? null : vehiculoCategoriaRaw;
      if (costeMovimiento !== null) updates.movementCost = costeMovimiento;

      let updated;
      try {
        updated = await updateTerrainType(nombre, updates);
      } catch (err) {
        return interaction.reply({ content: `❌ ${err.message}`, flags: MessageFlags.Ephemeral });
      }

      logger.info(`[/terrain modify] ${interaction.user.tag} editó el tipo "${nombre}"`);
      logAction({ source: 'discord', actorDiscordId: interaction.user.id, actorUsername: interaction.user.tag, action: 'terrain.update', target: nombre, details: updates });

      return interaction.reply({
        embeds: [
          new EmbedBuilder()
            .setColor(COLORS.BLUE)
            .setTitle(`✏️ Tipo actualizado: ${updated.emoji} ${updated.display_name}`)
            .setFooter({ text: `Editado por ${interaction.user.tag}` })
            .setTimestamp(),
        ],
      });
    }

    if (sub === 'delete') {
      const nombre = interaction.options.getString('nombre', true).toLowerCase().trim();
      let deleted;
      try {
        deleted = await deleteTerrainType(nombre);
      } catch (err) {
        return interaction.reply({ content: `❌ ${err.message}`, flags: MessageFlags.Ephemeral });
      }

      logger.info(`[/terrain delete] ${interaction.user.tag} eliminó el tipo "${nombre}"`);
      logAction({ source: 'discord', actorDiscordId: interaction.user.id, actorUsername: interaction.user.tag, action: 'terrain.delete', target: nombre });
      return interaction.reply({
        embeds: [
          new EmbedBuilder()
            .setColor(COLORS.RED)
            .setTitle(`🗑️ Tipo eliminado: ${deleted.emoji} ${deleted.display_name}`)
            .setFooter({ text: `Eliminado por ${interaction.user.tag}` })
            .setTimestamp(),
        ],
      });
    }
  },
};
