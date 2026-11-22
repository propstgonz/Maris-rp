
















import { Events, ChannelType } from 'discord.js';
import logger from '../utils/logger.js';
import { getPlayerByDiscordId } from '../services/playerService.js';
import {
  relayDmToChannel,
  relayChannelToDm,
  findPlayerByModmailChannelId,
} from '../services/modmailService.js';

export default {
  name: Events.MessageCreate,
  once: false,


  async execute(message, client) {

    if (message.author.bot) return;


    if (message.channel.type === ChannelType.DM) {
      const player = await getPlayerByDiscordId(message.author.id);

      if (!player?.character_created_at) {
        await message
          .reply('👋 Todavía no tienes un personaje. Usa `/personaje crear` en el servidor para empezar a rolear.')
          .catch(() => {});
        return;
      }

      if (!player.modmail_channel_id) {
        await message
          .reply(
            '⚠️ Tu personaje no tiene un canal de contacto con Staff configurado todavía. ' +
            'Avisa a Staff en el servidor para que lo revisen.'
          )
          .catch(() => {});
        return;
      }

      try {
        await relayDmToChannel(client, player, message);
      } catch (err) {
        logger.warn(`[Modmail] Error retransmitiendo MD de ${message.author.tag}: ${err.message}`);
      }
      return;
    }


    const player = await findPlayerByModmailChannelId(message.channelId);
    if (!player) return;
    if (player.discord_id === message.author.id) return;

    try {
      await relayChannelToDm(client, player, message);
    } catch (err) {
      logger.warn(`[Modmail] Error retransmitiendo mensaje de Staff a ${player.discord_id}: ${err.message}`);
    }
  },
};
