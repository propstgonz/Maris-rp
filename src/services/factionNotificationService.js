import { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } from 'discord.js';
import logger from '../utils/logger.js';
import { COLORS } from '../utils/embeds.js';
import {
  getFactionById, createApplication, getApplicationById, resolveApplication, getAnyApplication,
} from './factionService.js';
import { getAlertPreferences } from './playerAlertService.js';

const JOIN_YES_PREFIX   = 'faction_join_yes:';
const JOIN_NO_PREFIX    = 'faction_join_no:';
const APP_ACCEPT_PREFIX = 'faction_app_accept:';
const APP_DENY_PREFIX   = 'faction_app_deny:';

export function isFactionButton(customId) {
  return customId.startsWith(JOIN_YES_PREFIX) || customId.startsWith(JOIN_NO_PREFIX) ||
         customId.startsWith(APP_ACCEPT_PREFIX) || customId.startsWith(APP_DENY_PREFIX);
}

export async function sendBorderAlert(client, faction, player, x, y) {
  if (!faction.owner_player_id) return;

  const owner = await resolveOwnerUser(client, faction);
  if (!owner) return;

  const embed = new EmbedBuilder()
    .setColor(COLORS.YELLOW)
    .setTitle(`🚨 Frontera de ${faction.emoji ?? '🏳️'} ${faction.display_name}`)
    .setDescription(
      `**${player.character_name ?? player.username}** (ajeno a tu facción) ha entrado en tu territorio.`
    )
    .addFields({ name: '📍 Casilla', value: `(X: ${x}, Y: ${y})`, inline: true })
    .setTimestamp();

  await owner.send({ embeds: [embed] }).catch(err =>
    logger.warn(`[Factions] No se pudo avisar al dueño de "${faction.name}" (policía fronteriza): ${err.message}`)
  );
}

export async function sendJoinPrompt(client, player, faction) {
  const user = await client.users.fetch(player.discord_id).catch(() => null);
  if (!user) return;

  const embed = new EmbedBuilder()
    .setColor(COLORS.BLUE)
    .setTitle(`${faction.emoji ?? '🏳️'} Has entrado en territorio de ${faction.display_name}`)
    .setDescription(
      (faction.description ? `*${faction.description}*\n\n` : '') +
      `¿Quieres solicitar incorporarte a esta facción? El dueño tendrá que aceptarte.`
    );

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`${JOIN_YES_PREFIX}${faction.id}`).setLabel('Sí, solicitar').setStyle(ButtonStyle.Success).setEmoji('🏳️'),
    new ButtonBuilder().setCustomId(`${JOIN_NO_PREFIX}${faction.id}`).setLabel('No, gracias').setStyle(ButtonStyle.Secondary)
  );

  await user.send({ embeds: [embed], components: [row] }).catch(err =>
    logger.warn(`[Factions] No se pudo enviar la pregunta de incorporación a ${player.username}: ${err.message}`)
  );
}

export async function sendApplicationToOwner(client, application, player, faction) {
  const owner = await resolveOwnerUser(client, faction);
  if (!owner) {
    logger.warn(`[Factions] "${faction.name}" no tiene dueño alcanzable — la solicitud #${application.id} queda pendiente sin notificar (expirará sola en 24h).`);
    return;
  }

  const embed = new EmbedBuilder()
    .setColor(COLORS.PURPLE)
    .setTitle(`🏳️ Solicitud de incorporación a ${faction.display_name}`)
    .setDescription(`**${player.character_name ?? player.username}** quiere unirse a tu facción.`)
    .setFooter({ text: 'Expira sola en 24h si no respondes' })
    .setTimestamp();

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`${APP_ACCEPT_PREFIX}${application.id}`).setLabel('Aceptar').setStyle(ButtonStyle.Success).setEmoji('✅'),
    new ButtonBuilder().setCustomId(`${APP_DENY_PREFIX}${application.id}`).setLabel('Rechazar').setStyle(ButtonStyle.Danger).setEmoji('❌')
  );

  await owner.send({ embeds: [embed], components: [row] }).catch(err =>
    logger.warn(`[Factions] No se pudo enviar la solicitud #${application.id} al dueño de "${faction.name}": ${err.message}`)
  );
}

export async function notifyApplicationResult(client, player, faction, status) {
  if ((await getAlertPreferences(player.discord_id))?.citizenshipRequest === false) return;

  const user = await client.users.fetch(player.discord_id).catch(() => null);
  if (!user) return;

  const messages = {
    accepted: { color: COLORS.GREEN, title: `✅ ¡Bienvenido a ${faction.display_name}!`, desc: 'Tu solicitud ha sido aceptada — ya eres ciudadano.' },
    denied:   { color: COLORS.RED,   title: `❌ Solicitud rechazada`, desc: `El dueño de **${faction.display_name}** ha rechazado tu solicitud de incorporación.` },
    expired:  { color: COLORS.GREY,  title: `⌛ Solicitud caducada`, desc: `Nadie respondió a tu solicitud a **${faction.display_name}** en 24h — puedes volver a intentarlo con \`/faccion solicitar\`.` },
  };
  const m = messages[status];
  if (!m) return;

  await user.send({ embeds: [new EmbedBuilder().setColor(m.color).setTitle(m.title).setDescription(m.desc).setTimestamp()] })
    .catch(err => logger.warn(`[Factions] No se pudo notificar el resultado de la solicitud a ${player.username}: ${err.message}`));
}

