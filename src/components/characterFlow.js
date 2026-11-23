import {
  ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, ModalBuilder, StringSelectMenuBuilder,
  TextInputBuilder, TextInputStyle,
} from 'discord.js';
import { listRaces } from '../services/profileService.js';
import { createCharacter, hasCharacter, getCreationWaitSeconds } from '../services/characterLifecycleService.js';
import { STATS, STAT_LABELS, BASE_POINTS } from '../domain/picarda.js';
import { resolveGuild } from '../utils/permissions.js';
import { UserFacingError } from '../utils/errors.js';
import { COLORS, E, buildSuccessEmbed, clip, signed, discordRelativeFromNow } from '../utils/embeds.js';
import { GENDER_CHOICES } from '../utils/text.js';
import { awaitFrom, replyEphemeral } from './confirm.js';

const MODAL_TIMEOUT_MS = 5 * 60_000;
const CREATION_TIMEOUT_MS = 5 * 60_000;
const NAME_MAX = 80;
const MAX_AGE = 1000;

export function raceModifiers(race) {
  const parts = STATS
    .filter(stat => Number(race[`mod_${stat}`]) !== 0)
    .map(stat => `${signed(Number(race[`mod_${stat}`]))} ${STAT_LABELS[stat]}`);
  return parts.length ? parts.join(', ') : 'Sin modificadores';
}

export function parseAge(raw) {
  const text = String(raw ?? '').trim();
  const age = /^\d{1,4}$/.test(text) ? Number(text) : NaN;
  if (!Number.isInteger(age) || age < 1 || age > MAX_AGE) {
    throw new UserFacingError(`La edad tiene que ser un número entre 1 y ${MAX_AGE}.`);
  }
  return age;
}

function buildIdentityModal(modalId) {
  const input = (id, label, max, placeholder) => new ActionRowBuilder().addComponents(
    new TextInputBuilder()
      .setCustomId(id)
      .setLabel(label)
      .setStyle(TextInputStyle.Short)
      .setPlaceholder(placeholder)
      .setMinLength(1)
      .setMaxLength(max)
      .setRequired(true)
  );
  return new ModalBuilder()
    .setCustomId(modalId)
    .setTitle('Crea tu personaje')
    .addComponents(
      input('nombre', 'Nombre del personaje', NAME_MAX, 'Ej. Doña Muza Niyazova'),
      input('edad', 'Edad', 4, 'Ej. 34'),
    );
}

export function buildCreationView({ characterName, age, races, state }) {
  const race = races.find(r => r.slug === state.raceSlug);
  const embed = new EmbedBuilder()
    .setColor(COLORS.PURPLE)
    .setTitle(clip(`${E.perfil} ${characterName}, ${age} años`, 256))
    .setDescription(
      race
        ? clip(`${E.raza} **${race.name}** — ${raceModifiers(race)}\n${race.description}${race.traits ? `\n\n${race.traits}` : ''}`, 4000)
        : 'Elige género y raza para continuar.'
    );

  const gender = new StringSelectMenuBuilder()
    .setCustomId('genero')
    .setPlaceholder('Género')
    .addOptions(GENDER_CHOICES.map(g => ({ label: g.name, value: g.value, default: g.value === state.gender })));
  const raceSelect = new StringSelectMenuBuilder()
    .setCustomId('raza')
    .setPlaceholder('Raza')
    .addOptions(races.slice(0, 25).map(r => ({
      label: r.name, description: clip(raceModifiers(r), 100), value: r.slug, default: r.slug === state.raceSlug,
    })));
  const confirm = new ButtonBuilder()
    .setCustomId('crear')
    .setLabel('Crear personaje')
    .setStyle(ButtonStyle.Success)
    .setDisabled(!state.gender || !state.raceSlug);

  return {
    content: '',
    embeds: [embed],
    components: [
      new ActionRowBuilder().addComponents(gender),
      new ActionRowBuilder().addComponents(raceSelect),
      new ActionRowBuilder().addComponents(confirm),
    ],
  };
}

export async function startCharacterCreation(interaction) {
  if (await hasCharacter(interaction.user.id)) throw new UserFacingError('Ya tienes un personaje.');
  const waitSeconds = await getCreationWaitSeconds(interaction.user.id);
  if (waitSeconds > 0) {
    throw new UserFacingError(
      `Todavía no puedes crear un personaje nuevo: podrás ${discordRelativeFromNow(waitSeconds)} ` +
      '(la espera cuenta desde la muerte de tu anterior personaje).'
    );
  }

  const modalId = `identidad-${interaction.id}`;
  await interaction.showModal(buildIdentityModal(modalId));
  let submit;
  try {
    submit = await interaction.awaitModalSubmit({
      time: MODAL_TIMEOUT_MS,
      filter: i => i.customId === modalId && i.user.id === interaction.user.id,
    });
  } catch {
    return;
  }

  const characterName = submit.fields.getTextInputValue('nombre').trim();
  if (!characterName) throw new UserFacingError('El nombre no puede estar vacío.');
  const age = parseAge(submit.fields.getTextInputValue('edad'));
  const races = await listRaces();
  const state = { gender: null, raceSlug: null };

  const message = await replyEphemeral(submit, buildCreationView({ characterName, age, races, state }));
  for (;;) {
    const click = await awaitFrom(message, submit, undefined, CREATION_TIMEOUT_MS);
    if (!click) return;
    if (click.customId === 'crear') {
      await click.deferUpdate();
      break;
    }
    if (click.customId === 'genero') state.gender = click.values[0];
    if (click.customId === 'raza') state.raceSlug = click.values[0];
    await click.update(buildCreationView({ characterName, age, races, state }));
  }

  const player = await createCharacter(
    interaction.user.id,
    interaction.user.username,
    { characterName, age, gender: state.gender, raceSlug: state.raceSlug },
    { guild: resolveGuild(interaction) },
  );
  await submit.editReply({
    content: '',
    components: [],
    embeds: [buildSuccessEmbed(
      `Personaje creado: ${clip(player.character_name, 200)}`,
      `Tienes **${BASE_POINTS} puntos** para repartir y un menhir que elegir: ábrelo en \`/perfil\`.`
    )],
  });
}
