























import { SlashCommandBuilder, EmbedBuilder, MessageFlags } from 'discord.js';
import { getOrCreatePlayer } from '../../services/playerService.js';
import {
  adminSetLaburo, getDayAmount, setDayAmount, earnLaburo, spendLaburo, getAvailableLaburo,
} from '../../services/laburoService.js';
import { requireRolepriest } from '../../utils/permissions.js';
import { COLORS }       from '../../utils/embeds.js';
import { getAvatarUrl } from '../../utils/playerAvatar.js';
import logger            from '../../utils/logger.js';
import { logAction }     from '../../services/auditLogService.js';

export default {
  data: new SlashCommandBuilder()
    .setName('laburo-admin')
    .setDescription('[Staff] Ajusta el saldo de Laburo de un jugador, o la cantidad base diaria')


    .addSubcommand(sub =>
      sub
        .setName('add')
        .setDescription('Suma Laburo al saldo de un jugador')
        .addUserOption(opt => opt.setName('jugador').setDescription('Jugador').setRequired(true))
        .addNumberOption(opt => opt.setName('cantidad').setDescription('Cantidad a sumar').setRequired(true).setMinValue(0.01))
        .addStringOption(opt => opt.setName('motivo').setDescription('Motivo del ajuste').setRequired(false))
    )


    .addSubcommand(sub =>
      sub
        .setName('remove')
        .setDescription('Resta Laburo del saldo de un jugador (falla si no tiene suficiente)')
        .addUserOption(opt => opt.setName('jugador').setDescription('Jugador').setRequired(true))
        .addNumberOption(opt => opt.setName('cantidad').setDescription('Cantidad a restar').setRequired(true).setMinValue(0.01))
        .addStringOption(opt => opt.setName('motivo').setDescription('Motivo del ajuste').setRequired(false))
    )


    .addSubcommand(sub =>
      sub
        .setName('reset')
        .setDescription('Pone a 0 el Laburo de un jugador')
        .addUserOption(opt => opt.setName('jugador').setDescription('Jugador a resetear').setRequired(true))
        .addStringOption(opt => opt.setName('motivo').setDescription('Motivo (ej: explotación de mecánica)').setRequired(false))
    )


    .addSubcommand(sub =>
      sub
        .setName('set')
        .setDescription('Fija el Laburo de un jugador a un valor exacto')
        .addUserOption(opt => opt.setName('jugador').setDescription('Jugador a modificar').setRequired(true))
        .addNumberOption(opt => opt.setName('cantidad').setDescription('Nuevo saldo exacto de Laburo').setRequired(true).setMinValue(0))
        .addStringOption(opt => opt.setName('motivo').setDescription('Motivo del ajuste').setRequired(false))
    )


    .addSubcommand(sub =>
      sub
        .setName('dia')
        .setDescription('Fija cuánto Laburo base da /laburo trabajar a cualquier jugador')
        .addNumberOption(opt => opt.setName('cantidad').setDescription('Nueva cantidad base').setRequired(true).setMinValue(0))
    ),


  async execute(interaction) {
    if (!await requireRolepriest(interaction)) return;

    const sub = interaction.options.getSubcommand();




    if (sub === 'dia') {
      const cantidad = interaction.options.getNumber('cantidad', true);
      const before = await getDayAmount();

      try {
        await setDayAmount(cantidad);
      } catch (err) {
        return interaction.reply({ content: `❌ ${err.message}`, flags: MessageFlags.Ephemeral });
      }

      logger.info(`[/laburo-admin dia] ${interaction.user.tag}: ${before} → ${cantidad}`);
      logAction({ source: 'discord', actorDiscordId: interaction.user.id, actorUsername: interaction.user.tag, action: 'settings.laburo_day_amount', details: { before, after: cantidad } });

      return interaction.reply({
        embeds: [
          new EmbedBuilder()
            .setColor(COLORS.BLUE)
            .setTitle('⚒️ Cantidad base de /laburo trabajar actualizada')
            .setDescription(`**${before}** → **${cantidad}** por cada \`/laburo trabajar\` (antes de efectos activos)`)
            .setFooter({ text: `Cambiado por ${interaction.user.tag}` })
            .setTimestamp(),
        ],
      });
    }




    if (sub === 'add' || sub === 'remove') {
      const targetUser = interaction.options.getUser('jugador', true);
      const cantidad    = interaction.options.getNumber('cantidad', true);
      const motivo      = interaction.options.getString('motivo') ?? null;

      const player = await getOrCreatePlayer(targetUser.id, targetUser.username);

      try {
        if (sub === 'add') await earnLaburo(targetUser.id, cantidad);
        else await spendLaburo(targetUser.id, cantidad);
      } catch (err) {
        return interaction.reply({ content: `❌ ${err.message}`, flags: MessageFlags.Ephemeral });
      }

      const newBalance = await getAvailableLaburo(targetUser.id);

      logger.info(
        `[/laburo-admin ${sub}] ${interaction.user.tag} → ${targetUser.tag}: ` +
        `${sub === 'add' ? '+' : '-'}${cantidad} (nuevo saldo: ${newBalance})${motivo ? ` (motivo: ${motivo})` : ''}`
      );
      logAction({ source: 'discord', actorDiscordId: interaction.user.id, actorUsername: interaction.user.tag, action: `player.laburo_${sub}`, target: targetUser.id, details: { cantidad, newBalance, motivo } });

      const embed = new EmbedBuilder()
        .setColor(sub === 'add' ? COLORS.GREEN : COLORS.RED)
        .setTitle(sub === 'add' ? '➕ Laburo añadido' : '➖ Laburo retirado')
        .addFields(
          { name: '👤 Jugador',    value: `<@${targetUser.id}>`, inline: true },
          { name: sub === 'add' ? '➕ Cantidad' : '➖ Cantidad', value: `${sub === 'add' ? '+' : '-'}${cantidad}`, inline: true },
          { name: '💪 Saldo actual', value: `**${newBalance}**`, inline: true }
        )
        .setFooter({ text: `Operación de ${interaction.user.tag}` })
        .setTimestamp();

      if (motivo) embed.setDescription(`📋 *Motivo: ${motivo}*`);

      const avatarUrl = getAvatarUrl(player, `/laburo-admin ${sub}`);
      if (avatarUrl) embed.setThumbnail(avatarUrl);

      return interaction.reply({ embeds: [embed] });
    }




    const targetUser  = interaction.options.getUser('jugador', true);
    const motivo      = interaction.options.getString('motivo') ?? null;
    const newQuantity = sub === 'reset' ? 0 : interaction.options.getNumber('cantidad', true);

    const player = await getOrCreatePlayer(targetUser.id, targetUser.username);

    let result;
    try {
      result = await adminSetLaburo(targetUser.id, newQuantity);
    } catch (err) {
      return interaction.reply({ content: `❌ ${err.message}`, flags: MessageFlags.Ephemeral });
    }

    logger.info(
      `[/laburo-admin ${sub}] ${interaction.user.tag} → ${targetUser.tag}: ` +
      `Laburo fijado a ${newQuantity}${motivo ? ` (motivo: ${motivo})` : ''}`
    );
    logAction({ source: 'discord', actorDiscordId: interaction.user.id, actorUsername: interaction.user.tag, action: `player.laburo_${sub}`, target: targetUser.id, details: { newQuantity, motivo } });

    const embed = new EmbedBuilder()
      .setColor(sub === 'reset' ? COLORS.RED : COLORS.BLUE)
      .setTitle(sub === 'reset' ? '🔄 Laburo reseteado' : '✏️ Laburo ajustado')
      .addFields(
        { name: '👤 Jugador',    value: `<@${targetUser.id}>`,        inline: true },
        { name: '💪 Nuevo saldo', value: `**${result.newQuantity}**`, inline: true }
      )
      .setFooter({ text: `Operación de ${interaction.user.tag}` })
      .setTimestamp();

    if (motivo) embed.setDescription(`📋 *Motivo: ${motivo}*`);

    const avatarUrl = getAvatarUrl(player, '/laburo-admin');
    if (avatarUrl) embed.setThumbnail(avatarUrl);

    return interaction.reply({ embeds: [embed] });
  },
};
