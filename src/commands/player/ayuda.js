import { SlashCommandBuilder, EmbedBuilder, MessageFlags } from 'discord.js';
import { COLORS, E } from '../../utils/embeds.js';

const SECTIONS = [
  {
    name: `${E.perfil} Tu personaje`,
    value:
      '`/personaje crear` — nombre, edad, género y raza.\n' +
      '`/personaje foto` — cambia tu foto.\n' +
      '`/personaje historial` — personajes que has tenido.\n' +
      '`/perfil` — estadísticas, raza, menhir y estado civil. Desde ahí asignas tus puntos y eliges menhir.',
  },
  {
    name: `${E.bienes} Inventarios`,
    value:
      '`/npcs ver` · `/bienes ver` · `/propiedades ver` — tus pertenencias, por páginas.\n' +
      '`/npcs traspasar` · `/bienes traspasar` · `/propiedades traspasar` — ofrece algo a otro jugador; tiene que aceptar.',
  },
  {
    name: `${E.escuelas} Magia`,
    value:
      '`/escuelas ver` — nivel, siguiente meta y Magia total.\n' +
      '`/escuelas iniciar` — escuela gratuita (Autismo efectivo 6 o más).\n' +
      '`/conjuros` — conjuros desbloqueados, con filtro por escuela.',
  },
  {
    name: `${E.civil} Matrimonio y solicitudes`,
    value:
      '`/matrimonio proponer` · `/matrimonio divorciar`.\n' +
      '`/solicitudes` — traspasos y propuestas pendientes: acepta, rechaza o cancela.',
  },
  {
    name: '🎲 Dados',
    value: '`/dado [caras]` — tira un dado libre (D6, D12, D20 o D100).',
  },
];

export default {
  data: new SlashCommandBuilder()
    .setName('ayuda')
    .setDescription('Guía rápida de los comandos de jugador'),

  async execute(interaction) {
    const embed = new EmbedBuilder()
      .setColor(COLORS.BLUE)
      .setTitle('📖 Guía rápida')
      .setDescription('Tus consultas solo las ves tú. Escribe `/` y Discord te guía con las opciones.')
      .addFields(SECTIONS)
      .setFooter({ text: '¿Dudas? Pregunta a un Rolepriest.' });

    return interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
  },
};
