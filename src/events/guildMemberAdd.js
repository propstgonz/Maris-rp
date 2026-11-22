

import { Events } from 'discord.js';
import logger from '../utils/logger.js';
import { getPlayerByDiscordId } from '../services/playerService.js';
import { reviveByCharacterId } from '../services/characterLifecycleService.js';
import { notifyModmailChannel } from '../services/modmailService.js';

export default {
  name: Events.GuildMemberAdd,
  once: false,

  async execute(member, client) {
    logger.info(
      `[MemberAdd] Nuevo miembro: ${member.user.tag} (${member.id}) ` +
      `→ guild: ${member.guild.name}`
    );

    const player = await getPlayerByDiscordId(member.id);
    if (!player?.character_created_at || player.is_alive) return;

    let revived;
    try {
      revived = await reviveByCharacterId(player.id);
    } catch (err) {
      logger.warn(`[MemberAdd] No se pudo revivir automáticamente a ${member.id}: ${err.message}`);
      return;
    }

    logger.info(`[MemberAdd] "${revived.character_name}" (${member.id}) revivido automáticamente al volver al servidor.`);

    const notice = `🔄 **${revived.character_name}** ha vuelto al servidor y su personaje ha sido revivido automáticamente.`;
    if (revived.modmail_channel_id) {
      notifyModmailChannel(client, revived.modmail_channel_id, notice)
        .catch(err => logger.warn(`[MemberAdd] No se pudo avisar en el canal de modmail: ${err.message}`));
    }
    member.send(notice).catch(() => {});
  },
};
