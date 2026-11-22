






















import { EmbedBuilder, MessageFlags } from 'discord.js';

import { getPlayerByDiscordId } from '../../services/playerService.js';
import { consumeItem }   from '../../services/consumeService.js';
import { requireRolepriest, requireCharacter, MAX_HP, MAX_HUNGER } from '../../utils/permissions.js';
import { COLORS }        from '../../utils/embeds.js';
import { getEffectType } from '../../services/effectTypesService.js';
import { buildAssetUrl } from '../../utils/publicUrl.js';
import { handleItemAutocomplete } from '../../utils/autocomplete.js';
import logger             from '../../utils/logger.js';


function formatDelta(before, after, max) {
  const delta = after - before;
  if (delta === 0) return `**${after}/${max}** *(sin cambio)*`;
  const sign = delta > 0 ? `+${delta}` : `${delta}`;
  return `${before}/${max} → **${after}/${max}** (${sign})`;
}


export default {
  build: (sub) => sub
    .setName("usar")
    .setDescription("Consume un objeto de tu inventario")
    .addStringOption(opt =>
      opt
        .setName('item')
        .setDescription('Nombre del ítem a consumir (ej: pan, pocion_energia)')
        .setRequired(true)
        .setAutocomplete(true)
    )
    .addUserOption(opt =>
      opt
        .setName('jugador')
        .setDescription('[Staff] Jugador que consume el ítem (por defecto: tú mismo)')
        .setRequired(false)
    ),


  async autocomplete(interaction) {


    await handleItemAutocomplete(interaction, { onlyConsumable: true });
  },

  async execute(interaction) {
    const targetUser = interaction.options.getUser('jugador') ?? interaction.user;
    const itemName   = interaction.options.getString('item', true).toLowerCase().trim();
    const isSelf     = targetUser.id === interaction.user.id;

    if (isSelf) {
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

    const player = await getPlayerByDiscordId(targetUser.id);
    if (!player.is_alive) {
      return interaction.reply({
        content: `❌ **${player.username}** está muerto y no puede consumir ítems.`,
        flags: MessageFlags.Ephemeral,
      });
    }






    const result = await consumeItem(interaction.client, targetUser.id, itemName);
    const { item, hpBefore, hungerBefore, hpAfter, hungerAfter, died, immortalitySaved } = result;

    logger.info(
      `[/consume] ${interaction.user.tag} → "${item.display_name}" para ${targetUser.tag} ` +
      `| HP ${hpBefore}→${hpAfter} Hambre ${hungerBefore}→${hungerAfter}${died ? ' (murió)' : ''}`
    );

    const embed = new EmbedBuilder()
      .setColor(died ? COLORS.BLACK : COLORS.PURPLE)
      .setTitle(
        died
          ? `${item.emoji ?? '🎒'} ${player.username} consumió ${item.display_name} — y murió`
          : `${item.emoji ?? '🎒'} ${player.username} consumió ${item.display_name}`
      )
      .addFields(
        { name: '❤️ Salud',  value: formatDelta(hpBefore,     hpAfter,     MAX_HP),     inline: true },
        { name: '🍖 Hambre', value: formatDelta(hungerBefore, hungerAfter, MAX_HUNGER), inline: true }
      )
      .setTimestamp();

    if (died) {
      embed.setDescription(
        `💀 **${item.display_name}** resultó fatal. Tiene **7 días** de gracia para que Staff lo revida ` +
        '(`/revive`) antes del borrado automático del personaje (o puede rendirse antes con `/personaje rendirse`).'
      );
    } else if (immortalitySaved) {
      embed.setDescription(`♾️ **${player.username}** es inmortal — esto habría sido fatal, pero se ha clampeado a 1 HP.`);
    }



    if (!died && item.consume_effect) {
      const meta     = await getEffectType(item.consume_effect);
      const duration = item.consume_effect_duration_hours != null
        ? `${item.consume_effect_duration_hours} horas`
        : 'permanente';

      const modLines = [];
      if ((meta?.laburo_modifier ?? 0) !== 0)
        modLines.push(`Laburo ${meta.laburo_modifier > 0 ? '+' : ''}${meta.laburo_modifier}/laburar`);
      if ((meta?.hp_delta_per_day ?? 0) !== 0)
        modLines.push(`HP ${meta.hp_delta_per_day > 0 ? '+' : ''}${meta.hp_delta_per_day}/día`);

      embed.addFields({
        name:  `${meta?.emoji ?? '🎭'} Efecto: ${meta?.label ?? item.consume_effect}`,
        value: `Duración: **${duration}**${modLines.length ? '\n' + modLines.join(' · ') : ''}`,
      });
    }

    if (hpBefore === hpAfter && hungerBefore === hungerAfter && !item.consume_effect) {
      embed.setDescription('*El ítem fue consumido pero no tuvo efecto visible.*');
    }

    const itemThumb = buildAssetUrl(item.image_filename, '/item usar');
    if (itemThumb) embed.setThumbnail(itemThumb);

    return interaction.reply({ embeds: [embed] });
  },
};
