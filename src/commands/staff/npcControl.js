import { SlashCommandBuilder, EmbedBuilder, MessageFlags } from 'discord.js';
import { getNpcsAtTile } from '../../services/npcService.js';
import { resolveNpcCounterattack } from '../../services/npcCombatService.js';
import { getPlayerByDiscordId } from '../../services/playerService.js';
import { combatPhrase } from '../../utils/combatNarrative.js';
import { requireRolepriest } from '../../utils/permissions.js';
import { COLORS } from '../../utils/embeds.js';
import { buildAssetUrl } from '../../utils/publicUrl.js';
import { logAction } from '../../services/auditLogService.js';
import logger from '../../utils/logger.js';

export default {
  data: new SlashCommandBuilder()
    .setName('npc-control')
    .setDescription('[Staff] Dispara el ataque de un NPC contra un jugador — narrado, o con daño real')
    .addIntegerOption(opt => opt.setName('npc_x').setDescription('Coordenada X del NPC').setRequired(true))
    .addIntegerOption(opt => opt.setName('npc_y').setDescription('Coordenada Y del NPC').setRequired(true))
    .addUserOption(opt => opt.setName('jugador').setDescription('Jugador objetivo del ataque').setRequired(true))
    .addIntegerOption(opt =>
      opt
        .setName('npc_id')
        .setDescription('Cuál, si hay varios NPCs en esa casilla (te lo dirá si hace falta)')
        .setRequired(false)
        .setMinValue(1)
    )
    .addStringOption(opt =>
      opt
        .setName('mensaje')
        .setDescription('Narración a mostrar en vez de la automática (obligatoria si danio_real:false)')
        .setRequired(false)
        .setMaxLength(500)
    )
    .addBooleanOption(opt =>
      opt.setName('danio_real').setDescription('Tira dados y aplica daño de verdad (por defecto: sí)').setRequired(false)
    ),

  async execute(interaction) {
    if (!await requireRolepriest(interaction)) return;

    const npcX = interaction.options.getInteger('npc_x', true);
    const npcY = interaction.options.getInteger('npc_y', true);
    const npcId = interaction.options.getInteger('npc_id');
    const targetUser = interaction.options.getUser('jugador', true);
    const mensaje = interaction.options.getString('mensaje')?.trim() || null;
    const danioReal = interaction.options.getBoolean('danio_real') ?? true;

    const npcsHere = await getNpcsAtTile(npcX, npcY);
    if (npcsHere.length === 0) {
      return interaction.reply({ content: `❌ No hay ningún NPC en (${npcX}, ${npcY}).`, flags: MessageFlags.Ephemeral });
    }

    let npc;
    if (npcsHere.length === 1) {
      npc = npcsHere[0];
    } else if (npcId) {
      npc = npcsHere.find(n => n.id === npcId);
      if (!npc) {
        return interaction.reply({
          content: `❌ Ninguno de los NPCs de (${npcX}, ${npcY}) tiene id ${npcId}. IDs disponibles: ${npcsHere.map(n => `${n.id} (${n.type_display_name})`).join(', ')}.`,
          flags: MessageFlags.Ephemeral,
        });
      }
    } else {
      return interaction.reply({
        content: `❌ Hay ${npcsHere.length} NPCs en (${npcX}, ${npcY}) — indica \`npc_id\` para elegir cuál. IDs: ${npcsHere.map(n => `${n.id} (${n.type_display_name})`).join(', ')}.`,
        flags: MessageFlags.Ephemeral,
      });
    }

    const player = await getPlayerByDiscordId(targetUser.id);
    if (!player?.character_created_at) {
      return interaction.reply({ content: `❌ **${targetUser.username}** todavía no ha creado un personaje.`, flags: MessageFlags.Ephemeral });
    }
    if (!player.is_alive) {
      return interaction.reply({ content: `❌ **${player.character_name ?? player.username}** ya está muerto.`, flags: MessageFlags.Ephemeral });
    }
    const playerName = player.character_name ?? player.username;

    if (!danioReal) {
      if (!mensaje) {
        return interaction.reply({
          content: '❌ Escribe un `mensaje` para narrar sin daño real (o pon `danio_real:true` para que se resuelva con tirada).',
          flags: MessageFlags.Ephemeral,
        });
      }

      logAction({
        source: 'discord', actorDiscordId: interaction.user.id, actorUsername: interaction.user.tag,
        action: 'staff.npc_control_narrate', target: targetUser.id,
        details: { npcId: npc.id, npcType: npc.type_display_name, message: mensaje },
      });

      const embed = new EmbedBuilder()
        .setColor(COLORS.YELLOW)
        .setTitle(`${npc.type_emoji ?? '👤'} ${npc.type_display_name}`)
        .setDescription(mensaje)
        .addFields({ name: '🎯 Objetivo', value: `**${playerName}**`, inline: true })
        .setFooter({ text: `Narrado por ${interaction.user.tag} — sin daño mecánico` })
        .setTimestamp();
      const npcThumb = buildAssetUrl(npc.image_filename, '/npc-control');
      if (npcThumb) embed.setThumbnail(npcThumb);

      return interaction.reply({ embeds: [embed] });
    }

    let counter;
    try {
      counter = await resolveNpcCounterattack(interaction.client, targetUser.id, npc);
    } catch (err) {
      return interaction.reply({ content: `❌ ${err.message}`, flags: MessageFlags.Ephemeral });
    }
    if (!counter) {
      return interaction.reply({
        content: `❌ **${npc.type_display_name}** no puede atacar ahora mismo — no tiene arma asignada, o el combate está bloqueado (protección/zona segura) en su casilla.`,
        flags: MessageFlags.Ephemeral,
      });
    }

    logger.info(
      `[/npc-control] ${interaction.user.tag} disparó el ataque de "${npc.type_display_name}" #${npc.id} contra ${targetUser.tag} ` +
      `(tirada ${counter.outcomeRoll ?? 'n/a'}) → ${!counter.inRange ? 'NO ALCANZA' : counter.hit ? `IMPACTO -${counter.damage} HP` : 'FALLA'}`
    );
    if (counter.hit) {
      logAction({
        source: 'discord', actorDiscordId: interaction.user.id, actorUsername: interaction.user.tag,
        action: 'combat.npc_counterattack_hit', target: targetUser.id,
        details: {
          npcId: npc.id, npcType: npc.type_display_name, trigger: 'rolepriest_manual',
          damage: counter.damage, playerHpAfter: counter.playerHpAfter,
          playerKilled: counter.playerKilled, immortalitySaved: counter.immortalitySaved,
        },
      });
    }

    const narrativePhrase = mensaje ?? combatPhrase({
      category: 'unarmed',
      outcome: (!counter.inRange || !counter.hit) ? 'miss' : (counter.outcomeRoll === 6 ? 'crit' : 'hit'),
      attacker: npc.type_display_name, target: playerName,
    });

    const embed = new EmbedBuilder()
      .setColor(counter.hit ? COLORS.RED : COLORS.GREY)
      .setTitle(`${npc.type_emoji ?? '👤'} ${counter.hit ? '¡Impacto!' : 'Ataque fallido'}`)
      .addFields(
        { name: '👤 NPC',      value: `**${npc.type_display_name}** (${npc.coord_x}, ${npc.coord_y})`, inline: true },
        { name: '🎯 Objetivo', value: `**${playerName}**`, inline: true }
      )
      .setFooter({ text: `Disparado por ${interaction.user.tag}` })
      .setTimestamp();

    if (!counter.inRange) {
      embed.setDescription(`${narrativePhrase}\n\n**${npc.type_display_name}** no llega a alcanzar a **${playerName}** a esa distancia.`);
    } else if (!counter.hit) {
      embed.setDescription(`${narrativePhrase}\n\nEl ataque falla, sin más consecuencias.`);
    } else {
      embed.addFields(
        { name: '💥 Daño', value: `-${counter.damage} HP`, inline: true },
        { name: '❤️ HP restante', value: `${counter.playerHpAfter}`, inline: true }
      );
      let desc = narrativePhrase;
      if (counter.playerKilled) {
        desc += `\n\n💀 **${playerName}** ha muerto por este ataque. Staff tiene 7 días para revivirlo antes del borrado automático (o puede rendirse antes con \`/personaje rendirse\`).`;
      } else if (counter.immortalitySaved) {
        desc += `\n\n♾️ **${playerName}** es inmortal — el golpe habría sido letal, pero se ha clampeado a 1 HP.`;
      }
      embed.setDescription(desc);
    }

    const npcThumb = buildAssetUrl(npc.image_filename, '/npc-control');
    if (npcThumb) embed.setThumbnail(npcThumb);

    return interaction.reply({ embeds: [embed] });
  },
};
