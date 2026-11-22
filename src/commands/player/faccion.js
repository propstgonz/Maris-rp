import { SlashCommandBuilder, EmbedBuilder, MessageFlags } from 'discord.js';
import { listFactions, getFactionByName, getPlayerMembership, setMembership, createApplication } from '../../services/factionService.js';
import { sendApplicationToOwner } from '../../services/factionNotificationService.js';
import { getPlayerByDiscordId, findPlayerById } from '../../services/playerService.js';
import { requireCharacter, resolveMember, isRolepriest } from '../../utils/permissions.js';
import { resolvePermission, getFactionRanks, getFactionRankByName, getRankRequirements, setRankRequirement, setPlayerRank, assertNotActingOnSuperior } from '../../services/permissionService.js';
import { getStorageContents, depositItem, withdrawItem } from '../../services/factionStorageService.js';
import { PERMISSION_ACTIONS } from '../../utils/permissionActions.js';
import { handleFactionAutocomplete, handleItemAutocomplete } from '../../utils/autocomplete.js';
import { buildFactionPickerMessage } from '../../components/factionFlow.js';
import { COLORS }           from '../../utils/embeds.js';
import logger                 from '../../utils/logger.js';

export default {
  data: new SlashCommandBuilder()
    .setName('faccion')
    .setDescription('Consulta el catálogo de facciones, o gestiona tu ciudadanía')

    .addSubcommand(sub => sub.setName('list').setDescription('Lista el catálogo de facciones y cuántas casillas/ciudadanos tiene cada una'))

    .addSubcommand(sub =>
      sub
        .setName('solicitar')
        .setDescription('Solicita incorporarte a una facción (el dueño tiene que aceptarte)')

        .addStringOption(opt => opt.setName('faccion').setDescription('Facción a la que solicitar. Si la omites, se abre un menú').setRequired(false).setAutocomplete(true))
    )

    .addSubcommand(sub => sub.setName('abandonar').setDescription('Abandona tu facción actual'))

    .addSubcommand(sub =>
      sub
        .setName('expulsar')
        .setDescription('[Rolepriest, o el dueño de la facción] Quita la ciudadanía a un jugador')
        .addStringOption(opt => opt.setName('faccion').setDescription('Facción').setRequired(true).setAutocomplete(true))
        .addUserOption(opt => opt.setName('jugador').setDescription('Jugador a expulsar').setRequired(true))
    )

    .addSubcommand(sub =>
      sub
        .setName('rangos')
        .setDescription('Consulta la escalera de rangos de una facción y sus permisos configurados')
        .addStringOption(opt => opt.setName('faccion').setDescription('Facción').setRequired(true).setAutocomplete(true))
    )

    .addSubcommand(sub =>
      sub
        .setName('permisos')
        .setDescription('Fija a partir de qué rango se puede hacer una acción en tu facción')
        .addStringOption(opt => opt.setName('faccion').setDescription('Facción').setRequired(true).setAutocomplete(true))
        .addStringOption(opt => opt.setName('accion').setDescription('Acción a configurar').setRequired(true)
          .addChoices(...Object.entries(PERMISSION_ACTIONS).map(([value, name]) => ({ name, value }))))
        .addIntegerOption(opt => opt.setName('rango').setDescription('Rango mínimo requerido (0 = Miembro). Omite para quitar la restricción').setRequired(false).setMinValue(0))
    )

    .addSubcommand(sub =>
      sub
        .setName('ascender')
        .setDescription('Cambia el rango de un miembro de tu facción')
        .addUserOption(opt => opt.setName('jugador').setDescription('Miembro a ascender/descender').setRequired(true))
        .addStringOption(opt => opt.setName('rango').setDescription('Nuevo rango (nombre clave, ver /faccion rangos)').setRequired(true).setAutocomplete(true))
    )

    .addSubcommand(sub => sub.setName('almacen_ver').setDescription('Consulta lo que hay guardado en el almacén de tu facción'))

    .addSubcommand(sub =>
      sub
        .setName('almacen_depositar')
        .setDescription('Deposita ítems de tu inventario en el almacén de tu facción')
        .addStringOption(opt => opt.setName('item').setDescription('Ítem a depositar').setRequired(true).setAutocomplete(true))
        .addNumberOption(opt => opt.setName('cantidad').setDescription('Unidades a depositar').setRequired(true).setMinValue(0.01))
    )

    .addSubcommand(sub =>
      sub
        .setName('almacen_retirar')
        .setDescription('Retira ítems del almacén de tu facción a tu inventario')
        .addStringOption(opt => opt.setName('item').setDescription('Ítem a retirar').setRequired(true).setAutocomplete(true))
        .addNumberOption(opt => opt.setName('cantidad').setDescription('Unidades a retirar').setRequired(true).setMinValue(0.01))
    ),

  async autocomplete(interaction) {
    const focused = interaction.options.getFocused(true);
    if (focused.name === 'item') return handleItemAutocomplete(interaction);
    if (focused.name !== 'rango') return handleFactionAutocomplete(interaction);

    const targetUser = interaction.options.getUser('jugador');
    const targetPlayer = targetUser ? await getPlayerByDiscordId(targetUser.id) : null;
    if (!targetPlayer?.faction_id) return interaction.respond([]).catch(() => {});

    const ranks = await getFactionRanks(targetPlayer.faction_id);
    const needle = String(focused.value ?? '').toLowerCase();
    const choices = ranks
      .filter(r => r.name.includes(needle) || r.display_name.toLowerCase().includes(needle))
      .map(r => ({ name: `${r.emoji ?? ''} ${r.display_name}`.trim(), value: r.name }));
    return interaction.respond(choices).catch(() => {});
  },

  async execute(interaction) {
    const sub = interaction.options.getSubcommand();

    if (sub === 'list') {
      const factions = await listFactions();
      const embed = new EmbedBuilder().setColor(COLORS.DARK).setTitle('🏳️ Catálogo de facciones').setTimestamp();

      if (factions.length === 0) {
        embed.setDescription('*No hay ninguna facción definida todavía.*');
      } else {
        for (const n of factions) {
          const ownerPlayer = n.owner_player_id ? await findPlayerById(n.owner_player_id) : null;
          const owner = n.is_npc
            ? '🤖 *Facción NPC — no admite jugadores*'
            : `👑 ${ownerPlayer ? `<@${ownerPlayer.discord_id}>` : '*Sin dueño*'}`;
          embed.addFields({
            name:  `${n.emoji} ${n.display_name} (\`${n.name}\`)`,
            value: `${n.tile_count} casilla${n.tile_count !== 1 ? 's' : ''} · ${owner}` +
                   (n.description ? `\n${n.description}` : ''),
          });
        }
      }

      return interaction.reply({ embeds: [embed] });
    }

    if (sub === 'solicitar') {
      if (!await requireCharacter(interaction)) return;
      const nombre = interaction.options.getString('faccion')?.toLowerCase().trim();
      if (!nombre) return interaction.reply(await buildFactionPickerMessage(interaction.user.id));
      return submitFactionApplication(interaction, nombre);
    }

    if (sub === 'abandonar') {
      if (!await requireCharacter(interaction)) return;

      const faction = await getPlayerMembership(interaction.user.id);
      if (!faction) {
        return interaction.reply({ content: '❌ No perteneces a ninguna facción ahora mismo.', flags: MessageFlags.Ephemeral });
      }

      await setMembership(interaction.user.id, null);
      logger.info(`[/faccion abandonar] ${interaction.user.tag} abandonó "${faction.name}"`);

      return interaction.reply({
        content: `👋 Has abandonado **${faction.emoji ?? '🏳️'} ${faction.display_name}**.`,
      });
    }

    if (sub === 'expulsar') {
      const nombre = interaction.options.getString('faccion', true).toLowerCase().trim();
      const targetUser = interaction.options.getUser('jugador', true);

      const faction = await getFactionByName(nombre);
      if (!faction) {
        return interaction.reply({ content: `❌ No existe ninguna facción llamada \`${nombre}\`.`, flags: MessageFlags.Ephemeral });
      }

      const member = await resolveMember(interaction);
      const scope = { type: 'faction', id: faction.id, factionId: faction.id, ownerPlayerId: faction.owner_player_id };
      const permResult = await resolvePermission(
        { discordId: interaction.user.id, isRolepriest: isRolepriest(member) },
        scope, 'faction.kick'
      );
      if (!permResult.allowed) {
        return interaction.reply({
          content: `❌ No puedes expulsar de esta facción — ${permResult.reason}.`,
          flags: MessageFlags.Ephemeral,
        });
      }

      const targetPlayer = await getPlayerByDiscordId(targetUser.id);
      if (!targetPlayer || targetPlayer.faction_id !== faction.id) {
        return interaction.reply({ content: `❌ **${targetUser.username}** no es ciudadano de **${faction.display_name}**.`, flags: MessageFlags.Ephemeral });
      }

      const actingPlayer = await getPlayerByDiscordId(interaction.user.id);
      const isOwner = faction.owner_player_id != null && actingPlayer?.id === faction.owner_player_id;
      if (!isRolepriest(member) && !isOwner) {
        try {
          await assertNotActingOnSuperior(
            actingPlayer?.id ?? null, targetPlayer.id, faction.id,
            'No puedes expulsar a alguien por encima de tu propio rango.'
          );
        } catch (err) {
          return interaction.reply({ content: `❌ ${err.message}`, flags: MessageFlags.Ephemeral });
        }
      }

      await setMembership(targetUser.id, null);
      logger.info(`[/faccion expulsar] ${interaction.user.tag} expulsó a ${targetUser.tag} de "${faction.name}"`);

      return interaction.reply({
        content: `✅ **${targetUser.username}** ha sido expulsado de **${faction.emoji ?? '🏳️'} ${faction.display_name}**.`,
      });
    }

    if (sub === 'rangos') {
      const nombre = interaction.options.getString('faccion', true).toLowerCase().trim();
      const faction = await getFactionByName(nombre);
      if (!faction) {
        return interaction.reply({ content: `❌ No existe ninguna facción llamada \`${nombre}\`.`, flags: MessageFlags.Ephemeral });
      }

      const [ranks, requirements] = await Promise.all([
        getFactionRanks(faction.id),
        getRankRequirements(faction.id),
      ]);

      const embed = new EmbedBuilder()
        .setColor(COLORS.DARK)
        .setTitle(`${faction.emoji ?? '🏳️'} Rangos de ${faction.display_name}`)
        .setTimestamp();

      embed.addFields({
        name: 'Escalera de rangos',
        value: ranks.map(r => `**${r.rank_order}** — ${r.emoji ?? ''} ${r.display_name}${r.is_leader ? ' 👑' : ''}${r.is_default ? ' *(por defecto)*' : ''}`).join('\n'),
      });

      if (requirements.length === 0) {
        embed.addFields({ name: 'Permisos configurados', value: '*Ninguno — solo el dueño y un Rolepriest pueden actuar por defecto.*' });
      } else {
        embed.addFields({
          name: 'Permisos configurados',
          value: requirements.map(r => {
            const rank = ranks.find(x => x.rank_order === r.required_rank_order);
            return `**${PERMISSION_ACTIONS[r.action] ?? r.action}** — desde ${rank?.display_name ?? `rango ${r.required_rank_order}`}`;
          }).join('\n'),
        });
      }

      return interaction.reply({ embeds: [embed] });
    }

    if (sub === 'permisos') {
      const nombre = interaction.options.getString('faccion', true).toLowerCase().trim();
      const accion = interaction.options.getString('accion', true);
      const rango = interaction.options.getInteger('rango');

      const faction = await getFactionByName(nombre);
      if (!faction) {
        return interaction.reply({ content: `❌ No existe ninguna facción llamada \`${nombre}\`.`, flags: MessageFlags.Ephemeral });
      }

      const member = await resolveMember(interaction);
      try {
        await setRankRequirement({ discordId: interaction.user.id, isRolepriest: isRolepriest(member) }, faction.id, accion, rango);
      } catch (err) {
        return interaction.reply({ content: `❌ ${err.message}`, flags: MessageFlags.Ephemeral });
      }

      logger.info(`[/faccion permisos] ${interaction.user.tag} fijó "${accion}" → rango ${rango ?? '(quitado)'} en "${faction.name}"`);

      return interaction.reply({
        content: rango == null
          ? `✅ **${PERMISSION_ACTIONS[accion]}** ya no exige ningún rango mínimo en **${faction.display_name}** (solo dueño/Rolepriest).`
          : `✅ **${PERMISSION_ACTIONS[accion]}** ahora requiere al menos rango **${rango}** en **${faction.display_name}**.`,
      });
    }

    if (sub === 'ascender') {
      const targetUser = interaction.options.getUser('jugador', true);
      const rangoNombre = interaction.options.getString('rango', true).toLowerCase().trim();

      const targetPlayer = await getPlayerByDiscordId(targetUser.id);
      if (!targetPlayer?.faction_id) {
        return interaction.reply({ content: `❌ **${targetUser.username}** no pertenece a ninguna facción.`, flags: MessageFlags.Ephemeral });
      }

      const rank = await getFactionRankByName(targetPlayer.faction_id, rangoNombre);
      if (!rank) {
        return interaction.reply({ content: `❌ Ese rango no existe en la facción de **${targetUser.username}**. Usa \`/faccion rangos\` para verlos.`, flags: MessageFlags.Ephemeral });
      }

      const member = await resolveMember(interaction);
      try {
        await setPlayerRank({ discordId: interaction.user.id, isRolepriest: isRolepriest(member) }, targetPlayer.id, targetPlayer.faction_id, rank.id);
      } catch (err) {
        return interaction.reply({ content: `❌ ${err.message}`, flags: MessageFlags.Ephemeral });
      }

      logger.info(`[/faccion ascender] ${interaction.user.tag} cambió el rango de ${targetUser.tag} → "${rank.name}"`);

      return interaction.reply({
        content: `✅ **${targetUser.username}** ahora es **${rank.emoji ?? ''} ${rank.display_name}**.`,
      });
    }

    if (sub === 'almacen_ver') {
      if (!await requireCharacter(interaction)) return;
      const faction = await getPlayerMembership(interaction.user.id);
      if (!faction) {
        return interaction.reply({ content: '❌ No perteneces a ninguna facción ahora mismo.', flags: MessageFlags.Ephemeral });
      }

      const contents = await getStorageContents(faction.id);
      const embed = new EmbedBuilder()
        .setColor(COLORS.DARK)
        .setTitle(`📦 Almacén de facción: ${faction.display_name}`)
        .setTimestamp();

      embed.setDescription(
        contents.length === 0
          ? '*Vacío.*'
          : contents.map(c => `${c.emoji ?? '📦'} **${c.display_name}** ×${c.quantity}`).join('\n')
      );

      return interaction.reply({ embeds: [embed] });
    }

    if (sub === 'almacen_depositar') {
      if (!await requireCharacter(interaction)) return;
      const item = interaction.options.getString('item', true).toLowerCase().trim();
      const cantidad = interaction.options.getNumber('cantidad', true);

      const faction = await getPlayerMembership(interaction.user.id);
      if (!faction) {
        return interaction.reply({ content: '❌ No perteneces a ninguna facción ahora mismo.', flags: MessageFlags.Ephemeral });
      }

      const member = await resolveMember(interaction);
      let result;
      try {
        result = await depositItem(interaction.user.id, faction, item, cantidad, { isRolepriest: isRolepriest(member) });
      } catch (err) {
        return interaction.reply({ content: `❌ ${err.message}`, flags: MessageFlags.Ephemeral });
      }

      logger.info(`[/faccion almacen_depositar] ${interaction.user.tag} depositó ${cantidad} ${item} en el almacén de "${faction.name}"`);

      return interaction.reply({
        content: `✅ Depositaste **${cantidad}** de **${item}** en el almacén de **${faction.display_name}** (ahora: **${result.newQuantity}**).`,
      });
    }

    if (sub === 'almacen_retirar') {
      if (!await requireCharacter(interaction)) return;
      const item = interaction.options.getString('item', true).toLowerCase().trim();
      const cantidad = interaction.options.getNumber('cantidad', true);

      const faction = await getPlayerMembership(interaction.user.id);
      if (!faction) {
        return interaction.reply({ content: '❌ No perteneces a ninguna facción ahora mismo.', flags: MessageFlags.Ephemeral });
      }

      const member = await resolveMember(interaction);
      let result;
      try {
        result = await withdrawItem(interaction.user.id, faction, item, cantidad, { isRolepriest: isRolepriest(member) });
      } catch (err) {
        return interaction.reply({ content: `❌ ${err.message}`, flags: MessageFlags.Ephemeral });
      }

      logger.info(`[/faccion almacen_retirar] ${interaction.user.tag} retiró ${result.withdrawn} ${item} del almacén de "${faction.name}"`);

      return interaction.reply({
        content: `✅ Retiraste **${result.withdrawn}** de **${item}** del almacén de **${faction.display_name}** (quedan **${result.remaining}**).`,
      });
    }
  },
};

