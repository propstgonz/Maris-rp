import { SlashCommandBuilder, EmbedBuilder, MessageFlags } from 'discord.js';
import { getPlayerByDiscordId } from '../../services/playerService.js';
import { getNpcsAtTile } from '../../services/npcService.js';
import { attemptTheft } from '../../services/theftService.js';
import { combatPhrase } from '../../utils/combatNarrative.js';
import { requireCharacter } from '../../utils/permissions.js';
import { COLORS } from '../../utils/embeds.js';
import { buildAssetUrl } from '../../utils/publicUrl.js';
import { logAction } from '../../services/auditLogService.js';
import logger from '../../utils/logger.js';

export default {
  data: new SlashCommandBuilder()
    .setName('robar')
    .setDescription('Intenta robarle algo a un NPC amistoso de tu casilla')
    .addIntegerOption(opt =>
      opt
        .setName('npc_id')
        .setDescription('Cuál, si hay varios NPCs en tu casilla (te lo dirá si hace falta)')
        .setRequired(false)
        .setMinValue(1)
    ),

  async execute(interaction) {
    if (!await requireCharacter(interaction)) return;

    const player = await getPlayerByDiscordId(interaction.user.id);
    const npcId = interaction.options.getInteger('npc_id');

    const npcsHere = await getNpcsAtTile(player.coord_x, player.coord_y);
    if (npcsHere.length === 0) {
      return interaction.reply({ content: '❌ No hay ningún NPC en tu casilla.', flags: MessageFlags.Ephemeral });
    }

    let npc;
    if (npcsHere.length === 1) {
      npc = npcsHere[0];
    } else if (npcId) {
      npc = npcsHere.find(n => n.id === npcId);
      if (!npc) {
        return interaction.reply({
          content: `❌ Ninguno de los NPCs de tu casilla tiene id ${npcId}. IDs disponibles: ${npcsHere.map(n => `${n.id} (${n.type_display_name})`).join(', ')}.`,
          flags: MessageFlags.Ephemeral,
        });
      }
    } else {
      return interaction.reply({
        content: `❌ Hay ${npcsHere.length} NPCs en tu casilla — indica \`npc_id\` para elegir a cuál robar. IDs: ${npcsHere.map(n => `${n.id} (${n.type_display_name})`).join(', ')}.`,
        flags: MessageFlags.Ephemeral,
      });
    }

    if (npc.is_aggressive) {
      return interaction.reply({
        content: `❌ **${npc.type_display_name}** es hostil — no puedes robarle, solo atacarlo con \`/attack\` o esperar a que se vaya.`,
        flags: MessageFlags.Ephemeral,
      });
    }

    const playerName = player.character_name ?? player.username;
    const result = await attemptTheft(interaction.client, interaction.user.id, npc);

    logger.info(
      `[/robar] ${interaction.user.tag} intentó robar a "${npc.type_display_name}" #${npc.id} → ` +
      `${result.success ? `ÉXITO (${result.item?.name ?? 'sin nada que robar'})` : 'FALLO'}`
    );

    if (result.success) {
      logAction({
        source: 'discord', actorDiscordId: interaction.user.id, actorUsername: interaction.user.tag,
        action: 'npc.theft_success', target: `(${npc.coord_x},${npc.coord_y})`,
        details: { npcId: npc.id, npcType: npc.type_display_name, item: result.item?.name ?? null },
      });

      const embed = new EmbedBuilder()
        .setColor(COLORS.GREEN)
        .setTitle('🤏 Robo conseguido')
        .setDescription(
          result.item
            ? `**${playerName}** aprovecha un despiste de **${npc.type_display_name}** y le quita ${result.item.emoji ?? '📦'} **${result.item.display_name}** ×1 sin que se dé cuenta.`
            : `**${playerName}** rebusca junto a **${npc.type_display_name}** sin que se dé cuenta — pero no lleva nada que merezca la pena.`
        )
        .setTimestamp();
      const npcThumb = buildAssetUrl(npc.image_filename, '/robar');
      if (npcThumb) embed.setThumbnail(npcThumb);

      return interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
    }

    const c = result.npcCounterattack;
    if (c?.hit) {
      logAction({
        source: 'discord', actorDiscordId: interaction.user.id, actorUsername: interaction.user.tag,
        action: 'combat.npc_counterattack_hit', target: interaction.user.id,
        details: {
          npcId: npc.id, npcType: npc.type_display_name, trigger: 'failed_theft',
          damage: c.damage, playerHpAfter: c.playerHpAfter,
          playerKilled: c.playerKilled, immortalitySaved: c.immortalitySaved,
        },
      });
    }

    const embed = new EmbedBuilder()
      .setColor(c?.hit ? COLORS.RED : COLORS.YELLOW)
      .setTitle('🤏 Robo fallido')
      .setDescription(
        !c
          ? `**${npc.type_display_name}** se da cuenta de lo que intenta **${playerName}**, pero no puede hacer nada al respecto.`
          : !c.inRange
          ? `**${npc.type_display_name}** se revuelve contra **${playerName}**, pero no llega a alcanzarlo.`
          : !c.hit
          ? combatPhrase({ category: 'unarmed', outcome: 'miss', attacker: npc.type_display_name, target: playerName })
          : `${combatPhrase({ category: 'unarmed', outcome: c.outcomeRoll === 6 ? 'crit' : 'hit', attacker: npc.type_display_name, target: playerName })} -${c.damage} HP` +
            (c.playerKilled
              ? ` 💀 **${playerName}** ha muerto por el ataque. Staff tiene 7 días para revivirlo (o puede rendirse antes con \`/personaje rendirse\`).`
              : c.immortalitySaved
                ? ' ♾️ Salvado por inmortalidad (clampeado a 1 HP).'
                : ` *(HP restante: ${c.playerHpAfter})*`)
      )
      .setTimestamp();
    const npcThumb = buildAssetUrl(npc.image_filename, '/robar');
    if (npcThumb) embed.setThumbnail(npcThumb);

    return interaction.reply({ embeds: [embed] });
  },
};
