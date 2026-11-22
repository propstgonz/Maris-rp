





























import { EmbedBuilder, MessageFlags } from 'discord.js';
import { getAlertPreferences, setAlertPreference } from '../../services/playerAlertService.js';
import { requireCharacter } from '../../utils/permissions.js';
import { buildAlertsPanel } from '../../components/alertsFlow.js';
import { COLORS } from '../../utils/embeds.js';

const OPTION_TO_TYPE = {
  combustible: 'fuelLow',
  ataque:      'structureAttacked',
  ciudadania:  'citizenshipRequest',
  laburo:      'laburoExpiring',
  atacado:     'playerAttacked',
  revivido:    'revived',
  canal:       'channelToDm',
  paso_viaje:  'travelStep',
  eco_web:     'webEcho',
};

const TYPE_LABEL = {
  fuelLow:            '⛽ Combustible bajo/agotado en una construcción tuya',
  structureAttacked:  '🏗️ Ataque a una construcción tuya',
  citizenshipRequest: '🏛️ Resultado de TUS solicitudes de ciudadanía (aceptada/rechazada/caducada)',
  laburoExpiring:      '💪 Un lote de Laburo tuyo va a caducar',
  playerAttacked:      '⚔️ Que te ataque OTRO JUGADOR directamente',
  revived:             '❤️ Que te revivan (Staff, o al volver al servidor dentro de la gracia)',
  channelToDm:         '📨 Que te llegue por MD lo que Staff escriba en tu canal privado',
  travelStep:          '🧭 Un MD por CADA casilla que avances de viaje (apagada por defecto)',
  webEcho:             '🌐 Un eco por MD de lo que hagas desde la web',
};

export default {
  build: (sub) => sub
    .setName("alertas")
    .setDescription("Panel de tus avisos automáticos por MD")
    .addBooleanOption(opt => opt.setName('combustible').setDescription('¿Avisarte si una construcción tuya se queda sin combustible?').setRequired(false))
    .addBooleanOption(opt => opt.setName('ataque').setDescription('¿Avisarte si atacan una construcción tuya?').setRequired(false))
    .addBooleanOption(opt => opt.setName('ciudadania').setDescription('¿Avisarte del resultado de TUS solicitudes? (NO las que recibas como dueño — esas llevan botones)').setRequired(false))
    .addBooleanOption(opt => opt.setName('laburo').setDescription('¿Avisarte si un lote de Laburo tuyo va a caducar?').setRequired(false))
    .addBooleanOption(opt => opt.setName('atacado').setDescription('¿Avisarte si otro jugador te ataca directamente?').setRequired(false))
    .addBooleanOption(opt => opt.setName('revivido').setDescription('¿Avisarte cuando te revivan?').setRequired(false))
    .addBooleanOption(opt => opt.setName('canal').setDescription('¿Que te llegue por MD lo que Staff escriba en tu canal privado? (el mensaje sigue en el canal igual)').setRequired(false))
    .addBooleanOption(opt => opt.setName('paso_viaje').setDescription('¿Un MD por cada casilla que avances de viaje? (apagado por defecto)').setRequired(false))
    .addBooleanOption(opt => opt.setName('eco_web').setDescription('¿Avisarte por MD de lo que hagas desde la web?').setRequired(false)),


  async execute(interaction) {
    if (!await requireCharacter(interaction)) return;





    const anyOptionGiven = Object.keys(OPTION_TO_TYPE)
      .some(optionName => interaction.options.getBoolean(optionName) !== null);

    if (!anyOptionGiven) {
      return interaction.reply(await buildAlertsPanel(interaction.user.id));
    }

    for (const [optionName, type] of Object.entries(OPTION_TO_TYPE)) {
      const value = interaction.options.getBoolean(optionName);
      if (value !== null) await setAlertPreference(interaction.user.id, type, value);
    }

    const prefs = await getAlertPreferences(interaction.user.id);
    const embed = new EmbedBuilder()
      .setColor(COLORS.BLUE)
      .setTitle('🔔 Tus alertas')
      .setDescription(
        Object.entries(prefs)
          .map(([type, enabled]) => `${enabled ? '✅' : '⬜'} ${TYPE_LABEL[type]}`)
          .join('\n')
      )
      .setFooter({ text: 'Usa /alertas con las opciones que quieras cambiar — el resto se queda como está.' })
      .setTimestamp();

    return interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
  },
};
