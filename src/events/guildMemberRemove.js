
















import { Events } from 'discord.js';
import logger from '../utils/logger.js';
import { getPlayerByDiscordId } from '../services/playerService.js';
import { markDeceased } from '../services/characterLifecycleService.js';

export default {
  name: Events.GuildMemberRemove,
  once: false,


  async execute(member, client) {
    const discordId = member.id;
    logger.info(`[MemberRemove] ${member.user.tag} (${discordId}) salió de ${member.guild.name}.`);

    const player = await getPlayerByDiscordId(discordId);
    if (!player?.character_created_at || !player.is_alive) return;

    try {
      await markDeceased(client, discordId, 'abandonó el servidor', { permadeath: false });
      logger.info(`[MemberRemove] "${player.character_name}" (${discordId}) marcado como muerto — periodo de gracia de 7 días, revivible si vuelve.`);
    } catch (err) {
      logger.warn(`[MemberRemove] No se pudo marcar como muerto a ${discordId}: ${err.message}`);
    }
  },
};
