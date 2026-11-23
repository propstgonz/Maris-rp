import {
  ActionRowBuilder, ComponentType, EmbedBuilder, ModalBuilder, StringSelectMenuBuilder,
  TextInputBuilder, TextInputStyle, UserSelectMenuBuilder,
} from 'discord.js';
import { getProfile, allocateStat, chooseMenhir, listMenhirs } from '../services/profileService.js';
import { propose, divorce, getCivilStatus } from '../services/marriageService.js';
import { getSchoolsOverview, claimFreeSchool, getNextSpells, listSchools } from '../services/magicService.js';
import {
  STATS, STAT_LABELS, MAX_BASE_PER_STAT, MENHIR_CHANGE_MONTHS, validateAllocation,
  canChangeMenhir, menhirChangeAvailableAt,
} from '../domain/picarda.js';
import { UserFacingError } from '../utils/errors.js';
import { actorFrom, requireLivingCharacter } from '../utils/interactionContext.js';
import {
  COLORS, E, buildSpellsEmbed, buildSuccessEmbed, clip, discordTimestamp,
} from '../utils/embeds.js';
import { FLOW_TIMEOUT_MS, awaitFrom, confirmAction, replyEphemeral } from './confirm.js';
import { notifyRecipient, sendDm } from './consentFlow.js';

export async function startAllocate(interaction, player) {
  const profile = await getProfile(player.id);
  if (profile.freePoints < 1) throw new UserFacingError('No te quedan puntos libres.');

  const options = STATS
    .filter(stat => profile.base[stat] < MAX_BASE_PER_STAT)
    .map(stat => ({ label: STAT_LABELS[stat], description: `Asignados: ${profile.base[stat]} de ${MAX_BASE_PER_STAT}`, value: stat }));
  if (options.length === 0) throw new UserFacingError('Todas tus estadísticas están al máximo de puntos asignables.');

  const select = new StringSelectMenuBuilder().setCustomId(`stat-${interaction.id}`).setPlaceholder('Estadística').addOptions(options);
  const message = await replyEphemeral(interaction, {
    content: `${E.stats} Elige la estadística. Puntos libres: **${profile.freePoints}**.`,
    embeds: [],
    components: [new ActionRowBuilder().addComponents(select)],
  });
  const pick = await awaitFrom(message, interaction, ComponentType.StringSelect);
  if (!pick) return;
  const stat = pick.values[0];

  const modalId = `puntos-${interaction.id}`;
  await pick.showModal(
    new ModalBuilder().setCustomId(modalId).setTitle(`Puntos en ${STAT_LABELS[stat]}`).addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId('puntos')
          .setLabel(`Puntos a asignar (libres: ${profile.freePoints})`)
          .setStyle(TextInputStyle.Short)
          .setMinLength(1)
          .setMaxLength(2)
          .setRequired(true)
      )
    )
  );
  let submit;
  try {
    submit = await pick.awaitModalSubmit({
      time: FLOW_TIMEOUT_MS,
      filter: i => i.customId === modalId && i.user.id === interaction.user.id,
    });
  } catch {
    return;
  }
  await submit.deferUpdate();

  const raw = submit.fields.getTextInputValue('puntos').trim();
  const n = /^\d+$/.test(raw) ? Number(raw) : NaN;
  const problem = validateAllocation(profile.player, stat, n);
  if (problem) throw new UserFacingError(problem);

  const finish = await confirmAction(interaction, {
    embed: new EmbedBuilder()
      .setColor(COLORS.YELLOW)
      .setTitle(`${E.stats} Asignar ${n} punto(s) a ${STAT_LABELS[stat]}`)
      .setDescription(`${STAT_LABELS[stat]}: ${profile.base[stat]} → **${profile.base[stat] + n}** (base).\n**Es irreversible.**`),
    confirmLabel: 'Asignar',
  });
  if (!finish) return;

  await allocateStat(player.id, stat, n, actorFrom(interaction));
  await finish({ embeds: [buildSuccessEmbed('Puntos asignados', `${n} punto(s) en ${STAT_LABELS[stat]}.`)] });
}

export async function startMenhir(interaction, player) {
  if (!canChangeMenhir(player)) {
    throw new UserFacingError(`Ya elegiste menhir. Podrás cambiarlo a partir de ${discordTimestamp(menhirChangeAvailableAt(player), 'D')}.`);
  }
  const menhirs = await listMenhirs();
  const select = new StringSelectMenuBuilder()
    .setCustomId(`menhir-${interaction.id}`)
    .setPlaceholder('Menhir')
    .addOptions(menhirs.slice(0, 25).map(m => ({
      label: clip(m.name, 100), description: clip(m.description, 100), value: m.slug,
    })));
  const message = await replyEphemeral(interaction, {
    content: `${E.menhir} Elige tu menhir.`,
    embeds: [],
    components: [new ActionRowBuilder().addComponents(select)],
  });
  const pick = await awaitFrom(message, interaction, ComponentType.StringSelect);
  if (!pick) return;
  await pick.deferUpdate();
  const menhir = menhirs.find(m => m.slug === pick.values[0]);

  const finish = await confirmAction(interaction, {
    embed: new EmbedBuilder()
      .setColor(COLORS.YELLOW)
      .setTitle(clip(`${E.menhir} ${menhir.name}`, 256))
      .setDescription(`${clip(menhir.description, 1500)}\n\n**No podrás cambiarlo en ${MENHIR_CHANGE_MONTHS} meses.**`),
    confirmLabel: 'Elegir menhir',
  });
  if (!finish) return;

  await chooseMenhir(player.id, menhir.slug, actorFrom(interaction));
  await finish({ embeds: [buildSuccessEmbed('Menhir elegido', menhir.name)] });
}

