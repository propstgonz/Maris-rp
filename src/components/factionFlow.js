

















import { EmbedBuilder, ActionRowBuilder, StringSelectMenuBuilder, MessageFlags } from 'discord.js';
import { listFactions } from '../services/factionService.js';
import { getPlayerByDiscordId } from '../services/playerService.js';
import { buildCustomId } from '../utils/componentAuth.js';
import { UserFacingError } from '../utils/errors.js';
import { COLORS } from '../utils/embeds.js';
import { componentEmoji } from '../utils/emoji.js';

export const FACTION_NS = 'fac';

const MAX_SELECT_OPTIONS = 25;


export async function buildFactionPickerMessage(discordId) {
  const player = await getPlayerByDiscordId(discordId);
  if (!player?.character_created_at) {
    throw new UserFacingError('Todavía no tienes un personaje. Usa `/personaje crear` para empezar.');
  }



  const candidates = (await listFactions())
    .filter(n => n.id !== player.faction_id && n.owner_player_id)
    .slice(0, MAX_SELECT_OPTIONS);

  if (candidates.length === 0) {
    throw new UserFacingError(
      'No hay ninguna facción a la que puedas solicitar ahora mismo ' +
      '(o ya eres de la única disponible, o ninguna tiene dueño que apruebe solicitudes). Mira `/faccion list`.'
    );
  }

  const select = new StringSelectMenuBuilder()
    .setCustomId(buildCustomId({ ns: FACTION_NS, action: 'pick', owner: discordId }))
    .setPlaceholder('Elige una facción…')
    .addOptions(candidates.map(n => {
      const desc = n.description?.slice(0, 100);
      return {
        label: n.display_name.slice(0, 100),
        ...(desc ? { description: desc } : {}),
        value: n.name,
        emoji: componentEmoji(n.emoji, '🏳️'),
      };
    }));

  const embed = new EmbedBuilder()
    .setColor(COLORS.DARK)
    .setTitle('🏳️ Solicitar ciudadanía')
    .setDescription('El dueño de la facción tendrá que aceptarte. La solicitud caduca sola a las 24h.');

  return {
    embeds: [embed],
    components: [new ActionRowBuilder().addComponents(select)],
    flags: MessageFlags.Ephemeral,
  };
}


export async function handleFactionComponent(interaction) {


  const { submitFactionApplication } = await import('../commands/player/faccion.js');
  return submitFactionApplication(interaction, interaction.values[0], true);
}