export async function submitFactionApplication(interaction, factionName, viaComponent = false) {
  const respond = (payload) => (viaComponent
    ? interaction.update({ embeds: [], components: [], ...payload })
    : interaction.reply(payload));

  const faction = await getFactionByName(factionName);
  if (!faction) {
    return respond({ content: `❌ No existe ninguna facción llamada \`${factionName}\`. Usa \`/faccion list\`.`, flags: MessageFlags.Ephemeral });
  }

  const player = await getPlayerByDiscordId(interaction.user.id);
  if (player.faction_id === faction.id) {
    return respond({ content: `❌ Ya eres ciudadano de **${faction.display_name}**.`, flags: MessageFlags.Ephemeral });
  }
  if (!faction.owner_player_id) {
    return respond({ content: `❌ **${faction.display_name}** no tiene dueño asignado todavía — no hay quien apruebe la solicitud. Avisa a un Rolepriest.`, flags: MessageFlags.Ephemeral });
  }

  let application;
  try {
    application = await createApplication(player.id, faction.id);
  } catch (err) {
    return respond({ content: `❌ ${err.message}`, flags: MessageFlags.Ephemeral });
  }

  logger.info(`[/faccion solicitar] ${interaction.user.tag} → "${faction.name}" (solicitud #${application.id})`);

  await respond({
    content: `📨 Solicitud enviada a **${faction.display_name}** — te avisaré en cuanto el dueño responda (o si pasan 24h sin respuesta).`,
  });

  await sendApplicationToOwner(interaction.client, application, player, faction);
}
