






























import { SlashCommandBuilder, EmbedBuilder, MessageFlags } from 'discord.js';
import {
  createFaction, updateFaction, deleteFaction, assignRange, unassignRange, setOwner,
} from '../../services/factionService.js';
import { requireRolepriest } from '../../utils/permissions.js';
import { handleFactionAutocomplete } from '../../utils/autocomplete.js';
import { COLORS }  from '../../utils/embeds.js';
import logger        from '../../utils/logger.js';
import { logAction } from '../../services/auditLogService.js';

export default {
  data: new SlashCommandBuilder()
    .setName('faccion-admin')
    .setDescription('[Rolepriest] Gestiona el catálogo de facciones, su territorio y su dueño')


    .addSubcommand(sub =>
      sub
        .setName('create')
        .setDescription('Crea una nueva facción en el catálogo')
        .addStringOption(opt => opt.setName('nombre').setDescription('Nombre clave único (ej: imperio_del_norte)').setRequired(true))
        .addStringOption(opt => opt.setName('display').setDescription('Nombre para mostrar (ej: Imperio del Norte)').setRequired(true))
        .addStringOption(opt => opt.setName('emoji').setDescription('Emoji/bandera (ej: 🏴)').setRequired(false))
        .addStringOption(opt => opt.setName('descripcion').setDescription('Descripción corta').setRequired(false))
        .addBooleanOption(opt => opt.setName('npc').setDescription('Facción NPC: la lleva el mundo, ningún jugador puede unirse ni mandarla').setRequired(false))
    )


    .addSubcommand(sub =>
      sub
        .setName('modify')
        .setDescription('Edita una facción ya existente')
        .addStringOption(opt => opt.setName('nombre').setDescription('Facción a editar').setRequired(true).setAutocomplete(true))
        .addStringOption(opt => opt.setName('display').setDescription('Nuevo nombre para mostrar').setRequired(false))
        .addStringOption(opt => opt.setName('emoji').setDescription('Nuevo emoji/bandera').setRequired(false))
        .addStringOption(opt => opt.setName('descripcion').setDescription('Nueva descripción').setRequired(false))
        .addBooleanOption(opt => opt.setName('npc').setDescription('Marcar o desmarcar como facción NPC').setRequired(false))
    )


    .addSubcommand(sub =>
      sub
        .setName('delete')
        .setDescription('Elimina una facción (sus casillas quedan sin facción, no se borran)')
        .addStringOption(opt => opt.setName('nombre').setDescription('Facción a eliminar').setRequired(true).setAutocomplete(true))
    )


    .addSubcommand(sub =>
      sub
        .setName('asignar')
        .setDescription('Asigna una facción a las casillas existentes de un rango rectangular')
        .addStringOption(opt => opt.setName('faccion').setDescription('Facción a asignar').setRequired(true).setAutocomplete(true))
        .addIntegerOption(opt => opt.setName('x1').setDescription('Coordenada X de una esquina').setRequired(true).setMinValue(0).setMaxValue(9999))
        .addIntegerOption(opt => opt.setName('y1').setDescription('Coordenada Y de una esquina').setRequired(true).setMinValue(0).setMaxValue(9999))
        .addIntegerOption(opt => opt.setName('x2').setDescription('Coordenada X de la esquina opuesta').setRequired(true).setMinValue(0).setMaxValue(9999))
        .addIntegerOption(opt => opt.setName('y2').setDescription('Coordenada Y de la esquina opuesta').setRequired(true).setMinValue(0).setMaxValue(9999))
    )


    .addSubcommand(sub =>
      sub
        .setName('quitar')
        .setDescription('Quita la facción asignada a las casillas existentes de un rango rectangular')
        .addIntegerOption(opt => opt.setName('x1').setDescription('Coordenada X de una esquina').setRequired(true).setMinValue(0).setMaxValue(9999))
        .addIntegerOption(opt => opt.setName('y1').setDescription('Coordenada Y de una esquina').setRequired(true).setMinValue(0).setMaxValue(9999))
        .addIntegerOption(opt => opt.setName('x2').setDescription('Coordenada X de la esquina opuesta').setRequired(true).setMinValue(0).setMaxValue(9999))
        .addIntegerOption(opt => opt.setName('y2').setDescription('Coordenada Y de la esquina opuesta').setRequired(true).setMinValue(0).setMaxValue(9999))
    )


    .addSubcommand(sub =>
      sub
        .setName('setowner')
        .setDescription('Asigna (o quita) el dueño de una facción — siempre lo decide un Rolepriest')
        .addStringOption(opt => opt.setName('faccion').setDescription('Facción').setRequired(true).setAutocomplete(true))
        .addUserOption(opt => opt.setName('jugador').setDescription('Nuevo dueño (omitir para quitarlo)').setRequired(false))
    ),

  autocomplete: handleFactionAutocomplete,


  async execute(interaction) {
    if (!await requireRolepriest(interaction)) return;

    const sub = interaction.options.getSubcommand();




    if (sub === 'create') {
      const nombre      = interaction.options.getString('nombre', true).toLowerCase().trim();
      const display     = interaction.options.getString('display', true).trim();
      const emoji       = interaction.options.getString('emoji') ?? '🏳️';
      const descripcion = interaction.options.getString('descripcion') ?? '';
      const esNpc       = interaction.options.getBoolean('npc') ?? false;

      if (!/^[a-z0-9_-]+$/.test(nombre)) {
        return interaction.reply({
          content: '❌ El nombre solo puede contener minúsculas, números, guiones y guiones bajos.',
          flags: MessageFlags.Ephemeral,
        });
      }

      let created;
      try {
        created = await createFaction({ name: nombre, displayName: display, emoji, description: descripcion, isNpc: esNpc });
      } catch (err) {
        return interaction.reply({ content: `❌ ${err.message}`, flags: MessageFlags.Ephemeral });
      }

      logger.info(`[/faccion-admin create] ${interaction.user.tag} creó la facción "${nombre}"`);
      logAction({ source: 'discord', actorDiscordId: interaction.user.id, actorUsername: interaction.user.tag, action: 'faccion.create', target: nombre });

      return interaction.reply({
        embeds: [
          new EmbedBuilder()
            .setColor(COLORS.GREEN)
            .setTitle(`✅ Facción creada: ${emoji} ${display}`)
            .addFields({ name: '🔑 Nombre clave', value: `\`${nombre}\`` })
            .addFields({ name: '🤖 Tipo', value: esNpc ? 'Facción NPC — la lleva el mundo' : 'Facción de jugadores' })
            .setDescription(descripcion || null)
            .setFooter({ text: `Creada por ${interaction.user.tag}` })
            .setTimestamp(),
        ],
      });
    }




    if (sub === 'modify') {
      const nombre      = interaction.options.getString('nombre', true).toLowerCase().trim();
      const display     = interaction.options.getString('display');
      const emoji       = interaction.options.getString('emoji');
      const descripcion = interaction.options.getString('descripcion');
      const esNpc       = interaction.options.getBoolean('npc');

      const updates = {};
      if (display !== null) updates.displayName = display;
      if (emoji !== null) updates.emoji = emoji;
      if (descripcion !== null) updates.description = descripcion;
      if (esNpc !== null) updates.isNpc = esNpc;

      let updated;
      try {
        updated = await updateFaction(nombre, updates);
      } catch (err) {
        return interaction.reply({ content: `❌ ${err.message}`, flags: MessageFlags.Ephemeral });
      }

      logger.info(`[/faccion-admin modify] ${interaction.user.tag} editó la facción "${nombre}"`);
      logAction({ source: 'discord', actorDiscordId: interaction.user.id, actorUsername: interaction.user.tag, action: 'faccion.update', target: nombre });

      return interaction.reply({
        embeds: [
          new EmbedBuilder()
            .setColor(COLORS.BLUE)
            .setTitle(`✏️ Facción actualizada: ${updated.emoji} ${updated.display_name}`)
            .setFooter({ text: `Editada por ${interaction.user.tag}` })
            .setTimestamp(),
        ],
      });
    }




    if (sub === 'delete') {
      const nombre = interaction.options.getString('nombre', true).toLowerCase().trim();

      let result;
      try {
        result = await deleteFaction(nombre);
      } catch (err) {
        return interaction.reply({ content: `❌ ${err.message}`, flags: MessageFlags.Ephemeral });
      }

      logger.info(`[/faccion-admin delete] ${interaction.user.tag} eliminó la facción "${nombre}" (${result.tilesAffected} casilla(s) quedaron sin facción)`);
      logAction({ source: 'discord', actorDiscordId: interaction.user.id, actorUsername: interaction.user.tag, action: 'faccion.delete', target: nombre, details: { tilesAffected: result.tilesAffected } });

      return interaction.reply({
        embeds: [
          new EmbedBuilder()
            .setColor(COLORS.RED)
            .setTitle(`🗑️ Facción eliminada: ${result.deleted.emoji} ${result.deleted.display_name}`)
            .setDescription(
              result.tilesAffected > 0
                ? `${result.tilesAffected} casilla(s) que la tenían asignada quedaron **sin facción** — no se borró ninguna casilla.`
                : 'No tenía ninguna casilla asignada.'
            )
            .setFooter({ text: `Eliminada por ${interaction.user.tag}` })
            .setTimestamp(),
        ],
      });
    }




    if (sub === 'asignar') {
      const nacion = interaction.options.getString('faccion', true).toLowerCase().trim();
      const x1 = interaction.options.getInteger('x1', true);
      const y1 = interaction.options.getInteger('y1', true);
      const x2 = interaction.options.getInteger('x2', true);
      const y2 = interaction.options.getInteger('y2', true);

      let result;
      try {
        result = await assignRange(x1, y1, x2, y2, nacion);
      } catch (err) {
        return interaction.reply({ content: `❌ ${err.message}`, flags: MessageFlags.Ephemeral });
      }

      logger.info(`[/faccion-admin asignar] ${interaction.user.tag}: "${nacion}" → ${result.tilesAssigned} casilla(s) en (${x1},${y1})-(${x2},${y2})`);
      logAction({ source: 'discord', actorDiscordId: interaction.user.id, actorUsername: interaction.user.tag, action: 'faccion.assign_range', target: nacion, details: { x1, y1, x2, y2, tilesAssigned: result.tilesAssigned } });

      return interaction.reply({
        content:
          result.tilesAssigned > 0
            ? `✅ **${result.faction.emoji} ${result.faction.display_name}** asignada a **${result.tilesAssigned}** casilla(s) existentes en ese rango.`
            : `⚠️ No hay ninguna casilla creada todavía en ese rango — no se asignó nada. Usa \`/map create-range\` primero si hace falta crearlas.`,
      });
    }




    if (sub === 'quitar') {
      const x1 = interaction.options.getInteger('x1', true);
      const y1 = interaction.options.getInteger('y1', true);
      const x2 = interaction.options.getInteger('x2', true);
      const y2 = interaction.options.getInteger('y2', true);

      let result;
      try {
        result = await unassignRange(x1, y1, x2, y2);
      } catch (err) {
        return interaction.reply({ content: `❌ ${err.message}`, flags: MessageFlags.Ephemeral });
      }

      logger.info(`[/faccion-admin quitar] ${interaction.user.tag}: facción quitada de ${result.tilesUnassigned} casilla(s) en (${x1},${y1})-(${x2},${y2})`);
      logAction({ source: 'discord', actorDiscordId: interaction.user.id, actorUsername: interaction.user.tag, action: 'faccion.unassign_range', details: { x1, y1, x2, y2, tilesUnassigned: result.tilesUnassigned } });

      return interaction.reply({
        content: `✅ Facción quitada de **${result.tilesUnassigned}** casilla(s) en ese rango.`,
      });
    }




    if (sub === 'setowner') {
      const nombre = interaction.options.getString('faccion', true).toLowerCase().trim();
      const targetUser = interaction.options.getUser('jugador') ?? null;

      let updated;
      try {
        updated = await setOwner(nombre, targetUser?.id ?? null);
      } catch (err) {
        return interaction.reply({ content: `❌ ${err.message}`, flags: MessageFlags.Ephemeral });
      }

      logger.info(`[/faccion-admin setowner] ${interaction.user.tag}: dueño de "${nombre}" → ${targetUser?.tag ?? '(ninguno)'}`);
      logAction({ source: 'discord', actorDiscordId: interaction.user.id, actorUsername: interaction.user.tag, action: 'faccion.set_owner', target: nombre, details: { owner: targetUser?.id ?? null } });

      return interaction.reply({
        content: targetUser
          ? `✅ **${targetUser.username}** es ahora el dueño de **${updated.emoji} ${updated.display_name}**.`
          : `✅ **${updated.emoji} ${updated.display_name}** se quedó sin dueño.`,
      });
    }
  },
};
