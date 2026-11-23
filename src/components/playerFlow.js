import { findPlayerById } from '../services/playerService.js';
import { UserFacingError } from '../utils/errors.js';
import { callerIsRolepriest } from '../utils/interactionContext.js';
import { parsePaginationCtx, targetPage } from '../utils/paginate.js';
import { renderView } from './playerViews.js';
import {
  startAllocate, startMenhir, startMarriage, startDivorce, startFreeSchool, showNextSpells,
} from './perfilActions.js';

async function loadViewable(interaction, playerId) {
  const player = Number.isInteger(playerId) ? await findPlayerById(playerId) : null;
  if (!player?.character_created_at) throw new UserFacingError('Ese personaje ya no existe.');
  const isSelf = player.discord_id === interaction.user.id;
  if (!isSelf && !await callerIsRolepriest(interaction)) {
    throw new UserFacingError('Solo puedes consultar tu propio personaje.');
  }
  if (isSelf && !player.is_alive) throw new UserFacingError('Tu personaje ha muerto.');
  return { player, isSelf };
}

const SELF_ACTIONS = {
  alloc: startAllocate,
  menhir: startMenhir,
  marry: (interaction, player) => startMarriage(interaction, player),
  divorce: startDivorce,
  freeschool: (interaction, player) => startFreeSchool(interaction, player),
};

export async function handleProfileComponent(interaction, parsed) {
  const [playerId, schoolRaw] = parsed.ctx.split('.');
  const school = !schoolRaw || schoolRaw === '-' ? null : schoolRaw;
  const { player, isSelf } = await loadViewable(interaction, Number(playerId));

  if (parsed.action === 'view') {
    const view = interaction.values[0];
    return interaction.update(await renderView({ view, player, viewerId: interaction.user.id, school }));
  }
  if (parsed.action === 'next') return showNextSpells(interaction, player, school);

  const start = SELF_ACTIONS[parsed.action];
  if (!start) return undefined;
  if (!isSelf) throw new UserFacingError('Solo puedes hacer esto con tu propio personaje.');
  return start(interaction, player);
}

export async function handlePaginationComponent(interaction, parsed) {
  const ctx = parsePaginationCtx(parsed.ctx);
  if (!ctx || (parsed.action !== 'prev' && parsed.action !== 'next')) return undefined;
  const { player } = await loadViewable(interaction, ctx.playerId);
  const page = targetPage(parsed.action, ctx.page, Number.MAX_SAFE_INTEGER);
  return interaction.update(await renderView({
    view: ctx.view, page, player, viewerId: interaction.user.id, school: ctx.extra,
  }));
}
