import { SlashCommandBuilder } from 'discord.js';
import { requireRolepriest } from '../../utils/permissions.js';
import { actorFrom, requireTargetCharacter } from '../../utils/interactionContext.js';
import { raceChoices, menhirChoices } from '../../utils/autocomplete.js';
import { buildSuccessEmbed } from '../../utils/embeds.js';
import { confirmAction, replyEphemeral, staffAutocomplete, withDefined } from '../../utils/staffUi.js';
import { STATS, STAT_LABELS } from '../../domain/picarda.js';
import { GENDER_CHOICES, genderLabel } from '../../utils/text.js';
import { setRace, setMenhir, grantBonusPoints, correctStat, updateIdentity, listRaces, listMenhirs } from '../../services/profileService.js';
import { annul } from '../../services/marriageService.js';
import { getCharacterCreationCooldownHours, setCharacterCreationCooldownHours } from '../../services/characterLifecycleService.js';

const QUITAR = 'quitar';

const userOption = opt => opt.setName('jugador').setDescription('Jugador objetivo').setRequired(true);

export default {
  permission: 'rolepriest',

  data: new SlashCommandBuilder()
    .setName('perfil-admin')
    .setDescription('[Rolepriest] Corrige el perfil de un jugador')
    .addSubcommand(sub => sub
      .setName('raza')
      .setDescription('Cambia la raza de un jugador')
      .addUserOption(userOption)
      .addStringOption(opt => opt.setName('raza').setDescription('Nueva raza').setRequired(true).setAutocomplete(true)))
    .addSubcommand(sub => sub
      .setName('menhir')
      .setDescription('Fija o quita el menhir de un jugador, sin espera')
      .addUserOption(userOption)
      .addStringOption(opt => opt.setName('menhir').setDescription('Menhir, o "quitar"').setRequired(true).setAutocomplete(true)))
    .addSubcommand(sub => sub
      .setName('puntos-extra')
      .setDescription('Concede puntos extra de estadística')
      .addUserOption(userOption)
      .addIntegerOption(opt => opt.setName('cantidad').setDescription('Puntos a conceder').setRequired(true).setMinValue(1).setMaxValue(100)))
    .addSubcommand(sub => sub
      .setName('corregir-stat')
      .setDescription('Fija el valor base de una estadística')
      .addUserOption(userOption)
      .addStringOption(opt => opt.setName('estadistica').setDescription('Estadística').setRequired(true)
        .addChoices(...STATS.map(stat => ({ name: STAT_LABELS[stat], value: stat }))))
      .addIntegerOption(opt => opt.setName('valor').setDescription('Valor base nuevo').setRequired(true).setMinValue(0).setMaxValue(6)))
    .addSubcommand(sub => sub
      .setName('identidad')
      .setDescription('Edita nombre, edad o género del personaje')
      .addUserOption(userOption)
      .addStringOption(opt => opt.setName('nombre').setDescription('Nombre nuevo').setMaxLength(191))
      .addIntegerOption(opt => opt.setName('edad').setDescription('Edad nueva').setMinValue(1).setMaxValue(1000))
      .addStringOption(opt => opt.setName('genero').setDescription('Género nuevo').addChoices(...GENDER_CHOICES)))
    .addSubcommand(sub => sub
      .setName('anular-matrimonio')
      .setDescription('Anula el matrimonio vigente de un jugador')
      .addUserOption(userOption))
    .addSubcommand(sub => sub
      .setName('cooldown-creacion')
      .setDescription('Horas de espera para crear personaje tras perder el anterior')
      .addNumberOption(opt => opt.setName('horas').setDescription('Nuevo valor (0 = sin espera). Omite para consultar').setMinValue(0))),

  autocomplete: staffAutocomplete({
    raza: text => raceChoices(text),
    menhir: async text => {
      const choices = await menhirChoices(text);
      const quitar = { name: 'Quitar menhir', value: QUITAR };
      return QUITAR.includes(String(text ?? '').toLowerCase()) ? [quitar, ...choices].slice(0, 25) : choices;
    },
  }),

  async execute(interaction) {
    if (!await requireRolepriest(interaction)) return;

    const sub = interaction.options.getSubcommand();
    const actor = actorFrom(interaction);

    if (sub === 'cooldown-creacion') {
      const hours = interaction.options.getNumber('horas');
      if (hours !== null) await setCharacterCreationCooldownHours(hours);
      const current = await getCharacterCreationCooldownHours();
      return replyEphemeral(interaction)({
        embeds: [buildSuccessEmbed('Cooldown de creación', `Espera actual: **${current} h**${current === 0 ? ' (desactivada)' : ''}.`)],
      });
    }

    const player = await requireTargetCharacter(interaction);
    const mention = `<@${player.discord_id}>`;

    if (sub === 'raza') {
      const slug = interaction.options.getString('raza', true);
      const races = await listRaces();
      const race = races.find(r => r.slug === slug);
      const current = races.find(r => r.id === player.race_id);
      const done = await confirmAction(interaction,
        `Cambiar la raza de ${mention} de **${current?.name ?? 'sin raza'}** a **${race?.name ?? slug}** altera sus estadísticas efectivas.`);
      if (!done) return;
      await setRace(player.id, slug, actor);
      return done({ embeds: [buildSuccessEmbed('Raza cambiada', `${mention} ahora es **${race?.name ?? slug}**.`)] });
    }

    if (sub === 'menhir') {
      const slug = interaction.options.getString('menhir', true);
      const menhir = slug === QUITAR ? null : (await listMenhirs()).find(m => m.slug === slug);
      await setMenhir(player.id, slug === QUITAR ? null : slug, actor);
      return replyEphemeral(interaction)({
        embeds: [buildSuccessEmbed('Menhir fijado', menhir ? `${mention} ahora tiene **${menhir.name}**.` : `${mention} se queda sin menhir.`)],
      });
    }

    if (sub === 'puntos-extra') {
      const amount = interaction.options.getInteger('cantidad', true);
      const updated = await grantBonusPoints(player.id, amount, actor);
      return replyEphemeral(interaction)({
        embeds: [buildSuccessEmbed('Puntos concedidos', `${mention} recibe **${amount}** punto(s) extra. Total extra: **${updated.stat_bonus_points}**.`)],
      });
    }

    if (sub === 'corregir-stat') {
      const stat = interaction.options.getString('estadistica', true);
      const value = interaction.options.getInteger('valor', true);
      const done = await confirmAction(interaction,
        `Fijar **${STAT_LABELS[stat]}** de ${mention} de **${player[`stat_${stat}`]}** a **${value}**.`);
      if (!done) return;
      await correctStat(player.id, stat, value, actor);
      return done({ embeds: [buildSuccessEmbed('Estadística corregida', `${STAT_LABELS[stat]} de ${mention}: **${value}**.`)] });
    }

    if (sub === 'identidad') {
      const fields = withDefined({
        characterName: interaction.options.getString('nombre'),
        age: interaction.options.getInteger('edad'),
        gender: interaction.options.getString('genero'),
      });
      const updated = await updateIdentity(player.id, fields, actor);
      const summary = `**${updated.character_name}**, ${updated.age} años, ${genderLabel(updated.gender)}`;
      return replyEphemeral(interaction)({
        embeds: [buildSuccessEmbed('Identidad actualizada', `${mention}: ${summary}.`)],
      });
    }

    const done = await confirmAction(interaction, `Anular el matrimonio vigente de ${mention}. Quedará registrado como anulación.`);
    if (!done) return;
    await annul(player.id, actor);
    return done({ embeds: [buildSuccessEmbed('Matrimonio anulado', `El matrimonio de ${mention} queda anulado.`)] });
  },
};
