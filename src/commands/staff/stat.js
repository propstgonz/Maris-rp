














import { SlashCommandBuilder, EmbedBuilder, MessageFlags } from 'discord.js';
import { getOrCreatePlayer, getPlayerStats, updateStats } from '../../services/playerService.js';
import { markDeceased }  from '../../services/characterLifecycleService.js';
import { setInventoryCapacity } from '../../services/inventoryService.js';
import { requireRolepriest, MAX_HP, MAX_HUNGER } from '../../utils/permissions.js';
import { COLORS }        from '../../utils/embeds.js';
import { getAvatarUrl }  from '../../utils/playerAvatar.js';
import logger            from '../../utils/logger.js';
import { logAction }     from '../../services/auditLogService.js';


const STAT_META = {
  hp: {
    label: 'Salud (HP)',
    emoji: '❤️',
    min:   0,
    max:   MAX_HP,
    unit:  `/ ${MAX_HP}`,
  },
  hunger: {
    label: 'Hambre',
    emoji: '🍖',
    min:   0,
    max:   MAX_HUNGER,
    unit:  `/ ${MAX_HUNGER}`,
  },



  inventory_capacity: {
    label: 'Capacidad de inventario',
    emoji: '🎒',
    min:   0.01,
    max:   Infinity,
    unit:  '',
  },
};

export default {
  data: new SlashCommandBuilder()
    .setName('stat')
    .setDescription('Gestiona atributos base de un jugador')

    .addSubcommand(sub =>
      sub
        .setName('modify')
        .setDescription('[Staff] Modifica el HP o el Hambre de un jugador')
        .addUserOption(opt =>
          opt.setName('jugador').setDescription('Jugador a modificar').setRequired(true)
        )
        .addStringOption(opt =>
          opt
            .setName('stat')
            .setDescription('Atributo a cambiar')
            .setRequired(true)
            .addChoices(
              { name: '❤️ Salud (HP)', value: 'hp' },
              { name: '🍖 Hambre',     value: 'hunger' },
              { name: '🎒 Capacidad de inventario', value: 'inventory_capacity' }
            )
        )
        .addNumberOption(opt =>
          opt
            .setName('valor')
            .setDescription('Nuevo valor del atributo')
            .setRequired(true)
            .setMinValue(0)
        )
    ),


  async execute(interaction) {
    if (!await requireRolepriest(interaction)) return;

    const targetUser = interaction.options.getUser('jugador', true);
    const statKey    = interaction.options.getString('stat', true);
    const newValue   = interaction.options.getNumber('valor', true);

    const meta = STAT_META[statKey];
    if (!meta) {
      return interaction.reply({
        content: `❌ Atributo desconocido: \`${statKey}\`.`,
        flags: MessageFlags.Ephemeral,
      });
    }


    await getOrCreatePlayer(targetUser.id, targetUser.username);


    const before = await getPlayerStats(targetUser.id);
    if (!before) {
      return interaction.reply({
        content: `❌ No se encontraron datos del jugador.`,
        flags: MessageFlags.Ephemeral,
      });
    }

    const oldValue = before[statKey];





    if (statKey === 'inventory_capacity') {
      let newCapacity;
      try {
        newCapacity = await setInventoryCapacity(targetUser.id, newValue);
      } catch (err) {
        return interaction.reply({ content: `❌ ${err.message}`, flags: MessageFlags.Ephemeral });
      }

      logger.info(`[/stat modify] ${interaction.user.tag} → ${targetUser.tag}: inventory_capacity ${oldValue} → ${newCapacity}`);
      logAction({ source: 'discord', actorDiscordId: interaction.user.id, actorUsername: interaction.user.tag, action: 'player.update_stats', target: targetUser.id, details: { inventory_capacity: newCapacity } });

      return interaction.reply({
        embeds: [
          new EmbedBuilder()
            .setColor(COLORS.BLUE)
            .setTitle('✏️ Atributo modificado')
            .addFields(
              { name: '👤 Jugador', value: `<@${targetUser.id}>`, inline: true },
              { name: `${meta.emoji} ${meta.label}`, value: `**${oldValue}** → **${newCapacity}**`, inline: true }
            )
            .setFooter({ text: `Modificado por ${interaction.user.tag}` })
            .setTimestamp(),
        ],
      });
    }




    const immortalitySaved = statKey === 'hp' && Boolean(before.is_immortal) && newValue <= 0;
    const effectiveValue   = immortalitySaved ? 1 : newValue;


    let updated;
    try {
      updated = await updateStats(targetUser.id, { [statKey]: effectiveValue });
    } catch (err) {
      return interaction.reply({ content: `❌ ${err.message}`, flags: MessageFlags.Ephemeral });
    }

    const realNewValue = updated[statKey];





    let diedNow = false;
    if (statKey === 'hp' && realNewValue <= 0 && before.is_alive) {
      updated = await markDeceased(interaction.client, targetUser.id, `vida reducida a 0 por Staff (\`/stat modify\`, ${interaction.user.tag})`);
      diedNow = true;
    }


    const wasClamped =
      newValue > meta.max ? ` *(clampeado al máximo: ${meta.max})*` :
      newValue < meta.min ? ` *(clampeado al mínimo: ${meta.min})*` :
      '';

    logger.info(
      `[/stat modify] ${interaction.user.tag} → ${targetUser.tag}: ` +
      `${statKey} ${oldValue} → ${realNewValue}${diedNow ? ' (murió)' : ''}${immortalitySaved ? ' (salvado por inmortalidad)' : ''}`
    );
    logAction({ source: 'discord', actorDiscordId: interaction.user.id, actorUsername: interaction.user.tag, action: 'player.update_stats', target: targetUser.id, details: { [statKey]: realNewValue, diedNow } });

    const embed = new EmbedBuilder()
      .setColor(diedNow ? COLORS.BLACK : COLORS.BLUE)
      .setTitle(diedNow ? '💀 Atributo modificado — el personaje ha muerto' : '✏️ Atributo modificado')
      .addFields(
        { name: '👤 Jugador', value: `<@${targetUser.id}>`, inline: true },
        {
          name:   `${meta.emoji} ${meta.label}`,
          value:  `**${oldValue}** → **${realNewValue}** ${meta.unit}${wasClamped}`,
          inline: true,
        }
      )
      .setFooter({ text: `Modificado por ${interaction.user.tag}` })
      .setTimestamp();

    if (diedNow) {
      embed.setDescription(
        'Tiene **7 días** de gracia para que Staff lo revida (`/revive`) antes del borrado automático del personaje ' +
        '(o puede rendirse antes con `/personaje rendirse`).'
      );
    } else if (immortalitySaved) {
      embed.setDescription(`♾️ **${targetUser.username}** es inmortal — se ha clampeado a 1 en vez de morir.`);
    }

    const avatarUrl = getAvatarUrl(updated, '/stat modify');
    if (avatarUrl) embed.setThumbnail(avatarUrl);

    return interaction.reply({ embeds: [embed] });
  },
};
