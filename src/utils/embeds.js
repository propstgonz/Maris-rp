import { EmbedBuilder } from 'discord.js';

export const COLORS = {
  GREEN:  0x2ecc71,
  YELLOW: 0xf39c12,
  RED:    0xe74c3c,
  BLUE:   0x3498db,
  DARK:   0x2c3e50,
  PURPLE: 0x9b59b6,
  GREY:   0x95a5a6,
  BLACK:  0x1a1a1a,
};

export function discordTimestamp(when, style = 'f') {
  const d = when instanceof Date ? when : new Date(when);
  return `<t:${Math.floor(d.getTime() / 1000)}:${style}>`;
}

export function discordRelativeFromNow(secondsRemaining) {
  return discordTimestamp(new Date(Date.now() + Math.max(0, secondsRemaining) * 1000), 'R');
}

export function formatExpiry(isoString) {
  if (!isoString) return 'permanente';
  return `${discordTimestamp(isoString, 'f')} (${discordTimestamp(isoString, 'R')})`;
}

export function formatDate(isoString) {
  return discordTimestamp(isoString, 'd');
}

export function signed(n) {
  return (n >= 0 ? '+' : '') + n;
}

export function buildErrorEmbed(message) {
  return new EmbedBuilder()
    .setColor(COLORS.RED)
    .setDescription(`❌ ${message}`);
}

export function buildSuccessEmbed(title, description = '') {
  const embed = new EmbedBuilder()
    .setColor(COLORS.GREEN)
    .setTitle(`✅ ${title}`);
  if (description) embed.setDescription(description);
  return embed;
}
