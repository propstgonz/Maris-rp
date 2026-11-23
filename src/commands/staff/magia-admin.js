import { SlashCommandBuilder, EmbedBuilder } from 'discord.js';
import { requireRolepriest } from '../../utils/permissions.js';
import { actorFrom, requireTargetCharacter, requireLivingCharacter } from '../../utils/interactionContext.js';
import { schoolChoices } from '../../utils/autocomplete.js';
import { COLORS, buildSuccessEmbed, discordTimestamp, formatNumber } from '../../utils/embeds.js';
import { confirmAction } from '../../components/confirm.js';
import { replyEphemeral, staffAutocomplete } from '../../utils/staffUi.js';
import { UserFacingError } from '../../utils/errors.js';
import { thresholdLabel } from '../../domain/magic.js';
import { authorizedRoll, setLevel, getSchoolsOverview } from '../../services/magicService.js';

const schoolOption = opt => opt.setName('escuela').setDescription('Escuela de magia').setRequired(true).setAutocomplete(true);

async function resolveMentor(interaction) {
  const mentor = interaction.options.getUser('mentor');
  const label = interaction.options.getString('mentor_npc');
  if (mentor && label) throw new UserFacingError('Indica un mentor jugador o un mentor NPC, no ambos.');
  if (!mentor) return { mentorPlayerId: null, mentorLabel: label ? `NPC ${label} (palabra del Rolepriest)` : null };
  const player = await requireLivingCharacter(mentor.id, { self: false });
  return { mentorPlayerId: player.id, mentorLabel: null };
}

function rollEmbed({ player, school, mentorText, result }) {
  const embed = new EmbedBuilder()
    .setColor(result.success ? COLORS.GREEN : COLORS.RED)
    .setTitle(`${result.success ? '🌟' : '💨'} Tirada de magia: ${school.name}`)
    .setDescription(`<@${player.discord_id}> intenta alcanzar el nivel **${result.levelName}**.`)
    .addFields(
      { name: '🎲 D20', value: formatNumber(result.roll), inline: true },
      { name: 'Modificador', value: `${result.modifier >= 0 ? '+' : ''}${formatNumber(result.modifier)}`, inline: true },
      { name: 'Total', value: `${formatNumber(result.total)} (se pide ${thresholdLabel(result.threshold)})`, inline: true },
      { name: 'Resultado', value: result.success ? `Éxito: ahora es **${result.levelName}**.` : `Fracaso: puede reintentarlo ${discordTimestamp(result.retryAfter, 'D')}.` },
    )
    .setTimestamp();
  if (mentorText) embed.addFields({ name: '🧙 Mentor', value: mentorText });
  return embed;
}

export default {

  data: new SlashCommandBuilder()
    .setName('magia-admin')
    .setDescription('[Rolepriest] Gestiona el progreso mágico de un jugador')
    .addSubcommand(sub => sub
      .setName('tirada')
      .setDescription('Autoriza y resuelve una tirada de ascenso de escuela')
      .addUserOption(opt => opt.setName('jugador').setDescription('Jugador que intenta ascender').setRequired(true))
      .addStringOption(schoolOption)
      .addUserOption(opt => opt.setName('mentor').setDescription('Jugador que hace de mentor'))
      .addStringOption(opt => opt.setName('mentor_npc').setDescription('Nombre del NPC mentor, validado por ti').setMaxLength(80)))
    .addSubcommand(sub => sub
      .setName('fijar')
      .setDescription('Fija el nivel de un jugador en una escuela')
      .addUserOption(opt => opt.setName('jugador').setDescription('Jugador objetivo').setRequired(true))
      .addStringOption(schoolOption)
      .addIntegerOption(opt => opt.setName('nivel').setDescription('Nivel nuevo (0 a 5)').setRequired(true)
        .setMinValue(0).setMaxValue(5))),

  autocomplete: staffAutocomplete({
    escuela: text => schoolChoices(text),
  }),

  async execute(interaction) {
    if (!await requireRolepriest(interaction)) return;

    const sub = interaction.options.getSubcommand();
    if (interaction.options.getUser('jugador')?.id === interaction.user.id) {
      throw new UserFacingError('Un Rolepriest no puede gestionar su propio progreso mágico.');
    }
    const actor = actorFrom(interaction);
    const player = await requireTargetCharacter(interaction);
    const slug = interaction.options.getString('escuela', true);
    const current = (await getSchoolsOverview(player.id)).schools.find(row => row.school.slug === slug);
    const schoolName = current?.school.name ?? slug;

    if (sub === 'tirada') {
      const { mentorPlayerId, mentorLabel } = await resolveMentor(interaction);
      const result = await authorizedRoll({ playerId: player.id, schoolSlug: slug, mentorPlayerId, mentorLabel, actor });
      const mentorUser = interaction.options.getUser('mentor');
      const mentorText = mentorUser ? `<@${mentorUser.id}>` : mentorLabel;
      return interaction.reply({
        embeds: [rollEmbed({ player, school: { name: schoolName }, mentorText, result })],
      });
    }

    const rank = interaction.options.getInteger('nivel', true);
    const apply = () => setLevel(player.id, slug, rank, actor);
    const fixed = ({ levelName }) => ({
      embeds: [buildSuccessEmbed('Nivel fijado', `<@${player.discord_id}> en **${schoolName}**: ${levelName}.`)],
    });

    if (current && rank < current.rank) {
      const done = await confirmAction(interaction,
        `Bajar a <@${player.discord_id}> en **${schoolName}** de nivel ${current.rank} (${current.levelName}) a nivel ${rank}.`);
      if (!done) return;
      return done(fixed(await apply()));
    }

    return replyEphemeral(interaction)(fixed(await apply()));
  },
};
