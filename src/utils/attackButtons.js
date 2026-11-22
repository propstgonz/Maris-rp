import { ActionRowBuilder, ButtonBuilder, ButtonStyle } from 'discord.js';
import { buildCustomId } from './componentAuth.js';

export const ATTACK_NS = 'atk';

export function buildAttackMenuButton(discordId, label, { emoji = '⚔️', style = ButtonStyle.Danger, action = 'counter' } = {}) {
  return new ButtonBuilder()
    .setCustomId(buildCustomId({ ns: ATTACK_NS, action, owner: discordId }))
    .setLabel(label)
    .setEmoji(emoji)
    .setStyle(style);
}

export function buildAttackMenuRow(discordId, label) {
  return new ActionRowBuilder().addComponents(buildAttackMenuButton(discordId, label));
}
