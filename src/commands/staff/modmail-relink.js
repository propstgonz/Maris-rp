

































import { SlashCommandBuilder, ChannelType, OverwriteType, MessageFlags, EmbedBuilder } from 'discord.js';
import { getPlayerByDiscordId } from '../../services/playerService.js';
import { relinkModmailChannel } from '../../services/characterLifecycleService.js';
import { mergeChannelOverwrites, PLAYER_CHANNEL_PERMISSIONS, postCharacterInfoCard } from '../../services/modmailService.js';
import { requireRolepriest } from '../../utils/permissions.js';
import { COLORS } from '../../utils/embeds.js';
import { slugify } from '../../utils/text.js';
import logger from '../../utils/logger.js';
import { logAction } from '../../services/auditLogService.js';

export default {
  data: new SlashCommandBuilder()
    .setName('modmail-relink')
    .setDescription('[Staff] Enlaza un canal de Discord YA EXISTENTE como el canal de modmail oficial de un jugador')
    .addUserOption(opt => opt.setName('jugador').setDescription('Dueño del personaje').setRequired(true))
    .addChannelOption(opt =>
      opt
        .setName('canal')
        .setDescription('Canal de texto ya existente a enlazar (conserva su historial)')
        .addChannelTypes(ChannelType.GuildText)
        .setRequired(true)
    ),


  async execute(interaction) {
    if (!await requireRolepriest(interaction)) return;

    const targetUser = interaction.options.getUser('jugador', true);
    const channel = interaction.options.getChannel('canal', true);

    const player = await getPlayerByDiscordId(targetUser.id);
    if (!player?.character_created_at) {
      return interaction.reply({
        content: `❌ **${targetUser.tag}** no tiene ningún personaje creado — no hay a qué enlazar el canal.`,
        flags: MessageFlags.Ephemeral,
      });
    }

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const previousChannelId = player.modmail_channel_id;
    let updated;
    try {
      updated = await relinkModmailChannel(targetUser.id, channel.id);
    } catch (err) {
      return interaction.editReply(`❌ ${err.message}`);
    }





    const notes = [];

    try {
      if (channel.parent) {
        const categoryOverwrites = [...channel.parent.permissionOverwrites.cache.values()]
          .map(o => ({ id: o.id, type: o.type, allow: o.allow.bitfield, deny: o.deny.bitfield }));
        const overwrites = mergeChannelOverwrites(categoryOverwrites, targetUser.id, {
          type: OverwriteType.Member,
          allow: PLAYER_CHANNEL_PERMISSIONS,
        });
        await channel.permissionOverwrites.set(overwrites, `Reenlazado como canal de modmail de ${targetUser.tag} por ${interaction.user.tag}`);
        notes.push('✅ permisos reaplicados desde su categoría actual');
      } else {
        notes.push('⚠️ el canal no está dentro de ninguna categoría — permisos NO tocados, revísalos a mano');
      }
    } catch (err) {
      notes.push(`⚠️ no se pudieron reaplicar los permisos: ${err.message}`);
    }

    const displayName = updated.character_name ?? updated.username;
    const desiredName = `rp-${slugify(displayName)}`;
    if (channel.name !== desiredName) {
      try {
        await channel.setName(desiredName, `Reenlazado como canal de modmail de ${targetUser.tag}`);
        notes.push(`✅ renombrado de #${channel.name} a #${desiredName}`);
      } catch (err) {
        notes.push(`⚠️ no se pudo renombrar (se queda como #${channel.name}): ${err.message}`);
      }
    }

    try {
      const didPost = await postCharacterInfoCard(interaction.client, channel.id, updated);
      notes.push(didPost ? '✅ ficha de personaje publicada y fijada' : 'ℹ️ ya tenía una ficha publicada, no se duplicó');
    } catch (err) {
      notes.push(`⚠️ no se pudo publicar la ficha: ${err.message}`);
    }

    logger.info(
      `[/modmail-relink] ${interaction.user.tag} enlazó #${channel.name} (${channel.id}) como canal de modmail de ` +
      `"${displayName}" (${targetUser.id}) — antes: ${previousChannelId ?? 'ninguno'}`
    );
    logAction({
      source: 'discord', actorDiscordId: interaction.user.id, actorUsername: interaction.user.tag,
      action: 'modmail.relink_channel', target: targetUser.id,
      details: { newChannelId: channel.id, previousChannelId },
    });

    const embed = new EmbedBuilder()
      .setColor(COLORS.GREEN)
      .setTitle('🔗 Canal de modmail reenlazado')
      .setDescription(
        `**${displayName}** ahora usa <#${channel.id}> como su canal oficial de modmail.\n` +
        (previousChannelId
          ? `Antes apuntaba a \`${previousChannelId}\` (ese canal NO se ha tocado ni borrado — bórralo a mano si ya no hace falta).`
          : 'No tenía ningún canal enlazado antes.')
      )
      .addFields({ name: '📋 Detalle', value: notes.join('\n') })
      .setTimestamp();

    return interaction.editReply({ embeds: [embed] });
  },
};
