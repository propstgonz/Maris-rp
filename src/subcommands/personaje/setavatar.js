


























import { EmbedBuilder, MessageFlags } from 'discord.js';

import { requireRolepriest, requireCharacter }    from '../../utils/permissions.js';
import { config }                            from '../../utils/permissions.js';
import { getPlayerByDiscordId, setAvatarFilename } from '../../services/playerService.js';
import { COLORS }                            from '../../utils/embeds.js';
import { buildAssetUrl }                     from '../../utils/publicUrl.js';
import {
  validateImageAttachment,
  downloadAndSaveImage,
  ALLOWED_IMAGE_TYPES_LABEL,
  MAX_IMAGE_SIZE_BYTES,
}                                             from '../../utils/imageUpload.js';
import logger                                from '../../utils/logger.js';









const AVATARS_WRITE_PATH = (config.images?.avatarsHostPath ?? '/app/avatars')
  .replace(/\/$/, '');

export default {
  build: (sub) => sub
    .setName("foto")
    .setDescription("Cambia la foto de tu personaje")
    .addAttachmentOption(opt =>
      opt
        .setName('imagen')
        .setDescription(`Imagen del personaje (${ALLOWED_IMAGE_TYPES_LABEL} · máx. 2 MB)`)
        .setRequired(true)
    )
    .addUserOption(opt =>
      opt
        .setName('jugador')
        .setDescription('[Staff] Jugador al que asignar el avatar (por defecto, tú mismo)')
        .setRequired(false)
    ),


  async execute(interaction) {
    const targetUser = interaction.options.getUser('jugador') ?? interaction.user;
    const attachment = interaction.options.getAttachment('imagen', true);



    if (targetUser.id === interaction.user.id) {
      if (!await requireCharacter(interaction)) return;
    } else {
      if (!await requireRolepriest(interaction)) return;
      if (!(await getPlayerByDiscordId(targetUser.id))?.character_created_at) {
        return interaction.reply({
          content: `❌ **${targetUser.username}** todavía no ha creado un personaje.`,
          flags: MessageFlags.Ephemeral,
        });
      }
    }


    const validation = validateImageAttachment(attachment, MAX_IMAGE_SIZE_BYTES);
    if (!validation.ok) {
      return interaction.reply({ content: `❌ ${validation.error}`, flags: MessageFlags.Ephemeral });
    }
    const { ext, mimeType } = validation;



    await interaction.deferReply();

    try {

      const player = await getPlayerByDiscordId(targetUser.id);


      const { buffer } = await downloadAndSaveImage(
        attachment, ext, AVATARS_WRITE_PATH, `player_${targetUser.id}`
      );

      logger.info(
        `[/setavatar] ${interaction.user.tag} → avatar de ${player.username} guardado ` +
        `(${(buffer.length / 1024).toFixed(1)} KB, ${mimeType})`
      );



      const relativeFilename = `avatars/player_${targetUser.id}.${ext}`;
      await setAvatarFilename(targetUser.id, relativeFilename);




      const publicUrl = buildAssetUrl(relativeFilename, '/personaje foto');
      const isSelf    = targetUser.id === interaction.user.id;

      const embed = new EmbedBuilder()
        .setColor(COLORS.GREEN)
        .setTitle('✅ Avatar actualizado')
        .setDescription(
          isSelf
            ? `Tu avatar ha sido guardado correctamente.`
            : `El avatar de **${player.username}** ha sido guardado correctamente.`
        )
        .addFields(
          { name: '👤 Jugador',  value: `<@${targetUser.id}>`,     inline: true },
          { name: '🖼️ Formato', value: ext.toUpperCase(),          inline: true },
          { name: '📦 Tamaño',  value: `${(buffer.length / 1024).toFixed(1)} KB`, inline: true }
        )
        .setFooter({ text: isSelf ? `Actualizado por ${interaction.user.tag}` : `Actualizado por Staff: ${interaction.user.tag}` })
        .setTimestamp();

      if (publicUrl) {
        embed.setThumbnail(publicUrl);
      } else {
        embed.addFields({
          name:  '⚠️ Miniatura no disponible',
          value: 'El bucket de imágenes (`NGINX_BASE_URL`) no está configurado con una URL pública alcanzable.',
        });
      }

      return interaction.editReply({ embeds: [embed] });

    } catch (err) {
      logger.error(`[/setavatar] Error: ${err.message}`);

      return interaction.editReply({
        content: `❌ Error al guardar el avatar: ${err.message}`,
      });
    }
  },
};