export async function startMarriage(interaction, player, targetUser = null) {
  let user = targetUser;
  if (!user) {
    const select = new UserSelectMenuBuilder().setCustomId(`novio-${interaction.id}`).setPlaceholder('Con quién');
    const message = await replyEphemeral(interaction, {
      content: `${E.civil} ¿A quién quieres proponer matrimonio?`,
      embeds: [],
      components: [new ActionRowBuilder().addComponents(select)],
    });
    const pick = await awaitFrom(message, interaction, ComponentType.UserSelect);
    if (!pick) return;
    await pick.deferUpdate();
    user = pick.users.first();
  }
  if (user.bot) throw new UserFacingError('No puedes casarte con un bot.');
  if (user.id === interaction.user.id) throw new UserFacingError('No puedes casarte contigo mismo.');
  const target = await requireLivingCharacter(user.id, { self: false });

  const finish = await confirmAction(interaction, {
    embed: new EmbedBuilder()
      .setColor(COLORS.PURPLE)
      .setTitle(`${E.civil} Proponer matrimonio`)
      .setDescription(`Vas a proponer matrimonio a **${clip(target.character_name, 100)}** (<@${user.id}>). Recibirá la propuesta por MD.`),
    confirmLabel: 'Proponer',
  });
  if (!finish) return;

  const requestId = await propose(player.id, target.id, actorFrom(interaction));
  const delivered = await notifyRecipient(interaction.client, {
    requestId, toDiscordId: user.id, fromName: player.character_name, kind: 'marriage', line: 'te propone matrimonio.',
  });
  await finish({
    embeds: [buildSuccessEmbed(
      'Propuesta enviada',
      delivered
        ? `**${clip(target.character_name, 100)}** la verá en su MD.`
        : `No se pudo enviar el MD a <@${user.id}>. Puede resolverla con \`/solicitudes\`.`
    )],
  });
}

export async function startDivorce(interaction, player) {
  const civil = await getCivilStatus(player.id);
  if (!civil.spouse) throw new UserFacingError('No estás casado/a.');

  const finish = await confirmAction(interaction, {
    embed: new EmbedBuilder()
      .setColor(COLORS.RED)
      .setTitle(`${E.civil} Divorciarse`)
      .setDescription(`Vas a divorciarte de <@${civil.spouse.discordId}>. **Es irreversible.**`),
    confirmLabel: 'Divorciarme',
    danger: true,
  });
  if (!finish) return;

  const { spouse } = await divorce(player.id, actorFrom(interaction));
  await finish({ embeds: [buildSuccessEmbed('Divorcio efectuado')] });
  if (spouse) {
    await sendDm(interaction.client, spouse.discordId, {
      embeds: [new EmbedBuilder().setColor(COLORS.GREY).setDescription(`**${clip(player.character_name, 100)}** se ha divorciado de ti.`)],
    });
  }
}

export async function startFreeSchool(interaction, player, schoolSlug = null) {
  const overview = await getSchoolsOverview(player.id);
  if (!overview.canClaimFreeSchool) {
    throw new UserFacingError('No tienes una escuela gratuita disponible (hace falta Autismo efectivo 6 o más y no haberla usado).');
  }
  const eligible = overview.schools.filter(row => row.active && row.rank < 1);
  if (eligible.length === 0) throw new UserFacingError('Ya tienes nivel en todas las escuelas activas.');

  let slug = schoolSlug;
  if (!slug) {
    const select = new StringSelectMenuBuilder()
      .setCustomId(`escuela-${interaction.id}`)
      .setPlaceholder('Escuela')
      .addOptions(eligible.map(row => ({ label: row.school.name, value: row.school.slug })));
    const message = await replyEphemeral(interaction, {
      content: `${E.escuelas} Elige tu escuela gratuita.`,
      embeds: [],
      components: [new ActionRowBuilder().addComponents(select)],
    });
    const pick = await awaitFrom(message, interaction, ComponentType.StringSelect);
    if (!pick) return;
    await pick.deferUpdate();
    slug = pick.values[0];
  }
  const school = (await listSchools()).find(s => s.slug === slug);
  if (!school) throw new UserFacingError('Esa escuela no existe o está excluida hasta nuevo aviso.');

  const finish = await confirmAction(interaction, {
    embed: new EmbedBuilder()
      .setColor(COLORS.YELLOW)
      .setTitle(`${E.escuelas} Escuela gratuita: ${school.name}`)
      .setDescription('Empiezas en el nivel 1 sin tirada. Solo puedes usar la escuela gratuita **una vez** y **no se puede deshacer**.'),
    confirmLabel: 'Iniciar escuela',
  });
  if (!finish) return;

  await claimFreeSchool(player.id, school.slug, actorFrom(interaction));
  await finish({ embeds: [buildSuccessEmbed(`Escuela de ${school.name} iniciada`, 'Ya tienes el nivel 1.')] });
}

export async function showNextSpells(interaction, player, schoolSlug = null) {
  const slugs = schoolSlug ? [schoolSlug] : (await listSchools()).map(s => s.slug);
  const rows = (await Promise.all(slugs.map(slug => getNextSpells(player.id, slug)))).flat();
  await replyEphemeral(interaction, {
    embeds: [buildSpellsEmbed({ rows, total: rows.length, page: 1, pages: 1, locked: true })],
  });
}
