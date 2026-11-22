











import { SlashCommandBuilder, EmbedBuilder, MessageFlags } from 'discord.js';
import { getOrCreatePlayer, getPlayerStats, applyEffect, removeEffect } from '../../services/playerService.js';
import {
  listEffectTypes,
  getEffectType,
  createEffectType,
  updateEffectType,
  deleteEffectType,
} from '../../services/effectTypesService.js';
import { requireRolepriest }            from '../../utils/permissions.js';
import { COLORS, discordTimestamp, signed } from '../../utils/embeds.js';
import { getAvatarUrl }            from '../../utils/playerAvatar.js';
import { handleEffectTypeAutocomplete } from '../../utils/autocomplete.js';
import logger                       from '../../utils/logger.js';
import { logAction }                from '../../services/auditLogService.js';












function formatExpiry(isoStr) {
  if (!isoStr) return 'Permanente (hasta que Staff lo elimine)';
  return `${discordTimestamp(isoStr, 'f')} (${discordTimestamp(isoStr, 'R')})`;
}


export default {
  data: new SlashCommandBuilder()
    .setName('effect')
    .setDescription('Gestiona los tipos de estado del juego y los aplica a jugadores')

    .addSubcommand(sub =>
      sub
        .setName('create')
        .setDescription('[Staff] Crea un nuevo tipo de estado en el catálogo')
        .addStringOption(opt =>
          opt
            .setName('nombre')
            .setDescription('Nombre clave único (minúsculas, ej: borracho)')
            .setRequired(true)
        )
        .addStringOption(opt =>
          opt.setName('label').setDescription('Nombre para mostrar (ej: Borracho)').setRequired(true)
        )
        .addStringOption(opt =>
          opt.setName('emoji').setDescription('Emoji del estado (ej: 🍺)').setRequired(false)
        )
        .addNumberOption(opt =>
          opt
            .setName('laburo_mod')
            .setDescription('Delta sobre la cantidad base de /laburo trabajar mientras esté activo (ej: -0.3)')
            .setRequired(false)
        )
        .addNumberOption(opt =>
          opt.setName('hp_delta_dia').setDescription('HP que gana/pierde el jugador cada día (ej: -0.5)').setRequired(false)
        )
        .addBooleanOption(opt =>
          opt
            .setName('bloquea_laburar')
            .setDescription('¿Este estado impide usar /laburo trabajar por completo? (ej: encarcelado)')
            .setRequired(false)
        )
        .addBooleanOption(opt =>
          opt
            .setName('impide_combate')
            .setDescription('¿Nadie puede pelear (atacar/ser atacado) mientras esté en esta zona? (ej: casilla de aparición)')
            .setRequired(false)
        )
        .addStringOption(opt =>
          opt.setName('descripcion').setDescription('Descripción corta del estado').setRequired(false)
        )
    )

    .addSubcommand(sub =>
      sub
        .setName('modify')
        .setDescription('[Staff] Modifica un tipo de estado ya existente')
        .addStringOption(opt =>
          opt.setName('nombre').setDescription('Tipo de estado a editar').setRequired(true).setAutocomplete(true)
        )
        .addStringOption(opt => opt.setName('label').setDescription('Nuevo nombre para mostrar').setRequired(false))
        .addStringOption(opt => opt.setName('emoji').setDescription('Nuevo emoji').setRequired(false))
        .addNumberOption(opt => opt.setName('laburo_mod').setDescription('Nuevo delta sobre /laburo trabajar').setRequired(false))
        .addNumberOption(opt => opt.setName('hp_delta_dia').setDescription('Nuevo HP/día').setRequired(false))
        .addBooleanOption(opt => opt.setName('bloquea_laburar').setDescription('¿Bloquea /laburo trabajar?').setRequired(false))
        .addBooleanOption(opt => opt.setName('impide_combate').setDescription('¿Impide pelear en esa zona?').setRequired(false))
        .addStringOption(opt => opt.setName('descripcion').setDescription('Nueva descripción').setRequired(false))
    )

    .addSubcommand(sub =>
      sub
        .setName('delete')
        .setDescription('[Staff] Elimina un tipo de estado del catálogo (si no está en uso)')
        .addStringOption(opt =>
          opt.setName('nombre').setDescription('Tipo de estado a eliminar').setRequired(true).setAutocomplete(true)
        )
    )

    .addSubcommand(sub =>
      sub.setName('list').setDescription('Lista todos los tipos de estado del catálogo')
    )

    .addSubcommand(sub =>
      sub
        .setName('add')
        .setDescription('[Staff] Aplica un estado a un jugador')
        .addUserOption(opt => opt.setName('jugador').setDescription('Jugador').setRequired(true))
        .addStringOption(opt =>
          opt.setName('efecto').setDescription('Tipo de estado').setRequired(true).setAutocomplete(true)
        )
        .addNumberOption(opt =>
          opt
            .setName('laburo_mod')
            .setDescription('Delta sobre /laburo trabajar (ej: -0.3). Por defecto usa el preset del tipo.')
            .setRequired(false)
        )
        .addNumberOption(opt =>
          opt
            .setName('hp_delta_dia')
            .setDescription('HP que pierde/gana el jugador al día. Por defecto usa el preset.')
            .setRequired(false)
        )
        .addIntegerOption(opt =>
          opt.setName('duracion_horas').setDescription('Duración en horas. Omitir = permanente.').setRequired(false).setMinValue(1)
        )
    )

    .addSubcommand(sub =>
      sub
        .setName('remove')
        .setDescription('[Staff] Elimina todas las instancias activas de un estado de un jugador')
        .addUserOption(opt => opt.setName('jugador').setDescription('Jugador').setRequired(true))
        .addStringOption(opt =>
          opt.setName('efecto').setDescription('Tipo de estado a eliminar').setRequired(true).setAutocomplete(true)
        )
    ),


  async autocomplete(interaction) {
    await handleEffectTypeAutocomplete(interaction);
  },


  async execute(interaction) {
    const sub = interaction.options.getSubcommand();




    if (sub === 'list') {
      const types = await listEffectTypes();

      const embed = new EmbedBuilder()
        .setColor(COLORS.BLUE)
        .setTitle('🎭 Catálogo de tipos de estado')
        .setTimestamp();

      if (types.length === 0) {
        embed.setDescription('*No hay ningún tipo de estado definido.*');
      } else {
        embed.setDescription(
          types.map(t => {
            const parts = [`${t.emoji} **${t.label}** (\`${t.name}\`)`];
            if (t.laburo_modifier !== 0) parts.push(`Laburo ${signed(t.laburo_modifier)}`);
            if (t.hp_delta_per_day !== 0) parts.push(`HP ${signed(t.hp_delta_per_day)}/día`);
            if (t.blocks_laburo) parts.push('🚫 bloquea /laburo trabajar');
            if (t.prevents_combat) parts.push('🛡️ impide combate');
            return parts.join(' · ');
          }).join('\n')
        );
      }

      return interaction.reply({ embeds: [embed] });
    }


    if (!await requireRolepriest(interaction)) return;




    if (sub === 'create') {
      const nombre  = interaction.options.getString('nombre', true).toLowerCase().trim();
      const label   = interaction.options.getString('label', true).trim();
      const emoji   = interaction.options.getString('emoji') ?? '🎭';
      const laburoMod = interaction.options.getNumber('laburo_mod') ?? 0;
      const hpDelta   = interaction.options.getNumber('hp_delta_dia') ?? 0;
      const bloquea   = interaction.options.getBoolean('bloquea_laburar') ?? false;
      const impideCombate = interaction.options.getBoolean('impide_combate') ?? false;
      const descripcion = interaction.options.getString('descripcion') ?? '';

      if (!/^[a-z0-9_-]+$/.test(nombre)) {
        return interaction.reply({
          content: '❌ El nombre solo puede contener minúsculas, números, guiones y guiones bajos.',
          flags: MessageFlags.Ephemeral,
        });
      }

      let created;
      try {
        created = await createEffectType({
          name: nombre, emoji, label, laburoModifier: laburoMod, hpDeltaPerDay: hpDelta,
          blocksLaburo: bloquea, preventsCombat: impideCombate, description: descripcion,
        });
      } catch (err) {
        return interaction.reply({ content: `❌ ${err.message}`, flags: MessageFlags.Ephemeral });
      }

      logger.info(`[/effect create] ${interaction.user.tag} creó el estado "${nombre}"`);
      logAction({ source: 'discord', actorDiscordId: interaction.user.id, actorUsername: interaction.user.tag, action: 'effect.create', target: nombre });

      const embed = new EmbedBuilder()
        .setColor(COLORS.PURPLE)
        .setTitle(`✅ Estado creado: ${emoji} ${label}`)
        .addFields(
          { name: '🔑 Nombre clave', value: `\`${nombre}\``, inline: true },
          { name: '⚒️ Laburo',       value: `${signed(laburoMod)}`, inline: true },
          { name: '❤️ HP/día',       value: `${signed(hpDelta)}`, inline: true },
        )
        .setFooter({ text: `Creado por ${interaction.user.tag}` })
        .setTimestamp();

      if (bloquea) embed.addFields({ name: '🚫 Bloquea /laburo trabajar', value: 'Sí' });
      if (impideCombate) embed.addFields({ name: '🛡️ Impide combate', value: 'Sí — nadie puede pelear en una casilla con este efecto de zona.' });
      if (descripcion) embed.setDescription(descripcion);

      return interaction.reply({ embeds: [embed] });
    }




    if (sub === 'modify') {
      const nombre = interaction.options.getString('nombre', true).toLowerCase().trim();

      const updates = {};
      const label = interaction.options.getString('label');
      const emoji = interaction.options.getString('emoji');
      const laburoMod = interaction.options.getNumber('laburo_mod');
      const hpDelta = interaction.options.getNumber('hp_delta_dia');
      const bloquea = interaction.options.getBoolean('bloquea_laburar');
      const impideCombate = interaction.options.getBoolean('impide_combate');
      const descripcion = interaction.options.getString('descripcion');

      if (label !== null) updates.label = label;
      if (emoji !== null) updates.emoji = emoji;
      if (laburoMod !== null) updates.laburoModifier = laburoMod;
      if (hpDelta !== null) updates.hpDeltaPerDay = hpDelta;
      if (bloquea !== null) updates.blocksLaburo = bloquea;
      if (impideCombate !== null) updates.preventsCombat = impideCombate;
      if (descripcion !== null) updates.description = descripcion;

      let updated;
      try {
        updated = await updateEffectType(nombre, updates);
      } catch (err) {
        return interaction.reply({ content: `❌ ${err.message}`, flags: MessageFlags.Ephemeral });
      }

      logger.info(`[/effect modify] ${interaction.user.tag} editó el estado "${nombre}"`);
      logAction({ source: 'discord', actorDiscordId: interaction.user.id, actorUsername: interaction.user.tag, action: 'effect.update', target: nombre });

      const embed = new EmbedBuilder()
        .setColor(COLORS.BLUE)
        .setTitle(`✏️ Estado actualizado: ${updated.emoji} ${updated.label}`)
        .addFields(
          { name: '🔑 Nombre clave', value: `\`${updated.name}\``, inline: true },
          { name: '⚒️ Laburo',       value: `${signed(updated.laburo_modifier)}`, inline: true },
          { name: '❤️ HP/día',       value: `${signed(updated.hp_delta_per_day)}`, inline: true },
        )
        .setFooter({ text: `Editado por ${interaction.user.tag}` })
        .setTimestamp();

      return interaction.reply({ embeds: [embed] });
    }




    if (sub === 'delete') {
      const nombre = interaction.options.getString('nombre', true).toLowerCase().trim();

      let deleted;
      try {
        deleted = await deleteEffectType(nombre);
      } catch (err) {
        return interaction.reply({ content: `❌ ${err.message}`, flags: MessageFlags.Ephemeral });
      }

      logger.info(`[/effect delete] ${interaction.user.tag} eliminó el estado "${nombre}"`);
      logAction({ source: 'discord', actorDiscordId: interaction.user.id, actorUsername: interaction.user.tag, action: 'effect.delete', target: nombre });

      return interaction.reply({
        embeds: [
          new EmbedBuilder()
            .setColor(COLORS.RED)
            .setTitle(`🗑️ Estado eliminado: ${deleted.emoji} ${deleted.label}`)
            .setFooter({ text: `Eliminado por ${interaction.user.tag}` })
            .setTimestamp(),
        ],
      });
    }


    const targetUser = interaction.options.getUser('jugador', true);
    const effectType = interaction.options.getString('efecto', true);

    const meta = await getEffectType(effectType);
    if (!meta) {
      return interaction.reply({
        content: `❌ No existe ningún tipo de estado llamado \`${effectType}\`. Usa \`/effect list\` para ver los disponibles.`,
        flags: MessageFlags.Ephemeral,
      });
    }

    const player = await getOrCreatePlayer(targetUser.id, targetUser.username);
    const avatarUrl = getAvatarUrl(player, '/effect');




    if (sub === 'add') {
      const laburoMod  = interaction.options.getNumber('laburo_mod')      ?? meta.laburo_modifier;
      const hpDeltaDia = interaction.options.getNumber('hp_delta_dia')    ?? meta.hp_delta_per_day;
      const duracion   = interaction.options.getInteger('duracion_horas') ?? null;

      let newEffect;
      try {
        newEffect = await applyEffect(targetUser.id, effectType, laburoMod, hpDeltaDia, duracion);
      } catch (err) {
        return interaction.reply({ content: `❌ ${err.message}`, flags: MessageFlags.Ephemeral });
      }

      const updatedStats          = await getPlayerStats(targetUser.id);
      const totalActiveModifier   = updatedStats?.activeLaburoModifier ?? laburoMod;

      logger.info(
        `[/effect add] ${interaction.user.tag} → ${targetUser.tag}: ` +
        `"${effectType}" laburo:${signed(laburoMod)} hp/día:${signed(hpDeltaDia)} ` +
        `vence:${newEffect.expires_at ?? 'permanente'}`
      );
      logAction({ source: 'discord', actorDiscordId: interaction.user.id, actorUsername: interaction.user.tag, action: 'player.apply_effect', target: targetUser.id, details: { effectType, laburoMod, hpDeltaDia } });

      const embed = new EmbedBuilder()
        .setColor(COLORS.RED)
        .setTitle(`${meta.emoji} Efecto aplicado: ${meta.label}`)
        .addFields(
          { name: '👤 Jugador',            value: `<@${targetUser.id}>`, inline: true },
          {
            name:   '⚒️ Impacto en Laburo',
            value:  `${signed(laburoMod)} por \`/laburo trabajar\` *(total activo: ${signed(totalActiveModifier)})*`,
            inline: true,
          },
          {
            name:   '❤️ Impacto en HP',
            value:  hpDeltaDia !== 0 ? `${signed(hpDeltaDia)} HP/día` : '*Sin impacto diario en HP*',
            inline: true,
          },
          { name: '⏳ Duración', value: formatExpiry(newEffect.expires_at) }
        )
        .setFooter({ text: `Aplicado por ${interaction.user.tag}` })
        .setTimestamp();

      if (meta.blocks_laburo) {
        embed.addFields({ name: '🚫 Nota', value: `Este estado impide usar \`/laburo trabajar\` mientras esté activo.` });
      }
      if (meta.prevents_combat) {
        embed.addFields({ name: '🛡️ Nota', value: `Este estado impide pelear (atacar o ser atacado) mientras esté activo.` });
      }

      const usedDefaults = laburoMod === meta.laburo_modifier && hpDeltaDia === meta.hp_delta_per_day;
      if (!usedDefaults) {
        embed.setDescription(
          `⚙️ *Modificadores personalizados (preset: laburo ${signed(meta.laburo_modifier)}, ` +
          `HP ${signed(meta.hp_delta_per_day)}/día)*`
        );
      }

      if (avatarUrl) embed.setThumbnail(avatarUrl);

      return interaction.reply({ embeds: [embed] });
    }




    if (sub === 'remove') {
      let removed;
      try {
        removed = await removeEffect(targetUser.id, effectType);
      } catch (err) {
        return interaction.reply({ content: `❌ ${err.message}`, flags: MessageFlags.Ephemeral });
      }

      logger.info(
        `[/effect remove] ${interaction.user.tag} eliminó "${effectType}" de ${targetUser.tag} (${removed} instancia/s)`
      );
      logAction({ source: 'discord', actorDiscordId: interaction.user.id, actorUsername: interaction.user.tag, action: 'player.remove_effect', target: targetUser.id, details: { effectType, removed } });

      const embed = new EmbedBuilder()
        .setColor(COLORS.GREEN)
        .setTitle(`✅ Efecto eliminado: ${meta.emoji} ${meta.label}`)
        .addFields(
          { name: '👤 Jugador', value: `<@${targetUser.id}>`, inline: true },
          {
            name:   '🗑️ Resultado',
            value:  removed > 0
              ? `**${removed}** instancia${removed !== 1 ? 's' : ''} eliminada${removed !== 1 ? 's' : ''}.`
              : `*El jugador no tenía "${effectType}" activo.*`,
            inline: true,
          }
        )
        .setFooter({ text: `Operación de ${interaction.user.tag}` })
        .setTimestamp();

      if (avatarUrl) embed.setThumbnail(avatarUrl);

      return interaction.reply({ embeds: [embed] });
    }
  },
};
