import { ActionRowBuilder, ButtonBuilder, ButtonStyle, MessageFlags, StringSelectMenuBuilder } from 'discord.js';
import { resolveViewTarget } from '../utils/interactionContext.js';
import { getProfile } from '../services/profileService.js';
import { listGrouped } from '../services/npcHoldingService.js';
import { listInventory } from '../services/goodsService.js';
import { listProperties } from '../services/propertyService.js';
import { getSchoolsOverview, getUnlockedSpells } from '../services/magicService.js';
import { canChangeMenhir } from '../domain/picarda.js';
import { UserFacingError } from '../utils/errors.js';
import { buildCustomId } from '../utils/componentAuth.js';
import {
  E, buildProfileEmbed, buildNpcsEmbed, buildGoodsEmbed, buildPropertiesEmbed,
  buildSchoolsEmbed, buildSpellsEmbed,
} from '../utils/embeds.js';
import { PAGE_SIZE, totalPages, paginationRow } from '../utils/paginate.js';

export const PROFILE_NS = 'perfil';

export const VIEW_ORDER = ['perfil', 'npcs', 'bienes', 'propiedades', 'escuelas', 'conjuros'];

const VIEW_META = {
  perfil: { label: 'Perfil', description: 'Estadísticas, raza, menhir y estado civil' },
  npcs: { label: 'NPCs', description: 'Tus NPCs agrupados por nombre' },
  bienes: { label: 'Bienes', description: 'Tus bienes por categoría' },
  propiedades: { label: 'Propiedades', description: 'Tus propiedades' },
  escuelas: { label: 'Escuelas', description: 'Escuelas de magia y Magia total' },
  conjuros: { label: 'Conjuros', description: 'Conjuros desbloqueados' },
};

const PAGED = {
  npcs: {
    fetch: (playerId, page) => listGrouped(playerId, { page, pageSize: PAGE_SIZE }),
    build: (data) => buildNpcsEmbed(data),
  },
  bienes: {
    fetch: (playerId, page) => listInventory(playerId, { page, pageSize: PAGE_SIZE }),
    build: (data) => buildGoodsEmbed(data),
  },
  propiedades: {
    fetch: (playerId, page) => listProperties(playerId, { page, pageSize: PAGE_SIZE }),
    build: (data) => buildPropertiesEmbed(data),
  },
  conjuros: {
    fetch: (playerId, page, school) => getUnlockedSpells(playerId, { schoolSlug: school, page, pageSize: PAGE_SIZE }),
    build: (data, school) => buildSpellsEmbed({ ...data, schoolName: data.rows[0]?.school ?? school }),
  },
};

export function viewSelectRow(viewerId, playerId, current, school) {
  const select = new StringSelectMenuBuilder()
    .setCustomId(buildCustomId({ ns: PROFILE_NS, action: 'view', owner: viewerId, ctx: `${playerId}.${school ?? '-'}` }))
    .setPlaceholder('Cambiar de sección')
    .addOptions(VIEW_ORDER.map(view => ({
      label: VIEW_META[view].label,
      description: VIEW_META[view].description,
      value: view,
      emoji: E[view],
      default: view === current,
    })));
  return new ActionRowBuilder().addComponents(select);
}

function actionButton(viewerId, playerId, action, label, emoji, style = ButtonStyle.Secondary, extra = '') {
  return new ButtonBuilder()
    .setCustomId(buildCustomId({ ns: PROFILE_NS, action, owner: viewerId, ctx: `${playerId}${extra}` }))
    .setLabel(label)
    .setEmoji(emoji)
    .setStyle(style);
}

function profileButtons(viewerId, profile) {
  const playerId = profile.player.id;
  const buttons = [];
  if (profile.freePoints > 0) buttons.push(actionButton(viewerId, playerId, 'alloc', 'Asignar puntos', E.stats, ButtonStyle.Primary));
  if (canChangeMenhir(profile.player)) buttons.push(actionButton(viewerId, playerId, 'menhir', 'Elegir menhir', E.menhir));
  if (profile.civil.spouse) {
    buttons.push(actionButton(viewerId, playerId, 'divorce', 'Divorciarse', E.civil, ButtonStyle.Danger));
  } else {
    buttons.push(actionButton(viewerId, playerId, 'marry', 'Proponer matrimonio', E.civil));
  }
  return new ActionRowBuilder().addComponents(buttons);
}

async function fetchPage(definition, playerId, page, school) {
  let data = await definition.fetch(playerId, page, school);
  let pages = totalPages(data.total);
  let current = page;
  if (page > pages) {
    current = pages;
    data = await definition.fetch(playerId, current, school);
  }
  return { data, page: current, pages };
}

export async function renderView({ view, page = 1, player, viewerId, school = null }) {
  if (!VIEW_ORDER.includes(view)) throw new UserFacingError('Esa sección no existe.');
  const isSelf = player.discord_id === viewerId;
  const components = [viewSelectRow(viewerId, player.id, view, school)];

  if (view === 'perfil') {
    const profile = await getProfile(player.id);
    if (isSelf) components.push(profileButtons(viewerId, profile));
    return { embeds: [buildProfileEmbed(profile)], components };
  }

  if (view === 'escuelas') {
    const overview = await getSchoolsOverview(player.id);
    if (isSelf && overview.canClaimFreeSchool) {
      components.push(new ActionRowBuilder().addComponents(
        actionButton(viewerId, player.id, 'freeschool', 'Escuela gratuita', E.escuelas, ButtonStyle.Success)
      ));
    }
    return { embeds: [buildSchoolsEmbed(overview)], components };
  }

  const definition = PAGED[view];
  const result = await fetchPage(definition, player.id, page, school);
  if (result.pages > 1) {
    components.push(paginationRow({
      owner: viewerId, view, page: result.page, pages: result.pages, playerId: player.id, extra: school,
    }));
  }
  if (view === 'conjuros') {
    components.push(new ActionRowBuilder().addComponents(
      actionButton(viewerId, player.id, 'next', 'Ver siguientes', E.lock, ButtonStyle.Secondary, `.${school ?? '-'}`)
    ));
  }
  return {
    embeds: [definition.build({ ...result.data, page: result.page, pages: result.pages }, school)],
    components,
  };
}

export async function replyWithView(interaction, view, { school = null } = {}) {
  const { player } = await resolveViewTarget(interaction);
  const payload = await renderView({ view, player, viewerId: interaction.user.id, school });
  return interaction.reply({ ...payload, flags: MessageFlags.Ephemeral });
}
