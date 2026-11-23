import { EmbedBuilder } from 'discord.js';
import { STATS, STAT_LABELS } from '../domain/picarda.js';
import { genderLabel } from './text.js';
import { getAvatarUrl } from './playerAvatar.js';
import { componentEmoji } from './emoji.js';

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

export const E = {
  perfil: '🧍',
  npcs: '🧍',
  bienes: '📦',
  propiedades: '🏠',
  escuelas: '📚',
  conjuros: '✨',
  civil: '💍',
  menhir: '🗿',
  raza: '🧬',
  stats: '📊',
  lock: '🔒',
};

const FIELD_MAX = 1024;
const DESCRIPTION_MAX = 4096;

export function clip(text, max) {
  const value = String(text ?? '');
  return value.length > max ? `${value.slice(0, max - 1)}…` : value;
}

export function formatNumber(value) {
  return Number(value).toLocaleString('es-ES', { maximumFractionDigits: 2 });
}

export function formatCost(amount, resource) {
  return `${formatNumber(amount)} de ${resource === 'vida' ? 'Vida' : 'Magia'}`;
}

export function pageFooter(page, pages, total, noun) {
  return `Página ${page}/${pages} · ${total} ${noun}`;
}

function listEmbed(title, color, lines, empty, footer) {
  return new EmbedBuilder()
    .setColor(color)
    .setTitle(clip(title, 256))
    .setDescription(clip(lines.length ? lines.join('\n') : empty, DESCRIPTION_MAX))
    .setFooter({ text: footer });
}

export function buildProfileEmbed(profile) {
  const { player, race, menhir, base, effective, freePoints, menhirChangeAvailableAt, civil } = profile;

  const statLines = STATS.map(stat => {
    const modifier = effective[stat] - base[stat];
    return `**${STAT_LABELS[stat]}** · base ${base[stat]} · mod ${signed(modifier)} · total **${effective[stat]}**`;
  });
  statLines.push(`Puntos libres: **${freePoints}**`);

  let menhirText = 'Sin elegir';
  if (menhir) {
    menhirText = `**${menhir.name}**\n${menhir.description}`;
    if (menhirChangeAvailableAt && menhirChangeAvailableAt > new Date()) {
      menhirText += `\nPodrás cambiarlo a partir de ${discordTimestamp(menhirChangeAvailableAt, 'D')}.`;
    }
  }

  let raceText = 'Sin raza';
  if (race) raceText = race.traits ? `**${race.name}**\n${race.traits}` : `**${race.name}**`;

  const civilText = civil.spouse ? `${civil.label} · con <@${civil.spouse.discordId}>` : civil.label;

  const embed = new EmbedBuilder()
    .setColor(COLORS.PURPLE)
    .setTitle(clip(`${E.perfil} ${player.character_name}`, 256))
    .setDescription(
      `**Género:** ${genderLabel(player.gender)} · **Edad:** ${player.age ?? '—'}\n` +
      `**Creado:** ${discordTimestamp(player.character_created_at, 'D')}`
    )
    .addFields(
      { name: `${E.stats} Estadísticas`, value: clip(statLines.join('\n'), FIELD_MAX) },
      { name: `${E.raza} Raza`, value: clip(raceText, FIELD_MAX) },
      { name: `${E.menhir} Menhir`, value: clip(menhirText, FIELD_MAX) },
      { name: `${E.civil} Estado civil`, value: clip(civilText, FIELD_MAX) },
    );

  const avatarUrl = getAvatarUrl(player, 'perfil');
  if (avatarUrl) embed.setThumbnail(avatarUrl);
  return embed;
}

export function buildNpcsEmbed({ rows, total, page, pages }) {
  const lines = rows.map(r => `• ${clip(r.name, 80)} ×${r.count}`);
  return listEmbed(`${E.npcs} NPCs`, COLORS.BLUE, lines, 'No tienes ningún NPC.', pageFooter(page, pages, total, 'tipos'));
}

