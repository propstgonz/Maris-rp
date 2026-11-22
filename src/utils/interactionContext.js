import { getPlayerByDiscordId } from '../services/playerService.js';
import { isRolepriest, resolveMember } from './permissions.js';
import { UserFacingError } from './errors.js';

export function actorFrom(interaction) {
  return { discordId: interaction.user.id, username: interaction.user.tag ?? interaction.user.username, source: 'discord' };
}

export async function callerIsRolepriest(interaction) {
  return isRolepriest(await resolveMember(interaction));
}

export async function requireLivingCharacter(discordId, { self = true } = {}) {
  const player = await getPlayerByDiscordId(discordId);
  if (!player?.character_created_at || !player.is_alive) {
    throw new UserFacingError(self
      ? 'No tienes un personaje vivo. Créalo con `/personaje crear`.'
      : 'Esa persona no tiene un personaje vivo.');
  }
  return player;
}

export async function resolveViewTarget(interaction, optionName = 'jugador') {
  const requested = interaction.options.getUser(optionName);
  if (!requested || requested.id === interaction.user.id) {
    return { player: await requireLivingCharacter(interaction.user.id), isSelf: true };
  }
  if (!await callerIsRolepriest(interaction)) {
    throw new UserFacingError('Solo puedes consultar tu propio personaje.');
  }
  const player = await getPlayerByDiscordId(requested.id);
  if (!player?.character_created_at) throw new UserFacingError('Esa persona no tiene personaje.');
  return { player, isSelf: false };
}

export async function requireTargetCharacter(interaction, optionName = 'jugador') {
  const user = interaction.options.getUser(optionName, true);
  return requireLivingCharacter(user.id, { self: user.id === interaction.user.id });
}