export async function handleBorderCrossing(client, player, prevTile, newTile) {
  const newFactionId = newTile?.faction_id ?? null;
  if (!newFactionId) return;

  const prevFactionId = prevTile?.faction_id ?? null;
  if (newFactionId === prevFactionId) return;

  if (player.faction_id === newFactionId) return;

  const faction = await getFactionById(newFactionId);
  if (!faction) return;

  await sendBorderAlert(client, faction, player, newTile.coord_x, newTile.coord_y);

  if (!(await getAnyApplication(player.id, faction.id))) {
    await sendJoinPrompt(client, player, faction);
  }
}

export async function handleFactionButton(interaction) {
  const { customId } = interaction;

  if (customId.startsWith(JOIN_YES_PREFIX) || customId.startsWith(JOIN_NO_PREFIX)) {
    return handleJoinPromptButton(interaction);
  }
  if (customId.startsWith(APP_ACCEPT_PREFIX) || customId.startsWith(APP_DENY_PREFIX)) {
    return handleApplicationDecisionButton(interaction);
  }
}

async function handleJoinPromptButton(interaction) {
  const wantsToJoin = interaction.customId.startsWith(JOIN_YES_PREFIX);
  const factionId = Number(interaction.customId.split(':')[1]);

  const faction = await getFactionById(factionId);
  if (!faction) {
    return interaction.update({ content: '❌ Esa facción ya no existe.', embeds: [], components: [] });
  }

  if (!wantsToJoin) {
    return interaction.update({ content: `Vale, no se ha enviado ninguna solicitud a **${faction.display_name}**. Puedes hacerlo más tarde con \`/faccion solicitar\`.`, embeds: [], components: [] });
  }

  const { getPlayerByDiscordId } = await import('./playerService.js');
  const player = await getPlayerByDiscordId(interaction.user.id);
  if (!player?.character_created_at) {
    return interaction.update({ content: '❌ Ya no tienes un personaje activo — no se puede procesar la solicitud.', embeds: [], components: [] });
  }

  let application;
  try {
    application = await createApplication(player.id, faction.id);
  } catch (err) {
    return interaction.update({ content: `❌ ${err.message}`, embeds: [], components: [] });
  }

  await interaction.update({
    content: `📨 Solicitud enviada a **${faction.display_name}** — te avisaré en cuanto el dueño responda (o si pasan 24h sin respuesta).`,
    embeds: [], components: [],
  });

  await sendApplicationToOwner(interaction.client, application, player, faction);
}

async function handleApplicationDecisionButton(interaction) {
  const accept = interaction.customId.startsWith(APP_ACCEPT_PREFIX);
  const applicationId = Number(interaction.customId.split(':')[1]);

  const application = await getApplicationById(applicationId);
  if (!application) {
    return interaction.update({ content: '❌ Esa solicitud ya no existe.', embeds: [], components: [] });
  }
  if (application.status !== 'pending') {
    return interaction.update({ content: `Esta solicitud ya se resolvió antes (${application.status}) — nada que hacer.`, embeds: [], components: [] });
  }

  const faction = await getFactionById(application.faction_id);
  const { getPlayerByDiscordId } = await import('./playerService.js');
  const ownerPlayer = await getPlayerByDiscordId(interaction.user.id);

  if (!faction || faction.owner_player_id !== ownerPlayer?.id) {
    return interaction.update({ content: '❌ Ya no eres el dueño de esta facción — no puedes resolver esta solicitud.', embeds: [], components: [] });
  }

  const result = await resolveApplication(applicationId, accept ? 'accepted' : 'denied');

  await interaction.update({
    content: accept
      ? `✅ Aceptaste a **${result.player.character_name ?? result.player.username}** en **${faction.display_name}**.`
      : `❌ Rechazaste la solicitud de **${result.player.character_name ?? result.player.username}**.`,
    embeds: [], components: [],
  });

  await notifyApplicationResult(interaction.client, result.player, faction, accept ? 'accepted' : 'denied');
}

async function resolveOwnerUser(client, faction) {
  if (!faction.owner_player_id) return null;
  const { findPlayerById } = await import('./playerService.js');
  const ownerPlayer = await findPlayerById(faction.owner_player_id);
  if (!ownerPlayer) return null;
  return client.users.fetch(ownerPlayer.discord_id).catch(() => null);
}