export function buildGoodsEmbed({ rows, total, page, pages }) {
  const lines = [];
  let category = null;
  for (const r of rows) {
    const name = r.category ?? 'Sin categoría';
    if (name !== category) {
      category = name;
      lines.push(`**${clip(name, 60)}**`);
    }
    const emoji = componentEmoji(r.emoji, E.bienes);
    lines.push(`${emoji} ${clip(r.display_name, 80)} — ${formatNumber(r.quantity)}`);
  }
  return listEmbed(`${E.bienes} Bienes`, COLORS.YELLOW, lines, 'No tienes ningún bien.', pageFooter(page, pages, total, 'bienes'));
}

export function buildPropertiesEmbed({ rows, total, page, pages }) {
  const lines = rows.map(r => {
    const emoji = componentEmoji(r.emoji, E.propiedades);
    const name = r.name ? ` «${clip(r.name, 60)}»` : '';
    const where = r.location ? ` · ${clip(r.location, 60)}` : '';
    return `${emoji} **${clip(r.type_display_name, 60)}**${name} — nivel ${r.level}${where} · \`#${r.id}\``;
  });
  return listEmbed(`${E.propiedades} Propiedades`, COLORS.GREEN, lines, 'No tienes ninguna propiedad.', pageFooter(page, pages, total, 'propiedades'));
}

export function schoolFormula(school) {
  const secondary = STAT_LABELS[school.secondary_stat] ?? school.secondary_stat;
  const divisor = Number(school.secondary_divisor);
  return `D20 + Autismo + ${divisor === 1 ? secondary : `${secondary}/${formatNumber(divisor)}`}`;
}

function schoolLine(row, now) {
  if (!row.active) return 'Excluida hasta nuevo aviso';
  const lines = [row.rank > 0 ? `Nivel ${row.rank} · ${row.levelName}` : 'Sin iniciar'];
  if (row.next) {
    const mentor = row.next.rank >= 2 ? ' · requiere mentor' : '';
    lines.push(`Siguiente: ${row.next.name} — ${schoolFormula(row.school)} ≥ ${formatNumber(row.next.threshold)}${mentor}`);
  } else {
    lines.push('Nivel máximo alcanzado');
  }
  if (row.retryAfter && new Date(row.retryAfter) > now) {
    lines.push(`Puede reintentar el ${discordTimestamp(row.retryAfter, 'D')}`);
  }
  return lines.join('\n');
}

export function buildSchoolsEmbed(overview, now = new Date()) {
  const { magia, vidaExtra } = overview.magic;
  const magicText = vidaExtra > 0
    ? `Magia total: **${formatNumber(magia)}** · **+${formatNumber(vidaExtra)} de Vida**`
    : `Magia total: **${formatNumber(magia)}**`;
  const embed = new EmbedBuilder()
    .setColor(COLORS.BLUE)
    .setTitle(`${E.escuelas} Escuelas de magia`)
    .setDescription(overview.canClaimFreeSchool
      ? `${magicText}\nTienes una **escuela gratuita** disponible.`
      : magicText);
  for (const row of overview.schools) {
    embed.addFields({ name: clip(row.school.name, 256), value: clip(schoolLine(row, now), FIELD_MAX), inline: true });
  }
  return embed;
}

export function buildSpellsEmbed({ rows, total, page, pages, locked = false, schoolName = null }) {
  const lines = [];
  let heading = null;
  for (const spell of rows) {
    const key = `${spell.school}|${spell.levelName}`;
    if (key !== heading) {
      heading = key;
      lines.push(`**${spell.school}** · ${spell.levelName}`);
    }
    const prefix = locked ? `${E.lock} ` : '• ';
    lines.push(`${prefix}**${clip(spell.name, 80)}** — ${formatCost(spell.cost_amount, spell.cost_resource)}\n${clip(spell.description, 240)}`);
  }
  const title = locked ? `${E.conjuros} Conjuros bloqueados (nivel siguiente)` : `${E.conjuros} Conjuros${schoolName ? ` · ${schoolName}` : ''}`;
  const empty = locked ? 'No hay conjuros en el nivel siguiente.' : 'Todavía no tienes conjuros desbloqueados.';
  return listEmbed(title, COLORS.PURPLE, lines, empty, pageFooter(page, pages, total, 'conjuros'));
}
