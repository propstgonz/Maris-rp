



















import { SlashCommandBuilder, EmbedBuilder, MessageFlags } from 'discord.js';
import { sendBroadcast } from '../../services/broadcastService.js';
import { requireRolepriest } from '../../utils/permissions.js';
import { COLORS } from '../../utils/embeds.js';
import logger from '../../utils/logger.js';
import { logAction } from '../../services/auditLogService.js';

const MAX_IMAGES = 4;

const data = new SlashCommandBuilder()
  .setName('broadcast')
  .setDescription('[Staff] Manda un MD a todos los jugadores registrados')
  .addStringOption(opt =>
    opt
      .setName('mensaje')
      .setDescription('Texto del MD (se le añade una cabecera indicando que es un aviso de Staff)')
      .setRequired(true)
      .setMaxLength(1500)
  );
for (let i = 1; i <= MAX_IMAGES; i++) {
  data.addAttachmentOption(opt =>
    opt.setName(`imagen${i}`).setDescription(`Imagen ${i}/${MAX_IMAGES} a adjuntar al MD (opcional)`).setRequired(false)
  );
}

export default {
  data,


  async execute(interaction) {
    if (!await requireRolepriest(interaction)) return;

    const mensaje = interaction.options.getString('mensaje', true);
    const attachments = [];
    for (let i = 1; i <= MAX_IMAGES; i++) {
      const attachment = interaction.options.getAttachment(`imagen${i}`);
      if (attachment) attachments.push(attachment);
    }
    const notImage = attachments.find(a => !a.contentType?.startsWith('image/'));
    if (notImage) {
      return interaction.reply({
        content: `❌ **${notImage.name}** no es una imagen (${notImage.contentType ?? 'tipo desconocido'}) — solo se aceptan imágenes.`,
        flags: MessageFlags.Ephemeral,
      });
    }

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const imageUrls = attachments.map(a => a.url);
    const { sent, failed, totalTargets } = await sendBroadcast(interaction.client, mensaje, imageUrls);

    logger.info(`[/broadcast] ${interaction.user.tag} → ${sent}/${totalTargets} jugadores (${failed} fallidos, ${attachments.length} imagen(es))`);
    logAction({
      source: 'discord',
      actorDiscordId: interaction.user.id,
      actorUsername: interaction.user.tag,
      action: 'staff.broadcast',
      details: { message: mensaje, totalTargets, sent, failed, images: attachments.length },
    });

    const embed = new EmbedBuilder()
      .setColor(COLORS.BLUE)
      .setTitle('📢 Broadcast enviado')
      .addFields(
        { name: '✅ Entregados', value: String(sent), inline: true },
        { name: '❌ Fallidos', value: String(failed), inline: true },
        { name: '👥 Total registrados', value: String(totalTargets), inline: true },
        { name: '📋 Mensaje', value: mensaje.length > 1000 ? `${mensaje.slice(0, 1000)}…` : mensaje }
      )
      .setTimestamp();
    if (attachments.length > 0) embed.setImage(attachments[0].url);

    return interaction.editReply({ embeds: [embed] });
  },
};
