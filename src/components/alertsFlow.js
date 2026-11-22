


























import { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, MessageFlags } from 'discord.js';
import { getAlertPreferences, setAlertPreference, ALERT_TYPES } from '../services/playerAlertService.js';
import { buildCustomId } from '../utils/componentAuth.js';
import { UserFacingError } from '../utils/errors.js';
import { COLORS } from '../utils/embeds.js';

export const ALERTS_NS = 'alerts';


export const ALERT_LABEL = {
  fuelLow:            { emoji: '⛽', short: 'Combustible', long: 'Combustible bajo/agotado en una construcción tuya' },
  structureAttacked:  { emoji: '🏗️', short: 'Construcción', long: 'Ataque a una construcción tuya' },
  citizenshipRequest: { emoji: '🏛️', short: 'Ciudadanía', long: 'Resultado de TUS solicitudes de ciudadanía' },
  laburoExpiring:     { emoji: '💪', short: 'Laburo', long: 'Un lote de Laburo tuyo va a caducar' },
  playerAttacked:     { emoji: '⚔️', short: 'Te atacan', long: 'Que te ataque OTRO JUGADOR directamente' },
  revived:            { emoji: '❤️', short: 'Revivir', long: 'Que te revivan (Staff, o al volver al servidor)' },
  channelToDm:        { emoji: '📨', short: 'Canal → MD', long: 'Que te llegue por MD lo que Staff escriba en tu canal' },
  travelStep:         { emoji: '🧭', short: 'Cada paso', long: 'Un MD por CADA casilla que avances de viaje (apagada por defecto)' },
  webEcho:            { emoji: '🌐', short: 'Eco web', long: 'Un eco por MD de lo que hagas desde la web' },
};


const ORDER = Object.keys(ALERT_TYPES);


export async function buildAlertsPanel(discordId) {
  const prefs = await getAlertPreferences(discordId);
  if (!prefs) {
    throw new UserFacingError('Todavía no tienes un personaje. Usa `/personaje crear` para empezar.');
  }

  const embed = new EmbedBuilder()
    .setColor(COLORS.BLUE)
    .setTitle('🔔 Tus alertas por MD')
    .setDescription(
      ORDER.map(type => {
        const { emoji, long } = ALERT_LABEL[type];
        return `${prefs[type] ? '✅' : '⬜'} ${emoji} ${long}`;
      }).join('\n')
    )
    .setFooter({ text: 'Pulsa un botón para encender o apagar esa alerta. Todas vienen activadas por defecto, salvo "Cada paso".' });


  const rows = [];
  for (let i = 0; i < ORDER.length; i += 4) {
    const row = new ActionRowBuilder().addComponents(
      ...ORDER.slice(i, i + 4).map(type =>
        new ButtonBuilder()
          .setCustomId(buildCustomId({ ns: ALERTS_NS, action: 'toggle', owner: discordId, ctx: type }))
          .setLabel(ALERT_LABEL[type].short)
          .setEmoji(ALERT_LABEL[type].emoji)
          .setStyle(prefs[type] ? ButtonStyle.Success : ButtonStyle.Secondary)
      )
    );
    rows.push(row);
  }

  return { embeds: [embed], components: rows, flags: MessageFlags.Ephemeral };
}


export async function handleAlertsComponent(interaction, parsed) {
  const discordId = interaction.user.id;
  const type = parsed.ctx;




  if (!Object.hasOwn(ALERT_TYPES, type)) {
    throw new UserFacingError('Esa alerta ya no existe — vuelve a lanzar `/personaje alertas`.');
  }

  const prefs = await getAlertPreferences(discordId);
  if (!prefs) throw new UserFacingError('Tu perfil ya no está registrado.');

  await setAlertPreference(discordId, type, !prefs[type]);
  return interaction.update(await buildAlertsPanel(discordId));
}
