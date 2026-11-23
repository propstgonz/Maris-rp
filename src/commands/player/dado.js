import { SlashCommandBuilder, EmbedBuilder } from 'discord.js';
import { rollDie } from '../../utils/dice.js';
import { requireLivingCharacter } from '../../utils/interactionContext.js';
import { COLORS } from '../../utils/embeds.js';
import logger      from '../../utils/logger.js';

const PIP_EMOJI = { 1: '⚀', 2: '⚁', 3: '⚂', 4: '⚃', 5: '⚄', 6: '⚅' };
const DIE_EMOJI = '🎲';

const DICE_TYPES = [
  { sides: 6,   label: 'D6 — ataques directos, investigación de los Eruditos y conversión de los Misioneros' },
  { sides: 12,  label: 'D12 — dirección del viento en batalla naval' },
  { sides: 20,  label: 'D20 — acciones generales, prospección y conversión de los Curas' },
  { sides: 100, label: 'D100 — puntos de inflexión y eventos mayores' },
];

const DEFAULT_SIDES = 6;
const VALID_SIDES = new Set(DICE_TYPES.map(d => d.sides));

function resolveSides(raw) {
  return VALID_SIDES.has(raw) ? raw : DEFAULT_SIDES;
}

export default {
  data: new SlashCommandBuilder()
    .setName('dado')
    .setDescription('Tira un dado libre para resolver cualquier situación de rol')
    .addIntegerOption(opt => opt
      .setName('caras')
      .setDescription('Tipo de dado a tirar (por defecto, D6)')
      .setRequired(false)
      .addChoices(...DICE_TYPES.map(d => ({ name: d.label, value: d.sides })))),

  async execute(interaction) {
    await requireLivingCharacter(interaction.user.id);

    const sides = resolveSides(interaction.options.getInteger('caras'));
    const roll  = rollDie(sides);
    const emoji = sides === 6 ? PIP_EMOJI[roll] : DIE_EMOJI;

    logger.info(`[/dado] ${interaction.user.tag} tiró un D${sides} → ${roll}`);

    const embed = new EmbedBuilder()
      .setColor(COLORS.PURPLE)
      .setTitle(`${emoji} ¡Tirada de D${sides}!`)
      .setDescription(`**${interaction.user.username}** tira un D${sides} y saca... **${roll}**`)
      .setFooter({ text: `Resultado entre 1 y ${sides}` })
      .setTimestamp();

    return interaction.reply({ embeds: [embed] });
  },
};
