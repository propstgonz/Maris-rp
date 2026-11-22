import { SlashCommandBuilder, EmbedBuilder, MessageFlags } from 'discord.js';
import { COLORS } from '../../utils/embeds.js';

const SECTIONS = [
  {
    name: '🧍 Tu personaje',
    value:
      'Al crear tu personaje se abre un canal privado **rp-<tu-personaje>**, visible solo para ti y Staff. ' +
      'Puedes rolear ahí directamente, o escribir por **MD al bot** (se retransmite igual).',
  },
  {
    name: '🎲 Dados',
    value: '`/dado [caras]` — tira un dado libre (D6, D10, D12, D20 o D100).',
  },
  {
    name: '💀 Muerte',
    value:
      'Si tu personaje muere tienes **7 días de gracia** para que Staff lo reviva. ' +
      'Pasado ese plazo se borra y podrás crear uno nuevo.',
  },
];

export default {
  data: new SlashCommandBuilder()
    .setName('ayuda')
    .setDescription('Guía rápida: cómo empezar y qué puedes hacer'),

  async execute(interaction) {
    const embed = new EmbedBuilder()
      .setColor(COLORS.BLUE)
      .setTitle('📖 Guía rápida')
      .setDescription('Los comandos son `/slash` — escríbelos y Discord te guía con las opciones.')
      .addFields(SECTIONS)
      .setFooter({ text: '¿Dudas? Pregunta a Staff o a un Rolepriest.' });

    return interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
  },
};
